"""Runtime settings backed by the ``settings`` table (admin configurable)."""
from __future__ import annotations

from sqlalchemy.orm import Session

from ..config import DEFAULT_REMINDER_LADDER, DEFAULT_TRUST_WEIGHTS
from ..models import Setting


def get_setting(db: Session, key: str, default=None):
    row = db.get(Setting, key)
    return row.value_json if row and row.value_json is not None else default


def set_setting(db: Session, key: str, value):
    row = db.get(Setting, key)
    if row:
        row.value_json = value
    else:
        db.add(Setting(key=key, value_json=value))
    db.commit()
    return value


def reminder_ladder(db: Session) -> list[int]:
    ladder = get_setting(db, "reminder_ladder", DEFAULT_REMINDER_LADDER)
    try:
        return sorted({int(day) for day in ladder}, reverse=True)
    except Exception:
        return list(DEFAULT_REMINDER_LADDER)


def trust_weights(db: Session) -> dict[str, float]:
    return {**DEFAULT_TRUST_WEIGHTS, **(get_setting(db, "trust_weights", {}) or {})}


def escalation_rules(db: Session) -> dict[str, int]:
    return {
        "verification_overdue_days": int(get_setting(db, "verification_overdue_days", 3)),
        "clarification_overdue_days": int(get_setting(db, "clarification_overdue_days", 5)),
    }
