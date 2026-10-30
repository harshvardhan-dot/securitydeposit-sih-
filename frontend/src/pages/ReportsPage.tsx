import { useState } from 'react'
import {
  ArrowRight,
  BarChart3,
  Download,
  FileSpreadsheet,
  FileText,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { downloadFile, errorMessage } from '../lib/api'
import { useApi } from '../lib/useApi'
import type { ReportPreview, ReportSummary } from '../lib/types'
import {
  Badge,
  EmptyState,
  LoadingPanel,
  PageHeader,
  Panel,
  SectionHeading,
  StatTile,
} from '../components/ui'

const REPORT_META: Record<string, { hint: string; tone: string }> = {
  pending_verifications: { hint: 'Deposits still in the verification pipeline', tone: 'signal' },
  upcoming_maturities: { hint: 'Deposits maturing within 180 days', tone: 'amber' },
  missing_documents: { hint: 'Missing receipts or unreadable fields', tone: 'rose' },
  high_risk: { hint: 'Low trust, flagged or matured cases', tone: 'rose' },
}

export default function ReportsPage() {
  const { user } = useAuth()
  const { toast } = useToast()
  const [report, setReport] = useState('pending_verifications')
  const [limit, setLimit] = useState(100)
  const [exporting, setExporting] = useState<string | null>(null)

  const { data: list } = useApi<{ items: ReportSummary[] }>('/api/reports')
  const { data, loading, error, reload } = useApi<ReportPreview>(`/api/reports/${report}?limit=${limit}`, [report, limit])

  const exportReport = async (format: 'csv' | 'xlsx' | 'pdf') => {
    setExporting(format)
    try {
      await downloadFile(`/api/reports/${report}/export?format=${format}`, `aicte-${report}.${format}`)
      toast(`Exported as ${format.toUpperCase()}.`, 'success')
    } catch (problem) {
      toast(errorMessage(problem), 'error')
    } finally {
      setExporting(null)
    }
  }

  const active = list?.items.find((item) => item.key === report)

  const headers = data?.headers ?? []
  const rows = data?.rows ?? []

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Reports & exports"
        title="Bureau reporting"
        subtitle="Four decision-support reports, scoped to your role. Export to CSV, Excel or PDF for the Regulation Bureau’s records."
        actions={
          <button type="button" className="btn btn-secondary" onClick={() => void reload()}>
            <RefreshCw size={14} /> Refresh
          </button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(list?.items ?? []).map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setReport(item.key)}
            className={`card text-left transition ${report === item.key ? 'border-mint-400/40' : 'hover:border-white/20'}`}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-[0.72rem] font-semibold text-mist-100">{item.label}</p>
              <Badge tone={REPORT_META[item.key]?.tone ?? 'slate'}>{item.count}</Badge>
            </div>
            <p className="mt-1 text-[0.64rem] leading-relaxed text-mist-500">
              {REPORT_META[item.key]?.hint ?? 'Report preview'}
            </p>
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Report"
          value={active?.label ?? report}
          hint={active ? `${active.count} row(s)` : '—'}
          icon={<BarChart3 size={17} />}
          tone="signal"
        />
        <StatTile
          label="Showing"
          value={rows.length}
          hint={`of ${data?.total ?? rows.length}`}
          icon={<FileText size={17} />}
          tone="mint"
        />
        <StatTile
          label="Role scope"
          value={user?.role.replace(/_/g, ' ') ?? '—'}
          hint={user?.role === 'institution' ? 'Own records only' : 'All institutions'}
          icon={<FileSpreadsheet size={17} />}
          tone="violet"
        />
        <StatTile
          label="Export formats"
          value="3"
          hint="CSV · Excel · PDF"
          icon={<Download size={17} />}
          tone="amber"
        />
      </div>

      <Panel>
        <SectionHeading
          title={active?.label ?? report}
          hint={REPORT_META[report]?.hint}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={String(limit)}
                onChange={(event) => setLimit(Number(event.target.value))}
                className="select !w-auto !py-1.5 !text-xs"
              >
                <option value="50">50 rows</option>
                <option value="100">100 rows</option>
                <option value="250">250 rows</option>
              </select>
              {(['csv', 'xlsx', 'pdf'] as const).map((format) => (
                <button
                  key={format}
                  type="button"
                  className="btn btn-secondary !px-2.5 !py-1.5 !text-[0.66rem]"
                  disabled={exporting !== null}
                  onClick={() => void exportReport(format)}
                >
                  {exporting === format ? <RefreshCw size={12} className="animate-spin" /> : <Download size={12} />}
                  {format.toUpperCase()}
                </button>
              ))}
            </div>
          }
        />

        {loading && !data ? (
          <LoadingPanel rows={6} />
        ) : error ? (
          <EmptyState
            icon={<TriangleAlert size={20} />}
            title="Report could not be generated"
            hint={error}
            action={
              <button type="button" className="btn btn-secondary" onClick={() => void reload()}>
                <RefreshCw size={14} /> Retry
              </button>
            }
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<BarChart3 size={20} />}
            title="Nothing to report"
            hint="No rows match this report for your scope."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  {headers.map((header) => (
                    <th key={header}>{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={index}>
                    {row.map((value, cellIndex) => (
                      <td
                        key={cellIndex}
                        className={
                          typeof value === 'number' && String(value).includes('.')
                            ? 'font-mono text-[0.72rem] text-mist-100'
                            : 'text-[0.74rem] text-mist-200'
                        }
                      >
                        {String(value)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[0.64rem] text-mist-600">
          <span>Values are decrypted server-side for authorised roles only.</span>
          <span className="inline-flex items-center gap-1">
            <ArrowRight size={11} /> Exports preserve the same row set
          </span>
        </div>
      </Panel>

      <Panel>
        <SectionHeading title="Report notes" hint="What each report is meant to support" />
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            { key: 'pending_verifications', detail: 'Use during daily stand-ups to clear the queue before maturities.' },
            { key: 'upcoming_maturities', detail: 'Plan the renewal conversation with institutions 180 days ahead.' },
            { key: 'missing_documents', detail: 'Find deposits whose OCR read was incomplete or unreadable.' },
            { key: 'high_risk', detail: 'Prioritise flagged, matured or low-trust cases for bureau attention.' },
          ].map((item) => (
            <div key={item.key} className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5">
              <p className="text-[0.72rem] font-semibold text-mist-100">
                {list?.items.find((row) => row.key === item.key)?.label ?? item.key}
              </p>
              <p className="mt-0.5 text-[0.64rem] leading-relaxed text-mist-500">{item.detail}</p>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  )
}
