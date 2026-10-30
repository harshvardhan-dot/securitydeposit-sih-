import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  CalendarClock,
  CircleCheckBig,
  CloudUpload,
  FileText,
  FingerprintPattern,
  Hash,
  Landmark,
  LockKeyhole,
  RefreshCw,
  RotateCw,
  ScanLine,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import clsx from 'clsx'
import { apiGet, apiPost, errorMessage, uploadFile } from '../lib/api'
import { bytes, currency, dateLabel, shortHash } from '../lib/format'
import type { ExtractedField, InstrumentDetail, SampleDocument, UploadResult } from '../lib/types'
import { Badge, EmptyState, Field, PageHeader, Panel, SectionHeading } from '../components/ui'

const FIELD_LABELS: Record<string, string> = {
  fdr_number: 'FDR number',
  bank: 'Bank name',
  amount: 'Deposit amount',
  issue_date: 'Issue date',
  maturity_date: 'Maturity date',
  branch: 'Branch',
  institution: 'Institution',
}

interface FormState {
  fdr_number: string
  bank: string
  branch: string
  amount: string
  issue_date: string
  maturity_date: string
}

const EMPTY_FORM: FormState = {
  fdr_number: '',
  bank: '',
  branch: '',
  amount: '',
  issue_date: '',
  maturity_date: '',
}

function normalizeDate(value: unknown): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  const iso = raw.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const dmy = raw.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/)
  if (dmy) {
    const year = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]
    return `${year}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`
  }
  return ''
}

function normalizeAmount(value: unknown): string {
  if (value === null || value === undefined) return ''
  const cleaned = String(value).replace(/[^0-9.]/g, '')
  if (!cleaned) return ''
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? String(parsed) : ''
}

function confidenceTone(value: number): string {
  const pct = value > 1 ? value : value * 100
  return pct >= 80 ? 'green' : pct >= 55 ? 'amber' : 'red'
}

export default function UploadPage() {
  const [params] = useSearchParams()
  const renewId = params.get('renew')
  const { user } = useAuth()
  const { toast } = useToast()
  const inputRef = useRef<HTMLInputElement>(null)

  const [parent, setParent] = useState<InstrumentDetail | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [upload, setUpload] = useState<UploadResult | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [acknowledge, setAcknowledge] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [settling, setSettling] = useState(false)
  const [created, setCreated] = useState<{ id: number; reference: string } | null>(null)
  const [samples, setSamples] = useState<SampleDocument[]>([])
  const [sampleLoading, setSampleLoading] = useState<string | null>(null)

  const isRenewal = Boolean(renewId)
  const step = created ? 3 : upload ? 2 : 1

  useEffect(() => {
    apiGet<{ items: SampleDocument[] }>('/api/public/samples')
      .then((data) => setSamples(data.items))
      .catch(() => setSamples([]))
  }, [])

  useEffect(() => {
    if (!renewId) {
      setParent(null)
      return
    }
    apiGet<InstrumentDetail>(`/api/instruments/${renewId}`)
      .then((data) => {
        setParent(data)
        setForm((current) => ({
          ...current,
          fdr_number: current.fdr_number || data.fdr_number || '',
          bank: current.bank || data.bank || '',
          branch: current.branch || data.branch || '',
          amount: current.amount || String(data.amount ?? ''),
        }))
      })
      .catch((problem) => setError(errorMessage(problem)))
  }, [renewId])

  const processFile = useCallback(
    async (selected: File) => {
      setFile(selected)
      setError(null)
      setCreated(null)
      setBusy('upload')
      try {
        const result = await uploadFile<UploadResult>('/api/documents/upload', selected)
        setUpload(result)
        const fields = result.extraction.fields
        setForm((current) => ({
          fdr_number: current.fdr_number || String(fields.fdr_number?.value ?? ''),
          bank: current.bank || String(fields.bank?.value ?? ''),
          branch: current.branch || String(fields.branch?.value ?? ''),
          amount: current.amount || normalizeAmount(fields.amount?.value),
          issue_date: current.issue_date || normalizeDate(fields.issue_date?.value),
          maturity_date: current.maturity_date || normalizeDate(fields.maturity_date?.value),
        }))
        toast(
          result.extraction.needs_manual_review
            ? 'Document read. A few fields need a human check.'
            : 'Document read and fields extracted.',
          result.extraction.needs_manual_review ? 'warning' : 'success',
        )
      } catch (problem) {
        setUpload(null)
        setError(errorMessage(problem))
        toast(errorMessage(problem), 'error')
      } finally {
        setBusy(null)
      }
    },
    [toast],
  )

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    setDragging(false)
    setSettling(true)
    window.setTimeout(() => setSettling(false), 220)
    const dropped = event.dataTransfer.files?.[0]
    if (dropped) void processFile(dropped)
  }

  const loadSample = async (sample: SampleDocument) => {
    setSampleLoading(sample.name)
    setError(null)
    try {
      const response = await fetch(sample.url)
      if (!response.ok) throw new Error('The sample receipt could not be downloaded.')
      const blob = await response.blob()
      const selected = new File([blob], sample.name, { type: blob.type || (sample.kind === 'pdf' ? 'application/pdf' : 'image/png') })
      await processFile(selected)
    } catch (problem) {
      setError(errorMessage(problem))
    } finally {
      setSampleLoading(null)
    }
  }

  const reset = () => {
    setFile(null)
    setUpload(null)
    setForm(EMPTY_FORM)
    setCreated(null)
    setError(null)
    setAcknowledge(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  const missingFields = upload?.extraction.missing_fields ?? []
  const warnings = useMemo(
    () => [...(upload?.extraction.warnings ?? []), ...(upload?.extraction.anomaly_reasons ?? [])],
    [upload],
  )
  const knownFields = useMemo(
    () => Object.entries(upload?.extraction.fields ?? {}) as [string, ExtractedField][],
    [upload],
  )
  const lowConfidence = knownFields.filter(([, field]) => (field.confidence ?? 0) < 0.55)
  const amountValue = Number(form.amount)
  const datesValid = Boolean(form.issue_date && form.maturity_date && form.maturity_date > form.issue_date)
  const canSubmit =
    Boolean(upload) &&
    form.fdr_number.trim().length > 2 &&
    form.bank.trim().length > 1 &&
    Number.isFinite(amountValue) &&
    amountValue > 0 &&
    datesValid &&
    (missingFields.length === 0 || acknowledge) &&
    busy === null

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!upload) return
    setBusy('submit')
    setError(null)
    const payload = {
      document_id: upload.document_id,
      fdr_number: form.fdr_number.trim(),
      bank: form.bank.trim(),
      branch: form.branch.trim() || undefined,
      amount: amountValue,
      issue_date: form.issue_date,
      maturity_date: form.maturity_date,
      acknowledge_warnings: acknowledge,
    }
    try {
      if (isRenewal && renewId) {
        const result = await apiPost<{ instrument: { id: number; reference: string } }>(
          `/api/instruments/${renewId}/renew`,
          payload,
        )
        setCreated(result.instrument)
        toast('Renewal submitted and linked to the original deposit.', 'success')
      } else {
        const result = await apiPost<{ instrument: { id: number; reference: string } }>('/api/instruments', payload)
        setCreated(result.instrument)
        toast('FDR submitted. The tracking ID is ready.', 'success')
      }
    } catch (problem) {
      setError(errorMessage(problem))
      toast(errorMessage(problem), 'error')
    } finally {
      setBusy(null)
    }
  }

  const canSubmitRole = user?.role === 'institution' || user?.role === 'admin'

  if (!canSubmitRole) {
    return (
      <EmptyState
        icon={<LockKeyhole size={20} />}
        title="Only institution accounts can submit FDRs"
        hint="Officers review, verify and decide. Sign in with an institution account to upload a deposit receipt."
        action={
          <Link to="/instruments" className="btn btn-primary">
            Open FDR register
          </Link>
        }
      />
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={isRenewal ? 'Renewal upload' : 'New security deposit'}
        title={isRenewal ? 'Renew an existing FDR' : 'Submit an FDR receipt'}
        subtitle={
          isRenewal
            ? 'Upload the renewal advice. The new deposit is linked to its parent and the maturity clock restarts.'
            : 'Upload the bank receipt. Tesseract reads it, DistilBERT aligns the fields, and you confirm the values before submission.'
        }
        actions={
          <>
            <Link to={isRenewal && renewId ? `/instruments/${renewId}` : '/instruments'} className="btn btn-secondary">
              <ArrowLeft size={14} /> {isRenewal ? 'Back to parent FDR' : 'Back to register'}
            </Link>
            {upload ? (
              <button type="button" className="btn btn-secondary" onClick={reset}>
                <RefreshCw size={14} /> Start over
              </button>
            ) : null}
          </>
        }
      />

      <ol className="grid gap-2 sm:grid-cols-3">
        {[
          { key: 1, title: 'Upload receipt', detail: 'PDF, PNG or JPEG' },
          { key: 2, title: 'Confirm fields', detail: 'OCR + BERT check' },
          { key: 3, title: 'Sealed record', detail: 'Tracking ID issued' },
        ].map((item) => (
          <li
            key={item.key}
            className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${
              step === item.key
                ? 'border-mint-400/35 bg-mint-400/8'
                : step > item.key
                  ? 'border-signal-400/25 bg-signal-400/5'
                  : 'border-white/8 bg-white/[0.02]'
            }`}
          >
            <span
              className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border text-[0.68rem] font-bold ${
                step > item.key
                  ? 'border-mint-400/40 bg-mint-400/15 text-mint-300'
                  : step === item.key
                    ? 'border-mint-400/40 bg-mint-400/15 text-mint-200'
                    : 'border-white/12 bg-white/5 text-mist-500'
              }`}
            >
              {step > item.key ? <CircleCheckBig size={14} /> : item.key}
            </span>
            <span className="min-w-0">
              <span className="block text-[0.76rem] font-semibold text-mist-100">{item.title}</span>
              <span className="block truncate text-[0.64rem] text-mist-500">{item.detail}</span>
            </span>
          </li>
        ))}
      </ol>

      {error ? (
        <div className="flex items-start gap-2 rounded-xl border border-rose-400/30 bg-rose-400/8 px-4 py-3 text-xs text-rose-200">
          <TriangleAlert size={15} className="mt-0.5 shrink-0" />
          <span className="leading-relaxed">{error}</span>
        </div>
      ) : null}

      {isRenewal && parent ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-violet-400/25 bg-violet-400/[0.06] px-4 py-3 text-xs text-violet-100">
          <RotateCw size={16} className="shrink-0 text-violet-300" />
          <span className="flex-1">
            Renewal of <span className="font-mono text-violet-200">{parent.reference}</span> · {parent.bank} ·{' '}
            {currency(parent.amount)} · matures {dateLabel(parent.maturity_date)}
          </span>
          <Badge tone="violet">parent linked</Badge>
        </div>
      ) : null}

      {step === 3 && created ? (
        <Panel className="mx-auto max-w-2xl">
          <div className="text-center">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-mint-400/35 bg-mint-400/12 text-mint-300">
              <BadgeCheck size={26} />
            </span>
            <h2 className="mt-4 font-display text-xl font-semibold text-white">
              {isRenewal ? 'Renewal accepted' : 'FDR accepted for scrutiny'}
            </h2>
            <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-mist-400">
              The receipt is encrypted on disk, extracted fields are sealed, and the submission is written to the
              tamper-evident ledger.
            </p>
            <p className="mt-4 font-mono text-lg text-signal-300">{created.reference}</p>
            <p className="mt-1 text-[0.68rem] text-mist-500">Share this tracking ID with the institution's finance office.</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Link to={`/instruments/${created.id}`} className="btn btn-primary">
                Open the record <ArrowRight size={15} />
              </Link>
              <button type="button" className="btn btn-secondary" onClick={reset}>
                <CloudUpload size={15} /> Submit another
              </button>
            </div>
          </div>
          <div className="mt-6 grid gap-2 sm:grid-cols-3">
            {[
              { icon: LockKeyhole, title: 'AES-256-GCM', detail: 'Receipt + fields sealed at rest' },
              { icon: Hash, title: 'SHA-256', detail: 'Document digest recorded' },
              { icon: FingerprintPattern, title: 'Ed25519', detail: 'Signed audit block' },
            ].map(({ icon: Icon, title, detail }) => (
              <div key={title} className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5 text-center">
                <Icon size={15} className="mx-auto text-mint-300" />
                <p className="mt-1.5 text-[0.68rem] font-semibold text-mist-100">{title}</p>
                <p className="text-[0.6rem] text-mist-500">{detail}</p>
              </div>
            ))}
          </div>
        </Panel>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1.05fr_1fr]">
          <div className="space-y-4">
            <Panel>
              <SectionHeading
                title="1 · Upload the deposit receipt"
                hint="Scanned PDF, PNG or JPEG up to 12 MB"
                action={busy === 'upload' ? <Badge tone="cyan">reading…</Badge> : upload ? <Badge tone="green">read</Badge> : null}
              />
              <label
                onDragOver={(event) => {
                  event.preventDefault()
                  setDragging(true)
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                className={clsx(
                  'dropzone flex cursor-pointer flex-col items-center justify-center gap-2 px-5 py-9 text-center',
                  dragging && 'dropzone-active',
                  settling && 'dropzone-settling',
                  upload && !dragging && 'border-mint-400/35',
                )}
              >
                <input
                  ref={inputRef}
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,image/png,image/jpeg,application/pdf"
                  className="hidden"
                  onChange={(event) => {
                    const selected = event.target.files?.[0]
                    if (selected) void processFile(selected)
                  }}
                />
                <span className="grid h-12 w-12 place-items-center rounded-2xl border border-mint-400/25 bg-mint-400/10 text-mint-300">
                  {busy === 'upload' ? <ScanLine size={22} className="animate-pulse" /> : <CloudUpload size={22} />}
                </span>
                <span className="text-sm font-semibold text-mist-100">
                  {file ? file.name : 'Drop the receipt here, or click to browse'}
                </span>
                <span className="text-[0.68rem] text-mist-500">
                  {file
                    ? `${bytes(file.size)} · ${file.type || 'document'}`
                    : 'The original file is never served unencrypted to another role'}
                </span>
                {busy === 'upload' ? (
                  <span className="mt-1 text-[0.68rem] text-signal-300">Running OCR → BERT → field lexicon…</span>
                ) : null}
              </label>

              {samples.length > 0 ? (
                <div className="mt-4">
                  <p className="mb-2 text-[0.62rem] font-bold uppercase tracking-[0.14em] text-mist-600">
                    Demo receipts (synthetic)
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {samples.slice(0, 4).map((sample) => (
                      <button
                        key={sample.name}
                        type="button"
                        disabled={sampleLoading !== null || busy !== null}
                        onClick={() => void loadSample(sample)}
                        className="flex items-center gap-2.5 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2 text-left transition hover:border-signal-400/30 disabled:opacity-60"
                      >
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-signal-400/20 bg-signal-400/10 text-signal-300">
                          <FileText size={14} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[0.7rem] font-medium text-mist-100">{sample.bank}</span>
                          <span className="block truncate text-[0.6rem] text-mist-500">
                            {sample.kind.toUpperCase()} · {currency(sample.amount)} · {bytes(sample.size_bytes)}
                          </span>
                        </span>
                        {sampleLoading === sample.name ? (
                          <RefreshCw size={13} className="shrink-0 animate-spin text-mint-300" />
                        ) : (
                          <ArrowRight size={13} className="shrink-0 text-mist-600" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                {[
                  { icon: ScanLine, label: 'Tesseract OCR' },
                  { icon: Sparkles, label: 'DistilBERT alignment' },
                  { icon: ShieldCheck, label: 'Confidence per field' },
                ].map(({ icon: Icon, label }) => (
                  <div key={label} className="flex items-center gap-2 rounded-lg border border-white/6 bg-white/[0.02] px-2.5 py-2">
                    <Icon size={13} className="text-mint-300" />
                    <span className="text-[0.64rem] text-mist-400">{label}</span>
                  </div>
                ))}
              </div>
            </Panel>

            {upload ? (
              <Panel>
                <SectionHeading
                  title="2 · What the pipeline read"
                  hint="Every field carries its own confidence; nothing is hidden"
                  action={
                    <Badge tone={confidenceTone(upload.extraction.confidence)}>
                      overall {Math.round(upload.extraction.confidence * 100)}%
                    </Badge>
                  }
                />
                <div className="grid gap-2 sm:grid-cols-2">
                  {knownFields.map(([key, field]) => (
                    <div key={key} className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[0.6rem] uppercase tracking-[0.12em] text-mist-600">
                          {FIELD_LABELS[key] ?? key.replace(/_/g, ' ')}
                        </p>
                        <Badge tone={confidenceTone(field.confidence ?? 0)}>
                          {Math.round((field.confidence ?? 0) * 100)}%
                        </Badge>
                      </div>
                      <p className="mt-0.5 truncate font-mono text-[0.76rem] text-mist-100">
                        {field.value === null || field.value === '' ? '—' : String(field.value)}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[0.64rem] text-mist-500">
                  <Badge tone="slate">{upload.extraction.engine.ocr}</Badge>
                  <Badge tone="cyan">{upload.extraction.engine.bert}</Badge>
                  <span>embedding: {upload.extraction.embedding_model}</span>
                </div>
                {upload.duplicates.length > 0 ? (
                  <div className="mt-3 rounded-lg border border-rose-400/25 bg-rose-400/8 px-3 py-2 text-[0.68rem] text-rose-200">
                    <strong className="font-semibold">Possible duplicate.</strong> Similar to{' '}
                    {upload.duplicates.map((item) => item.reference).join(', ')}. The officer will see this.
                  </div>
                ) : null}
                {typeof upload.quality.score === 'number' ? (
                  <p className="mt-2 text-[0.64rem] text-mist-500">
                    Scan quality score {Math.round(upload.quality.score * 100)}% · anomaly{' '}
                    {Math.round(upload.anomaly_score * 100)}%
                  </p>
                ) : null}
              </Panel>
            ) : null}

            {upload ? (
              <Panel>
                <SectionHeading title="Document preview" hint="OCR text layer — stored encrypted at rest" />
                <pre className="ocr-grid max-h-[280px] overflow-auto whitespace-pre-wrap rounded-xl border border-white/8 bg-ink-950/60 p-3 font-mono text-[0.66rem] leading-relaxed text-mist-400">
                  {upload.extraction.text_preview || 'No text layer captured.'}
                </pre>
              </Panel>
            ) : null}
          </div>

          <Panel>
            <SectionHeading
              title="3 · Confirm the record"
              hint="These values become the authoritative instrument record"
              action={<Badge tone="slate">{isRenewal ? 'renewal' : 'new FDR'}</Badge>}
            />
            <form onSubmit={submit} className="space-y-3">
              <Field label="FDR number" hint="As printed by the bank, without spaces.">
                <input
                  value={form.fdr_number}
                  onChange={(event) => setForm({ ...form, fdr_number: event.target.value.toUpperCase() })}
                  className="input font-mono uppercase"
                  placeholder="FDR/2026/001234"
                />
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Bank">
                  <input
                    value={form.bank}
                    onChange={(event) => setForm({ ...form, bank: event.target.value })}
                    className="input"
                    placeholder="State Bank of India"
                  />
                </Field>
                <Field label="Branch">
                  <input
                    value={form.branch}
                    onChange={(event) => setForm({ ...form, branch: event.target.value })}
                    className="input"
                    placeholder="MG Road"
                  />
                </Field>
              </div>

              <Field label="Deposit amount (₹)" hint="Principal only; interest is not part of the deposit.">
                <input
                  type="number"
                  min="1"
                  step="0.01"
                  value={form.amount}
                  onChange={(event) => setForm({ ...form, amount: event.target.value })}
                  className="input font-mono"
                  placeholder="2500000"
                />
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Issue date">
                  <input
                    type="date"
                    value={form.issue_date}
                    onChange={(event) => setForm({ ...form, issue_date: event.target.value })}
                    className="input"
                  />
                </Field>
                <Field label="Maturity date" error={form.issue_date && form.maturity_date && !datesValid ? 'Maturity must be after the issue date.' : undefined}>
                  <input
                    type="date"
                    value={form.maturity_date}
                    onChange={(event) => setForm({ ...form, maturity_date: event.target.value })}
                    className="input"
                  />
                </Field>
              </div>

              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/8 bg-ink-950/40 px-3 py-2 text-[0.66rem] text-mist-500">
                <CalendarClock size={13} className="text-signal-300" />
                {datesValid
                  ? `${Math.round((new Date(form.maturity_date).getTime() - new Date(form.issue_date).getTime()) / 86_400_000)} days of cover`
                  : 'Pick both dates to calculate tenure'}
              </div>

              {missingFields.length > 0 ? (
                <div className="rounded-xl border border-amber-400/30 bg-amber-400/8 p-3">
                  <p className="flex items-center gap-1.5 text-[0.7rem] font-semibold text-amber-200">
                    <TriangleAlert size={13} /> {missingFields.length} field(s) could not be read
                  </p>
                  <p className="mt-1 text-[0.64rem] leading-relaxed text-amber-100/80">
                    Missing: {missingFields.join(', ')}. Fill them in above and confirm you have checked the paper receipt.
                  </p>
                  <label className="mt-2 flex items-start gap-2 text-[0.68rem] text-amber-100">
                    <input
                      type="checkbox"
                      checked={acknowledge}
                      onChange={(event) => setAcknowledge(event.target.checked)}
                      className="mt-0.5 h-4 w-4 accent-amber-400"
                    />
                    <span>I have verified the missing values against the original receipt.</span>
                  </label>
                </div>
              ) : null}

              {lowConfidence.length > 0 && missingFields.length === 0 ? (
                <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-[0.66rem] text-amber-200/90">
                  Low confidence on {lowConfidence.map(([key]) => FIELD_LABELS[key] ?? key).join(', ')}. Please
                  double-check those values.
                </div>
              ) : null}

              {warnings.length > 0 ? (
                <ul className="space-y-1 rounded-xl border border-white/8 bg-ink-950/40 px-3 py-2">
                  {warnings.slice(0, 4).map((warning) => (
                    <li key={warning} className="flex items-start gap-1.5 text-[0.64rem] text-mist-400">
                      <TriangleAlert size={11} className="mt-0.5 shrink-0 text-amber-300" />
                      {warning}
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="rounded-xl border border-signal-400/20 bg-signal-400/[0.04] px-3 py-2 text-[0.64rem] leading-relaxed text-mist-400">
                <span className="inline-flex items-center gap-1.5 font-semibold text-signal-300">
                  <Landmark size={12} /> What happens next
                </span>
                <p className="mt-1">
                  A scrutiny officer checks the extraction, a verification officer contacts the mock bank adapter, and the
                  competent authority signs the final decision. Every step is ledgered.
                </p>
              </div>

              <button type="submit" className="btn btn-primary w-full !py-2.5" disabled={!canSubmit}>
                {busy === 'submit'
                  ? 'Submitting…'
                  : isRenewal
                    ? 'Submit renewal'
                    : 'Submit FDR for scrutiny'}
                {busy !== 'submit' ? <ArrowRight size={15} /> : null}
              </button>
              {!upload ? (
                <p className="text-center text-[0.64rem] text-mist-600">Upload a receipt first to unlock submission.</p>
              ) : null}
            </form>

            {upload ? (
              <div className="mt-4 grid gap-2 border-t border-white/8 pt-3 text-[0.62rem] text-mist-500">
                <p className="flex items-center gap-1.5">
                  <Hash size={11} className="text-signal-300" /> Document SHA-256{' '}
                  <span className="font-mono text-mist-400">{shortHash(upload.document.sha256, 12, 8)}</span>
                </p>
                <p className="flex items-center gap-1.5">
                  <FileText size={11} className="text-mist-400" /> {upload.document.original_name} ·{' '}
                  {bytes(upload.document.size_bytes)}
                </p>
              </div>
            ) : null}
          </Panel>
        </div>
      )}
    </div>
  )
}
