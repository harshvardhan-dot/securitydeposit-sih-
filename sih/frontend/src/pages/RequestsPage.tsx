import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  CircleCheckBig,
  FileOutput,
  FileSearch,
  RefreshCw,
  Stamp,
  Timer,
  TriangleAlert,
  Workflow,
} from 'lucide-react'
import { compactCurrency, dateTimeLabel, relativeTime } from '../lib/format'
import { useApi } from '../lib/useApi'
import type { RequestRecord } from '../lib/types'
import {
  Badge,
  EmptyState,
  LoadingPanel,
  PageHeader,
  Panel,
  SectionHeading,
  StatTile,
} from '../components/ui'

const STATUS_TONE: Record<string, string> = {
  requested: 'blue',
  scrutiny: 'violet',
  verification: 'cyan',
  authority: 'indigo',
  closed: 'green',
  rejected: 'red',
}

const STATUS_LABEL: Record<string, string> = {
  requested: 'With scrutiny officer',
  scrutiny: 'With verification officer',
  verification: 'With competent authority',
  authority: 'Awaiting final signature',
  closed: 'Closed · released',
  rejected: 'Rejected',
}

const FILTERS = [
  { key: 'open', label: 'Open requests', statuses: ['requested', 'scrutiny', 'verification', 'authority'] },
  { key: 'all', label: 'All requests', statuses: [] },
  { key: 'closed', label: 'Closed', statuses: ['closed'] },
  { key: 'rejected', label: 'Rejected', statuses: ['rejected'] },
]

export default function RequestsPage() {
  const [filter, setFilter] = useState('open')
  const [search, setSearch] = useState('')
  const { data, loading, error, reload } = useApi<{ items: RequestRecord[]; total: number }>('/api/requests')
  const [refreshing, setRefreshing] = useState(false)

  const refresh = async () => {
    setRefreshing(true)
    try {
      await reload()
    } finally {
      setRefreshing(false)
    }
  }

  const all = data?.items ?? []
  const activeFilter = FILTERS.find((item) => item.key === filter) ?? FILTERS[0]

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return all
      .filter((row) => (activeFilter.statuses.length === 0 ? true : activeFilter.statuses.includes(row.status)))
      .filter((row) =>
        !needle
          ? true
          : (row.reference ?? '').toLowerCase().includes(needle) ||
            (row.institution ?? '').toLowerCase().includes(needle) ||
            (row.bank ?? '').toLowerCase().includes(needle),
      )
  }, [all, activeFilter, search])

  const counts = useMemo(
    () => ({
      open: all.filter((row) => ['requested', 'scrutiny', 'verification', 'authority'].includes(row.status)).length,
      closed: all.filter((row) => row.status === 'closed').length,
      rejected: all.filter((row) => row.status === 'rejected').length,
      value: all
        .filter((row) => ['requested', 'scrutiny', 'verification', 'authority'].includes(row.status))
        .reduce((sum, row) => sum + row.amount, 0),
    }),
    [all],
  )

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Release & refund workflow"
        title="Deposit exits"
        subtitle="Four signed steps: institution request → scrutiny → bank verification → competent authority. Each decision is sealed with an Ed25519 signature."
        actions={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => void refresh()} disabled={refreshing}>
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> Refresh
            </button>
            <Link to="/instruments" className="btn btn-primary">
              <FileOutput size={15} /> Start from an FDR
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Open" value={counts.open} hint="In the four-step workflow" icon={<Workflow size={17} />} tone="signal" />
        <StatTile label="Closed" value={counts.closed} hint="Deposits returned" icon={<CircleCheckBig size={17} />} tone="mint" />
        <StatTile label="Rejected" value={counts.rejected} hint="With signed reasons" icon={<TriangleAlert size={17} />} tone="rose" />
        <StatTile label="Value in flight" value={compactCurrency(counts.value)} hint="Open requests only" icon={<Timer size={17} />} tone="violet" />
      </div>

      <Panel className="!p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-1 rounded-xl border border-white/8 bg-ink-950/40 p-1">
            {FILTERS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setFilter(item.key)}
                className={`rounded-lg px-3 py-1.5 text-[0.72rem] font-semibold transition ${
                  filter === item.key ? 'bg-white/10 text-white' : 'text-mist-400 hover:text-mist-200'
                }`}
              >
                {item.label}
                <span className="ml-1.5 text-[0.62rem] text-mist-500">
                  {item.key === 'all'
                    ? all.length
                    : item.key === 'open'
                      ? counts.open
                      : item.key === 'closed'
                        ? counts.closed
                        : counts.rejected}
                </span>
              </button>
            ))}
          </div>
          <div className="relative w-full max-w-xs">
            <FileSearch size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-mist-500" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Filter by reference, bank, institution…"
              className="input !py-2 !pl-9 !text-xs"
            />
          </div>
        </div>
      </Panel>

      {loading && !data ? (
        <LoadingPanel rows={6} />
      ) : error ? (
        <EmptyState
          icon={<TriangleAlert size={20} />}
          title="Requests could not be loaded"
          hint={error}
          action={
            <button type="button" className="btn btn-secondary" onClick={() => void refresh()}>
              <RefreshCw size={14} /> Retry
            </button>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<FileOutput size={20} />}
          title={search ? 'No request matches that filter' : 'No requests in this view'}
          hint={
            search
              ? 'Clear the search box to see the full queue.'
              : 'Open an instrument and choose “Request release / refund” to start the workflow.'
          }
          action={
            <Link to="/instruments" className="btn btn-secondary">
              Browse instruments
            </Link>
          }
        />
      ) : (
        <Panel className="!p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Request</th>
                  <th>Instrument</th>
                  <th>Institution</th>
                  <th className="text-right">Amount</th>
                  <th>Type</th>
                  <th>Stage</th>
                  <th>Opened</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link to={`/requests/${row.id}`} className="font-mono text-[0.72rem] text-signal-300 hover:underline">
                        REQ-{String(row.id).padStart(4, '0')}
                      </Link>
                      <p className="mt-0.5 text-[0.62rem] text-mist-600">
                        {row.checklist.filter((item) => item.passed).length}/{row.checklist.length || 0} checks
                      </p>
                    </td>
                    <td>
                      <Link
                        to={`/instruments/${row.instrument_id}`}
                        className="font-mono text-[0.68rem] text-mist-200 hover:text-mint-300"
                      >
                        {row.reference ?? `#${row.instrument_id}`}
                      </Link>
                      <p className="max-w-[140px] truncate text-[0.62rem] text-mist-600">{row.bank ?? '—'}</p>
                    </td>
                    <td className="max-w-[180px] truncate text-[0.74rem] text-mist-300">{row.institution ?? '—'}</td>
                    <td className="text-right font-mono text-[0.78rem] text-mist-100">{compactCurrency(row.amount)}</td>
                    <td>
                      <Badge tone={row.type === 'refund' ? 'amber' : 'cyan'}>{row.type}</Badge>
                    </td>
                    <td>
                      <Badge tone={STATUS_TONE[row.status] ?? 'slate'} dot>
                        {STATUS_LABEL[row.status] ?? row.status}
                      </Badge>
                      {row.decision ? (
                        <p className="mt-1 text-[0.6rem] capitalize text-mist-600">last decision: {row.decision}</p>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap">
                      <p className="text-[0.72rem] text-mist-300">{relativeTime(row.created_at)}</p>
                      <p className="text-[0.6rem] text-mist-600">{dateTimeLabel(row.created_at)}</p>
                    </td>
                    <td>
                      <Link to={`/requests/${row.id}`} className="btn btn-ghost !px-2 !py-1.5" aria-label="Open request">
                        <ArrowRight size={14} />
                      </Link>
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
          title="The signature trail"
          hint="Who signs at each step in this prototype"
          action={<Badge tone="violet">Ed25519</Badge>}
        />
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { step: '1 · Request', owner: 'Institution', detail: 'Files release or refund with a reason.' },
            { step: '2 · Scrutiny', owner: 'Scrutiny officer', detail: 'Checks eligibility and the document set.' },
            { step: '3 · Verification', owner: 'Verification officer', detail: 'Confirms the bank and amount once more.' },
            { step: '4 · Authority', owner: 'Competent authority', detail: 'Signs the final release; ledger closes the loop.' },
          ].map((item) => (
            <div key={item.step} className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5">
              <div className="flex items-center gap-1.5">
                <Stamp size={13} className="text-violet-300" />
                <p className="text-[0.7rem] font-semibold text-mist-100">{item.step}</p>
              </div>
              <p className="mt-0.5 text-[0.62rem] font-semibold uppercase tracking-wide text-signal-300">{item.owner}</p>
              <p className="mt-1 text-[0.64rem] leading-relaxed text-mist-500">{item.detail}</p>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  )
}
