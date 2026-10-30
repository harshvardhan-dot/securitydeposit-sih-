import { useMemo, useState } from 'react'
import {
  ArrowRight,
  Ban,
  CheckCircle2,
  GitCompare,
  Link2,
  RefreshCw,
  Search,
  ShieldAlert,
  TriangleAlert,
  Wrench,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { apiPost, errorMessage } from '../lib/api'
import { dateTimeLabel, shortHash } from '../lib/format'
import { useApi } from '../lib/useApi'
import type { ChainStatus, LedgerBlock, LedgerStats } from '../lib/types'
import {
  EmptyState,
  Field,
  InfoRow,
  LoadingPanel,
  Modal,
  PageHeader,
  Panel,
  StatTile,
} from '../components/ui'

export default function LedgerPage() {
  const { user } = useAuth()
  const { toast } = useToast()
  const [page, setPage] = useState(1)
  const [actionFilter, setActionFilter] = useState('')
  const [instrumentFilter, setInstrumentFilter] = useState('')
  const [tamperOpen, setTamperOpen] = useState(false)
  const [tamperIdx, setTamperIdx] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [selected, setSelected] = useState<LedgerBlock | null>(null)

  const canTamper = user?.role === 'admin'
  const blocksPath = useMemo(() => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('size', '20')
    if (actionFilter.trim()) params.set('action', actionFilter.trim())
    if (instrumentFilter.trim()) params.set('instrument_id', instrumentFilter.trim())
    return `/api/ledger/blocks?${params.toString()}`
  }, [page, actionFilter, instrumentFilter])

  const { data, loading, error, reload } = useApi<{
    items: LedgerBlock[]
    total: number
    page: number
    pages: number
  }>(blocksPath, [blocksPath])

  const { data: verify, reload: reloadVerify } = useApi<ChainStatus>('/api/ledger/verify')
  const { data: stats, reload: reloadStats } = useApi<LedgerStats>('/api/ledger/stats')

  const refreshAll = async () => {
    await Promise.all([reload(), reloadVerify(), reloadStats()])
  }

  const heal = async () => {
    setBusy('heal')
    try {
      const result = await apiPost<{ verification: ChainStatus }>('/api/ledger/demo/heal', {})
      toast('Tampered block repaired from the backup and re-verified.', 'success')
      await refreshAll()
      void result
    } catch (problem) {
      toast(errorMessage(problem), 'error')
    } finally {
      setBusy(null)
    }
  }

  const tamper = async () => {
    setBusy('tamper')
    try {
      const payload = tamperIdx.trim() ? { idx: Number(tamperIdx) } : {}
      await apiPost('/api/ledger/demo/tamper', payload)
      setTamperOpen(false)
      setTamperIdx('')
      toast('A sealed block was deliberately altered. The chain is now broken.', 'warning')
      await refreshAll()
    } catch (problem) {
      toast(errorMessage(problem), 'error')
    } finally {
      setBusy(null)
    }
  }

  const chainOk = verify?.valid !== false
  const blocks = data?.items ?? []

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Audit ledger"
        title="Tamper-evident chain"
        subtitle="Every officer action, document hash and signature is sealed into a SHA-256 hash chain. Edit one byte and the break is visible to every viewer."
        actions={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => void refreshAll()}>
              <RefreshCw size={14} /> Refresh
            </button>
            {canTamper ? (
              <>
                <button type="button" className="btn btn-secondary" onClick={() => setTamperOpen(true)}>
                  <Ban size={14} /> Demo tamper
                </button>
                <button type="button" className="btn btn-primary" onClick={() => void heal()} disabled={busy !== null}>
                  <Wrench size={14} /> {busy === 'heal' ? 'Healing…' : 'Heal chain'}
                </button>
              </>
            ) : null}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Chain status"
          value={chainOk ? 'Intact' : `Broken #${verify?.broken_at}`}
          hint={chainOk ? 'All hashes verify' : 'Run heal to restore'}
          icon={<Link2 size={17} />}
          tone={chainOk ? 'mint' : 'rose'}
        />
        <StatTile label="Blocks" value={stats?.blocks ?? verify?.blocks ?? 0} hint="Sealed entries" icon={<GitCompare size={17} />} tone="signal" />
        <StatTile
          label="Head hash"
          value={shortHash(verify?.head_hash, 8, 6)}
          hint={`index ${verify?.head_index ?? '—'}`}
          icon={<ShieldAlert size={17} />}
          tone="violet"
        />
        <StatTile
          label="Signed blocks"
          value={stats?.counts?.requests ?? 0}
          hint="Requests on chain"
          icon={<CheckCircle2 size={17} />}
          tone="amber"
        />
      </div>

      {!chainOk ? (
        <div className="flex items-start gap-3 rounded-2xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-xs text-rose-200">
          <TriangleAlert size={17} className="mt-0.5 shrink-0" />
          <span className="flex-1">
            <strong className="font-semibold">Chain broken.</strong> Verification failed
            {verify?.broken_at !== null ? ` at block #${verify?.broken_at}` : ''}; reason: {verify?.reason ?? 'hash mismatch'}.
            Signature failures: {verify?.signature_failures?.length ? verify.signature_failures.join(', ') : 'none'}. Admins can heal
            the chain from the backup.
          </span>
          {canTamper ? (
            <button type="button" className="btn btn-primary !py-1.5" onClick={() => void heal()} disabled={busy !== null}>
              <Wrench size={14} /> Heal
            </button>
          ) : null}
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-xl border border-mint-400/25 bg-mint-400/5 px-4 py-2.5 text-xs text-mint-200">
          <CheckCircle2 size={15} />
          Every block verified, including Ed25519 signatures. Last check {dateTimeLabel(verify?.checked_at)}.
        </div>
      )}

      <Panel className="!p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full max-w-xs">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-mist-500" />
              <input
                value={actionFilter}
                onChange={(event) => {
                  setActionFilter(event.target.value)
                  setPage(1)
                }}
                placeholder="Filter action (e.g. instrument, request, ledger)"
                className="input !py-2 !pl-9 !text-xs"
              />
            </div>
            <input
              value={instrumentFilter}
              onChange={(event) => {
                setInstrumentFilter(event.target.value)
                setPage(1)
              }}
              placeholder="Instrument ID"
              className="input !w-28 !py-2 !text-xs"
            />
          </div>
          <p className="text-[0.68rem] text-mist-500">
            {data?.total ?? 0} block(s) · page {data?.page ?? page} of {data?.pages ?? 1}
          </p>
        </div>
      </Panel>

      {loading && !data ? (
        <LoadingPanel rows={7} />
      ) : error ? (
        <EmptyState
          icon={<TriangleAlert size={20} />}
          title="Ledger could not be loaded"
          hint={error}
          action={
            <button type="button" className="btn btn-secondary" onClick={() => void refreshAll()}>
              <RefreshCw size={14} /> Retry
            </button>
          }
        />
      ) : blocks.length === 0 ? (
        <EmptyState
          icon={<Link2 size={20} />}
          title="No blocks in this view"
          hint="Try clearing the action or instrument filter."
        />
      ) : (
        <Panel className="!p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Action</th>
                  <th>Actor</th>
                  <th>Instrument</th>
                  <th>Doc hash</th>
                  <th>Block hash</th>
                  <th>When</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {blocks.map((block) => (
                  <tr key={block.idx}>
                    <td className="font-mono text-[0.72rem] text-mist-200">#{block.idx}</td>
                    <td>
                      <p className="text-[0.74rem] font-medium text-mist-100">{block.action.replace(/[._]/g, ' ')}</p>
                      <p className="mt-0.5 max-w-[220px] truncate text-[0.6rem] text-mist-600">
                        {Object.entries(block.payload)
                          .filter(([, value]) => typeof value !== 'object')
                          .slice(0, 3)
                          .map(([key, value]) => `${key}=${String(value).slice(0, 24)}`)
                          .join(' · ')}
                      </p>
                    </td>
                    <td>
                      <p className="text-[0.74rem] text-mist-200">{block.actor_name || 'system'}</p>
                      <p className="text-[0.6rem] text-mist-600">{block.actor_role || '—'}</p>
                    </td>
                    <td>
                      {block.instrument_id ? (
                        <a
                          href={`/instruments/${block.instrument_id}`}
                          className="font-mono text-[0.7rem] text-signal-300 hover:underline"
                        >
                          #{block.instrument_id}
                        </a>
                      ) : (
                        <span className="text-mist-600">—</span>
                      )}
                    </td>
                    <td className="font-mono text-[0.62rem] text-mist-400">
                      {block.document_hash ? shortHash(block.document_hash, 8, 6) : '—'}
                    </td>
                    <td className="font-mono text-[0.62rem] text-mist-400">
                      <span className="text-signal-300">{shortHash(block.hash, 8, 6)}</span>
                    </td>
                    <td className="whitespace-nowrap text-[0.7rem] text-mist-500">
                      {dateTimeLabel(block.created_at)}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-ghost !px-2 !py-1.5"
                        onClick={() => setSelected(block)}
                      >
                        <ArrowRight size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-white/8 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                className="btn btn-secondary !px-2 !py-1.5"
                disabled={(data?.page ?? 1) <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                Prev
              </button>
              <span className="text-[0.7rem] text-mist-500">
                Page {data?.page ?? page} of {data?.pages ?? 1}
              </span>
              <button
                type="button"
                className="btn btn-secondary !px-2 !py-1.5"
                disabled={(data?.page ?? 1) >= (data?.pages ?? 1)}
                onClick={() => setPage((value) => value + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </Panel>
      )}

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected ? `Block #${selected.idx}` : 'Block'}
        description="Canonical JSON, hashes and signature of the sealed entry."
        width="max-w-2xl"
        footer={
          <button type="button" className="btn btn-secondary" onClick={() => setSelected(null)}>
            Close
          </button>
        }
      >
        {selected ? (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <InfoRow label="Action" value={selected.action} />
              <InfoRow label="Actor" value={`${selected.actor_name || 'system'} (${selected.actor_role || '—'})`} />
              <InfoRow label="Instrument" value={selected.instrument_id ? `#${selected.instrument_id}` : '—'} mono />
              <InfoRow label="Document hash" value={selected.document_hash ? shortHash(selected.document_hash, 16, 10) : '—'} mono />
            </div>
            <div>
              <p className="mb-1 text-[0.6rem] font-bold uppercase tracking-[0.12em] text-mist-600">Block hash</p>
              <p className="break-all rounded-lg border border-white/8 bg-ink-950/60 px-2.5 py-2 font-mono text-[0.6rem] text-signal-300">
                {selected.hash}
              </p>
            </div>
            <div>
              <p className="mb-1 text-[0.6rem] font-bold uppercase tracking-[0.12em] text-mist-600">Previous hash</p>
              <p className="break-all rounded-lg border border-white/8 bg-ink-950/60 px-2.5 py-2 font-mono text-[0.6rem] text-mist-400">
                {selected.prev_hash}
              </p>
            </div>
            <div>
              <p className="mb-1 text-[0.6rem] font-bold uppercase tracking-[0.12em] text-mist-600">Payload</p>
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border border-white/8 bg-ink-950/60 p-3 font-mono text-[0.62rem] text-mist-300">
                {JSON.stringify(selected.payload, null, 2)}
              </pre>
            </div>
            {selected.signature ? (
              <div>
                <p className="mb-1 text-[0.6rem] font-bold uppercase tracking-[0.12em] text-mist-600">
                  Signature · {selected.key_id ?? '—'}
                </p>
                <p className="break-all rounded-lg border border-white/8 bg-ink-950/60 px-2.5 py-2 font-mono text-[0.58rem] text-mist-500">
                  {selected.signature}
                </p>
                <p className="mt-1 text-[0.62rem] text-mist-600">
                  Signed by {selected.actor_name || 'officer'} · public key{' '}
                  {selected.signer_pubkey ? shortHash(selected.signer_pubkey, 12, 6) : '—'}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={tamperOpen}
        onClose={() => setTamperOpen(false)}
        title="Demo: tamper a sealed block"
        description="Deliberately alter a historical block so the hash chain breaks. This is the demonstration of tamper evidence."
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setTamperOpen(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn-danger" disabled={busy !== null} onClick={() => void tamper()}>
              <Ban size={14} /> {busy === 'tamper' ? 'Tampering…' : 'Tamper'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Block index (optional)" hint="Leave blank to tamper the latest block.">
            <input
              value={tamperIdx}
              onChange={(event) => setTamperIdx(event.target.value.replace(/[^0-9]/g, ''))}
              className="input font-mono"
              placeholder="e.g. 12"
            />
          </Field>
          <div className="rounded-xl border border-rose-400/20 bg-rose-400/5 px-3 py-2 text-[0.68rem] leading-relaxed text-rose-200">
            After tampering, the ledger verification will report the broken block and the chain colour turns red.
            Admins can then heal it from the backup.
          </div>
        </div>
      </Modal>
    </div>
  )
}
