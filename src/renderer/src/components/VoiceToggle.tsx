interface Props {
  enabled: boolean
  listening: boolean
  speaking: boolean
  onToggle: () => void
}

/** Floating mic button — the primary way to start talking to Sunny. */
export function VoiceToggle({ enabled, listening, speaking, onToggle }: Props) {
  const cls = ['voice-btn', enabled && 'on', listening && 'listening', speaking && 'speaking']
    .filter(Boolean)
    .join(' ')
  const label = !enabled ? 'Start voice' : speaking ? 'Sunny is talking' : 'Listening — tap to stop'

  return (
    <button className={cls} onClick={onToggle} title={label} aria-label={label}>
      {speaking ? (
        // speaker
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path
            d="M4 9v6h4l5 5V4L8 9H4z"
            fill="currentColor"
          />
          <path
            d="M16 8.5a4 4 0 0 1 0 7M18.5 6a7 7 0 0 1 0 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        // microphone
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
          <path
            d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      )}
    </button>
  )
}
