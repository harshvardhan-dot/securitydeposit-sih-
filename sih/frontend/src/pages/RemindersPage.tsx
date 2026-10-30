import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  BellRing,
  CheckCircle2,
  Clock,
  Mail,
  Play,
  RefreshCw,
  Send,
  Smartphone,
  TriangleAlert,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { apiPost, errorMessage } from '../lib/api'
import { dateTimeLabel, relativeTime } from '../lib/format'
import { useApi } from '../lib/useApi'
import type { ReminderRecord, SchedulerResult } from '../lib/types'
import {
  Badge,
  EmptyState,
  LoadingPanel,
  PageHeader,
  Panel,
  SectionHeading,
  StatTile,
} from '../components/ui'

const STAGE_LABEL: Record<number, string> = {
  0: 'Maturity day',
  30: '30 days before',
  60: '60 days before',
  90: '90 days before',
}

export default function RemindersPage() {
  const { user } = useAuth()
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const [stageFilter, setStageFilter] = useState('all')
  const [channelFilter, setChannelFilter] = useState('all')
  const [showResult, setShowResult] = useState<SchedulerResult | null>(null)

  const { data, loading, error, reload } = useApi<{ items: ReminderRecord[]; total: number }>('/api/reminders')

  const items = data?.items ?? []
  const canRun = user?.role === 'admin' || user?.role === 'scrutiny_officer'

  const filtered = useMemo(
    () =>
      items.filter((item) => {
        if (stageFilter !== 'all' && String(item.stage) !== stageFilter) return false
        if (channelFilter !== 'all' && item.channel !== channelFilter) return false
        return true
      }),
    [items, stageFilter, channelFilter],
  )

  const stats = useMemo(() => {
    const acknowledged = items.filter((item) => item.acknowledged).length
    return {
      total: items.length,
      acknowledged,
      pending: items.length - acknowledged,
      stages: new Set(items.map((item) => item.stage)).size,
    }
  }, [items])

  const runScheduler = async () => {
    setBusy(true)
    try {
      const result = await apiPost<SchedulerResult>('/api/reminders/run', {})
      setShowResult(result)
      toast(
        `Reminder cycle complete — ${result.reminders_created} sent, ${result.status_changes} status changes.`,
        'success',
      )
      await reload()
    } catch (problem) {
      toast(errorMessage(problem), 'error')
    } finally {
      setBusy(false)
    }
  }

  const acknowledge = async (id: number) => {
    try {
      await apiPost(`/api/reminders/${id}/acknowledge`, {})
      toast('Reminder acknowledged', 'success')
      await reload()
    } catch (problem) {
      toast(errorMessage(problem), 'error')
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Reminder ladder"
        title="Deposit maturity reminders"
        subtitle="Automated notices fire 90, 60, 30 days and on maturity day. Institutions acknowledge them; every dispatch is ledgered."
        actions={
          <>
            {canRun ? (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => void runScheduler()}
              >
                <Play size={14} /> {busy ? 'Running…' : 'Run reminder cycle'}
              </button>
            ) : null}
            <button type="button" className="btn btn-secondary" onClick={() => void reload()}>
              <RefreshCw size={14} /> Refresh
            </button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Dispatches" value={stats.total} hint="Last 200 reminders" icon={<BellRing size={17} />} tone="signal" />
        <StatTile label="Pending" value={stats.pending} hint="Unacknowledged" icon={<Clock size={17} />} tone="amber" />
        <StatTile label="Acknowledged" value={stats.acknowledged} hint="Institution confirmed" icon={<CheckCircle2 size={17} />} tone="mint" />
        <StatTile label="Ladder stages" value={stats.stages} hint="Active stages in use" icon={<Send size={17} />} tone="violet" />
      </div>

      {showResult ? (
        <Panel>
          <SectionHeading
            title="Last scheduler run"
            hint={`Ran ${dateTimeLabel(showResult.ran_at)}`}
            action={<Badge tone="green">complete</Badge>}
          />
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: 'Instruments checked', value: showResult.instruments_checked },
              { label: 'Reminders created', value: showResult.reminders_created },
              { label: 'Status changes', value: showResult.status_changes },
              { label: 'Escalations', value: showResult.escalations },
            ].map((item) => (
              <div key={item.label} className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5">
                <p className="section-title">{item.label}</p>
                <p className="tile-value mt-1 font-display text-lg font-semibold text-white">{item.value}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[0.68rem] text-mist-500">
            Active ladder: {showResult.ladder.map((stage) => (stage === 0 ? 'expiry' : `${stage}d`)).join(' → ')}
          </p>
        </Panel>
      ) : null}

      <Panel className="!p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <select value={stageFilter} onChange={(event) => setStageFilter(event.target.value)} className="select !w-auto">
              <option value="all">All stages</option>
              <option value="90">90 days before</option>
              <option value="60">60 days before</option>
              <option value="30">30 days before</option>
              <option value="0">Maturity day</option>
            </select>
            <select value={channelFilter} onChange={(event) => setChannelFilter(event.target.value)} className="select !w-auto">
              <option value="all">All channels</option>
              <option value="email">Email</option>
              <option value="sms">SMS</option>
              <option value="in_app">In-app</option>
              <option value="portal">Portal</option>
            </select>
          </div>
          <p className="text-[0.68rem] text-mist-500">
            Showing {filtered.length} of {items.length} dispatches
          </p>
        </div>
      </Panel>

      {loading && !data ? (
        <LoadingPanel rows={6} />
      ) : error ? (
        <EmptyState
          icon={<TriangleAlert size={20} />}
          title="Reminders could not be loaded"
          hint={error}
          action={
            <button type="button" className="btn btn-secondary" onClick={() => void reload()}>
              <RefreshCw size={14} /> Retry
            </button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<BellRing size={20} />}
          title="Nothing in this view"
          hint={
            items.length === 0
              ? 'No reminders have been dispatched yet. Run the reminder cycle to populate the ladder.'
              : 'Try widening the stage or channel filter.'
          }
          action={
            canRun ? (
              <button type="button" className="btn btn-primary" onClick={() => void runScheduler()} disabled={busy}>
                <Play size={14} /> Run cycle
              </button>
            ) : (
              <Link to="/instruments" className="btn btn-secondary">
                Browse instruments
              </Link>
            )
          }
        />
      ) : (
        <Panel className="!p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Instrument</th>
                  <th>Stage</th>
                  <th>Channel</th>
                  <th>Recipient</th>
                  <th>Sent</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <Link
                        to={`/instruments/${item.instrument_id}`}
                        className="font-mono text-[0.72rem] text-signal-300 hover:underline"
                      >
                        {item.reference ?? `#${item.instrument_id}`}
                      </Link>
                      <p className="mt-0.5 text-[0.62rem] text-mist-600">
                        {item.payload ? String((item.payload as { bank?: string }).bank ?? '') : ''}
                      </p>
                    </td>
                    <td>
                      <Badge tone={item.stage === 0 ? 'red' : 'amber'}>
                        {STAGE_LABEL[item.stage] ?? `${item.stage}d`}
                      </Badge>
                    </td>
                    <td>
                      <span className="inline-flex items-center gap-1.5 text-[0.72rem] text-mist-200">
                        {item.channel === 'email' ? (
                          <Mail size={12} className="text-signal-300" />
                        ) : item.channel === 'sms' ? (
                          <Smartphone size={12} className="text-violet-300" />
                        ) : (
                          <BellRing size={12} className="text-mist-400" />
                        )}
                        {item.channel}
                      </span>
                    </td>
                    <td className="text-[0.72rem] capitalize text-mist-300">{item.recipient_role.replace(/_/g, ' ')}</td>
                    <td className="whitespace-nowrap">
                      <p className="text-[0.72rem] text-mist-300">{relativeTime(item.sent_at)}</p>
                      <p className="text-[0.62rem] text-mist-600">{dateTimeLabel(item.sent_at)}</p>
                    </td>
                    <td>
                      {item.acknowledged ? (
                        <Badge tone="green" dot>
                          acknowledged
                        </Badge>
                      ) : (
                        <Badge tone="amber" dot>
                          pending
                        </Badge>
                      )}
                    </td>
                    <td>
                      {!item.acknowledged ? (
                        <button
                          type="button"
                          className="btn btn-secondary !px-2 !py-1.5 !text-[0.66rem]"
                          onClick={() => void acknowledge(item.id)}
                        >
                          <CheckCircle2 size={12} /> Acknowledge
                        </button>
                      ) : (
                        <span className="text-[0.62rem] text-mist-600">{dateTimeLabel(item.acknowledged_at)}</span>
                      )}
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
          title="Reminder ladder logic"
          hint="How this prototype decides when to nudge"
          action={<Badge tone="cyan">configurable</Badge>}
        />
        <div className="grid gap-2 sm:grid-cols-4">
          {[
            { days: '90d', title: 'Early notice', detail: 'Gives the institution time to plan renewal.' },
            { days: '60d', title: 'Second notice', detail: 'Escalates to scrutiny and verification officers.' },
            { days: '30d', title: 'Final notice', detail: 'Strong warning before maturity.' },
            { days: '0d', title: 'Maturity day', detail: 'Status moves to matured if no renewal is filed.' },
          ].map((item) => (
            <div key={item.days} className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5">
              <p className="font-mono text-xs font-semibold text-mint-300">{item.days}</p>
              <p className="mt-0.5 text-[0.72rem] font-semibold text-mist-100">{item.title}</p>
              <p className="mt-1 text-[0.64rem] leading-relaxed text-mist-500">{item.detail}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[0.66rem] leading-relaxed text-mist-500">
          The ladder is stored in admin settings. Officers can run it manually during the demo; in production a cron job
          calls the same endpoint every night.
        </p>
      </Panel>
    </div>
  )
}
