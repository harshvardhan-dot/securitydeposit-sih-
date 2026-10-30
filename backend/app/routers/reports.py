from __future__ import annotations

import csv
import io
import json
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models import Document, Instrument, User
from ..security import decrypt_field, decrypt_number
from ..serializers import STATUS_META

router = APIRouter(prefix="/api/reports", tags=["reports"])

REPORTS = {
    "pending_verifications": "Pending verifications",
    "upcoming_maturities": "Upcoming maturities",
    "missing_documents": "Missing documents",
    "high_risk": "High-risk cases",
}


def _scope(db: Session, user: User):
    query = db.query(Instrument)
    if user.role == "institution":
        query = query.filter(Instrument.institution_id == user.institution_id)
    return query


def _rows(db: Session, user: User, report: str) -> tuple[list[str], list[list]]:
    today = date.today()
    instruments = _scope(db, user).all()

    if report == "pending_verifications":
        rows = [row for row in instruments if row.status in ("submitted", "under_verification")]
        rows.sort(key=lambda r: r.created_at or datetime.min)
        headers = ["Reference", "Institution", "Bank", "Amount", "Status", "Submitted", "Days pending"]
        data = [
            [
                row.reference,
                row.institution.name if row.institution else "",
                row.bank,
                f"{decrypt_number(row.amount_enc):,.2f}",
                STATUS_META.get(row.status, {}).get("label", row.status),
                row.created_at.strftime("%d-%m-%Y") if row.created_at else "",
                max(0, (datetime.utcnow() - row.created_at).days) if row.created_at else 0,
            ]
            for row in rows
        ]
        return headers, data

    if report == "upcoming_maturities":
        rows = [
            row for row in instruments
            if row.maturity_date and 0 <= (row.maturity_date - today).days <= 180
            and row.status not in ("released", "renewed")
        ]
        rows.sort(key=lambda r: r.maturity_date)
        headers = ["Reference", "Institution", "Bank", "Amount", "Maturity", "Days left", "Trust score"]
        data = [
            [
                row.reference,
                row.institution.name if row.institution else "",
                row.bank,
                f"{decrypt_number(row.amount_enc):,.2f}",
                row.maturity_date.strftime("%d-%m-%Y"),
                (row.maturity_date - today).days,
                round(row.trust_score or 0),
            ]
            for row in rows
        ]
        return headers, data

    if report == "missing_documents":
        rows = []
        for instrument in instruments:
            documents = db.query(Document).filter(Document.instrument_id == instrument.id).all()
            if not documents:
                rows.append([instrument.reference, instrument.institution.name if instrument.institution else "",
                             instrument.bank, "No document uploaded", "", ""])
                continue
            latest = sorted(documents, key=lambda d: d.version, reverse=True)[0]
            try:
                extraction = json.loads(decrypt_field(latest.extraction_enc) or "{}")
            except Exception:
                extraction = {}
            missing = extraction.get("missing_fields") or []
            if missing:
                rows.append([
                    instrument.reference,
                    instrument.institution.name if instrument.institution else "",
                    instrument.bank,
                    ", ".join(missing),
                    round(latest.overall_confidence or 0, 2),
                    round(latest.anomaly_score or 0, 2),
                ])
        headers = ["Reference", "Institution", "Bank", "Missing fields", "Confidence", "Anomaly"]
        return headers, rows

    if report == "high_risk":
        rows = [
            row for row in instruments
            if (row.trust_score or 0) < 50 or row.is_flagged or row.status in ("flagged", "matured")
        ]
        rows.sort(key=lambda r: (r.trust_score or 0))
        headers = ["Reference", "Institution", "Bank", "Amount", "Trust", "Status", "Reason"]
        data = [
            [
                row.reference,
                row.institution.name if row.institution else "",
                row.bank,
                f"{decrypt_number(row.amount_enc):,.2f}",
                round(row.trust_score or 0),
                STATUS_META.get(row.status, {}).get("label", row.status),
                (row.flag_reason or "")[:120],
            ]
            for row in rows
        ]
        return headers, data

    raise HTTPException(400, detail={"code": "unknown_report", "message": "Unknown report type."})


@router.get("")
def list_reports(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    items = []
    for key, label in REPORTS.items():
        headers, rows = _rows(db, user, key)
        items.append({"key": key, "label": label, "count": len(rows)})
    return {"items": items}


@router.get("/{report}")
def report_preview(
    report: str,
    limit: int = Query(50, ge=1, le=500),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    headers, rows = _rows(db, user, report)
    return {"report": report, "label": REPORTS.get(report, report), "headers": headers,
            "rows": rows[:limit], "total": len(rows)}


@router.get("/{report}/export")
def export_report(
    report: str,
    format: str = Query("csv", pattern="^(csv|xlsx|pdf)$"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    headers, rows = _rows(db, user, report)
    label = REPORTS.get(report, report).replace(" ", "_").lower()
    stamp = datetime.utcnow().strftime("%Y%m%d-%H%M")
    filename = f"aicte-{label}-{stamp}.{format}"

    if format == "csv":
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(headers)
        writer.writerows(rows)
        return Response(
            content=buffer.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    if format == "xlsx":
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill

        workbook = Workbook()
        sheet = workbook.active
        sheet.title = REPORTS.get(report, report)[:31]
        sheet.append(headers)
        for cell in sheet[1]:
            cell.font = Font(bold=True, color="FFFFFF")
            cell.fill = PatternFill("solid", fgColor="1F4E79")
        for row in rows:
            sheet.append(row)
        for column in sheet.columns:
            width = max((len(str(cell.value)) if cell.value is not None else 0) for cell in column) + 2
            sheet.column_dimensions[column[0].column_letter].width = min(48, max(12, width))
        buffer = io.BytesIO()
        workbook.save(buffer)
        return Response(
            content=buffer.getvalue(),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    from fpdf import FPDF

    pdf = FPDF(orientation="L", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=12)
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 14)
    pdf.cell(0, 8, "AICTE Security Deposit & FDR Management Portal", ln=1)
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(0, 6, f"{REPORTS.get(report, report)} - generated {stamp} UTC", ln=1)
    pdf.ln(2)

    column_count = max(1, len(headers))
    usable = pdf.w - 20
    widths = [usable / column_count] * column_count
    pdf.set_font("Helvetica", "B", 8)
    for header, width in zip(headers, widths):
        pdf.cell(width, 7, str(header)[:28], border=1)
    pdf.ln()
    pdf.set_font("Helvetica", "", 8)
    for row in rows:
        for value, width in zip(row, widths):
            text = str(value)
            if len(text) > 30:
                text = text[:28] + ".."
            pdf.cell(width, 6, text, border=1)
        pdf.ln()
    output = pdf.output()
    return Response(
        content=bytes(output),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
