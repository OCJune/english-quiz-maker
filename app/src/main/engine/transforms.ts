// Post-processing transforms. The engine does not support the two output
// variants the user needs (PRD requirements 4 and 5), so they are derived from
// the engine's own output here. C3 fixes an engine quirk found in S2.
//
// Validated against the S2 golden corpus: C1 9/9, C2 9/9, C3 9/9.

import { createHash } from 'node:crypto'

import { clozeBlankOrder, normalizeWhitespace, type ParsedOutput } from './ResultParser'

const RE_BLANK_REPLACE = /(\d+)\)(\s*_+)/g

// ---------------------------------------------------------------------------
// C1 — Scramble: multiple choice -> open-ended.
//
// The correct option holds the original word order, so joining it yields the
// answer sentence. Cross-checked against the source passage; a failure means the
// question should be regenerated rather than shipped.
// ---------------------------------------------------------------------------
export interface OpenEndedScramble {
  /** Body keeps the "( word / word / ... )" group; options are dropped. */
  body: string
  sentence: string
  /** The restored sentence was found verbatim in the source passage. */
  verified: boolean
}

export function toOpenEndedScramble(
  parsed: ParsedOutput,
  sourcePassage: string,
): OpenEndedScramble | { error: string } {
  if (parsed.answer.kind !== 'choice') return { error: 'scramble output had no choice answer' }
  const option = parsed.options[parsed.answer.choice - 1]
  if (option === undefined) return { error: `option ${parsed.answer.choice} is missing` }

  const sentence = normalizeWhitespace(
    option
      .split('/')
      .map((w) => w.trim())
      .filter(Boolean)
      .join(' '),
  )
  return {
    body: parsed.body,
    sentence,
    verified: normalizeWhitespace(sourcePassage).includes(sentence),
  }
}

// ---------------------------------------------------------------------------
// C2 — Cloze: drop the "Choose = ..." word bank.
// ---------------------------------------------------------------------------
export function stripClozeWordBank(parsed: ParsedOutput): ParsedOutput {
  return { ...parsed, wordBank: null }
}

// ---------------------------------------------------------------------------
// C3 — Cloze: the engine can number blanks out of reading order.
// Observed in 3 of 9 golden Cloze outputs, e.g. [1,2,3,13,4,...,14].
// Renumber the passage and the answer list together.
// ---------------------------------------------------------------------------
export interface RenumberedCloze {
  body: string
  words: { n: number; word: string }[]
  changed: boolean
  /** Blank numbers as the engine emitted them, when a change was needed. */
  originalOrder?: number[]
}

export function renumberCloze(parsed: ParsedOutput): RenumberedCloze | { error: string } {
  if (parsed.answer.kind !== 'wordList') return { error: 'cloze output had no word list answer' }
  const words = parsed.answer.words
  const order = clozeBlankOrder(parsed.body)

  if (!order.length) return { body: parsed.body, words, changed: false }
  if (order.every((n, i) => n === i + 1)) return { body: parsed.body, words, changed: false }

  const remap = new Map(order.map((oldN, idx) => [oldN, idx + 1]))
  const body = parsed.body.replace(
    RE_BLANK_REPLACE,
    (_, n: string, rest: string) => `${remap.get(Number(n)) ?? n})${rest}`,
  )
  const byOld = new Map(words.map((w) => [w.n, w.word]))
  return {
    body,
    words: order.map((oldN, idx) => ({ n: idx + 1, word: byOld.get(oldN) ?? '?' })),
    changed: true,
    originalOrder: order,
  }
}

// ---------------------------------------------------------------------------
// Duplicate detection. The engine varies its output well (S2: 12/12 distinct
// per type on one passage), but the fingerprint keeps a hard guarantee.
// It keys on what the engine actually altered, not on incidental formatting.
// ---------------------------------------------------------------------------
export function fingerprint(type: string, parsed: ParsedOutput): string {
  const marks: string[] = []

  // "( ... )" groups -- the altered sentences/words in most types.
  for (const m of parsed.body.matchAll(/\(([^()]{1,200})\)/g)) {
    const inner = normalizeWhitespace(m[1] ?? '')
    if (!inner) continue
    if (/^[A-E]$/.test(inner)) continue // Shuffle / Blank slot labels
    if (/^\d+$/.test(inner)) continue // inline position markers
    if (/^_+$/.test(inner)) continue // a redacted blank carries no information
    marks.push(inner)
  }

  // The answer says what the engine actually removed or reordered.
  switch (parsed.answer.kind) {
    case 'choice': {
      const correct = parsed.options[parsed.answer.choice - 1]
      if (correct) marks.push(normalizeWhitespace(correct))
      break
    }
    case 'sentence':
      marks.push(normalizeWhitespace(parsed.answer.sentence))
      break
    case 'wordList':
      marks.push(...parsed.answer.words.map((w) => w.word))
      break
  }

  // Types whose body is redacted (Multiple Choice, Blank, Cloze) leave no usable
  // textual marks -- there the blank POSITIONS are what identifies the target, so
  // the body itself has to go into the key. Same for Shuffle, where the item is
  // the presented paragraph order.
  if (!marks.length || /_{3,}/.test(parsed.body)) {
    marks.push(`body:${digest(normalizeWhitespace(parsed.body))}`)
  }

  return `${type}::${marks.sort().join('|')}`
}

const digest = (s: string): string => createHash('sha1').update(s).digest('hex').slice(0, 16)

// ---------------------------------------------------------------------------
// Passage normalisation. Text pasted out of HWP carries tabs, runs of spaces,
// non-breaking spaces and smart quotes (PRD E4).
// ---------------------------------------------------------------------------
export function normalizePassage(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[   ]/g, ' ')
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”‟]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/\t/g, ' ')
    .replace(/ {2,}/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Rough sentence count, used for the per-type minimum checks (PRD E1/E2). */
export function countSentences(passage: string): number {
  return passage.split(/(?<=[.!?])\s+(?=[A-Z"'(])/).filter((s) => s.trim().length > 0).length
}

/** Longest word count of any sentence — Scramble needs one with 5+ words. */
export function maxSentenceWords(passage: string): number {
  return passage
    .split(/(?<=[.!?])\s+(?=[A-Z"'(])/)
    .map((s) => s.trim().split(/\s+/).filter(Boolean).length)
    .reduce((a, b) => Math.max(a, b), 0)
}
