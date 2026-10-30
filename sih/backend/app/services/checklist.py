"""Release / refund eligibility checklist (FR-19). Decision support only."""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from ..models import Document, Instrument, Observation, ReleaseRequest, Verification


def build_checklist(db: Session, instrument: Instrument, request: ReleaseRequest | None = None) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []

    documents = db.query(Document).filter(Document.instrument_id == instrument.id).all()
    readable = [d for d in documents if (d.text_length if hasattr(d, "text_length") else 0) or d.ocr_text_enc]
    items.append(
        {
            "key": "documents_complete",
            "label": "Supporting documents uploaded",
            "passed": len(documents) >= 1 and bool(readable),
            "detail": f"{len(documents)} document(s) on record"
            if documents
            else "No supporting document has been uploaded for this instrument.",
            "fix": "Upload the original FDR receipt and any supporting bank letter.",
        }
    )

    open_observations = (
        db.query(Observation)
        .filter(
            Observation.instrument_id == instrument.id,
            Observation.resolved.is_(False),
            Observation.clarification_requested.is_(True),
        )
        .count()
    )
    items.append(
        {
            "key": "no_open_discrepancy",
            "label": "No open discrepancy or clarification",
            "passed": open_observations == 0,
            "detail": "No pending clarifications."
            if open_observations == 0
            else f"{open_observations} clarification request(s) still open.",
            "fix": "Respond to the officer's clarification request first.",
        }
    )

    mismatches = (
        db.query(Verification)
        .filter(
            Verification.instrument_id == instrument.id,
            Verification.source == "bank",
            Verification.result == "mismatch",
        )
        .count()
    )
    items.append(
        {
            "key": "no_mismatch",
            "label": "No unresolved mismatch with bank records",
            "passed": mismatches == 0,
            "detail": "Bank records agree with the submitted details."
            if mismatches == 0
            else f"{mismatches} mismatch(es) recorded.",
            "fix": "Resolve the mismatch with the bank, then re-run verification.",
        }
    )

    confirmed = (
        db.query(Verification)
        .filter(
            Verification.instrument_id == instrument.id,
            Verification.source == "bank",
            Verification.result == "confirmed",
        )
        .count()
    )
    items.append(
        {
            "key": "bank_verified",
            "label": "Bank verification complete",
            "passed": confirmed > 0,
            "detail": "Confirmed by the issuing branch." if confirmed else "Bank confirmation is pending.",
            "fix": "Ask the verification officer to run bank confirmation.",
        }
    )

    items.append(
        {
            "key": "no_compliance_flag",
            "label": "No pending compliance flag",
            "passed": not instrument.is_flagged,
            "detail": "No compliance flag on this instrument."
            if not instrument.is_flagged
            else f"Flagged: {instrument.flag_reason or 'compliance issue'}",
            "fix": "Resolve the flagged compliance issue with the Regulation Bureau.",
        }
    )

    items.append(
        {
            "key": "conditions_recorded",
            "label": "Reason and conditions recorded",
            "passed": bool(request and (request.reason or "").strip()),
            "detail": "Reason recorded with the request."
            if request and (request.reason or "").strip()
            else "A written reason is required for the competent authority.",
            "fix": "Add a short reason describing why the deposit should be released.",
        }
    )

    return items


def checklist_summary(items: list[dict[str, Any]]) -> dict[str, Any]:
    passed = sum(1 for item in items if item["passed"])
    return {
        "items": items,
        "passed": passed,
        "total": len(items),
        "all_passed": passed == len(items),
    }
