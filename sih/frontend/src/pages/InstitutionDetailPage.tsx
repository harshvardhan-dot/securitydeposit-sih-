import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  Building,
  Landmark,
  MapPin,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { compactCurrency, dateLabel, plainNumber } from '../lib/format'
import { useApi } from '../lib/useApi'
import type { InstitutionSummary } from '../lib/types'
import {
  Badge,
  EmptyState,
  InfoRow,
  LoadingPanel,
  PageHeader,
  Panel,
  SectionHeading,
  StatTile,
  StatusBadge,
} from '../components/ui'

export default function InstitutionDetailPage() {
  const { id } = useParams()
  const { user } = useAuth()
  const [search, setSearch] = useState('')
  const { data, loading, error, reload } = useApi<InstitutionSummary>(id ? `/api/institutions/${id}` : null)

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const items = data?.instruments ?? []
    if (!needle) return items
    return items.filter(
      (item) =>
        item.reference.toLowerCase().includes(needle) ||
        item.bank.toLowerCase().includes(needle) ||
        (item.fdr_number ?? '').toLowerCase().includes(needle),
    )
  }, [data, search])

  const ownInstitution = user?.institution_id === Number(id)

  if (loading && !data) return <LoadingPanel rows={8} />
  if (error) {
    return (
      <EmptyState
        icon={<TriangleAlert size={20} />}
        title="This institution could not be loaded"
        hint={error}
        action={
          <div className="flex gap-2">
            <Link to="/institutions" className="btn btn-secondary">
              <ArrowLeft size={14} /> Back
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

  const institution = data.institution
  const summary = data.summary

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={
          <Link to="/institutions" className="inline-flex items-center gap-1 text-mint-300 hover:text-mint-200">
            <ArrowLeft size={12} /> Institutions
          </Link>
        }
        title={institution.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono text-signal-300">{institution.aicte_id}</span>
            <span className="inline-flex items-center gap-1">
              <MapPin size={13} /> {institution.city ? `${institution.city}, ` : ''}{institution.state}
            </span>
            {ownInstitution ? <Badge tone="green">your institution</Badge> : null}
          </span>
        }
        actions={
          <button type="button" className="btn btn-secondary" onClick={() => void reload()}>
            <RefreshCw size={14} /> Refresh
          </button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label="Instruments" value={summary.instruments} hint="Total deposits" icon={<Landmark size={17} />} tone="signal" />
        <StatTile label="Protected value" value={compactCurrency(summary.value)} hint="All deposits" icon={<Building size={17} />} tone="mint" />
        <StatTile label="Expiring" value={summary.expiring ?? 0} hint="≤ 90 days" icon={<TriangleAlert size={17} />} tone="amber" />
        <StatTile label="Matured" value={summary.matured ?? 0} hint="Awaiting action" icon={<TriangleAlert size={17} />} tone="rose" />
        <StatTile
          label="Renewal punctuality"
          value={`${Math.round((summary.renewal_punctuality ?? 0) * 100)}%`}
          hint="Renewed or released on time"
          icon={<ArrowRight size={17} />}
          tone="violet"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Panel className="!p-0 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/8 px-4 py-3">
            <SectionHeading title="Deposits" hint={`${rows.length} of ${data?.instruments?.length ?? 0} shown`} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Filter reference, bank, FDR number…"
              className="input !w-64 !py-2 !text-xs"
            />
          </div>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Bank</th>
                  <th className="text-right">Amount</th>
                  <th>Maturity</th>
                  <th>Trust</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <Link to={`/instruments/${item.id}`} className="font-mono text-[0.72rem] text-signal-300 hover:underline">
                        {item.reference}
                      </Link>
                      <p className="mt-0.5 text-[0.62rem] text-mist-600">FDR {item.fdr_number || '—'}</p>
                    </td>
                    <td>
                      <p className="text-[0.74rem] text-mist-200">{item.bank}</p>
                      <p className="text-[0.62rem] text-mist-600">{item.branch ?? '—'}</p>
                    </td>
                    <td className="text-right font-mono text-[0.78rem] text-mist-100">{compactCurrency(item.amount)}</td>
                    <td className="whitespace-nowrap text-[0.72rem] text-mist-300">{dateLabel(item.maturity_date)}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[0.7rem] text-mist-300">{item.trust_score}</span>
                      </div>
                    </td>
                    <td>
                      <StatusBadge status={item.status} label={item.status_label} tone={item.status_tone} />
                      {item.is_flagged ? <span className="ml-1.5 text-[0.58rem] text-rose-300">flag</span> : null}
                    </td>
                    <td>
                      <Link to={`/instruments/${item.id}`} className="btn btn-ghost !px-2 !py-1.5">
                        <ArrowRight size={13} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-mist-500">No deposits match that filter.</div>
          ) : null}
        </Panel>

        <aside className="space-y-4">
          <Panel>
            <SectionHeading title="Institution record" hint="Registered AICTE entity" />
            <InfoRow label="Name" value={institution.name} />
            <InfoRow label="AICTE ID" value={institution.aicte_id} mono />
            <InfoRow label="State" value={institution.state} />
            <InfoRow label="City" value={institution.city ?? '—'} />
            <InfoRow label="Contact email" value={institution.contact_email ?? '—'} />
            <InfoRow label="Contact phone" value={institution.contact_phone ?? '—'} />
          </Panel>

          <Panel>
            <SectionHeading title="Health summary" hint="Roll-up across all deposits" />
            <div className="space-y-2">
              <InfoRow label="Total instruments" value={plainNumber(summary.instruments)} />
              <InfoRow label="Flagged" value={plainNumber(summary.flagged)} />
              <InfoRow label="Expiring" value={plainNumber(summary.expiring ?? 0)} />
              <InfoRow label="Matured" value={plainNumber(summary.matured ?? 0)} />
              <InfoRow label="Renewal punctuality" value={`${Math.round((summary.renewal_punctuality ?? 0) * 100)}%`} />
            </div>
            <p className="mt-3 text-[0.64rem] leading-relaxed text-mist-500">
              Value at the institution level is decrypted server-side; the browser only receives the aggregate.
            </p>
          </Panel>

          <Link
            to="/institutions"
            className="flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3 text-[0.72rem] text-mist-300 transition hover:border-mint-400/30"
          >
            <span className="inline-flex items-center gap-2">
              <Building size={14} className="text-mint-300" /> Back to all institutions
            </span>
            <ArrowLeft size={14} />
          </Link>
        </aside>
      </div>
    </div>
  )
}
