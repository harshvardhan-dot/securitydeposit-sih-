import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export type Theme = 'light' | 'dark'
export type Quality = 'high' | 'balanced' | 'low'
export type MotionPreference = 'system' | 'full' | 'reduced'

const THEME_KEY = 'aicte.theme'
const QUALITY_KEY = 'aicte.quality'
const MOTION_KEY = 'aicte.motion'

interface ThemeState {
  theme: Theme
  quality: Quality
  motion: MotionPreference
  reducedMotion: boolean
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  setQuality: (quality: Quality) => void
  setMotion: (motion: MotionPreference) => void
}

const ThemeContext = createContext<ThemeState | null>(null)

function readTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  const stored = window.localStorage.getItem(THEME_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  // Light is the product default; only an explicit choice overrides it.
  return 'light'
}

function autoQuality(): Quality {
  if (typeof window === 'undefined') return 'balanced'
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 'low'
  const cores = navigator.hardwareConcurrency ?? 4
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4
  if (cores <= 4 || memory <= 4) return 'balanced'
  return 'high'
}

function readQuality(): Quality {
  if (typeof window === 'undefined') return 'high'
  const stored = window.localStorage.getItem(QUALITY_KEY)
  if (stored === 'high' || stored === 'balanced' || stored === 'low') return stored
  return autoQuality()
}

function readMotion(): MotionPreference {
  if (typeof window === 'undefined') return 'system'
  const stored = window.localStorage.getItem(MOTION_KEY)
  if (stored === 'system' || stored === 'full' || stored === 'reduced') return stored
  return 'system'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readTheme)
  const [quality, setQualityState] = useState<Quality>(readQuality)
  const [motion, setMotionState] = useState<MotionPreference>(readMotion)
  const [systemReduced, setSystemReduced] = useState(false)

  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = theme
    root.style.setProperty('color-scheme', theme)
    const meta = document.querySelector('meta[name="theme-color"]')
    meta?.setAttribute('content', theme === 'dark' ? '#0B0D14' : '#F5F3EE')
    window.localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  useEffect(() => {
    document.documentElement.dataset.quality = quality
    window.localStorage.setItem(QUALITY_KEY, quality)
  }, [quality])

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setSystemReduced(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  const reducedMotion = motion === 'reduced' || (motion === 'system' && systemReduced)

  useEffect(() => {
    document.documentElement.dataset.reducedMotion = String(reducedMotion)
    if (reducedMotion) setQualityState('low')
    window.localStorage.setItem(MOTION_KEY, motion)
  }, [reducedMotion, motion])

  const setTheme = useCallback((next: Theme) => setThemeState(next), [])
  const toggleTheme = useCallback(
    () => setThemeState((current) => (current === 'dark' ? 'light' : 'dark')),
    [],
  )
  const setQuality = useCallback((next: Quality) => setQualityState(next), [])
  const setMotion = useCallback((next: MotionPreference) => setMotionState(next), [])

  const value = useMemo(
    () => ({
      theme,
      quality,
      motion,
      reducedMotion,
      setTheme,
      toggleTheme,
      setQuality,
      setMotion,
    }),
    [theme, quality, motion, reducedMotion, setTheme, toggleTheme, setQuality, setMotion],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeState {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used inside ThemeProvider')
  return context
}
