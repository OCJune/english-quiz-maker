// Locates bundled resources. app.getAppPath() differs between `electron-vite dev`,
// `electron out/main/index.js` and a packaged build, so search upward from the
// bundle instead of guessing one layout.

import { app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const MAX_LEVELS = 6

export function resolveResource(...segments: string[]): string {
  const tried: string[] = []

  // Packaged builds put extraResources straight into resourcesPath.
  const packaged = join(process.resourcesPath, ...segments)
  tried.push(packaged)
  if (existsSync(packaged)) return packaged

  // Dev / preview / direct run: walk up from the bundle looking for resources/.
  let dir = __dirname
  for (let level = 0; level < MAX_LEVELS; level++) {
    const candidate = join(dir, 'resources', ...segments)
    tried.push(candidate)
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  throw new Error(
    `bundled resource not found: ${segments.join('/')}\n  looked in:\n  ${tried.join('\n  ')}`,
  )
}

/**
 * Passage used by the startup self-test. Reconstructed from the reference PDF
 * (2026-2 중간 문제/정의여고1_..._1_2.pdf) so the check exercises the engine with
 * realistic input: 14 sentences, long enough to satisfy every type's minimum.
 */
export function selfTestPassage(): string {
  return readFileSync(resolveResource('fixtures', 'selftest-passage.txt'), 'utf8').trim()
}

/**
 * Where presets and the saved session go.
 *
 * A packaged app cannot write next to its own files — the bundle is read-only —
 * so it uses the per-user data directory. A dev checkout keeps them inside the
 * project folder, which is what makes settings survive carrying the folder to
 * the other laptop (PRD §2.1, F1/F2).
 *
 * `ARIAFORGE_DATA_DIR` overrides both, for a portable install on a USB stick.
 */
export function resolveDataRoot(): string {
  const override = process.env.ARIAFORGE_DATA_DIR
  if (override) return override
  if (app.isPackaged) return app.getPath('userData')

  let dir = __dirname
  for (let level = 0; level < MAX_LEVELS; level++) {
    if (existsSync(join(dir, 'package.json'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(`could not locate the app root (no package.json above ${__dirname})`)
}
