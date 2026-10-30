"""Trust score recalculation (kept separate so routers and the scheduler share it)."""
from __future__ import annotations

import json
from datetime import date

from sqlalchemy.orm import Session

from ..models import Document, Instrument, Verification
from ..security import decrypt_field
from . import trust
from .settings import trust_weights


def _duplicate_similarity(document: Document | None) -> float:
    if not document or not document.extraction_enc:
        return 0.0
    try:
        extraction = json.loads(decrypt_field(document.extraction_enc) or "{}")
    except Exception:
        return 0.0
    duplicates = extraction.get("duplicates") or []
    return max([float(d.get("similarity") or 0) for d in duplicates], default=0.0)


def _renewal_punctuality(db: Session, instrument: Instrument) -> float:
    history = (
        db.query(Instrument)
        .filter(
            Instrument.institution_id == instrument.institution_id,
            Instrument.id != instrument.id,
            Instrument.status.in_(["renewed", "matured", "released"]),
        )
        .all()
    )
    if not history:
        return 1.0
    on_time = sum(1 for row in history if row.status in ("renewed", "released"))
    return round(on_time / len(history), 2)


def recalculate(db: Session, instrument: Instrument, commit: bool = True) -> dict:
    documents = (
        db.query(Document)
        .filter(Document.instrument_id == instrument.id)
        .order_by(Document.version.desc())
        .all()
    )
    latest = documents[0] if documents else None
    mismatches = (
        db.query(Verification)
        .filter(Verification.instrument_id == instrument.id, Verification.result == "mismatch")
        .count()
    )
    bank_verified = (
        db.query(Verification)
        .filter(
            Verification.instrument_id == instrument.id,
            Verification.source == "bank",
            Verification.result == "confirmed",
        )
        .count()
        > 0
    )
    days = (instrument.maturity_date - date.today()).days if instrument.maturity_date else None

    result = trust.score(
        trust_weights(db),
        bank_verified=bank_verified,
        document_quality=float(latest.quality_json.get("score", 0)) if latest else 0.0,
        extraction_confidence=float(latest.overall_confidence or 0) if latest else 0.0,
        mismatch_count=mismatches,
        duplicate_similarity=_duplicate_similarity(latest),
        renewal_punctuality=_renewal_punctuality(db, instrument),
        days_to_maturity=days,
    )
    instrument.trust_score = result["score"]
    instrument.trust_breakdown = result
    if commit:
        db.commit()
    return result
