import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import clsx from 'clsx'
import {
  Bell,
  BellRing,
  Building,
  ChartBar,
  ChevronDown,
  ChevronRight,
  CircleCheckBig,
  CircleQuestionMark,
  ClipboardCheck,
  CloudUpload,
  FileOutput,
  Globe,
  Landmark,
  Layers,
  LayoutDashboard,
  Link2,
  LogOut,
  Menu,
  Moon,
  Radar,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Sun,
  Vault,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { useToast } from '../context/ToastContext'
import { AppearanceMenu } from './AppearancePanel'
import { Walkthrough, openWalkthrough } from './Walkthrough'
import { apiGet, apiPost, errorMessage } from '../lib/api'
import { relativeTime, roleLabel } from '../lib/format'
import { useApi } from '../lib/useApi'
import type { ChainStatus, NotificationRecord, Role } from '../lib/types'
import { AmbientOrbs, LightBeam, Spotlight } from './luminous'

interface NavItem {
  to: string
  labelKey: string
  icon: LucideIcon
  roles?: Role[]
  end?: boolean
}

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Portfolio',
    items: [
      { to: '/', labelKey: 'nav.overview', icon: LayoutDashboard, end: true },
      { to: '/vault', labelKey: 'nav.vault', icon: Vault },
      { to: '/instruments', labelKey: 'nav.instruments', icon: Landmark },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: '/submit', labelKey: 'nav.submit', icon: CloudUpload, roles: ['institution', 'admin'] },
      {
        to: '/review',
        labelKey: 'nav.review',
        icon: ClipboardCheck,
        roles: ['scrutiny_officer', 'verification_officer', 'competent_authority', 'admin', 'auditor'],
      },
      { to: '/requests', labelKey: 'nav.requests', icon: FileOutput },
      { to: '/reminders', labelKey: 'nav.reminders', icon: BellRing },
    ],
  },
  {
    label: 'Governance',
    items: [
      {
        to: '/ledger',
        labelKey: 'nav.ledger',
        icon: Link2,
        roles: ['scrutiny_officer', 'verification_officer', 'competent_authority', 'admin', 'auditor'],
      },
      { to: '/reports', labelKey: 'nav.reports', icon: ChartBar },
      { to: '/institutions', labelKey: 'nav.institutions', icon: Building },
      { to: '/admin', labelKey: 'nav.admin', icon: Settings, roles: ['admin'] },
      {
        to: '/security',
        labelKey: 'nav.security',
        icon: ShieldCheck,
        roles: ['admin', 'auditor', 'competent_authority'],
      },
    ],
  },
]

const ALL_ITEMS = NAV_GROUPS.flatMap((group) => group.items)

export default function Layout() {
  const { t, i18n } = useTranslation()
  const { user, logout, setLanguage, notice, clearNotice } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const { toast } = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [userMenu, setUserMenu] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [notifications, setNotifications] = useState<NotificationRecord[]>([])
  const [unread, setUnread] = useState(0)
  const menuRef = useRef<HTMLDivElement>(null)
  const notifRef = useRef<HTMLDivElement>(null)
  const { data: chain } = useApi<ChainStatus>('/api/ledger/verify')

  useEffect(() => {
    setMobileOpen(false)
    setUserMenu(false)
    setNotifOpen(false)
    window.scrollTo({ top: 0 })
  }, [location.pathname])

  useEffect(() => {
    if (notice) {
      toast(notice, 'info')
      clearNotice()
    }
  }, [notice, toast, clearNotice])

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setUserMenu(false)
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) setNotifOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const loadNotifications = async () => {
    try {
      const data = await apiGet<{ items: NotificationRecord[]; unread: number }>('/api/notifications')
      setNotifications(data.items)
      setUnread(data.unread)
    } catch {
      // notifications are non-critical
    }
  }

  useEffect(() => {
    void loadNotifications()
    const timer = window.setInterval(() => void loadNotifications(), 45_000)
    return () => window.clearInterval(timer)
  }, [])

  if (!user) return null

  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.roles || item.roles.includes(user.role)),
  })).filter((group) => group.items.length > 0)

  const active =
    ALL_ITEMS.filter((item) => (item.end ? location.pathname === item.to : location.pathname.startsWith(item.to)))
      .sort((a, b) => b.to.length - a.to.length)[0] ?? null

  const pageTitle = active ? t(active.labelKey) : location.pathname.startsWith('/instruments/') ? 'FDR record' : 'AICTE Portal'

  const chainOk = chain?.valid !== false

  const toggleLanguage = () => {
    const next = i18n.language === 'hi' ? 'en' : 'hi'
    void i18n.changeLanguage(next)
    void setLanguage(next)
  }

  const handleSearch = (event: FormEvent) => {
    event.preventDefault()
    const value = query.trim()
    navigate(value ? `/instruments?q=${encodeURIComponent(value)}` : '/instruments')
  }

  const openNotification = async (item: NotificationRecord) => {
    if (!item.read) {
      try {
        await apiPost(`/api/notifications/${item.id}/read`)
        setNotifications((current) => current.map((row) => (row.id === item.id ? { ...row, read: true } : row)))
        setUnread((current) => Math.max(0, current - 1))
      } catch (error) {
        toast(errorMessage(error), 'error')
      }
    }
    setNotifOpen(false)
    if (item.link) navigate(item.link)
  }

  const markAllRead = async () => {
    try {
      await apiPost('/api/notifications/read-all')
      setNotifications((current) => current.map((row) => ({ ...row, read: true })))
      setUnread(0)
    } catch (error) {
      toast(errorMessage(error), 'error')
    }
  }

  const navBody = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-5 pb-5 pt-5">
        <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-violet-300/30 bg-violet-300/10 text-violet-300 shadow-[0_0_30px_-6px_rgba(196,181,253,0.55)]">
          <ShieldCheck size={21} />
        </span>
        <div className="min-w-0">
          <p className="font-display text-sm font-semibold tracking-tight text-mist-50">
            {t('brand')} <span className="text-gradient">FDR</span>
          </p>
          <p className="truncate text-[0.62rem] uppercase tracking-[0.14em] text-mist-500">{t('brandSub')}</p>
        </div>
      </div>

      <div className="mx-4 mb-4 h-px bg-gradient-to-r from-transparent via-violet-300/35 to-transparent" />

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {visibleGroups.map((group) => (
          <div key={group.label}>
            <p className="mb-1.5 px-2 text-[0.58rem] font-bold uppercase tracking-[0.2em] text-mist-600">{group.label}</p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      clsx(
                        'group relative flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[0.8rem] font-medium transition duration-200',
                        isActive
                          ? 'bg-violet-300/[0.09] text-mist-50 shadow-[inset_0_0_0_1px_rgba(196,181,253,0.2),0_0_26px_-10px_rgba(196,181,253,0.7)]'
                          : 'text-mist-400 hover:bg-white/[0.04] hover:text-mist-100',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <span
                          className={clsx(
                            'absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full bg-violet-300 transition-all duration-300',
                            isActive
                              ? 'opacity-100 shadow-[0_0_12px_2px_rgba(196,181,253,0.75)]'
                              : 'opacity-0',
                          )}
                        />
                        <Icon
                          size={16}
                          className={isActive ? 'text-violet-300' : 'text-mist-500 group-hover:text-mist-300'}
                        />
                        <span className="truncate">{t(item.labelKey)}</span>
                      </>
                    )}
                  </NavLink>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/8 p-3">
        <Link
          to="/track"
          className="mb-2 flex items-center gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-[0.72rem] text-mist-400 transition hover:border-mint-300/35 hover:text-mint-200"
        >
          <Globe size={14} />
          {t('nav.tracker')}
          <ChevronRight size={13} className="ml-auto" />
        </Link>
        <div className="flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
          <span className="inline-flex items-center gap-1.5 text-[0.64rem] text-mist-500">
            <span
              className={clsx(
                'h-1.5 w-1.5 rounded-full',
                chainOk ? 'bg-mint-300 shadow-[0_0_8px_1px_rgba(167,243,208,0.7)]' : 'bg-rose-400',
              )}
            />
            {chainOk ? 'Chain intact' : 'Chain broken'}
          </span>
          <span className="text-[0.6rem] uppercase tracking-wider text-mist-600">v1.0</span>
        </div>
      </div>
    </div>
  )

  return (
    <div className="relative min-h-screen lg:pl-[264px]">
      <AmbientOrbs />
      <Spotlight />

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 bg-ink-950/80 backdrop-blur-sm lg:hidden" onClick={() => setMobileOpen(false)} />
      ) : null}

      <aside
        className={clsx(
          'surface-sidebar fixed inset-y-0 left-0 z-50 w-[264px] transition-transform duration-300 lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-violet-300/[0.05] via-transparent to-mint-300/[0.03]"
        />
        <div className="relative h-full">{navBody}</div>
      </aside>

      <div className="relative flex min-h-screen flex-col">
        <header className="surface-header sticky top-0 z-30">
          <div className="mx-auto flex h-16 w-full max-w-[1240px] items-center gap-3 px-4 lg:px-8">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="btn btn-ghost !p-2 lg:hidden"
              aria-label="Open navigation"
            >
              <Menu size={19} />
            </button>

            <div className="hidden min-w-0 items-center gap-2 text-xs text-mist-500 sm:flex">
              <Sparkles size={13} className="text-violet-300" />
              <span className="font-semibold uppercase tracking-[0.16em]">{pageTitle}</span>
            </div>

            <form onSubmit={handleSearch} className="relative ml-auto hidden w-full max-w-xs md:block">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-mist-500" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search reference, bank, FDR number…"
                className="input !py-2 !pl-9 !text-xs"
              />
            </form>

            <div className="ml-auto flex items-center gap-1.5 md:ml-0">
              <button
                type="button"
                onClick={openWalkthrough}
                className="btn btn-ghost !p-2"
                aria-label="Open the guided tour"
                title="Guided tour"
              >
                <CircleQuestionMark size={18} />
              </button>
              <button
                type="button"
                onClick={toggleTheme}
                className="btn btn-ghost !p-2"
                aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
              >
                {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
              </button>

              <button
                type="button"
                onClick={toggleLanguage}
                className="btn btn-ghost !px-2.5 !py-2 text-[0.7rem] font-semibold uppercase"
                title="Switch language"
              >
                <Globe size={15} />
                {i18n.language === 'hi' ? 'हि' : 'EN'}
              </button>

              <div className="relative" ref={notifRef}>
                <button
                  type="button"
                  onClick={() => {
                    setNotifOpen((current) => !current)
                    if (!notifOpen) void loadNotifications()
                  }}
                  className="btn btn-ghost relative !p-2"
                  aria-label="Notifications"
                >
                  <Bell size={18} />
                  {unread > 0 ? (
                    <span className="absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[0.55rem] font-bold text-white">
                      {unread > 9 ? '9+' : unread}
                    </span>
                  ) : null}
                </button>
                {notifOpen ? (
                  <div className="surface-pop absolute right-0 top-12 w-[min(92vw,360px)] overflow-hidden rounded-2xl">
                    <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-mist-400">Notifications</p>
                      <button type="button" onClick={markAllRead} className="text-[0.68rem] text-mint-300 hover:text-mint-200">
                        Mark all read
                      </button>
                    </div>
                    <div className="max-h-[360px] overflow-y-auto">
                      {notifications.length === 0 ? (
                        <p className="px-4 py-8 text-center text-xs text-mist-500">No notifications yet.</p>
                      ) : (
                        notifications.slice(0, 12).map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => void openNotification(item)}
                            className={clsx(
                              'flex w-full gap-3 border-b border-white/5 px-4 py-3 text-left transition hover:bg-white/5',
                              !item.read && 'bg-signal-400/[0.04]',
                            )}
                          >
                            <span
                              className={clsx(
                                'mt-1 h-2 w-2 shrink-0 rounded-full',
                                item.kind === 'danger'
                                  ? 'bg-rose-400'
                                  : item.kind === 'warning'
                                    ? 'bg-amber-400'
                                    : item.kind === 'success'
                                      ? 'bg-mint-400'
                                      : 'bg-signal-400',
                              )}
                            />
                            <span className="min-w-0">
                              <span className="block truncate text-xs font-semibold text-mist-100">{item.title}</span>
                              <span className="mt-0.5 line-clamp-2 block text-[0.7rem] leading-relaxed text-mist-500">{item.body}</span>
                              <span className="mt-1 block text-[0.6rem] text-mist-600">{relativeTime(item.created_at)}</span>
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setUserMenu((current) => !current)}
                  className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-2 py-1.5 transition hover:border-white/20"
                >
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-violet-300/35 to-mint-300/20 text-[0.68rem] font-bold text-violet-200">
                    {user.name
                      .split(' ')
                      .filter(Boolean)
                      .slice(0, 2)
                      .map((part) => part[0])
                      .join('')
                      .toUpperCase()}
                  </span>
                  <span className="hidden text-left lg:block">
                    <span className="block max-w-[130px] truncate text-[0.72rem] font-semibold text-mist-100">{user.name}</span>
                    <span className="block text-[0.6rem] text-mist-500">{roleLabel(user.role)}</span>
                  </span>
                  <ChevronDown size={13} className="text-mist-500" />
                </button>
                {userMenu ? (
                  <div className="surface-pop absolute right-0 top-12 w-72 overflow-hidden rounded-2xl">
                    <div className="border-b border-white/8 p-4">
                      <p className="text-sm font-semibold text-white">{user.name}</p>
                      <p className="mt-0.5 truncate text-[0.7rem] text-mist-500">{user.email}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <span className="badge border-violet-300/25 bg-violet-300/10 text-violet-200">{roleLabel(user.role)}</span>
                        {user.mfa_enabled ? (
                          <span className="badge border-mint-300/25 bg-mint-300/10 text-mint-200">MFA</span>
                        ) : null}
                      </div>
                      {user.institution ? <p className="mt-2 text-[0.68rem] text-mist-400">{user.institution}</p> : null}
                    </div>
                    <div className="p-2">
                      <button
                        type="button"
                        onClick={() => {
                          setUserMenu(false)
                          navigate('/security')
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-mist-300 transition hover:bg-white/5 hover:text-white"
                      >
                        <ShieldCheck size={15} /> Security posture
                      </button>
                      <button
                        type="button"
                        onClick={() => void logout()}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-rose-300 transition hover:bg-rose-400/10"
                      >
                        <LogOut size={15} /> {t('common.signOut')}
                      </button>
                    </div>
                    <AppearanceMenu />
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1240px] flex-1 px-4 py-6 lg:px-8 lg:py-9">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 16, scale: 0.994 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.36, ease: [0.22, 1, 0.36, 1] }}
          >
            <Outlet />
          </motion.div>
        </main>

        <footer className="relative mt-6 px-4 py-4 lg:px-8">
          <LightBeam className="absolute inset-x-0 top-0" />
          <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-2 text-[0.64rem] text-mist-600">
            <span className="inline-flex items-center gap-2">
              <Radar size={13} className="text-violet-300/70" />
              AICTE Regulation Bureau · Security Deposit & FDR prototype
            </span>
            <span className="inline-flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1">
                <ShieldAlert size={12} /> AES-256-GCM field encryption
              </span>
              <span className="inline-flex items-center gap-1">
                <Layers size={12} /> SHA-256 hash chain
              </span>
              <span className="inline-flex items-center gap-1">
                <CircleCheckBig size={12} /> Ed25519 signatures
              </span>
            </span>
          </div>
        </footer>
      </div>

      <Walkthrough />
    </div>
  )
}
