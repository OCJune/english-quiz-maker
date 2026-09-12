// Presets and session state, persisted as JSON.
//
// Where the data lives is the caller's decision (see resolveDataRoot):
//   dev checkout — inside the project folder, so settings travel with it when the
//                  user carries the folder between their two laptops (PRD §2.1)
//   packaged app — the OS per-user data directory, because the bundle is read-only

import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { Preset, SessionState } from '@shared/plan'

const DATA_DIR_NAME = '.ariaforge'
const SESSION_FILE = 'session.json'
const PRESET_DIR = 'presets'
/** Preset names become file names, so keep them to something safe and readable. */
function presetFileName(name: string): string {
  const safe = name.trim().replace(/[\\/:*?"<>|]/g, '_')
  if (!safe) throw new Error('프리셋 이름이 비어 있습니다')
  return `${safe}.json`
}

export class Store {
  private readonly dataDir: string
  private readonly presetDir: string

  /**
   * @param root directory to put `.ariaforge/` in. In a dev checkout that is the
   *   project folder, so settings travel with it between machines; in a packaged
   *   app it must be a writable location, because the bundle is read-only.
   */
  constructor(root: string) {
    this.dataDir = join(root, DATA_DIR_NAME)
    this.presetDir = join(this.dataDir, PRESET_DIR)
  }

  private async ensureDirs(): Promise<void> {
    await mkdir(this.presetDir, { recursive: true })
  }

  private async readJson<T>(file: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(file, 'utf8')) as T
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      // A corrupt file should surface, not silently reset the user's settings.
      throw new Error(`${file} 을(를) 읽을 수 없습니다: ${(err as Error).message}`)
    }
  }

  private async writeJson(file: string, value: unknown): Promise<void> {
    await this.ensureDirs()
    await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  }

  // --- session ------------------------------------------------------------

  loadSession(): Promise<SessionState | null> {
    return this.readJson<SessionState>(join(this.dataDir, SESSION_FILE))
  }

  saveSession(state: Omit<SessionState, 'savedAt'>): Promise<void> {
    return this.writeJson(join(this.dataDir, SESSION_FILE), {
      ...state,
      savedAt: new Date().toISOString(),
    })
  }

  // --- presets ------------------------------------------------------------

  async listPresets(): Promise<Preset[]> {
    await this.ensureDirs()
    const files = (await readdir(this.presetDir)).filter((f) => f.endsWith('.json'))
    const presets: Preset[] = []
    for (const file of files) {
      const preset = await this.readJson<Preset>(join(this.presetDir, file))
      if (preset) presets.push(preset)
    }
    return presets.sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  }

  async savePreset(preset: Omit<Preset, 'updatedAt'>): Promise<Preset> {
    const stored: Preset = { ...preset, name: preset.name.trim(), updatedAt: new Date().toISOString() }
    await this.writeJson(join(this.presetDir, presetFileName(stored.name)), stored)
    return stored
  }

  async deletePreset(name: string): Promise<void> {
    await rm(join(this.presetDir, presetFileName(name)), { force: true })
  }

  /** Shown in the UI so the user knows where their settings live. */
  get location(): string {
    return this.dataDir
  }
}
