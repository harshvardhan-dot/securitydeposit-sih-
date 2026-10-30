"""SQLAlchemy models.

Security notes (PRD section 7):
* ``*_enc`` columns hold AES-256-GCM ciphertext, never plaintext.
* Non-reversible SHA-256 digests are used for duplicate matching so the
  canonical FDR number is never needed in clear text to detect duplicates.
* The ledger stores only document hashes, never document contents.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import relationship

from .database import Base

ROLES = [
    "institution",
    "scrutiny_officer",
    "verification_officer",
    "competent_authority",
    "admin",
    "auditor",
]

OFFICER_ROLES = ["scrutiny_officer", "verification_officer", "competent_authority"]

INSTRUMENT_STATUSES = [
    "submitted",
    "under_verification",
    "bank_confirmed",
    "active",
    "expiring",
    "matured",
    "renewed",
    "release_requested",
    "released",
    "rejected",
    "flagged",
]


def utcnow() -> datetime:
    return datetime.utcnow()


class Institution(Base):
    __tablename__ = "institutions"

    id = Column(Integer, primary_key=True)
    name = Column(String(200), nullable=False)
    aicte_id = Column(String(40), unique=True, nullable=False, index=True)
    state = Column(String(80), nullable=False, index=True)
    city = Column(String(80))
    contact_email = Column(String(200))
    contact_phone = Column(String(40))
    created_at = Column(DateTime, default=utcnow)

    instruments = relationship("Instrument", back_populates="institution")


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    email = Column(String(200), unique=True, nullable=False, index=True)
    name = Column(String(160), nullable=False)
    role = Column(String(40), nullable=False, index=True)
    institution_id = Column(Integer, ForeignKey("institutions.id"), nullable=True, index=True)
    password_hash = Column(String(255), nullable=False)
    language = Column(String(10), default="en")
    phone = Column(String(40))

    # MFA (mandatory for officers in the PRD)
    mfa_enabled = Column(Boolean, default=False)
    mfa_secret_enc = Column(Text)  # AES-256-GCM

    # Per-user Ed25519 signing identity (FR-21). Private key sealed with AES-256-GCM.
    public_key = Column(Text)
    private_key_enc = Column(Text)
    key_id = Column(String(40))

    active = Column(Boolean, default=True)
    failed_logins = Column(Integer, default=0)
    locked_until = Column(DateTime)
    last_login_at = Column(DateTime)
    last_seen_at = Column(DateTime)
    created_at = Column(DateTime, default=utcnow)

    institution = relationship("Institution")


class Instrument(Base):
    __tablename__ = "instruments"

    id = Column(Integer, primary_key=True)
    reference = Column(String(32), unique=True, index=True)  # public tracking id
    institution_id = Column(Integer, ForeignKey("institutions.id"), nullable=False, index=True)

    # field-level encryption (AES-256-GCM)
    fdr_number_enc = Column(Text, nullable=False)
    fdr_number_hash = Column(String(64), index=True)  # SHA-256, duplicate detection
    amount_enc = Column(Text, nullable=False)

    bank = Column(String(140), index=True)
    branch = Column(String(180))
    issue_date = Column(Date)
    maturity_date = Column(Date, index=True)
    status = Column(String(30), default="submitted", index=True)
    trust_score = Column(Float, default=0.0)
    trust_breakdown = Column(JSON, default=dict)

    parent_instrument_id = Column(Integer, ForeignKey("instruments.id"), nullable=True)
    last_reminder_stage = Column(Integer, default=0)
    is_flagged = Column(Boolean, default=False)
    flag_reason = Column(Text)
    verified_at = Column(DateTime)
    released_at = Column(DateTime)

    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    institution = relationship("Institution", back_populates="instruments")
    documents = relationship("Document", back_populates="instrument", cascade="all, delete-orphan")
    verifications = relationship("Verification", back_populates="instrument", cascade="all, delete-orphan")
    observations = relationship("Observation", back_populates="instrument", cascade="all, delete-orphan")
    reminders = relationship("Reminder", back_populates="instrument", cascade="all, delete-orphan")


class Document(Base):
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True)
    instrument_id = Column(Integer, ForeignKey("instruments.id"), nullable=True, index=True)
    original_name = Column(String(255), nullable=False)
    mime = Column(String(80), nullable=False)
    size_bytes = Column(Integer, default=0)
    sha256 = Column(String(64), index=True)
    storage_path = Column(String(400), nullable=False)
    # AES-256-GCM: OCR text and extracted fields contain amounts and account numbers
    ocr_text_enc = Column(Text)
    extraction_enc = Column(Text)
    embedding_json = Column(Text)  # non-reversible 256-d vector
    quality_json = Column(JSON, default=dict)
    anomaly_score = Column(Float, default=0.0)
    overall_confidence = Column(Float, default=0.0)
    version = Column(Integer, default=1)
    uploaded_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=utcnow)

    instrument = relationship("Instrument", back_populates="documents")


class DocumentAccess(Base):
    """FR-5 retrieval history."""

    __tablename__ = "document_access"

    id = Column(Integer, primary_key=True)
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    user_email = Column(String(200))
    action = Column(String(40))
    ip = Column(String(64))
    at = Column(DateTime, default=utcnow)


class Verification(Base):
    __tablename__ = "verifications"

    id = Column(Integer, primary_key=True)
    instrument_id = Column(Integer, ForeignKey("instruments.id"), nullable=False, index=True)
    source = Column(String(20))  # institution | bank | officer
    result = Column(String(30))  # match | mismatch | confirmed | failed
    detail_json = Column(JSON, default=dict)
    officer_id = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=utcnow)

    instrument = relationship("Instrument", back_populates="verifications")


class ReleaseRequest(Base):
    __tablename__ = "requests"

    id = Column(Integer, primary_key=True)
    instrument_id = Column(Integer, ForeignKey("instruments.id"), nullable=False, index=True)
    type = Column(String(20), default="release")  # release | refund
    status = Column(String(30), default="requested", index=True)
    reason = Column(Text)
    checklist = Column(JSON, default=list)
    decision = Column(String(20))
    decision_reason = Column(Text)
    signed_by = Column(Integer, ForeignKey("users.id"))
    signature = Column(Text)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)
    decided_at = Column(DateTime)
    closed_at = Column(DateTime)

    instrument = relationship("Instrument")
    steps = relationship("RequestStep", back_populates="release_request", cascade="all, delete-orphan")


class RequestStep(Base):
    __tablename__ = "request_steps"

    id = Column(Integer, primary_key=True)
    request_id = Column(Integer, ForeignKey("requests.id"), nullable=False, index=True)
    step = Column(String(30))  # requested | scrutiny | verification | authority | closed
    status = Column(String(20), default="pending")
    owner_id = Column(Integer, ForeignKey("users.id"))
    note = Column(Text)
    acted_at = Column(DateTime)

    release_request = relationship("ReleaseRequest", back_populates="steps")


class Reminder(Base):
    __tablename__ = "reminders"

    id = Column(Integer, primary_key=True)
    instrument_id = Column(Integer, ForeignKey("instruments.id"), nullable=False, index=True)
    stage = Column(Integer)  # 90 | 30 | 7 | 0 (expired)
    channel = Column(String(20))
    recipient_role = Column(String(40))
    payload_json = Column(JSON, default=dict)
    sent_at = Column(DateTime, default=utcnow)
    acknowledged = Column(Boolean, default=False)
    acknowledged_at = Column(DateTime)

    instrument = relationship("Instrument", back_populates="reminders")


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    title = Column(String(200))
    body = Column(Text)
    kind = Column(String(30), default="info")
    link = Column(String(200))
    read = Column(Boolean, default=False)
    created_at = Column(DateTime, default=utcnow)


class Observation(Base):
    __tablename__ = "observations"

    id = Column(Integer, primary_key=True)
    instrument_id = Column(Integer, ForeignKey("instruments.id"), nullable=False, index=True)
    officer_id = Column(Integer, ForeignKey("users.id"))
    remark = Column(Text, nullable=False)
    clarification_requested = Column(Boolean, default=False)
    resolved = Column(Boolean, default=False)
    created_at = Column(DateTime, default=utcnow)

    instrument = relationship("Instrument", back_populates="observations")


class LedgerBlock(Base):
    """SHA-256 hash chain. Only hashes and metadata; never document content."""

    __tablename__ = "ledger_blocks"

    id = Column(Integer, primary_key=True)
    idx = Column(Integer, unique=True, index=True, nullable=False)
    action = Column(String(60), nullable=False)
    actor_id = Column(Integer)
    actor_name = Column(String(160))
    actor_role = Column(String(40))
    instrument_id = Column(Integer, index=True)
    document_hash = Column(String(64))
    payload_json = Column(JSON, default=dict)
    prev_hash = Column(String(64), nullable=False)
    hash = Column(String(64), nullable=False, index=True)
    signature = Column(Text)
    signer_pubkey = Column(Text)
    key_id = Column(String(40))
    algo = Column(String(30), default="Ed25519")
    created_at = Column(DateTime, default=utcnow, index=True)


class LedgerBackup(Base):
    """Used only by the tamper-detection demo to restore a block."""

    __tablename__ = "ledger_backup"

    id = Column(Integer, primary_key=True)
    block_idx = Column(Integer, unique=True)
    payload_json = Column(JSON)
    created_at = Column(DateTime, default=utcnow)


class RecordVersion(Base):
    """FR-2: full version history of every record change."""

    __tablename__ = "record_versions"

    id = Column(Integer, primary_key=True)
    entity = Column(String(40), nullable=False, index=True)
    entity_id = Column(Integer, nullable=False, index=True)
    version = Column(Integer, default=1)
    snapshot_json = Column(JSON, default=dict)
    changed_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=utcnow)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer)
    user_email = Column(String(200))
    action = Column(String(80), index=True)
    target = Column(String(120))
    detail = Column(Text)
    ip = Column(String(64))
    allowed = Column(Boolean, default=True)
    at = Column(DateTime, default=utcnow, index=True)


class Setting(Base):
    __tablename__ = "settings"

    key = Column(String(60), primary_key=True)
    value_json = Column(JSON)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)
