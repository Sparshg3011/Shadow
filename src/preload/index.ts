import { contextBridge, ipcRenderer } from 'electron'

/** Event payloads the sidecar streams back. */
export type AgentEvent =
  | { type: 'ready' }
  | { type: 'status'; id?: string; state: 'idle' | 'thinking' | 'working' }
  | { type: 'step'; id?: string; action: string; detail: string; n: number }
  | { type: 'screenshot'; id?: string; data: string; final: boolean }
  | { type: 'done'; id?: string; screenshot: string; summary: string }
  | { type: 'error'; id?: string; code: string; message: string }

const api = {
  /** Start a task; resolves with the task id. */
  runTask: (instruction: string): Promise<string> =>
    ipcRenderer.invoke('agent:runTask', instruction),

  /** Cancel a running task. */
  cancel: (id: string): void => ipcRenderer.send('agent:cancel', id),

  /** Subscribe to agent events; returns an unsubscribe function. */
  onEvent: (cb: (event: AgentEvent) => void): (() => void) => {
    const listener = (_e: unknown, event: AgentEvent) => cb(event)
    ipcRenderer.on('agent:event', listener)
    return () => ipcRenderer.removeListener('agent:event', listener)
  }
}

contextBridge.exposeInMainWorld('shadow', api)

export type ShadowApi = typeof api
