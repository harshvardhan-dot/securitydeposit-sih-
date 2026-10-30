"""Demo data: 6 institutions, all 7 roles, ~16 instruments, a renewal chain,
a duplicate alert, a release workflow and a populated hash chain.

All receipts are synthetic. Nothing here is real institutional data.
"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta

from .config import DEFAULT_REMINDER_LADDER, DEFAULT_TRUST_WEIGHTS
from .database import SessionLocal
from .ledger import append_block
from .models import (
    Document,
    Instrument,
    Institution,
    Observation,
    ReleaseRequest,
    RequestStep,
    User,
    Verification,
)
from .security import (
    encrypt_field,
    generate_signing_keypair,
    generate_totp_secret,
    hash_password,
    normalize_number,
    sha256_hex,
    sign_with_user_key,
)
from .serializers import REQUEST_STEPS
from .services import notifications
from .services.checklist import build_checklist, checklist_summary
from .services.extraction import analyze_document
from .services.samples import make_fdr_pdf
from .services.scoring import recalculate
from .services.scheduler import run_cycle
from .services.settings import set_setting
from .services.storage import store_encrypted

PASSWORD = "Aicte@2026"


def _user(db, *, email, name, role, institution=None, mfa=False, phone=None) -> User:
    public_key, sealed = generate_signing_keypair()
    user = User(
        email=email,
        name=name,
        role=role,
        institution_id=institution.id if institution else None,
        password_hash=hash_password(PASSWORD),
        phone=phone,
        language="en",
        public_key=public_key,
        private_key_enc=sealed,
        key_id=f"ed25519-{email.split('@')[0][:16]}",
    )
    if mfa:
        user.mfa_secret_enc = encrypt_field(generate_totp_secret())
        user.mfa_enabled = True
    db.add(user)
    db.flush()
    return user


def _document(db, *, instrument, actor, pdf: bytes, filename: str) -> Document:
    digest = sha256_hex(pdf)
    analysis = analyze_document(pdf, "application/pdf")
    document = Document(
        instrument_id=instrument.id,
        original_name=filename,
        mime="application/pdf",
        size_bytes=len(pdf),
        sha256=digest,
        storage_path=store_encrypted(pdf, digest),
        ocr_text_enc=encrypt_field(analysis["text_preview"]),
        extraction_enc=encrypt_field(
            json.dumps(
                {
                    "fields": analysis["fields"],
                    "quality": analysis["quality"],
                    "warnings": analysis["warnings"],
                    "anomaly_reasons": analysis["anomaly_reasons"],
                    "engine": analysis["engine"],
                    "embedding_model": analysis["embedding_model"],
                    "text_preview": analysis["text_preview"],
                    "text_length": analysis["text_length"],
                    "missing_fields": analysis["missing_fields"],
                    "duplicates": [],
                    "fdr_number_hash": instrument.fdr_number_hash,
                }
            )
        ),
        embedding_json=json.dumps(analysis["embedding"]),
        quality_json=analysis["quality"],
        anomaly_score=analysis["anomaly_score"],
        overall_confidence=analysis["confidence"],
        version=1,
        uploaded_by=actor.id,
    )
    db.add(document)
    db.flush()
    return document


def _instrument(
    db,
    *,
    actor,
    institution,
    bank,
    branch,
    fdr_number,
    amount,
    issue_date,
    maturity_date,
    status="active",
    verified=False,
    approved=False,
    flag_reason=None,
    parent=None,
    officer_verify=None,
    officer_approve=None,
    mismatch=False,
    with_document=True,
) -> Instrument:
    from .models import utcnow

    instrument = Instrument(
        reference="pending",
        institution_id=institution.id,
        fdr_number_enc=encrypt_field(fdr_number),
        fdr_number_hash=sha256_hex(normalize_number(fdr_number)),
        amount_enc=encrypt_field(f"{amount:.2f}"),
        bank=bank,
        branch=branch,
        issue_date=issue_date,
        maturity_date=maturity_date,
        status=status,
        is_flagged=bool(flag_reason),
        flag_reason=flag_reason,
        parent_instrument_id=parent.id if parent else None,
        created_by=actor.id,
        created_at=utcnow() - timedelta(days=20),
        verified_at=utcnow() - timedelta(days=18) if verified else None,
    )
    db.add(instrument)
    db.flush()
    instrument.reference = f"AICTE-FDR-{issue_date.year}-{instrument.id:05d}"

    document = None
    if with_document:
        pdf = make_fdr_pdf(
            bank=bank, branch=branch, fdr_number=fdr_number, issue_date=issue_date,
            maturity_date=maturity_date, amount=amount, depositor=institution.name,
            aicte_id=institution.aicte_id,
        )
        document = _document(
            db, instrument=instrument, actor=actor, pdf=pdf,
            filename=f"{fdr_number.replace('/', '-')}.pdf",
        )

    append_block(
        db,
        "instrument.renewed" if parent else "instrument.submitted",
        actor=actor,
        instrument_id=instrument.id,
        document_hash=document.sha256 if document else None,
        payload={
            "reference": instrument.reference,
            "bank": bank,
            "amount": f"{amount:.2f}",
            "maturity_date": maturity_date.isoformat(),
            "parent": parent.reference if parent else None,
        },
    )

    if verified and officer_verify:
        result = get_adapter_result(instrument, fdr_number, amount, mismatch)
        db.add(
            Verification(
                instrument_id=instrument.id,
                source="bank",
                result=result["result"],
                detail_json=result,
                officer_id=officer_verify.id,
            )
        )
        append_block(
            db,
            "verification.bank",
            actor=officer_verify,
            instrument_id=instrument.id,
            payload={"reference": instrument.reference, "result": result["result"],
                     "bank_reference": result["bank_reference"], "adapter": result["adapter"]},
        )

    if approved and officer_approve:
        instrument.status = "active"
        append_block(
            db, "instrument.approved", actor=officer_approve, instrument_id=instrument.id,
            payload={"reference": instrument.reference, "from": "bank_confirmed", "to": "active"},
        )

    if mismatch and officer_verify:
        instrument.is_flagged = True
        instrument.flag_reason = "Bank records show a different deposit amount for this receipt."

    recalculate(db, instrument, commit=False)
    db.commit()
    db.refresh(instrument)
    return instrument


def get_adapter_result(instrument, fdr_number, amount, force_mismatch=False):
    from .services.bank import get_adapter

    result = get_adapter().verify(instrument, fdr_number, amount)
    if force_mismatch:
        result["result"] = "mismatch"
        result["notes"] = "Bank records show a different deposit amount for this receipt."
        result["bank_amount"] = round(amount * 0.9, 2)
    return result


def seed(db) -> None:
    today = date.today()
    set_setting(db, "reminder_ladder", DEFAULT_REMINDER_LADDER)
    set_setting(db, "trust_weights", DEFAULT_TRUST_WEIGHTS)
    set_setting(db, "verification_overdue_days", 3)
    set_setting(db, "clarification_overdue_days", 5)

    institutions = {}
    for key, name, aicte_id, state, city, email, phone in [
        ("sunrise", "Sunrise Institute of Technology", "1-1234567", "Maharashtra", "Pune", "principal@sunrise.edu", "+91 20 2567 8901"),
        ("ganga", "Ganga College of Engineering", "1-2345678", "Uttar Pradesh", "Varanasi", "dean@ganga.edu", "+91 542 220 1122"),
        ("deccan", "Deccan Institute of Science", "1-3456789", "Telangana", "Hyderabad", "registrar@deccan.edu", "+91 40 2345 6789"),
        ("nilgiri", "Nilgiri Polytechnic", "1-4567890", "Tamil Nadu", "Coimbatore", "office@nilgiri.edu", "+91 422 245 3311"),
        ("brahmaputra", "Brahmaputra Technical University", "1-5678901", "Assam", "Guwahati", "registrar@btu.ac.in", "+91 361 257 8899"),
        ("thar", "Thar Institute of Management", "1-6789012", "Rajasthan", "Jodhpur", "admin@thar.edu", "+91 291 251 4433"),
    ]:
        institution = Institution(name=name, aicte_id=aicte_id, state=state, city=city,
                                  contact_email=email, contact_phone=phone)
        db.add(institution)
        db.flush()
        institutions[key] = institution

    bureau = institutions["sunrise"]
    principal = _user(db, email="principal@sunrise.edu", name="Dr. Meera Joshi", role="institution", institution=bureau)
    dean = _user(db, email="dean@ganga.edu", name="Prof. Rakesh Verma", role="institution", institution=institutions["ganga"])
    registrar_deccan = _user(db, email="registrar@deccan.edu", name="Dr. Sana Rao", role="institution", institution=institutions["deccan"])
    nilgiri_user = _user(db, email="office@nilgiri.edu", name="M. Karthik", role="institution", institution=institutions["nilgiri"])
    btu_user = _user(db, email="registrar@btu.ac.in", name="P. Das", role="institution", institution=institutions["brahmaputra"])
    thar_user = _user(db, email="admin@thar.edu", name="V. Singh", role="institution", institution=institutions["thar"])

    scrutiny = _user(db, email="scrutiny@aicte.gov.in", name="A. K. Sharma", role="scrutiny_officer", institution=None, mfa=True)
    verification = _user(db, email="verify@aicte.gov.in", name="S. Nair", role="verification_officer", institution=None, mfa=True)
    authority = _user(db, email="authority@aicte.gov.in", name="Dr. R. Iyer", role="competent_authority", institution=None, mfa=True)
    admin = _user(db, email="admin@aicte.gov.in", name="System Administrator", role="admin", institution=None, mfa=True)
    _user(db, email="auditor@aicte.gov.in", name="Internal Auditor", role="auditor", institution=None, mfa=True)
    db.commit()

    # --- healthy, active portfolio
    _instrument(db, actor=principal, institution=bureau, bank="State Bank of India",
                branch="Pune Camp Branch", fdr_number="SBI/2024/884213", amount=2500000,
                issue_date=today - timedelta(days=410), maturity_date=today + timedelta(days=95),
                status="active", verified=True, officer_verify=verification)

    _instrument(db, actor=principal, institution=bureau, bank="HDFC Bank",
                branch="Baner Road Branch", fdr_number="HDFC/FD/7721901", amount=1250000,
                issue_date=today - timedelta(days=300), maturity_date=today + timedelta(days=42),
                status="active", verified=True, officer_verify=verification)

    canara = _instrument(db, actor=dean, institution=institutions["ganga"], bank="Canara Bank",
                         branch="Varanasi Cantt Branch", fdr_number="CNR/FDR/2023/55120", amount=800000,
                         issue_date=today - timedelta(days=760), maturity_date=today - timedelta(days=20),
                         status="matured")

    pnb = _instrument(db, actor=dean, institution=institutions["ganga"], bank="Punjab National Bank",
                      branch="Lanka Branch", fdr_number="PNB/FDR/2025/118842", amount=4000000,
                      issue_date=today - timedelta(days=180), maturity_date=today + timedelta(days=400),
                      status="bank_confirmed", verified=True, officer_verify=verification)

    bob = _instrument(db, actor=dean, institution=institutions["ganga"], bank="Bank of Baroda",
                      branch="Godowlia Branch", fdr_number="BARB/FDR/2025/660012", amount=3000000,
                      issue_date=today - timedelta(days=200), maturity_date=today + timedelta(days=200),
                      status="under_verification", verified=False)

    icici = _instrument(db, actor=registrar_deccan, institution=institutions["deccan"], bank="ICICI Bank",
                        branch="Gachibowli Branch", fdr_number="ICICI/FDR/2025/993241", amount=5500000,
                        issue_date=today - timedelta(days=150), maturity_date=today + timedelta(days=300),
                        status="active", verified=True, approved=True,
                        officer_verify=verification, officer_approve=scrutiny)

    axis = _instrument(db, actor=registrar_deccan, institution=institutions["deccan"], bank="Axis Bank",
                       branch="Banjara Hills Branch", fdr_number="AXIS/FD/2025/447120", amount=1800000,
                       issue_date=today - timedelta(days=90), maturity_date=today + timedelta(days=6),
                       status="active", verified=True, officer_verify=verification)

    indian = _instrument(db, actor=nilgiri_user, institution=institutions["nilgiri"], bank="Indian Bank",
                         branch="RS Puram Branch", fdr_number="IB/FDR/2024/332211", amount=650000,
                         issue_date=today - timedelta(days=600), maturity_date=today + timedelta(days=30),
                         status="active", verified=True, officer_verify=verification)

    union = _instrument(db, actor=nilgiri_user, institution=institutions["nilgiri"], bank="Union Bank of India",
                        branch="Town Hall Branch", fdr_number="UB/FDR/2023/99887", amount=900000,
                        issue_date=today - timedelta(days=800), maturity_date=today - timedelta(days=60),
                        status="matured")

    uco = _instrument(db, actor=btu_user, institution=institutions["brahmaputra"], bank="UCO Bank",
                      branch="Pan Bazaar Branch", fdr_number="UCO/FDR/2025/120034", amount=750000,
                      issue_date=today - timedelta(days=100), maturity_date=today + timedelta(days=500),
                      status="submitted")

    kotak = _instrument(db, actor=thar_user, institution=institutions["thar"], bank="Kotak Mahindra Bank",
                        branch="Ratanada Branch", fdr_number="KOTAK/FD/2025/667788", amount=1500000,
                        issue_date=today - timedelta(days=120), maturity_date=today + timedelta(days=250),
                        status="active", verified=True, officer_verify=verification)

    # --- duplicate FDR number across two institutions (officer alert)
    duplicate = _instrument(
        db, actor=registrar_deccan, institution=institutions["deccan"], bank="State Bank of India",
        branch="Pune Camp Branch", fdr_number="SBI/2024/884213", amount=2500000,
        issue_date=today - timedelta(days=405), maturity_date=today + timedelta(days=100),
        status="under_verification",
        flag_reason="Duplicate FDR number also recorded on AICTE-FDR-2024-00001 (Sunrise Institute of Technology). Officer review required.",
    )

    # --- bank mismatch case
    mismatch = _instrument(
        db, actor=btu_user, institution=institutions["brahmaputra"], bank="Yes Bank",
        branch="Zoo Road Branch", fdr_number="YES/FD/2025/441190", amount=2200000,
        issue_date=today - timedelta(days=130), maturity_date=today + timedelta(days=320),
        status="flagged", verified=True, mismatch=True, officer_verify=verification,
    )

    # --- renewal chain
    parent = _instrument(
        db, actor=nilgiri_user, institution=institutions["nilgiri"], bank="Canara Bank",
        branch="Gandhipuram Branch", fdr_number="CNR/FDR/2022/110045", amount=500000,
        issue_date=today - timedelta(days=1100), maturity_date=today - timedelta(days=5),
        status="matured",
    )
    child = _instrument(
        db, actor=nilgiri_user, institution=institutions["nilgiri"], bank="Canara Bank",
        branch="Gandhipuram Branch", fdr_number="CNR/FDR/2026/220120", amount=550000,
        issue_date=today - timedelta(days=25), maturity_date=today + timedelta(days=705),
        status="active", verified=True, officer_verify=verification, parent=parent,
    )
    parent.status = "renewed"
    append_block(db, "instrument.renewal_linked", actor=nilgiri_user, instrument_id=parent.id,
                 payload={"parent": parent.reference, "renewed_by": child.reference})
    db.commit()

    # --- released instrument with a closed request
    released = _instrument(
        db, actor=thar_user, institution=institutions["thar"], bank="Bank of India",
        branch="Mandore Branch", fdr_number="BOI/FDR/2023/770015", amount=1000000,
        issue_date=today - timedelta(days=900), maturity_date=today + timedelta(days=120),
        status="active", verified=True, officer_verify=verification,
    )
    released_request = ReleaseRequest(
        instrument_id=released.id, type="release", status="closed",
        reason="Institution has closed the programme for which the security deposit was held.",
        decision="approve", decision_reason="All clearance conditions met. Approved for release.",
        created_by=thar_user.id, signed_by=authority.id,
        created_at=datetime.utcnow() - timedelta(days=14),
        updated_at=datetime.utcnow() - timedelta(days=9),
        decided_at=datetime.utcnow() - timedelta(days=9),
        closed_at=datetime.utcnow() - timedelta(days=9),
    )
    db.add(released_request)
    db.flush()
    for step in REQUEST_STEPS:
        db.add(RequestStep(request_id=released_request.id, step=step,
                           status="completed", owner_id=authority.id, acted_at=datetime.utcnow() - timedelta(days=9)))
    checklist = checklist_summary(build_checklist(db, released, released_request))
    released_request.checklist = checklist["items"]
    signature_payload = {
        "request_id": released_request.id, "instrument": released.reference,
        "step": "authority", "next": "closed", "decision": "approve",
        "reason": released_request.decision_reason, "signer_id": authority.id,
        "signer_name": authority.name, "at": released_request.decided_at.isoformat(),
    }
    released_request.signature = sign_with_user_key(authority.private_key_enc, signature_payload)
    released.status = "released"
    released.released_at = datetime.utcnow() - timedelta(days=9)
    db.commit()
    append_block(db, "request.created", actor=thar_user, instrument_id=released.id,
                 payload={"request_id": released_request.id, "reference": released.reference,
                          "type": "release", "reason": released_request.reason})
    append_block(db, "request.closed", actor=authority, instrument_id=released.id,
                 payload={"request_id": released_request.id, "reference": released.reference,
                          "decision": "approve", "reason": released_request.decision_reason,
                          "signature": released_request.signature})

    # --- in-flight release request (workflow demo)
    in_flight = ReleaseRequest(
        instrument_id=icici.id, type="release", status="verification",
        reason="Security deposit no longer required after the programme completed its final AICTE review.",
        created_by=registrar_deccan.id,
        created_at=datetime.utcnow() - timedelta(days=6),
        updated_at=datetime.utcnow() - timedelta(days=2),
    )
    db.add(in_flight)
    db.flush()
    step_states = {"requested": "completed", "scrutiny": "completed", "verification": "in_progress",
                   "authority": "pending", "closed": "pending"}
    for step in REQUEST_STEPS:
        db.add(RequestStep(request_id=in_flight.id, step=step, status=step_states[step],
                           owner_id=scrutiny.id if step in ("requested", "scrutiny") else None,
                           note="Checklist verified." if step == "scrutiny" else None,
                           acted_at=datetime.utcnow() - timedelta(days=4) if step in ("requested", "scrutiny") else None))
    icici.status = "release_requested"
    checklist = checklist_summary(build_checklist(db, icici, in_flight))
    in_flight.checklist = checklist["items"]
    db.commit()
    append_block(db, "request.created", actor=registrar_deccan, instrument_id=icici.id,
                 payload={"request_id": in_flight.id, "reference": icici.reference, "type": "release",
                          "reason": in_flight.reason})
    append_block(db, "request.scrutiny", actor=scrutiny, instrument_id=icici.id,
                 payload={"request_id": in_flight.id, "decision": "advance",
                          "reason": "Documents in order, forwarded to verification."})
    notifications.notify_officers(
        db, "Release request awaiting verification", f"{icici.reference} needs bank verification to proceed.",
        "info", f"/requests/{in_flight.id}",
    )

    # --- officer observation / clarification
    db.add(Observation(instrument_id=bob.id, officer_id=scrutiny.id,
                       remark="Please upload the bank's interest credit statement for the last financial year.",
                       clarification_requested=True))
    append_block(db, "observation.recorded", actor=scrutiny, instrument_id=bob.id,
                 payload={"reference": bob.reference, "remark": "Interest credit statement requested.",
                          "clarification": True})
    notifications.notify_institution(
        db, bob.institution_id, f"Clarification requested - {bob.reference}",
        "Please upload the bank's interest credit statement.", "warning", f"/instruments/{bob.id}",
    )
    db.commit()

    # reminders, escalations and status refresh
    run_cycle(db)

    for instrument in db.query(Instrument).all():
        recalculate(db, instrument, commit=False)
    db.commit()

    print(
        "\n[seed] demo data ready\n"
        f"  institutions : 6\n"
        f"  users        : 11 (password {PASSWORD})\n"
        f"  instruments  : {db.query(Instrument).count()}\n"
        f"  documents    : {db.query(Document).count()}\n"
        f"  ledger blocks: see /api/ledger/verify\n"
    )


def seed_if_empty() -> None:
    db = SessionLocal()
    try:
        if db.query(User).count() > 0:
            return
        seed(db)
    except Exception as exc:  # pragma: no cover
        db.rollback()
        print(f"[seed] failed: {exc}")
        raise
    finally:
        db.close()
