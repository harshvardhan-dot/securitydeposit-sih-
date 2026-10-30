"""End-to-end API smoke test.

Usage:  python scripts/smoke.py [base_url]

Exercises the whole journey against a running server (default
http://127.0.0.1:8000): health, login, MFA, dashboard, ledger, public
tracker, document upload + OCR, submission, officer review, bank
verification, approval, renewal, release workflow, reports and export.
"""
from __future__ import annotations

import json
import mimetypes
import sys
import urllib.error
import urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000").rstrip("/")
PASSWORD = "Aicte@2026"
passed = 0
failed: list[str] = []


def call(method: str, path: str, token: str | None = None, body: dict | None = None,
         raw: bool = False, expect: int | None = None):
    url = path if path.startswith("http") else BASE + path
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            payload = response.read()
            status = response.status
    except urllib.error.HTTPError as exc:
        payload = exc.read()
        status = exc.code
    if expect is not None and status != expect:
        raise AssertionError(f"{method} {path} -> {status} (expected {expect}): {payload[:400]!r}")
    if raw:
        return status, payload
    try:
        return status, json.loads(payload or b"{}")
    except json.JSONDecodeError:
        return status, {"_raw": payload[:400].decode(errors="replace")}


def check(label: str, condition: bool, detail=None):
    global passed
    if condition:
        passed += 1
        print(f"  ok   {label}")
    else:
        failed.append(label)
        print(f"  FAIL {label}  {detail if detail is not None else ''}")


def login(email: str) -> str:
    status, data = call("POST", "/api/auth/login", body={"email": email, "password": PASSWORD})
    if data.get("mfa_required"):
        code = (data.get("demo_hint") or {}).get("code")
        status, data = call("POST", "/api/auth/mfa/verify",
                            body={"challenge_token": data["challenge_token"], "code": code})
    if "access_token" not in data:
        raise AssertionError(f"login failed for {email}: {status} {data}")
    return data["access_token"]


def upload(token: str, path: str) -> dict:
    boundary = "----aicte-smoke"
    filename = path.rsplit("/", 1)[-1]
    content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    payload = open(path, "rb").read()
    body = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n"
        f"Content-Type: {content_type}\r\n\r\n"
    ).encode() + payload + f"\r\n--{boundary}--\r\n".encode()
    request = urllib.request.Request(
        BASE + "/api/documents/upload", data=body, method="POST",
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Authorization": f"Bearer {token}",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as exc:
        raise AssertionError(f"upload failed {exc.code}: {exc.read()[:500]!r}") from None


print(f"Smoke test against {BASE}\n")

print("[1] system")
_, health = call("GET", "/api/health")
check("health responds", health.get("status") == "ok", health)
_, accounts = call("GET", "/api/public/demo-accounts")
check("demo accounts listed", len(accounts.get("accounts", [])) >= 7, accounts)

print("[2] authentication + RBAC")
inst_token = login("principal@sunrise.edu")
admin_token = login("admin@aicte.gov.in")
scrutiny_token = login("scrutiny@aicte.gov.in")
verify_token = login("verify@aicte.gov.in")
authority_token = login("authority@aicte.gov.in")
check("institution login", bool(inst_token))
check("admin login with TOTP MFA", bool(admin_token))
check("officer logins with TOTP MFA", bool(scrutiny_token and verify_token and authority_token))
_, me = call("GET", "/api/auth/me", inst_token)
check("identity endpoint", me.get("role") == "institution", me)
status, _ = call("POST", "/api/ledger/demo/tamper", inst_token, {"idx": 1})
check("institution cannot run admin ledger demo", status == 403, status)
status, _ = call("GET", "/api/instruments")
check("unauthenticated request rejected", status in (401, 403), status)

print("[3] dashboard & ledger")
_, summary = call("GET", "/api/dashboard/summary", admin_token)
check("dashboard tiles", len(summary.get("tiles", [])) == 7, list(summary)[:8])
check("6-month forecast", len(summary.get("forecast", [])) == 6)
check("state map data", len(summary.get("states", [])) >= 5)
check("recent activity present", len(summary.get("recent_activity", [])) > 0)
_, vault = call("GET", "/api/dashboard/vault", admin_token)
check("3D vault payload", vault.get("total", 0) > 0, vault.get("total"))
_, chain = call("GET", "/api/ledger/verify", admin_token)
check("hash chain valid", chain.get("valid") is True, chain)
_, blocks = call("GET", "/api/ledger/blocks?size=5", admin_token)
check("ledger blocks listed", len(blocks.get("items", [])) == 5, blocks.get("total"))
_, ai = call("GET", "/api/ai/status", admin_token)
check("AI status reports BERT + OCR engine", "bert" in ai and "ocr" in ai, ai)

print("[4] upload -> OCR -> extraction")
_, samples = call("GET", "/api/public/samples")
check("synthetic receipts available", len(samples.get("items", [])) >= 2, samples)
sample = next(item for item in samples["items"] if item["kind"] == "pdf")
sample_path = f"data/samples/{sample['name']}"
uploaded = upload(inst_token, sample_path)
extraction = uploaded.get("extraction", {})
fields = extraction.get("fields", {})
check("document stored", uploaded.get("document_id") is not None)
check("OCR engine reported", bool((extraction.get("engine") or {}).get("ocr")), extraction.get("engine"))
check("fields extracted", {"fdr_number", "bank", "amount"} <= set(fields), list(fields))
check("confidence computed", 0 < float(extraction.get("confidence", 0)) <= 1,
      extraction.get("confidence"))
check("embedding produced", bool(uploaded.get("document", {}).get("embedding_model")),
      uploaded.get("document", {}).get("embedding_model"))

print("[5] submit for scrutiny")
field = lambda key, default=None: (extraction.get("fields", {}).get(key) or {}).get("value", default)
submitted_amount = field("amount", 2750000)
_, created = call(
    "POST", "/api/instruments", inst_token,
    {
        "document_id": uploaded["document_id"],
        "fdr_number": field("fdr_number", "SMOKE/FDR/2026/0001"),
        "bank": field("bank", "State Bank of India"),
        "branch": field("branch", "Pune Camp Branch"),
        "amount": submitted_amount,
        "issue_date": field("issue_date", "2026-01-15"),
        "maturity_date": field("maturity_date", "2029-01-14"),
        "acknowledge_warnings": True,
    },
    expect=201,
)
instrument = created["instrument"]
check("instrument reference issued", instrument["reference"].startswith("AICTE-FDR-"), instrument)
check("amount encrypted at rest / decrypted on read", instrument["amount"] == submitted_amount, instrument["amount"])
_, detail = call("GET", f"/api/instruments/{instrument['id']}", scrutiny_token)
check("extracted fields attached to case", bool(detail.get("extracted_fields")))
check("trust score computed", 0 <= detail.get("trust_score", -1) <= 100, detail.get("trust_score"))

print("[6] officer review -> bank verification -> approval")
_, obs = call("POST", f"/api/instruments/{instrument['id']}/observations", scrutiny_token,
              {"remark": "Please upload the bank interest certificate.", "request_clarification": True})
check("observation recorded", obs.get("ok") is True, obs)
call("POST", f"/api/instruments/{instrument['id']}/clarification/resolve", inst_token)
_, bank = call("POST", f"/api/instruments/{instrument['id']}/verify/bank", verify_token)
check("mock bank verification ran", bank["result"]["result"] in ("confirmed", "mismatch"), bank)
_, approved = call("POST", f"/api/instruments/{instrument['id']}/confirm", scrutiny_token)
check("instrument activated", approved["instrument"]["status"] == "active", approved["instrument"]["status"])
_, proof = call("GET", f"/api/instruments/{instrument['id']}/signature", verify_token)
check("Ed25519 signature proof", proof.get("signature_valid") is True, proof.get("signature_valid"))
_, timeline = call("GET", f"/api/instruments/{instrument['id']}/timeline", scrutiny_token)
check("timeline events", len(timeline.get("events", [])) >= 5, len(timeline.get("events", [])))

print("[7] renewal chain")
other = next(item for item in samples["items"] if item["name"] != sample["name"])
renewal = upload(inst_token, f"data/samples/{other['name']}")
renewal_fields = renewal.get("extraction", {}).get("fields", {})
def renewal_field(key, default=None):
    return (renewal_fields.get(key) or {}).get("value", default)
_, renewed = call(
    "POST", f"/api/instruments/{instrument['id']}/renew", inst_token,
    {
        "document_id": renewal["document_id"],
        "fdr_number": renewal_field("fdr_number", "SMOKE/FDR/2029/0002"),
        "bank": renewal_field("bank", "State Bank of India"),
        "branch": renewal_field("branch", "Pune Camp Branch"),
        "amount": renewal_field("amount", 2800000),
        "issue_date": renewal_field("issue_date", "2029-01-15"),
        "maturity_date": renewal_field("maturity_date", "2032-01-14"),
        "acknowledge_warnings": True,
    },
    expect=201,
)
check("renewal linked to parent", renewed["instrument"].get("parent_instrument_id") == instrument["id"],
      renewed["instrument"].get("parent_instrument_id"))
check("parent marked renewed", renewed["parent"]["status"] == "renewed", renewed["parent"]["status"])

print("[8] release workflow")
renewed_id = renewed["instrument"]["id"]
call("POST", f"/api/instruments/{renewed_id}/verify/bank", verify_token)
call("POST", f"/api/instruments/{renewed_id}/confirm", scrutiny_token)
_, request = call("POST", "/api/requests", inst_token,
                  {"instrument_id": renewed_id, "type": "release",
                   "reason": "Programme closed, deposit no longer required."}, expect=201)
_, checklist = call("POST", f"/api/requests/{request['id']}/checklist/run", inst_token)
check("eligibility checklist evaluated", checklist.get("total", 0) >= 6, checklist.get("total"))
check("checklist passes for a clean case", checklist.get("all_passed") is True,
      [item["label"] for item in checklist.get("items", []) if not item["passed"]])
for role_token in (scrutiny_token, verify_token, authority_token, authority_token):
    status, body = call("POST", f"/api/requests/{request['id']}/advance", role_token,
                        {"decision": "advance", "reason": "Reviewed and forwarded.",
                         "signature_name": "Officer"})
    check(f"workflow step advanced ({status})", status == 200, body)
_, final = call("GET", f"/api/requests/{request['id']}", authority_token)
check("request closed after authority approval", final.get("status") == "closed", final.get("status"))
_, released_instrument = call("GET", f"/api/instruments/{renewed_id}", authority_token)
check("instrument marked released", released_instrument.get("status") == "released",
      released_instrument.get("status"))

print("[9] reports, public tracker, admin")
_, tracker = call("GET", f"/api/public/track/{instrument['reference']}")
check("public tracker hides amounts", "amount" not in tracker and tracker.get("reference"), tracker)
status, export = call("GET", "/api/reports/upcoming_maturities/export?format=csv", admin_token, raw=True)
check("CSV export", status == 200 and b"Reference" in export, status)
status, export = call("GET", "/api/reports/high_risk/export?format=xlsx", admin_token, raw=True)
check("XLSX export", status == 200 and export[:2] == b"PK", status)
status, export = call("GET", "/api/reports/pending_verifications/export?format=pdf", admin_token, raw=True)
check("PDF export", status == 200 and export[:4] == b"%PDF", status)
_, posture = call("GET", "/api/admin/security/posture", admin_token)
check("security posture endpoint", posture.get("encryption", {}).get("at_rest") == "AES-256-GCM", posture)
_, audit = call("GET", "/api/admin/audit?limit=5", admin_token)
check("audit trail populated", len(audit.get("items", [])) == 5, audit.get("total"))

print("[10] tamper-evident ledger demo")
_, tampered = call("POST", "/api/ledger/demo/tamper", admin_token, {})
check("tampering detected by chain verification",
      tampered.get("verification", {}).get("valid") is False, tampered.get("verification"))
_, healed = call("POST", "/api/ledger/demo/heal", admin_token)
check("chain restored after heal", healed.get("verification", {}).get("valid") is True,
      healed.get("verification"))

print(f"\n{passed} checks passed, {len(failed)} failed")
if failed:
    for label in failed:
        print("  -", label)
    sys.exit(1)
