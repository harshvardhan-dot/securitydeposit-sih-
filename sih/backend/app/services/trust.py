"""FDR Trust Score (PRD 6.5). Advisory only - never a decision maker."""
from __future__ import annotations

from datetime import date
from typing import Any

from ..config import DEFAULT_TRUST_WEIGHTS


def score(weights: dict[str, float] | None = None, *, bank_verified: bool = False,
          document_quality: float = 0.0, extraction_confidence: float = 0.0,
          mismatch_count: int = 0, duplicate_similarity: float = 0.0,
          renewal_punctuality: float = 1.0, days_to_maturity: int | None = None) -> dict[str, Any]:
    w = {**DEFAULT_TRUST_WEIGHTS, **(weights or {})}
    breakdown: list[dict[str, Any]] = []

    def add(label: str, gained: float, possible: float, note: str = ""):
        breakdown.append({"label": label, "points": round(gained, 1), "possible": round(possible, 1), "note": note})

    bank_points = w["bank_verified"] if bank_verified else 0.0
    add("Bank verification", bank_points, w["bank_verified"],
        "Confirmed by the issuing branch" if bank_verified else "Awaiting bank confirmation")

    quality_points = w["document_quality"] * max(0.0, min(1.0, document_quality))
    add("Document quality", quality_points, w["document_quality"], "OCR/scan clarity")

    conf_points = w["extraction_confidence"] * max(0.0, min(1.0, extraction_confidence))
    add("Extraction confidence", conf_points, w["extraction_confidence"], "AI field confidence")

    penalty = min(w["mismatch_penalty"] * mismatch_count, w["mismatch_penalty"] * 3)
    add("Mismatches", -penalty, 0, f"{mismatch_count} field mismatch(es)")

    dup_penalty = w["duplicate_penalty"] * max(0.0, min(1.0, duplicate_similarity))
    add("Duplicate similarity", -dup_penalty, 0, "Similarity to existing instruments")

    renewal_points = w["renewal_punctuality"] * max(0.0, min(1.0, renewal_punctuality))
    add("Renewal punctuality", renewal_points, w["renewal_punctuality"], "Institution's history")

    if days_to_maturity is None:
        maturity_points = 0.0
    elif days_to_maturity < 0:
        maturity_points = 0.0
    elif days_to_maturity <= 7:
        maturity_points = w["days_to_maturity"] * 0.2
    elif days_to_maturity <= 30:
        maturity_points = w["days_to_maturity"] * 0.6
    else:
        maturity_points = w["days_to_maturity"]
    add("Days to maturity", maturity_points, w["days_to_maturity"],
        f"{days_to_maturity} day(s) remaining" if days_to_maturity is not None else "No maturity date")

    raw = 100 + sum(b["points"] for b in breakdown) - (
        w["bank_verified"] + w["document_quality"] + w["extraction_confidence"]
        + w["renewal_punctuality"] + w["days_to_maturity"]
    )
    total = max(0, min(100, round(raw)))
    band = "green" if total >= 75 else "amber" if total >= 50 else "red"
    return {"score": total, "band": band, "breakdown": breakdown}


def days_until(maturity: date | None, today: date | None = None) -> int | None:
    if not maturity:
        return None
    return (maturity - (today or date.today())).days
