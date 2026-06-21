import { useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'

export type SunnyState = 'idle' | 'listening' | 'thinking' | 'talking' | 'happy' | 'confirming'

interface Props {
  state: SunnyState
  /** 0..1 mouth openness (driven by TTS amplitude); auto-oscillates when talking if absent. */
  amplitudeRef?: MutableRefObject<number>
}

// Glow colour for the antenna orb + chest light per state.
const ORB: Record<SunnyState, string> = {
  idle: '#7fd4ff',
  listening: '#56e08b',
  thinking: '#ffc46b',
  talking: '#7fd4ff',
  happy: '#ffd34d',
  confirming: '#ffb04d'
}

/** An original, friendly screen-faced robot. Animated imperatively to avoid re-renders. */
export function Sunny({ state, amplitudeRef }: Props) {
  const stateRef = useRef<SunnyState>(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  const root = useRef<SVGGElement>(null)
  const eyeL = useRef<SVGEllipseElement>(null)
  const eyeR = useRef<SVGEllipseElement>(null)
  const mouth = useRef<SVGRectElement>(null)
  const smile = useRef<SVGPathElement>(null)
  const orb = useRef<SVGGElement>(null)
  const eyes = useRef<SVGGElement>(null)

  useEffect(() => {
    let raf = 0
    const t0 = performance.now()
    let blink = 0
    let nextBlink = 1.5

    const tick = (now: number) => {
      const t = (now - t0) / 1000
      const s = stateRef.current

      // Hover bob (livelier when happy).
      const bob = (s === 'happy' ? 7 : 4) * Math.sin(t * (s === 'happy' ? 4 : 1.5))
      root.current?.setAttribute('transform', `translate(0 ${bob.toFixed(2)})`)

      // Blink.
      if (t > nextBlink) {
        blink = 1
        nextBlink = t + 2.4 + Math.random() * 3
      }
      let openY = 1
      if (blink > 0) {
        blink -= 0.12
        openY = Math.max(0.08, Math.abs(Math.cos(Math.min((1 - blink) * Math.PI, Math.PI))))
        if (blink <= 0) openY = 1
      }
      // Listening = wide eyes; happy = gentle squint.
      const eyeScale = s === 'listening' ? 1.18 : s === 'happy' ? 0.7 : 1
      const ry = 15 * openY * eyeScale
      eyeL.current?.setAttribute('ry', ry.toFixed(2))
      eyeR.current?.setAttribute('ry', ry.toFixed(2))
      // Look up a touch while thinking.
      eyes.current?.setAttribute('transform', `translate(0 ${s === 'thinking' ? -4 : 0})`)

      // Mouth: open with amplitude while talking, else show the smile.
      const talking = s === 'talking'
      const amp = amplitudeRef ? amplitudeRef.current : 0.5 + 0.5 * Math.sin(t * 11)
      const open = talking ? Math.max(0.05, Math.min(amp, 1)) : 0
      const mh = 3 + open * 22
      if (mouth.current) {
        mouth.current.setAttribute('height', mh.toFixed(2))
        mouth.current.setAttribute('y', (140 - mh / 2).toFixed(2))
        mouth.current.setAttribute('opacity', talking ? '1' : '0')
      }
      smile.current?.setAttribute('opacity', talking ? '0' : '1')

      // Orb / chest colour + pulse (set on root so antenna + chest inherit).
      root.current?.style.setProperty('--orb', ORB[s])
      const pulse = 0.55 + 0.45 * Math.sin(t * (s === 'listening' ? 6 : s === 'thinking' ? 4 : 2))
      root.current?.style.setProperty('--pulse', pulse.toFixed(2))

      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [amplitudeRef])

  return (
    <svg viewBox="0 0 240 300" className="sunny" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="headG" cx="38%" cy="30%">
          <stop offset="0%" stopColor="#fdfbff" />
          <stop offset="60%" stopColor="#e7ecff" />
          <stop offset="100%" stopColor="#c9d4f5" />
        </radialGradient>
        <linearGradient id="bodyG" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#dfe6ff" />
          <stop offset="100%" stopColor="#b9c6f0" />
        </linearGradient>
        <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="soft" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#1a2240" floodOpacity="0.18" />
        </filter>
      </defs>

      <g ref={root}>
        {/* antenna */}
        <line x1="120" y1="34" x2="120" y2="14" stroke="#aab6e0" strokeWidth="5" strokeLinecap="round" />
        <g ref={orb} className="orb">
          <circle cx="120" cy="10" r="9" className="orb-glow" filter="url(#glow)" />
          <circle cx="120" cy="10" r="6" className="orb-core" />
        </g>

        {/* small body / torso */}
        <rect x="74" y="206" width="92" height="74" rx="30" fill="url(#bodyG)" filter="url(#soft)" />
        <circle cx="120" cy="244" r="11" className="chest orb" filter="url(#glow)" />

        {/* ears */}
        <rect x="22" y="92" width="20" height="46" rx="10" fill="#cdd7f5" />
        <rect x="198" y="92" width="20" height="46" rx="10" fill="#cdd7f5" />

        {/* head */}
        <rect x="36" y="40" width="168" height="160" rx="46" fill="url(#headG)" filter="url(#soft)" />
        {/* face screen */}
        <rect x="58" y="66" width="124" height="108" rx="34" fill="#1c2444" />

        {/* eyes */}
        <g ref={eyes} filter="url(#glow)">
          <ellipse ref={eyeL} cx="100" cy="112" rx="11" ry="15" className="feature" />
          <ellipse ref={eyeR} cx="140" cy="112" rx="11" ry="15" className="feature" />
        </g>
        {/* cheeks */}
        <circle cx="84" cy="138" r="7" fill="#ff9bb0" opacity="0.55" />
        <circle cx="156" cy="138" r="7" fill="#ff9bb0" opacity="0.55" />
        {/* mouth (smile when quiet, opens when talking) */}
        <g filter="url(#glow)">
          <path ref={smile} d="M104 138 Q120 150 136 138" fill="none" className="feature-stroke" />
          <rect ref={mouth} x="108" y="134" width="24" height="6" rx="4" className="feature" opacity="0" />
        </g>
      </g>
    </svg>
  )
}
