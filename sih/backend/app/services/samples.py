"""Synthetic FDR receipts for training/demo (no real institution data)."""
from __future__ import annotations

import io
from datetime import date
from pathlib import Path

from ..config import SAMPLE_DIR


def inr(value: float) -> str:
    """Indian digit grouping: 25,00,000.00"""
    whole, _, decimals = f"{value:.2f}".partition(".")
    if len(whole) <= 3:
        grouped = whole
    else:
        head, tail = whole[:-3], whole[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        grouped = ",".join(parts + [tail])
    return f"{grouped}.{decimals}"


def make_fdr_pdf(
    *,
    bank: str,
    branch: str,
    fdr_number: str,
    issue_date: date,
    maturity_date: date,
    amount: float,
    depositor: str,
    aicte_id: str,
) -> bytes:
    from fpdf import FPDF

    pdf = FPDF(format="A4")
    pdf.set_margins(18, 16, 18)
    pdf.add_page()
    pdf.set_draw_color(31, 78, 121)
    pdf.set_line_width(0.6)
    pdf.rect(12, 12, 186, 120)

    pdf.set_font("Helvetica", "B", 10)
    pdf.set_text_color(90, 90, 90)
    pdf.cell(0, 6, "SYNTHETIC SAMPLE - generated for the AICTE prototype", ln=1)
    pdf.ln(2)

    pdf.set_text_color(20, 20, 20)
    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(0, 9, bank.upper(), ln=1)
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(0, 5, branch, ln=1)
    pdf.ln(3)

    pdf.set_font("Helvetica", "B", 13)
    pdf.set_text_color(31, 78, 121)
    pdf.cell(0, 8, "FIXED DEPOSIT RECEIPT", ln=1)
    pdf.set_text_color(20, 20, 20)
    pdf.ln(2)

    rows = [
        ("FDR No:", fdr_number),
        ("Date of Issue:", issue_date.strftime("%d-%m-%Y")),
        ("Maturity Date:", maturity_date.strftime("%d-%m-%Y")),
        ("Amount:", f"Rs. {inr(amount)}"),
        ("In the name of:", depositor),
        ("AICTE ID:", aicte_id),
        ("Branch:", branch),
    ]
    pdf.set_font("Helvetica", "", 11)
    for label, value in rows:
        pdf.set_font("Helvetica", "B", 11)
        pdf.cell(42, 8, label, border=0)
        pdf.set_font("Helvetica", "", 11)
        pdf.cell(0, 8, value, border=0, ln=1)

    pdf.ln(3)
    pdf.set_font("Helvetica", "", 9)
    pdf.multi_cell(
        0,
        5,
        "This receipt is issued subject to the terms and conditions of the bank. The deposit is repayable "
        "on the maturity date against surrender of this receipt. Interest is payable as per the applicable "
        "schedule. In case of loss, the branch must be informed immediately in writing.",
    )
    pdf.ln(6)
    pdf.set_font("Helvetica", "I", 9)
    pdf.cell(0, 5, "Authorised Signatory", ln=1)
    pdf.cell(0, 5, "For internal AICTE compliance use only.", ln=1)

    return bytes(pdf.output())


def make_fdr_photo(
    *,
    bank: str,
    branch: str,
    fdr_number: str,
    issue_date: date,
    maturity_date: date,
    amount: float,
    depositor: str,
    aicte_id: str,
) -> bytes:
    """A phone-style photo (PNG) so the OCR path can be demonstrated without a real receipt."""
    from PIL import Image, ImageDraw, ImageFont

    width, height = 1080, 1450
    image = Image.new("RGB", (width, height), (247, 246, 242))
    draw = ImageDraw.Draw(image)

    font_path = Path("C:/Windows/Fonts/arial.ttf")
    bold_path = Path("C:/Windows/Fonts/arialbd.ttf")
    regular = ImageFont.truetype(str(font_path), 30) if font_path.exists() else ImageFont.load_default()
    bold = ImageFont.truetype(str(bold_path), 40) if bold_path.exists() else regular
    small = ImageFont.truetype(str(font_path), 24) if font_path.exists() else regular

    draw.rectangle([50, 50, width - 50, height - 50], outline=(31, 78, 121), width=4)
    draw.text((80, 90), "SYNTHETIC SAMPLE PHOTO", font=small, fill=(120, 120, 120))
    draw.text((80, 140), bank.upper(), font=bold, fill=(20, 20, 20))
    draw.text((80, 195), branch, font=regular, fill=(60, 60, 60))
    draw.text((80, 260), "FIXED DEPOSIT RECEIPT", font=bold, fill=(31, 78, 121))

    rows = [
        ("FDR No:", fdr_number),
        ("Date of Issue:", issue_date.strftime("%d-%m-%Y")),
        ("Maturity Date:", maturity_date.strftime("%d-%m-%Y")),
        ("Amount:", f"Rs. {inr(amount)}"),
        ("In the name of:", depositor),
        ("AICTE ID:", aicte_id),
        ("Branch:", branch),
    ]
    y = 360
    for label, value in rows:
        draw.text((90, y), label, font=bold, fill=(20, 20, 20))
        draw.text((390, y), value, font=regular, fill=(30, 30, 30))
        y += 70

    draw.text((90, y + 60), "Authorised Signatory", font=regular, fill=(40, 40, 40))
    draw.text((90, y + 110), "For internal AICTE compliance use only.", font=small, fill=(90, 90, 90))

    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


SAMPLE_SPECS = [
    {
        "name": "sample-sbi-fdr.pdf",
        "kind": "pdf",
        "bank": "State Bank of India",
        "branch": "Pune Camp Branch",
        "fdr_number": "SBI/2024/884213",
        "issue_date": date(2024, 6, 12),
        "maturity_date": date(2027, 6, 11),
        "amount": 2500000.0,
        "depositor": "Sunrise Institute of Technology",
        "aicte_id": "1-1234567",
    },
    {
        "name": "sample-hdfc-fdr.pdf",
        "kind": "pdf",
        "bank": "HDFC Bank",
        "branch": "Baner Road Branch",
        "fdr_number": "HDFC/FD/7721901",
        "issue_date": date(2025, 1, 20),
        "maturity_date": date(2027, 1, 19),
        "amount": 1250000.0,
        "depositor": "Sunrise Institute of Technology",
        "aicte_id": "1-1234567",
    },
    {
        "name": "sample-canara-fdr-photo.png",
        "kind": "png",
        "bank": "Canara Bank",
        "branch": "Varanasi Cantt Branch",
        "fdr_number": "CNR/FDR/2023/55120",
        "issue_date": date(2023, 11, 2),
        "maturity_date": date(2026, 11, 1),
        "amount": 800000.0,
        "depositor": "Ganga College of Engineering",
        "aicte_id": "1-2345678",
    },
]


def ensure_samples() -> list[dict]:
    created = []
    for spec in SAMPLE_SPECS:
        path = SAMPLE_DIR / spec["name"]
        if not path.exists():
            if spec["kind"] == "pdf":
                payload = make_fdr_pdf(**{k: spec[k] for k in (
                    "bank", "branch", "fdr_number", "issue_date", "maturity_date", "amount", "depositor", "aicte_id")})
            else:
                payload = make_fdr_photo(**{k: spec[k] for k in (
                    "bank", "branch", "fdr_number", "issue_date", "maturity_date", "amount", "depositor", "aicte_id")})
            path.write_bytes(payload)
        created.append(
            {
                "name": spec["name"],
                "kind": spec["kind"],
                "bank": spec["bank"],
                "amount": spec["amount"],
                "path": str(path),
                "size_bytes": path.stat().st_size,
            }
        )
    return created
