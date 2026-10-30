import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  BadgeCheck,
  ChevronRight,
  CircleCheckBig,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Landmark,
  Layers,
  Lock,
  Mail,
  Radar,
  ScanLine,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Vault,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { apiGet, errorMessage, getApiBase, setApiBase } from '../lib/api'
import { roleLabel } from '../lib/format'
import { HeroCrystal } from '../components/HeroCrystal'
import { ThemeToggle } from '../components/ThemeToggle'
import { AmbientOrbs, LightBeam, Magnetic, PointerParallax, TiltCard } from '../components/luminous'

interface DemoAccount {
  email: string
  name: string
  role: string
  institution: string
}

const DEMO_PASSWORD = 'Aicte@2026'

const DEFAULT_DEMO_ACCOUNTS: DemoAccount[] = [
  { email: 'principal@sunrise.edu', role: 'institution', name: 'Dr. Meera Joshi', institution: 'Sunrise Institute of Technology' },
  { email: 'dean@ganga.edu', role: 'institution', name: 'Prof. Rakesh Verma', institution: 'Ganga College of Engineering' },
  { email: 'scrutiny@aicte.gov.in', role: 'scrutiny_officer', name: 'A. K. Sharma', institution: 'AICTE Regulation Bureau' },
  { email: 'verify@aicte.gov.in', role: 'verification_officer', name: 'S. Nair', institution: 'AICTE Regulation Bureau' },
  { email: 'authority@aicte.gov.in', role: 'competent_authority', name: 'Dr. R. Iyer', institution: 'AICTE Regulation Bureau' },
  { email: 'admin@aicte.gov.in', role: 'admin', name: 'System Administrator', institution: 'AICTE' },
  { email: 'auditor@aicte.gov.in', role: 'auditor', name: 'Internal Auditor', institution: 'AICTE' },
]

const ROLE_ORDER = [
  'institution',
  'scrutiny_officer',
  'verification_officer',
  'competent_authority',
  'admin',
  'auditor',
]

const FEATURES = [
  { icon: ScanLine, title: 'OCR + DistilBERT', detail: 'Fields extracted and matched against the receipt' },
  { icon: Lock, title: 'AES-256-GCM', detail: 'Amounts and FDR numbers encrypted at rest' },
  { icon: Layers, title: 'SHA-256 chain', detail: 'Every action sealed into a verifiable ledger' },
  { icon: BadgeCheck, title: 'Ed25519 signatures', detail: 'Each officer decision individually signed' },
]

export default function LoginPage() {
  const { user, login, loginDemo, verifyMfa, notice, clearNotice } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('principal@sunrise.edu')
  const [password, setPassword] = useState(DEMO_PASSWORD)
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState<'credentials' | 'mfa'>('credentials')
  const [challenge, setChallenge] = useState('')
  const [code, setCode] = useState('')
  const [hint, setHint] = useState<{ code: string; note: string } | null>(null)
  const [accounts, setAccounts] = useState<DemoAccount[]>(DEFAULT_DEMO_ACCOUNTS)
  const [accountsOpen, setAccountsOpen] = useState(true)
  const [showConfig, setShowConfig] = useState(false)
  const [apiUrl, setApiUrl] = useState(getApiBase())

  useEffect(() => {
    if (user) navigate('/', { replace: true })
  }, [user, navigate])

  useEffect(() => {
    apiGet<{ accounts: DemoAccount[] }>('/api/public/demo-accounts')
      .then((data) => setAccounts(data.accounts))
      .catch(() => setAccounts([]))
  }, [])

  useEffect(() => {
    if (notice) {
      setError(notice)
      clearNotice()
    }
  }, [notice, clearNotice])

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const result = await login(email.trim(), password)
      if (result.mfaRequired && result.challengeToken) {
        setChallenge(result.challengeToken)
        setHint(result.demoHint ?? null)
        setCode(result.demoHint?.code ?? '')
        setStep('mfa')
      } else {
        navigate('/', { replace: true })
      }
    } catch (problem) {
      setError(errorMessage(problem))
    } finally {
      setLoading(false)
    }
  }

  const onVerify = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await verifyMfa(code.trim(), challenge)
      navigate('/', { replace: true })
    } catch (problem) {
      setError(errorMessage(problem))
    } finally {
      setLoading(false)
    }
  }

  const useAccount = (account: DemoAccount) => {
    setEmail(account.email)
    setPassword(DEMO_PASSWORD)
    setStep('credentials')
    setError(null)
  }

  const grouped = ROLE_ORDER.map((role) => ({
    role,
    label: roleLabel(role),
    accounts: accounts.filter((account) => account.role === role),
  })).filter((group) => group.accounts.length > 0)

  return (
    <div className="relative min-h-screen overflow-hidden">
      <AmbientOrbs />
      <div className="spotlight" aria-hidden />

      <div className="relative mx-auto w-full max-w-[1320px] px-5 pb-10 pt-5 lg:px-10">
        <div className="mb-8 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl border border-violet-300/40 bg-violet-300/10 text-violet-300 shadow-[0_0_34px_-8px_rgba(108,92,224,0.7)]">
              <ShieldCheck size={23} />
            </span>
            <div>
              <p className="font-display text-sm font-semibold tracking-tight text-mist-50">
                AICTE <span className="text-gradient">FDR</span>
              </p>
              <p className="text-[0.62rem] uppercase tracking-[0.2em] text-mist-500">Security Deposit Portal</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/track"
              className="hidden items-center gap-1.5 rounded-full border border-[color:var(--line-strong)] bg-[color:var(--well-bg)] px-3.5 py-2 text-[0.72rem] font-medium text-mist-400 transition hover:text-mist-50 sm:inline-flex"
            >
              <Globe size={14} />
              Track a deposit
            </Link>
            <ThemeToggle />
          </div>
        </div>

        <div className="grid gap-10 lg:grid-cols-[1.08fr_0.92fr] lg:items-center lg:gap-12">
          <motion.section
            initial="hidden"
            animate="show"
            variants={{
              hidden: {},
              show: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
            }}
          >
            <motion.p
              variants={{ hidden: { opacity: 0, y: 18 }, show: { opacity: 1, y: 0 } }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              className="mb-4 inline-flex items-center gap-2 rounded-full border border-mint-300/40 bg-mint-300/10 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-mint-300"
            >
              <Sparkles size={13} /> Regulation Bureau · 2026
            </motion.p>

            <motion.h1
              variants={{ hidden: { opacity: 0, y: 22 }, show: { opacity: 1, y: 0 } }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              className="font-display text-[2.5rem] font-semibold leading-[1.03] tracking-[-0.03em] text-mist-50 sm:text-[3.1rem] xl:text-[4rem]"
            >
              Every security deposit,
              <br />
              <span className="text-gradient">verified once,</span>
              <br />
              tracked forever.
            </motion.h1>

            <motion.p
              variants={{ hidden: { opacity: 0, y: 18 }, show: { opacity: 1, y: 0 } }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              className="mt-5 max-w-xl text-[0.95rem] leading-relaxed text-mist-400"
            >
              One tamper-evident record for institutional FDRs: OCR extraction, bank-grade verification,
              a reminder ladder before maturity, and a hash-chained audit trail that proves every officer action.
            </motion.p>

            <motion.div
              variants={{ hidden: { opacity: 0, scale: 0.96 }, show: { opacity: 1, scale: 1 } }}
              transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
              className="mt-2 grid items-center gap-4 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)]"
            >
              <PointerParallax depth={18} className="relative">
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-6 rounded-full bg-violet-300/25 blur-3xl"
                />
                <HeroCrystal className="relative h-56 w-full sm:h-60" />
              </PointerParallax>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {FEATURES.map(({ icon: Icon, title, detail }) => (
                  <TiltCard key={title} intensity={8} className="card-flat p-3.5">
                    <div className="flex items-start gap-2.5">
                      <span className="tilt-layer-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-violet-300/40 bg-violet-300/20 text-violet-300 shadow-[0_0_15px_rgba(196,181,253,0.35)]">
                        <Icon size={16} className="text-violet-300 drop-shadow-[0_0_6px_rgba(196,181,253,0.85)]" />
                      </span>
                      <span className="tilt-layer-2">
                        <span className="block text-[0.76rem] font-bold text-mist-50">{title}</span>
                        <span className="mt-0.5 block text-[0.68rem] font-medium leading-relaxed text-mist-400">{detail}</span>
                      </span>
                    </div>
                  </TiltCard>
                ))}
              </div>
            </motion.div>

            <motion.div
              variants={{ hidden: { opacity: 0 }, show: { opacity: 1 } }}
              transition={{ duration: 0.6 }}
              className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-[0.66rem] text-mist-500"
            >
              <span className="inline-flex items-center gap-1.5">
                <Radar size={13} className="text-mint-300" /> Live integrity monitoring
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Globe size={13} /> EN / हिन्दी
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Vault size={13} /> Prototype build
              </span>
            </motion.div>
          </motion.section>

          <motion.section
            initial={{ opacity: 0, y: 26 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
            className="mx-auto w-full max-w-[520px]"
          >
            <div className="card overflow-hidden">
              <div className="relative border-b border-[color:var(--line)] px-6 py-5">
                <span
                  aria-hidden
                  className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full bg-violet-300/20 blur-3xl"
                />
                <div className="relative flex items-center justify-between gap-3">
                  <div>
                    <h2 className="font-display text-xl font-bold tracking-tight text-mist-50">
                      {step === 'credentials' ? 'Secure sign in' : 'Two-factor verification'}
                    </h2>
                    <p className="mt-1 text-xs font-medium text-mist-400">
                      {step === 'credentials'
                        ? 'Use your official AICTE or institution account.'
                        : `Enter the 6-digit code for ${email}.`}
                    </p>
                  </div>
                  <span className="grid h-10 w-10 place-items-center rounded-xl border border-violet-300/40 bg-violet-300/20 text-violet-300 shadow-[0_0_15px_rgba(196,181,253,0.35)]">
                    {step === 'credentials' ? <Lock size={19} className="drop-shadow-[0_0_6px_rgba(196,181,253,0.85)]" /> : <KeyRound size={19} className="drop-shadow-[0_0_6px_rgba(196,181,253,0.85)]" />}
                  </span>
                </div>
              </div>

              {error ? (
                <div className="border-b border-rose-400/25 bg-rose-400/10 px-6 py-3 text-[0.74rem] text-rose-300">
                  <div className="flex items-start gap-2">
                    <TriangleAlert size={15} className="mt-0.5 shrink-0" />
                    <span className="leading-relaxed">{error}</span>
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-rose-400/20 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        const targetAccount = accounts.find((a) => a.email === email) ?? {
                          email,
                          name: email.split('@')[0],
                          role: 'institution' as const,
                          institution: 'Demo Institution',
                        }
                        loginDemo({
                          email: targetAccount.email,
                          name: targetAccount.name,
                          role: targetAccount.role as any,
                          institution: targetAccount.institution,
                        })
                        navigate('/', { replace: true })
                      }}
                      className="rounded-lg border border-mint-400/40 bg-mint-400/15 px-2.5 py-1 text-[0.68rem] font-medium text-mint-200 transition hover:bg-mint-400/25"
                    >
                      Continue in Demo Mode
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowConfig((c) => !c)}
                      className="rounded-lg border border-mist-500/30 bg-mist-500/10 px-2.5 py-1 text-[0.68rem] font-medium text-mist-300 transition hover:bg-mist-500/20"
                    >
                      {showConfig ? 'Hide API URL Settings' : 'Configure Backend URL'}
                    </button>
                  </div>
                </div>
              ) : null}

              {showConfig ? (
                <div className="border-b border-[color:var(--line)] bg-[color:var(--well-bg)] px-6 py-3.5 text-xs">
                  <label className="block">
                    <span className="label !text-[0.68rem]">Custom Backend API Base URL</span>
                    <div className="mt-1 flex gap-2">
                      <input
                        type="url"
                        value={apiUrl}
                        onChange={(e) => setApiUrl(e.target.value)}
                        placeholder="e.g. https://your-backend.railway.app or http://localhost:8000"
                        className="input flex-1 !py-1.5 !text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setApiBase(apiUrl)
                          setError(null)
                          window.location.reload()
                        }}
                        className="btn btn-secondary shrink-0 !py-1.5 !text-xs"
                      >
                        Save & Reload
                      </button>
                    </div>
                    <span className="mt-1 block text-[0.64rem] text-mist-500">
                      On Vercel, you can also set the <code>VITE_API_BASE_URL</code> environment variable.
                    </span>
                  </label>
                </div>
              ) : null}

              {step === 'credentials' ? (
                <form onSubmit={onSubmit} className="space-y-4 px-6 py-6">
                  <label className="block">
                    <span className="label">Official email</span>
                    <span className="relative block">
                      <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-mist-500" />
                      <input
                        type="email"
                        required
                        autoComplete="username"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        className="input !pl-9"
                        placeholder="name@institution.edu"
                      />
                    </span>
                  </label>

                  <label className="block">
                    <span className="label">Password</span>
                    <span className="relative block">
                      <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-mist-500" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        autoComplete="current-password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        className="input !pl-9 !pr-10"
                        placeholder="••••••••"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((current) => !current)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-mist-500 transition hover:text-mist-200"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </span>
                  </label>

                  <Magnetic className="w-full" strength={5}>
                    <button type="submit" disabled={loading} className="btn btn-primary w-full !py-2.5">
                      {loading ? 'Signing in…' : 'Sign in securely'}
                      {!loading ? <ArrowRight size={16} /> : null}
                    </button>
                  </Magnetic>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-[0.68rem] text-mist-500">
                    <span className="inline-flex items-center gap-1.5">
                      <ShieldCheck size={12} className="text-mint-300" /> Session locks after 30 min idle
                    </span>
                    <Link to="/track" className="inline-flex items-center gap-0.5 text-violet-300 hover:text-violet-200">
                      Public tracker <ChevronRight size={12} />
                    </Link>
                  </div>
                </form>
              ) : (
                <form onSubmit={onVerify} className="space-y-4 px-6 py-6">
                  <div className="rounded-xl border border-mint-300/35 bg-mint-300/10 p-3">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-mint-300">
                      Demo authenticator
                    </p>
                    <p className="mt-1 text-[0.7rem] leading-relaxed text-mist-400">
                      {hint?.note ?? 'In production this code appears in the officer’s authenticator app.'}
                    </p>
                    {hint ? (
                      <div className="mt-2 flex items-center gap-2">
                        <code className="rounded-lg border border-mint-300/40 bg-[color:var(--well-bg)] px-2.5 py-1 font-mono text-base tracking-[0.35em] text-mint-300">
                          {hint.code}
                        </code>
                        <button
                          type="button"
                          onClick={() => setCode(hint.code)}
                          className="text-[0.68rem] font-semibold text-mint-300 hover:text-mint-200"
                        >
                          Use code
                        </button>
                      </div>
                    ) : null}
                  </div>

                  <label className="block">
                    <span className="label">6-digit verification code</span>
                    <input
                      inputMode="numeric"
                      autoFocus
                      required
                      maxLength={6}
                      value={code}
                      onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                      className="input text-center font-mono text-xl tracking-[0.55em]"
                      placeholder="000000"
                    />
                  </label>

                  <Magnetic className="w-full" strength={5}>
                    <button
                      type="submit"
                      disabled={loading || code.length !== 6}
                      className="btn btn-primary w-full !py-2.5"
                    >
                      {loading ? 'Verifying…' : 'Verify & continue'}
                      {!loading ? <CircleCheckBig size={16} /> : null}
                    </button>
                  </Magnetic>

                  <button
                    type="button"
                    onClick={() => {
                      setStep('credentials')
                      setError(null)
                      setCode('')
                    }}
                    className="btn btn-ghost w-full !text-[0.72rem]"
                  >
                    Use a different account
                  </button>
                </form>
              )}
            </div>

            <div className="card mt-4 overflow-hidden">
              <button
                type="button"
                onClick={() => setAccountsOpen((current) => !current)}
                className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left"
              >
                <span className="flex items-center gap-2">
                  <Landmark size={16} className="text-violet-300 drop-shadow-[0_0_6px_rgba(196,181,253,0.85)]" />
                  <span className="text-xs font-bold text-mist-50">Demo accounts</span>
                  <span className="badge border-violet-300/30 bg-violet-300/10 text-violet-300">
                    {accounts.length || 7}
                  </span>
                </span>
                <ChevronRight size={15} className={`text-mist-500 transition ${accountsOpen ? 'rotate-90' : ''}`} />
              </button>
              {accountsOpen ? (
                <div className="max-h-[290px] overflow-y-auto border-t border-[color:var(--line)] px-2 py-2">
                  {grouped.length === 0 ? (
                    <p className="px-3 py-4 text-center text-[0.7rem] text-mist-500">Demo directory unavailable.</p>
                  ) : (
                    grouped.map((group) => (
                      <div key={group.role} className="mb-1.5">
                        <p className="px-2 py-1 text-[0.58rem] font-bold uppercase tracking-[0.16em] text-mist-600">
                          {group.label}
                        </p>
                        {group.accounts.map((account) => {
                          const selected = account.email === email
                          return (
                            <button
                              key={account.email}
                              type="button"
                              onClick={() => useAccount(account)}
                              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition ${
                                selected ? 'bg-violet-300/12' : 'hover:bg-violet-300/[0.06]'
                              }`}
                            >
                              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-violet-300/40 bg-violet-300/20 text-[0.62rem] font-bold text-violet-200">
                                {account.name
                                  .split(' ')
                                  .filter(Boolean)
                                  .slice(0, 2)
                                  .map((part) => part[0])
                                  .join('')}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[0.76rem] font-bold text-mist-50">
                                  {account.name}
                                </span>
                                <span className="block truncate text-[0.66rem] font-medium text-mist-400">{account.email}</span>
                              </span>
                              {selected ? (
                                <CircleCheckBig size={15} className="shrink-0 text-violet-300 drop-shadow-[0_0_6px_rgba(196,181,253,0.8)]" />
                              ) : (
                                <ChevronRight size={13} className="shrink-0 text-mist-400" />
                              )}
                            </button>
                          )
                        })}
                      </div>
                    ))
                  )}
                  <p className="mt-2 rounded-lg border border-[color:var(--line)] bg-[color:var(--inset-bg)] px-2.5 py-2 text-[0.64rem] leading-relaxed text-mist-500">
                    Password for every demo account:{' '}
                    <span className="font-mono text-mist-300">{DEMO_PASSWORD}</span>. Officer accounts require the
                    one-time code shown after the password step.
                  </p>
                </div>
              ) : null}
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[0.62rem] text-mist-600">
              <span className="inline-flex items-center gap-1">
                <ShieldCheck size={12} /> RBAC + MFA
              </span>
              <span className="inline-flex items-center gap-1">
                <KeyRound size={12} /> AES-256-GCM
              </span>
              <Link to="/track" className="inline-flex items-center gap-1 text-mist-500 hover:text-violet-300">
                Track without signing in
              </Link>
            </div>
          </motion.section>
        </div>

        <LightBeam className="mt-10 opacity-70" />
        <p className="mt-3 text-center text-[0.6rem] uppercase tracking-[0.2em] text-mist-600">
          AICTE Regulation Bureau · Security Deposit & FDR prototype
        </p>
      </div>
    </div>
  )
}
