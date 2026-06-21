import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import type { AvatarState } from '../hooks/useAgent'
import defaultAvatar from '../assets/avatar.glb?url'

// Allow overriding with a personal Ready Player Me avatar URL.
const AVATAR_URL = import.meta.env.VITE_SHADOW_AVATAR_URL || defaultAvatar

interface Props {
  state: AvatarState
}

export function Avatar({ state }: Props) {
  const { scene } = useGLTF(AVATAR_URL)

  // Face/teeth/eye meshes carry the ARKit + viseme morph targets.
  const morphMeshes = useMemo(() => {
    const list: THREE.Mesh[] = []
    scene.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh && m.morphTargetDictionary && m.morphTargetInfluences) list.push(m)
    })
    return list
  }, [scene])

  const headBone = useMemo(() => scene.getObjectByName('Head'), [scene])
  const headBase = useRef<THREE.Euler | null>(null)

  const blinkTimer = useRef(2)
  const blinking = useRef(false)
  const blinkPhase = useRef(0)
  const jaw = useRef(0)

  const setMorph = (name: string, v: number) => {
    for (const m of morphMeshes) {
      const i = m.morphTargetDictionary![name]
      if (i !== undefined) m.morphTargetInfluences![i] = v
    }
  }

  useEffect(() => {
    if (headBone && !headBase.current) headBase.current = headBone.rotation.clone()
  }, [headBone])

  useFrame((s, dt) => {
    const t = s.clock.elapsedTime

    // Subtle breathing.
    scene.position.y = Math.sin(t * 1.2) * 0.006

    // Randomised blink (a touch faster while thinking).
    blinkTimer.current -= dt
    if (blinkTimer.current <= 0 && !blinking.current) {
      blinking.current = true
      blinkTimer.current = 2.5 + Math.random() * 3
    }
    if (blinking.current) {
      blinkPhase.current += dt * (state === 'thinking' ? 9 : 12)
      const v = Math.sin(Math.min(blinkPhase.current, Math.PI))
      setMorph('eyeBlinkLeft', v)
      setMorph('eyeBlinkRight', v)
      if (blinkPhase.current >= Math.PI) {
        blinking.current = false
        blinkPhase.current = 0
      }
    }

    // Talking: oscillate the jaw, smoothed so it reads as speech, not chatter.
    const target = state === 'talking' ? 0.16 + 0.2 * (0.5 + 0.5 * Math.sin(t * 11)) : 0
    jaw.current = THREE.MathUtils.lerp(jaw.current, target, 0.35)
    setMorph('jawOpen', jaw.current)
    setMorph('mouthOpen', jaw.current * 0.5)

    // Friendly resting expression.
    setMorph('mouthSmileLeft', 0.12)
    setMorph('mouthSmileRight', 0.12)

    // Gentle head life: idle sway, a tilt while thinking, follow the cursor a little.
    if (headBone && headBase.current) {
      const tilt = state === 'thinking' ? 0.12 : 0
      const targetY = headBase.current.y + s.pointer.x * 0.22 + Math.sin(t * 0.6) * 0.04
      const targetX = headBase.current.x - s.pointer.y * 0.12 + tilt
      headBone.rotation.y = THREE.MathUtils.lerp(headBone.rotation.y, targetY, 0.06)
      headBone.rotation.x = THREE.MathUtils.lerp(headBone.rotation.x, targetX, 0.06)
    }
  })

  return <primitive object={scene} />
}

useGLTF.preload(AVATAR_URL)
