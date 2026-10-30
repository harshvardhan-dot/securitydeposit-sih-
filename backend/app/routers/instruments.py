from __future__ import annotations

import json
from datetime import date, datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import audit, get_current_user, require_roles
from ..ledger import append_block, serialize_block
from ..models import (
    Document,
    Instrument,
    LedgerBlock,
    Observation,
    ReleaseRequest,
    Reminder,
    User,
    Verification,
)
from ..schemas import snapshot_instrument
from ..security import decrypt_field, decrypt_number, encrypt_field, normalize_number, sha256_hex, sign_with_user_key
from ..serializers import instrument_brief, instrument_detail, STATUS_META
from ..services import notifications
from ..services.bank import get_adapter
from ..services.extraction import cosine
from ..services.scoring import recalculate

router = APIRouter(prefix="/api/instruments", tags=["instruments"])

FIELD_LABELS = {
    "fdr_number": "FDR number",
    "bank": "Bank name",
    "amount": "Amount",
    "issue_date": "Issue date",
    "maturity_date": "Maturity date",
}


class InstrumentCreate(BaseModel):
    document_id: int
    fdr_number: str = Field(min_length=4, max_length=40)
    bank: str = Field(min_length=2, max_length=140)
    branch: str | None = None
    amount: float = Field(gt=0)
    issue_date: date
    maturity_date: date
    acknowledge_warnings: bool = False


class InstrumentUpdate(BaseModel):
    fdr_number: str | None = None
    bank: str | None = None
    branch: str | None = None
    amount: float | None = None
    issue_date: date | None = None
    maturity_date: date | None = None
    reason: str = "Correction after scrutiny"


class ObservationIn(BaseModel):
    remark: str = Field(min_length=3, max_length=2000)
    request_clarification: bool = False


class FlagIn(BaseModel):
    reason: str = Field(min_length=3, max_length=1000)


class RenewIn(InstrumentCreate):
    pass


def _scope(user: User, query):
    if user.role == "institution":
        return query.filter(Instrument.institution_id == user.institution_id)
    return query


def _get_scoped(db: Session, user: User, instrument_id: int) -> Instrument:
    instrument = db.get(Instrument, instrument_id)
    if not instrument:
        raise HTTPException(404, detail={"code": "not_found", "message": "That FDR could not be found."})
    if user.role == "institution" and instrument.institution_id != user.institution_id:
        raise HTTPException(
            403, detail={"code": "wrong_institution", "message": "You can only view your own institution's FDRs."}
        )
    return instrument


def _reference(db: Session) -> str:
    year = date.today().year
    count = db.query(Instrument).count() + 1
    reference = f"AICTE-FDR-{year}-{count:05d}"
    while db.query(Instrument).filter(Instrument.reference == reference).first():
        count += 1
        reference = f"AICTE-FDR-{year}-{count:05d}"
    return reference


def _extraction(document: Document) -> dict[str, Any]:
    try:
        return json.loads(decrypt_field(document.extraction_enc) or "{}")
    except Exception:
        return {}


def _compare_fields(instrument: Instrument, document: Document) -> list[dict[str, Any]]:
    extraction = _extraction(document)
    extracted = extraction.get("fields", {})
    submitted = {
        "fdr_number": instrument.fdr_number_enc and decrypt_field(instrument.fdr_number_enc),
        "bank": instrument.bank,
        "amount": decrypt_number(instrument.amount_enc),
        "issue_date": instrument.issue_date.isoformat() if instrument.issue_date else None,
        "maturity_date": instrument.maturity_date.isoformat() if instrument.maturity_date else None,
    }
    mismatches = []
    for key, label in FIELD_LABELS.items():
        value = extracted.get(key, {}).get("value")
        if value is None:
            continue
        mine = submitted.get(key)
        if mine is None:
            continue
        if key == "amount":
            differs = abs(float(value) - float(mine)) > 1
        elif key == "bank":
            differs = str(value).strip().lower() != str(mine).strip().lower()
        elif key == "fdr_number":
            differs = normalize_number(str(value)) != normalize_number(str(mine))
        else:
            differs = str(value) != str(mine)
        if differs:
            mismatches.append(
                {
                    "field": key,
                    "label": label,
                    "submitted": mine,
                    "extracted": value,
                    "confidence": extracted.get(key, {}).get("confidence"),
                }
            )
    return mismatches


def _duplicate_hash(db: Session, fdr_hash: str, exclude_id: int | None = None) -> list[dict[str, Any]]:
    query = db.query(Instrument).filter(Instrument.fdr_number_hash == fdr_hash)
    if exclude_id:
        query = query.filter(Instrument.id != exclude_id)
    return [
        {
            "instrument_id": row.id,
            "reference": row.reference,
            "institution_id": row.institution_id,
            "institution": row.institution.name if row.institution else None,
            "bank": row.bank,
            "status": row.status,
        }
        for row in query.all()
    ]


def _create(db: Session, user: User, payload: InstrumentCreate, parent: Instrument | None = None) -> Instrument:
    document = db.get(Document, payload.document_id)
    if not document:
        raise HTTPException(404, detail={"code": "document_missing", "message": "The uploaded document was not found. Please upload it again."})
    if document.uploaded_by != user.id and user.role != "admin":
        raise HTTPException(403, detail={"code": "document_not_yours", "message": "You can only attach documents you uploaded."})
    if document.instrument_id:
        raise HTTPException(400, detail={"code": "document_used", "message": "That document is already attached to another FDR."})
    if payload.maturity_date <= payload.issue_date:
        raise HTTPException(
            422,
            detail={
                "code": "date_inconsistent",
                "message": "The maturity date must be after the issue date. Please check the receipt.",
            },
        )

    extraction = _extraction(document)
    if extraction.get("missing_fields") and not payload.acknowledge_warnings:
        raise HTTPException(
            422,
            detail={
                "code": "confirm_extraction_warnings",
                "message": "Some fields could not be read from the document. Please review and confirm them.",
                "missing": extraction.get("missing_fields"),
            },
        )

    fdr_hash = sha256_hex(normalize_number(payload.fdr_number))
    instrument = Instrument(
        reference=_reference(db),
        institution_id=user.institution_id if user.role == "institution" else (parent.institution_id if parent else user.institution_id),
        fdr_number_enc=encrypt_field(payload.fdr_number.strip()),
        fdr_number_hash=fdr_hash,
        amount_enc=encrypt_field(f"{payload.amount:.2f}"),
        bank=payload.bank.strip(),
        branch=(payload.branch or "").strip() or None,
        issue_date=payload.issue_date,
        maturity_date=payload.maturity_date,
        status="submitted",
        created_by=user.id,
        parent_instrument_id=parent.id if parent else None,
    )
    db.add(instrument)
    db.flush()

    document.instrument_id = instrument.id
    mismatches = _compare_fields(instrument, document)
    db.add(
        Verification(
            instrument_id=instrument.id,
            source="institution",
            result="mismatch" if mismatches else "match",
            detail_json={"mismatches": mismatches, "document_id": document.id},
            officer_id=user.id,
        )
    )

    duplicates = _duplicate_hash(db, fdr_hash, exclude_id=instrument.id)
    if duplicates:
        instrument.is_flagged = True
        instrument.flag_reason = (
            f"Duplicate FDR number also recorded on {duplicates[0]['reference']} "
            f"({duplicates[0]['institution']}). Officer review required."
        )

    recalculate(db, instrument, commit=False)
    db.commit()
    db.refresh(instrument)

    append_block(
        db,
        "instrument.renewed" if parent else "instrument.submitted",
        actor=user,
        instrument_id=instrument.id,
        document_hash=document.sha256,
        payload={
            "reference": instrument.reference,
            "bank": instrument.bank,
            "amount": f"{payload.amount:.2f}",
            "maturity_date": instrument.maturity_date.isoformat(),
            "duplicate_of": duplicates[0]["reference"] if duplicates else None,
            "parent": parent.reference if parent else None,
        },
    )

    if duplicates:
        notifications.notify_officers(
            db,
            f"Duplicate FDR number detected - {instrument.reference}",
            instrument.flag_reason,
            "danger",
            f"/instruments/{instrument.id}",
        )
        db.commit()
    else:
        notifications.notify_officers(
            db,
            f"New FDR submitted - {instrument.reference}",
            f"{instrument.institution.name if instrument.institution else 'Institution'} submitted a "
            f"{payload.bank} deposit needing scrutiny.",
            "info",
            f"/instruments/{instrument.id}",
        )
        db.commit()

    return instrument


@router.get("")
def list_instruments(
    status: str | None = None,
    bank: str | None = None,
    institution_id: int | None = None,
    q: str | None = None,
    amount_min: float | None = None,
    amount_max: float | None = None,
    maturity_from: date | None = None,
    maturity_to: date | None = None,
    min_trust: float | None = None,
    max_trust: float | None = None,
    flagged: bool | None = None,
    sort: Literal["maturity", "created", "amount", "trust", "institution"] = "maturity",
    page: int = Query(1, ge=1),
    size: int = Query(25, ge=1, le=200),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = _scope(user, db.query(Instrument))
    if status:
        statuses = [s.strip() for s in status.split(",") if s.strip()]
        query = query.filter(Instrument.status.in_(statuses))
    if bank:
        query = query.filter(Instrument.bank.ilike(f"%{bank}%"))
    if institution_id and user.role != "institution":
        query = query.filter(Instrument.institution_id == institution_id)
    if maturity_from:
        query = query.filter(Instrument.maturity_date >= maturity_from)
    if maturity_to:
        query = query.filter(Instrument.maturity_date <= maturity_to)
    if flagged is not None:
        query = query.filter(Instrument.is_flagged.is_(flagged))
    if min_trust is not None:
        query = query.filter(Instrument.trust_score >= min_trust)
    if max_trust is not None:
        query = query.filter(Instrument.trust_score <= max_trust)

    rows = query.all()

    # Sensitive fields are encrypted at rest, so range / text filters run after decryption.
    if amount_min is not None or amount_max is not None:
        filtered = []
        for row in rows:
            value = decrypt_number(row.amount_enc)
            if amount_min is not None and value < amount_min:
                continue
            if amount_max is not None and value > amount_max:
                continue
            filtered.append(row)
        rows = filtered

    if q:
        needle = q.strip().lower()
        rows = [
            row
            for row in rows
            if needle in (row.reference or "").lower()
            or needle in (row.bank or "").lower()
            or needle in (row.branch or "").lower()
            or needle in (decrypt_field(row.fdr_number_enc) or "").lower()
            or needle in ((row.institution.name if row.institution else "") or "").lower()
        ]

    sorters = {
        "maturity": lambda r: (r.maturity_date or date.max),
        "created": lambda r: (r.created_at or datetime.min),
        "amount": lambda r: decrypt_number(r.amount_enc),
        "trust": lambda r: r.trust_score or 0,
        "institution": lambda r: (r.institution.name if r.institution else "").lower(),
    }
    rows.sort(key=sorters[sort], reverse=sort not in ("maturity", "institution"))

    total = len(rows)
    start = (page - 1) * size
    items = [instrument_brief(row) for row in rows[start : start + size]]
    return {"items": items, "total": total, "page": page, "size": size, "pages": max(1, (total + size - 1) // size)}


@router.get("/{instrument_id}")
def get_instrument(instrument_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    instrument = _get_scoped(db, user, instrument_id)
    data = instrument_detail(db, instrument)
    data["extracted_fields"] = {}
    if instrument.documents:
        latest = sorted(instrument.documents, key=lambda d: d.version, reverse=True)[0]
        data["extracted_fields"] = _extraction(latest).get("fields", {})
        data["mismatches"] = next(
            (
                v.detail_json.get("mismatches", [])
                for v in sorted(instrument.verifications, key=lambda v: v.created_at or datetime.min, reverse=True)
                if v.source == "institution"
            ),
            [],
        )
    data["bank_verification"] = next(
        (
            {
                "result": v.result,
                "detail": v.detail_json,
                "created_at": v.created_at.isoformat() + "Z" if v.created_at else None,
            }
            for v in sorted(instrument.verifications, key=lambda v: v.created_at or datetime.min, reverse=True)
            if v.source == "bank"
        ),
        None,
    )
    data["requests"] = [
        {
            "id": r.id,
            "type": r.type,
            "status": r.status,
            "created_at": r.created_at.isoformat() + "Z" if r.created_at else None,
        }
        for r in db.query(ReleaseRequest).filter(ReleaseRequest.instrument_id == instrument.id).all()
    ]
    data["child_instruments"] = [
        instrument_brief(child)
        for child in db.query(Instrument).filter(Instrument.parent_instrument_id == instrument.id).all()
    ]
    return data


@router.post("", status_code=201)
def create_instrument(payload: InstrumentCreate, request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.role not in ("institution", "admin"):
        raise HTTPException(403, detail={"code": "role_not_allowed", "message": "Only institution users can submit FDRs."})
    instrument = _create(db, user, payload)
    audit(db, user, "instrument.create", instrument.reference, f"amount={payload.amount}", request)
    return {
        "instrument": instrument_brief(instrument),
        "duplicate_alert": instrument.is_flagged,
        "message": "Submitted. Your tracking ID is ready.",
    }


@router.patch("/{instrument_id}")
def update_instrument(
    instrument_id: int,
    payload: InstrumentUpdate,
    request: Request,
    user: User = Depends(require_roles("scrutiny_officer", "admin")),
    db: Session = Depends(get_db),
):
    instrument = _get_scoped(db, user, instrument_id)
    before = snapshot_instrument(instrument)
    changed = {}
    for field in ("bank", "branch"):
        value = getattr(payload, field)
        if value is not None and value != getattr(instrument, field):
            changed[field] = {"from": getattr(instrument, field), "to": value}
            setattr(instrument, field, value)
    if payload.fdr_number:
        current = decrypt_field(instrument.fdr_number_enc)
        if payload.fdr_number.strip() != current:
            changed["fdr_number"] = {"from": current, "to": payload.fdr_number.strip()}
            instrument.fdr_number_enc = encrypt_field(payload.fdr_number.strip())
            instrument.fdr_number_hash = sha256_hex(normalize_number(payload.fdr_number))
    if payload.amount is not None:
        current_amount = decrypt_number(instrument.amount_enc)
        if abs(current_amount - payload.amount) > 0.001:
            changed["amount"] = {"from": current_amount, "to": payload.amount}
            instrument.amount_enc = encrypt_field(f"{payload.amount:.2f}")
    for field in ("issue_date", "maturity_date"):
        value = getattr(payload, field)
        if value is not None and value != getattr(instrument, field):
            changed[field] = {"from": str(getattr(instrument, field)), "to": str(value)}
            setattr(instrument, field, value)
    if instrument.maturity_date and instrument.issue_date and instrument.maturity_date <= instrument.issue_date:
        raise HTTPException(422, detail={"code": "date_inconsistent", "message": "Maturity must be after the issue date."})

    if not changed:
        return {"ok": True, "changed": {}, "instrument": instrument_brief(instrument)}

    instrument.updated_at = datetime.utcnow()
    db.add(
        Verification(
            instrument_id=instrument.id,
            source="officer",
            result="corrected",
            detail_json={"changes": changed, "reason": payload.reason},
            officer_id=user.id,
        )
    )
    recalculate(db, instrument, commit=False)
    db.commit()
    append_block(
        db,
        "instrument.updated",
        actor=user,
        instrument_id=instrument.id,
        payload={"reference": instrument.reference, "changes": changed, "reason": payload.reason, "before": before},
    )
    audit(db, user, "instrument.update", instrument.reference, payload.reason, request)
    return {"ok": True, "changed": changed, "instrument": instrument_brief(instrument)}


@router.post("/{instrument_id}/verify/bank")
def bank_verify(
    instrument_id: int,
    request: Request,
    user: User = Depends(require_roles("verification_officer", "admin")),
    db: Session = Depends(get_db),
):
    instrument = _get_scoped(db, user, instrument_id)
    fdr_number = decrypt_field(instrument.fdr_number_enc) or ""
    amount = decrypt_number(instrument.amount_enc)
    result = get_adapter().verify(instrument, fdr_number, amount)

    db.add(
        Verification(
            instrument_id=instrument.id,
            source="bank",
            result=result["result"],
            detail_json=result,
            officer_id=user.id,
        )
    )
    if result["result"] == "confirmed":
        instrument.status = "bank_confirmed"
        instrument.verified_at = datetime.utcnow()
        notifications.notify_institution(
            db,
            instrument.institution_id,
            f"Bank confirmed - {instrument.reference}",
            f"{instrument.bank} confirmed your deposit receipt.",
            "success",
            f"/instruments/{instrument.id}",
        )
    else:
        instrument.is_flagged = True
        instrument.flag_reason = result["notes"]
        notifications.notify_institution(
            db,
            instrument.institution_id,
            f"Bank could not confirm - {instrument.reference}",
            result["notes"],
            "danger",
            f"/instruments/{instrument.id}",
        )
        notifications.notify_officers(
            db,
            f"Bank mismatch - {instrument.reference}",
            result["notes"],
            "danger",
            f"/instruments/{instrument.id}",
        )

    recalculate(db, instrument, commit=False)
    db.commit()
    append_block(
        db,
        "verification.bank",
        actor=user,
        instrument_id=instrument.id,
        payload={
            "reference": instrument.reference,
            "result": result["result"],
            "bank_reference": result["bank_reference"],
            "adapter": result["adapter"],
        },
    )
    audit(db, user, "bank_verify", instrument.reference, result["result"], request)
    return {"result": result, "instrument": instrument_brief(instrument)}


@router.post("/{instrument_id}/confirm")
def confirm_instrument(
    instrument_id: int,
    request: Request,
    user: User = Depends(require_roles("scrutiny_officer", "admin")),
    db: Session = Depends(get_db),
):
    instrument = _get_scoped(db, user, instrument_id)
    if not instrument.documents:
        raise HTTPException(422, detail={"code": "no_document", "message": "A supporting document is required before approval."})
    previous = instrument.status
    instrument.status = "active"
    instrument.is_flagged = False
    instrument.flag_reason = None
    instrument.verified_at = datetime.utcnow()
    recalculate(db, instrument, commit=False)
    db.commit()
    append_block(
        db,
        "instrument.approved",
        actor=user,
        instrument_id=instrument.id,
        payload={"reference": instrument.reference, "from": previous, "to": "active"},
    )
    notifications.notify_institution(
        db,
        instrument.institution_id,
        f"FDR approved - {instrument.reference}",
        "Your deposit record is now active. Reminders will be sent before maturity.",
        "success",
        f"/instruments/{instrument.id}",
    )
    db.commit()
    audit(db, user, "instrument.confirm", instrument.reference, "", request)
    return {"ok": True, "instrument": instrument_brief(instrument)}


@router.post("/{instrument_id}/flag")
def flag_instrument(
    instrument_id: int,
    payload: FlagIn,
    request: Request,
    user: User = Depends(require_roles("scrutiny_officer", "verification_officer", "admin")),
    db: Session = Depends(get_db),
):
    instrument = _get_scoped(db, user, instrument_id)
    instrument.status = "flagged"
    instrument.is_flagged = True
    instrument.flag_reason = payload.reason
    db.commit()
    append_block(
        db, "instrument.flagged", actor=user, instrument_id=instrument.id,
        payload={"reference": instrument.reference, "reason": payload.reason},
    )
    notifications.notify_institution(
        db,
        instrument.institution_id,
        f"Action needed - {instrument.reference}",
        payload.reason,
        "danger",
        f"/instruments/{instrument.id}",
    )
    db.commit()
    audit(db, user, "instrument.flag", instrument.reference, payload.reason, request)
    return {"ok": True, "instrument": instrument_brief(instrument)}


@router.post("/{instrument_id}/observations")
def add_observation(
    instrument_id: int,
    payload: ObservationIn,
    request: Request,
    user: User = Depends(require_roles("scrutiny_officer", "verification_officer", "competent_authority", "admin")),
    db: Session = Depends(get_db),
):
    instrument = _get_scoped(db, user, instrument_id)
    observation = Observation(
        instrument_id=instrument.id,
        officer_id=user.id,
        remark=payload.remark,
        clarification_requested=payload.request_clarification,
    )
    db.add(observation)
    if payload.request_clarification:
        instrument.status = "under_verification"
        notifications.notify_institution(
            db,
            instrument.institution_id,
            f"Clarification requested - {instrument.reference}",
            payload.remark,
            "warning",
            f"/instruments/{instrument.id}",
        )
    db.commit()
    append_block(
        db, "observation.recorded", actor=user, instrument_id=instrument.id,
        payload={"reference": instrument.reference, "remark": payload.remark,
                 "clarification": payload.request_clarification},
    )
    audit(db, user, "observation.create", instrument.reference, payload.remark, request)
    return {"ok": True, "observation": {"id": observation.id, "remark": observation.remark}}


@router.post("/{instrument_id}/clarification/resolve")
def resolve_clarification(
    instrument_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    instrument = _get_scoped(db, user, instrument_id)
    open_items = (
        db.query(Observation)
        .filter(Observation.instrument_id == instrument.id, Observation.clarification_requested.is_(True),
                Observation.resolved.is_(False))
        .all()
    )
    for item in open_items:
        item.resolved = True
    if open_items:
        instrument.status = "under_verification"
    db.commit()
    append_block(
        db, "clarification.resolved", actor=user, instrument_id=instrument.id,
        payload={"reference": instrument.reference, "count": len(open_items)},
    )
    notifications.notify_officers(
        db,
        f"Clarification answered - {instrument.reference}",
        "The institution responded and the case is ready for review.",
        "info",
        f"/instruments/{instrument.id}",
    )
    db.commit()
    return {"ok": True, "resolved": len(open_items)}


@router.post("/{instrument_id}/renew", status_code=201)
def renew_instrument(
    instrument_id: int,
    payload: RenewIn,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.role not in ("institution", "admin"):
        raise HTTPException(403, detail={"code": "role_not_allowed", "message": "Only institution users can upload a renewal."})
    parent = _get_scoped(db, user, instrument_id)
    if parent.status in ("released", "renewed"):
        raise HTTPException(400, detail={"code": "already_closed", "message": f"This FDR is already {parent.status}."})

    child = _create(db, user, payload, parent=parent)
    parent.status = "renewed"
    parent.last_reminder_stage = 0
    db.commit()

    append_block(
        db,
        "instrument.renewal_linked",
        actor=user,
        instrument_id=parent.id,
        payload={"parent": parent.reference, "renewed_by": child.reference},
    )
    notifications.notify_officers(
        db,
        f"Renewal received - {parent.reference}",
        f"A renewed deposit {child.reference} was linked to the original instrument.",
        "success",
        f"/instruments/{child.id}",
    )
    db.commit()
    audit(db, user, "instrument.renew", parent.reference, child.reference, request)
    return {"instrument": instrument_brief(child), "parent": instrument_brief(parent)}


@router.get("/{instrument_id}/timeline")
def timeline(instrument_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    instrument = _get_scoped(db, user, instrument_id)
    events: list[dict[str, Any]] = []

    for block in (
        db.query(LedgerBlock)
        .filter(LedgerBlock.instrument_id == instrument.id)
        .order_by(LedgerBlock.idx.asc())
        .all()
    ):
        events.append(
            {
                "type": "ledger",
                "at": block.created_at.isoformat() + "Z",
                "title": block.action.replace(".", " ").replace("_", " ").title(),
                "detail": block.payload_json or {},
                "actor": block.actor_name,
                "ledger_index": block.idx,
                "hash": block.hash,
            }
        )
    for doc in instrument.documents:
        events.append(
            {
                "type": "document",
                "at": doc.created_at.isoformat() + "Z",
                "title": "Document uploaded",
                "detail": {"name": doc.original_name, "confidence": doc.overall_confidence, "anomaly": doc.anomaly_score},
                "actor": None,
            }
        )
    for reminder in instrument.reminders:
        events.append(
            {
                "type": "reminder",
                "at": ((reminder.sent_at or datetime.utcnow()).isoformat()) + "Z",
                "title": f"Reminder sent ({reminder.stage} days)" if reminder.stage else "Expiry escalation",
                "detail": {"channel": reminder.channel, "stage": reminder.stage},
                "actor": "scheduler",
            }
        )
    for observation in instrument.observations:
        events.append(
            {
                "type": "observation",
                "at": observation.created_at.isoformat() + "Z",
                "title": "Officer observation",
                "detail": {"remark": observation.remark, "clarification": observation.clarification_requested},
                "actor": None,
            }
        )
    for child in db.query(Instrument).filter(Instrument.parent_instrument_id == instrument.id).all():
        events.append(
            {
                "type": "renewal",
                "at": child.created_at.isoformat() + "Z",
                "title": "Renewed instrument linked",
                "detail": {"reference": child.reference, "maturity": child.maturity_date.isoformat() if child.maturity_date else None},
                "actor": None,
            }
        )
    events.sort(key=lambda e: e["at"])
    return {"events": events, "instrument": instrument_brief(instrument)}


@router.get("/{instrument_id}/versions")
def versions(
    instrument_id: int,
    user: User = Depends(require_roles("scrutiny_officer", "verification_officer", "competent_authority", "admin", "auditor")),
    db: Session = Depends(get_db),
):
    instrument = _get_scoped(db, user, instrument_id)
    history = (
        db.query(Verification)
        .filter(Verification.instrument_id == instrument.id)
        .order_by(Verification.created_at.asc())
        .all()
    )
    return {
        "instrument": instrument_brief(instrument),
        "current": snapshot_instrument(instrument),
        "history": [
            {
                "id": item.id,
                "at": item.created_at.isoformat() + "Z",
                "source": item.source,
                "result": item.result,
                "detail": item.detail_json,
            }
            for item in history
        ],
    }


@router.get("/{instrument_id}/signature")
def signature_proof(
    instrument_id: int,
    user: User = Depends(require_roles("verification_officer", "competent_authority", "admin", "auditor")),
    db: Session = Depends(get_db),
):
    """Prove an action with the officer's Ed25519 key (FR-21)."""
    instrument = _get_scoped(db, user, instrument_id)
    blocks = (
        db.query(LedgerBlock)
        .filter(LedgerBlock.instrument_id == instrument.id)
        .order_by(LedgerBlock.idx.desc())
        .limit(1)
        .all()
    )
    if not blocks:
        return {"ok": False, "message": "No signed action recorded for this instrument yet."}
    block = blocks[0]
    from ..security import verify_user_signature

    payload = {
        "idx": block.idx,
        "action": block.action,
        "actor_id": block.actor_id,
        "instrument_id": block.instrument_id,
        "document_hash": block.document_hash,
        "payload": block.payload_json or {},
        "prev_hash": block.prev_hash,
        "hash": block.hash,
        "created_at": block.created_at.isoformat(),
    }
    return {
        "ok": True,
        "block": serialize_block(block),
        "signature_valid": verify_user_signature(block.signer_pubkey, payload, block.signature),
        "algo": block.algo,
        "key_id": block.key_id,
    }
