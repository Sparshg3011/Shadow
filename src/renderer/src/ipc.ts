// IPC contract shared between the renderer and the preload bridge.

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

export interface DeepgramCredential {
  token: string
  mode: 'access' | 'key'
}

export interface ShadowApi {
  runTask(instruction: string): Promise<string>
  cancel(id: string): void
  onEvent(cb: (event: AgentEvent) => void): () => void
  setIgnoreMouseEvents(ignore: boolean, opts?: { forward?: boolean }): void
  mintDeepgramToken(): Promise<DeepgramCredential | null>
}

declare global {
  interface Window {
    shadow: ShadowApi
  }
}
