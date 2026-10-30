from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import audit, get_current_user, require_roles
from ..ledger import append_block
from ..models import Instrument, ReleaseRequest, RequestStep, User
from ..schemas import snapshot_instrument
from ..security import sign_with_user_key, verify_user_signature
from ..serializers import REQUEST_STEPS, request_public
from ..services import notifications
from ..services.checklist import build_checklist, checklist_summary

router = APIRouter(prefix="/api/requests", tags=["release-requests"])

STEP_OWNER = {
    "requested": "scrutiny_officer",
    "scrutiny": "verification_officer",
    "verification": "competent_authority",
    "authority": "competent_authority",
}
NEXT_STATUS = {
    "requested": "scrutiny",
    "scrutiny": "verification",
    "verification": "authority",
    "authority": "closed",
}


class RequestIn(BaseModel):
    instrument_id: int
    type: Literal["release", "refund"] = "release"
    reason: str = Field(min_length=5, max_length=2000)


class AdvanceIn(BaseModel):
    decision: Literal["approve", "reject", "advance"] = "advance"
    reason: str = Field(min_length=3, max_length=2000)
    signature_name: str = Field(min_length=2, max_length=160)


def _scoped(db: Session, user: User, request_id: int) -> ReleaseRequest:
    row = db.get(ReleaseRequest, request_id)
    if not row:
        raise HTTPException(404, detail={"code": "not_found", "message": "Request not found."})
    if user.role == "institution" and row.instrument.institution_id != user.institution_id:
        raise HTTPException(403, detail={"code": "forbidden", "message": "You can only view your own requests."})
    return row


@router.get("")
def list_requests(
    status: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(ReleaseRequest)
    if user.role == "institution":
        query = query.join(Instrument).filter(Instrument.institution_id == user.institution_id)
    if status:
        query = query.filter(ReleaseRequest.status.in_([s.strip() for s in status.split(",")]))
    rows = query.order_by(ReleaseRequest.created_at.desc()).all()
    return {"items": [request_public(row) for row in rows], "total": len(rows)}


@router.post("", status_code=201)
def create_request(
    payload: RequestIn,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.role not in ("institution", "admin"):
        raise HTTPException(403, detail={"code": "role_not_allowed", "message": "Only institution users can file a release or refund request."})
    instrument = db.get(Instrument, payload.instrument_id)
    if not instrument:
        raise HTTPException(404, detail={"code": "not_found", "message": "That FDR could not be found."})
    if user.role == "institution" and instrument.institution_id != user.institution_id:
        raise HTTPException(403, detail={"code": "forbidden", "message": "You can only file requests for your own institution."})
    if instrument.status in ("released", "renewed"):
        raise HTTPException(400, detail={"code": "closed", "message": f"This FDR is already {instrument.status}. No request is needed."})
    open_requests = (
        db.query(ReleaseRequest)
        .filter(ReleaseRequest.instrument_id == instrument.id, ReleaseRequest.status.notin_(["closed", "rejected"]))
        .count()
    )
    if open_requests:
        raise HTTPException(400, detail={"code": "request_open", "message": "There is already an open request for this FDR."})

    release_request = ReleaseRequest(
        instrument_id=instrument.id,
        type=payload.type,
        status="requested",
        reason=payload.reason,
        created_by=user.id,
    )
    db.add(release_request)
    db.flush()

    for step in REQUEST_STEPS:
        db.add(
            RequestStep(
                request_id=release_request.id,
                step=step,
                status="in_progress" if step == "requested" else "pending",
                owner_id=user.id if step == "requested" else None,
                acted_at=datetime.utcnow() if step == "requested" else None,
            )
        )

    checklist = build_checklist(db, instrument, release_request)
    release_request.checklist = checklist_summary(checklist)["items"]
    instrument.status = "release_requested"
    db.commit()
    db.refresh(release_request)

    append_block(
        db,
        "request.created",
        actor=user,
        instrument_id=instrument.id,
        payload={
            "request_id": release_request.id,
            "reference": instrument.reference,
            "type": payload.type,
            "reason": payload.reason,
            "checklist_passed": sum(1 for item in release_request.checklist if item["passed"]),
            "checklist_total": len(release_request.checklist),
        },
    )
    notifications.notify_officers(
        db,
        f"New {payload.type} request - {instrument.reference}",
        f"{instrument.institution.name if instrument.institution else 'Institution'} requested a {payload.type}.",
        "info",
        f"/requests/{release_request.id}",
    )
    db.commit()
    audit(db, user, "request.create", instrument.reference, payload.type, request)
    return request_public(release_request, detail=True)


@router.get("/{request_id}")
def get_request(request_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return request_public(_scoped(db, user, request_id), detail=True)


@router.post("/{request_id}/checklist/run")
def run_checklist(request_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    release_request = _scoped(db, user, request_id)
    items = build_checklist(db, release_request.instrument, release_request)
    summary = checklist_summary(items)
    release_request.checklist = summary["items"]
    db.commit()
    append_block(
        db, "request.checklist", actor=user, instrument_id=release_request.instrument_id,
        payload={"request_id": release_request.id, "passed": summary["passed"], "total": summary["total"],
                 "all_passed": summary["all_passed"]},
    )
    return summary


@router.post("/{request_id}/advance")
def advance_request(
    request_id: int,
    payload: AdvanceIn,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    release_request = _scoped(db, user, request_id)
    instrument = release_request.instrument

    if release_request.status in ("closed", "rejected"):
        raise HTTPException(400, detail={"code": "already_closed", "message": "This request is already closed."})

    required_role = STEP_OWNER.get(release_request.status)
    if user.role not in (required_role, "admin"):
        raise HTTPException(
            403,
            detail={
                "code": "wrong_step_owner",
                "message": f"This step belongs to the {required_role.replace('_', ' ') if required_role else 'next'} role.",
                "required_role": required_role,
            },
        )

    checklist = build_checklist(db, instrument, release_request)
    summary = checklist_summary(checklist)
    release_request.checklist = summary["items"]

    if payload.decision in ("approve", "advance") and not summary["all_passed"]:
        failed = [item["label"] for item in summary["items"] if not item["passed"]]
        db.commit()
        raise HTTPException(
            422,
            detail={
                "code": "checklist_failed",
                "message": "The eligibility checklist has not passed yet. Complete the failed items first.",
                "failed_items": failed,
            },
        )

    next_status = "rejected" if payload.decision == "reject" else NEXT_STATUS[release_request.status]

    signature_payload = {
        "request_id": release_request.id,
        "instrument": instrument.reference,
        "step": release_request.status,
        "next": next_status,
        "decision": payload.decision,
        "reason": payload.reason,
        "signer_id": user.id,
        "signer_name": payload.signature_name,
        "at": datetime.utcnow().isoformat(),
    }
    signature = sign_with_user_key(user.private_key_enc, signature_payload)

    current_step = next((s for s in release_request.steps if s.step == release_request.status), None)
    if current_step:
        current_step.status = "rejected" if payload.decision == "reject" else "completed"
        current_step.note = payload.reason
        current_step.owner_id = user.id
        current_step.acted_at = datetime.utcnow()

    release_request.status = next_status
    release_request.decision = payload.decision
    release_request.decision_reason = payload.reason
    release_request.signed_by = user.id
    release_request.signature = signature
    release_request.updated_at = datetime.utcnow()

    if next_status == "closed":
        instrument.status = "released"
        instrument.released_at = datetime.utcnow()
        release_request.closed_at = datetime.utcnow()
        release_request.decided_at = datetime.utcnow()
        notifications.notify_institution(
            db,
            instrument.institution_id,
            f"Deposit released - {instrument.reference}",
            f"Approved by {payload.signature_name}. {payload.reason}",
            "success",
            f"/instruments/{instrument.id}",
        )
    elif next_status == "rejected":
        instrument.status = "active" if (instrument.maturity_date and instrument.maturity_date > datetime.utcnow().date()) else "matured"
        release_request.decided_at = datetime.utcnow()
        release_request.closed_at = datetime.utcnow()
        notifications.notify_institution(
            db,
            instrument.institution_id,
            f"Request rejected - {instrument.reference}",
            payload.reason,
            "danger",
            f"/instruments/{instrument.id}",
        )
    else:
        step = next((s for s in release_request.steps if s.step == next_status), None)
        if step:
            step.status = "in_progress"
        notifications.notify_role(
            db,
            STEP_OWNER.get(next_status, "scrutiny_officer"),
            f"Request moved to {next_status} - {instrument.reference}",
            payload.reason,
            "info",
            f"/requests/{release_request.id}",
        )

    db.commit()
    append_block(
        db,
        f"request.{next_status}",
        actor=user,
        instrument_id=instrument.id,
        payload={
            "request_id": release_request.id,
            "reference": instrument.reference,
            "decision": payload.decision,
            "reason": payload.reason,
            "signed_by": payload.signature_name,
            "signature": signature,
            "instrument_snapshot": snapshot_instrument(instrument),
        },
    )
    audit(db, user, f"request.{next_status}", instrument.reference, payload.reason, request)

    return {
        "request": request_public(release_request, detail=True),
        "signature_valid": verify_user_signature(user.public_key, signature_payload, signature),
        "checklist": summary,
    }


@router.get("/{request_id}/signature")
def verify_request_signature(
    request_id: int,
    user: User = Depends(require_roles("competent_authority", "admin", "auditor")),
    db: Session = Depends(get_db),
):
    release_request = _scoped(db, user, request_id)
    signer = db.get(User, release_request.signed_by) if release_request.signed_by else None
    if not signer or not release_request.signature:
        return {"ok": False, "message": "This request has not been signed yet."}
    return {
        "ok": True,
        "signer": {"id": signer.id, "name": signer.name, "role": signer.role, "key_id": signer.key_id},
        "signature": release_request.signature,
        "algo": "Ed25519",
        "public_key": signer.public_key,
        "decision_reason": release_request.decision_reason,
        "signed_at": release_request.updated_at.isoformat() + "Z" if release_request.updated_at else None,
    }
