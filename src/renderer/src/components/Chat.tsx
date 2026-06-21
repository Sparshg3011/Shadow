import { useEffect, useRef } from 'react'
import type { ChatMessage } from '../hooks/useChat'
import { TaskCard } from './TaskCard'

interface Props {
  messages: ChatMessage[]
}

/** The conversation transcript: user/assistant bubbles + live task cards. */
export function Chat({ messages }: Props) {
  const endRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Only auto-scroll if the user is already near the bottom — never yank them
  // away while they're reading earlier messages.
  const pinnedRef = useRef(true)

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  useEffect(() => {
    if (pinnedRef.current) endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  if (messages.length === 0) {
    return (
      <div className="chat chat-empty">
        <p className="chat-hello">Hi, I'm Clara 👋</p>
        <p className="chat-sub">
          Tell me what you'd like to do — like “open Safari and check the weather” — or just say
          hello. Tap the microphone to talk, or type below.
        </p>
      </div>
    )
  }

  return (
    <div className="chat" ref={scrollRef} onScroll={onScroll}>
      {messages.map((m) => (
        <div key={m.id} className={`msg msg-${m.role}`}>
          {m.pending ? (
            <div className="bubble bubble-assistant">
              <span className="typing" aria-label="Clara is thinking">
                <i />
                <i />
                <i />
              </span>
            </div>
          ) : (
            m.text && <div className={`bubble bubble-${m.role}`}>{m.text}</div>
          )}
          {m.task && <TaskCard task={m.task} />}
        </div>
      ))}
      <div ref={endRef} />
    </div>
  )
}
