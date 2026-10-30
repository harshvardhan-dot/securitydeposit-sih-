import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react'
import clsx from 'clsx'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react'
import { scoreTone } from '../lib/format'

/* ------------------------------------------------------------------ layout */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="relative mb-7 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {eyebrow ? (
          <div className="mb-2.5 flex items-center gap-2 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-violet-300">
            <span className="h-1.5 w-1.5 rounded-full bg-violet-300 shadow-[0_0_12px_2px_rgba(196,181,253,0.7)]" />
            {eyebrow}
          </div>
        ) : null}
        <h1 className="font-display text-[1.7rem] font-semibold leading-[1.12] tracking-[-0.03em] text-mist-50 sm:text-[2rem]">
          {title}
        </h1>
        {subtitle ? <p className="mt-2 max-w-2xl text-sm leading-relaxed text-mist-400">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}

export function Panel({
  children,
  className,
  as: Tag = 'div',
}: {
  children: ReactNode
  className?: string
  as?: 'div' | 'section' | 'article'
}) {
  return <Tag className={clsx('card p-5', className)}>{children}</Tag>
}

export function SectionHeading({
  title,
  hint,
  action,
}: {
  title: ReactNode
  hint?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h2 className="font-display text-[0.95rem] font-semibold tracking-tight text-white">{title}</h2>
        {hint ? <p className="mt-0.5 text-xs text-mist-500">{hint}</p> : null}
      </div>
      {action}
    </div>
  )
}

/* ------------------------------------------------------------------ badges */
const BADGE_TONES: Record<string, string> = {
  slate: 'border-slate-400/25 bg-slate-400/10 text-slate-300',
  blue: 'border-sky-400/30 bg-sky-400/10 text-sky-300',
  teal: 'border-teal-400/30 bg-teal-400/10 text-teal-300',
  green: 'border-mint-400/35 bg-mint-400/10 text-mint-300',
  amber: 'border-amber-400/35 bg-amber-400/10 text-amber-300',
  red: 'border-rose-400/35 bg-rose-400/10 text-rose-300',
  violet: 'border-violet-400/35 bg-violet-400/10 text-violet-300',
  indigo: 'border-indigo-400/35 bg-indigo-400/10 text-indigo-300',
  grey: 'border-slate-500/25 bg-slate-500/10 text-slate-400',
  cyan: 'border-signal-400/35 bg-signal-400/10 text-signal-300',
  gold: 'border-gold-400/35 bg-gold-400/10 text-gold-300',
}

export function Badge({
  children,
  tone = 'slate',
  className,
  dot = false,
}: {
  children: ReactNode
  tone?: string
  className?: string
  dot?: boolean
}) {
  return (
    <span className={clsx('badge', BADGE_TONES[tone] ?? BADGE_TONES.slate, className)}>
      {dot ? <span className="h-1.5 w-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  )
}

const STATUS_LABELS: Record<string, { label: string; tone: string }> = {
  submitted: { label: 'Submitted', tone: 'slate' },
  under_verification: { label: 'Under verification', tone: 'blue' },
  bank_confirmed: { label: 'Bank confirmed', tone: 'teal' },
  active: { label: 'Active', tone: 'green' },
  expiring: { label: 'Expiring soon', tone: 'amber' },
  matured: { label: 'Matured', tone: 'red' },
  renewed: { label: 'Renewed', tone: 'violet' },
  release_requested: { label: 'Release requested', tone: 'indigo' },
  released: { label: 'Released', tone: 'grey' },
  rejected: { label: 'Rejected', tone: 'red' },
  flagged: { label: 'Flagged', tone: 'red' },
}

export function StatusBadge({ status, label, tone }: { status: string; label?: string; tone?: string }) {
  const meta = STATUS_LABELS[status] ?? { label: status, tone: 'slate' }
  return (
    <Badge tone={tone ?? meta.tone} dot>
      {label ?? meta.label}
    </Badge>
  )
}

/* ------------------------------------------------------------------ icons */
export type IconTone = 'lavender' | 'mint' | 'peach' | 'sky' | 'rose' | 'amber'

export function IconTile({
  children,
  tone = 'lavender',
  size = 'md',
  className,
}: {
  children: ReactNode
  tone?: IconTone
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}) {
  return (
    <span
      className={clsx('icon-tile', `icon-tile-${size}`, className)}
      style={{ ['--tile' as string]: `var(--tile-${tone})` }}
    >
      {children}
    </span>
  )
}

const TILE_TONES: Record<string, IconTone> = {
  mint: 'mint',
  signal: 'sky',
  amber: 'amber',
  rose: 'rose',
  violet: 'lavender',
}

/* ------------------------------------------------------------------ metrics */
export function CountUp({
  value,
  format,
  duration = 900,
}: {
  value: number
  format?: (value: number) => string
  duration?: number
}) {
  const [display, setDisplay] = useState(0)
  const frame = useRef<number | null>(null)
  const previous = useRef(0)

  useEffect(() => {
    const from = previous.current
    const start = performance.now()
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplay(from + (value - from) * eased)
      if (progress < 1) frame.current = requestAnimationFrame(tick)
      else previous.current = value
    }
    frame.current = requestAnimationFrame(tick)
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current)
    }
  }, [value, duration])

  return <>{format ? format(display) : Math.round(display).toLocaleString('en-IN')}</>
}

export function StatTile({
  label,
  value,
  hint,
  icon,
  tone = 'mint',
  onClick,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  icon?: ReactNode
  tone?: 'mint' | 'signal' | 'amber' | 'rose' | 'violet'
  onClick?: () => void
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={clsx(
        'card group relative overflow-hidden p-4 text-left',
        onClick && 'card-interactive',
      )}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-14 h-32 w-32 rounded-full bg-violet-300/[0.07] blur-2xl transition-opacity duration-500 group-hover:opacity-100"
      />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="type-label text-[0.68rem] text-mist-500">{label}</p>
          <p className="tile-value mt-2 text-[1.55rem] font-semibold leading-none text-mist-50">{value}</p>
          {hint ? <p className="mt-1.5 text-[0.7rem] text-mist-500">{hint}</p> : null}
        </div>
        {icon ? <IconTile tone={TILE_TONES[tone] ?? 'lavender'} size="md">{icon}</IconTile> : null}
      </div>
    </Tag>
  )
}

export function TrustDial({ score, size = 56, label }: { score: number; size?: number; label?: string }) {
  const tone = scoreTone(score)
  const colors = {
    green: { stroke: '#a7f3d0', text: 'text-mint-200' },
    amber: { stroke: '#fdba9b', text: 'text-amber-200' },
    red: { stroke: '#f47f90', text: 'text-rose-200' },
  }[tone]
  const radius = (size - 7) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - Math.max(0, Math.min(100, score)) / 100)
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(148,163,184,0.16)" strokeWidth="4" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={colors.stroke}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 700ms cubic-bezier(0.22,1,0.36,1)' }}
        />
      </svg>
      <span className={clsx('absolute font-display text-sm font-semibold tabular-nums', colors.text)}>
        {Math.round(score)}
      </span>
      {label ? <span className="absolute -bottom-4 text-[0.6rem] uppercase tracking-wider text-mist-500">{label}</span> : null}
    </div>
  )
}

export function ScoreBar({ score }: { score: number }) {
  const tone = scoreTone(score)
  const colors = { green: 'bg-mint-300', amber: 'bg-amber-300', red: 'bg-rose-400' }[tone]
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/8">
      <div
        className={clsx('h-full rounded-full transition-all duration-700', colors)}
        style={{ width: `${Math.max(4, Math.min(100, score))}%`, boxShadow: '0 0 14px currentColor' }}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ states */
export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('skeleton', className)} />
}

/** Small CSS-3D cube used by loading states; freezes under reduced motion. */
export function Loader3D({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3" role="status" aria-label={label}>
      <span className="cube3d" aria-hidden>
        <span className="cube3d-face cube3d-front" />
        <span className="cube3d-face cube3d-back" />
        <span className="cube3d-face cube3d-right" />
        <span className="cube3d-face cube3d-left" />
        <span className="cube3d-face cube3d-top" />
        <span className="cube3d-face cube3d-bottom" />
      </span>
      <span className="text-[0.7rem] uppercase tracking-[0.16em] text-mist-500">{label}</span>
    </div>
  )
}

export function LoadingPanel({ rows = 4, label }: { rows?: number; label?: string }) {
  return (
    <div className="card space-y-3 p-5">
      <Loader3D label={label ?? 'Loading'} />
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton
          key={index}
          className={index === 0 ? 'h-8 w-2/5' : index % 2 === 0 ? 'h-12 w-full' : 'h-12 w-[94%]'}
        />
      ))}
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: ReactNode
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/10 bg-white/[0.015] px-6 py-12 text-center">
      {icon ? <div className="grid h-12 w-12 place-items-center rounded-2xl border border-white/10 bg-white/5 text-mist-400">{icon}</div> : null}
      <p className="font-display text-sm font-semibold text-mist-200">{title}</p>
      {hint ? <p className="max-w-sm text-xs leading-relaxed text-mist-500">{hint}</p> : null}
      {action}
    </div>
  )
}

/* ------------------------------------------------------------------ modal */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'max-w-lg',
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  width?: string
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[90] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-ink-950/80 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            className={clsx('card relative z-10 w-full overflow-hidden', width)}
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.2 }}
          >
            <div className="flex items-start justify-between gap-4 border-b border-white/8 p-5">
              <div>
                <h2 className="font-display text-base font-semibold text-white">{title}</h2>
                {description ? <p className="mt-1 text-xs leading-relaxed text-mist-400">{description}</p> : null}
              </div>
              <button type="button" onClick={onClose} className="btn btn-ghost -mr-1 -mt-1 !p-1.5" aria-label="Close">
                <X size={17} />
              </button>
            </div>
            {children ? <div className="max-h-[68vh] overflow-y-auto p-5">{children}</div> : null}
            {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-white/8 bg-ink-950/40 p-4">{footer}</div> : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

/* ------------------------------------------------------------------ forms */
export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <label className={clsx('block', className)}>
      <span className="label">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-[0.7rem] text-rose-300">{error}</span> : null}
      {!error && hint ? <span className="mt-1 block text-[0.7rem] text-mist-500">{hint}</span> : null}
    </label>
  )
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  className,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}) {
  return (
    <div className={clsx('relative', className)}>
      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-mist-500" />
      <input
        className="input !pl-9"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

export function TextButton({ className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={clsx('btn', className)} {...rest}>
      {children}
    </button>
  )
}

/* ------------------------------------------------------------------ tabs */
export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: string; label: ReactNode; count?: number }[]
  active: string
  onChange: (key: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-1 rounded-xl border border-white/8 bg-ink-950/40 p-1">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onChange(tab.key)}
          className={clsx(
            'relative rounded-lg px-3 py-1.5 text-xs font-semibold transition',
            active === tab.key ? 'bg-white/10 text-white' : 'text-mist-400 hover:text-mist-200',
          )}
        >
          {tab.label}
          {tab.count !== undefined ? (
            <span className="ml-1.5 rounded-full bg-white/10 px-1.5 py-0.5 text-[0.6rem] tabular-nums">{tab.count}</span>
          ) : null}
        </button>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ pagination */
export function Pagination({
  page,
  pages,
  total,
  onPage,
}: {
  page: number
  pages: number
  total: number
  onPage: (page: number) => void
}) {
  if (pages <= 1) {
    return <p className="text-[0.7rem] text-mist-500">{total} record(s)</p>
  }
  return (
    <div className="flex items-center justify-between gap-3 pt-1">
      <p className="text-[0.7rem] text-mist-500">
        Page {page} of {pages} · {total} record(s)
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="btn btn-secondary !px-2 !py-1.5"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft size={14} />
        </button>
        <button
          type="button"
          className="btn btn-secondary !px-2 !py-1.5"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  )
}

export function InfoRow({ label, value, mono }: { label: ReactNode; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-white/6 py-2 last:border-0">
      <span className="text-xs text-mist-500">{label}</span>
      <span className={clsx('text-right text-xs text-mist-100', mono && 'font-mono text-[0.7rem]')}>{value}</span>
    </div>
  )
}
