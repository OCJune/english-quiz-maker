// Dev loop: renderer on the Vite dev server, main/preload on esbuild watch,
// Electron relaunched whenever the Node side rebuilds.
//
// esbuild (not Vite) handles main/preload so that only one Vite process is ever
// live -- two concurrent Vite processes abort with 0xC0000005 on this machine.

import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { bundleWatch, configs, root } from './bundle-node.mjs'

const RENDERER_URL = 'http://localhost:5174'
const viteBin = join(root, 'node_modules', 'vite', 'bin', 'vite.js')
const electronBin = join(root, 'node_modules', 'electron', 'cli.js')
const log = (msg) => process.stdout.write(`[dev] ${msg}\n`)

let electron = null
let shuttingDown = false
let restartTimer = null
// Each esbuild context reports its initial build; only rebuilds after that
// should relaunch Electron.
let initialBuildsSeen = 0

/**
 * child.kill() does not reach grandchildren on Windows, and Electron and Vite
 * both spawn their own trees -- so kill the whole tree by pid.
 */
function killTree(child) {
  if (!child?.pid) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { stdio: 'ignore' })
  } else {
    child.kill('SIGTERM')
  }
}

function stopElectron() {
  if (!electron) return
  const child = electron
  electron = null
  child.removeAllListeners('exit')
  killTree(child)
}

function startElectron() {
  electron = spawn(process.execPath, [electronBin, join(root, 'out', 'main', 'index.js')], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RENDERER_URL: RENDERER_URL, NODE_ENV: 'development' },
  })
  electron.on('exit', (code) => {
    if (shuttingDown) return
    electron = null
    log(`Electron exited (${code}); edit a file under src/main or src/preload to relaunch`)
  })
}

/** Debounced: the two esbuild contexts finish a rebuild independently. */
function scheduleRestart() {
  clearTimeout(restartTimer)
  restartTimer = setTimeout(() => {
    log('main/preload rebuilt — relaunching Electron')
    stopElectron()
    startElectron()
  }, 150)
}

const contexts = await bundleWatch((result) => {
  if (result.errors.length) {
    log(`build error (${result.errors.length}) — Electron left running`)
    return
  }
  if (initialBuildsSeen < configs.length) {
    initialBuildsSeen++
    return
  }
  scheduleRestart()
})

const renderer = spawn(process.execPath, [viteBin, '--config', 'vite.renderer.config.ts'], {
  cwd: root,
  stdio: 'inherit',
})
renderer.on('exit', (code) => {
  if (!shuttingDown) {
    log(`renderer dev server exited (${code}); stopping`)
    void shutdown(1)
  }
})

log(`renderer: ${RENDERER_URL}`)
startElectron()

async function shutdown(code = 0) {
  shuttingDown = true
  clearTimeout(restartTimer)
  stopElectron()
  renderer.removeAllListeners('exit')
  killTree(renderer)
  await Promise.all(contexts.map((ctx) => ctx.dispose()))
  process.exit(code)
}
process.on('SIGINT', () => void shutdown(0))
process.on('SIGTERM', () => void shutdown(0))
