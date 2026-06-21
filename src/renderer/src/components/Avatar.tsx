import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF, useAnimations } from '@react-three/drei'
import * as THREE from 'three'
import type { AvatarState } from '../hooks/useAgent'
import defaultAvatar from '../assets/avatar.glb?url'

// Swap in any GLB (e.g. your own cat) via this env var.
const AVATAR_URL = import.meta.env.VITE_SHADOW_AVATAR_URL || defaultAvatar

const TARGET_SIZE = 2.4 // normalize the model's largest dimension to this many units

interface Props {
  state: AvatarState
}

function pickClip(names: string[], wants: string[]): string | undefined {
  for (const w of wants) {
    const hit = names.find((n) => n.toLowerCase().includes(w))
    if (hit) return hit
  }
  return undefined
}

export function Avatar({ state }: Props) {
  const { scene, animations } = useGLTF(AVATAR_URL)
  const { actions, names } = useAnimations(animations, scene)

  const baseY = useRef(0)
  const headBase = useRef<THREE.Euler | null>(null)
  const blinkTimer = useRef(2)
  const blinking = useRef(false)
  const blinkPhase = useRef(0)
  const jaw = useRef(0)

  // Normalize scale + center so any model frames consistently.
  // Runs after mount so world matrices are valid before measuring the bounds.
  useLayoutEffect(() => {
    scene.rotation.set(0, -0.5, 0) // a flattering 3/4 angle
    scene.scale.setScalar(1)
    scene.position.set(0, 0, 0)
    scene.updateWorldMatrix(true, true)

    const box = new THREE.Box3().setFromObject(scene)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z) || 1
    const scale = TARGET_SIZE / maxDim

    scene.scale.setScalar(scale)
    scene.position.set(-center.x * scale, -center.y * scale, -center.z * scale)
    baseY.current = scene.position.y
  }, [scene])

  // Face morph meshes (present on Ready Player Me humans, absent on the fox).
  const morphMeshes = useMemo(() => {
    const list: THREE.Mesh[] = []
    scene.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh && m.morphTargetDictionary && m.morphTargetInfluences) list.push(m)
    })
    return list
  }, [scene])

  const headBone = useMemo(
    () => scene.getObjectByName('Head') || scene.getObjectByName('b_Neck_04') || null,
    [scene]
  )

  const hasClips = names.length > 0
  const idleClip = useMemo(() => pickClip(names, ['idle', 'survey', 'breath']) || names[0], [names])

  const setMorph = (name: string, v: number) => {
    for (const m of morphMeshes) {
      const i = m.morphTargetDictionary![name]
      if (i !== undefined) m.morphTargetInfluences![i] = v
    }
  }

  // Loop the idle clip if the model has one.
  useEffect(() => {
    if (!hasClips || !idleClip) return
    const action = actions[idleClip]
    action?.reset().fadeIn(0.3).play()
    return () => action?.fadeOut(0.3)
  }, [hasClips, idleClip, actions])

  useEffect(() => {
    if (headBone && !headBase.current) headBase.current = headBone.rotation.clone()
  }, [headBone])

  useFrame((s, dt) => {
    const t = s.clock.elapsedTime

    // Breathing bob; livelier bounce while talking.
    const bob = state === 'talking' ? Math.sin(t * 9) * 0.05 : Math.sin(t * 1.4) * 0.02
    scene.position.y = baseY.current + bob

    if (hasClips) {
      // Animation-driven model (the fox): speed the idle clip up when busy.
      const action = idleClip ? actions[idleClip] : undefined
      if (action) action.timeScale = state === 'idle' ? 1 : state === 'talking' ? 1.3 : 1.7
      return
    }

    // Morph-driven model (RPM human): procedural blink, talk, and head-look.
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

    const target = state === 'talking' ? 0.16 + 0.2 * (0.5 + 0.5 * Math.sin(t * 11)) : 0
    jaw.current = THREE.MathUtils.lerp(jaw.current, target, 0.35)
    setMorph('jawOpen', jaw.current)
    setMorph('mouthOpen', jaw.current * 0.5)
    setMorph('mouthSmileLeft', 0.12)
    setMorph('mouthSmileRight', 0.12)

    if (headBone && headBase.current) {
      const tilt = state === 'thinking' ? 0.12 : 0
      const ty = headBase.current.y + s.pointer.x * 0.22 + Math.sin(t * 0.6) * 0.04
      const tx = headBase.current.x - s.pointer.y * 0.12 + tilt
      headBone.rotation.y = THREE.MathUtils.lerp(headBone.rotation.y, ty, 0.06)
      headBone.rotation.x = THREE.MathUtils.lerp(headBone.rotation.x, tx, 0.06)
    }
  })

  return <primitive object={scene} />
}

useGLTF.preload(AVATAR_URL)
