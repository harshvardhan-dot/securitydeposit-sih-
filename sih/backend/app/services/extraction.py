"""Document understanding pipeline (PRD 6.2 / 6.3).

Stages: image clean-up -> OCR -> field extraction (NER) -> confidence scoring ->
semantic embedding -> duplicate + anomaly checks.

The NER stage is a deterministic rule + lexikon model with a stable interface
(``extract_fields``). It is the drop-in seam for a MuRIL / IndicBERT / LayoutLM
encoder: swap ``extract_fields`` for a model call and every downstream feature
(confidence highlighting, mismatch detection, trust score) keeps working.
Embeddings use hashed character n-grams, so near-duplicate detection works
without shipping a transformer, and stored vectors are not reversible.
"""
from __future__ import annotations

import hashlib
import io
import math
import os
import re
import shutil
from datetime import date, datetime
from typing import Any

BANKS: dict[str, list[str]] = {
    "State Bank of India": ["state bank of india", "sbi"],
    "Punjab National Bank": ["punjab national bank", "pnb"],
    "Bank of Baroda": ["bank of baroda", "bob"],
    "Canara Bank": ["canara bank"],
    "Union Bank of India": ["union bank of india", "union bank"],
    "Indian Bank": ["indian bank"],
    "Bank of India": ["bank of india"],
    "Central Bank of India": ["central bank of india"],
    "UCO Bank": ["uco bank"],
    "IDBI Bank": ["idbi bank", "idbi"],
    "HDFC Bank": ["hdfc bank", "hdfc"],
    "ICICI Bank": ["icici bank", "icici"],
    "Axis Bank": ["axis bank"],
    "Kotak Mahindra Bank": ["kotak mahindra bank", "kotak bank"],
    "Yes Bank": ["yes bank"],
    "IndusInd Bank": ["indusind bank"],
    "Federal Bank": ["federal bank"],
    "South Indian Bank": ["south indian bank"],
}

MONTHS = {
    "jan": 1, "january": 1, "feb": 2, "february": 2, "mar": 3, "march": 3,
    "apr": 4, "april": 4, "may": 5, "jun": 6, "june": 6, "jul": 7, "july": 7,
    "aug": 8, "august": 8, "sep": 9, "sept": 9, "september": 9, "oct": 10,
    "october": 10, "nov": 11, "november": 11, "dec": 12, "december": 12,
}

AMOUNT_RE = re.compile(r"(?:rs\.?|inr|₹)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)", re.I)
DATE_DMY = re.compile(r"\b(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{4})\b")
DATE_TEXT = re.compile(r"\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})[,.]?\s+(\d{4})\b")
DATE_ISO = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")

NUMBER_RE = re.compile(r"\b([A-Z]{0,4}[\s/-]?[0-9][A-Z0-9/\-]{4,22})\b")

FIELD_LABELS: dict[str, list[str]] = {
    "fdr_number": [
        "fdr no", "fdr number", "fdr no.", "fd no", "fd number", "receipt no",
        "receipt number", "deposit receipt no", "deposit receipt number", "dr no",
        "certificate no", "fixed deposit no", "fdr ac no",
    ],
    "amount": ["amount", "deposit amount", "face value", "sum of", "value of deposit", "principal amount"],
    "issue_date": ["date of issue", "issue date", "date of deposit", "deposit date", "issued on", "opening date"],
    "maturity_date": ["maturity date", "date of maturity", "matures on", "date of encashment", "due date"],
    "bank": ["bank name", "issuing bank", "name of bank", "bank"],
    "branch": ["branch name", "branch", "issuing branch"],
    "depositor": ["in the name of", "name of depositor", "depositor", "account holder", "in favour of", "name"],
}


# --------------------------------------------------------------------------- text extraction
def _quality_from_image(raw: bytes) -> tuple[str, dict[str, Any]]:
    """Image clean-up (FR-6): EXIF rotation, contrast, size normalisation."""
    from PIL import Image, ImageFilter, ImageOps, ImageStat

    image = Image.open(io.BytesIO(raw))
    issues: list[str] = []
    quality: dict[str, Any] = {"engine": "pillow", "issues": issues}

    exif_orientation = image.getexif().get(274) if hasattr(image, "getexif") else None
    image = ImageOps.exif_transpose(image)
    if exif_orientation and exif_orientation != 1:
        quality["rotated_from_exif"] = exif_orientation

    if image.width > 2200 or image.height > 2200:
        image.thumbnail((2200, 2200))
        quality["resized"] = True

    image = ImageOps.autocontrast(image)
    grey = image.convert("L")
    stat = ImageStat.Stat(grey)
    contrast = stat.stddev[0] if stat.stddev else 0.0

    edges = grey.filter(ImageFilter.FIND_EDGES)
    sharpness = ImageStat.Stat(edges).var[0] if ImageStat.Stat(edges).var else 0.0

    histogram = grey.histogram()
    total_pixels = max(1, sum(histogram))
    glare_ratio = sum(histogram[246:]) / total_pixels

    mean_brightness = stat.mean[0] if stat.mean else 128.0
    if sharpness < 120:
        issues.append("This photo looks blurry. Please hold the phone steady and retake it.")
    if glare_ratio > 0.06:
        issues.append("There is glare on the document. Avoid direct light or flash.")
    if contrast < 28:
        issues.append("The scan has low contrast. Try better lighting.")
    if mean_brightness < 55 or mean_brightness > 235:
        issues.append("The photo is too dark or too bright.")

    quality.update(
        {
            "sharpness": round(sharpness, 1),
            "contrast": round(contrast, 1),
            "glare_ratio": round(glare_ratio, 4),
            "brightness": round(mean_brightness, 1),
            "width": image.width,
            "height": image.height,
        }
    )
    sharp_ok = min(1.0, sharpness / 600.0)
    contrast_ok = min(1.0, contrast / 55.0)
    glare_ok = max(0.0, 1.0 - glare_ratio / 0.10)
    quality["score"] = round(0.45 * sharp_ok + 0.3 * contrast_ok + 0.25 * glare_ok, 3)

    buffer = io.BytesIO()
    image.convert("RGB").save(buffer, format="PNG", optimize=True)
    import base64

    return base64.b64encode(buffer.getvalue()).decode("ascii"), quality


def _tesseract():
    """Locate a Tesseract install (PATH or the standard Windows location)."""
    try:
        import pytesseract
    except ImportError:
        return None
    if not shutil.which("tesseract"):
        for candidate in (
            r"C:\Program Files\Tesseract-OCR\tesseract.exe",
            r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
            "/usr/bin/tesseract",
            "/usr/local/bin/tesseract",
        ):
            if os.path.exists(candidate):
                pytesseract.pytesseract.tesseract_cmd = candidate
                break
        else:
            return None
    return pytesseract


_easyocr_reader = None


def _ocr_image(raw: bytes) -> tuple[str, str]:
    """OCR an image: Tesseract first, EasyOCR as a pure-Python fallback."""
    from PIL import Image, ImageOps

    image = Image.open(io.BytesIO(raw))
    image = ImageOps.exif_transpose(image)
    if image.width < 1400:
        ratio = 1400 / image.width
        image = image.resize((int(image.width * ratio), int(image.height * ratio)), Image.LANCZOS)
    grey = ImageOps.autocontrast(image.convert("L"))

    tesseract = _tesseract()
    if tesseract is not None:
        try:
            text = tesseract.image_to_string(grey, lang="eng", config="--oem 3 --psm 6")
            if len(text.strip()) >= 15:
                return text, "tesseract-ocr"
        except Exception:
            pass

    global _easyocr_reader
    try:
        import easyocr  # type: ignore

        if _easyocr_reader is None:
            _easyocr_reader = easyocr.Reader(["en"], gpu=False, verbose=False)
        lines = _easyocr_reader.readtext(__import__("numpy").array(grey), detail=0, paragraph=True)
        text = "\n".join(lines)
        if text.strip():
            return text, "easyocr"
    except Exception:
        pass

    return "", "unavailable"


def extract_text(raw: bytes, mime: str) -> tuple[str, str, dict[str, Any]]:
    if mime == "application/pdf":
        try:
            from pypdf import PdfReader

            reader = PdfReader(io.BytesIO(raw))
            text = "\n".join((page.extract_text() or "") for page in reader.pages)
            if text.strip():
                return text, "pdf-text-layer", {"pages": len(reader.pages)}
            return "", "pdf-no-text-layer", {"pages": len(reader.pages)}
        except Exception as exc:  # pragma: no cover
            return "", f"pdf-error: {exc}", {}

    try:
        text, engine = _ocr_image(raw)
        return text, engine, {}
    except Exception as exc:  # pragma: no cover
        return "", f"ocr-error: {exc}", {}


# --------------------------------------------------------------------------- NER
def _clean(text: str) -> str:
    text = text.replace("\u00a0", " ")
    text = re.sub(r"[ \t]+", " ", text)
    return text


def _parse_date(token: str) -> date | None:
    token = token.strip()
    m = DATE_DMY.search(token)
    if m:
        day, month, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
        try:
            return date(year, month, day)
        except ValueError:
            return None
    m = DATE_ISO.search(token)
    if m:
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            return None
    m = DATE_TEXT.search(token)
    if m:
        month = MONTHS.get(m.group(2).lower())
        if month:
            try:
                return date(int(m.group(3)), month, int(m.group(1)))
            except ValueError:
                return None
    return None


def _find_all_dates(text: str) -> list[date]:
    found: list[date] = []
    for regex in (DATE_DMY, DATE_ISO, DATE_TEXT):
        for match in regex.finditer(text):
            parsed = _parse_date(match.group(0))
            if parsed and parsed not in found:
                found.append(parsed)
    return found


def _near_label(text: str, labels: list[str], window: int = 90) -> str | None:
    lower = text.lower()
    best: tuple[int, str] | None = None
    for label in labels:
        for match in re.finditer(re.escape(label), lower):
            snippet = text[match.end() : match.end() + window]
            if best is None or match.start() < best[0]:
                best = (match.start(), snippet)
    return best[1] if best else None


def _parse_amount(raw: str) -> float | None:
    try:
        return float(raw.replace(",", ""))
    except ValueError:
        return None


def extract_fields(text: str) -> dict[str, dict[str, Any]]:
    text = _clean(text)
    lower = text.lower()
    fields: dict[str, dict[str, Any]] = {}

    def put(key: str, value: Any, confidence: float, method: str):
        if value in (None, "", 0):
            return
        current = fields.get(key)
        if current is None or confidence > current["confidence"]:
            fields[key] = {"value": value, "confidence": round(confidence, 2), "method": method}

    # FDR / receipt number
    near = _near_label(text, FIELD_LABELS["fdr_number"], window=70)
    if near:
        match = NUMBER_RE.search(near)
        if match:
            put("fdr_number", match.group(1).strip(" .,-"), 0.94, "label-anchored")
    if "fdr_number" not in fields:
        for match in NUMBER_RE.finditer(text):
            candidate = match.group(1).strip(" .,-")
            if sum(ch.isdigit() for ch in candidate) >= 5 and not _parse_date(candidate):
                put("fdr_number", candidate, 0.62, "pattern")
                break

    # Bank
    for bank_name, aliases in BANKS.items():
        if any(re.search(rf"\b{re.escape(alias)}\b", lower) for alias in aliases):
            labeled = re.search(rf"(?:bank name|issuing bank)[:\s].{{0,30}}{re.escape(aliases[0])}", lower)
            put("bank", bank_name, 0.97 if labeled else 0.9, "lexicon")
            break

    # Branch
    near = _near_label(text, FIELD_LABELS["branch"], window=70)
    if near:
        line = re.split(r"[\n,;]", near.strip())[0]
        line = re.sub(r"^[:\-\s]+", "", line).strip()
        if 2 < len(line) < 80:
            put("branch", line, 0.75, "label-anchored")

    # Amount
    near = _near_label(text, FIELD_LABELS["amount"], window=80)
    amount = None
    if near:
        match = AMOUNT_RE.search(near) or re.search(r"([0-9][0-9,]{3,}(?:\.[0-9]{1,2})?)", near)
        if match:
            amount = _parse_amount(match.group(1))
            if amount:
                put("amount", amount, 0.95, "label-anchored")
    if amount is None:
        match = AMOUNT_RE.search(text)
        if match:
            amount = _parse_amount(match.group(1))
            if amount:
                put("amount", amount, 0.7, "pattern")

    # Dates: anchor on labels first, then fall back to ordering
    issue_near = _near_label(text, FIELD_LABELS["issue_date"], window=80)
    maturity_near = _near_label(text, FIELD_LABELS["maturity_date"], window=80)
    issue_date = _parse_date(issue_near or "") if issue_near else None
    maturity_date = _parse_date(maturity_near or "") if maturity_near else None
    if issue_date:
        put("issue_date", issue_date.isoformat(), 0.94, "label-anchored")
    if maturity_date:
        put("maturity_date", maturity_date.isoformat(), 0.94, "label-anchored")

    if not issue_date or not maturity_date:
        dates = [d for d in _find_all_dates(text) if 1980 <= d.year <= 2100]
        if dates:
            dates.sort()
            if not issue_date:
                put("issue_date", dates[0].isoformat(), 0.66, "ordered-date")
            if not maturity_date and len(dates) > 1:
                put("maturity_date", dates[-1].isoformat(), 0.66, "ordered-date")

    # Depositor / institution name
    near = _near_label(text, FIELD_LABELS["depositor"], window=90)
    if near:
        line = re.split(r"[\n,;]", near.strip())[0]
        line = re.sub(r"^[:\-\s]+", "", line).strip()
        if 3 < len(line) < 120:
            put("depositor", line, 0.72, "label-anchored")

    aicte = re.search(r"\b1-\d{5,7}\b", text)
    if aicte:
        put("aicte_id", aicte.group(0), 0.9, "pattern")

    return fields


# --------------------------------------------------------------------------- embeddings
EMBED_DIM = 256


def embed(text: str) -> list[float]:
    vector = [0.0] * EMBED_DIM
    normalized = re.sub(r"\s+", " ", _clean(text).lower())
    for i in range(len(normalized) - 2):
        gram = normalized[i : i + 3]
        digest = hashlib.blake2b(gram.encode(), digest_size=4).digest()
        vector[int.from_bytes(digest, "big") % EMBED_DIM] += 1.0
    norm = math.sqrt(sum(v * v for v in vector)) or 1.0
    return [round(v / norm, 6) for v in vector]


def cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    return sum(x * y for x, y in zip(a, b))


# --------------------------------------------------------------------------- anomaly
def anomaly_score(fields: dict[str, dict[str, Any]], text: str, quality: dict[str, Any]) -> tuple[float, list[str]]:
    score = 0.0
    reasons: list[str] = []

    if "bank" not in fields:
        score += 0.32
        reasons.append("Bank name not recognised - the document layout is unfamiliar.")
    if "fdr_number" not in fields:
        score += 0.22
        reasons.append("FDR / receipt number could not be read.")
    if "amount" not in fields:
        score += 0.2
        reasons.append("Deposit amount could not be read.")

    issue = fields.get("issue_date", {}).get("value")
    maturity = fields.get("maturity_date", {}).get("value")
    if issue and maturity and maturity <= issue:
        score += 0.35
        reasons.append("Maturity date is on or before the issue date.")
    if not maturity:
        score += 0.18
        reasons.append("Maturity date is missing.")
    if len(text.strip()) < 120:
        score += 0.35
        reasons.append("Very little text was recovered from the document.")

    confidences = [f["confidence"] for f in fields.values()]
    if confidences and sum(confidences) / len(confidences) < 0.6:
        score += 0.2
        reasons.append("Average extraction confidence is low.")

    if float(quality.get("score", 1.0)) < 0.5:
        score += 0.15
        reasons.append("Scan quality is below the recommended threshold.")

    return round(min(1.0, score), 2), reasons


# --------------------------------------------------------------------------- BERT alignment
def _context(text: str, labels: list[str], window: int = 110) -> str:
    lower = text.lower()
    best: tuple[int, str] | None = None
    for label in labels:
        index = lower.find(label)
        if index >= 0 and (best is None or index < best[0]):
            start = max(0, index - 25)
            best = (index, text[start : index + window])
    return best[1] if best else ""


def _bert_align(text: str, fields: dict[str, dict[str, Any]]) -> dict[str, float]:
    from . import bert

    pairs: list[tuple[str, str]] = []
    for key in fields:
        labels = FIELD_LABELS.get(key) or [key.replace("_", " ")]
        snippet = _context(text, labels)
        if not snippet:
            snippet = text[:300]
        pairs.append((key, f"{snippet}"))
    return bert.align_fields(pairs)


# --------------------------------------------------------------------------- per-bank anomaly
def bank_pattern_anomaly(db, bank: str | None, embedding: list[float]) -> dict[str, Any]:
    """Compare a new document against the usual language/layout of the same bank."""
    import json

    from ..models import Document, Instrument

    if not bank or not embedding:
        return {"score": 0.0, "similarity": None, "samples": 0, "note": "Not enough data"}

    rows = (
        db.query(Document.embedding_json)
        .join(Instrument, Document.instrument_id == Instrument.id)
        .filter(Instrument.bank == bank, Document.embedding_json.isnot(None))
        .limit(120)
        .all()
    )
    vectors = []
    for (raw,) in rows:
        try:
            vector = json.loads(raw)
        except Exception:
            continue
        if len(vector) == len(embedding):
            vectors.append(vector)

    if len(vectors) < 5:
        return {"score": 0.0, "similarity": None, "samples": len(vectors), "note": "Not enough history for this bank yet"}

    centroid = [sum(col) / len(vectors) for col in zip(*vectors)]
    norm = math.sqrt(sum(v * v for v in centroid)) or 1.0
    centroid = [v / norm for v in centroid]
    similarity = round(cosine(embedding, centroid), 3)
    score = round(max(0.0, min(1.0, (0.92 - similarity) / 0.35)), 2)
    return {
        "score": score,
        "similarity": similarity,
        "samples": len(vectors),
        "note": "Similar to other documents from this bank"
        if score < 0.3
        else "Language/layout differs from typical documents from this bank",
    }


# --------------------------------------------------------------------------- orchestration
def analyze_document(raw: bytes, mime: str) -> dict[str, Any]:
    from . import bert

    quality: dict[str, Any] = {"score": 0.9, "issues": [], "engine": "pdf"}
    working = raw
    ocr_engine = "none"

    if mime.startswith("image/"):
        cleaned_b64, quality = _quality_from_image(raw)
        import base64

        working = base64.b64decode(cleaned_b64)
        text, ocr_engine, pdf_meta = _ocr_image(working)
        quality.update(pdf_meta)
    else:
        text, ocr_engine, pdf_meta = extract_text(raw, mime)
        quality.update(pdf_meta)

    warnings: list[str] = []
    if not text.strip():
        warnings.append(
            "We could not read any text from this file. The scan may be blank or too poor to read."
        )
        if mime == "application/pdf":
            warnings.append("Upload a PDF with a text layer, or a clear photo so OCR can read it.")

    fields = extract_fields(text)

    # BERT stage after OCR: embedding-based field alignment (FR-8)
    alignment = _bert_align(text, fields) if fields else {}
    for key, value in alignment.items():
        if key in fields:
            fields[key]["bert_alignment"] = value
            adjusted = fields[key]["confidence"] + (value - 0.5) * 0.12
            fields[key]["confidence"] = round(max(0.05, min(0.99, adjusted)), 2)

    bert_vectors = bert.encode([text]) if text.strip() and bert.available() else []
    if bert_vectors:
        embedding = bert_vectors[0]
        embedding_model = f"{bert.status()['model_id']} ({len(embedding)}d)"
    else:
        embedding = embed(text) if text else []
        embedding_model = f"hashed-char-3gram ({EMBED_DIM}d fallback)"

    score, reasons = anomaly_score(fields, text, quality)
    mean_confidence = (
        round(sum(f["confidence"] for f in fields.values()) / len(fields), 2) if fields else 0.0
    )
    required = ["fdr_number", "bank", "amount", "issue_date", "maturity_date"]
    missing = [key for key in required if key not in fields]

    return {
        "fields": fields,
        "confidence": mean_confidence,
        "missing_fields": missing,
        "quality": quality,
        "anomaly_score": score,
        "anomaly_reasons": reasons,
        "warnings": warnings,
        "embedding": embedding,
        "embedding_model": embedding_model,
        "text_preview": text[:2500],
        "text_length": len(text),
        "engine": {
            "ocr": ocr_engine,
            "bert": bert.status()["model_id"] if bert.status()["available"] else "unavailable (fallback embeddings)",
            "ner": "bert+rule-lexicon-v1",
        },
        "needs_manual_review": bool(missing) or mean_confidence < 0.6 or score > 0.5,
    }


def find_duplicates(
    db,
    embedding: list[float],
    fdr_hash: str | None,
    exclude_document_id: int | None = None,
    limit: int = 5,
) -> list[dict[str, Any]]:
    """Duplicate + near-duplicate detection across every institution (FR-8).

    * exact: SHA-256 of the normalised FDR number already exists
    * near : cosine similarity of the document embedding >= 0.93
    """
    import json

    from ..models import Document, Instrument

    query = db.query(Document)
    if exclude_document_id:
        query = query.filter(Document.id != exclude_document_id)
    documents = query.all()

    instrument_ids = {doc.instrument_id for doc in documents if doc.instrument_id}
    hash_by_instrument: dict[int, str] = {}
    reference_by_instrument: dict[int, str] = {}
    institution_by_instrument: dict[int, int] = {}
    if instrument_ids:
        for instrument in db.query(Instrument).filter(Instrument.id.in_(instrument_ids)).all():
            hash_by_instrument[instrument.id] = instrument.fdr_number_hash
            reference_by_instrument[instrument.id] = instrument.reference
            institution_by_instrument[instrument.id] = instrument.institution_id

    results: list[dict[str, Any]] = []
    for doc in documents:
        similarity = 0.0
        if embedding and doc.embedding_json:
            try:
                similarity = cosine(embedding, json.loads(doc.embedding_json))
            except Exception:
                similarity = 0.0
        exact_number = bool(
            fdr_hash and doc.instrument_id and hash_by_instrument.get(doc.instrument_id) == fdr_hash
        )
        if exact_number or similarity >= 0.93:
            results.append(
                {
                    "document_id": doc.id,
                    "instrument_id": doc.instrument_id,
                    "reference": reference_by_instrument.get(doc.instrument_id or 0),
                    "institution_id": institution_by_instrument.get(doc.instrument_id or 0),
                    "similarity": round(similarity, 3),
                    "reason": "same-fdr-number" if exact_number else "near-duplicate-document",
                }
            )
    results.sort(key=lambda item: (item["reason"] == "same-fdr-number", item["similarity"]), reverse=True)
    return results[:limit]
