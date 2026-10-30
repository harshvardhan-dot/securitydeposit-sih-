"""Cryptography helpers.

Implements the PRD security layers:

* Confidentiality  : AES-256-GCM field/file encryption + TLS 1.3 in transit
* Integrity        : SHA-256 hash chain (see ``ledger.py``)
* Authenticity     : Ed25519 digital signature per officer action
* Access           : JWT + RBAC + TOTP MFA for officers + idle session timeout
* Accountability   : every action is written to the append-only audit trail
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import struct
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .config import FIELD_KEY_HEX, JWT_ALGORITHM, JWT_SECRET, JWT_TTL_MINUTES, SIGNING_KEY_HEX

_FIELD_KEY = bytes.fromhex(FIELD_KEY_HEX)
_SIGNING_KEY = bytes.fromhex(SIGNING_KEY_HEX)
ENC_PREFIX = "enc:v1:"
KEY_ID = "k1"
_PBKDF2_ROUNDS = 260_000


# --------------------------------------------------------------------------- passwords
def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _PBKDF2_ROUNDS)
    return f"pbkdf2_sha256${_PBKDF2_ROUNDS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _algo, rounds, salt_hex, digest_hex = stored.split("$")
        digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(rounds))
        return hmac.compare_digest(digest.hex(), digest_hex)
    except Exception:
        return False


# --------------------------------------------------------------------------- AES-256-GCM
def encrypt_field(value: Any) -> str | None:
    """AES-256-GCM encrypt a value for storage at rest."""
    if value is None:
        return None
    plaintext = str(value).encode("utf-8")
    nonce = os.urandom(12)
    ciphertext = AESGCM(_FIELD_KEY).encrypt(nonce, plaintext, None)
    return ENC_PREFIX + base64.b64encode(nonce + ciphertext).decode("ascii")


def encrypt_bytes(data: bytes) -> bytes:
    nonce = os.urandom(12)
    return nonce + AESGCM(_FIELD_KEY).encrypt(nonce, data, None)


def decrypt_bytes(payload: bytes) -> bytes:
    return AESGCM(_FIELD_KEY).decrypt(payload[:12], payload[12:], None)


def decrypt_field(value: str | None) -> str | None:
    if value is None:
        return None
    if not str(value).startswith(ENC_PREFIX):
        return str(value)
    raw = base64.b64decode(str(value)[len(ENC_PREFIX):])
    plaintext = AESGCM(_FIELD_KEY).decrypt(raw[:12], raw[12:], None)
    return plaintext.decode("utf-8")


def decrypt_number(value: str | None, default: float = 0.0) -> float:
    try:
        return float(decrypt_field(value) or default)
    except (TypeError, ValueError):
        return default


# --------------------------------------------------------------------------- hashing / signatures
def sha256_hex(data: bytes | str) -> str:
    if isinstance(data, str):
        data = data.encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def normalize_number(value: str) -> str:
    """Normalise an FDR/FD number for duplicate matching."""
    return "".join(ch for ch in (value or "").upper() if ch.isalnum())


def sign_payload(payload: dict[str, Any]) -> str:
    """System-level signature (HMAC-SHA256) for automated/scheduler actions.

    Human actions are signed with the actor's Ed25519 key instead, so the
    signature proves *which* official acted (PRD FR-21).
    """
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hmac.new(_SIGNING_KEY, canonical.encode("utf-8"), hashlib.sha256).hexdigest()


def verify_signature(payload: dict[str, Any], signature: str) -> bool:
    return hmac.compare_digest(sign_payload(payload), signature or "")


# --------------------------------------------------------------------------- Ed25519 signatures
def _canonical(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")


def generate_signing_keypair() -> tuple[str, str]:
    """Return ``(public_key_b64, sealed_private_key)``.

    The private key is sealed with AES-256-GCM before it touches the database.
    """
    private = Ed25519PrivateKey.generate()
    public_bytes = private.public_key().public_bytes(
        encoding=serialization.Encoding.Raw, format=serialization.PublicFormat.Raw
    )
    seed = private.private_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PrivateFormat.Raw,
        encryption_algorithm=serialization.NoEncryption(),
    )
    return base64.b64encode(public_bytes).decode("ascii"), encrypt_field(seed.hex())


def sign_with_user_key(sealed_private_key: str | None, payload: dict[str, Any]) -> str:
    if not sealed_private_key:
        return sign_payload(payload)
    seed = bytes.fromhex(decrypt_field(sealed_private_key) or "")
    return Ed25519PrivateKey.from_private_bytes(seed).sign(_canonical(payload)).hex()


def verify_user_signature(public_key_b64: str | None, payload: dict[str, Any], signature: str | None) -> bool:
    if not public_key_b64:
        return verify_signature(payload, signature or "")
    try:
        from cryptography.exceptions import InvalidSignature

        key = Ed25519PublicKey.from_public_bytes(base64.b64decode(public_key_b64))
        try:
            key.verify(bytes.fromhex(signature or ""), _canonical(payload))
            return True
        except (InvalidSignature, ValueError):
            return False
    except Exception:
        return False


# --------------------------------------------------------------------------- TOTP MFA (RFC 6238)
def generate_totp_secret() -> str:
    return base64.b32encode(os.urandom(20)).decode("ascii").rstrip("=")


def totp_code(secret: str, at: int | None = None, step: int = 30, digits: int = 6) -> str:
    padded = secret + "=" * ((8 - len(secret) % 8) % 8)
    key = base64.b32decode(padded, casefold=True)
    counter = int((at if at is not None else time.time()) // step)
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(code % (10**digits)).zfill(digits)


def verify_totp(secret: str, code: str, window: int = 1) -> bool:
    now = int(time.time())
    return any(
        hmac.compare_digest(totp_code(secret, now + step * 30), (code or "").strip())
        for step in range(-window, window + 1)
    )


def totp_uri(secret: str, email: str, issuer: str = "AICTE FDR Portal") -> str:
    return f"otpauth://totp/{issuer}:{email}?secret={secret}&issuer={issuer}&digits=6&period=30"



# --------------------------------------------------------------------------- JWT
def create_access_token(user_id: int, role: str, institution_id: int | None, name: str = "") -> str:
    now = datetime.now(timezone.utc)
    claims = {
        "sub": str(user_id),
        "role": role,
        "institution_id": institution_id,
        "name": name,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=JWT_TTL_MINUTES)).timestamp()),
        "iss": "aicte-fdr-portal",
    }
    return jwt.encode(claims, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict[str, Any]:
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM], issuer="aicte-fdr-portal")


def create_challenge_token(user_id: int) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {"sub": str(user_id), "scope": "mfa", "iat": int(now.timestamp()),
         "exp": int((now + timedelta(minutes=5)).timestamp()), "iss": "aicte-fdr-portal"},
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )
