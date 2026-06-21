import type { CSSProperties, ReactNode } from 'react'

export type IconName =
  | 'globe'
  | 'shield'
  | 'lock'
  | 'branch'
  | 'activity'
  | 'message'
  | 'search'
  | 'x'
  | 'plus'
  | 'check'
  | 'zap'
  | 'star'
  | 'chip'
  | 'arrowUpRight'
  | 'alert'
  | 'send'
  | 'trash'

const PATHS: Record<IconName, ReactNode> = {
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.5 2.6 3.8 5.8 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.8-3.8-9S9.5 5.6 12 3Z" />
    </>
  ),
  shield: <path d="M12 3 5 5.8v5.4c0 4.4 3 7.4 7 9 4-1.6 7-4.6 7-9V5.8L12 3Z" />,
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="2" />
      <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
    </>
  ),
  branch: (
    <>
      <path d="M6 4v11" />
      <circle cx="18" cy="6.5" r="2.4" />
      <circle cx="6" cy="17.5" r="2.4" />
      <path d="M18 9a9 9 0 0 1-9 8.4" />
    </>
  ),
  activity: <path d="M22 12h-4l-3 8L9 4l-3 8H2" />,
  message: <path d="M20.5 14.5a2 2 0 0 1-2 2H8l-4.5 3.5v-15a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2Z" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  x: (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  zap: <path d="M13 2 4 13.5h6.5L9.5 22 20 10h-6.5L13 2Z" />,
  star: <path d="M12 3l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 17l-5.5 2.8 1.1-6.1L3.1 9.4l6.1-.8L12 3Z" />,
  chip: (
    <>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
      <path d="M10 2v2.5M14 2v2.5M10 19.5V22M14 19.5V22M2 10h2.5M2 14h2.5M19.5 10H22M19.5 14H22" />
    </>
  ),
  arrowUpRight: (
    <>
      <path d="M8 16 16 8" />
      <path d="M9 8h7v7" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 4 2.5 17.5a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0Z" />
      <path d="M12 10v4" />
      <path d="M12 17.5h.01" />
    </>
  ),
  send: <path d="M21 3 10.5 13.5M21 3l-6.5 18-3.5-8.5L3 9l18-6Z" />,
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9 7V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v2" />
      <path d="M6 7v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7" />
    </>
  ),
}

export function Icon({
  name,
  size = 16,
  strokeWidth = 1.7,
  className,
  style,
}: {
  name: IconName
  size?: number
  strokeWidth?: number
  className?: string
  style?: CSSProperties
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  )
}
