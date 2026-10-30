"""Application configuration.

Secrets are read from the environment when available. For a zero-setup demo we
persist generated secrets to ``backend/data/secret.key`` so that JWTs, field
encryption and digital signatures survive a server restart.
"""
from __future__ import annotations

import os
import secrets
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

# Automatically load environment variables from backend/.env or root .env
load_dotenv(BASE_DIR / ".env")
load_dotenv(BASE_DIR.parent / ".env")

# Use /tmp on Vercel/serverless environments where root filesystem is read-only
if os.getenv("VERCEL") or os.getenv("AWS_LAMBDA_FUNCTION_NAME"):
    DATA_DIR = Path(os.getenv("AICTE_DATA_DIR", "/tmp/aicte_data"))
else:
    DATA_DIR = Path(os.getenv("AICTE_DATA_DIR", BASE_DIR / "data"))

UPLOAD_DIR = DATA_DIR / "uploads"
SAMPLE_DIR = DATA_DIR / "samples"
for _d in (DATA_DIR, UPLOAD_DIR, SAMPLE_DIR):
    try:
        _d.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass


def _persistent_secret(name: str, env_var: str) -> str:
    value = os.getenv(env_var)
    if value:
        return value
    path = DATA_DIR / f"{name}.key"
    if path.exists():
        try:
            return path.read_text(encoding="utf-8").strip()
        except Exception:
            pass
    value = secrets.token_hex(32)
    try:
        path.write_text(value, encoding="utf-8")
    except Exception:
        pass
    return value


APP_NAME = "AICTE Security Deposit & FDR Management Portal"
VERSION = "1.0.0-prototype"
ENV = os.getenv("AICTE_ENV", "demo")

# Database URL resolution with Supabase / PostgreSQL support
raw_db_url = (
    os.getenv("SUPABASE_DB_URL")
    or os.getenv("DATABASE_URL")
    or os.getenv("AICTE_DATABASE_URL")
    or ""
).strip()

if not raw_db_url:
    DATABASE_URL = f"sqlite:///{(DATA_DIR / 'aicte.db').as_posix()}"
else:
    # Ensure standard SQLAlchemy dialect prefix for PostgreSQL / Supabase
    if raw_db_url.startswith("postgres://"):
        raw_db_url = raw_db_url.replace("postgres://", "postgresql+psycopg2://", 1)
    elif raw_db_url.startswith("postgresql://") and not raw_db_url.startswith("postgresql+"):
        raw_db_url = raw_db_url.replace("postgresql://", "postgresql+psycopg2://", 1)
    DATABASE_URL = raw_db_url

# Supabase API credentials
SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
SUPABASE_KEY = (
    os.getenv("SUPABASE_KEY")
    or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    or os.getenv("SUPABASE_ANON_KEY")
    or ""
).strip()

JWT_SECRET = _persistent_secret("jwt", "AICTE_JWT_SECRET")
JWT_ALGORITHM = "HS256"
JWT_TTL_MINUTES = int(os.getenv("AICTE_JWT_TTL_MINUTES", "480"))

# 256-bit key for AES-256-GCM field/file encryption.
FIELD_KEY_HEX = _persistent_secret("field", "AICTE_FIELD_KEY")
# Independent key used for the prototype "digital signature" (HMAC-SHA256).
SIGNING_KEY_HEX = _persistent_secret("signing", "AICTE_SIGNING_KEY")

DEFAULT_CORS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
]
custom_cors = [
    o.strip()
    for o in os.getenv("AICTE_CORS_ORIGINS", "").split(",")
    if o.strip()
]
CORS_ORIGINS = list(dict.fromkeys(DEFAULT_CORS + custom_cors))

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
