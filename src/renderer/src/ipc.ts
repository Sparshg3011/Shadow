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

/** How much help Clara gives — the "How much help?" dial. */
export type HelpMode = 'hands-on' | 'side-by-side' | 'cheering'

/** One conversational turn: Clara's spoken reply + whether it should act. */
export interface ConverseReply {
  intent: 'task' | 'chat'
  say: string // short, warm reply to speak/show immediately
  task: string // a clean instruction for the agent when intent === 'task'
}

export interface ShadowApi {
  runTask(instruction: string, mode?: HelpMode): Promise<string>
  converse(text: string, mode?: HelpMode): Promise<ConverseReply>
  cancel(id: string): void
  onEvent(cb: (event: AgentEvent) => void): () => void
  setIgnoreMouseEvents(ignore: boolean, opts?: { forward?: boolean }): void
  setExpanded(expanded: boolean): void
  dragStart(cursorX: number, cursorY: number): void
  dragMove(cursorX: number, cursorY: number): void
  dragEnd(): void
  mintDeepgramToken(): Promise<DeepgramCredential | null>
}

declare global {
  interface Window {
    shadow: ShadowApi
  }
}
