from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import audit, get_current_user, require_roles
from ..ledger import chain_stats, heal_block, serialize_block, tamper_block, verify_chain
from ..models import LedgerBlock, User

router = APIRouter(prefix="/api/ledger", tags=["ledger"])


class TamperIn(BaseModel):
    idx: int | None = None


@router.get("/blocks")
def blocks(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=200),
    action: str | None = None,
    instrument_id: int | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(LedgerBlock)
    if action:
        query = query.filter(LedgerBlock.action.ilike(f"%{action}%"))
    if instrument_id:
        query = query.filter(LedgerBlock.instrument_id == instrument_id)
    total = query.count()
    rows = query.order_by(LedgerBlock.idx.desc()).offset((page - 1) * size).limit(size).all()
    return {
        "items": [serialize_block(row) for row in rows],
        "total": total,
        "page": page,
        "size": size,
        "pages": max(1, (total + size - 1) // size),
    }


@router.get("/verify")
def verify(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return verify_chain(db)


@router.get("/stats")
def stats(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from ..models import Document, Instrument, ReleaseRequest, Verification

    return {
        **chain_stats(db),
        "counts": {
            "instruments": db.query(Instrument).count(),
            "documents": db.query(Document).count(),
            "verifications": db.query(Verification).count(),
            "requests": db.query(ReleaseRequest).count(),
        },
    }


@router.post("/demo/tamper")
def demo_tamper(
    payload: TamperIn,
    request: Request,
    user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
):
    """Deliberately edit a sealed block so the integrity viewer can catch it."""
    target = payload.idx
    if target is None:
        row = db.query(LedgerBlock).filter(LedgerBlock.action.like("instrument.%")).order_by(LedgerBlock.idx.asc()).first()
        if not row:
            row = db.query(LedgerBlock).order_by(LedgerBlock.idx.asc()).first()
        if not row:
            raise HTTPException(400, detail={"code": "empty_chain", "message": "The ledger has no blocks yet."})
        target = row.idx
    result = tamper_block(db, target)
    if not result.get("ok"):
        raise HTTPException(404, detail={"code": "not_found", "message": result.get("message", "Block not found.")})
    audit(db, user, "ledger.demo_tamper", f"block:{target}", "tamper simulation", request)
    return {**result, "verification": verify_chain(db)}


@router.post("/demo/heal")
def demo_heal(
    request: Request,
    user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
):
    result = heal_block(db)
    audit(db, user, "ledger.demo_heal", "ledger", str(result), request)
    return {**result, "verification": verify_chain(db)}
