from __future__ import annotations

from collections import defaultdict
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import audit, get_current_user, require_roles
from ..models import Instrument, Institution, User
from ..security import decrypt_number
from ..serializers import instrument_brief

router = APIRouter(prefix="/api/institutions", tags=["institutions"])


class InstitutionIn(BaseModel):
    name: str = Field(min_length=3, max_length=200)
    aicte_id: str = Field(min_length=4, max_length=40)
    state: str = Field(min_length=2, max_length=80)
    city: str | None = None
    contact_email: EmailStr | None = None
    contact_phone: str | None = None


@router.get("")
def list_institutions(
    q: str | None = None,
    state: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(Institution)
    if q:
        query = query.filter(Institution.name.ilike(f"%{q}%") | Institution.aicte_id.ilike(f"%{q}%"))
    if state:
        query = query.filter(Institution.state == state)
    institutions = query.order_by(Institution.name).all()

    stats: dict[int, dict] = defaultdict(lambda: {"count": 0, "value": 0.0, "flagged": 0, "active": 0})
    for instrument in db.query(Instrument).all():
        stats[instrument.institution_id]["count"] += 1
        stats[instrument.institution_id]["value"] += decrypt_number(instrument.amount_enc)
        if instrument.is_flagged or instrument.status == "flagged":
            stats[instrument.institution_id]["flagged"] += 1
        if instrument.status in ("active", "bank_confirmed", "expiring"):
            stats[instrument.institution_id]["active"] += 1

    return {
        "items": [
            {
                "id": inst.id,
                "name": inst.name,
                "aicte_id": inst.aicte_id,
                "state": inst.state,
                "city": inst.city,
                "contact_email": inst.contact_email,
                "contact_phone": inst.contact_phone,
                "instruments": stats[inst.id]["count"],
                "active": stats[inst.id]["active"],
                "flagged": stats[inst.id]["flagged"],
                "value": round(stats[inst.id]["value"], 2),
            }
            for inst in institutions
        ],
        "total": len(institutions),
    }


@router.get("/me")
def my_institution(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not user.institution_id:
        raise HTTPException(400, detail={"code": "no_institution", "message": "This account is not linked to an institution."})
    institution = db.get(Institution, user.institution_id)
    if not institution:
        raise HTTPException(404, detail={"code": "not_found", "message": "Institution not found."})
    instruments = db.query(Instrument).filter(Instrument.institution_id == institution.id).all()
    return {
        "institution": {
            "id": institution.id,
            "name": institution.name,
            "aicte_id": institution.aicte_id,
            "state": institution.state,
            "city": institution.city,
            "contact_email": institution.contact_email,
            "contact_phone": institution.contact_phone,
        },
        "summary": {
            "instruments": len(instruments),
            "value": round(sum(decrypt_number(i.amount_enc) for i in instruments), 2),
            "expiring": sum(1 for i in instruments if i.status == "expiring"),
            "flagged": sum(1 for i in instruments if i.is_flagged or i.status == "flagged"),
        },
    }


@router.get("/{institution_id}")
def get_institution(
    institution_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.role == "institution" and user.institution_id != institution_id:
        raise HTTPException(403, detail={"code": "forbidden", "message": "You can only view your own institution."})
    institution = db.get(Institution, institution_id)
    if not institution:
        raise HTTPException(404, detail={"code": "not_found", "message": "Institution not found."})
    instruments = (
        db.query(Instrument)
        .filter(Instrument.institution_id == institution_id)
        .order_by(Instrument.maturity_date.asc())
        .all()
    )
    today = date.today()
    return {
        "institution": {
            "id": institution.id,
            "name": institution.name,
            "aicte_id": institution.aicte_id,
            "state": institution.state,
            "city": institution.city,
            "contact_email": institution.contact_email,
            "contact_phone": institution.contact_phone,
        },
        "summary": {
            "instruments": len(instruments),
            "value": round(sum(decrypt_number(i.amount_enc) for i in instruments), 2),
            "expiring": sum(1 for i in instruments if i.status == "expiring"),
            "matured": sum(1 for i in instruments if i.status == "matured"),
            "flagged": sum(1 for i in instruments if i.is_flagged or i.status == "flagged"),
            "renewal_punctuality": round(
                sum(1 for i in instruments if i.status in ("renewed", "released"))
                / max(1, sum(1 for i in instruments if i.status in ("renewed", "released", "matured"))),
                2,
            ),
        },
        "instruments": [instrument_brief(i) for i in instruments],
    }


@router.post("", status_code=201)
def create_institution(
    payload: InstitutionIn,
    request: Request,
    user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
):
    if db.query(Institution).filter(Institution.aicte_id == payload.aicte_id.upper()).first():
        raise HTTPException(409, detail={"code": "duplicate_aicte_id", "message": "An institution with that AICTE ID already exists."})
    institution = Institution(
        name=payload.name.strip(),
        aicte_id=payload.aicte_id.upper().strip(),
        state=payload.state.strip(),
        city=payload.city,
        contact_email=payload.contact_email,
        contact_phone=payload.contact_phone,
    )
    db.add(institution)
    db.commit()
    db.refresh(institution)
    audit(db, user, "institution.create", institution.aicte_id, institution.name, request)
    return {"id": institution.id, "name": institution.name, "aicte_id": institution.aicte_id}
