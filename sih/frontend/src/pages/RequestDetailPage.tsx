import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  Banknote,
  CalendarClock,
  CircleAlert,
  CircleCheckBig,
  CircleX,
  ClipboardCheck,
  FileOutput,
  FingerprintPattern,
  Landmark,
  RefreshCw,
  ShieldCheck,
  Stamp,
  TriangleAlert,
  UserRound,
  Workflow,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { apiGet, apiPost, errorMessage } from '../lib/api'
import { compactCurrency, currency, dateTimeLabel, relativeTime } from '../lib/format'
import { useApi } from '../lib/useApi'
import type { RequestDetail } from '../lib/types'
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
} from '../components/ui'

const STEP_LABEL: Record<string, string> = {
  requested: 'Institution request',
  scrutiny: 'Scrutiny',
  verification: 'Bank verification',
  authority: 'Competent authority',
  closed: 'Closure',
}

const STEP_OWNER: Record<string, string> = {
  requested: 'Institution',
  scrutiny: 'Scrutiny officer',
  verification: 'Verification officer',
  authority: 'Competent authority',
  closed: 'System',
}

const NEXT_OWNER: Record<string, string> = {
  requested: 'scrutiny_officer',
  scrutiny: 'verification_officer',
  verification: 'competent_authority',
  authority: 'competent_authority',
}

const STATUS_TONE: Record<string, string> = {
  requested: 'blue',
  scrutiny: 'violet',
  verification: 'cyan',
  authority: 'indigo',
  closed: 'green',
  rejected: 'red',
}

const DECISION_LABEL: Record<string, string> = {
  approve: 'Approved and sent onward',
  advance: 'Advanced to the next desk',
  reject: 'Rejected with a signed reason',
}

interface SignatureProof {
  ok: boolean
  message?: string
  signer?: { id: number; name: string; role: string; key_id: string }
  signature?: string
  algo?: string
  public_key?: string
  decision_reason?: string | null
  signed_at?: string | null
}

export default function RequestDetailPage() {
  const { id } = useParams()
  const { user } = useAuth()
  const { toast } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [decisionOpen, setDecisionOpen] = useState(false)
  const [signatureOpen, setSignatureOpen] = useState(false)
  const [signature, setSignature] = useState<SignatureProof | null>(null)
  const [decision, setDecision] = useState<'approve' | 'reject' | 'advance'>('approve')
  const [reason, setReason] = useState('')
  const [signatureName, setSignatureName] = useState(user?.name ?? '')

  const { data, loading, error, reload } = useApi<RequestDetail>(id ? `/api/requests/${id}` : null)

  const role = user?.role
  const requiredRole = data ? NEXT_OWNER[data.status] : undefined
  const canAct =
    Boolean(data) &&
    !['closed', 'rejected'].includes(data?.status ?? '') &&
    (role === 'admin' || role === requiredRole)
  const canVerifySignature = ['competent_authority', 'admin', 'auditor'].includes(role ?? '')
  const open = data ? !['closed', 'rejected'].includes(data.status) : false
  const passed = data?.checklist.filter((item) => item.passed).length ?? 0
  const totalChecks = data?.checklist.length ?? 0
  const score = totalChecks ? (passed / totalChecks) * 100 : 0

  const steps = useMemo(() => data?.steps ?? [], [data])

  const run = async (key: string, action: () => Promise<unknown>, message: string) => {
    setBusy(key)
    try {
      await action()
      toast(message, 'success')
      await reload()
    } catch (problem) {
      toast(errorMessage(problem), 'error')
    } finally {
      setBusy(null)
    }
  }

  const openSignature = async () => {
    if (!data) return
    setBusy('signature')
    try {
      const proof = await apiGet<SignatureProof>(`/api/requests/${data.id}/signature`)
      setSignature(proof)
      setSignatureOpen(true)
    } catch (problem) {
      toast(errorMessage(problem), 'error')
    } finally {
      setBusy(null)
    }
  }

  const submitDecision = async () => {
    if (!data) return
    setBusy('decision')
    try {
      const result = await apiPost<{ request: RequestDetail }>(`/api/requests/${data.id}/advance`, {
        decision,
        reason: reason.trim(),
        signature_name: signatureName.trim(),
      })
      toast(
        result.request.status === 'rejected'
          ? 'Request rejected and signed'
          : result.request.status === 'closed'
            ? 'Release completed and signed'
            : `Advanced to ${STEP_LABEL[result.request.status] ?? result.request.status}`,
        'success',
      )
      setDecisionOpen(false)
      setReason('')
      await reload()
    } catch (problem) {
      toast(errorMessage(problem), 'error')
    } finally {
      setBusy(null)
    }
  }

  if (loading && !data) return <LoadingPanel rows={9} />
  if (error) {
    return (
      <EmptyState
        icon={<TriangleAlert size={20} />}
        title="This request is unavailable"
        hint={error}
        action={
          <div className="flex gap-2">
            <Link to="/requests" className="btn btn-secondary">
              <ArrowLeft size={14} /> Back to requests
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

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={
          <Link to="/requests" className="inline-flex items-center gap-1 text-mint-300 hover:text-mint-200">
            <ArrowLeft size={12} /> Release & refund queue
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xl">REQ-{String(data.id).padStart(4, '0')}</span>
            <Badge tone={STATUS_TONE[data.status] ?? 'slate'} dot>
              {data.status.replace(/_/g, ' ')}
            </Badge>
            <Badge tone={data.type === 'refund' ? 'amber' : 'cyan'}>{data.type}</Badge>
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Link to={`/instruments/${data.instrument_id}`} className="inline-flex items-center gap-1 hover:text-mint-300">
              <Landmark size={13} /> {data.reference ?? `Instrument #${data.instrument_id}`}
            </Link>
            <span>{data.institution ?? '—'}</span>
            <span className="inline-flex items-center gap-1">
              <Banknote size={13} /> {data.bank ?? '—'}
            </span>
          </span>
        }
        actions={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => void reload()}>
              <RefreshCw size={14} /> Refresh
            </button>
            {canVerifySignature && data.signature ? (
              <button type="button" className="btn btn-secondary" disabled={busy !== null} onClick={() => void openSignature()}>
                <FingerprintPattern size={14} /> Verify signature
              </button>
            ) : null}
            {canAct ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setDecision('approve')
                  setReason('')
                  setSignatureName(user?.name ?? '')
                  setDecisionOpen(true)
                }}
              >
                <Stamp size={15} /> Record decision
              </button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card-flat px-4 py-3">
          <p className="section-title">Amount in scope</p>
          <p className="tile-value mt-1 font-display text-lg font-semibold text-white">{currency(data.amount)}</p>
          <p className="mt-0.5 text-[0.64rem] text-mist-600">{compactCurrency(data.amount)} principal</p>
        </div>
        <div className="card-flat px-4 py-3">
          <p className="section-title">Eligibility checks</p>
          <p className="tile-value mt-1 font-display text-lg font-semibold text-white">
            {passed}/{totalChecks}
          </p>
          <div className="mt-1.5">
            <ScoreBar score={score} />
          </div>
        </div>
        <div className="card-flat px-4 py-3">
          <p className="section-title">Current desk</p>
          <p className="mt-1 text-sm font-semibold text-mist-100">
            {open ? STEP_OWNER[data.status] ?? data.status : data.status === 'closed' ? 'Closed' : 'Rejected'}
          </p>
          <p className="mt-0.5 text-[0.64rem] text-mist-600">{open ? 'Waiting for a signed decision' : 'No further action'}</p>
        </div>
        <div className="card-flat px-4 py-3">
          <p className="section-title">Last update</p>
          <p className="mt-1 text-sm font-semibold text-mist-100">{relativeTime(data.updated_at ?? data.created_at)}</p>
          <p className="mt-0.5 text-[0.64rem] text-mist-600">{dateTimeLabel(data.updated_at ?? data.created_at)}</p>
        </div>
      </div>

      {data.status === 'rejected' ? (
        <div className="flex items-start gap-2 rounded-xl border border-rose-400/30 bg-rose-400/8 px-4 py-3 text-xs text-rose-200">
          <CircleX size={16} className="mt-0.5 shrink-0" />
          <span>
            <strong className="font-semibold">Rejected.</strong> {data.decision_reason ?? 'No reason recorded.'}
          </span>
        </div>
      ) : null}

      {data.status === 'closed' ? (
        <div className="flex items-start gap-2 rounded-xl border border-mint-400/30 bg-mint-400/8 px-4 py-3 text-xs text-mint-200">
          <CircleCheckBig size={16} className="mt-0.5 shrink-0" />
          <span>
            <strong className="font-semibold">Released.</strong> The instrument is closed and the deposit returned.
            {data.closed_at ? ` Closed ${dateTimeLabel(data.closed_at)}.` : ''}
          </span>
        </div>
      ) : null}

      {canAct ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-signal-400/25 bg-signal-400/[0.05] px-4 py-3 text-xs text-signal-100">
          <Workflow size={16} className="shrink-0 text-signal-300" />
          <span className="flex-1">
            This step belongs to <strong className="font-semibold">{STEP_OWNER[data.status] ?? requiredRole}</strong>. You are
            signed in as {user?.role.replace(/_/g, ' ')}.
          </span>
          <button
            type="button"
            className="btn btn-secondary !py-1.5"
            disabled={busy !== null}
            onClick={() =>
              void run(
                'checklist',
                () => apiPost(`/api/requests/${data.id}/checklist/run`, {}),
                'Eligibility checklist re-run',
              )
            }
          >
            <ClipboardCheck size={14} /> {busy === 'checklist' ? 'Running…' : 'Run checklist'}
          </button>
        </div>
      ) : open ? (
        <div className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/[0.02] px-4 py-2.5 text-[0.72rem] text-mist-400">
          <UserRound size={14} className="text-mist-500" />
          Waiting for the {STEP_OWNER[data.status] ?? requiredRole?.replace(/_/g, ' ')} to act. Your role is read-only at
          this step.
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_330px]">
        <div className="space-y-4">
          <Panel>
            <SectionHeading
              title="Eligibility checklist"
              hint="Advisory, but approval is blocked until every item passes"
              action={
                <Badge tone={score === 100 ? 'green' : 'amber'}>
                  {passed}/{totalChecks} passed
                </Badge>
              }
            />
            {data.checklist.length === 0 ? (
              <EmptyState title="Checklist not computed" hint="Run the checklist to evaluate eligibility." />
            ) : (
              <div className="space-y-2">
                {data.checklist.map((item) => (
                  <div
                    key={item.key}
                    className={`rounded-xl border px-3 py-2.5 ${
                      item.passed ? 'border-mint-400/20 bg-mint-400/[0.04]' : 'border-rose-400/25 bg-rose-400/[0.05]'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <span
                        className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border ${
                          item.passed
                            ? 'border-mint-400/40 bg-mint-400/15 text-mint-300'
                            : 'border-rose-400/40 bg-rose-400/15 text-rose-300'
                        }`}
                      >
                        {item.passed ? <CircleCheckBig size={12} /> : <CircleX size={12} />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[0.76rem] font-semibold text-mist-100">{item.label}</p>
                        <p className="mt-0.5 text-[0.68rem] leading-relaxed text-mist-500">{item.detail}</p>
                        {!item.passed ? (
                          <p className="mt-1 rounded-md bg-rose-400/10 px-2 py-1 text-[0.64rem] text-rose-200">
                            Fix: {item.fix}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel>
            <SectionHeading title="Workflow trail" hint="Each completed step carried a signed decision" />
            <ol className="relative space-y-3 pl-5">
              <span className="absolute left-[7px] top-1 h-[calc(100%-8px)] w-px bg-white/10" />
              {(steps.length > 0 ? steps : data.steps_order?.map((step) => ({ step, status: 'pending', owner_id: null, note: null, acted_at: null })) ?? []).map(
                (step) => (
                  <li key={step.step} className="relative">
                    <span
                      className={`absolute -left-5 top-0.5 grid h-[15px] w-[15px] place-items-center rounded-full border-2 bg-ink-900 ${
                        step.status === 'completed'
                          ? 'border-mint-400'
                          : step.status === 'rejected'
                            ? 'border-rose-400'
                            : step.status === 'in_progress'
                              ? 'border-signal-400'
                              : 'border-white/20'
                      }`}
                    />
                    <div className="rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[0.74rem] font-semibold text-mist-100">{STEP_LABEL[step.step] ?? step.step}</p>
                        <Badge
                          tone={
                            step.status === 'completed'
                              ? 'green'
                              : step.status === 'rejected'
                                ? 'red'
                                : step.status === 'in_progress'
                                  ? 'cyan'
                                  : 'slate'
                          }
                        >
                          {step.status.replace(/_/g, ' ')}
                        </Badge>
                        <span className="ml-auto text-[0.62rem] text-mist-600">{dateTimeLabel(step.acted_at)}</span>
                      </div>
                      <p className="mt-0.5 text-[0.64rem] text-mist-500">{STEP_OWNER[step.step] ?? '—'}</p>
                      {step.note ? <p className="mt-1 text-[0.68rem] text-mist-300">{step.note}</p> : null}
                    </div>
                  </li>
                ),
              )}
            </ol>
          </Panel>
        </div>

        <aside className="space-y-4">
          <Panel>
            <SectionHeading title="Request" hint="Filed by the institution" />
            <InfoRow
              label="Instrument"
              value={
                <Link to={`/instruments/${data.instrument_id}`} className="font-mono text-signal-300 hover:underline">
                  {data.reference ?? `#${data.instrument_id}`}
                </Link>
              }
            />
            <InfoRow label="Institution" value={data.institution ?? '—'} />
            <InfoRow label="Bank" value={data.bank ?? '—'} />
            <InfoRow label="Amount" value={currency(data.amount, true)} />
            <InfoRow label="Type" value={<span className="capitalize">{data.type}</span>} />
            <InfoRow label="Opened" value={dateTimeLabel(data.created_at)} />
            <InfoRow label="Decided" value={dateTimeLabel(data.decided_at)} />
            <InfoRow label="Closed" value={dateTimeLabel(data.closed_at)} />
          </Panel>

          <Panel>
            <SectionHeading title="Reason on record" hint="Visible to every desk and the institution" />
            <p className="rounded-xl border border-white/8 bg-ink-950/40 px-3 py-2.5 text-[0.72rem] leading-relaxed text-mist-300">
              {data.reason}
            </p>
            {data.decision_reason ? (
              <div className="mt-3">
                <p className="mb-1 text-[0.6rem] font-bold uppercase tracking-[0.12em] text-mist-600">
                  Latest decision note
                </p>
                <p className="rounded-xl border border-signal-400/20 bg-signal-400/[0.05] px-3 py-2 text-[0.72rem] leading-relaxed text-mist-200">
                  {data.decision_reason}
                </p>
                <p className="mt-1 text-[0.62rem] capitalize text-mist-500">
                  decision: {data.decision ? DECISION_LABEL[data.decision] ?? data.decision : '—'}
                </p>
              </div>
            ) : null}
          </Panel>

          <Panel>
            <SectionHeading title="Authenticity" hint="One signature per decision" />
            <div className="space-y-2 text-[0.7rem] text-mist-400">
              <p className="flex items-center gap-2">
                <Stamp size={13} className="text-violet-300" /> Ed25519 officer signature
              </p>
              <p className="flex items-center gap-2">
                <ShieldCheck size={13} className="text-mint-300" /> Checked against the public key
              </p>
              <p className="flex items-center gap-2">
                <CalendarClock size={13} className="text-signal-300" /> Written to the hash chain
              </p>
            </div>
            {data.signature ? (
              <p className="mt-3 break-all rounded-lg border border-white/8 bg-ink-950/50 px-2.5 py-2 font-mono text-[0.58rem] text-mist-500">
                {data.signature.slice(0, 64)}…
              </p>
            ) : (
              <p className="mt-3 text-[0.66rem] text-mist-500">No signature recorded yet.</p>
            )}
            {canVerifySignature ? (
              <button
                type="button"
                className="btn btn-secondary mt-3 w-full !py-1.5"
                disabled={busy !== null || !data.signature}
                onClick={() => void openSignature()}
              >
                <FingerprintPattern size={14} /> Verify latest signature
              </button>
            ) : null}
          </Panel>

          <Link
            to={`/instruments/${data.instrument_id}`}
            className="flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3 text-[0.72rem] text-mist-300 transition hover:border-mint-400/30"
          >
            <span className="inline-flex items-center gap-2">
              <FileOutput size={14} className="text-mint-300" /> Open full instrument record
            </span>
            <ArrowRight size={14} />
          </Link>
        </aside>
      </div>

      <Modal
        open={decisionOpen}
        onClose={() => setDecisionOpen(false)}
        title="Record a signed decision"
        description="Approval is blocked if any checklist item fails. Rejections must also carry a written reason."
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setDecisionOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className={decision === 'reject' ? 'btn btn-danger' : 'btn btn-primary'}
              disabled={reason.trim().length < 3 || signatureName.trim().length < 2 || busy !== null}
              onClick={() => void submitDecision()}
            >
              <Stamp size={14} /> {busy === 'decision' ? 'Signing…' : decision === 'reject' ? 'Reject & sign' : 'Approve & sign'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {(['approve', 'reject'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setDecision(option)}
                className={`rounded-xl border px-3 py-2.5 text-left transition ${
                  decision === option
                    ? option === 'reject'
                      ? 'border-rose-400/45 bg-rose-400/10'
                      : 'border-mint-400/45 bg-mint-400/10'
                    : 'border-white/10 bg-white/[0.02] hover:border-white/25'
                }`}
              >
                <p className={`text-xs font-semibold capitalize ${option === 'reject' ? 'text-rose-200' : 'text-mint-200'}`}>
                  {option}
                </p>
                <p className="mt-0.5 text-[0.64rem] text-mist-500">
                  {option === 'approve'
                    ? data.status === 'authority'
                      ? 'Close the request and release the deposit'
                      : 'Send to the next desk'
                    : 'Stop the workflow with a reason'}
                </p>
              </button>
            ))}
          </div>

          <Field label="Reason" hint="At least 3 characters; stored and signed.">
            <textarea
              className="textarea"
              rows={4}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. All eligibility checks passed; bank confirmed the FDR and no discrepancy remains."
            />
          </Field>

          <Field label="Sign as" hint="Your typed name is embedded in the Ed25519 signature payload.">
            <input
              value={signatureName}
              onChange={(event) => setSignatureName(event.target.value)}
              className="input"
              placeholder="Full name"
            />
          </Field>

          {score < 100 ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-400/25 bg-amber-400/8 px-3 py-2 text-[0.68rem] text-amber-200">
              <CircleAlert size={14} className="mt-0.5 shrink-0" />
              {passed}/{totalChecks} checks pass. Approval will be blocked until the failed items are resolved, but a
              rejection is always allowed.
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={signatureOpen}
        onClose={() => setSignatureOpen(false)}
        title="Signature proof"
        description="Verification is performed server-side against the officer's Ed25519 public key."
        footer={
          <button type="button" className="btn btn-secondary" onClick={() => setSignatureOpen(false)}>
            Close
          </button>
        }
      >
        {signature ? (
          signature.ok ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 rounded-xl border border-mint-400/30 bg-mint-400/10 px-3 py-2 text-xs text-mint-200">
                <CircleCheckBig size={15} /> Signature is present and mathematically verifiable
              </div>
              <InfoRow label="Signer" value={signature.signer?.name ?? '—'} />
              <InfoRow label="Role" value={signature.signer?.role?.replace(/_/g, ' ') ?? '—'} />
              <InfoRow label="Key ID" value={signature.signer?.key_id ?? '—'} mono />
              <InfoRow label="Algorithm" value={signature.algo ?? 'Ed25519'} mono />
              <InfoRow label="Signed at" value={dateTimeLabel(signature.signed_at)} />
              <InfoRow label="Decision note" value={signature.decision_reason ?? '—'} />
              <div>
                <p className="mb-1 text-[0.6rem] font-bold uppercase tracking-[0.12em] text-mist-600">Signature</p>
                <p className="break-all rounded-lg border border-white/8 bg-ink-950/60 px-2.5 py-2 font-mono text-[0.6rem] text-mist-400">
                  {signature.signature}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-xl border border-amber-400/25 bg-amber-400/8 px-3 py-2 text-xs text-amber-200">
              <CircleAlert size={15} className="mt-0.5" /> {signature.message ?? 'No signed decision yet.'}
            </div>
          )
        ) : (
          <p className="text-xs text-mist-500">Loading signature proof…</p>
        )}
      </Modal>
    </div>
  )
}
