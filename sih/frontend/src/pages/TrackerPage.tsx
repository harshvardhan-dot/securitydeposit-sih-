import { useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  CircleCheckBig,
  Clock,
  Globe,
  Landmark,
  Lock,
  Radar,
  Search,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react'
import { apiGet } from '../lib/api'
import { dateLabel, dateTimeLabel } from '../lib/format'
import type { PublicTrack } from '../lib/types'
import { Badge, EmptyState, LoadingPanel } from '../components/ui'

const SUGGESTIONS = ['AICTE-FDR-2026-00002', 'AICTE-FDR-2025-00001', 'AICTE-FDR-2026-00004']

export default function TrackerPage() {
  const [params, setParams] = useSearchParams()
  const [reference, setReference] = useState(params.get('ref') ?? '')
  const [data, setData] = useState<PublicTrack | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async (value: string) => {
    if (!value.trim()) {
      setError('Enter the reference ID printed on your receipt.')
      setData(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await apiGet<PublicTrack>(`/api/public/track/${encodeURIComponent(value.trim().toUpperCase())}`)
      setData(result)
      setParams({ ref: value.trim().toUpperCase() }, { replace: true })
    } catch (problem) {
      setData(null)
      setError(
        problem instanceof Error && problem.message
          ? problem.message
          : 'We could not find that reference. Please check the ID on your receipt.',
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const initial = params.get('ref')
    if (initial) void load(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    void load(reference)
  }

  const doneCount = data ? data.stages.filter((stage) => stage.done).length : 0

  return (
    <div className="min-h-screen">
      <header className="border-b border-white/8 bg-ink-950/70 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-5 py-4">
          <Link to="/login" className="btn btn-ghost !px-2" aria-label="Back to sign in">
            <ArrowLeft size={17} />
          </Link>
          <span className="grid h-9 w-9 place-items-center rounded-xl border border-mint-400/30 bg-mint-400/10">
            <ShieldCheck size={18} className="text-mint-300" />
          </span>
          <div className="min-w-0">
            <p className="font-display text-sm font-semibold text-white">
              AICTE <span className="text-mint-300">FDR</span> public tracker
            </p>
            <p className="text-[0.62rem] uppercase tracking-[0.16em] text-mist-500">Status only · no sensitive data</p>
          </div>
          <Link to="/login" className="btn btn-secondary ml-auto hidden sm:inline-flex">
            <Lock size={14} /> Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-5 py-8">
        <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
          <section>
            <p className="mb-2 inline-flex items-center gap-2 rounded-full border border-mint-400/25 bg-mint-400/8 px-3 py-1 text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-mint-300">
              <Globe size={12} /> Courier-style tracking
            </p>
            <h1 className="font-display text-3xl font-semibold leading-tight tracking-tight text-white">
              Where is my security deposit?
            </h1>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-mist-400">
              Enter the reference ID from your acknowledgement receipt. This page deliberately never exposes amounts,
              bank account numbers, documents or officer identities.
            </p>

            <form onSubmit={onSubmit} className="card mt-6 space-y-3 p-5">
              <label className="block">
                <span className="label">Reference ID</span>
                <span className="relative block">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-mist-500" />
                  <input
                    value={reference}
                    onChange={(event) => setReference(event.target.value.toUpperCase())}
                    placeholder="AICTE-FDR-2026-00001"
                    className="input !pl-9 font-mono uppercase tracking-wide"
                  />
                </span>
              </label>
              <button type="submit" disabled={loading} className="btn btn-primary w-full">
                {loading ? 'Checking…' : 'Track status'}
                {!loading ? <ArrowRight size={15} /> : null}
              </button>
              <div className="rounded-lg border border-white/8 bg-ink-950/40 px-3 py-2">
                <p className="text-[0.6rem] uppercase tracking-[0.14em] text-mist-600">Demo references</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {SUGGESTIONS.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => {
                        setReference(item)
                        void load(item)
                      }}
                      className="rounded-md border border-white/10 bg-white/5 px-2 py-1 font-mono text-[0.62rem] text-signal-300 transition hover:border-signal-400/40"
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            </form>

            <div className="mt-4 flex items-center gap-3 text-[0.66rem] text-mist-600">
              <Radar size={13} className="text-mint-400/70" /> Status is read from the same tamper-evident ledger the
              bureau uses.
            </div>
          </section>

          <section>
            {loading && !data ? (
              <LoadingPanel rows={5} />
            ) : error ? (
              <EmptyState
                icon={<TriangleAlert size={20} />}
                title="Reference not found"
                hint={error}
                action={
                  <button type="button" className="btn btn-secondary" onClick={() => void load(reference)}>
                    Try again
                  </button>
                }
              />
            ) : !data ? (
              <div className="card flex h-full flex-col justify-center p-8 text-center">
                <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-white/10 bg-white/5 text-signal-300">
                  <Landmark size={24} />
                </span>
                <p className="mt-3 font-display text-sm font-semibold text-mist-100">Nothing tracked yet</p>
                <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-mist-500">
                  Use one of the demo references or the ID printed on a submitted receipt to see the six-stage journey.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="card overflow-hidden">
                  <div className="border-b border-white/8 bg-gradient-to-r from-mint-400/[0.08] to-transparent p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-mono text-[0.72rem] text-signal-300">{data.reference}</p>
                        <p className="mt-1 font-display text-xl font-semibold text-white">{data.bank}</p>
                        <p className="mt-0.5 text-[0.7rem] text-mist-500">
                          FDR {data.fdr_number_masked || '—'} · matures {dateLabel(data.maturity_date)}
                        </p>
                      </div>
                      <Badge tone="green" dot>
                        {data.status_label}
                      </Badge>
                    </div>
                    <div className="mt-4">
                      <div className="mb-1.5 flex items-center justify-between text-[0.66rem] text-mist-500">
                        <span>
                          {doneCount} of {data.stages.length} stages complete
                        </span>
                        <span>{data.last_update ? dateTimeLabel(data.last_update) : '—'}</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/8">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-mint-400 to-signal-400 transition-all duration-700"
                          style={{ width: `${(doneCount / Math.max(1, data.stages.length)) * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  <ol className="divide-y divide-white/6">
                    {data.stages.map((stage, index) => (
                      <li key={stage.key} className="flex items-start gap-3 px-5 py-3">
                        <span
                          className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[0.62rem] font-bold ${
                            stage.done
                              ? 'border-mint-400/40 bg-mint-400/15 text-mint-300'
                              : 'border-white/12 bg-white/5 text-mist-500'
                          }`}
                        >
                          {stage.done ? <CircleCheckBig size={13} /> : index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className={`text-[0.8rem] font-medium ${stage.done ? 'text-mist-100' : 'text-mist-400'}`}>
                            {stage.label}
                          </p>
                          <p className="text-[0.64rem] text-mist-600">
                            {stage.at ? dateTimeLabel(stage.at) : stage.done ? 'Completed' : 'Pending'}
                          </p>
                        </div>
                        {stage.done ? (
                          <Clock size={12} className="mt-1 shrink-0 text-mint-400/70" />
                        ) : null}
                      </li>
                    ))}
                  </ol>
                </div>

                <div className="card p-5">
                  <div className="mb-2 flex items-center justify-between">
                    <h2 className="font-display text-sm font-semibold text-white">Recent updates</h2>
                    <Badge tone="slate">{data.events.length}</Badge>
                  </div>
                  {data.events.length === 0 ? (
                    <p className="text-xs text-mist-500">No public updates yet.</p>
                  ) : (
                    <ul className="space-y-2">
                      {data.events.slice(-6).reverse().map((event, index) => (
                        <li key={`${event.at}-${index}`} className="flex items-center gap-2 text-[0.72rem]">
                          <span className="h-1.5 w-1.5 rounded-full bg-signal-400" />
                          <span className="text-mist-200">{event.action}</span>
                          <span className="ml-auto text-[0.64rem] text-mist-600">{dateTimeLabel(event.at)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-3 rounded-lg border border-white/8 bg-ink-950/40 px-3 py-2 text-[0.64rem] leading-relaxed text-mist-500">
                    {data.note}
                  </p>
                </div>
              </div>
            )}
          </section>
        </div>

        <footer className="mt-10 flex flex-wrap items-center justify-between gap-2 border-t border-white/8 pt-4 text-[0.64rem] text-mist-600">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck size={12} className="text-mint-400/70" /> AICTE Regulation Bureau · Security Deposit & FDR
            prototype
          </span>
          <Link to="/login" className="inline-flex items-center gap-1 text-mint-300 hover:text-mint-200">
            Officer or institution sign-in <ArrowRight size={12} />
          </Link>
        </footer>
      </main>
    </div>
  )
}
