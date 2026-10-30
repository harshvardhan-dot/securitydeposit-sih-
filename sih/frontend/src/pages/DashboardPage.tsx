import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  BellRing,
  ChartBar,
  CircleCheckBig,
  Clock,
  CloudUpload,
  FileOutput,
  Hourglass,
  Layers,
  Link2,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Vault,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { compactCurrency, dateLabel, plainNumber, relativeTime } from '../lib/format'
import { useApi } from '../lib/useApi'
import type { DashboardSummary } from '../lib/types'
import {
  Badge,
  CountUp,
  EmptyState,
  LoadingPanel,
  PageHeader,
  Panel,
  ScoreBar,
  SectionHeading,
  StatTile,
} from '../components/ui'
import { ForecastChart, TrustDonut } from '../components/charts'
import { Reveal } from '../components/luminous'

const TILE_META: Record<
  string,
  { label: string; icon: typeof ShieldCheck; tone: 'mint' | 'signal' | 'amber' | 'rose' | 'violet'; status?: string }
> = {
  active: { label: 'Active deposits', icon: ShieldCheck, tone: 'mint', status: 'active,bank_confirmed' },
  expiring: { label: 'Expiring ≤ 90d', icon: Clock, tone: 'amber', status: 'expiring' },
  matured: { label: 'Matured', icon: Hourglass, tone: 'rose', status: 'matured' },
  renewed: { label: 'Renewed', icon: RefreshCw, tone: 'violet', status: 'renewed' },
  released: { label: 'Released', icon: CircleCheckBig, tone: 'signal', status: 'released' },
  pending: { label: 'Awaiting action', icon: ChartBar, tone: 'signal', status: 'submitted,under_verification,release_requested' },
  flagged: { label: 'Flagged', icon: TriangleAlert, tone: 'rose', status: 'flagged' },
}

const TODO_LINKS: Record<string, string> = {
  review: '/review',
  requests: '/requests',
  renew: '/instruments',
  clarify: '/instruments',
}

export default function DashboardPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { data, loading, error, reload } = useApi<DashboardSummary>('/api/dashboard/summary')

  if (loading && !data) return <LoadingPanel rows={8} />
  if (error) {
    return (
      <EmptyState
        icon={<TriangleAlert size={20} />}
        title="Could not load the dashboard"
        hint={error}
        action={
          <button type="button" className="btn btn-secondary" onClick={() => void reload()}>
            <RefreshCw size={14} /> Retry
          </button>
        }
      />
    )
  }
  if (!data) return null

  const isInstitution = user?.role === 'institution'
  const totalValue = data.totals.value
  const chainOk = data.chain.valid
  const bert = data.ai.bert
  const maxState = Math.max(1, ...data.states.map((state) => state.count))

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={isInstitution ? user?.institution ?? 'Institution workspace' : 'Regulation Bureau'}
        title={isInstitution ? 'Your deposit portfolio' : 'Portfolio overview'}
        subtitle={
          isInstitution
            ? 'Track every protected FDR, respond to clarifications, and renew before maturity.'
            : 'A live operating picture of deposits, verification queues and ledger integrity across all institutions.'
        }
        actions={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => void reload()}>
              <RefreshCw size={14} /> Refresh
            </button>
            {isInstitution || user?.role === 'admin' ? (
              <button type="button" className="btn btn-primary" onClick={() => navigate('/submit')}>
                <CloudUpload size={15} /> Submit FDR
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => navigate('/review')}>
                <FileOutput size={15} /> Open review queue
              </button>
            )}
          </>
        }
      />

      {!chainOk ? (
        <Link
          to="/ledger"
          className="flex items-start gap-3 rounded-2xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-xs text-rose-200 transition hover:border-rose-400/50"
        >
          <TriangleAlert size={17} className="mt-0.5 shrink-0" />
          <span>
            <strong className="font-semibold">Ledger integrity alert.</strong> The hash chain is broken
            {data.chain.broken_at !== null ? ` at block #${data.chain.broken_at}` : ''}. Open the audit ledger to inspect and
            heal it.
          </span>
          <ArrowRight size={14} className="ml-auto mt-0.5 shrink-0" />
        </Link>
      ) : null}

      <Reveal className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-7">
        {data.tiles.map((tile) => {
          const meta = TILE_META[tile.key] ?? TILE_META.pending
          const Icon = meta.icon
          return (
            <StatTile
              key={tile.key}
              label={meta.label}
              tone={meta.tone}
              icon={<Icon size={17} />}
              value={<CountUp value={tile.count} />}
              hint={compactCurrency(tile.value)}
              onClick={() => navigate(`/instruments?status=${encodeURIComponent(meta.status ?? '')}`)}
            />
          )
        })}
      </Reveal>

      <div className="grid gap-3 rounded-2xl border border-[color:var(--line)] inset-well p-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="flex items-center gap-3 rounded-xl bg-white/[0.02] px-3 py-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl border border-mint-400/20 bg-mint-400/10 text-mint-300">
            <ScanLine size={17} />
          </span>
          <div className="min-w-0">
            <p className="text-[0.6rem] uppercase tracking-[0.16em] text-mist-600">OCR engine</p>
            <p className="truncate text-xs font-semibold text-mist-100">{data.ai.ocr}</p>
          </div>
          <Badge tone="green" className="ml-auto">live</Badge>
        </div>
        <div className="flex items-center gap-3 rounded-xl bg-white/[0.02] px-3 py-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl border border-signal-400/20 bg-signal-400/10 text-signal-300">
            <Sparkles size={17} />
          </span>
          <div className="min-w-0">
            <p className="text-[0.6rem] uppercase tracking-[0.16em] text-mist-600">Field model</p>
            <p className="truncate text-xs font-semibold text-mist-100">{bert.model_id.split('/').pop()}</p>
            <p className="truncate text-[0.62rem] text-mist-500">
              {bert.dim ? `${bert.dim}-dim embedding` : 'hashed n-gram fallback'}
            </p>
          </div>
          <Badge tone={bert.available ? 'green' : 'amber'} className="ml-auto">
            {bert.available ? 'BERT' : 'fallback'}
          </Badge>
        </div>
        <div className="flex items-center gap-3 rounded-xl bg-white/[0.02] px-3 py-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/5 text-mist-300">
            <Layers size={17} />
          </span>
          <div className="min-w-0">
            <p className="text-[0.6rem] uppercase tracking-[0.16em] text-mist-600">Ledger chain</p>
            <p className="truncate text-xs font-semibold text-mist-100">
              {chainOk ? 'All blocks verified' : `Broken at #${data.chain.broken_at}`}
            </p>
            <p className="truncate font-mono text-[0.6rem] text-mist-500">{data.chain.blocks} blocks · {data.chain.head_hash.slice(0, 14)}…</p>
          </div>
          <Badge tone={chainOk ? 'green' : 'red'} className="ml-auto">
            {chainOk ? 'intact' : 'broken'}
          </Badge>
        </div>
        <div className="flex items-center gap-3 rounded-xl bg-white/[0.02] px-3 py-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl border border-amber-400/20 bg-amber-400/10 text-amber-300">
            <BellRing size={17} />
          </span>
          <div className="min-w-0">
            <p className="text-[0.6rem] uppercase tracking-[0.16em] text-mist-600">Reminder ladder</p>
            <p className="truncate text-xs font-semibold text-mist-100">
              {data.reminders_pending} unacknowledged
            </p>
            <p className="truncate text-[0.62rem] text-mist-500">
              {data.reminder_ladder.map((stage) => (stage === 0 ? 'expiry' : `${stage}d`)).join(' → ')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/reminders')}
            className="ml-auto text-mist-500 transition hover:text-amber-300"
            aria-label="Open reminders"
          >
            <ArrowRight size={15} />
          </button>
        </div>
      </div>

      <Reveal>
        <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <SectionHeading
            title="Maturity forecast"
            hint="Deposit value maturing across the next six months"
            action={
              <Badge tone="green">
                {compactCurrency(totalValue)} protected
              </Badge>
            }
          />
          <ForecastChart data={data.forecast} />
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {data.forecast.map((month) => (
              <div key={month.iso} className="rounded-lg border border-white/6 bg-white/[0.02] px-2 py-1.5 text-center">
                <p className="text-[0.58rem] uppercase tracking-wider text-mist-600">{month.month.split(' ')[0]}</p>
                <p className="font-display text-sm text-mist-100">{month.count}</p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel>
          <SectionHeading title="Trust distribution" hint="Advisory scoring, never a decision maker" />
          <TrustDonut green={data.trust.green} amber={data.trust.amber} red={data.trust.red} />
          <div className="mt-2 space-y-2">
            {[
              { label: 'Healthy (75–100)', value: data.trust.green, color: 'bg-mint-400' },
              { label: 'Watch (50–74)', value: data.trust.amber, color: 'bg-amber-400' },
              { label: 'At risk (<50)', value: data.trust.red, color: 'bg-rose-400' },
            ].map((row) => (
              <div key={row.label} className="flex items-center gap-2 text-[0.72rem]">
                <span className={`h-2 w-2 rounded-full ${row.color}`} />
                <span className="text-mist-400">{row.label}</span>
                <span className="ml-auto font-mono text-mist-200">{plainNumber(row.value)}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-xl border border-white/8 bg-ink-950/40 px-3 py-2">
            <p className="text-[0.62rem] uppercase tracking-[0.14em] text-mist-600">Value at risk</p>
            <p className="mt-0.5 font-display text-lg font-semibold text-amber-200">
              {compactCurrency(data.totals.value_at_risk)}
            </p>
            <p className="text-[0.64rem] text-mist-500">Flagged, matured or unresolved cases</p>
          </div>
        </Panel>
        </div>
      </Reveal>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel>
          <SectionHeading
            title="Needs your attention"
            hint={isInstitution ? 'Actions for your institution' : 'Queue priorities for the bureau'}
          />
          {data.todo.length === 0 ? (
            <EmptyState icon={<CircleCheckBig size={18} />} title="All clear" hint="No pending actions right now." />
          ) : (
            <div className="space-y-2">
              {data.todo.map((item, index) => {
                const to =
                  item.kind === 'review'
                    ? '/review'
                    : item.kind === 'requests'
                      ? '/requests'
                      : item.instrument_id
                        ? `/instruments/${item.instrument_id}`
                        : TODO_LINKS[item.kind] ?? '/instruments'
                return (
                  <Link
                    key={`${item.kind}-${index}`}
                    to={to}
                    className="group flex items-start gap-3 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5 transition hover:border-mint-400/30 hover:bg-white/[0.04]"
                  >
                    <span
                      className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
                        item.urgency === 'high' ? 'bg-rose-400' : item.urgency === 'medium' ? 'bg-amber-400' : 'bg-mint-400'
                      }`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.76rem] font-semibold text-mist-100">{item.title}</span>
                      <span className="mt-0.5 block truncate text-[0.68rem] text-mist-500">{item.detail}</span>
                    </span>
                    <ArrowRight size={13} className="mt-1 shrink-0 text-mist-600 transition group-hover:text-mint-300" />
                  </Link>
                )
              })}
            </div>
          )}
        </Panel>

        <Panel>
          <SectionHeading
            title="State distribution"
            hint="Deposits by institution state"
            action={<Badge tone="cyan">{data.states.length} states</Badge>}
          />
          <div className="space-y-2.5">
            {data.states.slice(0, 7).map((state) => (
              <div key={state.state}>
                <div className="mb-1 flex items-center justify-between gap-2 text-[0.7rem]">
                  <span className="flex items-center gap-1.5 truncate text-mist-300">
                    {state.state}
                    {state.flagged > 0 ? (
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-rose-400/15 px-1.5 text-[0.56rem] text-rose-300">
                        {state.flagged} flagged
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 font-mono text-mist-400">{state.count}</span>
                </div>
                <ScoreBar score={(state.count / maxState) * 100} />
              </div>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-center">
            <div className="rounded-lg border border-white/6 bg-white/[0.02] px-2 py-1.5">
              <p className="text-[0.58rem] uppercase tracking-wider text-mist-600">Institutions</p>
              <p className="font-display text-sm text-mist-100">{data.totals.institutions}</p>
            </div>
            <div className="rounded-lg border border-white/6 bg-white/[0.02] px-2 py-1.5">
              <p className="text-[0.58rem] uppercase tracking-wider text-mist-600">Documents</p>
              <p className="font-display text-sm text-mist-100">{data.totals.documents}</p>
            </div>
          </div>
        </Panel>

        <Panel>
          <SectionHeading
            title="Institutions needing follow-up"
            hint="Most flagged or matured deposits"
            action={
              <Link to="/institutions" className="text-[0.68rem] text-mint-300 hover:text-mint-200">
                View all
              </Link>
            }
          />
          {data.late_institutions.length === 0 ? (
            <EmptyState title="No escalations" hint="Every institution is on schedule." />
          ) : (
            <div className="space-y-2">
              {data.late_institutions.map((institution) => (
                <div
                  key={institution.institution_id}
                  className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5"
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-amber-400/20 bg-amber-400/10 text-[0.62rem] font-bold text-amber-200">
                    {institution.name.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.74rem] font-medium text-mist-100">{institution.name}</p>
                    <p className="text-[0.62rem] text-mist-500">{institution.state ?? '—'}</p>
                  </div>
                  <span className="badge border-rose-400/25 bg-rose-400/10 text-rose-300">{institution.count}</span>
                </div>
              ))}
            </div>
          )}
          <Link
            to="/vault"
            className="mt-3 flex items-center justify-between rounded-xl border border-signal-400/20 bg-signal-400/[0.05] px-3 py-2.5 text-[0.72rem] text-signal-200 transition hover:border-signal-400/40"
          >
            <span className="inline-flex items-center gap-2">
              <Vault size={15} /> Open the 3D vault
            </span>
            <ArrowRight size={14} />
          </Link>
        </Panel>
      </div>

      <Reveal>
      <Panel>
        <SectionHeading
          title="Recent ledger activity"
          hint="Every action is sealed into the SHA-256 hash chain"
          action={
            <Link to="/ledger" className="inline-flex items-center gap-1 text-[0.68rem] text-mint-300 hover:text-mint-200">
              <Link2 size={13} /> Full ledger
            </Link>
          }
        />
        {data.recent_activity.length === 0 ? (
          <EmptyState title="No activity yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Actor</th>
                  <th>Reference</th>
                  <th>Block</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_activity.map((block) => (
                  <tr key={block.idx}>
                    <td>
                      <span className="inline-flex items-center gap-2 text-[0.76rem] text-mist-100">
                        <span className="h-1.5 w-1.5 rounded-full bg-mint-400" />
                        {block.action.replace(/[._]/g, ' ')}
                      </span>
                    </td>
                    <td className="text-mist-400">{block.actor_name || 'system'}</td>
                    <td>
                      {block.instrument_id ? (
                        <Link to={`/instruments/${block.instrument_id}`} className="font-mono text-[0.7rem] text-signal-300 hover:underline">
                          {String((block.payload as { reference?: string }).reference ?? `#${block.instrument_id}`)}
                        </Link>
                      ) : (
                        <span className="text-mist-600">—</span>
                      )}
                    </td>
                    <td className="font-mono text-[0.68rem] text-mist-500">#{block.idx} · {block.hash.slice(0, 10)}…</td>
                    <td className="whitespace-nowrap text-[0.7rem] text-mist-500">{relativeTime(block.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-4 text-[0.64rem] text-mist-600">
          <span>Generated {dateLabel(data.generated_at)}</span>
          <span>·</span>
          <span>{data.notifications_unread} unread notifications</span>
          <span>·</span>
          <span>{data.totals.open_clarifications} open clarifications</span>
        </div>
      </Panel>
      </Reveal>
    </div>
  )
}
