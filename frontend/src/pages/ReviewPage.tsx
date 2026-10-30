import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Banknote,
  CircleCheckBig,
  ClipboardCheck,
  Clock,
  FileSearch,
  RefreshCw,
  ScanText,
  ShieldAlert,
  TriangleAlert,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { apiPost, errorMessage } from '../lib/api'
import { compactCurrency, dateLabel, daysLabel } from '../lib/format'
import { useApi } from '../lib/useApi'
import type { InstrumentBrief } from '../lib/types'
import {
  Badge,
  EmptyState,
  LoadingPanel,
  PageHeader,
  Panel,
  ScoreBar,
  SectionHeading,
  StatTile,
  StatusBadge,
  TrustDial,
} from '../components/ui'

type QueueTab = 'all' | 'scrutiny' | 'bank' | 'activate' | 'flagged'

const TAB_META: Record<QueueTab, { label: string; hint: string; statuses: string[] }> = {
  all: {
    label: 'All pending',
    hint: 'Everything still moving through the bureau',
    statuses: ['submitted', 'under_verification', 'bank_confirmed'],
  },
  scrutiny: {
    label: 'Scrutiny',
    hint: 'New receipts waiting for a first officer check',
    statuses: ['submitted'],
  },
  bank: {
    label: 'Bank verification',
    hint: 'Adapters to call before the deposit can be activated',
    statuses: ['under_verification'],
  },
  activate: {
    label: 'Ready to activate',
    hint: 'Bank confirmed and waiting for scrutiny approval',
    statuses: ['bank_confirmed'],
  },
  flagged: {
    label: 'Flagged',
    hint: 'Duplicate, mismatch or bank-rejected instruments',
    statuses: [],
  },
}

export default function ReviewPage() {
  const { user } = useAuth()
  const { toast } = useToast()
  const [tab, setTab] = useState<QueueTab>('all')
  const [busy, setBusy] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const queuePath = useMemo(() => {
    if (tab === 'flagged') return '/api/instruments?flagged=true&size=200&sort=trust'
    const statuses = TAB_META[tab].statuses.join(',')
    return `/api/instruments?status=${encodeURIComponent(statuses)}&size=200&sort=created`
  }, [tab])

  const { data: queue, loading, error, reload } = useApi<{ items: InstrumentBrief[]; total: number }>(queuePath, [
    queuePath,
  ])
  const { data: flagged } = useApi<{ items: InstrumentBrief[]; total: number }>(
    '/api/instruments?flagged=true&size=200&sort=trust',
  )

  const role = user?.role
  const canBankVerify = role === 'verification_officer' || role === 'admin'
  const canApprove = role === 'scrutiny_officer' || role === 'admin'

  const items = useMemo(() => {
    const rows = queue?.items ?? []
    const needle = search.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter(
      (item) =>
        item.reference.toLowerCase().includes(needle) ||
        item.bank.toLowerCase().includes(needle) ||
        (item.institution ?? '').toLowerCase().includes(needle),
    )
  }, [queue, search])

  const counts = useMemo(() => {
    const rows = queue?.items ?? []
    return {
      total: queue?.total ?? rows.length,
      flagged: flagged?.total ?? 0,
      lowTrust: rows.filter((item) => item.trust_score < 50).length,
      expiring: rows.filter((item) => item.days_to_maturity !== null && item.days_to_maturity <= 90).length,
    }
  }, [queue, flagged])

  const act = async (key: string, action: () => Promise<unknown>, message: string) => {
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

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Operations · maker-checker"
        title="Review queue"
        subtitle="A single queue for scrutiny, bank verification and activation. Flags and low trust scores float to the top so nothing is buried."
        actions={
          <button type="button" className="btn btn-secondary" onClick={() => void reload()}>
            <RefreshCw size={14} /> Refresh queue
          </button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="In this queue"
          value={counts.total}
          hint={TAB_META[tab].label}
          icon={<ClipboardCheck size={17} />}
          tone="signal"
        />
        <StatTile label="Flagged overall" value={counts.flagged} hint="Needs a human decision" icon={<ShieldAlert size={17} />} tone="rose" />
        <StatTile label="Low trust here" value={counts.lowTrust} hint="Score below 50" icon={<TriangleAlert size={17} />} tone="amber" />
        <StatTile label="Matures ≤ 90d" value={counts.expiring} hint="Renewal conversation due" icon={<Clock size={17} />} tone="violet" />
      </div>

      <Panel className="!p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-1 rounded-xl border border-white/8 bg-ink-950/40 p-1">
            {(Object.keys(TAB_META) as QueueTab[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`rounded-lg px-3 py-1.5 text-[0.72rem] font-semibold transition ${
                  tab === key ? 'bg-white/10 text-white' : 'text-mist-400 hover:text-mist-200'
                }`}
              >
                {TAB_META[key].label}
              </button>
            ))}
          </div>
          <div className="relative w-full max-w-xs">
            <FileSearch size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-mist-500" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Filter this queue…"
              className="input !py-2 !pl-9 !text-xs"
            />
          </div>
        </div>
        <p className="mt-2 text-[0.68rem] text-mist-500">{TAB_META[tab].hint}</p>
      </Panel>

      {loading && !queue ? (
        <LoadingPanel rows={7} />
      ) : error ? (
        <EmptyState
          icon={<TriangleAlert size={20} />}
          title="The queue could not be loaded"
          hint={error}
          action={
            <button type="button" className="btn btn-secondary" onClick={() => void reload()}>
              <RefreshCw size={14} /> Retry
            </button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<CircleCheckBig size={20} />}
          title="This queue is clear"
          hint={
            tab === 'flagged'
              ? 'No instrument is currently flagged.'
              : 'Nothing is waiting at this stage. Check another tab or the register.'
          }
          action={
            <Link to="/instruments" className="btn btn-secondary">
              Open the full register
            </Link>
          }
        />
      ) : (
        <Panel className="!p-0 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/8 px-4 py-3">
            <SectionHeading
              title={TAB_META[tab].label}
              hint={`${items.length} record(s) shown${search ? ' after filtering' : ''}`}
            />
            <Badge tone={tab === 'flagged' ? 'red' : 'cyan'}>{items.length} open</Badge>
          </div>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Instrument</th>
                  <th>Institution</th>
                  <th>Bank</th>
                  <th className="text-right">Amount</th>
                  <th>Maturity</th>
                  <th>Trust</th>
                  <th>Status</th>
                  <th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <Link
                        to={`/instruments/${item.id}`}
                        className="font-mono text-[0.72rem] text-signal-300 hover:underline"
                      >
                        {item.reference}
                      </Link>
                      <p className="mt-0.5 max-w-[170px] truncate text-[0.62rem] text-mist-600">
                        FDR {item.fdr_number || '—'}
                      </p>
                    </td>
                    <td>
                      <p className="max-w-[190px] truncate text-[0.76rem] text-mist-100">{item.institution ?? '—'}</p>
                      <p className="text-[0.62rem] text-mist-600">{item.institution_state ?? '—'}</p>
                    </td>
                    <td>
                      <p className="text-[0.76rem] text-mist-200">{item.bank}</p>
                      <p className="max-w-[140px] truncate text-[0.62rem] text-mist-600">{item.branch ?? '—'}</p>
                    </td>
                    <td className="text-right">
                      <p className="font-mono text-[0.78rem] text-mist-100">{compactCurrency(item.amount)}</p>
                      <p className="text-[0.6rem] text-mist-600">{dateLabel(item.issue_date)}</p>
                    </td>
                    <td className="whitespace-nowrap">
                      <p className="text-[0.72rem] text-mist-200">{dateLabel(item.maturity_date)}</p>
                      <p
                        className={`text-[0.62rem] ${
                          item.days_to_maturity !== null && item.days_to_maturity < 0
                            ? 'text-rose-300'
                            : item.days_to_maturity !== null && item.days_to_maturity <= 90
                              ? 'text-amber-300'
                              : 'text-mist-600'
                        }`}
                      >
                        {daysLabel(item.days_to_maturity)}
                      </p>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <TrustDial score={item.trust_score} size={34} />
                        <div className="w-14">
                          <ScoreBar score={item.trust_score} />
                        </div>
                      </div>
                    </td>
                    <td>
                      <StatusBadge status={item.status} label={item.status_label} tone={item.status_tone} />
                      {item.is_flagged ? (
                        <p className="mt-1 max-w-[160px] truncate text-[0.6rem] text-rose-300">{item.flag_reason}</p>
                      ) : null}
                    </td>
                    <td>
                      <div className="flex items-center justify-end gap-1.5">
                        {canBankVerify && (item.status === 'submitted' || item.status === 'under_verification') ? (
                          <button
                            type="button"
                            className="btn btn-secondary !px-2 !py-1.5 !text-[0.66rem]"
                            disabled={busy !== null}
                            onClick={() =>
                              void act(
                                `bank-${item.id}`,
                                () => apiPost(`/api/instruments/${item.id}/verify/bank`, {}),
                                `Bank adapter called for ${item.reference}`,
                              )
                            }
                          >
                            <Banknote size={12} /> {busy === `bank-${item.id}` ? '…' : 'Verify'}
                          </button>
                        ) : null}
                        {canApprove && (item.status === 'submitted' || item.status === 'bank_confirmed') ? (
                          <button
                            type="button"
                            className="btn btn-primary !px-2 !py-1.5 !text-[0.66rem]"
                            disabled={busy !== null}
                            onClick={() =>
                              void act(
                                `approve-${item.id}`,
                                () => apiPost(`/api/instruments/${item.id}/confirm`, {}),
                                `${item.reference} activated and sealed`,
                              )
                            }
                          >
                            <CircleCheckBig size={12} /> {busy === `approve-${item.id}` ? '…' : 'Approve'}
                          </button>
                        ) : null}
                        <Link to={`/instruments/${item.id}`} className="btn btn-ghost !px-2 !py-1.5" aria-label="Open record">
                          <ArrowRight size={13} />
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel>
        <SectionHeading
          title="How the queue is ordered"
          hint="The bureau's maker-checker rules, as implemented in this prototype"
        />
        <div className="grid gap-2 sm:grid-cols-3">
          {[
            {
              icon: ScanText,
              title: 'Scrutiny first',
              detail: 'A submitted receipt is read against its OCR fields. Mismatches are shown to the officer.',
            },
            {
              icon: Banknote,
              title: 'Then the bank',
              detail: 'The adapter confirms the FDR number and amount. A failed call flags the instrument automatically.',
            },
            {
              icon: ShieldAlert,
              title: 'Human decision',
              detail: 'Only a scrutiny officer (or admin) activates the deposit. The mock bank never decides alone.',
            },
          ].map(({ icon: Icon, title, detail }) => (
            <div key={title} className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5">
              <div className="flex items-center gap-2">
                <Icon size={14} className="text-mint-300" />
                <p className="text-[0.72rem] font-semibold text-mist-100">{title}</p>
              </div>
              <p className="mt-1 text-[0.66rem] leading-relaxed text-mist-500">{detail}</p>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  )
}
