import { useState } from 'react'
import { VoiceToggle } from './VoiceToggle'

interface Props {
  running: boolean // a task is active → show Stop
  busy: boolean // reply/task in flight → disable Send
  onSend: (text: string) => void
  onCancel: () => void
  // Voice controls live inline with the composer.
  voiceEnabled: boolean
  listening: boolean
  speaking: boolean
  onToggleVoice: () => void
}

/** The bottom bar: talk, type, send — the primary way to reach Clara. */
export function Composer({
  running,
  busy,
  onSend,
  onCancel,
  voiceEnabled,
  listening,
  speaking,
  onToggleVoice
}: Props) {
  const [text, setText] = useState('')

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const value = text.trim()
    if (!value || busy) return
    onSend(value)
    setText('')
  }

  return (
    <form className="composer" onSubmit={submit}>
      <VoiceToggle
        enabled={voiceEnabled}
        listening={listening}
        speaking={speaking}
        onToggle={onToggleVoice}
      />
      <input
        className="composer-field"
        placeholder={voiceEnabled ? 'Listening — or type here…' : 'Message Clara…'}
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="Message Clara"
        autoFocus
      />
      {running ? (
        <button type="button" className="btn btn-stop" onClick={onCancel}>
          Stop
        </button>
      ) : (
        <button type="submit" className="btn btn-send" disabled={!text.trim() || busy} aria-label="Send">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M3.4 20.4l17.6-7.5a1 1 0 0 0 0-1.84L3.4 3.6a.7.7 0 0 0-.96.86L4.9 11l10.1 1-10.1 1-2.46 6.54a.7.7 0 0 0 .96.86z" fill="currentColor" />
          </svg>
        </button>
      )}
    </form>
  )
}
