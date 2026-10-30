import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  CircleCheckBig,
  CloudUpload,
  Link2,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react'
import clsx from 'clsx'
import { useTheme } from '../context/ThemeContext'

const TOUR_KEY = 'aicte.tour'

export function openWalkthrough() {
  window.dispatchEvent(new Event('aicte:walkthrough'))
}

function hasSeenWalkthrough() {
  try {
    return window.localStorage.getItem(TOUR_KEY) === 'done'
  } catch {
    return false
  }
}

const STEPS = [
  {
    icon: CloudUpload,
    tone: 'lavender',
    kicker: 'Step 1 · Intake',
    title: 'Start with the document, not a form',
    body: 'Drop the scanned FDR receipt on Submit FDR. Tesseract reads it, DistilBERT aligns each field, and the extracted FDR number, bank and amount arrive pre-filled for you to confirm.',
    cta: 'Open Submit FDR',
    to: '/submit',
  },
  {
    icon: Link2,
    tone: 'mint',
    kicker: 'Step 2 · Custody',
    title: 'Every desk signs the same chain',
    body: 'Institution → scrutiny → bank verification → competent authority. Each decision is signed with the officer’s Ed25519 key and sealed into the SHA-256 ledger, so the trail proves who approved what.',
    cta: 'Open the review queue',
    to: '/review',
  },
  {
    icon: ShieldCheck,
    tone: 'sky',
    kicker: 'Step 3 · Lifecycle',
    title: 'Maturity is never a surprise',
    body: 'The reminder ladder fires at 90, 60, 30 and 7 days. Renew, release and refund run through the same audited path — and the Audit ledger lets you break a block on purpose to watch detection work.',
    cta: 'See reminders',
    to: '/reminders',
  },
] as const

const TONE_VAR: Record<string, string> = {
  lavender: 'var(--tile-lavender)',
  mint: 'var(--tile-mint)',
  sky: 'var(--tile-sky)',
}

export function Walkthrough() {
  const navigate = useNavigate()
  const { reducedMotion } = useTheme()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (hasSeenWalkthrough()) return
    const timer = window.setTimeout(() => setOpen(true), 900)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    const onOpen = () => {
      setStep(0)
      setOpen(true)
    }
    window.addEventListener('aicte:walkthrough', onOpen)
    return () => window.removeEventListener('aicte:walkthrough', onOpen)
  }, [])

  const close = () => {
    setOpen(false)
    try {
      window.localStorage.setItem(TOUR_KEY, 'done')
    } catch {
      /* storage may be unavailable */
    }
  }

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
      if (event.key === 'ArrowRight') setStep((current) => Math.min(STEPS.length - 1, current + 1))
      if (event.key === 'ArrowLeft') setStep((current) => Math.max(0, current - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const current = STEPS[step]
  const Icon = current.icon
  const last = step === STEPS.length - 1

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[90] grid place-items-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reducedMotion ? 0.001 : 0.22 }}
        >
          <div
            className="absolute inset-0 bg-[rgb(20_24_36_/_0.42)] backdrop-blur-[3px]"
            onClick={close}
            aria-hidden
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="tour-title"
            initial={{ opacity: 0, y: 22, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.97 }}
            transition={{ duration: reducedMotion ? 0.001 : 0.34, ease: [0.22, 1, 0.36, 1] }}
            className="card relative w-full max-w-[520px] overflow-hidden p-0"
            style={{ boxShadow: 'var(--pop-shadow)' }}
          >
            <span
              aria-hidden
              className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full blur-3xl"
              style={{ background: `rgb(${TONE_VAR[current.tone]} / 0.22)` }}
            />

            <div className="relative flex items-start justify-between gap-3 border-b border-[color:var(--line)] px-5 py-4">
              <div className="flex items-center gap-2 text-[0.6rem] font-bold uppercase tracking-[0.18em] text-mist-500">
                <Sparkles size={13} className="text-violet-300" /> Guided tour · {step + 1}/{STEPS.length}
              </div>
              <button
                type="button"
                onClick={close}
                className="rounded-lg p-1 text-mist-500 transition hover:bg-[color:var(--inset-bg)] hover:text-mist-100"
                aria-label="Close the guided tour"
              >
                <X size={15} />
              </button>
            </div>

            <div className="relative px-5 pb-4 pt-5">
              <div className="flex items-start gap-3">
                <span
                  className="icon-tile icon-tile-lg shrink-0"
                  style={{ ['--tile' as string]: TONE_VAR[current.tone] }}
                >
                  <Icon size={20} />
                </span>
                <div className="min-w-0">
                  <p className="text-[0.62rem] font-bold uppercase tracking-[0.14em] text-mist-500">{current.kicker}</p>
                  <h2 id="tour-title" className="mt-1 font-display text-[1.05rem] font-semibold leading-snug text-mist-50">
                    {current.title}
                  </h2>
                </div>
              </div>

              <AnimatePresence mode="wait">
                <motion.p
                  key={step}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: reducedMotion ? 0.001 : 0.2 }}
                  className="mt-3 text-[0.82rem] leading-relaxed text-mist-400"
                >
                  {current.body}
                </motion.p>
              </AnimatePresence>

              <div className="mt-4 flex items-center gap-1.5">
                {STEPS.map((entry, index) => (
                  <button
                    key={entry.kicker}
                    type="button"
                    onClick={() => setStep(index)}
                    aria-label={`Go to step ${index + 1}`}
                    aria-current={index === step}
                    className={clsx(
                      'h-1.5 rounded-full transition-all',
                      index === step ? 'w-6 bg-violet-300' : 'w-1.5 bg-[color:var(--line-strong)] hover:bg-violet-300/50',
                    )}
                  />
                ))}
              </div>
            </div>

            <div className="relative flex flex-wrap items-center justify-between gap-2 border-t border-[color:var(--line)] bg-[color:var(--inset-bg)] px-5 py-3.5">
              <button type="button" onClick={close} className="btn btn-ghost !text-[0.72rem]">
                Skip tour
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setStep((value) => Math.max(0, value - 1))}
                  disabled={step === 0}
                  className="btn btn-secondary !px-2.5 !py-1.5"
                  aria-label="Previous step"
                >
                  <ChevronLeft size={15} />
                </button>
                {last ? (
                  <button
                    type="button"
                    onClick={() => {
                      close()
                      navigate('/ledger')
                    }}
                    className="btn btn-primary !py-1.5"
                  >
                    Open the audit ledger <ArrowRight size={15} />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setStep((value) => Math.min(STEPS.length - 1, value + 1))
                    }}
                    className="btn btn-primary !py-1.5"
                  >
                    Next <ChevronRight size={15} />
                  </button>
                )}
              </div>
            </div>

            <div className="relative flex items-center gap-1.5 px-5 py-2 text-[0.6rem] text-mist-600">
              <CircleCheckBig size={11} /> Arrow keys move between steps · Esc closes · shown once
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
