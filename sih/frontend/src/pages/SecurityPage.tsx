import { useState } from 'react'
import {
  FingerprintPattern,
  KeyRound,
  Link2,
  Lock,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  TriangleAlert,
  Users,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { dateTimeLabel, roleLabel, shortHash } from '../lib/format'
import { useApi } from '../lib/useApi'
import type { AiStatus, SecurityPosture } from '../lib/types'
import {
  Badge,
  EmptyState,
  IconTile,
  InfoRow,
  LoadingPanel,
  PageHeader,
  Panel,
  SectionHeading,
  StatTile,
} from '../components/ui'
import { AppearancePanel } from '../components/AppearancePanel'

const PILLARS = [
  {
    key: 'encryption',
    icon: Lock,
    title: 'Confidentiality',
    detail: 'Field-level AES-256-GCM so amounts and FDR numbers are unreadable in the database file.',
    tone: 'mint',
  },
  {
    key: 'integrity',
    icon: Link2,
    title: 'Integrity',
    detail: 'SHA-256 hash chain over every action. One altered byte breaks verification for everyone.',
    tone: 'signal',
  },
  {
    key: 'authenticity',
    icon: FingerprintPattern,
    title: 'Authenticity',
    detail: 'Ed25519 signatures bind each officer decision to a key held under their identity.',
    tone: 'violet',
  },
  {
    key: 'access',
    icon: KeyRound,
    title: 'Access control',
    detail: 'JWT sessions, TOTP MFA for officers, idle timeout and role-gated routes.',
    tone: 'amber',
  },
] as const

export default function SecurityPage() {
  const { user } = useAuth()
  const [refreshing, setRefreshing] = useState(false)
  const { data, loading, error, reload } = useApi<SecurityPosture>('/api/admin/security/posture')
  const { data: ai } = useApi<AiStatus>('/api/ai/status')

  const refresh = async () => {
    setRefreshing(true)
    try {
      await reload()
    } finally {
      setRefreshing(false)
    }
  }

  if (loading && !data) return <LoadingPanel rows={8} />

  if (error || !data) {
    return (
      <div className="space-y-5">
        <PageHeader
          eyebrow="Security posture"
          title="Controls, proofs and limits"
          subtitle="Live view of the cryptographic and access controls protecting the deposit register."
        />
        <EmptyState
          icon={<TriangleAlert size={20} />}
          title="Security posture could not be loaded"
          hint={error ?? 'Only administrators, auditors and the competent authority can view this page.'}
          action={
            <button type="button" className="btn btn-secondary" onClick={() => void refresh()}>
              <RefreshCw size={14} /> Retry
            </button>
          }
        />
      </div>
    )
  }

  const encryption = data.encryption
  const integrity = data.integrity
  const authenticity = data.authenticity
  const access = data.access
  const accountability = data.accountability

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Security posture"
        title="Controls, proofs and limits"
        subtitle={
          <>
            Live view of the cryptographic and access controls protecting the deposit register. Signed in as{' '}
            <span className="text-mist-200">{roleLabel(user?.role)}</span>.
          </>
        }
        actions={
          <>
            <Badge tone={data.environment === 'production' ? 'green' : 'amber'} dot>
              {data.environment}
            </Badge>
            <button type="button" className="btn btn-secondary" onClick={() => void refresh()} disabled={refreshing}>
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> Refresh
            </button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Chain integrity"
          value={integrity.chain_valid ? 'Verified' : `Broken #${integrity.broken_at}`}
          hint={`${integrity.blocks} sealed block(s)`}
          icon={<Link2 size={17} />}
          tone={integrity.chain_valid ? 'mint' : 'rose'}
        />
        <StatTile
          label="Signed blocks"
          value={authenticity.signed_blocks}
          hint={`${authenticity.keys_issued} officer key(s) issued`}
          icon={<FingerprintPattern size={17} />}
          tone="violet"
        />
        <StatTile
          label="MFA coverage"
          value={`${access.mfa_enabled_officers}/${access.officers}`}
          hint="Officer accounts"
          icon={<KeyRound size={17} />}
          tone={access.mfa_enabled_officers === access.officers ? 'mint' : 'amber'}
        />
        <StatTile
          label="Audit entries"
          value={accountability.audit_entries}
          hint={`${accountability.failed_attempts} denied attempt(s)`}
          icon={<ShieldCheck size={17} />}
          tone="signal"
        />
      </div>

      <AppearancePanel />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {PILLARS.map(({ key, icon: Icon, title, detail, tone }) => {
          const state =
            key === 'encryption'
              ? encryption.at_rest
              : key === 'integrity'
                ? integrity.chain_valid
                  ? 'Verified'
                  : 'Broken'
                : key === 'authenticity'
                  ? `${authenticity.algorithm}`
                  : 'Enforced'
          return (
            <Panel key={key} className="!p-4">
              <div className="flex items-start justify-between gap-2">
                <IconTile
                  size="md"
                  tone={
                    tone === 'mint' ? 'mint' : tone === 'signal' ? 'sky' : tone === 'violet' ? 'lavender' : 'amber'
                  }
                >
                  <Icon size={17} />
                </IconTile>
                <Badge tone={key === 'integrity' && !integrity.chain_valid ? 'red' : 'slate'}>{state}</Badge>
              </div>
              <p className="mt-3 text-[0.8rem] font-semibold text-mist-100">{title}</p>
              <p className="mt-1 text-[0.66rem] leading-relaxed text-mist-500">{detail}</p>
            </Panel>
          )
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <SectionHeading
            title="Encryption at rest"
            hint="Where plaintext is never written to disk"
            action={<Badge tone="green">{encryption.at_rest}</Badge>}
          />
          <InfoRow label="Algorithm" value={encryption.at_rest} mono />
          <InfoRow label="File storage" value={encryption.file_storage} />
          <InfoRow label="Key management" value={encryption.key_management} />
          <InfoRow label="Encrypted fields" value={`${encryption.field_level.length} columns`} />
          <div className="mt-3 flex flex-wrap gap-1.5">
            {encryption.field_level.map((field) => (
              <span
                key={field}
                className="rounded-md border border-[color:var(--line)] inset-well px-1.5 py-0.5 font-mono text-[0.6rem] text-mist-400"
              >
                {field}
              </span>
            ))}
          </div>
          <p className="mt-3 text-[0.64rem] leading-relaxed text-mist-500">
            Amounts and FDR numbers are stored only as AES-256-GCM ciphertext. Range sorts and text search run after
            decryption at the API layer, never by comparing encrypted bytes.
          </p>
        </Panel>

        <Panel>
          <SectionHeading
            title="Encryption in transit"
            hint="TLS posture for this deployment"
            action={
              <Badge tone={encryption.in_transit.scheme === 'https' ? 'green' : 'amber'}>
                {encryption.in_transit.scheme.toUpperCase()}
              </Badge>
            }
          />
          <InfoRow label="Scheme" value={encryption.in_transit.scheme} mono />
          <InfoRow label="HSTS" value={encryption.in_transit.hsts ? 'enabled' : 'only under HTTPS'} />
          <InfoRow label="Protocol" value={encryption.in_transit.minimum_version} />
          <div
            className={`mt-3 rounded-xl border px-3 py-2 text-[0.66rem] leading-relaxed ${
              encryption.in_transit.scheme === 'https'
                ? 'border-mint-400/20 bg-mint-400/5 text-mint-200'
                : 'border-amber-400/20 bg-amber-400/5 text-amber-200'
            }`}
          >
            {encryption.in_transit.note}
          </div>
          <p className="mt-3 text-[0.64rem] leading-relaxed text-mist-500">
            The prototype serves HTTP on localhost for judge convenience. The same application runs over TLS 1.3 with a
            generated certificate via the launcher flag, and sets HSTS plus strict security headers.
          </p>
        </Panel>

        <Panel>
          <SectionHeading
            title="Hash-chain integrity"
            hint="Tamper evidence over the full audit history"
            action={
              <Badge tone={integrity.chain_valid ? 'green' : 'red'} dot>
                {integrity.chain_valid ? 'valid' : 'broken'}
              </Badge>
            }
          />
          <InfoRow label="Algorithm" value={integrity.algorithm} />
          <InfoRow label="Blocks" value={integrity.blocks} mono />
          <InfoRow label="Head hash" value={shortHash(integrity.head_hash, 16, 10)} mono />
          <InfoRow label="Broken at" value={integrity.broken_at ?? '—'} mono />
          <p className="mt-3 text-[0.64rem] leading-relaxed text-mist-500">
            Each block commits to the previous block's hash, its action payload and the document digest. Verification
            recomputes the chain from genesis; a single altered field surfaces the exact block that was touched.
          </p>
        </Panel>

        <Panel>
          <SectionHeading
            title="Signature authenticity"
            hint="Non-repudiation for officer decisions"
            action={<Badge tone="violet">{authenticity.algorithm}</Badge>}
          />
          <InfoRow label="Algorithm" value={authenticity.algorithm} mono />
          <InfoRow label="Signed blocks" value={authenticity.signed_blocks} mono />
          <InfoRow label="Keys issued" value={authenticity.keys_issued} mono />
          <div className="mt-3 rounded-xl border border-violet-400/20 bg-violet-400/5 px-3 py-2 text-[0.66rem] leading-relaxed text-violet-200">
            {authenticity.note}
          </div>
          <p className="mt-3 text-[0.64rem] leading-relaxed text-mist-500">
            Approvals cannot be denied later: the decision payload is signed with the officer's private key, and the
            matching public key is stored alongside the block for independent verification.
          </p>
        </Panel>
      </div>

      <Panel>
        <SectionHeading
          title="Access control"
          hint="Who can do what, and how sessions are constrained"
          action={<Badge tone="cyan">{access.jwt_algorithm}</Badge>}
        />
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: 'JWT algorithm', value: access.jwt_algorithm, icon: KeyRound },
            { label: 'Token TTL', value: `${access.token_ttl_minutes} min`, icon: Lock },
            { label: 'Idle timeout', value: `${access.idle_timeout_minutes} min`, icon: ShieldCheck },
            { label: 'MFA roles', value: String(access.mfa_required_roles.length), icon: Users },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="rounded-xl border border-[color:var(--line)] inset-well px-3 py-2.5">
              <p className="flex items-center gap-1.5 section-title">
                <Icon size={12} className="text-mint-300" /> {label}
              </p>
              <p className="mt-1 font-display text-lg font-semibold text-mist-50">{value}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Role</th>
                <th>Permitted actions</th>
                <th className="text-right">MFA</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(access.rbac).map(([role, actions]) => (
                <tr key={role}>
                  <td className="whitespace-nowrap">
                    <span className="text-[0.74rem] font-semibold text-mist-100">{roleLabel(role)}</span>
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {actions.map((action) => (
                        <span
                          key={action}
                          className="rounded-md border border-[color:var(--line)] inset-well px-1.5 py-0.5 text-[0.62rem] text-mist-400"
                        >
                          {action}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="text-right">
                    {access.mfa_required_roles.includes(role) ? (
                      <Badge tone="green" dot>
                        required
                      </Badge>
                    ) : (
                      <Badge tone="slate">optional</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel>
          <SectionHeading title="Accountability" hint="What is recorded, and when" />
          <InfoRow label="Audit entries" value={accountability.audit_entries} mono />
          <InfoRow label="Denied attempts" value={accountability.failed_attempts} mono />
          <InfoRow label="Last chain check" value={dateTimeLabel(accountability.last_chain_check)} />
          <p className="mt-3 text-[0.64rem] leading-relaxed text-mist-500">
            Logins, MFA challenges, permission denials and every state change are written to the audit log with the
            actor, target and source IP.
          </p>
        </Panel>

        <Panel>
          <SectionHeading
            title="Document intelligence"
            hint="OCR and BERT stack used at intake"
            action={<Badge tone={ai?.bert?.available ? 'green' : 'amber'}>{(ai?.bert?.model_id ?? 'fallback').split('/').pop()}</Badge>}
          />
          <InfoRow label="OCR engine" value={ai?.ocr?.engine ?? 'Tesseract'} />
          <InfoRow label="OCR ready" value={ai?.ocr?.available ? 'yes' : 'no'} mono />
          <InfoRow label="Embedding model" value={ai?.bert?.enabled ? 'distilbert multilingual' : 'hash fallback'} />
          <InfoRow label="Dimensions" value={ai?.bert?.dim ?? '—'} mono />
          <InfoRow label="Device" value={ai?.bert?.device ?? '—'} mono />
          <InfoRow label="Field pipeline" value={ai?.ner?.pipeline ?? 'lexicon + rules'} />
          <p className="mt-3 text-[0.64rem] leading-relaxed text-mist-500">
            Uploaded receipts are encrypted, OCR'd, then aligned against learned field prototypes. If the transformer is
            unavailable the system degrades to a hashed n-gram encoder without blocking intake.
          </p>
        </Panel>

        <Panel>
          <SectionHeading title="Honest limits" hint="What this prototype does not claim" />
          <div className="space-y-2">
            {[
              { icon: ScanLine, text: 'Bank APIs are mocked deterministically for the demo; a real adapter would sign and reconcile responses.' },
              { icon: Lock, text: 'Keys live in local files for portability. Production would use an HSM or managed KMS with rotation.' },
              { icon: ShieldCheck, text: 'SQLite is single-node. Postgres with row-level security is the production shape.' },
              { icon: TriangleAlert, text: 'OCR confidence is advisory; a human officer remains the decision-maker on every deposit.' },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex gap-2 rounded-xl border border-[color:var(--line)] inset-well px-3 py-2">
                <Icon size={13} className="mt-0.5 shrink-0 text-amber-300" />
                <p className="text-[0.64rem] leading-relaxed text-mist-400">{text}</p>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  )
}
