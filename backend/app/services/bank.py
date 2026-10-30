"""Mock bank verification adapter (FR-12).

The interface is intentionally narrow so a real bank / NSDL / CKYC service can be
plugged in once AICTE has formal authorization. Set
``AICTE_BANK_ADAPTER=live`` and implement ``verify`` in a new class.
"""
from __future__ import annotations

import hashlib
from datetime import datetime

from ..models import Instrument


class BankVerificationAdapter:
    name = "adapter"

    def verify(self, instrument: Instrument, fdr_number: str, amount: float) -> dict:
        raise NotImplementedError


class MockBankAdapter(BankVerificationAdapter):
    """Deterministic simulation so demos behave predictably.

    A receipt is confirmed unless its number contains an explicit demo marker:
    ``FAIL`` produces an amount mismatch, ``404`` / ``NOTFOUND`` produces an
    untraceable receipt. This keeps the happy path reliable while still letting
    a presenter demonstrate the mismatch branch on demand.
    """

    name = "mock-bank-adapter-v1"

    def verify(self, instrument: Instrument, fdr_number: str, amount: float) -> dict:
        digest = hashlib.sha256((fdr_number or "").upper().encode()).hexdigest()
        marker = (fdr_number or "").upper()

        if "FAIL" in marker:
            return {
                "result": "mismatch",
                "bank_reference": f"BNK-{digest[:10].upper()}",
                "checked_at": datetime.utcnow().isoformat() + "Z",
                "bank_amount": round(amount * 0.9, 2),
                "bank_maturity": instrument.maturity_date.isoformat() if instrument.maturity_date else None,
                "notes": "Bank records show a different deposit amount for this receipt.",
                "adapter": self.name,
            }
        if "404" in marker or "NOTFOUND" in marker:
            return {
                "result": "not_found",
                "bank_reference": f"BNK-{digest[:10].upper()}",
                "checked_at": datetime.utcnow().isoformat() + "Z",
                "bank_amount": None,
                "bank_maturity": None,
                "notes": "The branch could not trace this receipt number in its records.",
                "adapter": self.name,
            }
        return {
            "result": "confirmed",
            "bank_reference": f"BNK-{digest[:10].upper()}",
            "checked_at": datetime.utcnow().isoformat() + "Z",
            "bank_amount": amount,
            "bank_maturity": instrument.maturity_date.isoformat() if instrument.maturity_date else None,
            "notes": "Receipt confirmed by the issuing branch. Amount and maturity agree.",
            "adapter": self.name,
        }


def get_adapter() -> BankVerificationAdapter:
    return MockBankAdapter()
