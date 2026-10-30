import { Moon, Sun } from 'lucide-react'
import clsx from 'clsx'
import { useTheme } from '../context/ThemeContext'

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme } = useTheme()
  const dark = theme === 'dark'
  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={clsx(
        'group relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-[color:var(--line-strong)] bg-[color:var(--well-bg)] text-mist-400 transition duration-200 hover:text-mist-50',
        'hover:border-violet-300/50 hover:shadow-[0_0_24px_-6px_rgba(108,92,224,0.55)]',
        className,
      )}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={dark ? 'Light theme' : 'Dark theme'}
    >
      <Sun
        size={16}
        className={clsx('absolute transition-all duration-300', dark ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-50 opacity-0')}
      />
      <Moon
        size={16}
        className={clsx('absolute transition-all duration-300', dark ? 'rotate-90 scale-50 opacity-0' : 'rotate-0 scale-100 opacity-100')}
      />
    </button>
  )
}
