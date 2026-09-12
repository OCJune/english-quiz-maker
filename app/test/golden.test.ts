// Regression tests for the ported ResultParser and transforms, run against the
// 99-file golden corpus captured by spike S2. These are the numbers the spike
// established (parse 99/99, C1 9/9, C2 9/9, C3 9/9); if the port drifts, this fails.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { clozeBlankOrder, isRealOutput, parse } from '../src/main/engine/ResultParser'
import {
  countSentences,
  fingerprint,
  maxSentenceWords,
  normalizePassage,
  renumberCloze,
  stripClozeWordBank,
  toOpenEndedScramble,
} from '../src/main/engine/transforms'
import { QUESTION_TYPES, type QuestionType } from '../src/shared/types'

const SPIKE = join(__dirname, '..', '..', 'spike')
const GOLDEN = join(SPIKE, 'out', 'golden')
const PASSAGE_FILE = join(SPIKE, 'fixtures', 'passage.txt')

const haveCorpus = existsSync(GOLDEN) && existsSync(PASSAGE_FILE)
const passage = haveCorpus ? readFileSync(PASSAGE_FILE, 'utf8').trim() : ''

interface GoldenFile {
  type: QuestionType
  variant: string
  raw: string
}

function loadCorpus(): GoldenFile[] {
  const files: GoldenFile[] = []
  for (const dir of readdirSync(GOLDEN)) {
    const type = dir.replace(/-/g, ' ') as QuestionType
    for (const name of readdirSync(join(GOLDEN, dir))) {
      files.push({
        type,
        variant: name.replace('.txt', ''),
        raw: readFileSync(join(GOLDEN, dir, name), 'utf8'),
      })
    }
  }
  return files
}

describe.skipIf(!haveCorpus)('ResultParser against the S2 golden corpus', () => {
  const corpus = loadCorpus()

  it('has the full 99-file corpus (11 types x 3 difficulties x 3 option counts)', () => {
    expect(corpus).toHaveLength(99)
    expect(new Set(corpus.map((f) => f.type))).toEqual(new Set(QUESTION_TYPES))
  })

  it('parses every file with no warnings', () => {
    const problems: string[] = []
    for (const f of corpus) {
      try {
        const parsed = parse(f.raw, f.type)
        if (parsed.warnings.length) problems.push(`${f.type}/${f.variant}: ${parsed.warnings.join('; ')}`)
      } catch (e) {
        problems.push(`${f.type}/${f.variant}: threw ${(e as Error).message}`)
      }
    }
    expect(problems).toEqual([])
  })

  it('recognises every golden file as a real (non-gated) output', () => {
    expect(corpus.filter((f) => !isRealOutput(f.raw))).toEqual([])
  })

  it('treats a label-only output as gated, not as a question', () => {
    expect(isRealOutput('\nCloze\n\n')).toBe(false)
    expect(isRealOutput('\nScramble\n\n')).toBe(false)
  })

  it('strips the attribution footer from the body but keeps it available', () => {
    for (const f of corpus) {
      const parsed = parse(f.raw, f.type)
      expect(parsed.body).not.toContain('AriaEnglish.com')
      expect(parsed.footer).toHaveLength(6)
      expect(parsed.footer?.[0]).toBe('For Mass Production www.AriaEnglish.com')
    }
  })

  it('assigns the expected answer kind per type', () => {
    const kinds = new Map<QuestionType, Set<string>>()
    for (const f of corpus) {
      const set = kinds.get(f.type) ?? new Set()
      set.add(parse(f.raw, f.type).answer.kind)
      kinds.set(f.type, set)
    }
    expect([...(kinds.get('Cloze') ?? [])]).toEqual(['wordList'])
    for (const type of QUESTION_TYPES) {
      if (type === 'Cloze') continue
      expect([...(kinds.get(type) ?? [])], type).toEqual(['choice'])
    }
  })

  it('delivers exactly the requested option count for option-bearing types', () => {
    const withOptions: QuestionType[] = ['Scramble', 'Shuffle', 'Multiple Choice', 'Blank', 'Binary Word']
    const mismatches: string[] = []
    for (const f of corpus) {
      const requested = Number(f.variant.split('opt')[1])
      const parsed = parse(f.raw, f.type)
      const expected = withOptions.includes(f.type) ? requested : 0
      if (parsed.options.length !== expected) {
        mismatches.push(`${f.type}/${f.variant}: expected ${expected}, got ${parsed.options.length}`)
      }
    }
    expect(mismatches).toEqual([])
  })

  it('keeps the answer choice within the option range', () => {
    for (const f of corpus) {
      const parsed = parse(f.raw, f.type)
      if (parsed.answer.kind === 'choice' && parsed.options.length) {
        expect(parsed.answer.choice).toBeGreaterThanOrEqual(1)
        expect(parsed.answer.choice).toBeLessThanOrEqual(parsed.options.length)
      }
    }
  })
})

describe.skipIf(!haveCorpus)('C1 — open-ended Scramble', () => {
  const scrambles = loadCorpus().filter((f) => f.type === 'Scramble')

  it('recovers all 9 answer sentences verbatim from the source passage', () => {
    const failures: string[] = []
    for (const f of scrambles) {
      const transformed = toOpenEndedScramble(parse(f.raw, f.type), passage)
      if ('error' in transformed) failures.push(`${f.variant}: ${transformed.error}`)
      else if (!transformed.verified) failures.push(`${f.variant}: not verified — "${transformed.sentence}"`)
    }
    expect(scrambles).toHaveLength(9)
    expect(failures).toEqual([])
  })

  it('keeps the "( word / word / ... )" group in the body and drops the options', () => {
    for (const f of scrambles) {
      const parsed = parse(f.raw, f.type)
      const transformed = toOpenEndedScramble(parsed, passage)
      expect('error' in transformed).toBe(false)
      if ('error' in transformed) continue
      expect(transformed.body).toMatch(/\(\s*[^)]*\s\/\s[^)]*\)/)
      expect(transformed.sentence.split(' ').length).toBeGreaterThan(4)
    }
  })
})

describe.skipIf(!haveCorpus)('C2 — Cloze word bank', () => {
  const clozes = loadCorpus().filter((f) => f.type === 'Cloze')

  it('exposes a word bank whose size matches the blank count, and strips cleanly', () => {
    expect(clozes).toHaveLength(9)
    for (const f of clozes) {
      const parsed = parse(f.raw, f.type)
      const blanks = clozeBlankOrder(parsed.body)
      expect(parsed.wordBank?.length, f.variant).toBe(blanks.length)
      if (parsed.answer.kind === 'wordList') {
        expect(parsed.answer.words.length, f.variant).toBe(blanks.length)
      }
      const stripped = stripClozeWordBank(parsed)
      expect(stripped.wordBank).toBeNull()
      expect(stripped.body).not.toMatch(/Choose\s*=/)
    }
  })
})

describe.skipIf(!haveCorpus)('C3 — Cloze blank renumbering', () => {
  const clozes = loadCorpus().filter((f) => f.type === 'Cloze')

  it('puts every output into reading order with answers aligned', () => {
    let changed = 0
    for (const f of clozes) {
      const parsed = parse(f.raw, f.type)
      const result = renumberCloze(parsed)
      expect('error' in result, f.variant).toBe(false)
      if ('error' in result) continue
      if (result.changed) changed++
      expect(clozeBlankOrder(result.body), f.variant).toEqual(
        result.words.map((_, i) => i + 1),
      )
      expect(result.words.map((w) => w.n)).toEqual(result.words.map((_, i) => i + 1))
      expect(result.words.every((w) => w.word && w.word !== '?'), f.variant).toBe(true)
    }
    // S2 observed exactly 3 of 9 golden Cloze outputs numbered out of order.
    expect(changed).toBe(3)
  })

  it('leaves an already-ordered output untouched', () => {
    const ordered = clozes.find((f) => {
      const order = clozeBlankOrder(parse(f.raw, f.type).body)
      return order.length > 1 && order.every((n, i) => n === i + 1)
    })
    expect(ordered).toBeDefined()
    const parsed = parse(ordered!.raw, 'Cloze')
    const result = renumberCloze(parsed)
    expect('error' in result).toBe(false)
    if ('error' in result) return
    expect(result.changed).toBe(false)
    expect(result.body).toBe(parsed.body)
  })
})

describe.skipIf(!haveCorpus)('duplicate fingerprints', () => {
  it('distinguishes different questions of the same type', () => {
    const corpus = loadCorpus()
    for (const type of QUESTION_TYPES) {
      const prints = corpus
        .filter((f) => f.type === type)
        .map((f) => fingerprint(type, parse(f.raw, type)))
      // The 9 variants per type differ by difficulty/option count, so they must
      // not all collapse onto one fingerprint.
      expect(new Set(prints).size, type).toBeGreaterThan(1)
    }
  })

  it('is stable for the same parsed output', () => {
    const f = loadCorpus()[0]!
    const parsed = parse(f.raw, f.type)
    expect(fingerprint(f.type, parsed)).toBe(fingerprint(f.type, parse(f.raw, f.type)))
  })
})

describe('passage normalisation', () => {
  it('collapses HWP artefacts: tabs, runs of spaces, nbsp and smart quotes', () => {
    const messy = 'He said\t“hello”   and   left…'
    expect(normalizePassage(messy)).toBe('He said "hello" and left...')
  })

  it('normalises line endings and caps blank runs', () => {
    expect(normalizePassage('a\r\n\r\n\r\n\r\nb')).toBe('a\n\nb')
  })

  it('counts sentences and the longest sentence for the per-type minimum checks', () => {
    const text = 'One two three four five. Short. Another full sentence here with words.'
    expect(countSentences(text)).toBe(3)
    expect(maxSentenceWords(text)).toBeGreaterThanOrEqual(5)
  })
})
