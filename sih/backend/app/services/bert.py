"""BERT-family encoder stage (PRD FR-8).

Runs *after* OCR and provides:

1. ``encode`` - contextual embeddings for semantic duplicate / near-duplicate
   detection across all institutions.
2. ``align_fields`` - embeds each extracted field's context and compares it with
   a prototype phrase, giving an embedding-based confidence adjustment. This is
   the seam where a fine-tuned token-classification head (MuRIL / IndicBERT /
   LayoutLMv3) plugs in: point ``AICTE_BERT_NER_MODEL`` at the checkpoint and
   ``ner_predict`` will use it.

The module degrades gracefully: if torch/transformers or the weights are not
available, it reports ``available: false`` and callers fall back to the
deterministic hashed n-gram embedding. Nothing in the product breaks.
"""
from __future__ import annotations

import os
import threading
from typing import Any

MODEL_ID = os.getenv("AICTE_BERT_MODEL", "distilbert-base-multilingual-cased")
NER_MODEL_ID = os.getenv("AICTE_BERT_NER_MODEL", "")
ENABLED = os.getenv("AICTE_BERT_ENABLED", "1").lower() not in {"0", "false", "no"}

FIELD_PROTOTYPES: dict[str, str] = {
    "fdr_number": "Fixed deposit receipt number issued by the bank",
    "amount": "Amount of the fixed deposit in Indian rupees",
    "issue_date": "Date on which the fixed deposit was issued",
    "maturity_date": "Date on which the fixed deposit matures",
    "bank": "Name of the bank that issued the fixed deposit receipt",
    "branch": "Name of the bank branch",
    "depositor": "Name of the institution or person depositing the amount",
    "aicte_id": "AICTE permanent identifier of the institution",
}

_lock = threading.Lock()
_state: dict[str, Any] = {
    "loaded": False,
    "error": None,
    "model_id": MODEL_ID,
    "dim": None,
    "device": "cpu",
    "load_seconds": None,
}
_tokenizer = None
_model = None
_ner_pipeline = None
_prototype_cache: dict[str, list[float]] = {}


def available() -> bool:
    return _load()


def _load() -> bool:
    global _tokenizer, _model, _ner_pipeline
    if not ENABLED:
        _state["error"] = "Disabled by AICTE_BERT_ENABLED=0"
        return False
    if _state["loaded"]:
        return True
    if _state["error"]:
        return False
    with _lock:
        if _state["loaded"]:
            return True
        try:
            import time

            started = time.time()
            import torch  # noqa: F401
            from transformers import AutoModel, AutoTokenizer

            tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
            model = AutoModel.from_pretrained(MODEL_ID)
            model.eval()
            _tokenizer, _model = tokenizer, model
            _state.update(
                loaded=True,
                dim=int(model.config.hidden_size),
                load_seconds=round(time.time() - started, 2),
                error=None,
            )

            if NER_MODEL_ID:
                try:
                    from transformers import pipeline

                    _ner_pipeline = pipeline(
                        "token-classification", model=NER_MODEL_ID, aggregation_strategy="simple"
                    )
                except Exception as exc:  # pragma: no cover
                    _state["ner_error"] = str(exc)

            return True
        except Exception as exc:  # pragma: no cover - depends on local install
            _state["error"] = f"{type(exc).__name__}: {exc}"
            return False


def encode(texts: list[str], max_length: int = 512) -> list[list[float]]:
    """Mean-pooled, L2-normalised sentence embeddings."""
    texts = [t for t in texts if isinstance(t, str)]
    if not texts or not _load():
        return []
    import torch

    with torch.no_grad():
        batch = _tokenizer(
            texts,
            padding=True,
            truncation=True,
            max_length=max_length,
            return_tensors="pt",
        )
        output = _model(**batch)
        hidden = output.last_hidden_state
        mask = batch["attention_mask"].unsqueeze(-1).float()
        pooled = (hidden * mask).sum(1) / mask.sum(1).clamp(min=1e-9)
        pooled = torch.nn.functional.normalize(pooled, p=2, dim=1)
    return [[round(float(v), 6) for v in row] for row in pooled.tolist()]


def _prototype(field: str) -> list[float]:
    if field not in _prototype_cache:
        vectors = encode([FIELD_PROTOTYPES[field]])
        if not vectors:
            return []
        _prototype_cache[field] = vectors[0]
    return _prototype_cache[field]


def align_fields(pairs: list[tuple[str, str]]) -> dict[str, float]:
    """Return ``{field: alignment 0..1}`` between context snippets and prototypes."""
    usable = [(key, snippet.strip()[:400]) for key, snippet in pairs if snippet and len(snippet.strip()) > 3]
    if not usable or not _load():
        return {}
    contexts = encode([snippet for _, snippet in usable])
    if not contexts:
        return {}
    result: dict[str, float] = {}
    for (key, _), vector in zip(usable, contexts):
        prototype = _prototype(key)
        if not prototype:
            continue
        similarity = sum(a * b for a, b in zip(vector, prototype))
        result[key] = round(max(0.0, min(1.0, (similarity + 1) / 2)), 3)
    return result


def ner_predict(text: str) -> list[dict[str, Any]]:
    """Fine-tuned token classification (optional). Empty list when unavailable."""
    if not text.strip() or not _load() or _ner_pipeline is None:
        return []
    try:
        entities = _ner_pipeline(text[:4000])
        return [
            {"entity": e.get("entity_group") or e.get("entity"), "score": round(float(e.get("score", 0)), 3),
             "word": e.get("word"), "start": e.get("start"), "end": e.get("end")}
            for e in entities
        ]
    except Exception:  # pragma: no cover
        return []


def status() -> dict[str, Any]:
    return {
        "enabled": ENABLED,
        "available": available(),
        "model_id": _state["model_id"],
        "dim": _state["dim"],
        "device": _state["device"],
        "load_seconds": _state["load_seconds"],
        "ner_model": NER_MODEL_ID or "rule-lexicon-v1",
        "error": _state["error"],
    }
