import { Gauge, MonitorCog, Moon, Sun, Waves } from 'lucide-react'
import clsx from 'clsx'
import { useTheme, type MotionPreference, type Quality } from '../context/ThemeContext'
import { IconTile, SectionHeading } from './ui'

const QUALITY_COPY: Record<Quality, { label: string; detail: string }> = {
  high: { label: 'High', detail: 'Full 3D, parallax and glow. Best on a desktop GPU.' },
  balanced: { label: 'Balanced', detail: 'Lighter blur and pixel ratio. Good on laptops.' },
  low: { label: 'Low', detail: 'Static depth, no ambient motion. Safest on weak devices.' },
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: string; icon?: typeof Sun }[]
  onChange: (next: T) => void
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-1.5 rounded-xl border border-[color:var(--line)] inset-well p-1.5 sm:grid-cols-3">
      {options.map((option) => {
        const Icon = option.icon
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={clsx(
              'flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[0.72rem] font-semibold transition',
              active
                ? 'border border-violet-300/45 bg-violet-300/12 text-violet-200 shadow-[0_8px_20px_-14px_rgba(108,92,224,0.9)]'
                : 'border border-transparent text-mist-400 hover:bg-violet-300/[0.06] hover:text-mist-100',
            )}
          >
            {Icon ? <Icon size={13} /> : null}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Appearance controls: the visible home for the light/dark switch, the graphics
 * quality tier and the reduced-motion override required by the design PRD.
 */
export function AppearancePanel() {
  const { theme, setTheme, quality, setQuality, motion, setMotion, reducedMotion } = useTheme()

  const motionLabel: Record<MotionPreference, string> = {
    system: 'Follow system preference',
    full: 'Always animate',
    reduced: 'Reduced motion',
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="card p-5">
        <SectionHeading
          title="Theme"
          hint="Light is the default; dark remains optional"
          action={<IconTile tone={theme === 'dark' ? 'lavender' : 'peach'} size="sm">{theme === 'dark' ? <Moon size={14} /> : <Sun size={14} />}</IconTile>}
        />
        <Segmented
          label="Colour theme"
          value={theme}
          onChange={setTheme}
          options={[
            { value: 'light', label: 'Light', icon: Sun },
            { value: 'dark', label: 'Dark', icon: Moon },
          ]}
        />
        <p className="mt-2.5 text-[0.66rem] leading-relaxed text-mist-500">
          Light uses warm off-white surfaces with charcoal text; no pure-white blocks. Both themes share one token set, so
          charts, 3D scenes and status colours switch together.
        </p>
      </div>

      <div className="card p-5">
        <SectionHeading
          title="Graphics quality"
          hint="Auto-selected from device, always overridable"
          action={<IconTile tone="mint" size="sm"><Gauge size={14} /></IconTile>}
        />
        <Segmented
          label="Graphics quality"
          value={quality}
          onChange={setQuality}
          options={[
            { value: 'high', label: 'High' },
            { value: 'balanced', label: 'Balanced' },
            { value: 'low', label: 'Low' },
          ]}
        />
        <p className="mt-2.5 text-[0.66rem] leading-relaxed text-mist-500">{QUALITY_COPY[quality].detail}</p>
      </div>

      <div className="card p-5">
        <SectionHeading
          title="Motion"
          hint="3D movement can be replaced by simple fades"
          action={<IconTile tone={reducedMotion ? 'rose' : 'sky'} size="sm"><Waves size={14} /></IconTile>}
        />
        <Segmented
          label="Motion preference"
          value={motion}
          onChange={setMotion}
          options={[
            { value: 'system', label: 'System', icon: MonitorCog },
            { value: 'full', label: 'Full', icon: Waves },
            { value: 'reduced', label: 'Reduced', icon: Moon },
          ]}
        />
        <p className="mt-2.5 text-[0.66rem] leading-relaxed text-mist-500">
          {reducedMotion
            ? 'Reduce motion is on: the hero freezes, parallax stops and only opacity fades remain.'
            : 'Animations stay between 150 and 400 ms, always eased, and never block an input.'}{' '}
          <span className="text-mist-400">{motionLabel[motion]}.</span>
        </p>
      </div>
    </div>
  )
}

/** Compact variant used inside the account menu so every role can reach it. */
export function AppearanceMenu() {
  const { theme, setTheme, quality, setQuality, motion, setMotion, reducedMotion } = useTheme()

  const row = (
    label: string,
    options: { value: string; label: string }[],
    value: string,
    onPick: (next: string) => void,
  ) => (
    <div className="px-3 py-2">
      <p className="text-[0.58rem] font-bold uppercase tracking-[0.14em] text-mist-600">{label}</p>
      <div className="mt-1.5 flex gap-1">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onPick(option.value)}
            aria-pressed={value === option.value}
            className={clsx(
              'flex-1 rounded-md border px-1.5 py-1 text-[0.66rem] font-semibold transition',
              value === option.value
                ? 'border-violet-300/45 bg-violet-300/12 text-violet-200'
                : 'border-transparent text-mist-400 hover:bg-violet-300/[0.06] hover:text-mist-100',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <div className="border-t border-[color:var(--line)] py-1">
      {row('Theme', [
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' },
      ], theme, (next) => setTheme(next as 'light' | 'dark'))}
      {row('Graphics', [
        { value: 'high', label: 'High' },
        { value: 'balanced', label: 'Balanced' },
        { value: 'low', label: 'Low' },
      ], quality, (next) => setQuality(next as Quality))}
      {row('Motion', [
        { value: 'system', label: 'System' },
        { value: 'full', label: 'Full' },
        { value: 'reduced', label: 'Reduced' },
      ], motion, (next) => setMotion(next as MotionPreference))}
      <p className="px-3 pb-1.5 pt-1 text-[0.6rem] leading-relaxed text-mist-600">
        {reducedMotion ? 'Reduced motion is active.' : 'Motion follows the selected preference.'}
      </p>
    </div>
  )
}
