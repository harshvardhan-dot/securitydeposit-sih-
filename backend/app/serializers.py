"""Serializers - the single place where encrypted fields are decrypted for the API."""
from __future__ import annotations

import json
from datetime import date, datetime
from typing import Any

from sqlalchemy.orm import Session

from .models import (
    Document,
    Instrument,
    Notification,
    Observation,
    ReleaseRequest,
    Reminder,
    User,
    Verification,
)
from .security import decrypt_field, decrypt_number

STATUS_META: dict[str, dict[str, str]] = {
    "submitted": {"label": "Submitted", "tone": "slate", "icon": "inbox"},
    "under_verification": {"label": "Under verification", "tone": "blue", "icon": "search"},
    "bank_confirmed": {"label": "Bank confirmed", "tone": "teal", "icon": "badge-check"},
    "active": {"label": "Active", "tone": "green", "icon": "shield-check"},
    "expiring": {"label": "Expiring soon", "tone": "amber", "icon": "clock"},
    "matured": {"label": "Matured", "tone": "red", "icon": "alarm-clock"},
    "renewed": {"label": "Renewed", "tone": "violet", "icon": "refresh"},
    "release_requested": {"label": "Release requested", "tone": "indigo", "icon": "file-output"},
    "released": {"label": "Released", "tone": "grey", "icon": "unlock"},
    "rejected": {"label": "Rejected", "tone": "red", "icon": "x"},
    "flagged": {"label": "Flagged", "tone": "red", "icon": "flag"},
}

REQUEST_STEPS = ["requested", "scrutiny", "verification", "authority", "closed"]


def mask_number(value: str | None, keep: int = 4) -> str:
    if not value:
        return ""
    suffix = value[-keep:] if len(value) > keep else value
    return "••••" + suffix


def user_public(user: User) -> dict[str, Any]:
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "role": user.role,
        "institution_id": user.institution_id,
        "institution": user.institution.name if user.institution else None,
        "language": user.language or "en",
        "mfa_enabled": bool(user.mfa_enabled),
        "active": bool(user.active),
        "last_login_at": user.last_login_at.isoformat() + "Z" if user.last_login_at else None,
        "key_id": user.key_id,
    }


def instrument_brief(instrument: Instrument, *, reveal: bool = True) -> dict[str, Any]:
    decrypted_number = decrypt_field(instrument.fdr_number_enc) or ""
    days = (instrument.maturity_date - date.today()).days if instrument.maturity_date else None
    meta = STATUS_META.get(instrument.status, {"label": instrument.status, "tone": "slate", "icon": "circle"})
    return {
        "id": instrument.id,
        "reference": instrument.reference,
        "institution_id": instrument.institution_id,
        "institution": instrument.institution.name if instrument.institution else None,
        "institution_state": instrument.institution.state if instrument.institution else None,
        "bank": instrument.bank,
        "branch": instrument.branch,
        "fdr_number": decrypted_number if reveal else mask_number(decrypted_number),
        "amount": decrypt_number(instrument.amount_enc),
        "issue_date": instrument.issue_date.isoformat() if instrument.issue_date else None,
        "maturity_date": instrument.maturity_date.isoformat() if instrument.maturity_date else None,
        "days_to_maturity": days,
        "status": instrument.status,
        "status_label": meta["label"],
        "status_tone": meta["tone"],
        "trust_score": round(instrument.trust_score or 0),
        "trust_breakdown": instrument.trust_breakdown or {},
        "is_flagged": bool(instrument.is_flagged),
        "flag_reason": instrument.flag_reason,
        "parent_instrument_id": instrument.parent_instrument_id,
        "created_at": instrument.created_at.isoformat() + "Z" if instrument.created_at else None,
        "verified_at": instrument.verified_at.isoformat() + "Z" if instrument.verified_at else None,
        "released_at": instrument.released_at.isoformat() + "Z" if instrument.released_at else None,
    }


def document_public(document: Document, *, include_text: bool = False) -> dict[str, Any]:
    extraction = {}
    try:
        extraction = json.loads(decrypt_field(document.extraction_enc) or "{}")
    except Exception:
        extraction = {}
    data = {
        "id": document.id,
        "instrument_id": document.instrument_id,
        "original_name": document.original_name,
        "mime": document.mime,
        "size_bytes": document.size_bytes,
        "sha256": document.sha256,
        "version": document.version,
        "anomaly_score": document.anomaly_score,
        "overall_confidence": document.overall_confidence,
        "quality": document.quality_json or {},
        "uploaded_at": document.created_at.isoformat() + "Z" if document.created_at else None,
        "engine": extraction.get("engine"),
        "embedding_model": extraction.get("embedding_model"),
        "anomaly_reasons": extraction.get("anomaly_reasons", []),
        "duplicates": extraction.get("duplicates", []),
        "warnings": extraction.get("warnings", []),
        "text_length": extraction.get("text_length", 0),
    }
    if include_text:
        data["text_preview"] = extraction.get("text_preview", "")
        data["fields"] = extraction.get("fields", {})
    return data


def verification_public(verification: Verification) -> dict[str, Any]:
    return {
        "id": verification.id,
        "source": verification.source,
        "result": verification.result,
        "detail": verification.detail_json or {},
        "officer_id": verification.officer_id,
        "created_at": verification.created_at.isoformat() + "Z" if verification.created_at else None,
    }


def observation_public(observation: Observation, officer_name: str | None = None) -> dict[str, Any]:
    return {
        "id": observation.id,
        "remark": observation.remark,
        "clarification_requested": bool(observation.clarification_requested),
        "resolved": bool(observation.resolved),
        "officer": officer_name,
        "created_at": observation.created_at.isoformat() + "Z" if observation.created_at else None,
    }


def reminder_public(reminder: Reminder) -> dict[str, Any]:
    return {
        "id": reminder.id,
        "instrument_id": reminder.instrument_id,
        "reference": reminder.instrument.reference if reminder.instrument else None,
        "stage": reminder.stage,
        "channel": reminder.channel,
        "recipient_role": reminder.recipient_role,
        "sent_at": reminder.sent_at.isoformat() + "Z" if reminder.sent_at else None,
        "acknowledged": bool(reminder.acknowledged),
        "acknowledged_at": reminder.acknowledged_at.isoformat() + "Z" if reminder.acknowledged_at else None,
        "payload": reminder.payload_json or {},
    }


def request_public(request: ReleaseRequest, *, detail: bool = False) -> dict[str, Any]:
    instrument = request.instrument
    data = {
        "id": request.id,
        "instrument_id": request.instrument_id,
        "reference": instrument.reference if instrument else None,
        "bank": instrument.bank if instrument else None,
        "institution": instrument.institution.name if instrument and instrument.institution else None,
        "amount": decrypt_number(instrument.amount_enc) if instrument else 0,
        "type": request.type,
        "status": request.status,
        "reason": request.reason,
        "checklist": request.checklist or [],
        "decision": request.decision,
        "decision_reason": request.decision_reason,
        "signed_by": request.signed_by,
        "signature": request.signature,
        "created_at": request.created_at.isoformat() + "Z" if request.created_at else None,
        "updated_at": request.updated_at.isoformat() + "Z" if request.updated_at else None,
        "decided_at": request.decided_at.isoformat() + "Z" if request.decided_at else None,
        "closed_at": request.closed_at.isoformat() + "Z" if request.closed_at else None,
    }
    if detail:
        data["steps"] = [
            {
                "step": step.step,
                "status": step.status,
                "owner_id": step.owner_id,
                "note": step.note,
                "acted_at": step.acted_at.isoformat() + "Z" if step.acted_at else None,
            }
            for step in sorted(request.steps, key=lambda s: REQUEST_STEPS.index(s.step))
        ]
        data["steps_order"] = REQUEST_STEPS
    return data


def notification_public(notification: Notification) -> dict[str, Any]:
    return {
        "id": notification.id,
        "title": notification.title,
        "body": notification.body,
        "kind": notification.kind,
        "link": notification.link,
        "read": bool(notification.read),
        "created_at": notification.created_at.isoformat() + "Z" if notification.created_at else None,
    }


def instrument_detail(db: Session, instrument: Instrument, *, reveal: bool = True) -> dict[str, Any]:
    data = instrument_brief(instrument, reveal=reveal)
    data["documents"] = [
        document_public(document, include_text=True)
        for document in sorted(instrument.documents, key=lambda d: d.version, reverse=True)
    ]
    data["verifications"] = [verification_public(v) for v in instrument.verifications]
    officer_names = {
        user.id: user.name for user in db.query(User).filter(User.id.in_([o.officer_id for o in instrument.observations if o.officer_id])).all()
    } if instrument.observations else {}
    data["observations"] = [observation_public(o, officer_names.get(o.officer_id)) for o in instrument.observations]
    data["reminders"] = [
        reminder_public(r) for r in sorted(instrument.reminders, key=lambda r: r.sent_at or datetime.min, reverse=True)
    ]
    data["institution_detail"] = {
        "id": instrument.institution.id,
        "name": instrument.institution.name,
        "aicte_id": instrument.institution.aicte_id,
        "state": instrument.institution.state,
        "city": instrument.institution.city,
        "contact_email": instrument.institution.contact_email,
        "contact_phone": instrument.institution.contact_phone,
    } if instrument.institution else None
    return data
