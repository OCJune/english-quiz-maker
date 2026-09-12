// Per-question editing (PRD D2/D3). Numbering is derived, so every operation
// must leave the list numbered 1..N — otherwise question headers and the answer
// sheet drift apart.

import { describe, expect, it } from 'vitest'

import {
  fingerprintsOf,
  moveQuestion,
  pageOf,
  removeQuestion,
  renumber,
  replaceQuestion,
  toEdit,
  updateQuestion,
  validateEdit,
} from '../src/shared/document'
import type { Question, QuestionType } from '../src/shared/types'

function q(n: number, type: QuestionType = 'Blank', id = `q${n}`): Question {
  return {
    id,
    number: n,
    type,
    body: `body ${n}`,
    answer: { kind: 'choice', choice: 1 },
    meta: {
      appliedDifficulty: 'Hard',
      appliedOptionCount: 5,
      attempts: 1,
      ms: 5,
      targetFingerprint: `${type}::${id}`,
    },
    warnings: [],
  }
}

const list = (n: number): Question[] => Array.from({ length: n }, (_, i) => q(i + 1))
const numbers = (qs: Question[]): number[] => qs.map((x) => x.number)
const ids = (qs: Question[]): string[] => qs.map((x) => x.id)

describe('renumber', () => {
  it('numbers 1..N in place order', () => {
    const scrambled = [q(7, 'Blank', 'a'), q(2, 'Cloze', 'b'), q(5, 'Scramble', 'c')]
    expect(numbers(renumber(scrambled))).toEqual([1, 2, 3])
  })

  it('keeps object identity when a number is already correct', () => {
    const original = list(3)
    const result = renumber(original)
    expect(result[0]).toBe(original[0])
  })

  it('handles an empty list', () => {
    expect(renumber([])).toEqual([])
  })
})

describe('removeQuestion', () => {
  it('drops the question and closes the numbering gap', () => {
    const result = removeQuestion(list(5), 'q3')
    expect(ids(result)).toEqual(['q1', 'q2', 'q4', 'q5'])
    expect(numbers(result)).toEqual([1, 2, 3, 4])
  })

  it('leaves the list alone for an unknown id', () => {
    expect(ids(removeQuestion(list(3), 'nope'))).toEqual(['q1', 'q2', 'q3'])
  })

  it('can empty the list', () => {
    expect(removeQuestion([q(1)], 'q1')).toEqual([])
  })
})

describe('moveQuestion', () => {
  it('moves up and renumbers', () => {
    const result = moveQuestion(list(4), 'q3', -1)
    expect(ids(result)).toEqual(['q1', 'q3', 'q2', 'q4'])
    expect(numbers(result)).toEqual([1, 2, 3, 4])
  })

  it('moves down and renumbers', () => {
    const result = moveQuestion(list(4), 'q2', 1)
    expect(ids(result)).toEqual(['q1', 'q3', 'q2', 'q4'])
  })

  it('clamps at the ends instead of wrapping', () => {
    expect(ids(moveQuestion(list(3), 'q1', -1))).toEqual(['q1', 'q2', 'q3'])
    expect(ids(moveQuestion(list(3), 'q3', 1))).toEqual(['q1', 'q2', 'q3'])
  })

  it('supports multi-step moves', () => {
    expect(ids(moveQuestion(list(5), 'q5', -3))).toEqual(['q1', 'q5', 'q2', 'q3', 'q4'])
  })

  it('is a no-op for delta 0 or an unknown id', () => {
    expect(ids(moveQuestion(list(3), 'q2', 0))).toEqual(['q1', 'q2', 'q3'])
    expect(ids(moveQuestion(list(3), 'nope', 1))).toEqual(['q1', 'q2', 'q3'])
  })

  it('does not mutate the input', () => {
    const original = list(3)
    moveQuestion(original, 'q1', 2)
    expect(ids(original)).toEqual(['q1', 'q2', 'q3'])
  })
})

describe('replaceQuestion', () => {
  it('swaps in the replacement at the same position and renumbers it', () => {
    const result = replaceQuestion(list(3), 'q2', q(99, 'Cloze', 'new'))
    expect(ids(result)).toEqual(['q1', 'new', 'q3'])
    expect(numbers(result)).toEqual([1, 2, 3])
    expect(result[1]?.type).toBe('Cloze')
  })

  it('leaves the list alone for an unknown id', () => {
    expect(ids(replaceQuestion(list(2), 'nope', q(1, 'Cloze', 'new')))).toEqual(['q1', 'q2'])
  })
})

describe('fingerprintsOf', () => {
  it('collects every fingerprint', () => {
    expect(fingerprintsOf(list(3))).toEqual(['Blank::q1', 'Blank::q2', 'Blank::q3'])
  })

  it('excludes the question being replaced, so it may reuse its own target', () => {
    expect(fingerprintsOf(list(3), 'q2')).toEqual(['Blank::q1', 'Blank::q3'])
  })
})

describe('pageOf', () => {
  it('places two questions per page', () => {
    expect([1, 2, 3, 4, 5].map((n) => pageOf(q(n)))).toEqual([1, 1, 2, 2, 3])
  })
})

describe('updateQuestion — hand editing', () => {
  const cloze = (): Question => ({
    ...q(1, 'Cloze'),
    body: 'A 1) _______ and a 2) _______ here.',
    wordBank: ['animal', 'agreed'],
    answer: { kind: 'wordList', words: [{ n: 1, word: 'animal' }, { n: 2, word: 'agreed' }] },
  })

  it('applies the edit and marks the question as edited', () => {
    const result = updateQuestion(list(3), 'q2', {
      body: 'rewritten body',
      options: ['a', 'b'],
      answer: { kind: 'choice', choice: 2 },
    })
    expect(result[1]?.body).toBe('rewritten body')
    expect(result[1]?.options).toEqual(['a', 'b'])
    expect(result[1]?.meta.edited).toBe(true)
    expect(numbers(result)).toEqual([1, 2, 3])
  })

  it('leaves the other questions untouched', () => {
    const original = list(3)
    const result = updateQuestion(original, 'q2', {
      body: 'x',
      answer: { kind: 'choice', choice: 1 },
    })
    expect(result[0]).toBe(original[0])
    expect(result[2]).toBe(original[2])
  })

  it('drops empty option and word-bank lists so renderers take the plain path', () => {
    const result = updateQuestion([cloze()], 'q1', {
      body: 'plain body',
      options: [],
      wordBank: [],
      answer: { kind: 'sentence', sentence: 'answer' },
    })
    expect(result[0]?.options).toBeUndefined()
    expect(result[0]?.wordBank).toBeUndefined()
  })

  it('is a no-op for an unknown id', () => {
    const original = list(2)
    const result = updateQuestion(original, 'nope', {
      body: 'x',
      answer: { kind: 'choice', choice: 1 },
    })
    expect(ids(result)).toEqual(ids(original))
    expect(result[0]?.meta.edited).toBeUndefined()
  })

  it('round-trips through toEdit without changing anything', () => {
    const before = cloze()
    const result = updateQuestion([before], 'q1', toEdit(before))
    expect(result[0]?.body).toBe(before.body)
    expect(result[0]?.wordBank).toEqual(before.wordBank)
    expect(result[0]?.answer).toEqual(before.answer)
  })

  it('toEdit copies nested answer words rather than sharing them', () => {
    const before = cloze()
    const edit = toEdit(before)
    if (edit.answer.kind === 'wordList') edit.answer.words[0]!.word = 'changed'
    expect((before.answer as { words: { word: string }[] }).words[0]?.word).toBe('animal')
  })
})

describe('validateEdit', () => {
  const base = { body: 'some body text' }

  it('accepts a well-formed choice question', () => {
    expect(
      validateEdit({ ...base, options: ['a', 'b', 'c'], answer: { kind: 'choice', choice: 2 } }),
    ).toEqual([])
  })

  it('rejects an empty body', () => {
    expect(validateEdit({ body: '   ', answer: { kind: 'choice', choice: 1 } })).toContain(
      '본문이 비어 있습니다',
    )
  })

  it('rejects a choice outside the option range', () => {
    const issues = validateEdit({
      ...base,
      options: ['a', 'b'],
      answer: { kind: 'choice', choice: 5 },
    })
    expect(issues.join(' ')).toContain('선지 수(2)')
  })

  it('rejects a blank option', () => {
    expect(
      validateEdit({ ...base, options: ['a', ' '], answer: { kind: 'choice', choice: 1 } }),
    ).toContain('빈 선지가 있습니다')
  })

  it('rejects an empty answer sentence', () => {
    expect(validateEdit({ ...base, answer: { kind: 'sentence', sentence: '  ' } })).toContain(
      '정답 문장이 비어 있습니다',
    )
  })

  it('flags a Cloze whose blank count and answer count disagree', () => {
    const issues = validateEdit({
      body: 'a 1) _______ b 2) _______ c 3) _______',
      answer: { kind: 'wordList', words: [{ n: 1, word: 'x' }, { n: 2, word: 'y' }] },
    })
    expect(issues.join(' ')).toContain('빈칸 3개')
  })

  it('accepts a Cloze whose counts match', () => {
    expect(
      validateEdit({
        body: 'a 1) _______ b 2) _______',
        answer: { kind: 'wordList', words: [{ n: 1, word: 'x' }, { n: 2, word: 'y' }] },
      }),
    ).toEqual([])
  })
})
