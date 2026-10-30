const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

const inrExact = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const number = new Intl.NumberFormat('en-IN')

export function currency(value: number | null | undefined, exact = false): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return exact ? inrExact.format(value) : inr.format(value)
}

/** 1,25,00,000 -> ₹1.25 Cr */
export function compactCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  const absolute = Math.abs(value)
  if (absolute >= 1_00_00_000) return `₹${(value / 1_00_00_000).toFixed(2)} Cr`
  if (absolute >= 1_00_000) return `₹${(value / 1_00_000).toFixed(2)} L`
  if (absolute >= 1_000) return `₹${(value / 1_000).toFixed(1)}K`
  return `₹${number.format(Math.round(value))}`
}

export function plainNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return number.format(value)
}

export function dateLabel(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function dateTimeLabel(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return parsed.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function timeLabel(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return parsed.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
}

export function relativeTime(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value).getTime()
  if (Number.isNaN(parsed)) return '—'
  const diff = Date.now() - parsed
  const minutes = Math.round(diff / 60000)
  if (Math.abs(minutes) < 1) return 'just now'
  if (Math.abs(minutes) < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (Math.abs(days) < 30) return `${days}d ago`
  return dateLabel(value)
}

export function daysLabel(days: number | null | undefined): string {
  if (days === null || days === undefined) return '—'
  if (days < 0) return `${Math.abs(days)}d overdue`
  if (days === 0) return 'today'
  return `${days}d left`
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?'
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}

export function titleCase(value: string | null | undefined): string {
  if (!value) return ''
  return value
    .replace(/[._]/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export function bytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

export function shortHash(value: string | null | undefined, head = 8, tail = 6): string {
  if (!value) return '—'
  if (value.length <= head + tail + 3) return value
  return `${value.slice(0, head)}…${value.slice(-tail)}`
}

const ROLE_LABELS: Record<string, string> = {
  institution: 'Institution',
  scrutiny_officer: 'Scrutiny Officer',
  verification_officer: 'Verification Officer',
  competent_authority: 'Competent Authority',
  admin: 'Administrator',
  auditor: 'Auditor',
}

export function roleLabel(role: string | null | undefined): string {
  if (!role) return '—'
  return ROLE_LABELS[role] ?? titleCase(role)
}

export function scoreTone(score: number): 'green' | 'amber' | 'red' {
  if (score >= 75) return 'green'
  if (score >= 50) return 'amber'
  return 'red'
}

export function requestStepLabel(step: string): string {
  const labels: Record<string, string> = {
    requested: 'Request filed',
    scrutiny: 'Scrutiny',
    verification: 'Verification',
    authority: 'Authority approval',
    closed: 'Closed',
  }
  return labels[step] ?? titleCase(step)
}
