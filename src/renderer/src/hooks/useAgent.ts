import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentEvent } from '../../../preload/index'

export type AvatarState = 'idle' | 'thinking' | 'talking'

export interface Step {
  action: string
  detail: string
  n: number
}

export interface AgentResult {
  screenshot?: string
  summary?: string
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
  liveShot: string | null
  run: (instruction: string) => void
  cancel: () => void
}

const TALK_MS = 6000 // how long the avatar "speaks" the summary before idling

export function useAgent(): UseAgent {
  const [state, setState] = useState<AvatarState>('idle')
  const [steps, setSteps] = useState<Step[]>([])
  const [result, setResult] = useState<AgentResult | null>(null)
  const [error, setError] = useState<AgentError | null>(null)
  const [running, setRunning] = useState(false)
  const [liveShot, setLiveShot] = useState<string | null>(null)
  const taskId = useRef<string | null>(null)
  const talkTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return window.shadow.onEvent((ev: AgentEvent) => {
      switch (ev.type) {
        case 'status':
          // The avatar stays "thinking" while planning and acting.
          if (ev.state === 'idle') setState('idle')
          else setState('thinking')
          break
        case 'step':
          setSteps((s) => [...s, { action: ev.action, detail: ev.detail, n: ev.n }])
          break
        case 'screenshot':
          if (!ev.final) setLiveShot(ev.data)
          break
        case 'done':
          setResult({ screenshot: ev.screenshot, summary: ev.summary })
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
    setState('thinking')
    taskId.current = await window.shadow.runTask(text)
  }, [])

  const cancel = useCallback(() => {
    if (taskId.current) window.shadow.cancel(taskId.current)
    setRunning(false)
    setState('idle')
  }, [])

  return { state, steps, result, error, running, liveShot, run, cancel }
}
