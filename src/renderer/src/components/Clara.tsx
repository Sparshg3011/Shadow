import { useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'

export type ClaraEmotion =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'talking'
  | 'happy'
  | 'excited'
  | 'panic'
  | 'surprised'
  | 'confused'
  | 'proud'
  | 'sad'
  | 'mischievous'

interface Props {
  emotion: ClaraEmotion
  /** 0..1 mouth openness while talking (TTS amplitude); auto-oscillates if absent. */
  amplitudeRef?: MutableRefObject<number>
}

type Cfg = {
  orb: string
  /** eye scale-x, scale-y, y-offset (round-eye emotions) */
  eye: [number, number, number]
  bob: [number, number] // amplitude, speed
  jitter: number
  blink: boolean
}

const C: Record<ClaraEmotion, Cfg> = {
  idle: { orb: '#7fd4ff', eye: [1, 1, 0], bob: [4, 1.5], jitter: 0, blink: true },
  listening: { orb: '#56e08b', eye: [1.12, 1.2, -1], bob: [3, 1.7], jitter: 0, blink: true },
  thinking: { orb: '#ffc46b', eye: [1, 1, -5], bob: [3, 1.2], jitter: 0, blink: true },
  talking: { orb: '#7fd4ff', eye: [1, 1, 0], bob: [4, 1.7], jitter: 0, blink: true },
  happy: { orb: '#ffd34d', eye: [1, 1, 0], bob: [7, 4.2], jitter: 0, blink: false },
  excited: { orb: '#ff7ad9', eye: [1, 1, 0], bob: [10, 6.2], jitter: 0, blink: false },
  panic: { orb: '#ff5a5a', eye: [1.18, 1.3, 0], bob: [2, 2], jitter: 2.6, blink: true },
  surprised: { orb: '#ffd34d', eye: [1.22, 1.32, -2], bob: [3, 2], jitter: 0, blink: false },
  confused: { orb: '#b08bff', eye: [1, 1, 0], bob: [3, 1.3], jitter: 0, blink: true },
  proud: { orb: '#ffd34d', eye: [1, 1, 0], bob: [5, 1.5], jitter: 0, blink: false },
  sad: { orb: '#6f8bd0', eye: [0.95, 0.8, 4], bob: [2, 1], jitter: 0, blink: true },
  mischievous: { orb: '#c77bff', eye: [1.05, 0.55, 1], bob: [4, 1.9], jitter: 0, blink: true }
}

const ARC_EYES: ClaraEmotion[] = ['happy', 'proud']
const STAR_EYES: ClaraEmotion[] = ['excited']

function mouthKind(e: ClaraEmotion): 'smile' | 'grin' | 'open' | 'o' | 'squiggle' | 'smirk' | 'frown' {
  if (e === 'talking') return 'open'
  if (e === 'happy') return 'grin'
  if (e === 'excited') return 'open'
  if (e === 'panic' || e === 'surprised') return 'o'
  if (e === 'confused') return 'squiggle'
  if (e === 'mischievous' || e === 'proud') return 'smirk'
  if (e === 'sad') return 'frown'
  return 'smile'
}

// Brow rotation (deg) per side; the mischievous/confused look raises one.
function brows(e: ClaraEmotion): [number, number, number] {
  // [leftDeg, rightDeg, yOffset]
  switch (e) {
    case 'thinking':
    case 'panic':
    case 'sad':
      return [14, -14, 2] // furrowed
    case 'surprised':
    case 'excited':
      return [0, 0, -5] // raised
    case 'mischievous':
      return [-18, 6, -1] // one cocked
    case 'confused':
      return [-12, 10, -1]
    default:
      return [0, 0, 0]
  }
}

/** Clara — an original, expressive screen-faced robot with a cheeky soul. */
export function Clara({ emotion, amplitudeRef }: Props) {
  const eRef = useRef<ClaraEmotion>(emotion)
  useEffect(() => {
    eRef.current = emotion
  }, [emotion])

  const root = useRef<SVGGElement>(null)
  const eyesG = useRef<SVGGElement>(null)
  const eyeL = useRef<SVGEllipseElement>(null)
  const eyeR = useRef<SVGEllipseElement>(null)
  const mouthOpen = useRef<SVGRectElement>(null)

  useEffect(() => {
    let raf = 0
    const t0 = performance.now()
    let blink = 0
    let next = 1.6
    let winkAt = 7 + Math.random() * 6 // spontaneous mischief while idle
    let wink = 0
    let sx = 1
    let sy = 1
    let dy = 0

    const tick = (now: number) => {
      const t = (now - t0) / 1000
      const e = eRef.current
      const cfg = C[e]

      // Bob + panic jitter.
      const bob = cfg.bob[0] * Math.sin(t * cfg.bob[1])
      const jx = cfg.jitter ? (Math.random() - 0.5) * cfg.jitter * 2 : 0
      const jy = cfg.jitter ? (Math.random() - 0.5) * cfg.jitter * 2 : 0
      root.current?.setAttribute('transform', `translate(${jx.toFixed(2)} ${(bob + jy).toFixed(2)})`)

      // Round-eye scale/offset ease toward the emotion target.
      sx += (cfg.eye[0] - sx) * 0.18
      sy += (cfg.eye[1] - sy) * 0.18
      dy += (cfg.eye[2] - dy) * 0.18
      eyesG.current?.setAttribute(
        'transform',
        `translate(120 ${112 + dy}) scale(${sx.toFixed(3)} ${sy.toFixed(3)}) translate(-120 -112)`
      )

      // Blink (+ occasional idle wink for personality).
      if (cfg.blink && t > next && blink <= 0) {
        blink = 1
        next = t + 2.4 + Math.random() * 3
      }
      if (e === 'idle' && t > winkAt && wink <= 0) {
        wink = 1
        winkAt = t + 7 + Math.random() * 7
        root.current?.style.setProperty('--orb', C.mischievous.orb) // a cheeky flash
      }
      let ryL = 15
      let ryR = 15
      if (blink > 0) {
        blink -= 0.12
        const v = Math.max(0.08, Math.abs(Math.sin(blink * Math.PI)))
        ryL = ryR = 15 * (blink <= 0 ? 1 : v)
        if (blink <= 0) ryL = ryR = 15
      }
      if (wink > 0) {
        wink -= 0.05
        ryR = 15 * Math.max(0.08, Math.abs(Math.sin(wink * Math.PI))) // close right eye
        if (wink <= 0) ryR = 15
      }
      eyeL.current?.setAttribute('ry', ryL.toFixed(2))
      eyeR.current?.setAttribute('ry', ryR.toFixed(2))

      // Talking mouth opens with amplitude.
      if (mouthOpen.current) {
        const amp = amplitudeRef ? amplitudeRef.current : 0.5 + 0.5 * Math.sin(t * 11)
        const open = e === 'talking' ? Math.max(0.06, Math.min(amp, 1)) : 0
        const h = 4 + open * 22
        mouthOpen.current.setAttribute('height', h.toFixed(2))
        mouthOpen.current.setAttribute('y', (140 - h / 2).toFixed(2))
        mouthOpen.current.setAttribute('opacity', e === 'talking' ? '1' : '0')
      }

      // Orb / chest colour + pulse.
      if (!(e === 'idle' && wink > 0)) root.current?.style.setProperty('--orb', cfg.orb)
      const speed = e === 'listening' ? 6 : e === 'panic' ? 9 : e === 'thinking' ? 4 : 2
      root.current?.style.setProperty('--pulse', (0.55 + 0.45 * Math.sin(t * speed)).toFixed(2))

      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [amplitudeRef])

  const arc = ARC_EYES.includes(emotion)
  const star = STAR_EYES.includes(emotion)
  const round = !arc && !star
  const mk = mouthKind(emotion)
  const [bl, br, by] = brows(emotion)

  return (
    <svg viewBox="0 0 240 320" className="Clara" xmlns="http://www.w3.org/2000/svg">
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
        <g className="orb">
          <circle cx="120" cy="10" r="9" className="orb-glow" filter="url(#glow)" />
          <circle cx="120" cy="10" r="6" className="orb-core" />
        </g>

        {/* body + chest */}
        <rect x="74" y="206" width="92" height="74" rx="30" fill="url(#bodyG)" filter="url(#soft)" />
        <circle cx="120" cy="244" r="11" className="chest" filter="url(#glow)" />

        {/* ears */}
        <rect x="22" y="92" width="20" height="46" rx="10" fill="#cdd7f5" />
        <rect x="198" y="92" width="20" height="46" rx="10" fill="#cdd7f5" />

        {/* head + face screen */}
        <rect x="36" y="40" width="168" height="160" rx="46" fill="url(#headG)" filter="url(#soft)" />
        <rect x="58" y="66" width="124" height="108" rx="34" fill="#1c2444" />

        {/* brows */}
        <g className="feature-stroke" opacity={bl || br || by ? 0.9 : 0}>
          <line x1="88" y1={90 + by} x2="112" y2={90 + by} transform={`rotate(${bl} 100 ${90 + by})`} />
          <line x1="128" y1={90 + by} x2="152" y2={90 + by} transform={`rotate(${br} 140 ${90 + by})`} />
        </g>

        {/* eyes — round (animated), happy arcs, or sparkle stars */}
        <g filter="url(#glow)">
          <g ref={eyesG} opacity={round ? 1 : 0}>
            <ellipse ref={eyeL} cx="100" cy="112" rx="11" ry="15" className="feature" />
            <ellipse ref={eyeR} cx="140" cy="112" rx="11" ry="15" className="feature" />
          </g>
          {arc && (
            <g className="feature-stroke">
              <path d="M88 116 Q100 102 112 116" fill="none" />
              <path d="M128 116 Q140 102 152 116" fill="none" />
            </g>
          )}
          {star && (
            <g className="feature">
              <path d="M100 100 l4 9 10 1 -7 7 2 10 -9 -5 -9 5 2 -10 -7 -7 10 -1z" />
              <path d="M140 100 l4 9 10 1 -7 7 2 10 -9 -5 -9 5 2 -10 -7 -7 10 -1z" />
            </g>
          )}
        </g>

        {/* cheeks (brighter when happy/excited/mischievous) */}
        <circle cx="84" cy="138" r="7" fill="#ff9bb0" opacity={['happy', 'excited', 'mischievous', 'proud'].includes(emotion) ? 0.8 : 0.45} />
        <circle cx="156" cy="138" r="7" fill="#ff9bb0" opacity={['happy', 'excited', 'mischievous', 'proud'].includes(emotion) ? 0.8 : 0.45} />

        {/* mouth */}
        <g filter="url(#glow)">
          {mk === 'smile' && <path d="M104 138 Q120 150 136 138" fill="none" className="feature-stroke" />}
          {mk === 'grin' && <path d="M98 136 Q120 158 142 136 Q120 146 98 136z" className="feature" />}
          {mk === 'o' && <circle cx="120" cy="142" r="8" className="feature" />}
          {mk === 'smirk' && <path d="M106 142 Q124 150 138 134" fill="none" className="feature-stroke" />}
          {mk === 'frown' && <path d="M106 146 Q120 134 134 146" fill="none" className="feature-stroke" />}
          {mk === 'squiggle' && <path d="M104 140 q6 -7 11 0 q6 7 11 0" fill="none" className="feature-stroke" />}
          <rect ref={mouthOpen} x="108" y="134" width="24" height="6" rx="5" className="feature" opacity="0" />
        </g>

        {/* accessories */}
        {emotion === 'panic' && <path d="M176 86 q7 12 0 20 q-7 -8 0 -20z" fill="#7fd4ff" opacity="0.9" />}
        {emotion === 'sad' && <ellipse cx="106" cy="128" rx="3.5" ry="5" fill="#7fd4ff" opacity="0.9" />}
        {emotion === 'confused' && <text x="184" y="70" fill="#b08bff" fontSize="30" fontWeight="700">?</text>}
        {(emotion === 'excited' || emotion === 'happy') && (
          <g fill="#ffd34d">
            <path d="M52 70 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z" />
            <path d="M190 58 l2 6 6 2 -6 2 -2 6 -2 -6 -6 -2 6 -2z" />
          </g>
        )}
      </g>
    </svg>
  )
}
