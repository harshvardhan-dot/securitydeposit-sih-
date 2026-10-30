from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from ..config import ENV, JWT_TTL_MINUTES
from ..database import get_db
from ..deps import IDLE_TIMEOUT_MINUTES, audit, require_roles
from ..ledger import verify_chain
from ..models import AuditLog, Instrument, Institution, LedgerBlock, User
from ..security import (
    encrypt_field,
    generate_signing_keypair,
    generate_totp_secret,
    hash_password,
    totp_code,
)
from ..serializers import user_public
from ..services.settings import (
    escalation_rules,
    get_setting,
    reminder_ladder,
    set_setting,
    trust_weights,
)

router = APIRouter(prefix="/api/admin", tags=["admin"])

MFA_ROLES = {"scrutiny_officer", "verification_officer", "competent_authority", "admin", "auditor"}
ROLES = ["institution", "scrutiny_officer", "verification_officer", "competent_authority", "admin", "auditor"]


class UserCreate(BaseModel):
    email: EmailStr
    name: str = Field(min_length=2, max_length=160)
    role: str
    institution_id: int | None = None
    password: str = Field(min_length=8, max_length=120)
    phone: str | None = None
    language: str = "en"


class UserPatch(BaseModel):
    name: str | None = None
    role: str | None = None
    institution_id: int | None = None
    active: bool | None = None
    language: str | None = None
    password: str | None = Field(default=None, min_length=8, max_length=120)


class SettingsIn(BaseModel):
    reminder_ladder: list[int] | None = None
    trust_weights: dict[str, float] | None = None
    verification_overdue_days: int | None = Field(default=None, ge=1, le=60)
    clarification_overdue_days: int | None = Field(default=None, ge=1, le=60)


@router.get("/users")
def list_users(
    q: str | None = None,
    role: str | None = None,
    user: User = Depends(require_roles("admin", "auditor")),
    db: Session = Depends(get_db),
):
    query = db.query(User)
    if q:
        query = query.filter(User.name.ilike(f"%{q}%") | User.email.ilike(f"%{q}%"))
    if role:
        query = query.filter(User.role == role)
    rows = query.order_by(User.role, User.name).all()
    return {"items": [user_public(row) for row in rows], "total": len(rows)}


@router.post("/users", status_code=201)
def create_user(
    payload: UserCreate,
    request: Request,
    admin: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
):
    if payload.role not in ROLES:
        raise HTTPException(400, detail={"code": "bad_role", "message": f"Role must be one of {', '.join(ROLES)}."})
    if db.query(User).filter(User.email == payload.email.lower()).first():
        raise HTTPException(409, detail={"code": "email_exists", "message": "A user with that email already exists."})
    if payload.role == "institution" and not payload.institution_id:
        raise HTTPException(400, detail={"code": "institution_required", "message": "Please select the institution for this user."})

    public_key, sealed = generate_signing_keypair()
    user = User(
        email=payload.email.lower(),
        name=payload.name,
        role=payload.role,
        institution_id=payload.institution_id,
        password_hash=hash_password(payload.password),
        phone=payload.phone,
        language=payload.language or "en",
        public_key=public_key,
        private_key_enc=sealed,
        key_id=f"ed25519-{payload.email.split('@')[0][:16]}",
    )
    response = {"user": user_public(user)}
    if payload.role in MFA_ROLES:
        secret = generate_totp_secret()
        user.mfa_secret_enc = encrypt_field(secret)
        user.mfa_enabled = True
        response["mfa"] = {
            "secret": secret,
            "current_code": totp_code(secret),
            "note": "MFA is mandatory for this role. Share the secret securely with the officer.",
        }
    db.add(user)
    db.commit()
    db.refresh(user)
    response["user"] = user_public(user)
    audit(db, admin, "user.create", user.email, payload.role, request)
    return response


@router.patch("/users/{user_id}")
def patch_user(
    user_id: int,
    payload: UserPatch,
    request: Request,
    admin: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, detail={"code": "not_found", "message": "User not found."})
    changes = {}
    for field in ("name", "role", "institution_id", "active", "language"):
        value = getattr(payload, field)
        if value is not None and value != getattr(user, field):
            if field == "role" and value not in ROLES:
                raise HTTPException(400, detail={"code": "bad_role", "message": "Unknown role."})
            changes[field] = {"from": getattr(user, field), "to": value}
            setattr(user, field, value)
    if payload.password:
        user.password_hash = hash_password(payload.password)
        changes["password"] = {"from": "***", "to": "***"}
    if payload.role in MFA_ROLES and not user.mfa_secret_enc:
        secret = generate_totp_secret()
        user.mfa_secret_enc = encrypt_field(secret)
        user.mfa_enabled = True
        changes["mfa"] = {"from": False, "to": True}
    db.commit()
    audit(db, admin, "user.update", user.email or "", str(changes), request)
    return {"ok": True, "changes": changes, "user": user_public(user)}


@router.get("/settings")
def read_settings(
    user: User = Depends(require_roles("admin", "scrutiny_officer", "competent_authority")),
    db: Session = Depends(get_db),
):
    return {
        "reminder_ladder": reminder_ladder(db),
        "trust_weights": trust_weights(db),
        "escalation": escalation_rules(db),
        "raw": {
            "reminder_ladder": get_setting(db, "reminder_ladder"),
            "trust_weights": get_setting(db, "trust_weights"),
        },
    }


@router.put("/settings")
def update_settings(
    payload: SettingsIn,
    request: Request,
    user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
):
    if payload.reminder_ladder is not None:
        if not payload.reminder_ladder or max(payload.reminder_ladder) > 365:
            raise HTTPException(400, detail={"code": "bad_ladder", "message": "Provide reminder days between 1 and 365."})
        set_setting(db, "reminder_ladder", sorted(payload.reminder_ladder, reverse=True))
    if payload.trust_weights is not None:
        set_setting(db, "trust_weights", payload.trust_weights)
    if payload.verification_overdue_days is not None:
        set_setting(db, "verification_overdue_days", payload.verification_overdue_days)
    if payload.clarification_overdue_days is not None:
        set_setting(db, "clarification_overdue_days", payload.clarification_overdue_days)
    audit(db, user, "settings.update", "settings", str(payload.model_dump(exclude_none=True)), request)
    return read_settings(user, db)


@router.get("/audit")
def audit_log(
    action: str | None = None,
    allowed: bool | None = None,
    limit: int = Query(100, ge=1, le=500),
    user: User = Depends(require_roles("admin", "auditor")),
    db: Session = Depends(get_db),
):
    query = db.query(AuditLog)
    if action:
        query = query.filter(AuditLog.action.ilike(f"%{action}%"))
    if allowed is not None:
        query = query.filter(AuditLog.allowed.is_(allowed))
    rows = query.order_by(AuditLog.at.desc()).limit(limit).all()
    return {
        "items": [
            {
                "id": row.id,
                "user": row.user_email,
                "action": row.action,
                "target": row.target,
                "detail": row.detail,
                "ip": row.ip,
                "allowed": bool(row.allowed),
                "at": row.at.isoformat() + "Z" if row.at else None,
            }
            for row in rows
        ],
        "total": query.count(),
    }


@router.get("/security/posture")
def security_posture(
    request: Request,
    user: User = Depends(require_roles("admin", "auditor", "competent_authority")),
    db: Session = Depends(get_db),
):
    scheme = request.headers.get("x-forwarded-proto") or request.url.scheme
    chain = verify_chain(db)
    officers = db.query(User).filter(User.role.in_(list(MFA_ROLES))).all()
    signed_blocks = db.query(LedgerBlock).filter(LedgerBlock.signature.isnot(None)).count()
    total_blocks = db.query(LedgerBlock).count()

    return {
        "environment": ENV,
        "encryption": {
            "at_rest": "AES-256-GCM",
            "field_level": ["fdr_number", "amount", "ocr_text", "extracted_fields", "mfa_secret", "ed25519_private_key"],
            "file_storage": "AES-256-GCM encrypted blobs on disk",
            "key_management": "environment / rotated key file, key id k1",
            "in_transit": {
                "scheme": scheme,
                "hsts": scheme == "https",
                "minimum_version": "TLS 1.3 preferred (1.2 floor) when served over HTTPS",
                "note": "Run `python run.py --tls` for a local HTTPS demo with a generated certificate.",
            },
        },
        "integrity": {
            "algorithm": "SHA-256 hash chain",
            "blocks": total_blocks,
            "chain_valid": chain["valid"],
            "broken_at": chain["broken_at"],
            "head_hash": chain["head_hash"],
        },
        "authenticity": {
            "algorithm": "Ed25519",
            "signed_blocks": signed_blocks,
            "keys_issued": db.query(User).filter(User.public_key.isnot(None)).count(),
            "note": "Each officer action is signed with their own key; the private key is sealed with AES-256-GCM.",
        },
        "access": {
            "jwt_algorithm": "HS256",
            "token_ttl_minutes": JWT_TTL_MINUTES,
            "idle_timeout_minutes": IDLE_TIMEOUT_MINUTES,
            "mfa_required_roles": sorted(MFA_ROLES),
            "mfa_enabled_officers": sum(1 for officer in officers if officer.mfa_enabled),
            "officers": len(officers),
            "rbac": {
                "institution": ["submit FDR", "renew", "request release/refund", "view own records"],
                "scrutiny_officer": ["review", "observe", "clarify", "approve"],
                "verification_officer": ["bank verification", "flag"],
                "competent_authority": ["approve/reject release", "sign decisions"],
                "admin": ["users", "settings", "ledger demo", "full access"],
                "auditor": ["read-only logs", "chain integrity", "no edits"],
            },
        },
        "accountability": {
            "audit_entries": db.query(AuditLog).count(),
            "failed_attempts": db.query(AuditLog).filter(AuditLog.allowed.is_(False)).count(),
            "last_chain_check": chain["checked_at"],
        },
    }
