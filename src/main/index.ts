import { app, BrowserWindow, ipcMain, session } from 'electron'
import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import { createInterface } from 'readline'
import { randomUUID } from 'crypto'
import { join } from 'path'
import { DeepgramClient } from '@deepgram/sdk'

import { readFileSync } from 'fs'

let win: BrowserWindow | null = null
let sidecar: ChildProcessWithoutNullStreams | null = null

// Window footprint in each state. Collapsed = avatar only; expanded = full chat.
const COLLAPSED = { width: 210, height: 240 }
const EXPANDED = { width: 400, height: 680 }
// Anchor point captured at the start of an avatar drag, so window moves are drift-free.
let dragAnchor: { winX: number; winY: number; cursorX: number; cursorY: number } | null = null

/** Pending converse() calls, keyed by request id, resolved when the sidecar replies. */
type ConverseReply = { intent: 'task' | 'chat'; say: string; task: string }
const pendingConverse = new Map<string, (reply: ConverseReply) => void>()

/** Guard the sidecar's reply shape before trusting it (a malformed one falls through
 *  to the converse() timeout fallback rather than corrupting renderer state). */
function isConverseReply(ev: {
  intent?: unknown
  say?: unknown
  task?: unknown
}): ev is ConverseReply {
  return (
    (ev.intent === 'task' || ev.intent === 'chat') &&
    typeof ev.say === 'string' &&
    typeof ev.task === 'string'
  )
}

/** Load .env into process.env (the sidecar parses it itself; main needs the Deepgram key). */
function loadEnv() {
  for (const base of [app.getAppPath(), process.cwd()]) {
    try {
      for (const raw of readFileSync(join(base, '.env'), 'utf8').split('\n')) {
        const line = raw.trim()
        if (!line || line.startsWith('#')) continue
        const eq = line.indexOf('=')
        if (eq < 0) continue
        const key = line.slice(0, eq).trim()
        if (!process.env[key]) process.env[key] = line.slice(eq + 1).trim()
      }
      return
    } catch {
      // try the next candidate path
    }
  }
}

/** Resolve the Python sidecar paths; overridable via env for packaging. */
function agentPaths() {
  const dir = process.env.SHADOW_AGENT_DIR || join(app.getAppPath(), 'agent')
  const python = process.env.SHADOW_PYTHON || join(dir, '.venv', 'bin', 'python')
  return { python, script: join(dir, 'main.py'), cwd: dir }
}

function startSidecar() {
  const { python, script, cwd } = agentPaths()
  // PYTHONUNBUFFERED guards against block-buffered stdout delaying events.
  sidecar = spawn(python, [script], {
    cwd,
    env: { ...process.env, PYTHONUNBUFFERED: '1' }
  })

  // Each stdout line is one JSON event. `reply` events answer a pending converse()
  // call (request/response); everything else streams to the renderer.
  createInterface({ input: sidecar.stdout }).on('line', (raw) => {
    const line = raw.trim()
    if (!line) return
    let ev: { type?: string; id?: string; intent?: unknown; say?: unknown; task?: unknown }
    try {
      ev = JSON.parse(line)
    } catch {
      console.error('[sidecar] non-JSON stdout:', line)
      return // stdout is JSON-only by contract; ignore anything else.
    }
    if (ev.type === 'reply') {
      // Answer the matching converse() call — or drop the reply (a late arrival
      // after timeout, or one for an unknown id). Never forward it to the renderer.
      const replyId = ev.id
      const resolve = replyId ? pendingConverse.get(replyId) : undefined
      if (resolve && isConverseReply(ev)) {
        resolve({ intent: ev.intent, say: ev.say, task: ev.task })
      }
      if (replyId) pendingConverse.delete(replyId)
      return
    }
    win?.webContents.send('agent:event', ev)
  })

  sidecar.stderr.on('data', (d) => console.error('[sidecar]', d.toString().trimEnd()))
  sidecar.on('exit', (code) => {
    console.error('[sidecar] exited with code', code)
    win?.webContents.send('agent:event', {
      type: 'error',
      code: 'unknown',
      message: 'The agent process stopped unexpectedly.'
    })
  })
}

function sendToSidecar(cmd: object) {
  sidecar?.stdin.write(JSON.stringify(cmd) + '\n')
}

function createWindow() {
  win = new BrowserWindow({
    // Start collapsed: just the floating avatar. The chat panel (and the larger
    // window) appears when the user clicks Clara — see window:setExpanded.
    width: COLLAPSED.width,
    height: COLLAPSED.height,
    minWidth: 200,
    minHeight: 220,
    show: false,
    resizable: true,
    movable: true,
    // Avatar-only: transparent, frameless, floats above everything.
    transparent: true,
    frame: false,
    hasShadow: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.on('ready-to-show', () => win?.show())

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  loadEnv()

  // Allow the renderer's voice layer to use the microphone.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'media')
  })

  ipcMain.handle('agent:runTask', (_e, instruction: string, mode = 'hands-on') => {
    const id = randomUUID()
    sendToSidecar({ type: 'run_task', id, instruction, mode })
    return id
  })

  // Conversational turn: ask the sidecar for Clara's reply + task routing, and
  // resolve when the matching `reply` event comes back (or fail safe on timeout).
  ipcMain.handle('agent:converse', (_e, text: string, mode = 'hands-on'): Promise<ConverseReply> => {
    const id = randomUUID()
    return new Promise<ConverseReply>((resolve) => {
      const timer = setTimeout(() => {
        pendingConverse.delete(id)
        resolve({ intent: 'task', say: 'On it.', task: text })
      }, 20000)
      pendingConverse.set(id, (reply) => {
        clearTimeout(timer)
        resolve(reply)
      })
      sendToSidecar({ type: 'converse', id, text, mode })
    })
  })

  ipcMain.on('agent:cancel', (_e, id: string) => sendToSidecar({ type: 'cancel', id }))

  // Mint a short-lived Deepgram token for the renderer's voice layer. Tries an
  // ephemeral access token (best for distribution); falls back to the local key
  // when the Deepgram plan can't grant tokens — fine for a single-machine app.
  ipcMain.handle('deepgram:token', async (): Promise<{ token: string; mode: 'access' | 'key' } | null> => {
    const key = process.env.DEEPGRAM_API_KEY
    if (!key) return null
    try {
      const grant = await new DeepgramClient({ apiKey: key }).auth.v1.tokens.grant()
      return { token: grant.access_token, mode: 'access' }
    } catch {
      return { token: key, mode: 'key' }
    }
  })

  // Let the renderer pass clicks through transparent areas to the desktop.
  ipcMain.on('window:setIgnoreMouseEvents', (_e, ignore: boolean, opts?: { forward?: boolean }) => {
    win?.setIgnoreMouseEvents(ignore, opts)
  })

  // Grow/shrink the window when the chat opens/closes, keeping the avatar (top
  // centre) anchored in place so it doesn't jump on screen.
  ipcMain.on('window:setExpanded', (_e, expanded: boolean) => {
    if (!win) return
    const size = expanded ? EXPANDED : COLLAPSED
    const b = win.getBounds()
    const centreX = b.x + b.width / 2
    win.setBounds({
      x: Math.round(centreX - size.width / 2),
      y: b.y,
      width: size.width,
      height: size.height
    })
  })

  // Custom window dragging from the avatar (it can't use -webkit-app-region:drag
  // because we also need its click to toggle the chat). Drift-free: move relative
  // to where the drag began.
  ipcMain.on('window:dragStart', (_e, cursorX: number, cursorY: number) => {
    if (!win) return
    const [winX, winY] = win.getPosition()
    dragAnchor = { winX, winY, cursorX, cursorY }
  })
  ipcMain.on('window:dragMove', (_e, cursorX: number, cursorY: number) => {
    if (!win || !dragAnchor) return
    win.setPosition(
      Math.round(dragAnchor.winX + (cursorX - dragAnchor.cursorX)),
      Math.round(dragAnchor.winY + (cursorY - dragAnchor.cursorY))
    )
  })
  ipcMain.on('window:dragEnd', () => {
    dragAnchor = null
  })

  startSidecar()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  sidecar?.kill()
  if (process.platform !== 'darwin') app.quit()
})

app.on('quit', () => sidecar?.kill())
