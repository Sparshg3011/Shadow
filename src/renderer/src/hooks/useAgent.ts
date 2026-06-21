import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentEvent, HelpMode } from '../ipc'

export type AvatarState = 'idle' | 'thinking' | 'talking'

export interface Step {
  action: string
  detail: string
  n: number
}

export interface AgentResult {
  screenshot?: string
  summary?: string
  verdict?: 'approved' | 'rejected'
  reason?: string
}

export interface AgentError {
  code: string
  message: string
}

export interface UseAgent {
  state: AvatarState
  steps: Step[]
  result: AgentResult | null
  error: AgentError | null
  running: boolean
  current: string | null
  liveShot: string | null
  run: (instruction: string) => void
  cancel: () => void
}

const TALK_MS = 6000 // how long the avatar "speaks" the summary before idling

export function useAgent(mode: HelpMode = 'hands-on'): UseAgent {
  const [state, setState] = useState<AvatarState>('idle')
  const [steps, setSteps] = useState<Step[]>([])
  const [result, setResult] = useState<AgentResult | null>(null)
  const [error, setError] = useState<AgentError | null>(null)
  const [running, setRunning] = useState(false)
  const [current, setCurrent] = useState<string | null>(null)
  const [liveShot, setLiveShot] = useState<string | null>(null)
  const taskId = useRef<string | null>(null)
  const cancelledId = useRef<string | null>(null)
  const talkTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Keep the latest mode without rebinding run() (voice calls the same run).
  const modeRef = useRef<HelpMode>(mode)
  modeRef.current = mode

  useEffect(() => {
    if (!window.shadow) return
    return window.shadow.onEvent((ev: AgentEvent) => {
      // Ignore any late events from a task we already stopped (no stale results).
      const evId = 'id' in ev ? ev.id : undefined
      if (evId && evId === cancelledId.current && ev.type !== 'cancelled') return

      switch (ev.type) {
        case 'queued':
          // A task arrived (from the UI or the HTTP endpoint) — reset for it.
          cancelledId.current = null
          setSteps([])
          setResult(null)
          setError(null)
          setLiveShot(null)
          setRunning(true)
          setCurrent(ev.instruction)
          break
        case 'status':
          // The avatar stays "thinking" while planning and acting.
          if (ev.state === 'idle') setState('idle')
          else {
            setState('thinking')
            setRunning(true)
          }
          break
        case 'step':
          setSteps((s) => [...s, { action: ev.action, detail: ev.detail, n: ev.n }])
          break
        case 'screenshot':
          if (!ev.final) setLiveShot(ev.data)
          break
        case 'done':
          setResult({
            screenshot: ev.screenshot,
            summary: ev.summary,
            verdict: ev.verdict,
            reason: ev.reason
          })
          setRunning(false)
          setState('talking')
          if (talkTimer.current) clearTimeout(talkTimer.current)
          talkTimer.current = setTimeout(() => setState('idle'), TALK_MS)
          break
        case 'error':
          setError({ code: ev.code, message: ev.message })
          setRunning(false)
          setState('idle')
          break
        case 'cancelled':
          // Backend confirmed the stop — clear everything back to idle.
          if (talkTimer.current) clearTimeout(talkTimer.current)
          setRunning(false)
          setState('idle')
          setCurrent(null)
          break
      }
    })
  }, [])

  const run = useCallback(async (instruction: string) => {
    const text = instruction.trim()
    if (!text) return
    setSteps([])
    setResult(null)
    setError(null)
    setLiveShot(null)
    setRunning(true)
    setCurrent(text)
    setState('thinking')
    taskId.current = (await window.shadow?.runTask(text, modeRef.current)) ?? null
  }, [])

  const cancel = useCallback(() => {
    cancelledId.current = taskId.current
    if (taskId.current) window.shadow?.cancel(taskId.current)
    if (talkTimer.current) clearTimeout(talkTimer.current)
    setRunning(false)
    setCurrent(null)
    setState('idle')
  }, [])

  return { state, steps, result, error, running, current, liveShot, run, cancel }
}
