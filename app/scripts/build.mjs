// Production build: esbuild for main/preload, Vite for the renderer.
//
// Only one Vite process ever runs. Two concurrent Vite processes abort with
// 0xC0000005 on this machine, which is why the renderer is built on its own and
// the Node side goes through esbuild (see scripts/bundle-node.mjs).

import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { bundleOnce, root } from './bundle-node.mjs'

const log = (msg) => process.stdout.write(`\n── ${msg} ──\n`)

log('bundling main + preload (esbuild)')
await bundleOnce()

log('building renderer (vite)')
await new Promise((res, rej) => {
  const child = spawn(
    process.execPath,
    [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', 'vite.renderer.config.ts'],
    { cwd: root, stdio: 'inherit' },
  )
  child.on('error', rej)
  child.on('exit', (code) => (code === 0 ? res() : rej(new Error(`renderer build failed (${code})`))))
})

process.stdout.write('\nall targets built\n')
