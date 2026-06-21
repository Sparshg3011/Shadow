import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentEvent, HelpMode } from '../ipc'

export type AvatarState = 'idle' | 'thinking' | 'talking'

export interface Step {
  action: string
  detail: string
  n: number
}

export type TaskStatus = 'thinking' | 'working' | 'done' | 'error' | 'cancelled'

/** The live (then frozen) state of one computer-use task, shown under its message. */
export interface TaskState {
  id: string
  instruction: string
  status: TaskStatus
  steps: Step[]
  liveShot?: string
  summary?: string
  screenshot?: string
  verdict?: 'approved' | 'rejected'
  reason?: string
  errorMessage?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  pending?: boolean // assistant placeholder while Clara is thinking of a reply
  task?: TaskState // attached to the assistant turn that kicked off a task
}

export interface UseChat {
  messages: ChatMessage[]
  state: AvatarState
  busy: boolean // a reply or a task is in flight — the composer shows Stop
  running: boolean // a computer-use task is actively running
  lastVerdict?: 'approved' | 'rejected'
  hadError: boolean
  send: (text: string) => void
  cancel: () => void
  clear: () => void
}

const TALK_MS = 6000 // how long the avatar "talks" after finishing before idling
let seq = 0
const newId = () => `m${Date.now().toString(36)}-${(seq++).toString(36)}`

/**
 * The conversation: every user message is routed through `converse` (a fast
 * reply + task/chat decision), Clara answers immediately, and real tasks run as
 * tracked, live cards in the transcript. `speak` is called for everything Clara
 * says so the caller can voice it (a no-op when voice output is off).
 */
export function useChat(mode: HelpMode, speak: (text: string) => void): UseChat {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [state, setState] = useState<AvatarState>('idle')
  const [conversing, setConversing] = useState(false)
  const [running, setRunning] = useState(false)
  const [lastVerdict, setLastVerdict] = useState<'approved' | 'rejected' | undefined>()
  const [hadError, setHadError] = useState(false)

  const modeRef = useRef<HelpMode>(mode)
  modeRef.current = mode
  const speakRef = useRef(speak)
  speakRef.current = speak

  const activeTaskRef = useRef<string | null>(null) // id of the running task
  const cancelledRef = useRef<string | null>(null)
  const talkTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // busyRef guards re-entrancy without a stale closure (state can't be read live
  // inside the [] useCallbacks). turnRef is a generation token so a Stop/New chat
  // during an in-flight converse() aborts the turn before any task is launched.
  const busyRef = useRef(false)
  const turnRef = useRef(0)

  const patchTask = useCallback((taskId: string, patch: Partial<TaskState>) => {
    setMessages((ms) =>
      ms.map((m) => (m.task && m.task.id === taskId ? { ...m, task: { ...m.task, ...patch } } : m))
    )
  }, [])

  // Subscribe once: map agent events onto the message that owns the task.
  useEffect(() => {
    if (!window.shadow) return
    return window.shadow.onEvent((ev: AgentEvent) => {
      const id = 'id' in ev ? ev.id : undefined
      if (id && id === cancelledRef.current && ev.type !== 'cancelled') return

      switch (ev.type) {
        case 'queued': {
          // A task we didn't start (e.g. the HTTP endpoint) — surface it in chat.
          if (ev.source === 'api') {
            activeTaskRef.current = ev.id
            busyRef.current = true
            setRunning(true)
            setState('thinking')
            const ack = `Working on a request: “${ev.instruction}”`
            setMessages((ms) => [
              ...ms,
              {
                id: newId(),
                role: 'assistant',
                text: ack,
                task: { id: ev.id, instruction: ev.instruction, status: 'thinking', steps: [] }
              }
            ])
            speakRef.current(ack)
          }
          break
        }
        case 'status':
          if (!id) break
          if (ev.state === 'idle') setState('idle')
          else {
            setState('thinking')
            setRunning(true)
            patchTask(id, { status: ev.state === 'working' ? 'working' : 'thinking' })
          }
          break
        case 'step':
          if (id)
            setMessages((ms) =>
              ms.map((m) =>
                m.task && m.task.id === id
                  ? {
                      ...m,
                      task: {
                        ...m.task,
                        steps: [...m.task.steps, { action: ev.action, detail: ev.detail, n: ev.n }]
                      }
                    }
                  : m
              )
            )
          break
        case 'screenshot':
          if (id && !ev.final) patchTask(id, { liveShot: ev.data })
          break
        case 'done':
          if (id) {
            patchTask(id, {
              status: 'done',
              summary: ev.summary,
              screenshot: ev.screenshot,
              liveShot: undefined,
              verdict: ev.verdict,
              reason: ev.reason
            })
            setLastVerdict(ev.verdict)
          }
          activeTaskRef.current = null
          busyRef.current = false
          setRunning(false)
          if (ev.summary) {
            // Talk through the result; idle after a beat.
            setState('talking')
            speakRef.current(ev.summary)
            if (talkTimer.current) clearTimeout(talkTimer.current)
            talkTimer.current = setTimeout(() => setState('idle'), TALK_MS)
          } else {
            setState('idle') // nothing to say — don't hang in a silent "talking" pose
          }
          break
        case 'error':
          if (id) patchTask(id, { status: 'error', errorMessage: ev.message, liveShot: undefined })
          activeTaskRef.current = null
          busyRef.current = false
          setRunning(false)
          setHadError(true)
          setState('talking')
          speakRef.current(ev.message)
          if (talkTimer.current) clearTimeout(talkTimer.current)
          talkTimer.current = setTimeout(() => setState('idle'), TALK_MS)
          break
        case 'cancelled':
          if (id) patchTask(id, { status: 'cancelled', liveShot: undefined })
          activeTaskRef.current = null
          busyRef.current = false
          setRunning(false)
          setState('idle')
          break
      }
    })
  }, [patchTask])

  const send = useCallback((raw: string) => {
    const text = raw.trim()
    if (!text || busyRef.current) return // one turn at a time (voice + typing share this)
    busyRef.current = true
    const myTurn = ++turnRef.current
    setHadError(false)
    cancelledRef.current = null

    const assistantId = newId()
    setMessages((ms) => [
      ...ms,
      { id: newId(), role: 'user', text },
      { id: assistantId, role: 'assistant', text: '', pending: true }
    ])
    setConversing(true)
    setState('thinking')

    const finishAssistant = (say: string, task?: TaskState) =>
      setMessages((ms) =>
        ms.map((m) => (m.id === assistantId ? { ...m, text: say, pending: false, task } : m))
      )

    ;(async () => {
      const reply = (await window.shadow?.converse(text, modeRef.current)) ?? {
        intent: 'task' as const,
        say: 'On it.',
        task: text
      }
      // Stopped or cleared while we were thinking — drop this turn entirely.
      if (turnRef.current !== myTurn) {
        busyRef.current = false
        return
      }

      if (reply.intent === 'task' && reply.task) {
        const taskId = (await window.shadow?.runTask(reply.task, modeRef.current)) ?? newId()
        // Stopped between the reply and the task starting — cancel it immediately.
        if (turnRef.current !== myTurn) {
          if (taskId) window.shadow?.cancel(taskId)
          busyRef.current = false
          return
        }
        activeTaskRef.current = taskId
        setRunning(true)
        finishAssistant(reply.say, {
          id: taskId,
          instruction: reply.task,
          status: 'thinking',
          steps: []
        })
      } else {
        finishAssistant(reply.say)
        busyRef.current = false // a chat reply ends the turn; a task ends on its terminal event
        setState('talking')
        if (talkTimer.current) clearTimeout(talkTimer.current)
        talkTimer.current = setTimeout(() => setState('idle'), TALK_MS)
      }
      setConversing(false)
      speakRef.current(reply.say)
    })()
  }, [])

  const cancel = useCallback(() => {
    turnRef.current++ // invalidate any in-flight converse so it won't start a task
    busyRef.current = false
    const id = activeTaskRef.current
    cancelledRef.current = id
    if (id) window.shadow?.cancel(id)
    if (talkTimer.current) clearTimeout(talkTimer.current)
    activeTaskRef.current = null
    setRunning(false)
    setConversing(false)
    setState('idle')
  }, [])

  const clear = useCallback(() => {
    // Starting fresh also stops anything in flight and returns Clara to idle.
    turnRef.current++
    busyRef.current = false
    const id = activeTaskRef.current
    cancelledRef.current = id
    if (id) window.shadow?.cancel(id)
    if (talkTimer.current) clearTimeout(talkTimer.current)
    activeTaskRef.current = null
    setMessages([])
    setRunning(false)
    setConversing(false)
    setState('idle')
    setHadError(false)
    setLastVerdict(undefined)
  }, [])

  return {
    messages,
    state,
    busy: conversing || running,
    running,
    lastVerdict,
    hadError,
    send,
    cancel,
    clear
  }
}
