import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Boxes,
  CircleCheckBig,
  Clock,
  Layers,
  RefreshCw,
  TriangleAlert,
  Vault,
} from 'lucide-react'
import { useApi } from '../lib/useApi'
import { compactCurrency, daysLabel, plainNumber } from '../lib/format'
import type { VaultBox } from '../lib/types'
import { Badge, EmptyState, LoadingPanel, PageHeader, Panel, ScoreBar, SectionHeading, TrustDial } from '../components/ui'
import { Vault2D, VaultLegend, VaultScene, supportsWebGL } from '../components/Vault3D'

export default function VaultPage() {
  const { data, loading, error, reload } = useApi<{ boxes: VaultBox[]; total: number }>('/api/dashboard/vault')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [use3d, setUse3d] = useState(() => supportsWebGL())

  const boxes = data?.boxes ?? []
  const selected = boxes.find((box) => box.id === selectedId) ?? boxes[0] ?? null

  const stats = useMemo(() => {
    const totalValue = boxes.reduce((sum, box) => sum + box.amount, 0)
    return {
      totalValue,
      protected: boxes.filter((box) => box.tone === 'green').length,
      expiring: boxes.filter((box) => box.tone === 'amber').length,
      risk: boxes.filter((box) => box.tone === 'red').length,
      closed: boxes.filter((box) => box.tone === 'grey').length,
    }
  }, [boxes])

  if (loading && !data) return <LoadingPanel rows={6} />
  if (error) {
    return (
      <EmptyState
        icon={<TriangleAlert size={20} />}
        title="The vault could not be opened"
        hint={error}
        action={
          <button type="button" className="btn btn-secondary" onClick={() => void reload()}>
            <RefreshCw size={14} /> Retry
          </button>
        }
      />
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Encrypted instrument store"
        title="3D vault"
        subtitle="Each glowing crate is a security deposit. Height and colour encode value and health; the vault is built from decrypted metadata only, never document contents."
        actions={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setUse3d((value) => !value)}>
              <Boxes size={14} /> {use3d ? 'Use 2D grid' : 'Use 3D vault'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => void reload()}>
              <RefreshCw size={14} /> Refresh
            </button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          { label: 'Crates', value: plainNumber(boxes.length), icon: Vault, tone: 'text-mint-300' },
          { label: 'Protected value', value: compactCurrency(stats.totalValue), icon: Layers, tone: 'text-signal-300' },
          { label: 'Protected', value: plainNumber(stats.protected), icon: CircleCheckBig, tone: 'text-mint-300' },
          { label: 'Expiring', value: plainNumber(stats.expiring), icon: Clock, tone: 'text-amber-300' },
          { label: 'At risk', value: plainNumber(stats.risk), icon: TriangleAlert, tone: 'text-rose-300' },
        ].map(({ label, value, icon: Icon, tone }) => (
          <div key={label} className="card-flat px-4 py-3">
            <div className="flex items-center justify-between">
              <p className="text-[0.6rem] font-bold uppercase tracking-[0.16em] text-mist-600">{label}</p>
              <Icon size={14} className={tone} />
            </div>
            <p className="tile-value mt-1.5 font-display text-lg font-semibold text-white">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <Panel className="!p-0 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/8 px-5 py-3.5">
            <div>
              <h2 className="font-display text-sm font-semibold text-white">Instrument vault</h2>
              <p className="text-[0.7rem] text-mist-500">
                {use3d ? 'Drag to orbit · click a crate to inspect it' : 'Select a deposit card to inspect it'}
              </p>
            </div>
            <VaultLegend />
          </div>

          <div className="relative h-[430px] w-full sm:h-[500px]">
            {boxes.length === 0 ? (
              <div className="grid h-full place-items-center px-6">
                <EmptyState title="The vault is empty" hint="Submit an FDR to add the first crate." />
              </div>
            ) : use3d ? (
              <VaultScene boxes={boxes} selectedId={selected?.id ?? null} onSelect={(box) => setSelectedId(box.id)} />
            ) : (
              <div className="h-full overflow-y-auto p-4">
                <Vault2D boxes={boxes} selectedId={selected?.id ?? null} onSelect={(box) => setSelectedId(box.id)} />
              </div>
            )}

            {use3d ? (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-ink-950/85 to-transparent p-4 text-[0.64rem] text-mist-500">
                <span>{plainNumber(boxes.length)} crates rendered</span>
                <span>WebGL · react-three-fiber</span>
              </div>
            ) : null}
          </div>
        </Panel>

        <Panel>
          <SectionHeading title="Inspector" hint="Metadata for the selected deposit" />
          {!selected ? (
            <EmptyState title="Nothing selected" hint="Pick a crate from the vault." />
          ) : (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-[0.7rem] text-signal-300">{selected.reference}</p>
                  <p className="mt-1 truncate font-display text-lg font-semibold text-white">{selected.bank}</p>
                  <p className="truncate text-[0.72rem] text-mist-500">{selected.institution ?? 'Institution'}</p>
                </div>
                <TrustDial score={selected.trust_score} size={58} />
              </div>

              <div className="rounded-xl border border-white/8 bg-ink-950/40 p-3">
                <p className="text-[0.6rem] uppercase tracking-[0.16em] text-mist-600">Deposit value</p>
                <p className="tile-value mt-1 font-display text-2xl font-semibold text-white">
                  {compactCurrency(selected.amount)}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge tone={selected.tone === 'green' ? 'green' : selected.tone === 'amber' ? 'amber' : selected.tone === 'red' ? 'red' : 'grey'}>
                    {selected.status.replace(/_/g, ' ')}
                  </Badge>
                  <span className="text-[0.68rem] text-mist-500">{daysLabel(selected.days_to_maturity)}</span>
                </div>
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between text-[0.7rem]">
                  <span className="text-mist-500">Trust score</span>
                  <span className="font-mono text-mist-200">{selected.trust_score}/100</span>
                </div>
                <ScoreBar score={selected.trust_score} />
              </div>

              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="rounded-lg border border-white/8 bg-white/[0.02] px-2 py-2">
                  <p className="text-[0.58rem] uppercase tracking-wider text-mist-600">Tone</p>
                  <p className="mt-0.5 text-xs font-semibold capitalize text-mist-100">{selected.tone}</p>
                </div>
                <div className="rounded-lg border border-white/8 bg-white/[0.02] px-2 py-2">
                  <p className="text-[0.58rem] uppercase tracking-wider text-mist-600">Maturity</p>
                  <p className="mt-0.5 text-xs font-semibold text-mist-100">
                    {selected.days_to_maturity === null ? '—' : `${selected.days_to_maturity}d`}
                  </p>
                </div>
              </div>

              <Link to={`/instruments/${selected.id}`} className="btn btn-primary w-full">
                Open full record <ArrowRight size={15} />
              </Link>
            </div>
          )}

          <div className="mt-5 rounded-xl border border-signal-400/20 bg-signal-400/[0.05] p-3">
            <p className="text-[0.66rem] font-semibold uppercase tracking-[0.14em] text-signal-300">How this is rendered</p>
            <p className="mt-1 text-[0.7rem] leading-relaxed text-mist-400">
              Only decrypted metadata (value, bank, maturity, trust) reaches the browser. AES-256-GCM ciphertext,
              OCR text and document blobs stay on the server.
            </p>
          </div>
        </Panel>
      </div>

      <Panel>
        <SectionHeading
          title="Vault inventory"
          hint={`${plainNumber(boxes.length)} of ${plainNumber(data?.total ?? boxes.length)} instruments shown`}
          action={<Badge tone="cyan">{plainNumber(stats.closed)} closed</Badge>}
        />
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
              </tr>
            </thead>
            <tbody>
              {boxes.slice(0, 14).map((box) => (
                <tr key={box.id} onClick={() => setSelectedId(box.id)} className="cursor-pointer">
                  <td>
                    <Link to={`/instruments/${box.id}`} className="font-mono text-[0.72rem] text-signal-300 hover:underline">
                      {box.reference}
                    </Link>
                  </td>
                  <td className="max-w-[190px] truncate text-mist-300">{box.institution ?? '—'}</td>
                  <td className="text-mist-200">{box.bank}</td>
                  <td className="text-right font-mono text-mist-100">{compactCurrency(box.amount)}</td>
                  <td className="whitespace-nowrap text-mist-400">{daysLabel(box.days_to_maturity)}</td>
                  <td className="font-mono text-mist-300">{box.trust_score}</td>
                  <td>
                    <Badge tone={box.tone === 'red' ? 'red' : box.tone === 'amber' ? 'amber' : box.tone === 'grey' ? 'grey' : 'green'}>
                      {box.status.replace(/_/g, ' ')}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex items-center justify-between text-[0.66rem] text-mist-600">
          <span>Amounts are decrypted per request for authorised users only.</span>
          <Link to="/instruments" className="inline-flex items-center gap-1 text-mint-300 hover:text-mint-200">
            Full register <ArrowRight size={12} />
          </Link>
        </div>
      </Panel>
    </div>
  )
}
