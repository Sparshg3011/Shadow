import { app, BrowserWindow, ipcMain } from 'electron'
import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import { createInterface } from 'readline'
import { randomUUID } from 'crypto'
import { join } from 'path'

let win: BrowserWindow | null = null
let sidecar: ChildProcessWithoutNullStreams | null = null

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
  ipcMain.handle('agent:runTask', (_e, instruction: string) => {
    const id = randomUUID()
    sendToSidecar({ type: 'run_task', id, instruction })
    return id
  })
  ipcMain.on('agent:cancel', (_e, id: string) => sendToSidecar({ type: 'cancel', id }))

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
