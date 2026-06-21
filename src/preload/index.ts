import { contextBridge, ipcRenderer } from 'electron'

/** Event payloads the sidecar streams back. */
export type AgentEvent =
  | { type: 'ready' }
  | { type: 'queued'; id: string; instruction: string; source: 'ui' | 'api' }
  | { type: 'status'; id?: string; state: 'idle' | 'thinking' | 'working' }
  | { type: 'step'; id?: string; action: string; detail: string; n: number }
  | { type: 'screenshot'; id?: string; data: string; final: boolean }
  | {
      type: 'done'
      id?: string
      screenshot: string
      summary: string
      verdict?: 'approved' | 'rejected'
      reason?: string
    }
  | { type: 'error'; id?: string; code: string; message: string }
  | { type: 'cancelled'; id?: string }

const api = {
  /** Start a task in the given help mode; resolves with the task id. */
  runTask: (instruction: string, mode: 'hands-on' | 'side-by-side' | 'cheering' = 'hands-on'): Promise<string> =>
    ipcRenderer.invoke('agent:runTask', instruction, mode),

  /** Cancel a running task. */
  cancel: (id: string): void => ipcRenderer.send('agent:cancel', id),

  /** Subscribe to agent events; returns an unsubscribe function. */
  onEvent: (cb: (event: AgentEvent) => void): (() => void) => {
    const listener = (_e: unknown, event: AgentEvent) => cb(event)
    ipcRenderer.on('agent:event', listener)
    return () => ipcRenderer.removeListener('agent:event', listener)
  },

  /** Pass clicks through transparent areas to the desktop. */
  setIgnoreMouseEvents: (ignore: boolean, opts?: { forward?: boolean }): void =>
    ipcRenderer.send('window:setIgnoreMouseEvents', ignore, opts),

  /** Mint a short-lived Deepgram credential for the voice layer. */
  mintDeepgramToken: (): Promise<{ token: string; mode: 'access' | 'key' } | null> =>
    ipcRenderer.invoke('deepgram:token')
}

contextBridge.exposeInMainWorld('shadow', api)

export type ShadowApi = typeof api
