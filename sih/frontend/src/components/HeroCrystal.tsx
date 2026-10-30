import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Edges, OrbitControls, RoundedBox } from '@react-three/drei'
import * as THREE from 'three'
import { useTheme } from '../context/ThemeContext'
import { useDocumentVisible } from './luminous'
import { supportsWebGL } from './Vault3D'

interface CrystalColors {
  core: string
  deep: string
  rim: string
  accent: string
  ring: string
  ambient: number
  key: number
}

const PALETTE = {
  light: {
    core: '#8f80f2',
    deep: '#5b4bc4',
    rim: '#0d7355',
    accent: '#0c7ba6',
    ring: '#6c5ce0',
    ambient: 1.5,
    key: 2.1,
  },
  dark: {
    core: '#c4b5fd',
    deep: '#a78bfa',
    rim: '#a7f3d0',
    accent: '#bae6fd',
    ring: '#c4b5fd',
    ambient: 0.9,
    key: 1.5,
  },
} satisfies Record<'light' | 'dark', CrystalColors>

/** A thin ring that orbits the cube on one tilted plane. */
function Ring({ radius, tilt, color, speed, reduced }: {
  radius: number
  tilt: [number, number, number]
  color: string
  speed: number
  reduced: boolean
}) {
  const ref = useRef<THREE.Mesh>(null)
  useFrame((_, delta) => {
    if (ref.current && !reduced) ref.current.rotation.z += delta * speed
  })
  return (
    <mesh ref={ref} rotation={tilt}>
      <torusGeometry args={[radius, 0.008, 8, 96]} />
      <meshBasicMaterial color={color} transparent opacity={0.5} />
    </mesh>
  )
}

/**
 * The hero object: a glass cube with a glowing inner cube. It turns on its own
 * and can be dragged; the whole scene pauses when the tab is hidden.
 */
function GlassCube({ colors, reduced, detail }: {
  colors: CrystalColors
  reduced: boolean
  detail: number
}) {
  const outer = useRef<THREE.Group>(null)
  const inner = useRef<THREE.Group>(null)
  const core = useRef<THREE.Mesh>(null)

  const satellites = useMemo(
    () =>
      Array.from({ length: 8 }, (_, index) => {
        const angle = (index / 8) * Math.PI * 2
        return {
          position: [Math.cos(angle) * 1.85, Math.sin(angle * 1.7) * 0.5, Math.sin(angle) * 1.85] as [
            number,
            number,
            number,
          ],
          size: 0.055 + (index % 3) * 0.02,
        }
      }),
    [],
  )

  useFrame((state, delta) => {
    if (outer.current && !reduced) {
      outer.current.position.y = Math.sin(state.clock.elapsedTime * 0.6) * 0.08
    }
    if (inner.current && !reduced) {
      inner.current.rotation.y -= delta * 0.55
      inner.current.rotation.x += delta * 0.28
    }
    if (core.current && !reduced) {
      const pulse = 1 + Math.sin(state.clock.elapsedTime * 1.6) * 0.06
      core.current.scale.setScalar(pulse)
    }
  })

  return (
    <group ref={outer}>
      {/* glass shell */}
      <RoundedBox args={[1.9, 1.9, 1.9]} radius={0.16} smoothness={detail ? 4 : 1}>
        <meshPhysicalMaterial
          color={colors.core}
          roughness={0.08}
          metalness={0.06}
          clearcoat={1}
          clearcoatRoughness={0.06}
          transparent
          opacity={0.3}
          envMapIntensity={0.6}
        />
        <Edges color={colors.deep} threshold={15} />
      </RoundedBox>

      {/* inner core cube, counter-rotating */}
      <group ref={inner} scale={0.62}>
        <RoundedBox args={[1, 1, 1]} radius={0.08} smoothness={detail ? 4 : 1}>
          <meshStandardMaterial
            color={colors.rim}
            emissive={colors.rim}
            emissiveIntensity={1.5}
            metalness={0.3}
            roughness={0.28}
          />
          <Edges color={colors.rim} threshold={15} />
        </RoundedBox>
      </group>

      {/* glowing heart */}
      <mesh ref={core} scale={0.26}>
        <icosahedronGeometry args={[1, 0]} />
        <meshStandardMaterial
          color={colors.accent}
          emissive={colors.accent}
          emissiveIntensity={2.1}
          roughness={0.3}
        />
      </mesh>

      <Ring radius={2.05} tilt={[Math.PI / 2.4, 0.2, 0]} color={colors.ring} speed={0.3} reduced={reduced} />
      <Ring radius={2.38} tilt={[Math.PI / 2.9, -0.5, 0.6]} color={colors.rim} speed={-0.2} reduced={reduced} />

      {satellites.map((satellite, index) => (
        <mesh key={index} position={satellite.position}>
          <octahedronGeometry args={[satellite.size, 0]} />
          <meshStandardMaterial
            color={index % 2 === 0 ? colors.rim : colors.accent}
            emissive={index % 2 === 0 ? colors.rim : colors.accent}
            emissiveIntensity={1.2}
          />
        </mesh>
      ))}
    </group>
  )
}

export interface HeroCrystalProps {
  className?: string
}

/**
 * Signature 3D hero object. Falls back to a CSS cube when WebGL is missing and
 * freezes when the user prefers reduced motion.
 */
export function HeroCrystal({ className }: HeroCrystalProps) {
  const { theme, quality, reducedMotion } = useTheme()
  const visible = useDocumentVisible()
  const colors = PALETTE[theme]
  const webgl = useMemo(() => supportsWebGL(), [])
  const detail = quality === 'low' ? 0 : 1
  const dpr: [number, number] = quality === 'high' ? [1, 1.9] : quality === 'balanced' ? [1, 1.4] : [1, 1]
  const frameloop = !visible ? 'never' : reducedMotion ? 'demand' : 'always'

  if (!webgl) {
    return (
      <div className={className} role="img" aria-label="A floating glass cube lit in lavender and mint, representing a secured deposit">
        <div className="grid h-full w-full place-items-center">
          <div className="relative h-40 w-40" style={{ transformStyle: 'preserve-3d' }}>
            <div
              className="absolute inset-0 rounded-2xl border"
              style={{
                borderColor: colors.deep,
                background: `linear-gradient(150deg, ${colors.core}55, ${colors.rim}33)`,
                transform: 'rotateX(-18deg) rotateY(24deg)',
                boxShadow: `0 30px 60px -28px ${colors.deep}`,
              }}
            />
            <div
              className="absolute inset-8 rounded-xl"
              style={{
                background: `linear-gradient(150deg, ${colors.rim}, ${colors.accent})`,
                transform: 'translateZ(34px)',
                boxShadow: `0 0 34px ${colors.rim}`,
              }}
            />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className={className}
      role="img"
      aria-label="A slowly turning three-dimensional glass cube lit in lavender and mint, representing a secured deposit. Drag to rotate."
    >
      <Canvas
        dpr={dpr}
        camera={{ position: [0, 0.4, 6.4], fov: 42 }}
        gl={{ antialias: quality !== 'low', alpha: true, powerPreference: 'high-performance' }}
        frameloop={frameloop}
        style={{ background: 'transparent' }}
      >
        <ambientLight intensity={colors.ambient} />
        {/* single virtual key light from the top-left */}
        <directionalLight position={[-4, 5.5, 4]} intensity={colors.key} color="#ffffff" />
        <pointLight position={[3.4, 1.6, 3]} intensity={quality === 'low' ? 6 : 14} color={colors.core} />
        <pointLight position={[-3.2, -2.2, 1.4]} intensity={quality === 'low' ? 4 : 9} color={colors.rim} />
        <GlassCube colors={colors} reduced={reducedMotion} detail={detail} />
        <OrbitControls
          enablePan={false}
          enableZoom={false}
          autoRotate={!reducedMotion}
          autoRotateSpeed={0.55}
          enableDamping
          dampingFactor={0.08}
          minPolarAngle={0.7}
          maxPolarAngle={2.1}
        />
      </Canvas>
    </div>
  )
}
