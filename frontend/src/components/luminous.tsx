import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { motion, useMotionValue, useSpring } from 'framer-motion'
import clsx from 'clsx'

const EASE = [0.22, 1, 0.36, 1] as const

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  if (document.documentElement.dataset.reducedMotion === 'true') return true
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/* -------------------------------------------------- cursor-following light */
export function Spotlight() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (prefersReducedMotion()) return
    if (!window.matchMedia('(pointer: fine)').matches) return
    const node = ref.current
    if (!node) return

    let frame = 0
    let x = window.innerWidth * 0.5
    let y = window.innerHeight * 0.25
    let queued = false

    const paint = () => {
      queued = false
      node.style.setProperty('--spot-x', `${x}px`)
      node.style.setProperty('--spot-y', `${y}px`)
    }

    const onMove = (event: PointerEvent) => {
      x = event.clientX
      y = event.clientY
      if (!queued) {
        queued = true
        frame = requestAnimationFrame(paint)
      }
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      cancelAnimationFrame(frame)
    }
  }, [])

  return <div ref={ref} className="spotlight" aria-hidden />
}

/* ------------------------------------------------ slow ambient light blobs */
export function AmbientOrbs() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="ambient-orb ambient-orb-a" />
      <div className="ambient-orb ambient-orb-b" />
      <div className="ambient-orb ambient-orb-c" />
    </div>
  )
}

/* ------------------------------------------------------- cursor tilt cards */
export function TiltCard({
  children,
  className,
  intensity = 9,
  style,
}: {
  children: ReactNode
  className?: string
  intensity?: number
  style?: CSSProperties
}) {
  const ref = useRef<HTMLDivElement>(null)

  const reset = () => {
    const node = ref.current
    if (node) node.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg)'
  }

  const onMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (prefersReducedMotion() || event.pointerType === 'touch') return
    const node = ref.current
    if (!node) return
    const bounds = node.getBoundingClientRect()
    const px = (event.clientX - bounds.left) / bounds.width - 0.5
    const py = (event.clientY - bounds.top) / bounds.height - 0.5
    node.style.transform = `perspective(1000px) rotateX(${(-py * intensity).toFixed(2)}deg) rotateY(${(
      px * intensity
    ).toFixed(2)}deg) translateZ(0)`
  }

  return (
    <div
      ref={ref}
      className={clsx('tilt-card', className)}
      style={style}
      onPointerMove={onMove}
      onPointerLeave={reset}
      onPointerCancel={reset}
    >
      {children}
    </div>
  )
}

/* --------------------------------------------------------- magnetic button */
export function Magnetic({
  children,
  strength = 6,
  className,
}: {
  children: ReactNode
  strength?: number
  className?: string
}) {
  const ref = useRef<HTMLSpanElement>(null)

  const reset = () => {
    const node = ref.current
    if (node) node.style.transform = 'translate3d(0, 0, 0)'
  }

  const onMove = (event: React.PointerEvent<HTMLSpanElement>) => {
    if (prefersReducedMotion() || event.pointerType === 'touch') return
    const node = ref.current
    if (!node) return
    const bounds = node.getBoundingClientRect()
    const dx = ((event.clientX - bounds.left) / bounds.width - 0.5) * 2
    const dy = ((event.clientY - bounds.top) / bounds.height - 0.5) * 2
    node.style.transform = `translate3d(${(dx * strength).toFixed(2)}px, ${(dy * strength).toFixed(2)}px, 0)`
  }

  return (
    <span
      ref={ref}
      className={clsx('inline-flex transition-transform duration-200', className)}
      style={{ transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)' }}
      onPointerMove={onMove}
      onPointerLeave={reset}
      onPointerCancel={reset}
    >
      {children}
    </span>
  )
}

/* ---------------------------------------------------------- scroll reveal */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode
  delay?: number
  className?: string
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 24, scale: 0.985 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, margin: '-70px' }}
      transition={{ duration: 0.7, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  )
}

/* ------------------------------------------------------ light beam divider */
export function LightBeam({ className }: { className?: string }) {
  return <div className={clsx('light-beam', className)} aria-hidden />
}

/* ------------------------------------------------ pointer parallax wrapper */
export function PointerParallax({
  children,
  depth = 14,
  className,
}: {
  children: ReactNode
  depth?: number
  className?: string
}) {
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const springX = useSpring(x, { stiffness: 90, damping: 22, mass: 0.6 })
  const springY = useSpring(y, { stiffness: 90, damping: 22, mass: 0.6 })

  useEffect(() => {
    if (prefersReducedMotion()) return
    if (!window.matchMedia('(pointer: fine)').matches) return
    const onMove = (event: PointerEvent) => {
      x.set((event.clientX / window.innerWidth - 0.5) * depth)
      y.set((event.clientY / window.innerHeight - 0.5) * depth)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [depth, x, y])

  return (
    <motion.div className={clsx('parallax-layer', className)} style={{ x: springX, y: springY }}>
      {children}
    </motion.div>
  )
}

/* --------------------------------------------- pause heavy work off-screen */
export function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() =>
    typeof document === 'undefined' ? true : document.visibilityState === 'visible',
  )

  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])

  return visible
}
