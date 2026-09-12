// Question planning — turns the user's configuration into an ordered list of
// types to generate. PRD §6.4.
//
// Two modes, both confirmed in the requirements interview (PRD D4):
//   random — give a total and let it spread evenly over the selected types
//   manual — state how many of each type you want
//
// Pure and deterministic given a random source, so it is testable without Electron.

import type { GenerateOptions, QuestionType } from './types'

export type PlanMode = 'random' | 'manual'

/** How the finished set is ordered on the page. */
export type Ordering = 'shuffled' | 'grouped'

export interface PlanConfig {
  mode: PlanMode
  /** Types in play. In manual mode a type with count 0 is simply not used. */
  selectedTypes: QuestionType[]
  /** random mode only. */
  totalCount: number
  /** manual mode only. */
  perTypeCounts: Partial<Record<QuestionType, number>>
  ordering: Ordering
}

export const DEFAULT_PLAN_CONFIG: PlanConfig = {
  mode: 'random',
  selectedTypes: [],
  totalCount: 8,
  perTypeCounts: {},
  ordering: 'shuffled',
}

export interface PlanResult {
  plan: QuestionType[]
  /** Reasons the plan is empty or smaller than asked for. */
  issues: string[]
}

export type RandomSource = () => number

function shuffle<T>(items: readonly T[], random: RandomSource): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

/**
 * @param unavailable types the passage cannot support, with the reason
 *        (e.g. Shuffle needs 4+ sentences) — PRD E1/E2/E13.
 */
export function buildPlan(
  config: PlanConfig,
  unavailable: ReadonlyMap<QuestionType, string> = new Map(),
  random: RandomSource = Math.random,
): PlanResult {
  const issues: string[] = []
  const usable = config.selectedTypes.filter((type) => {
    const reason = unavailable.get(type)
    if (reason) issues.push(`${type}: ${reason}`)
    return !reason
  })

  if (!usable.length) {
    issues.push('사용할 수 있는 유형이 없습니다')
    return { plan: [], issues }
  }

  const plan = config.mode === 'manual'
    ? buildManual(config, usable, issues)
    : buildRandom(config, usable, issues, random)

  return { plan: order(plan, config.ordering, usable, random), issues }
}

function buildManual(config: PlanConfig, usable: QuestionType[], issues: string[]): QuestionType[] {
  const plan: QuestionType[] = []
  for (const type of usable) {
    const count = config.perTypeCounts[type] ?? 0
    if (count < 0) {
      issues.push(`${type}: 문항 수는 0 이상이어야 합니다`)
      continue
    }
    for (let i = 0; i < count; i++) plan.push(type)
  }
  if (!plan.length) issues.push('유형별 문항 수가 모두 0 입니다')
  return plan
}

function buildRandom(
  config: PlanConfig,
  usable: QuestionType[],
  issues: string[],
  random: RandomSource,
): QuestionType[] {
  const total = Math.floor(config.totalCount)
  if (total < 1) {
    issues.push('총 문항 수는 1 이상이어야 합니다')
    return []
  }

  // Fewer questions than types: pick that many distinct types.
  if (total < usable.length) {
    issues.push(
      `문항 수(${total})가 선택한 유형 수(${usable.length})보다 적어 일부 유형은 출제되지 않습니다`,
    )
    return shuffle(usable, random).slice(0, total)
  }

  // Otherwise every selected type appears at least once, then spread the rest
  // evenly rather than by repeated random draw, so the distribution is flat.
  const plan = [...usable]
  const remaining = total - usable.length
  const perType = Math.floor(remaining / usable.length)
  for (const type of usable) for (let i = 0; i < perType; i++) plan.push(type)

  const leftover = remaining - perType * usable.length
  for (const type of shuffle(usable, random).slice(0, leftover)) plan.push(type)
  return plan
}

function order(
  plan: QuestionType[],
  ordering: Ordering,
  usable: QuestionType[],
  random: RandomSource,
): QuestionType[] {
  if (ordering === 'shuffled') return shuffle(plan, random)
  // grouped: keep the user's type order, all of one type together
  const rank = new Map(usable.map((type, index) => [type, index]))
  return [...plan].sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0))
}

/** Counts per type, for showing the composition before generating. */
export function planSummary(plan: QuestionType[]): { type: QuestionType; count: number }[] {
  const counts = new Map<QuestionType, number>()
  for (const type of plan) counts.set(type, (counts.get(type) ?? 0) + 1)
  return [...counts.entries()].map(([type, count]) => ({ type, count }))
}

// ---------------------------------------------------------------------------
// Presets and session — persisted so school-specific setups survive restarts
// and moving the project folder between machines (PRD F1/F2).
// ---------------------------------------------------------------------------

export interface GenerationConfig {
  plan: PlanConfig
  options: GenerateOptions
}

export interface Preset {
  name: string
  updatedAt: string
  config: GenerationConfig
}

export interface SessionState {
  title: string
  subtitle: string
  passage: string
  config: GenerationConfig
  savedAt: string
}
