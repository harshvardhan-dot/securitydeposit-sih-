import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  ArrowRight,
  CloudUpload,
  Download,
  Funnel,
  Landmark,
  RefreshCw,
  RotateCcw,
  Search,
  TriangleAlert,
} from 'lucide-react'
import { withQuery } from '../lib/api'
import { compactCurrency, dateLabel, daysLabel, plainNumber } from '../lib/format'
import { useApi, useDebounced } from '../lib/useApi'
import type { InstrumentBrief, Paginated } from '../lib/types'
import {
  Badge,
  EmptyState,
  LoadingPanel,
  PageHeader,
  Pagination,
  Panel,
  ScoreBar,
  StatusBadge,
  TrustDial,
} from '../components/ui'

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'under_verification', label: 'Under verification' },
  { value: 'bank_confirmed', label: 'Bank confirmed' },
  { value: 'active', label: 'Active' },
  { value: 'expiring', label: 'Expiring soon' },
  { value: 'matured', label: 'Matured' },
  { value: 'renewed', label: 'Renewed' },
  { value: 'release_requested', label: 'Release requested' },
  { value: 'released', label: 'Released' },
  { value: 'flagged', label: 'Flagged' },
]

const SORT_OPTIONS = [
  { value: 'maturity', label: 'Maturity date' },
  { value: 'created', label: 'Newest first' },
  { value: 'amount', label: 'Highest amount' },
  { value: 'trust', label: 'Highest trust' },
  { value: 'institution', label: 'Institution A–Z' },
]

export default function InstrumentsPage() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState(params.get('q') ?? '')
  const debouncedSearch = useDebounced(search, 350)
  const page = Number(params.get('page') ?? '1') || 1
  const status = params.get('status') ?? ''
  const sort = params.get('sort') ?? 'maturity'
  const flagged = params.get('flagged') === 'true'
  const minTrust = params.get('min_trust') ?? ''
  const [showFilters, setShowFilters] = useState(Boolean(status || flagged || minTrust))

  const query = useMemo(
    () =>
      withQuery('/api/instruments', {
        q: debouncedSearch.trim() || undefined,
        status: status || undefined,
        sort,
        page,
        size: 20,
        flagged: flagged ? true : undefined,
        min_trust: minTrust || undefined,
      }),
    [debouncedSearch, status, sort, page, flagged, minTrust],
  )

  const { data, loading, error, reload } = useApi<Paginated<InstrumentBrief>>(query, [query])

  useEffect(() => {
    const current = params.get('q') ?? ''
    if (debouncedSearch.trim() === current) return
    const next = new URLSearchParams(params)
    if (debouncedSearch.trim()) next.set('q', debouncedSearch.trim())
    else next.delete('q')
    next.delete('page')
    setParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch])

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    if (key !== 'page') next.delete('page')
    setParams(next, { replace: true })
  }

  const reset = () => {
    setSearch('')
    setParams(new URLSearchParams(), { replace: true })
  }

  const items = data?.items ?? []
  const totalValue = items.reduce((sum, item) => sum + item.amount, 0)
  const withFilters = Boolean(status || flagged || minTrust || debouncedSearch)
  const canSubmit = user?.role === 'institution' || user?.role === 'admin'

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Register"
        title="FDR instrument register"
        subtitle="One verifiable record per security deposit: extracted fields, bank confirmation, trust score and a signed history."
        actions={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => void reload()}>
              <RefreshCw size={14} /> Refresh
            </button>
            {canSubmit ? (
              <Link to="/submit" className="btn btn-primary">
                <CloudUpload size={15} /> Submit FDR
              </Link>
            ) : null}
          </>
        }
      />

      <Panel className="!p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-mist-500" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search reference, bank, branch, FDR number or institution…"
              className="input !pl-9"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select value={status} onChange={(event) => updateParam('status', event.target.value)} className="select !w-auto">
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select value={sort} onChange={(event) => updateParam('sort', event.target.value)} className="select !w-auto">
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={`btn ${showFilters ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setShowFilters((value) => !value)}
            >
              <Funnel size={14} /> Filters
            </button>
            {withFilters ? (
              <button type="button" className="btn btn-ghost" onClick={reset}>
                <RotateCcw size={14} /> Reset
              </button>
            ) : null}
          </div>
        </div>

        {showFilters ? (
          <div className="mt-3 grid gap-3 rounded-xl border border-white/8 bg-ink-950/40 p-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block">
              <span className="label">Minimum trust</span>
              <select value={minTrust} onChange={(event) => updateParam('min_trust', event.target.value)} className="select">
                <option value="">Any score</option>
                <option value="75">75+ healthy</option>
                <option value="50">50+ watch</option>
                <option value="25">25+</option>
              </select>
            </label>
            <label className="flex items-end gap-2 pb-1">
              <input
                type="checkbox"
                checked={flagged}
                onChange={(event) => updateParam('flagged', event.target.checked ? 'true' : '')}
                className="h-4 w-4 rounded border-white/20 bg-ink-950 accent-mint-400"
              />
              <span className="text-xs text-mist-300">Only flagged deposits</span>
            </label>
            <div className="flex items-end">
              <p className="text-[0.68rem] leading-relaxed text-mist-500">
                Amount ranges and free-text filters run after decryption, because encrypted columns cannot be range-scanned
                in SQLite.
              </p>
            </div>
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-4 text-[0.68rem] text-mist-500">
          <span>
            <strong className="text-mist-200">{plainNumber(data?.total ?? 0)}</strong> matching instrument(s)
          </span>
          <span>·</span>
          <span>
            page value <strong className="text-mist-200">{compactCurrency(totalValue)}</strong>
          </span>
          <span>·</span>
          <span>FDR numbers decrypted for your role only</span>
        </div>
      </Panel>

      {loading && !data ? (
        <LoadingPanel rows={8} />
      ) : error ? (
        <EmptyState
          icon={<TriangleAlert size={20} />}
          title="Could not load the register"
          hint={error}
          action={
            <button type="button" className="btn btn-secondary" onClick={() => void reload()}>
              <RefreshCw size={14} /> Retry
            </button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Landmark size={20} />}
          title="No FDRs match those filters"
          hint={withFilters ? 'Try widening the status or trust filter.' : 'Submit the first security deposit to populate the register.'}
          action={
            withFilters ? (
              <button type="button" className="btn btn-secondary" onClick={reset}>
                Clear filters
              </button>
            ) : canSubmit ? (
              <Link to="/submit" className="btn btn-primary">
                Submit FDR
              </Link>
            ) : undefined
          }
        />
      ) : (
        <Panel className="!p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Institution</th>
                  <th>Bank</th>
                  <th className="text-right">Amount</th>
                  <th>Maturity</th>
                  <th>Trust</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <Link to={`/instruments/${item.id}`} className="font-mono text-[0.72rem] text-signal-300 hover:underline">
                        {item.reference}
                      </Link>
                      {item.is_flagged ? (
                        <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-rose-400/15 px-1.5 py-0.5 text-[0.55rem] font-bold uppercase text-rose-300">
                          flag
                        </span>
                      ) : null}
                      <p className="mt-0.5 max-w-[150px] truncate text-[0.64rem] text-mist-600">
                        FDR {item.fdr_number || '—'}
                      </p>
                    </td>
                    <td className="max-w-[180px]">
                      <p className="truncate text-[0.78rem] text-mist-100">{item.institution ?? '—'}</p>
                      <p className="text-[0.64rem] text-mist-600">{item.institution_state ?? '—'}</p>
                    </td>
                    <td>
                      <p className="text-[0.78rem] text-mist-100">{item.bank}</p>
                      <p className="max-w-[150px] truncate text-[0.64rem] text-mist-600">{item.branch ?? '—'}</p>
                    </td>
                    <td className="text-right">
                      <p className="font-mono text-[0.8rem] text-mist-100">{compactCurrency(item.amount)}</p>
                      <p className="text-[0.62rem] text-mist-600">{item.issue_date ? dateLabel(item.issue_date) : '—'}</p>
                    </td>
                    <td className="whitespace-nowrap">
                      <p className="text-[0.76rem] text-mist-200">{dateLabel(item.maturity_date)}</p>
                      <p
                        className={`text-[0.64rem] ${
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
                        <TrustDial score={item.trust_score} size={38} />
                        <div className="w-16">
                          <ScoreBar score={item.trust_score} />
                        </div>
                      </div>
                    </td>
                    <td>
                      <StatusBadge status={item.status} label={item.status_label} tone={item.status_tone} />
                    </td>
                    <td>
                      <Link to={`/instruments/${item.id}`} className="btn btn-ghost !px-2 !py-1.5" aria-label="Open record">
                        <ArrowRight size={14} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-white/8 px-4 py-3">
            <Pagination
              page={data?.page ?? page}
              pages={data?.pages ?? 1}
              total={data?.total ?? items.length}
              onPage={(next) => updateParam('page', String(next))}
            />
          </div>
        </Panel>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-[0.64rem] text-mist-600">
        <span className="inline-flex items-center gap-1.5">
          <Download size={12} /> Need a spreadsheet? Use Reports → Upcoming maturities.
        </span>
        <Badge tone="slate">Read-only filters respect RBAC scope</Badge>
      </div>
    </div>
  )
}
