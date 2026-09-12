// ResultParser — raw Text Area 3 output -> structured data.
//
// Spec derived from the S2 golden corpus (11 types x 3 difficulties x 3 option
// counts = 99 files, all parsed with zero warnings). Canonical shape:
//
//   <blank>
//   <Type label>                       e.g. "Cloze"
//   <blank>
//   <question body>                    one or more lines
//   [<blank> "Choose  =  w  w  ..."]   Cloze only
//   [<blank> "(1)  ..." .. "(N)  ..."] option-bearing types only
//   <blank>
//   "Answer  =  (N)"                   choice types
//   "Answer  =  " + blank + "1) w"…    wordList types (Cloze)
//   <blank>
//   <6-line attribution footer>        always appended
//
// "Answer  =  " (two spaces either side of the equals) is the canonical
// question/answer delimiter.

import { ATTRIBUTION } from './contract'
import type { Answer, QuestionType } from '@shared/types'

const RE_ANSWER = /^Answer\s*=\s*(.*)$/
const RE_CHOOSE = /^Choose\s*=\s*(.*)$/
const RE_OPTION = /^\((\d+)\)\s+(.*)$/
const RE_WORD_ANSWER = /^(\d+)\)\s*(.*)$/
const RE_CHOICE = /^\((\d+)\)$/

/** Matches a Cloze blank, e.g. "3) _______________". */
const RE_BLANK = /(\d+)\)(\s*_+)/g

export interface ParsedOutput {
  label: string
  body: string
  options: string[]
  /** Cloze "Choose = ..." word bank, null for every other type. */
  wordBank: string[] | null
  answer: Answer
  /** The attribution footer as found, for the credits screen. */
  footer: string[] | null
  warnings: string[]
}

export class ParseError extends Error {
  constructor(
    message: string,
    readonly raw: string,
    readonly warnings: string[] = [],
  ) {
    super(message)
    this.name = 'ParseError'
  }
}

/**
 * True when the engine produced a real question rather than just the type label.
 * A gated generation returns only "\n<Type>\n\n" — that means the one-shot token
 * was not armed and the caller should retry, not fail.
 */
export function isRealOutput(raw: string): boolean {
  return stripLabel(raw).body.trim().length > 100
}

function stripLabel(raw: string): { label: string | null; body: string } {
  const m = raw.match(/^\s*([^\n]+)\n+/)
  return m?.[1] !== undefined
    ? { label: m[1].trim(), body: raw.slice(m[0].length) }
    : { label: null, body: raw }
}

export function parse(raw: string, expectedType?: QuestionType): ParsedOutput {
  const warnings: string[] = []
  const lines = raw.replace(/\r\n/g, '\n').split('\n')

  // --- label ---------------------------------------------------------------
  let i = 0
  while (i < lines.length && !lines[i]?.trim()) i++
  const label = lines[i]?.trim() ?? ''
  if (!label) throw new ParseError('no label line', raw, warnings)
  if (expectedType && label !== expectedType) {
    warnings.push(`label "${label}" does not match requested "${expectedType}"`)
  }
  i++

  // --- attribution footer --------------------------------------------------
  let footerAt = lines.findIndex((l) => l.trim() === ATTRIBUTION[0])
  let footer: string[] | null = null
  if (footerAt >= 0) {
    footer = lines
      .slice(footerAt)
      .map((l) => l.trim())
      .filter(Boolean)
    if (footer.join('|') !== ATTRIBUTION.join('|')) {
      warnings.push('attribution footer differs from the known 6 lines')
    }
  } else {
    warnings.push('attribution footer not found')
    footerAt = lines.length
  }
  const content = lines.slice(i, footerAt)

  // --- locate markers ------------------------------------------------------
  let answerAt = -1
  let chooseAt = -1
  let firstOptionAt = -1
  for (let k = 0; k < content.length; k++) {
    const t = content[k]?.trim() ?? ''
    if (answerAt < 0 && RE_ANSWER.test(t)) answerAt = k
    if (chooseAt < 0 && RE_CHOOSE.test(t)) chooseAt = k
    if (firstOptionAt < 0 && answerAt < 0 && RE_OPTION.test(t)) firstOptionAt = k
  }
  if (answerAt < 0) throw new ParseError('no "Answer =" line', raw, warnings)

  // --- options -------------------------------------------------------------
  const options: string[] = []
  if (firstOptionAt >= 0) {
    const numbers: number[] = []
    for (let k = firstOptionAt; k < answerAt; k++) {
      const line = content[k]?.trim() ?? ''
      const m = line.match(RE_OPTION)
      if (m?.[1] !== undefined && m[2] !== undefined) {
        numbers.push(Number(m[1]))
        options.push(m[2].trim())
      } else if (line) {
        warnings.push(`unparsed line in option block: ${JSON.stringify(line.slice(0, 60))}`)
      }
    }
    if (numbers.some((n, idx) => n !== idx + 1)) {
      warnings.push(`option numbers are not 1..N: ${numbers.join(',')}`)
    }
  }

  // --- Cloze word bank -----------------------------------------------------
  let wordBank: string[] | null = null
  if (chooseAt >= 0) {
    const m = content[chooseAt]?.trim().match(RE_CHOOSE)
    wordBank = (m?.[1] ?? '').split(/\s+/).filter(Boolean)
  }

  // --- body ----------------------------------------------------------------
  const bounds = [firstOptionAt, chooseAt, answerAt].filter((v) => v >= 0)
  const body = content
    .slice(0, Math.min(...bounds))
    .join('\n')
    .replace(/^\n+|\n+$/g, '')

  // --- answer --------------------------------------------------------------
  const inline = (content[answerAt]?.trim().match(RE_ANSWER)?.[1] ?? '').trim()
  let answer: Answer
  const choiceMatch = inline.match(RE_CHOICE)
  if (choiceMatch?.[1] !== undefined) {
    const choice = Number(choiceMatch[1])
    answer = { kind: 'choice', choice }
    if (options.length && (choice < 1 || choice > options.length)) {
      warnings.push(`answer (${choice}) is outside 1..${options.length}`)
    }
  } else if (!inline) {
    const words: { n: number; word: string }[] = []
    for (let k = answerAt + 1; k < content.length; k++) {
      const t = content[k]?.trim() ?? ''
      if (!t) continue
      const m = t.match(RE_WORD_ANSWER)
      if (m?.[1] !== undefined && m[2] !== undefined) words.push({ n: Number(m[1]), word: m[2].trim() })
      else warnings.push(`unparsed answer line: ${JSON.stringify(t.slice(0, 60))}`)
    }
    if (!words.length) throw new ParseError('empty "Answer =" with no word list', raw, warnings)
    answer = { kind: 'wordList', words }
  } else {
    answer = { kind: 'sentence', sentence: inline }
    warnings.push(`unexpected inline answer form: ${JSON.stringify(inline.slice(0, 60))}`)
  }

  return { label, body, options, wordBank, answer, footer, warnings }
}

/** Blank numbers in the order they appear in the passage. */
export function clozeBlankOrder(body: string): number[] {
  return [...body.matchAll(RE_BLANK)].map((m) => Number(m[1]))
}

export const normalizeWhitespace = (s: string): string => s.replace(/\s+/g, ' ').trim()
