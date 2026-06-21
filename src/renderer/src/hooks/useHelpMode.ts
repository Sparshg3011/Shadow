import { useCallback, useState } from 'react'
import type { HelpMode } from '../ipc'

const KEY = 'Clara.helpMode'
const MODES: HelpMode[] = ['hands-on', 'side-by-side', 'cheering']

/** The chosen "How much help?" mode, persisted across launches. */
export function useHelpMode() {
  const [mode, setModeState] = useState<HelpMode>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null
    return MODES.includes(saved as HelpMode) ? (saved as HelpMode) : 'hands-on'
  })

  const setMode = useCallback((m: HelpMode) => {
    setModeState(m)
    try {
      localStorage.setItem(KEY, m)
    } catch {
      // private mode / storage disabled — keep the in-memory choice
    }
  }, [])

  return { mode, setMode }
}
