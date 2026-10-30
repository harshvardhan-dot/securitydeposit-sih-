import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CircleCheckBig, Info, TriangleAlert, X } from 'lucide-react'

type ToastKind = 'success' | 'error' | 'warning' | 'info'

interface Toast {
  id: number
  message: string
  kind: ToastKind
}

interface ToastContextValue {
  toast: (message: string, kind?: ToastKind) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

let counter = 0

const TONE: Record<ToastKind, { border: string; text: string; glow: string }> = {
  success: { border: 'border-mint-400/40', text: 'text-mint-300', glow: '0 0 34px -10px rgba(16,138,102,0.75)' },
  error: { border: 'border-rose-400/40', text: 'text-rose-300', glow: '0 0 34px -10px rgba(220,76,100,0.7)' },
  warning: { border: 'border-amber-400/40', text: 'text-amber-300', glow: '0 0 34px -10px rgba(217,119,6,0.7)' },
  info: { border: 'border-signal-400/40', text: 'text-signal-300', glow: '0 0 34px -10px rgba(12,123,166,0.7)' },
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id))
  }, [])

  const toast = useCallback(
    (message: string, kind: ToastKind = 'info') => {
      const id = ++counter
      setItems((current) => [...current.slice(-3), { id, message, kind }])
      window.setTimeout(() => dismiss(id), kind === 'error' ? 7000 : 4200)
    },
    [dismiss],
  )

  const value = useMemo(() => ({ toast }), [toast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(92vw,380px)] flex-col gap-2">
        <AnimatePresence initial={false}>
          {items.map((item) => {
            const Icon =
              item.kind === 'success' ? CircleCheckBig : item.kind === 'error' || item.kind === 'warning' ? TriangleAlert : Info
            const tone = TONE[item.kind]
            return (
              <motion.div
                key={item.id}
                layout
                initial={{ opacity: 0, y: 18, scale: 0.94 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.96 }}
                transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
                className={`surface-pop pointer-events-auto flex items-start gap-3 rounded-xl border p-3 ${tone.border}`}
                style={{ boxShadow: `var(--pop-shadow), ${tone.glow}` }}
                role="status"
              >
                <span className="relative mt-0.5 shrink-0">
                  {item.kind === 'success' ? (
                    <motion.span
                      aria-hidden
                      className="absolute inset-0 rounded-full border border-mint-400/60"
                      initial={{ opacity: 0.9, scale: 0.6 }}
                      animate={{ opacity: 0, scale: 2.1 }}
                      transition={{ duration: 0.7, ease: 'easeOut' }}
                    />
                  ) : null}
                  <motion.span
                    className={`grid place-items-center ${tone.text}`}
                    initial={item.kind === 'success' ? { scale: 0.4 } : false}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 18 }}
                  >
                    <Icon size={17} />
                  </motion.span>
                </span>
                <p className="flex-1 text-[0.82rem] leading-relaxed text-mist-100">{item.message}</p>
                <button
                  type="button"
                  onClick={() => dismiss(item.id)}
                  className="rounded p-0.5 text-mist-500 transition hover:text-mist-50"
                  aria-label="Dismiss"
                >
                  <X size={14} />
                </button>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside ToastProvider')
  return context
}
