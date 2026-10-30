"""SHA-256 hash-chained ledger (PRD section 7).

Each block commits to: its index, action, actor, instrument, the SHA-256 of the
related document, a JSON payload of metadata, and the previous block hash. The
block hash is therefore tamper-evident; any edit to a historical block breaks
the chain at that exact index.

Documents are never stored on the chain - only their SHA-256 digest.
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from .models import LedgerBackup, LedgerBlock
from .security import (
    KEY_ID,
    sha256_hex,
    sign_payload,
    sign_with_user_key,
    verify_signature,
    verify_user_signature,
)

GENESIS_HASH = "0" * 64


def _canonical(data: dict[str, Any]) -> str:
    return json.dumps(data, sort_keys=True, separators=(",", ":"), default=str)


def compute_hash(
    idx: int,
    action: str,
    actor_id: int | None,
    instrument_id: int | None,
    document_hash: str | None,
    payload: dict[str, Any],
    prev_hash: str,
    created_at: str,
) -> str:
    return sha256_hex(
        _canonical(
            {
                "idx": idx,
                "action": action,
                "actor_id": actor_id,
                "instrument_id": instrument_id,
                "document_hash": document_hash,
                "payload": payload,
                "prev_hash": prev_hash,
                "created_at": created_at,
            }
        )
    )


def _signing_payload(block: LedgerBlock) -> dict[str, Any]:
    return {
        "idx": block.idx,
        "action": block.action,
        "actor_id": block.actor_id,
        "instrument_id": block.instrument_id,
        "document_hash": block.document_hash,
        "payload": block.payload_json or {},
        "prev_hash": block.prev_hash,
        "hash": block.hash,
        "created_at": block.created_at.isoformat(),
    }


def append_block(
    db: Session,
    action: str,
    *,
    actor=None,
    instrument_id: int | None = None,
    document_hash: str | None = None,
    payload: dict[str, Any] | None = None,
    commit: bool = True,
) -> LedgerBlock:
    last = db.query(LedgerBlock).order_by(LedgerBlock.idx.desc()).first()
    prev_hash = last.hash if last else GENESIS_HASH
    idx = (last.idx + 1) if last else 1
    created_at = datetime.utcnow()
    payload = payload or {}

    block = LedgerBlock(
        idx=idx,
        action=action,
        actor_id=getattr(actor, "id", None),
        actor_name=getattr(actor, "name", "System"),
        actor_role=getattr(actor, "role", "system"),
        instrument_id=instrument_id,
        document_hash=document_hash,
        payload_json=payload,
        prev_hash=prev_hash,
        created_at=created_at,
    )
    block.hash = compute_hash(
        idx, action, block.actor_id, instrument_id, document_hash, payload, prev_hash, created_at.isoformat()
    )
    signing_payload = _signing_payload(block)
    block.signature = sign_with_user_key(getattr(actor, "private_key_enc", None), signing_payload)
    block.signer_pubkey = getattr(actor, "public_key", None)
    block.key_id = getattr(actor, "key_id", None) or KEY_ID
    db.add(block)
    if commit:
        db.commit()
        db.refresh(block)
    return block


def verify_chain(db: Session, limit: int | None = None) -> dict[str, Any]:
    query = db.query(LedgerBlock).order_by(LedgerBlock.idx.asc())
    blocks = query.all()
    expected_prev = GENESIS_HASH
    broken_at: int | None = None
    reason: str | None = None
    signature_failures: list[int] = []

    for position, block in enumerate(blocks):
        if block.idx != position + 1:
            broken_at, reason = block.idx, "Block index gap - a block was removed or reordered."
            break
        if block.prev_hash != expected_prev:
            broken_at, reason = block.idx, "Previous-hash mismatch - the chain was re-linked."
            break
        recomputed = compute_hash(
            block.idx,
            block.action,
            block.actor_id,
            block.instrument_id,
            block.document_hash,
            block.payload_json or {},
            block.prev_hash,
            block.created_at.isoformat(),
        )
        if recomputed != block.hash:
            broken_at, reason = block.idx, "Block content hash mismatch - this block was edited after sealing."
            break
        if not verify_user_signature(block.signer_pubkey, _signing_payload(block), block.signature):
            signature_failures.append(block.idx)
        expected_prev = block.hash

    total = len(blocks)
    head = blocks[-1] if blocks else None
    return {
        "valid": broken_at is None and not signature_failures,
        "blocks": total,
        "broken_at": broken_at,
        "reason": reason,
        "signature_failures": signature_failures,
        "head_hash": head.hash if head else GENESIS_HASH,
        "head_index": head.idx if head else 0,
        "checked_at": datetime.utcnow().isoformat() + "Z",
    }


def serialize_block(block: LedgerBlock) -> dict[str, Any]:
    return {
        "idx": block.idx,
        "action": block.action,
        "actor_id": block.actor_id,
        "actor_name": block.actor_name,
        "actor_role": block.actor_role,
        "instrument_id": block.instrument_id,
        "document_hash": block.document_hash,
        "payload": block.payload_json or {},
        "prev_hash": block.prev_hash,
        "hash": block.hash,
        "signature": block.signature,
        "signer_pubkey": block.signer_pubkey,
        "key_id": block.key_id,
        "algo": block.algo,
        "created_at": block.created_at.isoformat() + "Z",
    }


def tamper_block(db: Session, idx: int) -> dict[str, Any]:
    """Demo helper: silently edit a sealed block's payload, leaving the hash intact."""
    block = db.query(LedgerBlock).filter(LedgerBlock.idx == idx).first()
    if not block:
        return {"ok": False, "message": f"Block #{idx} not found."}

    backup = db.query(LedgerBackup).filter(LedgerBackup.block_idx == idx).first()
    if not backup:
        db.add(LedgerBackup(block_idx=idx, payload_json=block.payload_json))
    payload = dict(block.payload_json or {})
    payload["amount"] = "9999999"
    payload["_tampered_by"] = "demo-attacker"
    block.payload_json = payload
    db.commit()
    return {"ok": True, "tampered_block": idx, "message": f"Block #{idx} payload was altered."}


def heal_block(db: Session, idx: int | None = None) -> dict[str, Any]:
    """Restore the tampered block from the demo backup so the demo can be repeated."""
    query = db.query(LedgerBackup)
    if idx is not None:
        query = query.filter(LedgerBackup.block_idx == idx)
    backups = query.all()
    if not backups:
        return {"ok": False, "restored": 0, "message": "Nothing to restore."}
    for backup in backups:
        block = db.query(LedgerBlock).filter(LedgerBlock.idx == backup.block_idx).first()
        if block:
            block.payload_json = backup.payload_json
        db.delete(backup)
    db.commit()
    return {"ok": True, "restored": len(backups)}


def chain_stats(db: Session) -> dict[str, Any]:
    total = db.query(func.count(LedgerBlock.id)).scalar() or 0
    return {"blocks": total, "integrity": verify_chain(db)}
