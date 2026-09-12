// Planning tests — the two modes the requirements interview settled on (PRD D4)
// and the per-type minimum checks (PRD E1/E2/E13).

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_PLAN_CONFIG,
  buildPlan,
  planSummary,
  type PlanConfig,
} from '../src/shared/plan'
import { QUESTION_TYPES, type QuestionType } from '../src/shared/types'

/** Deterministic source so the assertions are stable. */
function seeded(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

const config = (over: Partial<PlanConfig> = {}): PlanConfig => ({
  ...DEFAULT_PLAN_CONFIG,
  selectedTypes: [...QUESTION_TYPES],
  ...over,
})

const countOf = (plan: QuestionType[], type: QuestionType): number =>
  plan.filter((t) => t === type).length

describe('random mode', () => {
  it('produces exactly the requested number of questions', () => {
    for (const total of [1, 5, 11, 12, 30, 47]) {
      const { plan } = buildPlan(config({ totalCount: total }), new Map(), seeded(total))
      expect(plan, `total ${total}`).toHaveLength(total)
    }
  })

  it('gives every selected type at least one question when there is room', () => {
    const { plan } = buildPlan(config({ totalCount: 11 }), new Map(), seeded(7))
    for (const type of QUESTION_TYPES) expect(countOf(plan, type), type).toBeGreaterThanOrEqual(1)
  })

  it('spreads the remainder evenly instead of clustering', () => {
    // 30 over 11 types: 2 each, then 8 types get a third.
    const { plan } = buildPlan(config({ totalCount: 30 }), new Map(), seeded(3))
    const counts = QUESTION_TYPES.map((t) => countOf(plan, t))
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1)
  })

  it('picks distinct types and warns when there are fewer questions than types', () => {
    const { plan, issues } = buildPlan(config({ totalCount: 4 }), new Map(), seeded(9))
    expect(plan).toHaveLength(4)
    expect(new Set(plan).size).toBe(4)
    expect(issues.join(' ')).toContain('선택한 유형 수')
  })

  it('rejects a zero or negative total', () => {
    const { plan, issues } = buildPlan(config({ totalCount: 0 }))
    expect(plan).toEqual([])
    expect(issues.join(' ')).toContain('1 이상')
  })
})

describe('manual mode', () => {
  it('produces exactly the counts asked for', () => {
    const { plan } = buildPlan(
      config({
        mode: 'manual',
        selectedTypes: ['Cloze', 'Scramble', 'Blank'],
        perTypeCounts: { Cloze: 3, Scramble: 2, Blank: 0 },
      }),
      new Map(),
      seeded(1),
    )
    expect(plan).toHaveLength(5)
    expect(countOf(plan, 'Cloze')).toBe(3)
    expect(countOf(plan, 'Scramble')).toBe(2)
    expect(countOf(plan, 'Blank')).toBe(0)
  })

  it('ignores counts for types that are not selected', () => {
    const { plan } = buildPlan(
      config({ mode: 'manual', selectedTypes: ['Cloze'], perTypeCounts: { Cloze: 2, Blank: 5 } }),
      new Map(),
      seeded(1),
    )
    expect(plan).toEqual(['Cloze', 'Cloze'])
  })

  it('reports when every count is zero', () => {
    const { plan, issues } = buildPlan(
      config({ mode: 'manual', selectedTypes: ['Cloze'], perTypeCounts: { Cloze: 0 } }),
    )
    expect(plan).toEqual([])
    expect(issues.join(' ')).toContain('모두 0')
  })
})

describe('unavailable types', () => {
  it('drops a type the passage cannot support and says why', () => {
    const unavailable = new Map<QuestionType, string>([['Shuffle', '문장 4개 이상 필요']])
    const { plan, issues } = buildPlan(
      config({ totalCount: 10 }),
      unavailable,
      seeded(5),
    )
    expect(countOf(plan, 'Shuffle')).toBe(0)
    expect(plan).toHaveLength(10)
    expect(issues.join(' ')).toContain('문장 4개 이상 필요')
  })

  it('returns nothing when no type survives', () => {
    const unavailable = new Map<QuestionType, string>(
      QUESTION_TYPES.map((t) => [t, '지문이 너무 짧습니다']),
    )
    const { plan, issues } = buildPlan(config({ totalCount: 5 }), unavailable)
    expect(plan).toEqual([])
    expect(issues.join(' ')).toContain('사용할 수 있는 유형이 없습니다')
  })
})

describe('ordering', () => {
  const manual = config({
    mode: 'manual',
    selectedTypes: ['Cloze', 'Scramble', 'Blank'],
    perTypeCounts: { Cloze: 2, Scramble: 2, Blank: 2 },
  })

  it('grouped keeps each type together in the selected order', () => {
    const { plan } = buildPlan({ ...manual, ordering: 'grouped' }, new Map(), seeded(2))
    expect(plan).toEqual(['Cloze', 'Cloze', 'Scramble', 'Scramble', 'Blank', 'Blank'])
  })

  it('shuffled keeps the same multiset but changes the order', () => {
    const grouped = buildPlan({ ...manual, ordering: 'grouped' }, new Map(), seeded(2)).plan
    const shuffled = buildPlan({ ...manual, ordering: 'shuffled' }, new Map(), seeded(2)).plan
    expect([...shuffled].sort()).toEqual([...grouped].sort())
    expect(shuffled).not.toEqual(grouped)
  })
})

describe('planSummary', () => {
  it('counts each type once', () => {
    const summary = planSummary(['Cloze', 'Blank', 'Cloze'])
    expect(summary).toEqual(
      expect.arrayContaining([
        { type: 'Cloze', count: 2 },
        { type: 'Blank', count: 1 },
      ]),
    )
    expect(summary).toHaveLength(2)
  })
})
