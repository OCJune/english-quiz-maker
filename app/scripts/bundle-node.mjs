// Bundles the Node-side code (Electron main + the two preloads) with esbuild.
//
// Main and preload need no HMR, CSS or JSX, so esbuild is the right tool and it
// keeps Vite confined to the renderer. That matters here: on this machine two
// concurrent Vite processes abort with 0xC0000005, which is what broke the dev
// loop when the renderer dev server and a Vite main build overlapped.

import * as esbuild from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
export const root = resolve(here, '..')

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  logLevel: 'info',
  // Only Electron and Node builtins come from the runtime. Everything else is
  // bundled in: the packaged app ships `out/` without node_modules, so a runtime
  // require() of an npm package would fail there (it did — "Cannot find module
  // 'docx'" — and only showed up when testing the packaged build).
  external: ['electron'],
  alias: { '@shared': resolve(root, 'src/shared') },
}

/** @type {esbuild.BuildOptions[]} */
export const configs = [
  {
    ...shared,
    entryPoints: { index: resolve(root, 'src/main/index.ts') },
    outdir: resolve(root, 'out/main'),
  },
  {
    ...shared,
    entryPoints: {
      // App window: contextIsolation true, exposes the IPC surface.
      index: resolve(root, 'src/preload/index.ts'),
      // Hidden engine window: contextIsolation false, traps dialogs.
      engine: resolve(root, 'src/preload/engine.ts'),
    },
    outdir: resolve(root, 'out/preload'),
  },
]

export async function bundleOnce() {
  await Promise.all(configs.map((config) => esbuild.build(config)))
}

/** Returns the esbuild contexts so the caller can dispose them. */
export async function bundleWatch(onRebuild) {
  const contexts = await Promise.all(
    configs.map(async (config) => {
      const ctx = await esbuild.context({
        ...config,
        plugins: [
          {
            name: 'notify',
            setup(build) {
              build.onEnd((result) => onRebuild?.(result))
            },
          },
        ],
      })
      await ctx.watch()
      return ctx
    }),
  )
  return contexts
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await bundleOnce()
}
