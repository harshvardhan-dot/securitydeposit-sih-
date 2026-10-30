from __future__ import annotations

import time

from fastapi import APIRouter, Depends

from ..deps import get_current_user
from ..models import User
from ..services import bert
from ..services.extraction import BANKS, _tesseract

router = APIRouter(prefix="/api/ai", tags=["ai"])


@router.get("/status")
def ai_status(user: User = Depends(get_current_user)):
    engine = _tesseract()
    return {
        "ocr": {
            "engine": "tesseract-ocr 5.x" if engine else "pdf-text-layer only",
            "available": engine is not None,
            "image_cleanup": "EXIF rotation, grayscale, autocontrast, upscale, blur/glare detection",
        },
        "bert": bert.status(),
        "ner": {
            "pipeline": "OCR -> BERT embedding alignment -> rule/lexicon fields -> confidence",
            "banks_in_lexicon": len(BANKS),
            "field_prototypes": list(bert.FIELD_PROTOTYPES.keys()),
        },
        "duplicates": "cosine similarity over BERT embeddings (threshold 0.93) + SHA-256 of normalised FDR number",
        "anomaly": "per-bank embedding centroid distance + rule checks",
    }


@router.post("/warm")
def warm(user: User = Depends(get_current_user)):
    started = time.time()
    available = bert.available()
    encode_seconds = None
    if available:
        encoded = bert.encode(["AICTE security deposit fixed deposit receipt test document"])
        encode_seconds = round(time.time() - started, 2)
        return {"loaded": bool(encoded), "encode_seconds": encode_seconds, "status": bert.status()}
    return {"loaded": False, "status": bert.status(), "seconds": round(time.time() - started, 2)}
