// Store tests — presets and session persistence (PRD F1/F2).
// Each test gets its own temp root, so real settings are never touched.

import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { Store } from '../src/main/store/Store'
import { DEFAULT_PLAN_CONFIG, type GenerationConfig } from '../src/shared/plan'
import { DEFAULT_GENERATE_OPTIONS } from '../src/shared/types'

const config = (over: Partial<GenerationConfig> = {}): GenerationConfig => ({
  plan: { ...DEFAULT_PLAN_CONFIG, selectedTypes: ['Cloze', 'Blank'], totalCount: 6 },
  options: DEFAULT_GENERATE_OPTIONS,
  ...over,
})

let root: string
let store: Store

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ariaforge-store-'))
  store = new Store(root)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('session', () => {
  it('returns null before anything is saved', async () => {
    expect(await store.loadSession()).toBeNull()
  })

  it('round-trips a session and stamps it', async () => {
    await store.saveSession({
      title: '미래엔(김) 1과 본문',
      subtitle: 'Section 1, 2',
      passage: 'Some passage.',
      config: config(),
    })
    const loaded = await store.loadSession()
    expect(loaded?.title).toBe('미래엔(김) 1과 본문')
    expect(loaded?.subtitle).toBe('Section 1, 2')
    expect(loaded?.config.plan.totalCount).toBe(6)
    expect(Date.parse(loaded?.savedAt ?? '')).not.toBeNaN()
  })

  it('overwrites the previous session', async () => {
    await store.saveSession({ title: 'a', subtitle: '', passage: 'x', config: config() })
    await store.saveSession({ title: 'b', subtitle: '', passage: 'y', config: config() })
    expect((await store.loadSession())?.title).toBe('b')
  })

  it('surfaces a corrupt file instead of silently resetting settings', async () => {
    await mkdir(join(root, '.ariaforge'), { recursive: true })
    await writeFile(join(root, '.ariaforge', 'session.json'), '{ not json', 'utf8')
    await expect(store.loadSession()).rejects.toThrow(/읽을 수 없습니다/)
  })
})

describe('presets', () => {
  it('starts empty', async () => {
    expect(await store.listPresets()).toEqual([])
  })

  it('saves and lists a preset', async () => {
    const saved = await store.savePreset({ name: '정의여고1', config: config() })
    expect(saved.name).toBe('정의여고1')
    expect(Date.parse(saved.updatedAt)).not.toBeNaN()

    const list = await store.listPresets()
    expect(list).toHaveLength(1)
    expect(list[0]?.config.plan.selectedTypes).toEqual(['Cloze', 'Blank'])
  })

  it('sorts presets by name', async () => {
    await store.savePreset({ name: '효문고1', config: config() })
    await store.savePreset({ name: '정의여고1', config: config() })
    await store.savePreset({ name: '창동고1', config: config() })
    expect((await store.listPresets()).map((p) => p.name)).toEqual([
      '정의여고1',
      '창동고1',
      '효문고1',
    ])
  })

  it('replaces a preset saved under the same name', async () => {
    await store.savePreset({ name: '정의여고1', config: config() })
    await store.savePreset({
      name: '정의여고1',
      config: config({ plan: { ...DEFAULT_PLAN_CONFIG, totalCount: 30, selectedTypes: ['Cloze'] } }),
    })
    const list = await store.listPresets()
    expect(list).toHaveLength(1)
    expect(list[0]?.config.plan.totalCount).toBe(30)
  })

  it('deletes a preset, and deleting a missing one is not an error', async () => {
    await store.savePreset({ name: '정의여고1', config: config() })
    await store.deletePreset('정의여고1')
    expect(await store.listPresets()).toEqual([])
    await expect(store.deletePreset('정의여고1')).resolves.toBeUndefined()
  })

  it('rejects an empty name rather than writing a stray file', async () => {
    await expect(store.savePreset({ name: '   ', config: config() })).rejects.toThrow(/이름/)
  })

  it('keeps path separators out of file names', async () => {
    await store.savePreset({ name: 'a/b:c', config: config() })
    expect(existsSync(join(root, '.ariaforge', 'presets', 'a_b_c.json'))).toBe(true)
    expect((await store.listPresets())[0]?.name).toBe('a/b:c')
  })
})

describe('location', () => {
  it('points inside the given root so settings travel with the project', () => {
    expect(store.location).toBe(join(root, '.ariaforge'))
  })
})
