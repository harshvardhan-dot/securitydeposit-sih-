from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..ledger import serialize_block, verify_chain
from ..models import (
    Document,
    Instrument,
    Institution,
    LedgerBlock,
    ReleaseRequest,
    Reminder,
    User,
    Verification,
)
from ..security import decrypt_number
from ..serializers import instrument_brief
from ..services import bert
from ..services.extraction import _tesseract
from ..services.settings import reminder_ladder

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

TILE_GROUPS = {
    "active": ["active", "bank_confirmed"],
    "expiring": ["expiring"],
    "matured": ["matured"],
    "renewed": ["renewed"],
    "released": ["released"],
    "pending": ["submitted", "under_verification", "release_requested"],
    "flagged": ["flagged"],
}


def _scoped_instruments(user: User, db: Session) -> list[Instrument]:
    query = db.query(Instrument)
    if user.role == "institution":
        query = query.filter(Instrument.institution_id == user.institution_id)
    return query.all()


@router.get("/summary")
def summary(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    instruments = _scoped_instruments(user, db)
    today = date.today()

    tiles = []
    for key, statuses in TILE_GROUPS.items():
        rows = [row for row in instruments if row.status in statuses]
        if key == "flagged":
            rows = [row for row in instruments if row.is_flagged or row.status == "flagged"]
        tiles.append(
            {
                "key": key,
                "count": len(rows),
                "value": round(sum(decrypt_number(row.amount_enc) for row in rows), 2),
            }
        )

    total_value = round(sum(decrypt_number(row.amount_enc) for row in instruments), 2)
    green = sum(1 for row in instruments if (row.trust_score or 0) >= 75)
    amber = sum(1 for row in instruments if 50 <= (row.trust_score or 0) < 75)
    red = sum(1 for row in instruments if (row.trust_score or 0) < 50)

    # 6-month maturity forecast
    forecast = []
    for offset in range(6):
        month_start = (today.replace(day=1) + timedelta(days=31 * offset)).replace(day=1)
        next_month = (month_start + timedelta(days=32)).replace(day=1)
        rows = [row for row in instruments if row.maturity_date and month_start <= row.maturity_date < next_month]
        forecast.append(
            {
                "month": month_start.strftime("%b %Y"),
                "iso": month_start.isoformat(),
                "count": len(rows),
                "value": round(sum(decrypt_number(row.amount_enc) for row in rows), 2),
            }
        )

    # state distribution (maturity heat map)
    states: dict[str, dict] = defaultdict(lambda: {"count": 0, "value": 0.0, "flagged": 0, "expiring": 0})
    for row in instruments:
        state = (row.institution.state if row.institution else "Unknown") or "Unknown"
        states[state]["count"] += 1
        states[state]["value"] += decrypt_number(row.amount_enc)
        if row.is_flagged or row.status == "flagged":
            states[state]["flagged"] += 1
        if row.status in ("expiring", "matured"):
            states[state]["expiring"] += 1
    state_rows = [
        {"state": state, **{k: round(v, 2) if k == "value" else v for k, v in data.items()}}
        for state, data in states.items()
    ]
    state_rows.sort(key=lambda item: item["count"], reverse=True)

    institutions = {row.id: row for row in db.query(Institution).all()}
    late: dict[int, int] = defaultdict(int)
    for row in instruments:
        if row.status in ("matured", "flagged") or row.is_flagged:
            late[row.institution_id] += 1
    late_institutions = [
        {
            "institution_id": inst_id,
            "name": institutions[inst_id].name if inst_id in institutions else "Unknown",
            "state": institutions[inst_id].state if inst_id in institutions else None,
            "count": count,
        }
        for inst_id, count in sorted(late.items(), key=lambda kv: kv[1], reverse=True)[:6]
    ]

    # role-aware to-do list
    todo: list[dict] = []
    if user.role == "institution":
        for row in instruments:
            if row.status == "expiring" and row.maturity_date:
                todo.append(
                    {
                        "kind": "renew",
                        "title": f"Renew {row.bank} deposit",
                        "detail": f"{row.reference} matures in {(row.maturity_date - today).days} day(s)",
                        "instrument_id": row.id,
                        "urgency": "high" if (row.maturity_date - today).days <= 30 else "medium",
                    }
                )
            if row.is_flagged:
                todo.append(
                    {
                        "kind": "clarify",
                        "title": "Respond to AICTE clarification",
                        "detail": row.flag_reason or row.reference,
                        "instrument_id": row.id,
                        "urgency": "high",
                    }
                )
    else:
        pending = [row for row in instruments if row.status == "submitted"]
        flagged = [row for row in instruments if row.is_flagged or row.status == "flagged"]
        if pending:
            todo.append(
                {"kind": "review", "title": f"{len(pending)} submission(s) to scrutinise",
                 "detail": "New FDRs waiting for officer review", "urgency": "medium"}
            )
        if flagged:
            todo.append(
                {"kind": "review", "title": f"{len(flagged)} flagged case(s) need attention",
                 "detail": "Mismatches, duplicates or anomalies", "urgency": "high"}
            )
        open_requests = (
            db.query(ReleaseRequest).filter(ReleaseRequest.status.notin_(["closed", "rejected"])).count()
        )
        if open_requests:
            todo.append(
                {"kind": "requests", "title": f"{open_requests} release/refund request(s) in progress",
                 "detail": "Check the workflow queue", "urgency": "medium"}
            )

    recent = (
        db.query(LedgerBlock)
        .order_by(LedgerBlock.idx.desc())
        .limit(8)
        .all()
    )

    unread = 0
    from ..models import Notification

    unread = db.query(Notification).filter(Notification.user_id == user.id, Notification.read.is_(False)).count()

    reminders_due = (
        db.query(Reminder)
        .filter(Reminder.acknowledged.is_(False))
        .count()
    )

    documents = db.query(Document).count()
    open_clarifications = (
        db.query(Instrument)
        .filter(Instrument.status == "under_verification")
        .count()
    )

    return {
        "role": user.role,
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "tiles": tiles,
        "totals": {
            "instruments": len(instruments),
            "value": total_value,
            "institutions": len(institutions),
            "documents": documents,
            "open_clarifications": open_clarifications,
            "value_at_risk": round(
                sum(decrypt_number(row.amount_enc) for row in instruments
                    if row.is_flagged or row.status in ("matured", "flagged")), 2),
        },
        "trust": {"green": green, "amber": amber, "red": red},
        "forecast": forecast,
        "states": state_rows,
        "late_institutions": late_institutions,
        "todo": todo[:6],
        "recent_activity": [serialize_block(block) for block in recent],
        "chain": verify_chain(db),
        "notifications_unread": unread,
        "reminders_pending": reminders_due,
        "reminder_ladder": reminder_ladder(db),
        "ai": {
            "bert": bert.status(),
            "ocr": "tesseract-ocr" if _tesseract() is not None else "unavailable",
        },
    }


@router.get("/vault")
def vault(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Compact payload for the 3D vault: one glowing box per instrument."""
    instruments = _scoped_instruments(user, db)
    today = date.today()
    boxes = []
    for row in instruments[:160]:
        days = (row.maturity_date - today).days if row.maturity_date else None
        boxes.append(
            {
                "id": row.id,
                "reference": row.reference,
                "bank": row.bank,
                "status": row.status,
                "tone": "red" if (row.is_flagged or row.status in ("matured", "flagged"))
                else "amber" if row.status == "expiring"
                else "grey" if row.status in ("released", "renewed")
                else "green",
                "trust_score": round(row.trust_score or 0),
                "amount": decrypt_number(row.amount_enc),
                "days_to_maturity": days,
                "institution": row.institution.name if row.institution else None,
            }
        )
    return {"boxes": boxes, "total": len(instruments)}


@router.get("/forecast")
def forecast(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    instruments = _scoped_instruments(user, db)
    today = date.today()
    months = []
    for offset in range(12):
        start = (today.replace(day=1) + timedelta(days=31 * offset)).replace(day=1)
        end = (start + timedelta(days=32)).replace(day=1)
        rows = [row for row in instruments if row.maturity_date and start <= row.maturity_date < end]
        months.append(
            {
                "month": start.strftime("%b %Y"),
                "iso": start.isoformat(),
                "count": len(rows),
                "value": round(sum(decrypt_number(r.amount_enc) for r in rows), 2),
            }
        )
    return {"months": months}


@router.get("/review-queue")
def review_queue(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(Instrument).filter(
        or_(
            Instrument.status.in_(["submitted", "under_verification", "flagged"]),
            Instrument.is_flagged.is_(True),
        )
    )
    rows = query.all()
    rows.sort(key=lambda r: (r.trust_score or 0))
    return {"items": [instrument_brief(row) for row in rows], "total": len(rows)}
