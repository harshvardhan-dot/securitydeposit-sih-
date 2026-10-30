"""Application configuration.

Secrets are read from the environment when available. For a zero-setup demo we
persist generated secrets to ``backend/data/secret.key`` so that JWTs, field
encryption and digital signatures survive a server restart.
"""
from __future__ import annotations

import os
import secrets
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.getenv("AICTE_DATA_DIR", BASE_DIR / "data"))
UPLOAD_DIR = DATA_DIR / "uploads"
SAMPLE_DIR = DATA_DIR / "samples"
for _d in (DATA_DIR, UPLOAD_DIR, SAMPLE_DIR):
    _d.mkdir(parents=True, exist_ok=True)


def _persistent_secret(name: str, env_var: str) -> str:
    value = os.getenv(env_var)
    if value:
        return value
    path = DATA_DIR / f"{name}.key"
    if path.exists():
        return path.read_text(encoding="utf-8").strip()
    value = secrets.token_hex(32)
    path.write_text(value, encoding="utf-8")
    return value


APP_NAME = "AICTE Security Deposit & FDR Management Portal"
VERSION = "1.0.0-prototype"
ENV = os.getenv("AICTE_ENV", "demo")

DATABASE_URL = os.getenv("AICTE_DATABASE_URL", f"sqlite:///{(DATA_DIR / 'aicte.db').as_posix()}")

JWT_SECRET = _persistent_secret("jwt", "AICTE_JWT_SECRET")
JWT_ALGORITHM = "HS256"
JWT_TTL_MINUTES = int(os.getenv("AICTE_JWT_TTL_MINUTES", "480"))

# 256-bit key for AES-256-GCM field/file encryption.
FIELD_KEY_HEX = _persistent_secret("field", "AICTE_FIELD_KEY")
# Independent key used for the prototype "digital signature" (HMAC-SHA256).
SIGNING_KEY_HEX = _persistent_secret("signing", "AICTE_SIGNING_KEY")

CORS_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "AICTE_CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173",
    ).split(",")
    if o.strip()
]

# Reminder ladder (days before maturity). FR-16, configurable at runtime via admin settings.
DEFAULT_REMINDER_LADDER = [90, 30, 7]

# Trust score weights (FR section 6.5) - advisory only, configurable.
DEFAULT_TRUST_WEIGHTS = {
    "bank_verified": 25,
    "document_quality": 15,
    "extraction_confidence": 20,
    "mismatch_penalty": 8,
    "duplicate_penalty": 20,
    "renewal_punctuality": 10,
    "days_to_maturity": 10,
}

MAX_UPLOAD_MB = int(os.getenv("AICTE_MAX_UPLOAD_MB", "12"))
ALLOWED_MIME = {
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/jpg",
    "image/webp",
}
