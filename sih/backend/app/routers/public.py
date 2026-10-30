from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Instrument, LedgerBlock
from ..security import decrypt_field
from ..serializers import STATUS_META, mask_number

router = APIRouter(prefix="/api/public", tags=["public-tracker"])


@router.get("/track/{reference}")
def track(reference: str, db: Session = Depends(get_db)):
    """Public, courier-style status. No sensitive data and no documents."""
    instrument = db.query(Instrument).filter(Instrument.reference == reference.strip().upper()).first()
    if not instrument:
        raise HTTPException(
            404,
            detail={
                "code": "not_found",
                "message": "No application found for that reference ID. Please check the ID printed on your receipt.",
            },
        )

    bank_verification = next(
        (
            v
            for v in sorted(instrument.verifications, key=lambda v: v.created_at or datetime.min, reverse=True)
            if v.source == "bank"
        ),
        None,
    )
    meta = STATUS_META.get(instrument.status, {"label": instrument.status})
    maturity = instrument.maturity_date

    stages = [
        {"key": "received", "label": "Received", "done": True,
         "at": instrument.created_at.isoformat() + "Z" if instrument.created_at else None},
        {"key": "verification", "label": "Under verification",
         "done": instrument.status not in ("submitted",),
         "at": None},
        {"key": "bank", "label": "Bank confirmed",
         "done": bool(bank_verification and bank_verification.result == "confirmed"),
         "at": bank_verification.created_at.isoformat() + "Z" if bank_verification and bank_verification.created_at else None},
        {"key": "active", "label": "Active",
         "done": instrument.status in ("active", "expiring", "matured", "release_requested", "released", "renewed"),
         "at": instrument.verified_at.isoformat() + "Z" if instrument.verified_at else None},
        {"key": "renewal", "label": "Renewal due" if maturity else "Renewal",
         "done": instrument.status in ("expiring", "matured", "renewed", "released"),
         "at": None},
    ]

    events = (
        db.query(LedgerBlock)
        .filter(LedgerBlock.instrument_id == instrument.id)
        .order_by(LedgerBlock.idx.asc())
        .all()
    )

    return {
        "reference": instrument.reference,
        "status": instrument.status,
        "status_label": meta.get("label", instrument.status),
        "bank": instrument.bank,
        "fdr_number_masked": mask_number(decrypt_field(instrument.fdr_number_enc), keep=4),
        "maturity_date": maturity.isoformat() if maturity else None,
        "stages": stages,
        "last_update": instrument.updated_at.isoformat() + "Z" if instrument.updated_at else None,
        "events": [
            {
                "at": event.created_at.isoformat() + "Z",
                "action": event.action.replace(".", " ").title(),
            }
            for event in events
        ],
        "note": "This tracker shows status only. It never exposes documents, amounts or bank account details.",
    }


@router.get("/samples")
def sample_documents():
    """Synthetic FDR receipts so the wizard can be demoed without a real document."""
    from ..services.samples import ensure_samples

    items = ensure_samples()
    return {
        "items": [
            {
                "name": item["name"],
                "kind": item["kind"],
                "bank": item["bank"],
                "amount": item["amount"],
                "size_bytes": item["size_bytes"],
                "url": f"/api/public/samples/{item['name']}",
            }
            for item in items
        ]
    }


@router.get("/samples/{name}")
def sample_file(name: str):
    from fastapi.responses import Response

    from ..services.samples import ensure_samples

    allowed = {item["name"]: item for item in ensure_samples()}
    if name not in allowed:
        raise HTTPException(404, detail={"code": "not_found", "message": "Sample not found."})
    path = allowed[name]["path"]
    mime = "application/pdf" if name.endswith(".pdf") else "image/png"
    return Response(
        content=open(path, "rb").read(),
        media_type=mime,
        headers={"Content-Disposition": f'inline; filename="{name}"'},
    )


@router.get("/demo-accounts")
def demo_accounts():
    from ..config import ENV

    if ENV != "demo":
        raise HTTPException(404, detail={"code": "not_found", "message": "Not available."})
    password = "Aicte@2026"
    return {
        "password": password,
        "note": "Demo accounts. Officers must complete TOTP MFA - the current code is shown on the sign-in screen.",
        "accounts": [
            {"email": "principal@sunrise.edu", "role": "institution", "name": "Dr. Meera Joshi", "institution": "Sunrise Institute of Technology"},
            {"email": "dean@ganga.edu", "role": "institution", "name": "Prof. Rakesh Verma", "institution": "Ganga College of Engineering"},
            {"email": "scrutiny@aicte.gov.in", "role": "scrutiny_officer", "name": "A. K. Sharma", "institution": "AICTE Regulation Bureau"},
            {"email": "verify@aicte.gov.in", "role": "verification_officer", "name": "S. Nair", "institution": "AICTE Regulation Bureau"},
            {"email": "authority@aicte.gov.in", "role": "competent_authority", "name": "Dr. R. Iyer", "institution": "AICTE Regulation Bureau"},
            {"email": "admin@aicte.gov.in", "role": "admin", "name": "System Administrator", "institution": "AICTE"},
            {"email": "auditor@aicte.gov.in", "role": "auditor", "name": "Internal Auditor", "institution": "AICTE"},
        ],
    }
