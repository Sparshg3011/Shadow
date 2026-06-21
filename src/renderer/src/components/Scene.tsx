import { Suspense, useEffect } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { Avatar } from './Avatar'
import type { AvatarState } from '../hooks/useAgent'

/** Aim the camera at the avatar's face once on mount. */
function CameraRig({ target }: { target: [number, number, number] }) {
  const { camera } = useThree()
  useEffect(() => {
    camera.lookAt(...target)
  }, [camera, target])
  return null
}

export function Scene({ state }: { state: AvatarState }) {
  return (
    <Canvas
      gl={{ alpha: true, antialias: true }}
      dpr={[1, 2]}
      camera={{ position: [0, 0.5, 4.2], fov: 30 }}
    >
      <CameraRig target={[0, 0, 0]} />

      {/* Studio-style three-point lighting (no HDR dependency). */}
      <hemisphereLight args={['#ffffff', '#3a3a52', 0.85]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[2, 4, 3]} intensity={2.2} />
      <directionalLight position={[-3, 2, 2]} intensity={0.7} color="#aab4ff" />
      <directionalLight position={[0, 2, -3]} intensity={0.6} />

      <Suspense fallback={null}>
        <Avatar state={state} />
      </Suspense>
    </Canvas>
  )
}
