"""Encrypted document storage (FR-5).

Files are encrypted with AES-256-GCM before they touch disk. The SHA-256 of the
plaintext is stored separately so integrity can be re-verified on retrieval.
"""
from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile

from ..config import ALLOWED_MIME, MAX_UPLOAD_MB, UPLOAD_DIR
from ..models import Document
from ..security import decrypt_bytes, encrypt_bytes, sha256_hex


async def read_validated_upload(file: UploadFile) -> tuple[bytes, str, str]:
    mime = (file.content_type or "").lower().split(";")[0]
    if mime == "image/jpg":
        mime = "image/jpeg"
    if mime not in ALLOWED_MIME:
        raise HTTPException(
            status_code=415,
            detail={
                "code": "unsupported_file",
                "message": "Please upload a PDF, JPG or PNG file. Other formats are not supported yet.",
            },
        )
    data = await file.read()
    if not data:
        raise HTTPException(
            status_code=400,
            detail={"code": "empty_file", "message": "That file looks empty. Please choose another file."},
        )
    if len(data) > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail={
                "code": "file_too_large",
                "message": f"Files must be under {MAX_UPLOAD_MB} MB. Try a smaller scan or compress the photo.",
            },
        )
    return data, mime, file.filename or "document"


def store_encrypted(data: bytes, sha256: str) -> str:
    name = f"{uuid.uuid4().hex}.bin"
    path = UPLOAD_DIR / name
    path.write_bytes(encrypt_bytes(data))
    return f"uploads/{name}"


def load_decrypted(document: Document) -> bytes:
    path = UPLOAD_DIR / Path(document.storage_path).name
    if not path.exists():
        raise HTTPException(
            status_code=410,
            detail={"code": "file_missing", "message": "The stored file could not be found."},
        )
    return decrypt_bytes(path.read_bytes())


def verify_integrity(document: Document, data: bytes) -> bool:
    return sha256_hex(data) == document.sha256
