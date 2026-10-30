import { useEffect, useMemo, useState } from 'react'
import {
  Building,
  KeyRound,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  TriangleAlert,
  Users,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { apiPatch, apiPost, apiPut, errorMessage } from '../lib/api'
import { dateTimeLabel } from '../lib/format'
import { useApi } from '../lib/useApi'
import type { AdminSettings, AuditEntry, InstitutionRecord } from '../lib/types'
import {
  Badge,
  EmptyState,
  Field,
  LoadingPanel,
  Modal,
  PageHeader,
  Panel,
  SectionHeading,
  StatTile,
} from '../components/ui'

const ROLES = ['institution', 'scrutiny_officer', 'verification_officer', 'competent_authority', 'admin', 'auditor']

export default function AdminPage() {
  const { user } = useAuth()
  const { toast } = useToast()
  const [tab, setTab] = useState<'users' | 'settings' | 'audit'>('users')
  const [roleFilter, setRoleFilter] = useState('')
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newUser, setNewUser] = useState({
    email: '',
    name: '',
    role: 'institution',
    institution_id: '',
    password: 'Aicte@2026',
    phone: '',
    language: 'en',
  })
  const [createdMfa, setCreatedMfa] = useState<{ secret: string; current_code: string; note: string } | null>(null)
  const [settingsDraft, setSettingsDraft] = useState({
    ladder: '',
    verification_overdue_days: '',
    clarification_overdue_days: '',
  })
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [auditAction, setAuditAction] = useState('')
  const [auditAllowed, setAuditAllowed] = useState('all')

  const { data: users, loading: usersLoading, error: usersError, reload: reloadUsers } = useApi<{
    items: {
      id: number
      email: string
      name: string
      role: string
      active: boolean
      institution_id: number | null
      institution: string | null
      mfa_enabled: boolean
      last_login_at: string | null
    }[]
    total: number
  }>(`/api/admin/users${roleFilter ? `?role=${roleFilter}` : ''}`)

  const { data: institutions } = useApi<{ items: InstitutionRecord[]; total: number }>('/api/institutions')

  const { data: settings, reload: reloadSettings } = useApi<AdminSettings>('/api/admin/settings')

  const auditQuery = useMemo(() => {
    const params = new URLSearchParams()
    if (auditAction.trim()) params.set('action', auditAction.trim())
    if (auditAllowed !== 'all') params.set('allowed', auditAllowed === 'allowed' ? 'true' : 'false')
    params.set('limit', '150')
    return `/api/admin/audit?${params.toString()}`
  }, [auditAction, auditAllowed])

  const { data: audit, loading: auditLoading, error: auditError } = useApi<{ items: AuditEntry[]; total: number }>(
    auditQuery,
    [auditQuery],
  )

  const filteredUsers = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return (users?.items ?? []).filter((item) =>
      !needle
        ? true
        : item.name.toLowerCase().includes(needle) ||
          item.email.toLowerCase().includes(needle) ||
          item.role.toLowerCase().includes(needle),
    )
  }, [users, search])

  useEffect(() => {
    if (!settings) return
    setSettingsDraft({
      ladder: (settings.reminder_ladder ?? []).join(', '),
      verification_overdue_days: String(settings.escalation?.verification_overdue_days ?? ''),
      clarification_overdue_days: String(settings.escalation?.clarification_overdue_days ?? ''),
    })
  }, [settings])

  const handleCreate = async () => {
    setCreating(true)
    try {
      const payload: Record<string, unknown> = {
        email: newUser.email.trim(),
        name: newUser.name.trim(),
        role: newUser.role,
        password: newUser.password,
        phone: newUser.phone.trim() || undefined,
        language: newUser.language,
      }
      if (newUser.role === 'institution') {
        payload.institution_id = Number(newUser.institution_id)
      }
      const result = await apiPost<{
        user: { id: number; name: string; email: string; role: string }
        mfa?: { secret: string; current_code: string; note: string }
      }>('/api/admin/users', payload)
      setCreatedMfa(result.mfa ?? null)
      toast(`User ${result.user.name} created.`, 'success')
      await reloadUsers()
    } catch (problem) {
      toast(errorMessage(problem), 'error')
    } finally {
      setCreating(false)
    }
  }

  const toggleActive = async (id: number, active: boolean) => {
    try {
      await apiPatch(`/api/admin/users/${id}`, { active })
      toast(active ? 'User activated' : 'User deactivated', 'success')
      await reloadUsers()
    } catch (problem) {
      toast(errorMessage(problem), 'error')
    }
  }

  const saveSettings = async () => {
    setSettingsSaving(true)
    try {
      const ladder = settingsDraft.ladder
        .split(',')
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isFinite(value) && value > 0)
      await apiPut('/api/admin/settings', {
        reminder_ladder: ladder.length ? ladder : undefined,
        verification_overdue_days: settingsDraft.verification_overdue_days
          ? Number(settingsDraft.verification_overdue_days)
          : undefined,
        clarification_overdue_days: settingsDraft.clarification_overdue_days
          ? Number(settingsDraft.clarification_overdue_days)
          : undefined,
      })
      toast('Settings saved and audit-logged.', 'success')
      await reloadSettings()
    } catch (problem) {
      toast(errorMessage(problem), 'error')
    } finally {
      setSettingsSaving(false)
    }
  }

  const resetCreateForm = () => {
    setCreateOpen(false)
    setCreatedMfa(null)
    setNewUser({
      email: '',
      name: '',
      role: 'institution',
      institution_id: '',
      password: 'Aicte@2026',
      phone: '',
      language: 'en',
    })
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Administration"
        title="Users, settings and audit"
        subtitle="Admin-only surface. Every change here is written to the audit log and, where relevant, the hash chain."
        actions={
          <button type="button" className="btn btn-secondary" onClick={() => void reloadUsers()}>
            <RefreshCw size={14} /> Refresh
          </button>
        }
      />

      <div className="flex flex-wrap gap-1 rounded-xl border border-white/8 bg-ink-950/40 p-1">
        {(['users', 'settings', 'audit'] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setTab(item)}
            className={`rounded-lg px-3 py-1.5 text-[0.72rem] font-semibold capitalize transition ${
              tab === item ? 'bg-white/10 text-white' : 'text-mist-400 hover:text-mist-200'
            }`}
          >
            {item}
          </button>
        ))}
      </div>

      {tab === 'users' ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Users" value={users?.total ?? 0} hint="In this view" icon={<Users size={17} />} tone="signal" />
            <StatTile
              label="Active"
              value={(users?.items ?? []).filter((item) => item.active).length}
              hint="Enabled accounts"
              icon={<ShieldCheck size={17} />}
              tone="mint"
            />
            <StatTile
              label="MFA enabled"
              value={(users?.items ?? []).filter((item) => item.mfa_enabled).length}
              hint="Officer accounts"
              icon={<KeyRound size={17} />}
              tone="violet"
            />
            <StatTile
              label="Institutions"
              value={institutions?.total ?? 0}
              hint="Registered entities"
              icon={<BuildingIcon />}
              tone="amber"
            />
          </div>

          <Panel className="!p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-full max-w-xs">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-mist-500" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search name, email or role…"
                    className="input !py-2 !pl-9 !text-xs"
                  />
                </div>
                <select
                  value={roleFilter}
                  onChange={(event) => setRoleFilter(event.target.value)}
                  className="select !w-auto !py-2 !text-xs"
                >
                  <option value="">All roles</option>
                  {ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </div>
              <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
                <Users size={15} /> New user
              </button>
            </div>
          </Panel>

          {usersLoading && !users ? (
            <LoadingPanel rows={6} />
          ) : usersError ? (
            <EmptyState
              icon={<TriangleAlert size={20} />}
              title="Users could not be loaded"
              hint={usersError}
              action={
                <button type="button" className="btn btn-secondary" onClick={() => void reloadUsers()}>
                  <RefreshCw size={14} /> Retry
                </button>
              }
            />
          ) : filteredUsers.length === 0 ? (
            <EmptyState icon={<Users size={20} />} title="No users in this view" hint="Adjust the role or search filter." />
          ) : (
            <Panel className="!p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Role</th>
                      <th>Institution</th>
                      <th>MFA</th>
                      <th>Last login</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <p className="text-[0.78rem] font-semibold text-mist-100">{item.name}</p>
                          <p className="text-[0.62rem] text-mist-500">{item.email}</p>
                        </td>
                        <td>
                          <Badge tone="cyan">{item.role.replace(/_/g, ' ')}</Badge>
                        </td>
                        <td className="text-[0.72rem] text-mist-300">{item.institution ?? '—'}</td>
                        <td>
                          {item.mfa_enabled ? (
                            <Badge tone="green" dot>
                              on
                            </Badge>
                          ) : (
                            <Badge tone="slate">off</Badge>
                          )}
                        </td>
                        <td className="whitespace-nowrap text-[0.7rem] text-mist-500">
                          {item.last_login_at ? dateTimeLabel(item.last_login_at) : 'never'}
                        </td>
                        <td>
                          <Badge tone={item.active ? 'green' : 'red'} dot>
                            {item.active ? 'active' : 'disabled'}
                          </Badge>
                        </td>
                        <td>
                          {item.id !== user?.id ? (
                            <button
                              type="button"
                              className={`btn !px-2 !py-1.5 !text-[0.66rem] ${item.active ? 'btn-secondary' : 'btn-primary'}`}
                              onClick={() => void toggleActive(item.id, !item.active)}
                            >
                              {item.active ? 'Disable' : 'Enable'}
                            </button>
                          ) : (
                            <span className="text-[0.62rem] text-mist-600">you</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
        </div>
      ) : null}

      {tab === 'settings' ? (
        <div className="space-y-4">
          <Panel>
            <SectionHeading title="Reminder ladder" hint="Days before maturity at which reminders fire" />
            <Field label="Ladder (comma separated)" hint="Example: 90, 60, 30, 0">
              <input
                value={settingsDraft.ladder}
                onChange={(event) => setSettingsDraft({ ...settingsDraft, ladder: event.target.value })}
                className="input font-mono"
              />
            </Field>
          </Panel>

          <Panel>
            <SectionHeading title="Escalation rules" hint="Days after which overdue items escalate" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Verification overdue (days)">
                <input
                  type="number"
                  min="1"
                  max="60"
                  value={settingsDraft.verification_overdue_days}
                  onChange={(event) =>
                    setSettingsDraft({ ...settingsDraft, verification_overdue_days: event.target.value })
                  }
                  className="input"
                />
              </Field>
              <Field label="Clarification overdue (days)">
                <input
                  type="number"
                  min="1"
                  max="60"
                  value={settingsDraft.clarification_overdue_days}
                  onChange={(event) =>
                    setSettingsDraft({ ...settingsDraft, clarification_overdue_days: event.target.value })
                  }
                  className="input"
                />
              </Field>
            </div>
          </Panel>

          <Panel>
            <SectionHeading
              title="Trust weights"
              hint="Current weights used by the advisory scoring engine"
              action={<Badge tone="slate">read-only here</Badge>}
            />
            <pre className="max-h-48 overflow-auto rounded-xl border border-white/8 bg-ink-950/60 p-3 font-mono text-[0.68rem] text-mist-300">
              {JSON.stringify(settings?.trust_weights ?? {}, null, 2)}
            </pre>
          </Panel>

          <div className="flex justify-end">
            <button type="button" className="btn btn-primary" disabled={settingsSaving} onClick={() => void saveSettings()}>
              <Settings size={14} /> {settingsSaving ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </div>
      ) : null}

      {tab === 'audit' ? (
        <div className="space-y-4">
          <Panel className="!p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-full max-w-xs">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-mist-500" />
                  <input
                    value={auditAction}
                    onChange={(event) => setAuditAction(event.target.value)}
                    placeholder="Filter action…"
                    className="input !py-2 !pl-9 !text-xs"
                  />
                </div>
                <select
                  value={auditAllowed}
                  onChange={(event) => setAuditAllowed(event.target.value)}
                  className="select !w-auto !py-2 !text-xs"
                >
                  <option value="all">All outcomes</option>
                  <option value="allowed">Allowed only</option>
                  <option value="denied">Denied only</option>
                </select>
              </div>
              <p className="text-[0.68rem] text-mist-500">{audit?.total ?? 0} entries</p>
            </div>
          </Panel>

          {auditLoading && !audit ? (
            <LoadingPanel rows={6} />
          ) : auditError ? (
            <EmptyState
              icon={<TriangleAlert size={20} />}
              title="Audit log could not be loaded"
              hint={auditError}
            />
          ) : (audit?.items.length ?? 0) === 0 ? (
            <EmptyState icon={<Settings size={20} />} title="No audit entries in this view" />
          ) : (
            <Panel className="!p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>User</th>
                      <th>Action</th>
                      <th>Target</th>
                      <th>Detail</th>
                      <th>IP</th>
                      <th>Allowed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(audit?.items ?? []).map((entry) => (
                      <tr key={entry.id}>
                        <td className="whitespace-nowrap text-[0.7rem] text-mist-500">{dateTimeLabel(entry.at)}</td>
                        <td className="text-[0.72rem] text-mist-300">{entry.user ?? '—'}</td>
                        <td className="text-[0.72rem] font-medium text-mist-100">{entry.action}</td>
                        <td className="max-w-[160px] truncate text-[0.7rem] text-mist-400">{entry.target}</td>
                        <td className="max-w-[220px] truncate text-[0.7rem] text-mist-500">{entry.detail}</td>
                        <td className="font-mono text-[0.62rem] text-mist-600">{entry.ip ?? '—'}</td>
                        <td>
                          <Badge tone={entry.allowed ? 'green' : 'red'} dot>
                            {entry.allowed ? 'allowed' : 'denied'}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
        </div>
      ) : null}

      <Modal
        open={createOpen}
        onClose={resetCreateForm}
        title="Create a new user"
        description="Officer roles receive a TOTP secret. The password defaults to the demo password."
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={resetCreateForm}>
              Close
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={creating || !newUser.email || !newUser.name}
              onClick={() => void handleCreate()}
            >
              <Users size={14} /> {creating ? 'Creating…' : 'Create user'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Full name">
              <input
                value={newUser.name}
                onChange={(event) => setNewUser({ ...newUser, name: event.target.value })}
                className="input"
                placeholder="Officer name"
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                value={newUser.email}
                onChange={(event) => setNewUser({ ...newUser, email: event.target.value })}
                className="input"
                placeholder="name@aicte.gov.in"
              />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Role">
              <select
                value={newUser.role}
                onChange={(event) => setNewUser({ ...newUser, role: event.target.value })}
                className="select"
              >
                {ROLES.map((role) => (
                  <option key={role} value={role}>
                    {role.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Language">
              <select
                value={newUser.language}
                onChange={(event) => setNewUser({ ...newUser, language: event.target.value })}
                className="select"
              >
                <option value="en">English</option>
                <option value="hi">Hindi</option>
              </select>
            </Field>
          </div>
          {newUser.role === 'institution' ? (
            <Field label="Institution">
              <select
                value={newUser.institution_id}
                onChange={(event) => setNewUser({ ...newUser, institution_id: event.target.value })}
                className="select"
              >
                <option value="">Select institution</option>
                {(institutions?.items ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.aicte_id})
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          <Field label="Password">
            <input
              value={newUser.password}
              onChange={(event) => setNewUser({ ...newUser, password: event.target.value })}
              className="input"
            />
          </Field>
          <Field label="Phone">
            <input
              value={newUser.phone}
              onChange={(event) => setNewUser({ ...newUser, phone: event.target.value })}
              className="input"
              placeholder="+91 98765 43210"
            />
          </Field>

          {createdMfa ? (
            <div className="rounded-xl border border-signal-400/25 bg-signal-400/[0.06] p-3">
              <p className="flex items-center gap-1.5 text-[0.72rem] font-semibold text-signal-300">
                <KeyRound size={13} /> MFA secret generated
              </p>
              <p className="mt-1 text-[0.64rem] leading-relaxed text-mist-400">{createdMfa.note}</p>
              <code className="mt-2 block rounded-lg border border-signal-400/25 bg-ink-950/60 px-2.5 py-1.5 font-mono text-xs tracking-wide text-signal-200">
                {createdMfa.secret}
              </code>
              <p className="mt-2 text-[0.68rem] text-mist-300">
                Current code: <span className="font-mono text-mint-300">{createdMfa.current_code}</span>
              </p>
            </div>
          ) : null}
        </div>
      </Modal>
    </div>
  )
}

function BuildingIcon() {
  return <Building size={17} />
}
