"""Small shared helpers / payload models."""
from __future__ import annotations

from typing import Any

from .models import Instrument
from .security import decrypt_field, decrypt_number


def snapshot_instrument(instrument: Instrument) -> dict[str, Any]:
    """Plain, decrypted snapshot used for version history (FR-2)."""
    return {
        "reference": instrument.reference,
        "institution_id": instrument.institution_id,
        "fdr_number": decrypt_field(instrument.fdr_number_enc),
        "amount": decrypt_number(instrument.amount_enc),
        "bank": instrument.bank,
        "branch": instrument.branch,
        "issue_date": instrument.issue_date.isoformat() if instrument.issue_date else None,
        "maturity_date": instrument.maturity_date.isoformat() if instrument.maturity_date else None,
        "status": instrument.status,
        "trust_score": instrument.trust_score,
        "is_flagged": instrument.is_flagged,
        "flag_reason": instrument.flag_reason,
        "parent_instrument_id": instrument.parent_instrument_id,
    }
