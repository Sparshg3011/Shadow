import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useChat } from './hooks/useChat'
import { useHelpMode } from './hooks/useHelpMode'
import { useVoice } from './voice/useVoice'
import { Sunny, type SunnyEmotion } from './components/Sunny'
import { HelpDial } from './components/HelpDial'
import { Chat } from './components/Chat'
import { Composer } from './components/Composer'
import { EmotionGallery } from './components/EmotionGallery'

const DRAG_SLOP = 5 // px of movement below which a pointer gesture counts as a click

export default function App() {
  // Dev: /?gallery shows every expression for visual review.
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('gallery')) {
    return <EmotionGallery />
  }

  const { mode, setMode } = useHelpMode()
  // The chat panel is hidden until the user clicks Sunny.
  const [open, setOpen] = useState(false)

  // Voice and chat are mutually dependent (voice speaks what chat says; chat
  // receives what voice hears), so a ref breaks the cycle. One toggle = Sunny
  // both listens AND talks.
  const sendRef = useRef<(text: string) => void>(() => {})
  const voice = useVoice((text) => sendRef.current(text))
  const speak = useCallback(
    (text: string) => {
      if (voice.enabled) voice.speak(text)
    },
    [voice.enabled, voice.speak]
  )
  const chat = useChat(mode, speak)
  // A spoken message also opens the chat so the user can see the conversation.
  sendRef.current = (text: string) => {
    setOpen(true)
    chat.send(text)
  }

  // Keep the window size in step with the panel (but not on first mount — it
  // already starts collapsed).
  const firstSync = useRef(true)
  useEffect(() => {
    if (firstSync.current) {
      firstSync.current = false
      return
    }
    window.shadow?.setExpanded(open)
  }, [open])

  // Avatar pointer handling: a drag moves the window, a tap toggles the chat.
  const dragFrom = useRef<{ x: number; y: number } | null>(null)
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId)
    } catch {
      // capture can be rejected for non-active pointers — drag still works
    }
    dragFrom.current = { x: e.screenX, y: e.screenY }
    window.shadow?.dragStart(e.screenX, e.screenY)
  }, [])
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (dragFrom.current) window.shadow?.dragMove(e.screenX, e.screenY)
  }, [])
  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const from = dragFrom.current
    dragFrom.current = null
    window.shadow?.dragEnd()
    if (!from) return
    const moved = Math.abs(e.screenX - from.x) + Math.abs(e.screenY - from.y)
    if (moved < DRAG_SLOP) setOpen((o) => !o) // it was a click, not a drag
  }, [])

  const emotion: SunnyEmotion = useMemo(() => {
    if (voice.speaking) return 'talking'
    if (voice.listening && !chat.running) return 'listening'
    if (chat.state === 'thinking') return 'thinking'
    if (chat.state === 'talking') {
      if (chat.hadError) return 'confused'
      if (chat.lastVerdict === 'approved') return 'happy'
      if (chat.lastVerdict === 'rejected') return 'confused'
      return 'talking'
    }
    return 'idle'
  }, [voice.speaking, voice.listening, chat.running, chat.state, chat.hadError, chat.lastVerdict])

  // A small live caption under the avatar for immediate voice feedback.
  const status =
    (voice.listening && voice.caption) ||
    (voice.speaking && 'Speaking…') ||
    (voice.listening && 'Listening…') ||
    (chat.running && 'Working…') ||
    (chat.state === 'thinking' && 'Thinking…') ||
    ''

  return (
    <div className={`app ${open ? 'open' : 'collapsed'}`}>
      <header className="header">
        <div
          className="avatar-hit"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          title={open ? 'Click to hide the chat' : 'Click to chat with Sunny'}
          role="button"
          aria-label={open ? 'Hide chat' : 'Open chat'}
          aria-expanded={open}
        >
          <Sunny emotion={emotion} amplitudeRef={voice.amplitudeRef} />
        </div>
        <div className={`status-pill${status ? ' show' : ''}`}>{status || ' '}</div>
        {open && chat.messages.length > 0 && (
          <button className="ghost-btn new-chat" onClick={chat.clear} title="Start a new chat">
            New chat
          </button>
        )}
      </header>

      {open && (
        <div className="panel">
          <HelpDial mode={mode} onChange={setMode} />

          <Chat messages={chat.messages} />

          {voice.error && <div className="voice-error">{voice.error}</div>}

          <Composer
            running={chat.running}
            busy={chat.busy}
            onSend={chat.send}
            onCancel={chat.cancel}
            voiceEnabled={voice.enabled}
            listening={voice.listening}
            speaking={voice.speaking}
            onToggleVoice={voice.toggle}
          />
        </div>
      )}
    </div>
  )
}
