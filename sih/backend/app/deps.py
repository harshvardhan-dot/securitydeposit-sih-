"""FastAPI dependencies: authentication, RBAC, session timeout, audit."""
from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .database import get_db
from .models import AuditLog, User
from .security import decode_token

bearer = HTTPBearer(auto_error=False)

IDLE_TIMEOUT_MINUTES = 30


def _error(code: str, message: str, http_status: int = status.HTTP_400_BAD_REQUEST):
    return HTTPException(status_code=http_status, detail={"code": code, "message": message})


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None:
        raise _error("not_authenticated", "Please sign in to continue.", status.HTTP_401_UNAUTHORIZED)
    try:
        claims = decode_token(credentials.credentials)
    except Exception:
        raise _error("session_expired", "Your session has expired. Please sign in again.", status.HTTP_401_UNAUTHORIZED)

    user = db.get(User, int(claims.get("sub", 0)))
    if not user or not user.active:
        raise _error("account_inactive", "This account is not active. Contact the administrator.", status.HTTP_403_FORBIDDEN)

    now = datetime.utcnow()
    if user.last_seen_at and now - user.last_seen_at > timedelta(minutes=IDLE_TIMEOUT_MINUTES):
        raise _error("session_timeout", "You were signed out after 30 minutes of inactivity.", status.HTTP_401_UNAUTHORIZED)
    if not user.last_seen_at or (now - user.last_seen_at).total_seconds() > 30:
        user.last_seen_at = now
        db.commit()

    return user


def require_roles(*roles: str):
    def _checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise _error(
                "forbidden",
                "Your role does not have permission for this action.",
                status.HTTP_403_FORBIDDEN,
            )
        return user

    return _checker


def is_officer(user: User) -> bool:
    return user.role in {"scrutiny_officer", "verification_officer", "competent_authority", "admin", "auditor"}


def audit(
    db: Session,
    user: User | None,
    action: str,
    target: str = "",
    detail: str = "",
    request: Request | None = None,
    allowed: bool = True,
) -> None:
    db.add(
        AuditLog(
            user_id=getattr(user, "id", None),
            user_email=getattr(user, "email", None),
            action=action,
            target=target,
            detail=detail,
            ip=client_ip(request) if request else None,
            allowed=allowed,
        )
    )
    db.commit()
