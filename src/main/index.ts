import { app, BrowserWindow, ipcMain, session } from 'electron'
import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import { createInterface } from 'readline'
import { randomUUID } from 'crypto'
import { join } from 'path'
import { DeepgramClient } from '@deepgram/sdk'

import { readFileSync } from 'fs'

let win: BrowserWindow | null = null
let sidecar: ChildProcessWithoutNullStreams | null = null

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

  // Each stdout line is one JSON event — forward it to the renderer.
  createInterface({ input: sidecar.stdout }).on('line', (raw) => {
    const line = raw.trim()
    if (!line) return
    try {
      win?.webContents.send('agent:event', JSON.parse(line))
    } catch {
      // stdout is JSON-only by contract; ignore anything else.
    }
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
    width: 360,
    height: 600,
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
