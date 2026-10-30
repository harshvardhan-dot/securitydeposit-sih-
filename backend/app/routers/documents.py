from __future__ import annotations

import json
from datetime import datetime
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import audit, client_ip, get_current_user
from ..ledger import append_block
from ..models import Document, DocumentAccess, Instrument, User
from ..security import decrypt_field, encrypt_field, normalize_number, sha256_hex
from ..serializers import document_public
from ..services import bert
from ..services.extraction import analyze_document, bank_pattern_anomaly, find_duplicates
from ..services.storage import load_decrypted, read_validated_upload, store_encrypted, verify_integrity

router = APIRouter(prefix="/api/documents", tags=["documents"])


def _can_access(user: User, document: Document) -> bool:
    if user.role in ("scrutiny_officer", "verification_officer", "competent_authority", "admin", "auditor"):
        return True
    instrument = document.instrument
    return bool(instrument and instrument.institution_id == user.institution_id)


@router.post("/upload")
async def upload_document(
    request: Request,
    file: UploadFile = File(...),
    instrument_id: int | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    data, mime, filename = await read_validated_upload(file)
    digest = sha256_hex(data)

    existing = db.query(Document).filter(Document.sha256 == digest).first()
    if existing:
        raise HTTPException(
            409,
            detail={
                "code": "same_file",
                "message": "This exact file was already uploaded. If you meant to renew, use the Renew action on the existing FDR.",
                "document_id": existing.id,
                "instrument_id": existing.instrument_id,
            },
        )

    storage_path = store_encrypted(data, digest)

    analysis = analyze_document(data, mime)
    fdr_value = analysis["fields"].get("fdr_number", {}).get("value")
    fdr_hash = sha256_hex(normalize_number(fdr_value)) if fdr_value else None

    duplicates = find_duplicates(db, analysis["embedding"], fdr_hash)
    bank_check = bank_pattern_anomaly(db, analysis["fields"].get("bank", {}).get("value"), analysis["embedding"])

    anomaly = max(analysis["anomaly_score"], bank_check["score"])
    reasons = list(analysis["anomaly_reasons"])
    if bank_check["score"] >= 0.3:
        reasons.append(bank_check["note"])

    version = 1
    if instrument_id:
        count = db.query(Document).filter(Document.instrument_id == instrument_id).count()
        version = count + 1

    document = Document(
        instrument_id=instrument_id,
        original_name=filename,
        mime=mime,
        size_bytes=len(data),
        sha256=digest,
        storage_path=storage_path,
        ocr_text_enc=encrypt_field(analysis["text_preview"]),
        extraction_enc=encrypt_field(
            json.dumps(
                {
                    "fields": analysis["fields"],
                    "quality": analysis["quality"],
                    "warnings": analysis["warnings"],
                    "anomaly_reasons": reasons,
                    "engine": analysis["engine"],
                    "embedding_model": analysis["embedding_model"],
                    "text_preview": analysis["text_preview"],
                    "text_length": analysis["text_length"],
                    "missing_fields": analysis["missing_fields"],
                    "duplicates": duplicates,
                    "fdr_number_hash": fdr_hash,
                }
            )
        ),
        embedding_json=json.dumps(analysis["embedding"]),
        quality_json={
            **analysis["quality"],
            "bank_pattern": bank_check,
            "issues": analysis["quality"].get("issues", []),
        },
        anomaly_score=anomaly,
        overall_confidence=analysis["confidence"],
        version=version,
        uploaded_by=user.id,
    )
    db.add(document)
    db.commit()
    db.refresh(document)

    db.add(DocumentAccess(document_id=document.id, user_id=user.id, user_email=user.email,
                          action="upload", ip=client_ip(request)))
    db.commit()

    append_block(
        db,
        "document.uploaded",
        actor=user,
        instrument_id=instrument_id,
        document_hash=digest,
        payload={
            "document_id": document.id,
            "filename": filename,
            "mime": mime,
            "engine": analysis["engine"],
            "confidence": analysis["confidence"],
            "anomaly": anomaly,
            "duplicates": len(duplicates),
        },
    )
    audit(db, user, "document.upload", f"doc:{document.id}", filename, request)

    return {
        "document": document_public(document, include_text=True),
        "extraction": {
            "fields": analysis["fields"],
            "confidence": analysis["confidence"],
            "missing_fields": analysis["missing_fields"],
            "needs_manual_review": analysis["needs_manual_review"],
            "anomaly_reasons": reasons,
            "warnings": analysis["warnings"],
            "engine": analysis["engine"],
            "embedding_model": analysis["embedding_model"],
            "text_preview": analysis["text_preview"],
        },
        "quality": analysis["quality"],
        "anomaly_score": anomaly,
        "bank_pattern": bank_check,
        "duplicates": duplicates,
        "document_id": document.id,
    }


@router.get("/{document_id}")
def get_document(document_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    document = db.get(Document, document_id)
    if not document:
        raise HTTPException(404, detail={"code": "not_found", "message": "Document not found."})
    if not _can_access(user, document):
        raise HTTPException(403, detail={"code": "forbidden", "message": "You do not have access to this document."})
    return document_public(document, include_text=True)


@router.get("/{document_id}/download")
def download_document(
    document_id: int,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    document = db.get(Document, document_id)
    if not document:
        raise HTTPException(404, detail={"code": "not_found", "message": "Document not found."})
    if not _can_access(user, document):
        audit(db, user, "document.download", f"doc:{document_id}", "denied", request, allowed=False)
        raise HTTPException(403, detail={"code": "forbidden", "message": "You do not have access to this document."})

    data = load_decrypted(document)
    integrity_ok = verify_integrity(document, data)
    db.add(
        DocumentAccess(
            document_id=document.id,
            user_id=user.id,
            user_email=user.email,
            action="download",
            ip=client_ip(request),
        )
    )
    db.commit()
    audit(db, user, "document.download", f"doc:{document.id}", document.original_name, request)
    append_block(
        db, "document.retrieved", actor=user, instrument_id=document.instrument_id,
        document_hash=document.sha256, payload={"document_id": document.id, "integrity": integrity_ok},
    )

    headers = {
        "Content-Disposition": f"inline; filename*=UTF-8''{quote(document.original_name)}",
        "X-Document-Integrity": "valid" if integrity_ok else "failed",
        "Cache-Control": "no-store",
    }
    return Response(content=data, media_type=document.mime, headers=headers)


@router.get("/{document_id}/access-log")
def access_log(
    document_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    document = db.get(Document, document_id)
    if not document:
        raise HTTPException(404, detail={"code": "not_found", "message": "Document not found."})
    if not _can_access(user, document):
        raise HTTPException(403, detail={"code": "forbidden", "message": "You do not have access to this document."})
    entries = (
        db.query(DocumentAccess)
        .filter(DocumentAccess.document_id == document_id)
        .order_by(DocumentAccess.at.desc())
        .limit(100)
        .all()
    )
    return {
        "document_id": document_id,
        "entries": [
            {"action": e.action, "user": e.user_email, "ip": e.ip,
             "at": e.at.isoformat() + "Z" if e.at else None}
            for e in entries
        ],
    }


@router.get("/{document_id}/text")
def document_text(document_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    document = db.get(Document, document_id)
    if not document:
        raise HTTPException(404, detail={"code": "not_found", "message": "Document not found."})
    if not _can_access(user, document):
        raise HTTPException(403, detail={"code": "forbidden", "message": "You do not have access to this document."})
    return {
        "document_id": document_id,
        "text": decrypt_field(document.ocr_text_enc) or "",
        "engine": (document.quality_json or {}).get("engine"),
    }
