import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { compactCurrency, plainNumber } from '../lib/format'
import { useTheme } from '../context/ThemeContext'

const PALETTE = {
  light: {
    axis: '#6b7488',
    grid: 'rgba(24,28,42,0.1)',
    cursor: 'rgba(24,28,42,0.05)',
    mint: '#108a66',
    sky: '#0c7ba6',
    peach: '#c2652f',
    amber: '#d97706',
    rose: '#dc4c64',
    empty: '#cfc8b9',
  },
  dark: {
    axis: '#7e88a4',
    grid: 'rgba(148,163,184,0.14)',
    cursor: 'rgba(255,255,255,0.04)',
    mint: '#a7f3d0',
    sky: '#9adcfb',
    peach: '#fdba9b',
    amber: '#fbb68f',
    rose: '#f47f90',
    empty: '#2d3550',
  },
} as const

function useChartColors() {
  const { theme } = useTheme()
  return PALETTE[theme]
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: { name?: string; value?: number | string; color?: string; dataKey?: string | number }[]
  label?: string | number
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-[color:var(--line-strong)] bg-[color:var(--pop-bg)] px-3 py-2 text-xs shadow-[var(--pop-shadow)] backdrop-blur-xl">
      <p className="mb-1 font-semibold text-mist-50">{label}</p>
      {payload.map((entry) => (
        <p key={String(entry.dataKey)} className="flex items-center gap-2 text-mist-300">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: entry.color }} />
          <span className="capitalize">{entry.name}</span>
          <span className="ml-auto font-mono text-mist-100">
            {entry.dataKey === 'value' ? compactCurrency(Number(entry.value)) : plainNumber(Number(entry.value))}
          </span>
        </p>
      ))}
    </div>
  )
}

export function ForecastChart({ data }: { data: { month: string; count: number; value: number }[] }) {
  const colors = useChartColors()
  const axis = { fill: colors.axis, fontSize: 11 }
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
          <defs>
            <linearGradient id="forecastFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colors.mint} stopOpacity={0.4} />
              <stop offset="100%" stopColor={colors.mint} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={colors.grid} strokeDasharray="3 5" vertical={false} />
          <XAxis dataKey="month" tick={axis} axisLine={false} tickLine={false} />
          <YAxis
            tick={axis}
            axisLine={false}
            tickLine={false}
            tickFormatter={(value) => compactCurrency(Number(value)).replace('₹', '')}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: colors.mint, strokeOpacity: 0.35, strokeWidth: 1 }} />
          <Area
            type="monotone"
            dataKey="value"
            name="Maturity value"
            stroke={colors.mint}
            strokeWidth={2}
            fill="url(#forecastFill)"
            dot={{ r: 3, fill: colors.mint, strokeWidth: 0 }}
            activeDot={{ r: 5 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export function ReviewBars({ data }: { data: { month: string; count: number }[] }) {
  const colors = useChartColors()
  const axis = { fill: colors.axis, fontSize: 11 }
  return (
    <div className="h-40 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
          <CartesianGrid stroke={colors.grid} strokeDasharray="3 5" vertical={false} />
          <XAxis dataKey="month" tick={axis} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={axis} axisLine={false} tickLine={false} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: colors.cursor }} />
          <Bar dataKey="count" name="Deposits" radius={[6, 6, 0, 0]} fill={colors.sky} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function TrustDonut({ green, amber, red }: { green: number; amber: number; red: number }) {
  const colors = useChartColors()
  const total = green + amber + red
  const data = [
    { name: 'Healthy', value: green, color: colors.mint },
    { name: 'Watch', value: amber, color: colors.amber },
    { name: 'At risk', value: red, color: colors.rose },
  ]
  const empty = [{ name: 'No data', value: 1, color: colors.empty }]
  return (
    <div className="relative h-44 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={total ? data : empty}
            dataKey="value"
            nameKey="name"
            innerRadius={52}
            outerRadius={76}
            paddingAngle={total ? 3 : 0}
            stroke="none"
          >
            {(total ? data : empty).map((entry) => (
              <Cell key={entry.name} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip />} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-2xl font-semibold text-mist-50">{plainNumber(total)}</span>
        <span className="text-[0.62rem] uppercase tracking-[0.16em] text-mist-500">instruments</span>
      </div>
    </div>
  )
}

export function MiniBars({ values, tone }: { values: number[]; tone?: string }) {
  const colors = useChartColors()
  const max = Math.max(1, ...values)
  const fill = tone ?? colors.mint
  return (
    <div className="flex h-10 items-end gap-1">
      {values.map((value, index) => (
        <span
          key={index}
          className="w-full rounded-sm transition-all duration-500"
          style={{
            height: `${Math.max(8, (value / max) * 100)}%`,
            background: fill,
            opacity: 0.35 + (index / values.length) * 0.65,
          }}
        />
      ))}
    </div>
  )
}
