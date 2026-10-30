from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from ..config import ENV
from ..database import get_db
from ..deps import audit, get_current_user
from ..ledger import append_block
from ..models import User
from ..security import (
    create_access_token,
    create_challenge_token,
    decode_token,
    decrypt_field,
    encrypt_field,
    generate_signing_keypair,
    generate_totp_secret,
    totp_code,
    totp_uri,
    verify_password,
    verify_totp,
)
from ..serializers import user_public

router = APIRouter(prefix="/api/auth", tags=["auth"])

MFA_ROLES = {"scrutiny_officer", "verification_officer", "competent_authority", "admin", "auditor"}


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class MfaIn(BaseModel):
    challenge_token: str
    code: str


class LanguageIn(BaseModel):
    language: str


class MfaEnableIn(BaseModel):
    code: str


def _token_response(user: User) -> dict:
    return {
        "access_token": create_access_token(user.id, user.role, user.institution_id, user.name),
        "token_type": "bearer",
        "user": user_public(user),
        "mfa_required": False,
    }


def _bad_credentials():
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail={"code": "invalid_credentials", "message": "That email and password do not match. Please try again."},
    )


@router.post("/login")
def login(payload: LoginIn, request: Request, db: Session = Depends(get_db)):
    email = payload.email.lower().strip()
    user = db.query(User).filter(User.email == email).first()

    if user and user.locked_until and user.locked_until > datetime.utcnow():
        audit(db, user, "login", email, "account locked", request, allowed=False)
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail={
                "code": "account_locked",
                "message": "Too many failed attempts. This account is locked for 15 minutes.",
            },
        )

    if not user or not verify_password(payload.password, user.password_hash) or not user.active:
        if user:
            user.failed_logins = (user.failed_logins or 0) + 1
            if user.failed_logins >= 5:
                user.locked_until = datetime.utcnow() + timedelta(minutes=15)
            db.commit()
        audit(db, user, "login", email, "invalid credentials", request, allowed=False)
        raise _bad_credentials()

    user.failed_logins = 0
    user.locked_until = None

    if user.mfa_enabled and user.mfa_secret_enc:
        db.commit()
        audit(db, user, "login_challenge", email, "MFA challenge issued", request)
        response = {
            "mfa_required": True,
            "challenge_token": create_challenge_token(user.id),
            "user": {"email": user.email, "name": user.name, "role": user.role},
        }
        if ENV == "demo":
            secret = decrypt_field(user.mfa_secret_enc) or ""
            response["demo_hint"] = {
                "code": totp_code(secret),
                "note": "Demo only: a real deployment shows this code in the officer's authenticator app.",
            }
        return response

    user.last_login_at = datetime.utcnow()
    if not user.public_key:
        public_key, sealed = generate_signing_keypair()
        user.public_key, user.private_key_enc = public_key, sealed
    db.commit()
    audit(db, user, "login", email, "signed in", request)
    append_block(db, "user.login", actor=user, payload={"email": email})
    return _token_response(user)


@router.post("/mfa/verify")
def verify_mfa(payload: MfaIn, request: Request, db: Session = Depends(get_db)):
    try:
        claims = decode_token(payload.challenge_token)
        if claims.get("scope") != "mfa":
            raise ValueError("wrong scope")
        user = db.get(User, int(claims["sub"]))
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "mfa_expired", "message": "This verification step expired. Please sign in again."},
        )

    secret = decrypt_field(user.mfa_secret_enc) or ""
    if not verify_totp(secret, payload.code):
        audit(db, user, "mfa_failed", user.email or "", "invalid code", request, allowed=False)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "mfa_invalid", "message": "That verification code is not correct. Check the app and try again."},
        )

    user.last_login_at = datetime.utcnow()
    if not user.public_key:
        public_key, sealed = generate_signing_keypair()
        user.public_key, user.private_key_enc = public_key, sealed
    db.commit()
    audit(db, user, "login", user.email or "", "signed in with MFA", request)
    append_block(db, "user.login", actor=user, payload={"email": user.email, "mfa": True})
    return _token_response(user)


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return user_public(user)


@router.post("/logout")
def logout(request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    audit(db, user, "logout", user.email or "", "signed out", request)
    return {"ok": True}


@router.post("/language")
def set_language(payload: LanguageIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    user.language = payload.language if payload.language in {"en", "hi"} else "en"
    db.commit()
    return {"ok": True, "language": user.language}


@router.get("/mfa/status")
def mfa_status(user: User = Depends(get_current_user)):
    return {
        "mfa_required_for_role": user.role in MFA_ROLES,
        "mfa_enabled": bool(user.mfa_enabled),
    }


@router.post("/mfa/setup")
def mfa_setup(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.role not in MFA_ROLES:
        raise HTTPException(
            status_code=403,
            detail={"code": "mfa_not_required", "message": "MFA is only required for officer and administrator accounts."},
        )
    secret = generate_totp_secret()
    user.mfa_secret_enc = encrypt_field(secret)
    db.commit()
    # Demo convenience: the secret is shown once so any TOTP app can be enrolled.
    return {
        "secret": secret,
        "otpauth_uri": totp_uri(secret, user.email or user.name),
        "current_code": totp_code(secret),
        "note": "Scan the URI in an authenticator app, then confirm with the 6-digit code.",
    }


@router.post("/mfa/enable")
def mfa_enable(payload: MfaEnableIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    secret = decrypt_field(user.mfa_secret_enc) or ""
    if not secret or not verify_totp(secret, payload.code):
        raise HTTPException(
            status_code=400,
            detail={"code": "mfa_invalid", "message": "That code did not match. Please try the current code from your app."},
        )
    user.mfa_enabled = True
    db.commit()
    append_block(db, "user.mfa_enabled", actor=user, payload={"email": user.email})
    return {"ok": True, "mfa_enabled": True}


@router.post("/mfa/disable")
def mfa_disable(payload: MfaEnableIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    secret = decrypt_field(user.mfa_secret_enc) or ""
    if not secret or not verify_totp(secret, payload.code):
        raise HTTPException(
            status_code=400,
            detail={"code": "mfa_invalid", "message": "Enter a valid current code before turning MFA off."},
        )
    user.mfa_enabled = False
    db.commit()
    return {"ok": True, "mfa_enabled": False}
