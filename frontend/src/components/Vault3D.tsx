import { useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Edges, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { VaultBox } from '../lib/types'
import { compactCurrency } from '../lib/format'
import { useTheme } from '../context/ThemeContext'
import { useDocumentVisible } from './luminous'

type VaultTone = VaultBox['tone']

const TONES: Record<'light' | 'dark', Record<VaultTone, string>> = {
  light: { green: '#108a66', amber: '#d97706', red: '#dc4c64', grey: '#8b93a6' },
  dark: { green: '#a7f3d0', amber: '#fdba9b', red: '#f47f90', grey: '#7e88a4' },
}

const SCENE = {
  light: {
    floor: '#efece5',
    gridMajor: '#d9d2c4',
    gridMinor: '#e7e1d6',
    ambient: 1.05,
    key: 1.7,
    keyPosition: [-6, 10, 6] as [number, number, number],
    glowA: '#6c5ce0',
    glowB: '#12a077',
    glowAIntensity: 14,
    glowBIntensity: 10,
    fog: '#f5f3ee',
  },
  dark: {
    floor: '#141824',
    gridMajor: '#2d3550',
    gridMinor: '#1c2132',
    ambient: 0.55,
    key: 1.15,
    keyPosition: [-6, 10, 6] as [number, number, number],
    glowA: '#c4b5fd',
    glowB: '#a7f3d0',
    glowAIntensity: 22,
    glowBIntensity: 16,
    fog: '#0b0d14',
  },
} as const

export function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
  } catch {
    return false
  }
}

function VaultCrate({
  box,
  position,
  selected,
  onSelect,
  colors,
}: {
  box: VaultBox
  position: [number, number, number]
  selected: boolean
  onSelect: (box: VaultBox) => void
  colors: Record<VaultTone, string>
}) {
  const group = useRef<THREE.Group>(null)
  const material = useRef<THREE.MeshStandardMaterial>(null)
  const [hovered, setHovered] = useState(false)
  const { reducedMotion } = useTheme()
  const color = colors[box.tone]
  const height = 0.75 + Math.min(0.55, Math.log10(Math.max(10_000, box.amount)) / 12)

  useFrame((state, delta) => {
    if (!group.current) return
    const target = selected || hovered ? 1.18 : 1
    group.current.scale.lerp(new THREE.Vector3(target, target, target), Math.min(1, delta * 8))
    group.current.position.y =
      position[1] + (reducedMotion ? 0 : Math.sin(state.clock.elapsedTime * 0.9 + box.id) * 0.055)
    if (!reducedMotion) group.current.rotation.y += delta * (selected ? 0.6 : 0.14)
    if (material.current) {
      material.current.emissiveIntensity = THREE.MathUtils.lerp(
        material.current.emissiveIntensity,
        selected ? 0.85 : hovered ? 0.55 : 0.28,
        Math.min(1, delta * 6),
      )
    }
  })

  return (
    <group
      ref={group}
      position={position}
      onClick={(event) => {
        event.stopPropagation()
        onSelect(box)
      }}
      onPointerOver={(event) => {
        event.stopPropagation()
        setHovered(true)
        document.body.style.cursor = 'pointer'
      }}
      onPointerOut={() => {
        setHovered(false)
        document.body.style.cursor = ''
      }}
    >
      <mesh castShadow receiveShadow>
        <boxGeometry args={[0.9, height, 0.9]} />
        <meshStandardMaterial
          ref={material}
          color={color}
          emissive={color}
          emissiveIntensity={0.28}
          metalness={0.45}
          roughness={0.24}
          transparent
          opacity={0.9}
        />
        <Edges color={color} threshold={15} />
      </mesh>
      <mesh position={[0, -height / 2 - 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.34, 0.52, 24]} />
        <meshBasicMaterial color={color} transparent opacity={selected ? 0.65 : 0.22} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

function CrateField({
  boxes,
  selectedId,
  onSelect,
  colors,
}: {
  boxes: VaultBox[]
  selectedId: number | null
  onSelect: (box: VaultBox) => void
  colors: Record<VaultTone, string>
}) {
  const group = useRef<THREE.Group>(null)
  const { reducedMotion } = useTheme()
  useFrame((state) => {
    if (group.current && !reducedMotion) {
      group.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.07) * 0.09
    }
  })

  const placed = useMemo(
    () =>
      boxes.slice(0, 60).map((box, index) => {
        const columns = 7
        const row = Math.floor(index / columns)
        const column = index % columns
        return {
          box,
          position: [
            (column - (columns - 1) / 2) * 1.55,
            0,
            (row - 1.5) * 1.55,
          ] as [number, number, number],
        }
      }),
    [boxes],
  )

  return (
    <group ref={group}>
      {placed.map(({ box, position }) => (
        <VaultCrate
          key={box.id}
          box={box}
          position={position}
          selected={selectedId === box.id}
          onSelect={onSelect}
          colors={colors}
        />
      ))}
    </group>
  )
}

export function VaultScene({
  boxes,
  selectedId,
  onSelect,
}: {
  boxes: VaultBox[]
  selectedId: number | null
  onSelect: (box: VaultBox) => void
}) {
  const { theme, quality, reducedMotion } = useTheme()
  const visible = useDocumentVisible()
  const colors = TONES[theme]
  const scene = SCENE[theme]
  return (
    <Canvas
      shadows={quality === 'high'}
      dpr={quality === 'high' ? [1, 1.75] : quality === 'balanced' ? [1, 1.35] : [1, 1]}
      camera={{ position: [0, 6.4, 10.5], fov: 46 }}
      gl={{ antialias: quality !== 'low', alpha: true }}
      frameloop={!visible ? 'never' : reducedMotion ? 'demand' : 'always'}
      onCreated={({ gl }) => gl.setClearColor(scene.fog, 0)}
    >
      <fog attach="fog" args={[scene.fog, 14, 30]} />
      <ambientLight intensity={scene.ambient} />
      {/* one consistent key light from the top-left */}
      <directionalLight position={scene.keyPosition} intensity={scene.key} castShadow={quality === 'high'} />
      <pointLight position={[-8, 4, -4]} color={scene.glowA} intensity={scene.glowAIntensity} distance={20} />
      <pointLight position={[8, 3, 6]} color={scene.glowB} intensity={scene.glowBIntensity} distance={18} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.05, 0]} receiveShadow>
        <planeGeometry args={[46, 46]} />
        <meshStandardMaterial color={scene.floor} metalness={0.25} roughness={0.75} />
      </mesh>
      <gridHelper args={[46, 46, scene.gridMajor, scene.gridMinor]} position={[0, -1.03, 0]} />
      <CrateField boxes={boxes} selectedId={selectedId} onSelect={onSelect} colors={colors} />

      <OrbitControls
        enablePan={false}
        minDistance={5}
        maxDistance={18}
        minPolarAngle={0.45}
        maxPolarAngle={1.35}
        autoRotate={false}
        target={[0, 0, 0]}
      />
    </Canvas>
  )
}

export function VaultLegend() {
  const { theme } = useTheme()
  const colors = TONES[theme]
  return (
    <div className="flex flex-wrap items-center gap-3 text-[0.68rem] text-mist-400">
      {(
        [
          ['green', 'Protected'],
          ['amber', 'Expiring'],
          ['red', 'Flagged / matured'],
          ['grey', 'Closed'],
        ] as [VaultTone, string][]
      ).map(([tone, label]) => (
        <span key={tone} className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: colors[tone] }} />
          {label}
        </span>
      ))}
    </div>
  )
}

export function Vault2D({
  boxes,
  selectedId,
  onSelect,
}: {
  boxes: VaultBox[]
  selectedId: number | null
  onSelect: (box: VaultBox) => void
}) {
  const { theme } = useTheme()
  const tones = TONES[theme]
  return (
    <div className="grid max-h-[520px] grid-cols-2 gap-2 overflow-y-auto p-1 sm:grid-cols-3 lg:grid-cols-4">
      {boxes.map((box) => {
        const color = tones[box.tone]
        const active = selectedId === box.id
        return (
          <button
            key={box.id}
            type="button"
            onClick={() => onSelect(box)}
            className={`group relative overflow-hidden rounded-xl border p-3 text-left transition ${
              active
                ? 'border-violet-300/60 bg-violet-300/10'
                : 'border-[color:var(--line)] bg-[color:var(--card-flat-bg)] hover:border-violet-300/40'
            }`}
          >
            <span
              className="absolute inset-x-0 top-0 h-[2px]"
              style={{ background: `linear-gradient(90deg, transparent, ${color}, transparent)` }}
            />
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[0.64rem] text-mist-400">{box.reference.slice(-9)}</span>
              <span className="h-2 w-2 rounded-full" style={{ background: color, boxShadow: `0 0 10px ${color}` }} />
            </div>
            <p className="mt-2 truncate text-xs font-semibold text-mist-50">{box.bank}</p>
            <p className="mt-0.5 truncate text-[0.66rem] text-mist-500">{box.institution}</p>
            <p className="mt-2 font-display text-sm text-mist-100">{compactCurrency(box.amount)}</p>
            <div className="mt-2 flex items-center justify-between text-[0.62rem] text-mist-500">
              <span>trust {box.trust_score}</span>
              <span>{box.days_to_maturity === null ? '—' : `${box.days_to_maturity}d`}</span>
            </div>
          </button>
        )
      })}
    </div>
  )
}
