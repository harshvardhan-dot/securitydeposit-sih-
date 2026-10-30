"""In-app notification fan-out (FR-22). Email/SMS/WhatsApp gateways are mocked:
each send is recorded so the demo can show the full ladder without real gateways.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from ..models import Notification, User


def notify(db: Session, user_id: int, title: str, body: str, kind: str = "info", link: str | None = None):
    db.add(Notification(user_id=user_id, title=title, body=body, kind=kind, link=link))


def notify_role(db: Session, role: str, title: str, body: str, kind: str = "info", link: str | None = None):
    for user in db.query(User).filter(User.role == role, User.active.is_(True)).all():
        notify(db, user.id, title, body, kind, link)


def notify_institution(db: Session, institution_id: int, title: str, body: str, kind: str = "info", link: str | None = None):
    for user in (
        db.query(User)
        .filter(User.institution_id == institution_id, User.active.is_(True))
        .all()
    ):
        notify(db, user.id, title, body, kind, link)


def notify_officers(db: Session, title: str, body: str, kind: str = "info", link: str | None = None):
    for role in ("scrutiny_officer", "verification_officer", "competent_authority"):
        notify_role(db, role, title, body, kind, link)
