"""Reminder ladder, status refresh and escalation (FR-15 to FR-17, FR-23).

Runs as an in-process periodic task (and on demand from the admin UI), so the
demo needs no Redis/Celery. The function is idempotent: re-running never
duplicates a reminder for the same instrument and stage.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta

from sqlalchemy.orm import Session

from ..models import Instrument, Observation, Reminder, ReleaseRequest
from . import notifications
from .scoring import recalculate
from .settings import escalation_rules, reminder_ladder

CONTACT_STAGE_CHANNELS = {
    90: ["in_app", "email"],
    30: ["in_app", "email", "sms", "whatsapp"],
    7: ["in_app", "email", "sms"],
    0: ["in_app", "email"],
}


def _already_sent(db: Session, instrument_id: int, stage: int) -> bool:
    return (
        db.query(Reminder)
        .filter(Reminder.instrument_id == instrument_id, Reminder.stage == stage)
        .count()
        > 0
    )


def _send(db: Session, instrument: Instrument, stage: int, days: int) -> int:
    if _already_sent(db, instrument.id, stage):
        return 0
    created = 0
    channels = CONTACT_STAGE_CHANNELS.get(stage, ["in_app"])
    for channel in channels:
        if stage == 0:
            recipient_role = "competent_authority"
        elif stage == 7:
            recipient_role = "scrutiny_officer"
        else:
            recipient_role = "institution"
        db.add(
            Reminder(
                instrument_id=instrument.id,
                stage=stage,
                channel=channel,
                recipient_role=recipient_role,
                payload_json={
                    "reference": instrument.reference,
                    "bank": instrument.bank,
                    "maturity_date": instrument.maturity_date.isoformat() if instrument.maturity_date else None,
                    "days_left": days,
                },
            )
        )
        created += 1

    if stage == 0:
        title = f"Deposit expired - {instrument.reference}"
        body = (
            f"The deposit at {instrument.bank} has expired and has not been renewed. "
            "Escalated to the competent authority."
        )
        notifications.notify_role(db, "competent_authority", title, body, "danger", f"/instruments/{instrument.id}")
        notifications.notify_institution(db, instrument.institution_id, title, body, "danger", f"/instruments/{instrument.id}")
    elif stage == 7:
        title = f"Renewal due in {days} day(s) - {instrument.reference}"
        body = f"{instrument.bank} deposit matures on {instrument.maturity_date}. Regional officer alert."
        notifications.notify_officers(db, title, body, "warning", f"/instruments/{instrument.id}")
        notifications.notify_institution(db, instrument.institution_id, title, body, "warning", f"/instruments/{instrument.id}")
    else:
        title = f"Renewal reminder - {instrument.reference}"
        body = f"Your {instrument.bank} deposit matures on {instrument.maturity_date} ({days} days left)."
        notifications.notify_institution(db, instrument.institution_id, title, body, "info", f"/instruments/{instrument.id}")
    return created


def run_cycle(db: Session, *, today: date | None = None) -> dict:
    today = today or date.today()
    ladder = reminder_ladder(db)
    rules = escalation_rules(db)
    reminders_created = 0
    status_changes = 0
    escalations = 0

    instruments = (
        db.query(Instrument)
        .filter(Instrument.status.notin_(["released", "renewed", "rejected"]))
        .all()
    )

    for instrument in instruments:
        days = (instrument.maturity_date - today).days if instrument.maturity_date else None
        if days is None:
            continue

        # --- status refresh
        new_status = instrument.status
        if days < 0 and instrument.status not in ("matured", "release_requested"):
            new_status = "matured"
        elif 0 <= days <= 90 and instrument.status == "active":
            new_status = "expiring"
        elif days > 90 and instrument.status == "expiring":
            new_status = "active"
        if new_status != instrument.status:
            instrument.status = new_status
            status_changes += 1

        # --- reminder ladder
        for stage in ladder:
            if days <= stage and (stage == 0 or days >= 0):
                reminders_created += _send(db, instrument, stage, days)

        if days < 0:
            reminders_created += _send(db, instrument, 0, days)

        recalculate(db, instrument, commit=False)

    # --- escalation: verification overdue
    cutoff = datetime.utcnow() - timedelta(days=rules["verification_overdue_days"])
    overdue = (
        db.query(Instrument)
        .filter(Instrument.status.in_(["submitted", "under_verification"]), Instrument.created_at < cutoff)
        .count()
    )
    if overdue:
        notifications.notify_officers(
            db,
            f"{overdue} submission(s) awaiting verification",
            "These submissions have crossed the verification SLA and need attention.",
            "warning",
            "/review",
        )
        escalations += 1

    # --- escalation: unanswered clarification
    clarification_cutoff = datetime.utcnow() - timedelta(days=rules["clarification_overdue_days"])
    stale = (
        db.query(Observation)
        .filter(
            Observation.clarification_requested.is_(True),
            Observation.resolved.is_(False),
            Observation.created_at < clarification_cutoff,
        )
        .count()
    )
    if stale:
        notifications.notify_role(
            db,
            "scrutiny_officer",
            f"{stale} clarification(s) unanswered",
            "Institutions have not responded within the escalation window.",
            "warning",
            "/review",
        )
        escalations += 1

    # --- escalation: release requests waiting too long
    pending_requests = (
        db.query(ReleaseRequest)
        .filter(ReleaseRequest.status.in_(["requested", "scrutiny", "verification"]),
                ReleaseRequest.updated_at < cutoff)
        .count()
    )
    if pending_requests:
        notifications.notify_role(
            db,
            "competent_authority",
            f"{pending_requests} release/refund request(s) pending",
            "Requests have crossed the SLA for their current step.",
            "warning",
            "/requests",
        )
        escalations += 1

    db.commit()
    return {
        "ran_at": datetime.utcnow().isoformat() + "Z",
        "instruments_checked": len(instruments),
        "reminders_created": reminders_created,
        "status_changes": status_changes,
        "escalations": escalations,
        "ladder": ladder,
    }
