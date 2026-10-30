import { useCallback, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Banknote,
  CalendarClock,
  CircleAlert,
  CircleCheckBig,
  Clock,
  Copy,
  Download,
  FileOutput,
  FileSearch,
  FileText,
  FingerprintPattern,
  Flag,
  Hash,
  Landmark,
  Link2,
  LockKeyhole,
  MessageSquarePlus,
  RefreshCw,
  RotateCw,
  ScanText,
  ScrollText,
  Send,
  ShieldAlert,
  Stamp,
  TriangleAlert,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { apiPost, downloadFile, errorMessage } from '../lib/api'
import { bytes, compactCurrency, currency, dateLabel, dateTimeLabel, daysLabel, initials, shortHash } from '../lib/format'
import { useApi } from '../lib/useApi'
import type { ExtractedField, InstrumentDetail, RequestRecord, TimelineEvent } from '../lib/types'
import {
  Badge,
  EmptyState,
  Field,
  InfoRow,
  LoadingPanel,
  Modal,
  PageHeader,
  Panel,
  ScoreBar,
  SectionHeading,
  StatusBadge,
  Tabs,
  TrustDial,
} from '../components/ui'

const FIELD_LABELS: Record<string, string> = {
  fdr_number: 'FDR number',
  bank: 'Bank name',
  amount: 'Amount',
  issue_date: 'Issue date',
  maturity_date: 'Maturity date',
  branch: 'Branch',
  institution: 'Institution',
}

const EVENT_TONE: Record<TimelineEvent['type'], { dot: string; icon: LucideIcon }> = {
  ledger: { dot: 'bg-mint-400', icon: Link2 },
  document: { dot: 'bg-signal-400', icon: FileText },
  reminder: { dot: 'bg-amber-400', icon: Clock },
  observation: { dot: 'bg-violet-400', icon: MessageSquarePlus },
  renewal: { dot: 'bg-indigo-400', icon: RotateCw },
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round((value > 1 ? value : value * 100))
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/8">
        <div
          className={`h-full rounded-full ${pct >= 80 ? 'bg-mint-400' : pct >= 55 ? 'bg-amber-400' : 'bg-rose-400'}`}
          style={{ width: `${Math.max(5, Math.min(100, pct))}%` }}
        />
      </div>
      <span className="font-mono text-[0.66rem] text-mist-400">{pct}%</span>
    </div>
  )
}

export default function InstrumentDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { toast } = useToast()
  const [tab, setTab] = useState('overview')
  const [busy, setBusy] = useState<string | null>(null)
  const [flagOpen, setFlagOpen] = useState(false)
  const [observeOpen, setObserveOpen] = useState(false)
  const [releaseOpen, setReleaseOpen] = useState(false)
  const [signatureOpen, setSignatureOpen] = useState(false)
  const [signature, setSignature] = useState<Record<string, unknown> | null>(null)
  const [flagReason, setFlagReason] = useState('')
  const [remark, setRemark] = useState('')
  const [clarify, setClarify] = useState(true)
  const [releaseType, setReleaseType] = useState<'release' | 'refund'>('release')
  const [releaseReason, setReleaseReason] = useState('')

  const path = id ? `/api/instruments/${id}` : null
  const { data, loading, error, reload } = useApi<InstrumentDetail>(path)
  const { data: timeline, reload: reloadTimeline } = useApi<{ events: TimelineEvent[] }>(
    id ? `/api/instruments/${id}/timeline` : null,
  )

  const refreshAll = useCallback(async () => {
    await Promise.all([reload(), reloadTimeline()])
  }, [reload, reloadTimeline])

  const run = async (key: string, action: () => Promise<unknown>, success: string) => {
    setBusy(key)
    try {
      await action()
      toast(success, 'success')
      await refreshAll()
    } catch (problem) {
      toast(errorMessage(problem), 'error')
    } finally {
      setBusy(null)
    }
  }

  const extracted = useMemo(() => Object.entries(data?.extracted_fields ?? {}) as [string, ExtractedField][], [data])
  const openClarifications = data?.observations.filter((item) => item.clarification_requested && !item.resolved) ?? []

  if (loading && !data) return <LoadingPanel rows={9} />
  if (error) {
    return (
      <EmptyState
        icon={<TriangleAlert size={20} />}
        title="This FDR record is unavailable"
        hint={error}
        action={
          <div className="flex gap-2">
            <Link to="/instruments" className="btn btn-secondary">
              <ArrowLeft size={14} /> Back to register
            </Link>
            <button type="button" className="btn btn-secondary" onClick={() => void reload()}>
              <RefreshCw size={14} /> Retry
            </button>
          </div>
        }
      />
    )
  }
  if (!data) return null

  const role = user?.role
  const canScrutinise = role === 'scrutiny_officer' || role === 'admin'
  const canVerify = role === 'verification_officer' || role === 'admin'
  const canObserve = ['scrutiny_officer', 'verification_officer', 'competent_authority', 'admin'].includes(role ?? '')
  const isInstitution = role === 'institution'
  const canSign = ['verification_officer', 'competent_authority', 'admin', 'auditor'].includes(role ?? '')
  const closed = ['released', 'renewed'].includes(data.status)
  const breakdown = data.trust_breakdown?.breakdown ?? []
  const bank = data.bank_verification

  const openSignature = async () => {
    setBusy('signature')
    try {
      const result = await apiPost<Record<string, unknown>>(`/api/instruments/${data.id}/signature`, {})
      setSignature(result)
      setSignatureOpen(true)
    } catch (problem) {
      toast(errorMessage(problem), 'error')
    } finally {
      setBusy(null)
    }
  }

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast('Copied to clipboard', 'success')
    } catch {
      toast('Clipboard is unavailable in this browser', 'error')
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={
          <Link to="/instruments" className="inline-flex items-center gap-1 text-mint-300 hover:text-mint-200">
            <ArrowLeft size={12} /> FDR register
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xl text-white">{data.reference}</span>
            <StatusBadge status={data.status} label={data.status_label} tone={data.status_tone} />
            {data.is_flagged ? (
              <Badge tone="red" dot>
                flagged
              </Badge>
            ) : null}
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1">
              <Landmark size={13} /> {data.bank}
              {data.branch ? ` · ${data.branch}` : ''}
            </span>
            <span className="inline-flex items-center gap-1">
              <CalendarClock size={13} /> matures {dateLabel(data.maturity_date)} ({daysLabel(data.days_to_maturity)})
            </span>
            <span className="text-mist-500">{data.institution ?? '—'}</span>
          </span>
        }
        actions={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => void refreshAll()}>
              <RefreshCw size={14} /> Refresh
            </button>
            {canVerify && !closed ? (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy !== null}
                onClick={() =>
                  void run(
                    'bank',
                    () => apiPost(`/api/instruments/${data.id}/verify/bank`, {}),
                    'Bank adapter responded. Check the verification panel.',
                  )
                }
              >
                <Banknote size={15} /> {busy === 'bank' ? 'Contacting bank…' : 'Verify with bank'}
              </button>
            ) : null}
            {canScrutinise && !closed ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy !== null}
                onClick={() =>
                  void run('confirm', () => apiPost(`/api/instruments/${data.id}/confirm`, {}), 'FDR marked active and sealed')
                }
              >
                <CircleCheckBig size={15} /> {busy === 'confirm' ? 'Approving…' : 'Approve FDR'}
              </button>
            ) : null}
          </>
        }
      />

      {openClarifications.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/8 px-4 py-3 text-xs text-amber-100">
          <MessageSquarePlus size={16} className="shrink-0 text-amber-300" />
          <span className="flex-1">
            <strong className="font-semibold">{openClarifications.length} open clarification(s).</strong>{' '}
            {openClarifications[0].remark}
          </span>
          {isInstitution || role === 'admin' ? (
            <button
              type="button"
              className="btn btn-secondary !py-1.5"
              disabled={busy !== null}
              onClick={() =>
                void run(
                  'resolve',
                  () => apiPost(`/api/instruments/${data.id}/clarification/resolve`, {}),
                  'Clarification marked as answered',
                )
              }
            >
              <Check size={14} /> Mark answered
            </button>
          ) : null}
        </div>
      ) : null}

      {data.flag_reason ? (
        <div className="flex items-start gap-3 rounded-2xl border border-rose-400/30 bg-rose-400/8 px-4 py-3 text-xs text-rose-100">
          <ShieldAlert size={16} className="mt-0.5 shrink-0 text-rose-300" />
          <span>
            <strong className="font-semibold">Flagged.</strong> {data.flag_reason}
          </span>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Panel>
            <Tabs
              active={tab}
              onChange={setTab}
              tabs={[
                { key: 'overview', label: 'Overview' },
                { key: 'extraction', label: 'OCR & extraction', count: extracted.length },
                { key: 'documents', label: 'Documents', count: data.documents.length },
                { key: 'timeline', label: 'Timeline', count: timeline?.events.length ?? 0 },
                { key: 'requests', label: 'Requests', count: data.requests.length },
              ]}
            />
          </Panel>

          {tab === 'overview' ? (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Panel>
                  <SectionHeading title="Instrument record" hint="Sensitive values are decrypted for your role" />
                  <InfoRow label="Reference" value={<span className="font-mono text-signal-300">{data.reference}</span>} />
                  <InfoRow label="Institution" value={data.institution_detail?.name ?? '—'} />
                  <InfoRow label="AICTE ID" value={data.institution_detail?.aicte_id ?? '—'} mono />
                  <InfoRow label="Bank" value={data.bank} />
                  <InfoRow label="Branch" value={data.branch ?? '—'} />
                  <InfoRow label="FDR number" value={data.fdr_number || '—'} mono />
                  <InfoRow label="Amount" value={<span className="font-semibold text-white">{currency(data.amount, true)}</span>} />
                  <InfoRow label="Issued" value={dateLabel(data.issue_date)} />
                  <InfoRow label="Matures" value={`${dateLabel(data.maturity_date)} · ${daysLabel(data.days_to_maturity)}`} />
                  <InfoRow label="Verified" value={dateTimeLabel(data.verified_at)} />
                </Panel>

                <Panel>
                  <SectionHeading
                    title="FDR trust score"
                    hint="Advisory only — never a decision maker"
                    action={<TrustDial score={data.trust_score} size={54} />}
                  />
                  {breakdown.length === 0 ? (
                    <EmptyState title="No score components yet" hint="Trust is recalculated after each verification." />
                  ) : (
                    <div className="space-y-2.5">
                      {breakdown.map((row) => (
                        <div key={row.label}>
                          <div className="mb-1 flex items-center justify-between gap-2 text-[0.7rem]">
                            <span className="truncate text-mist-300">{row.label}</span>
                            <span className="shrink-0 font-mono text-mist-400">
                              {row.points}/{row.possible}
                            </span>
                          </div>
                          <ScoreBar score={(row.points / Math.max(1, row.possible)) * 100} />
                          {row.note ? <p className="mt-0.5 text-[0.62rem] text-mist-600">{row.note}</p> : null}
                        </div>
                      ))}
                    </div>
                  )}
                  {data.trust_breakdown?.band ? (
                    <div className="mt-3 rounded-lg border border-white/8 bg-ink-950/40 px-3 py-2 text-[0.68rem] text-mist-400">
                      Band: <span className="font-semibold capitalize text-mist-100">{data.trust_breakdown.band}</span>
                    </div>
                  ) : null}
                </Panel>
              </div>

              <Panel>
                <SectionHeading
                  title="Bank verification"
                  hint="Adapter result is attributed to the bank, never to the officer"
                  action={
                    bank ? (
                      <Badge tone={bank.result === 'confirmed' ? 'green' : 'red'} dot>
                        {bank.result}
                      </Badge>
                    ) : (
                      <Badge tone="slate">not yet run</Badge>
                    )
                  }
                />
                {!bank ? (
                  <EmptyState
                    icon={<Banknote size={18} />}
                    title="No bank response recorded"
                    hint="A verification officer can call the mock bank adapter from this page."
                  />
                ) : (
                  <div className="space-y-2">
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      {Object.entries(bank.detail)
                        .filter(([, value]) => typeof value !== 'object')
                        .slice(0, 8)
                        .map(([key, value]) => (
                          <div key={key} className="rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2">
                            <p className="text-[0.58rem] uppercase tracking-[0.12em] text-mist-600">{key.replace(/_/g, ' ')}</p>
                            <p className="mt-0.5 break-words text-[0.72rem] text-mist-100">{String(value)}</p>
                          </div>
                        ))}
                    </div>
                    <p className="text-[0.66rem] text-mist-500">Checked {dateTimeLabel(bank.created_at)}</p>
                  </div>
                )}
              </Panel>

              <Panel>
                <SectionHeading
                  title="Field comparison"
                  hint="Submitted values against the latest OCR extraction"
                  action={
                    data.mismatches.length === 0 ? (
                      <Badge tone="green" dot>
                        aligned
                      </Badge>
                    ) : (
                      <Badge tone="amber" dot>
                        {data.mismatches.length} mismatch(es)
                      </Badge>
                    )
                  }
                />
                {data.mismatches.length === 0 ? (
                  <p className="text-xs text-mist-500">
                    No discrepancy between the submitted values and the extracted receipt fields.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Field</th>
                          <th>Submitted</th>
                          <th>Extracted</th>
                          <th>Confidence</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.mismatches.map((row) => (
                          <tr key={row.field}>
                            <td className="text-mist-200">{row.label}</td>
                            <td className="font-mono text-[0.72rem] text-mist-100">{String(row.submitted)}</td>
                            <td className="font-mono text-[0.72rem] text-amber-300">{String(row.extracted)}</td>
                            <td className="text-mist-400">{row.confidence ? `${Math.round(row.confidence * 100)}%` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            </div>
          ) : null}

          {tab === 'extraction' ? (
            <div className="space-y-4">
              <Panel>
                <SectionHeading
                  title="Extracted fields"
                  hint="OCR → BERT alignment → lexicon fields → confidence"
                  action={<Badge tone="cyan">{data.documents[0]?.embedding_model?.split('/').pop() ?? 'embedding'}</Badge>}
                />
                {extracted.length === 0 ? (
                  <EmptyState title="No extraction available" hint="Upload a document to run the OCR pipeline." />
                ) : (
                  <div className="space-y-2">
                    {extracted.map(([key, field]) => (
                      <div
                        key={key}
                        className="flex flex-wrap items-center gap-3 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-[0.6rem] uppercase tracking-[0.12em] text-mist-600">
                            {FIELD_LABELS[key] ?? key.replace(/_/g, ' ')}
                          </p>
                          <p className="mt-0.5 truncate font-mono text-[0.8rem] text-mist-100">
                            {field.value === null || field.value === '' ? '—' : String(field.value)}
                          </p>
                        </div>
                        {field.method ? <Badge tone="slate">{field.method}</Badge> : null}
                        <ConfidenceBar value={field.confidence ?? 0} />
                      </div>
                    ))}
                  </div>
                )}
              </Panel>

              {data.documents[0] ? (
                <Panel>
                  <SectionHeading
                    title="OCR text layer"
                    hint={`${data.documents[0].text_length} characters · engine ${String(data.documents[0].engine ?? 'unknown')}`}
                    action={
                      <div className="flex gap-1.5">
                        {data.documents[0].warnings.length > 0 ? (
                          <Badge tone="amber">{data.documents[0].warnings.length} warning(s)</Badge>
                        ) : null}
                        <Badge tone={data.documents[0].anomaly_score >= 0.4 ? 'red' : 'green'}>
                          anomaly {Math.round(data.documents[0].anomaly_score * 100)}%
                        </Badge>
                      </div>
                    }
                  />
                  <pre className="ocr-grid max-h-[320px] overflow-auto whitespace-pre-wrap rounded-xl border border-white/8 bg-ink-950/60 p-4 font-mono text-[0.7rem] leading-relaxed text-mist-300">
                    {data.documents[0].text_preview || 'No text layer captured.'}
                  </pre>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="btn btn-secondary !py-1.5"
                      onClick={() => void copy(data.documents[0].text_preview ?? '')}
                    >
                      <Copy size={13} /> Copy text
                    </button>
                    <span className="text-[0.64rem] text-mist-600">
                      OCR text is stored encrypted (AES-256-GCM) and decrypted only for authorised viewers.
                    </span>
                  </div>
                </Panel>
              ) : null}
            </div>
          ) : null}

          {tab === 'documents' ? (
            <Panel>
              <SectionHeading
                title="Encrypted document versions"
                hint="Each file is sealed on disk with SHA-256 integrity checks"
                action={<Badge tone="slate">{data.documents.length} version(s)</Badge>}
              />
              {data.documents.length === 0 ? (
                <EmptyState icon={<FileText size={18} />} title="No document on record" />
              ) : (
                <div className="space-y-3">
                  {data.documents.map((document) => (
                    <div key={document.id} className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
                      <div className="flex flex-wrap items-start gap-3">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-signal-400/20 bg-signal-400/10 text-signal-300">
                          <FileText size={16} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[0.8rem] font-medium text-mist-100">{document.original_name}</p>
                          <p className="text-[0.64rem] text-mist-600">
                            v{document.version} · {bytes(document.size_bytes)} · {dateTimeLabel(document.uploaded_at)}
                          </p>
                          <p className="mt-1 flex items-center gap-1 font-mono text-[0.62rem] text-signal-300">
                            <Hash size={10} /> {shortHash(document.sha256, 14, 10)}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge tone={document.overall_confidence >= 0.7 ? 'green' : document.overall_confidence >= 0.4 ? 'amber' : 'red'}>
                            OCR {Math.round(document.overall_confidence * 100)}%
                          </Badge>
                          <button
                            type="button"
                            className="btn btn-secondary !px-2 !py-1.5"
                            onClick={() => {
                              void downloadFile(`/api/documents/${document.id}/download`, document.original_name).catch(
                                (problem: unknown) => toast(errorMessage(problem), 'error'),
                              )
                            }}
                          >
                            <Download size={13} /> Download
                          </button>
                        </div>
                      </div>
                      {document.warnings.length > 0 ? (
                        <div className="mt-2 rounded-lg border border-amber-400/20 bg-amber-400/5 px-2.5 py-1.5 text-[0.66rem] text-amber-200">
                          {document.warnings.join(' · ')}
                        </div>
                      ) : null}
                      {document.duplicates.length > 0 ? (
                        <div className="mt-2 rounded-lg border border-rose-400/20 bg-rose-400/5 px-2.5 py-1.5 text-[0.66rem] text-rose-200">
                          Possible duplicate of {document.duplicates.map((row) => row.reference).join(', ')}
                        </div>
                      ) : null}
                      <div className="mt-2 grid gap-1 text-[0.64rem] text-mist-500 sm:grid-cols-2">
                        <span>Engine: {String(document.engine ?? '—')}</span>
                        <span>Embedding: {document.embedding_model ?? '—'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          ) : null}

          {tab === 'timeline' ? (
            <Panel>
              <SectionHeading
                title="Signed event timeline"
                hint="Documents, officer observations, reminders and ledger blocks"
                action={<Badge tone="cyan">{timeline?.events.length ?? 0} events</Badge>}
              />
              {!timeline || timeline.events.length === 0 ? (
                <EmptyState title="No events yet" />
              ) : (
                <ol className="relative space-y-4 pl-6">
                  <span className="timeline-line absolute left-[9px] top-2 h-[calc(100%-16px)] w-px" />
                  {timeline.events.map((event, index) => {
                    const tone = EVENT_TONE[event.type] ?? EVENT_TONE.ledger
                    const Icon = tone.icon
                    return (
                      <li key={`${event.type}-${index}`} className="relative">
                        <span className={`absolute -left-6 top-0.5 grid h-[19px] w-[19px] place-items-center rounded-full border border-white/15 bg-ink-900 ${tone.dot}`}>
                          <Icon size={10} />
                        </span>
                        <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-[0.78rem] font-semibold text-mist-100">{event.title}</p>
                            <Badge tone="slate">{event.type}</Badge>
                            {event.ledger_index !== undefined ? (
                              <span className="font-mono text-[0.6rem] text-signal-300">#{event.ledger_index}</span>
                            ) : null}
                            <span className="ml-auto text-[0.62rem] text-mist-600">{dateTimeLabel(event.at)}</span>
                          </div>
                          {event.actor ? <p className="mt-0.5 text-[0.64rem] text-mist-500">by {event.actor}</p> : null}
                          {Object.keys(event.detail).length > 0 ? (
                            <p className="mt-1 break-words font-mono text-[0.62rem] text-mist-500">
                              {Object.entries(event.detail)
                                .filter(([, value]) => typeof value !== 'object')
                                .slice(0, 5)
                                .map(([key, value]) => `${key}=${String(value)}`)
                                .join(' · ')}
                            </p>
                          ) : null}
                          {event.hash ? (
                            <p className="mt-1 flex items-center gap-1 font-mono text-[0.58rem] text-mist-600">
                              <Hash size={9} /> {shortHash(event.hash, 16, 8)}
                            </p>
                          ) : null}
                        </div>
                      </li>
                    )
                  })}
                </ol>
              )}
            </Panel>
          ) : null}

          {tab === 'requests' ? (
            <Panel>
              <SectionHeading
                title="Release & refund requests"
                hint="Each decision is signed by the acting officer"
                action={
                  isInstitution && !closed ? (
                    <button type="button" className="btn btn-primary !py-1.5" onClick={() => setReleaseOpen(true)}>
                      <FileOutput size={14} /> New request
                    </button>
                  ) : null
                }
              />
              {data.requests.length === 0 ? (
                <EmptyState icon={<FileOutput size={18} />} title="No requests filed" />
              ) : (
                <div className="space-y-2">
                  {data.requests.map((request) => (
                    <Link
                      key={request.id}
                      to={`/requests/${request.id}`}
                      className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5 transition hover:border-mint-400/25"
                    >
                      <span className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 bg-white/5 text-mist-300">
                        <FileOutput size={14} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[0.78rem] font-medium capitalize text-mist-100">
                          {request.type} request #{request.id}
                        </p>
                        <p className="text-[0.64rem] text-mist-600">{dateTimeLabel(request.created_at)}</p>
                      </div>
                      <Badge tone={request.status === 'closed' ? 'green' : request.status === 'rejected' ? 'red' : 'signal'}>
                        {request.status}
                      </Badge>
                      <ArrowRight size={14} className="text-mist-600" />
                    </Link>
                  ))}
                </div>
              )}
            </Panel>
          ) : null}
        </div>

        <aside className="space-y-4">
          <Panel>
            <SectionHeading title="Actions" hint="Role-gated and audit-logged" />
            <div className="space-y-2">
              {canScrutinise && !closed ? (
                <button
                  type="button"
                  className="btn btn-secondary w-full"
                  onClick={() => {
                    setFlagOpen(true)
                    setFlagReason('')
                  }}
                >
                  <Flag size={15} /> Flag with reason
                </button>
              ) : null}
              {canObserve ? (
                <button
                  type="button"
                  className="btn btn-secondary w-full"
                  onClick={() => {
                    setObserveOpen(true)
                    setRemark('')
                    setClarify(true)
                  }}
                >
                  <MessageSquarePlus size={15} /> Add observation
                </button>
              ) : null}
              {isInstitution && !closed ? (
                <>
                  <Link to={`/submit?renew=${data.id}`} className="btn btn-secondary w-full">
                    <RotateCw size={15} /> Renew this FDR
                  </Link>
                  <button
                    type="button"
                    className="btn btn-secondary w-full"
                    onClick={() => {
                      setReleaseOpen(true)
                      setReleaseReason('')
                    }}
                  >
                    <FileOutput size={15} /> Request release / refund
                  </button>
                </>
              ) : null}
              {canSign ? (
                <button
                  type="button"
                  className="btn btn-secondary w-full"
                  disabled={busy !== null}
                  onClick={() => void openSignature()}
                >
                  <FingerprintPattern size={15} /> Verify last signature
                </button>
              ) : null}
              {!canScrutinise && !canObserve && !isInstitution && !canSign ? (
                <p className="text-[0.7rem] leading-relaxed text-mist-500">
                  Your role has read-only access to this record. Every action taken here is written to the audit ledger.
                </p>
              ) : null}
              <button
                type="button"
                className="btn btn-ghost w-full"
                onClick={() => {
                  setTab('timeline')
                }}
              >
                <ScrollText size={15} /> View signed timeline
              </button>
            </div>
          </Panel>

          <Panel>
            <SectionHeading title="Institution" hint="Registered AICTE entity" />
            {data.institution_detail ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-10 w-10 place-items-center rounded-xl border border-mint-400/20 bg-mint-400/10 text-[0.7rem] font-bold text-mint-200">
                    {initials(data.institution_detail.name)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[0.8rem] font-semibold text-mist-100">{data.institution_detail.name}</p>
                    <p className="font-mono text-[0.64rem] text-mist-500">{data.institution_detail.aicte_id}</p>
                  </div>
                </div>
                <InfoRow label="State" value={data.institution_detail.state} />
                <InfoRow label="City" value={data.institution_detail.city ?? '—'} />
                <InfoRow label="Email" value={data.institution_detail.contact_email ?? '—'} />
                <InfoRow label="Phone" value={data.institution_detail.contact_phone ?? '—'} />
                {user?.role !== 'institution' ? (
                  <Link to={`/institutions/${data.institution_detail.id}`} className="btn btn-ghost w-full !justify-between">
                    Open institution <ArrowRight size={13} />
                  </Link>
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-mist-500">Not linked.</p>
            )}
          </Panel>

          {data.child_instruments.length > 0 ? (
            <Panel>
              <SectionHeading title="Renewal chain" hint="Linked successor deposits" />
              <div className="space-y-2">
                {data.child_instruments.map((child) => (
                  <Link
                    key={child.id}
                    to={`/instruments/${child.id}`}
                    className="flex items-center gap-2 rounded-lg border border-white/8 bg-white/[0.02] px-2.5 py-2 text-[0.7rem] transition hover:border-violet-400/30"
                  >
                    <RotateCw size={13} className="text-violet-300" />
                    <span className="font-mono text-signal-300">{child.reference}</span>
                    <span className="ml-auto text-mist-500">{compactCurrency(child.amount)}</span>
                  </Link>
                ))}
              </div>
            </Panel>
          ) : null}

          <Panel>
            <SectionHeading title="Security trail" hint="AES-256-GCM + Ed25519" />
            <div className="space-y-2 text-[0.68rem] text-mist-400">
              <p className="flex items-center gap-2">
                <LockKeyhole size={13} className="text-mint-300" /> FDR number and amount encrypted at rest
              </p>
              <p className="flex items-center gap-2">
                <Hash size={13} className="text-signal-300" /> Document SHA-256{' '}
                <span className="font-mono text-mist-500">
                  {data.documents[0] ? shortHash(data.documents[0].sha256, 10, 6) : '—'}
                </span>
              </p>
              <p className="flex items-center gap-2">
                <Stamp size={13} className="text-violet-300" /> Officer decisions individually signed
              </p>
              <p className="flex items-center gap-2">
                <ScanText size={13} className="text-amber-300" /> Extraction confidence{' '}
                {data.documents[0] ? `${Math.round(data.documents[0].overall_confidence * 100)}%` : '—'}
              </p>
            </div>
          </Panel>
        </aside>
      </div>

      <Modal
        open={flagOpen}
        onClose={() => setFlagOpen(false)}
        title="Flag this FDR"
        description="The institution is notified immediately and the reason is written to the ledger."
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setFlagOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={flagReason.trim().length < 3 || busy !== null}
              onClick={async () => {
                await run('flag', () => apiPost(`/api/instruments/${data.id}/flag`, { reason: flagReason.trim() }), 'FDR flagged')
                setFlagOpen(false)
              }}
            >
              <Flag size={14} /> Confirm flag
            </button>
          </>
        }
      >
        <Field label="Reason" hint="Be specific: the institution sees this text.">
          <textarea
            className="textarea"
            rows={4}
            value={flagReason}
            onChange={(event) => setFlagReason(event.target.value)}
            placeholder="e.g. Bank could not trace this FDR number at the stated branch."
          />
        </Field>
      </Modal>

      <Modal
        open={observeOpen}
        onClose={() => setObserveOpen(false)}
        title="Add officer observation"
        description="Observations are permanent and visible to the institution when a clarification is requested."
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setObserveOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={remark.trim().length < 3 || busy !== null}
              onClick={async () => {
                await run(
                  'observe',
                  () =>
                    apiPost(`/api/instruments/${data.id}/observations`, {
                      remark: remark.trim(),
                      request_clarification: clarify,
                    }),
                  clarify ? 'Clarification requested' : 'Observation recorded',
                )
                setObserveOpen(false)
              }}
            >
              <Send size={14} /> Save observation
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Remark">
            <textarea
              className="textarea"
              rows={4}
              value={remark}
              onChange={(event) => setRemark(event.target.value)}
              placeholder="What did you check, and what should the institution do next?"
            />
          </Field>
          <label className="flex items-center gap-2 rounded-xl border border-white/8 bg-ink-950/40 px-3 py-2">
            <input
              type="checkbox"
              checked={clarify}
              onChange={(event) => setClarify(event.target.checked)}
              className="h-4 w-4 accent-mint-400"
            />
            <span className="text-xs text-mist-300">Request a clarification from the institution</span>
          </label>
        </div>
      </Modal>

      <Modal
        open={releaseOpen}
        onClose={() => setReleaseOpen(false)}
        title="File a release or refund request"
        description="The request enters a four-step signed workflow: scrutiny → verification → authority → closure."
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setReleaseOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={releaseReason.trim().length < 5 || busy !== null}
              onClick={async () => {
                setBusy('release')
                try {
                  const created = await apiPost<RequestRecord>('/api/requests', {
                    instrument_id: data.id,
                    type: releaseType,
                    reason: releaseReason.trim(),
                  })
                  toast('Request filed and sent to scrutiny', 'success')
                  setReleaseOpen(false)
                  navigate(`/requests/${created.id}`)
                } catch (problem) {
                  toast(errorMessage(problem), 'error')
                } finally {
                  setBusy(null)
                }
              }}
            >
              <FileOutput size={14} /> File request
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {(['release', 'refund'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setReleaseType(option)}
                className={`rounded-xl border px-3 py-2.5 text-left transition ${
                  releaseType === option
                    ? 'border-mint-400/45 bg-mint-400/10'
                    : 'border-white/10 bg-white/[0.02] hover:border-white/25'
                }`}
              >
                <p className="text-xs font-semibold capitalize text-mist-100">{option}</p>
                <p className="mt-0.5 text-[0.64rem] text-mist-500">
                  {option === 'release' ? 'Return the FDR to the institution' : 'Refund the deposit value'}
                </p>
              </button>
            ))}
          </div>
          <Field label="Reason" hint="At least 5 characters. This is signed and ledgered.">
            <textarea
              className="textarea"
              rows={4}
              value={releaseReason}
              onChange={(event) => setReleaseReason(event.target.value)}
              placeholder="e.g. Institution has closed the programme; deposit no longer required."
            />
          </Field>
          <div className="rounded-lg border border-white/8 bg-ink-950/40 px-3 py-2">
            <p className="text-[0.64rem] text-mist-500">
              Amount: <span className="font-semibold text-mist-200">{currency(data.amount, true)}</span> · Bank:{' '}
              <span className="text-mist-200">{data.bank}</span>
            </p>
          </div>
        </div>
      </Modal>

      <Modal
        open={signatureOpen}
        onClose={() => setSignatureOpen(false)}
        title="Signature proof"
        description="The latest ledger block for this instrument, verified against the officer's Ed25519 public key."
        width="max-w-2xl"
        footer={
          <button type="button" className="btn btn-secondary" onClick={() => setSignatureOpen(false)}>
            Close
          </button>
        }
      >
        {signature ? (
          <div className="space-y-3">
            {signature.ok ? (
              <>
                <div
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${
                    signature.signature_valid
                      ? 'border-mint-400/30 bg-mint-400/10 text-mint-200'
                      : 'border-rose-400/30 bg-rose-400/10 text-rose-200'
                  }`}
                >
                  {signature.signature_valid ? <CircleCheckBig size={15} /> : <X size={15} />}
                  {signature.signature_valid ? 'Signature verified against the public key' : 'Signature could not be verified'}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <InfoRow label="Algorithm" value={String(signature.algo)} mono />
                  <InfoRow label="Key ID" value={String(signature.key_id)} mono />
                </div>
                {(() => {
                  const block = signature.block as Record<string, unknown> | undefined
                  if (!block) return null
                  return (
                    <div className="space-y-2 rounded-xl border border-white/8 bg-ink-950/50 p-3">
                      <InfoRow label="Block" value={`#${String(block.idx)}`} mono />
                      <InfoRow label="Action" value={String(block.action)} />
                      <InfoRow label="Hash" value={<span className="break-all font-mono text-[0.6rem]">{String(block.hash)}</span>} />
                      <InfoRow label="Previous hash" value={<span className="break-all font-mono text-[0.6rem]">{String(block.prev_hash)}</span>} />
                      <InfoRow label="Document hash" value={block.document_hash ? shortHash(String(block.document_hash), 16, 10) : '—'} mono />
                      <div>
                        <p className="mb-1 text-[0.6rem] font-bold uppercase tracking-[0.12em] text-mist-600">Payload</p>
                        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-white/8 bg-ink-950/70 p-2 font-mono text-[0.62rem] text-mist-300">
                          {JSON.stringify(block.payload, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )
                })()}
              </>
            ) : (
              <div className="flex items-start gap-2 rounded-xl border border-amber-400/25 bg-amber-400/8 px-3 py-2 text-xs text-amber-200">
                <CircleAlert size={15} className="mt-0.5" />
                {String(signature.message ?? 'No signed action recorded yet.')}
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-mist-500">Loading signature proof…</p>
        )}
      </Modal>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/8 pt-4 text-[0.64rem] text-mist-600">
        <span className="inline-flex items-center gap-1.5">
          <BadgeCheck size={12} className="text-mint-400/70" /> Every action on this record is append-only.
        </span>
        <Link to="/ledger" className="inline-flex items-center gap-1 text-mint-300 hover:text-mint-200">
          <FileSearch size={12} /> Inspect the ledger
        </Link>
      </div>
    </div>
  )
}

function Check({ size = 14 }: { size?: number }) {
  return <CircleCheckBig size={size} />
}
