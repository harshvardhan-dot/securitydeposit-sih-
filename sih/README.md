# AICTE Security Deposit & FDR Management Portal

A working prototype of the AICTE Regulation Bureau portal described in the PRD: institutions
upload security-deposit receipts, an OCR + BERT pipeline reads them, officers verify against a
mock bank, renewals are chased by a configurable reminder ladder, and every action is sealed into
a tamper-evident, digitally signed audit ledger.

Built for the SIH demo: **FastAPI + SQLite** backend, **React + TypeScript** front end, no Docker,
no cloud services, no external database. Everything runs locally in one command.

---

## 1. Quick start

### Requirements

| Tool | Version used |
|------|--------------|
| Python | 3.12 |
| Node.js | 24 (npm 11) |
| Tesseract OCR | optional but recommended ([Windows build](https://github.com/UB-Mannheim/tesseract/wiki)) |
| PyTorch + Transformers | optional (BERT stage); the app falls back to hashed embeddings |

Install the Python packages and the front-end dependencies once:

```powershell
cd backend
pip install -r requirements.txt

cd ..\frontend
npm install
```

### Run it

```powershell
# terminal 1 – API on http://127.0.0.1:8000  (docs at /api/docs)
cd backend
python run.py --port 8000 --reset

# terminal 2 – UI on http://127.0.0.1:5173
cd frontend
npm run dev
```

`--reset` recreates and re-seeds the demo database. Leave it off to keep your data between runs.

Or use the helper script from the repo root:

```powershell
.\start.ps1            # starts both servers in separate windows
.\start.ps1 -Reset     # same, with a fresh database
```

### Single-server build (optional)

The API serves the compiled SPA when `frontend/dist` exists:

```powershell
cd frontend
npm run build
cd ..\backend
python run.py --port 8000          # http://127.0.0.1:8000 serves UI + API
```

### HTTPS / TLS 1.3 (optional)

```powershell
cd backend
python run.py --port 8443 --tls    # self-signed cert generated on first run
```

---

## 2. Demo accounts

Password for every account: **`Aicte@2026`**

Officer, admin and auditor logins require a TOTP code. In the demo the current code is shown on
screen after the password step (and returned by the login API as `demo_hint`), because a judge
does not have the officer's authenticator app.

| Role | Email | Land on |
|------|-------|---------|
| Institution | `principal@sunrise.edu` | Own portfolio, submit FDRs, file release requests |
| Institution | `dean@ganga.edu` | Second institution, for cross-tenant checks |
| Scrutiny Officer | `scrutiny@aicte.gov.in` | Review queue: observations, clarifications |
| Verification Officer | `verify@aicte.gov.in` | Bank verification and activation |
| Competent Authority | `authority@aicte.gov.in` | Final release/refund decisions |
| Administrator | `admin@aicte.gov.in` | Users, settings, audit log, security posture |
| Auditor | `auditor@aicte.gov.in` | Read-only ledger and chain integrity |

The live list is also available at `GET /api/public/demo-accounts`.

---

## 3. Suggested 7-minute demo script

1. **Public tracker** (`/track`) — enter `AICTE-FDR-2026-00002` and show the courier-style
   timeline. Try `AICTE-FDR-2024-00001` to show a clean "not found".
2. **Sign in as an institution** — dashboard tiles, 6-month maturity forecast, state map, chain
   integrity badge, and the live "OCR engine / BERT model" strip.
3. **Submit an FDR** (`/submit`) — drag one of the bundled sample receipts (or any FDR PDF/JPG),
   watch OCR text, per-field confidence and extracted values pre-fill the form. Confirm and
   submit. Show the issued reference ID.
4. **Officer review** — sign in as scrutiny, open the case, record an observation and request a
   clarification; then sign in as verification, run the mock bank check, and activate the FDR.
   Point out the yellow/green/red field source badges and the trust score.
5. **Reminders** — open `/reminders` and run the scheduler cycle by hand; show the 90/30/7-day
   ladder, the in-app/email/SMS/WhatsApp channels and the escalation rules.
6. **Renewal** — from an expiring instrument choose *Renew*, upload the replacement receipt, and
   show the new record linked to its parent with the full history chain.
7. **Release / refund** — as the institution file a release request; walk the four signed steps
   (scrutiny → verification → authority → closure), showing the automatic eligibility checklist
   and the reason + digital-signature requirement at each step.
8. **Audit ledger** (`/ledger`) — show the SHA-256 chain, then use **Demo tamper** to alter a
   sealed block: the chain breaks at that exact block for every viewer. **Heal chain** restores it.
9. **Security posture** (`/security`) — encryption at rest/in transit, MFA coverage, Ed25519
   signatures, RBAC matrix and the honest limitations of the prototype.
10. **Public stand-in** — sign in as the auditor to show read-only access, then as an institution
    and try `/admin`: it renders a 404 because the role does not expose it.

---

## 4. What is implemented

### PRD traceability

| PRD | Where it lives |
|-----|----------------|
| FR-1, FR-2 records & version history | `instruments`, `instrument_versions`, timeline events |
| FR-3 search / filters | server-side filters for institution, bank, status, date; amount range and text search after decryption |
| FR-4, FR-5 upload + encrypted storage | PDF/JPG/PNG upload, AES-256-GCM at rest, `Cache-Control: no-store`, integrity header |
| FR-6 image clean-up | Pillow pipeline (EXIF rotate, de-skew estimate, contrast/grayscale) before OCR |
| FR-7 OCR | Tesseract via `pytesseract` (reports engine + availability in `/api/ai/status`) |
| FR-8 BERT stage | `distilbert-base-multilingual-cased` embeddings for field alignment, duplicate/near-duplicate detection, anomaly scoring; hashed 3-gram fallback |
| FR-9, FR-10 confidence + mismatch | per-field confidence, low-confidence highlighting, entered-vs-extracted comparison |
| FR-11 source badges | every field carries submitted / bank-confirmed / mismatch source |
| FR-12 mock bank API | deterministic adapter; FDR containing `FAIL` → amount mismatch, `404`/`NOTFOUND` → untraceable, otherwise confirmed |
| FR-13 discrepancy flags | missing docs, impossible dates, duplicate FDR numbers, low confidence |
| FR-14 scrutiny | observations + clarification requests, resolvable by the institution |
| Trust score (P1) | configurable weighted 0–100 score, green/amber/red, advisory |
| FR-15–FR-17 maturity, reminders, renewal | in-process daily scheduler, configurable ladder, linked renewal chain |
| FR-18–FR-21 release/refund | request + automatic checklist + four signed workflow steps |
| FR-22, FR-23 channels & escalation | mock in-app/email/SMS/WhatsApp notifications, overdue escalation |
| FR-24–FR-26 dashboard & reports | tiles, 6-month forecast, state map, CSV/XLSX/PDF exports |
| Public tracker | `/track`, status only, no sensitive fields |
| Hash-chain ledger | SHA-256 chained blocks, live integrity indicator, exact break point |
| 3D + animated UI | React Three Fiber vault, Framer Motion transitions, EN/HI toggle |
| Roles | all 7 accounts, least privilege, cross-tenant isolation |

### Roles

Institution · Scrutiny Officer · Verification Officer · Competent Authority · Administrator ·
Auditor. Route guards on the client and `require_roles` checks on every API endpoint; institution
users can only see their own records.

---

## 5. Security design

Confidentiality, integrity, authenticity and access control are deliberately separated:

- **AES-256-GCM** field encryption for amounts and FDR numbers, and for uploaded files at rest.
  Range/text filters run in Python after decryption; no plaintext is written to the DB.
  Keys persist in `backend/data/*.key`.
- **SHA-256 hash chain** over the audit ledger. Each block commits to the previous hash, the action
  payload and the document digest. Verification recomputes from genesis and reports the exact
  broken block.
- **Ed25519** per-officer signing keys. Every decision payload is signed; the public key is stored
  beside the block so anyone can verify non-repudiation. Private keys are sealed with AES-256-GCM.
- **TOTP MFA** mandatory for officers/admin/auditor, plus 30-minute idle timeout and JWT sessions.
- **RBAC** enforced at the router level, with denial events written to the audit log.
- **Transport**: strict security headers (CSP, HSTS under HTTPS, nosniff, frame-deny, referrer and
  permissions policy). `--tls` serves TLS 1.3 with a generated certificate.
- Documents are served with `Cache-Control: no-store` and an `X-Document-Integrity` digest header.

The PRD is explicit that BERT is not an authenticity oracle — it supports extraction, similarity
and anomaly flagging. Authenticity comes from bank confirmation plus officer scrutiny, which is
how the workflow is wired.

---

## 6. Architecture

```
frontend/                  React 19 + TypeScript + Vite + Tailwind v4
  src/pages/               dashboard, vault, register, submit, review, requests,
                           reminders, reports, institutions, ledger, admin,
                           security, public tracker, login
  src/components/          layout, UI kit, charts, 3D vault
  src/context/             auth (idle timeout) + toasts
  src/lib/                 typed API client, formatters, i18n

backend/
  app/
    routers/               auth, instruments, documents, requests, reminders,
                           dashboard, ledger, reports, institutions, admin, ai, public
    services/
      extraction.py        image clean-up → Tesseract OCR → BERT alignment → fields
      bert.py              DistilBERT embeddings with hashed n-gram fallback
      bank.py              deterministic mock bank adapter
      checklist.py         release eligibility checklist
      trust.py             configurable trust score
      scheduler.py         maturity scan + reminder ladder
      reminders.py         mock channel gateways
      notifications.py     in-app notification feed
    security.py            AES-256-GCM, Ed25519, TOTP, hashing, JWT helpers
    ledger.py              hash chain append / verify / stats
    seed.py                demo institutions, users, instruments, documents
  scripts/smoke.py         49-check end-to-end API suite
  run.py                   launcher (--reset, --tls, --port, --reload)
```

Storage is SQLite (`backend/data/aicte.db`), uploads are encrypted under `backend/data/uploads`,
and demo receipts live in `backend/data/samples`. A background task runs the reminder cycle every
five minutes; there is no Celery/Redis dependency.

### AI stack

The extraction path is intentionally inspectable:

1. **Clean-up** — EXIF rotation, grayscale/contrast, light de-skew estimate.
2. **OCR** — Tesseract with an embedded PDF text-layer fallback for born-digital receipts.
3. **BERT** — `distilbert-base-multilingual-cased` produces 768-dim embeddings. Field prototypes
   are compared by cosine similarity to align OCR lines to fields; document embeddings detect
   near-duplicates across institutions.
4. **Rules / lexicon NER** — bank names, IFSC-like tokens, dates, amount patterns, with a per-field
   confidence blend.
5. **Fallback** — if torch/transformers are unavailable, a deterministic hashed 3-gram encoder keeps
   intake working instead of failing the upload.

`GET /api/ai/status` reports the engine, model id, dimensions, device and whether the real BERT
model is active.

> **Windows note:** if torch fails to import with a missing `vcruntime140_threads.dll`, copy that
> DLL from Visual Studio Code's LLDB folder into `site-packages/torch/lib/` (the prototype was
> verified with this fix), or simply let the hashed fallback run.

---

## 7. Tests

With the API running:

```powershell
cd backend
python scripts/smoke.py
```

The suite exercises the full journey and currently reports **49 checks passed, 0 failed**:
health, demo accounts, all role logins with MFA, RBAC denials, dashboard tiles and forecast, vault
payload, chain verification, OCR + BERT extraction, upload dedupe, submit, observation,
clarification, bank verification, activation, signature proof, timeline, renewal link, release
checklist and four-step workflow, CSV/XLSX/PDF exports, security posture, tamper and heal.

---

## 8. Honest limitations

- The bank adapter is mocked deterministically; a real integration needs signed, reconciled bank
  responses and formal authorization.
- Keys live in local files for portability. Production needs an HSM or managed KMS with rotation.
- SQLite is single-node; Postgres with row-level security is the production shape.
- The hash chain is a single append-only chain, not a permissioned network (Hyperledger Fabric is
  the PRD's production path).
- OCR confidence is advisory and a human officer remains the decision-maker.
- Email/SMS/WhatsApp delivery is mocked and appears in the in-app notification feed.
- The prototype intentionally ships with demo accounts and an on-screen TOTP hint.
