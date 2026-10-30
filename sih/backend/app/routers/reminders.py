from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import audit, get_current_user, require_roles
from ..models import Instrument, Notification, Reminder, User
from ..serializers import notification_public, reminder_public
from ..services.scheduler import run_cycle

router = APIRouter(prefix="/api", tags=["reminders"])


@router.get("/reminders")
def list_reminders(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    query = db.query(Reminder)
    if user.role == "institution":
        query = query.join(Instrument).filter(Instrument.institution_id == user.institution_id)
    rows = query.order_by(Reminder.sent_at.desc()).limit(200).all()
    return {"items": [reminder_public(row) for row in rows], "total": len(rows)}


@router.post("/reminders/{reminder_id}/acknowledge")
def acknowledge_reminder(
    reminder_id: int,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    reminder = db.get(Reminder, reminder_id)
    if not reminder:
        raise HTTPException(404, detail={"code": "not_found", "message": "Reminder not found."})
    if user.role == "institution" and reminder.instrument.institution_id != user.institution_id:
        raise HTTPException(403, detail={"code": "forbidden", "message": "You cannot acknowledge this reminder."})
    reminder.acknowledged = True
    reminder.acknowledged_at = datetime.utcnow()
    db.commit()
    audit(db, user, "reminder.acknowledge", reminder.instrument.reference, f"stage={reminder.stage}", request)
    return {"ok": True}


@router.post("/reminders/run")
def run_now(
    request: Request,
    user: User = Depends(require_roles("admin", "scrutiny_officer")),
    db: Session = Depends(get_db),
):
    summary = run_cycle(db)
    audit(db, user, "scheduler.run", "reminders", str(summary), request)
    return summary


@router.get("/notifications")
def list_notifications(
    unread_only: bool = False,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(Notification).filter(Notification.user_id == user.id)
    if unread_only:
        query = query.filter(Notification.read.is_(False))
    rows = query.order_by(Notification.created_at.desc()).limit(100).all()
    unread = (
        db.query(Notification)
        .filter(Notification.user_id == user.id, Notification.read.is_(False))
        .count()
    )
    return {"items": [notification_public(row) for row in rows], "unread": unread}


@router.post("/notifications/{notification_id}/read")
def mark_read(notification_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.get(Notification, notification_id)
    if not row or row.user_id != user.id:
        raise HTTPException(404, detail={"code": "not_found", "message": "Notification not found."})
    row.read = True
    db.commit()
    return {"ok": True}


@router.post("/notifications/read-all")
def mark_all_read(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.query(Notification).filter(Notification.user_id == user.id, Notification.read.is_(False)).update(
        {"read": True}
    )
    db.commit()
    return {"ok": True}
