import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Building,
  Landmark,
  MapPin,
  RefreshCw,
  Search,
  ShieldAlert,
  TriangleAlert,
} from 'lucide-react'
import { compactCurrency, plainNumber } from '../lib/format'
import { useApi } from '../lib/useApi'
import type { InstitutionRecord } from '../lib/types'
import {
  EmptyState,
  LoadingPanel,
  PageHeader,
  Panel,
  SectionHeading,
  StatTile,
} from '../components/ui'

export default function InstitutionsPage() {
  const [search, setSearch] = useState('')
  const [state, setState] = useState('')
  const { data, loading, error, reload } = useApi<{ items: InstitutionRecord[]; total: number }>('/api/institutions')
  const [refreshing, setRefreshing] = useState(false)

  const refresh = async () => {
    setRefreshing(true)
    try {
      await reload()
    } finally {
      setRefreshing(false)
    }
  }

  const states = useMemo(() => {
    const values = Array.from(new Set((data?.items ?? []).map((item) => item.state))).sort()
    return values
  }, [data])

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return (data?.items ?? []).filter((item) => {
      if (state && item.state !== state) return false
      if (!needle) return true
      return (
        item.name.toLowerCase().includes(needle) ||
        item.aicte_id.toLowerCase().includes(needle) ||
        item.city?.toLowerCase().includes(needle)
      )
    })
  }, [data, search, state])

  const totals = useMemo(() => {
    const items = data?.items ?? []
    return {
      institutions: items.length,
      instruments: items.reduce((sum, item) => sum + item.instruments, 0),
      value: items.reduce((sum, item) => sum + item.value, 0),
      flagged: items.reduce((sum, item) => sum + item.flagged, 0),
    }
  }, [data])

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Institutions"
        title="Registered AICTE entities"
        subtitle="Every institution that has submitted a security deposit. Value and flag counts are decrypted per request for authorised roles."
        actions={
          <button type="button" className="btn btn-secondary" onClick={() => void refresh()} disabled={refreshing}>
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> Refresh
          </button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Institutions" value={totals.institutions} hint="Registered" icon={<Building size={17} />} tone="signal" />
        <StatTile label="Instruments" value={totals.instruments} hint="Across all entities" icon={<Landmark size={17} />} tone="mint" />
        <StatTile label="Protected value" value={compactCurrency(totals.value)} hint="Total deposit value" icon={<ShieldAlert size={17} />} tone="violet" />
        <StatTile label="Flagged" value={totals.flagged} hint="Needs bureau attention" icon={<TriangleAlert size={17} />} tone="rose" />
      </div>

      <Panel className="!p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full max-w-xs">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-mist-500" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name, AICTE ID or city…"
                className="input !py-2 !pl-9 !text-xs"
              />
            </div>
            <select value={state} onChange={(event) => setState(event.target.value)} className="select !w-auto !py-2 !text-xs">
              <option value="">All states</option>
              {states.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
          <p className="text-[0.68rem] text-mist-500">
            {rows.length} of {data?.total ?? 0} institution(s)
          </p>
        </div>
      </Panel>

      {loading && !data ? (
        <LoadingPanel rows={6} />
      ) : error ? (
        <EmptyState
          icon={<TriangleAlert size={20} />}
          title="Institutions could not be loaded"
          hint={error}
          action={
            <button type="button" className="btn btn-secondary" onClick={() => void refresh()}>
              <RefreshCw size={14} /> Retry
            </button>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Building size={20} />}
          title="No institution matches"
          hint="Try a different search or state filter."
        />
      ) : (
        <Panel className="!p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Institution</th>
                  <th>AICTE ID</th>
                  <th>Location</th>
                  <th className="text-right">Instruments</th>
                  <th className="text-right">Active</th>
                  <th className="text-right">Flagged</th>
                  <th className="text-right">Value</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <Link to={`/institutions/${item.id}`} className="text-[0.78rem] font-semibold text-mist-100 hover:text-mint-300">
                        {item.name}
                      </Link>
                      <p className="text-[0.62rem] text-mist-600">{item.contact_email ?? '—'}</p>
                    </td>
                    <td className="font-mono text-[0.7rem] text-mist-300">{item.aicte_id}</td>
                    <td>
                      <p className="text-[0.72rem] text-mist-200">{item.city ?? '—'}</p>
                      <p className="text-[0.62rem] text-mist-600">{item.state}</p>
                    </td>
                    <td className="text-right font-mono text-[0.78rem] text-mist-100">{plainNumber(item.instruments)}</td>
                    <td className="text-right font-mono text-[0.78rem] text-mint-300">{plainNumber(item.active)}</td>
                    <td className="text-right font-mono text-[0.78rem] text-rose-300">{plainNumber(item.flagged)}</td>
                    <td className="text-right font-mono text-[0.78rem] text-mist-100">{compactCurrency(item.value)}</td>
                    <td>
                      <Link to={`/institutions/${item.id}`} className="btn btn-ghost !px-2 !py-1.5" aria-label="Open institution">
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
          title="How to use this view"
          hint="Institution-level roll-up of deposit health"
        />
        <div className="grid gap-2 sm:grid-cols-3">
          {[
            { icon: MapPin, title: 'State filter', detail: 'Narrow by institution state to plan regional follow-up.' },
            { icon: ShieldAlert, title: 'Flag counts', detail: 'A non-zero flag count means at least one deposit needs a human decision.' },
            { icon: Landmark, title: 'Open record', detail: 'Click any institution to see its full deposit list and summary.' },
          ].map(({ icon: Icon, title, detail }) => (
            <div key={title} className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5">
              <div className="flex items-center gap-2">
                <Icon size={14} className="text-mint-300" />
                <p className="text-[0.72rem] font-semibold text-mist-100">{title}</p>
              </div>
              <p className="mt-1 text-[0.64rem] leading-relaxed text-mist-500">{detail}</p>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  )
}
