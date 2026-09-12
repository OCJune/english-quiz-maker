// Document model — the single source of truth shared by the engine bridge,
// the preview renderer and both exporters (PDF / DOCX).
// Deliberately engine-neutral so the generator can be swapped later (PRD §9.2-20).

export const QUESTION_TYPES = [
  // Context
  'Scramble',
  'Shuffle',
  'Missing Sentence',
  'Wrong Sentence',
  'Correct Sentence',
  // Vocabulary
  'Multiple Choice',
  'Blank',
  'Binary Word',
  'Wrong Word',
  'Correct Word',
  // General
  'Cloze',
] as const

export type QuestionType = (typeof QUESTION_TYPES)[number]

export const TYPE_GROUPS = {
  Context: ['Scramble', 'Shuffle', 'Missing Sentence', 'Wrong Sentence', 'Correct Sentence'],
  Vocabulary: ['Multiple Choice', 'Blank', 'Binary Word', 'Wrong Word', 'Correct Word'],
  General: ['Cloze'],
} as const satisfies Record<string, readonly QuestionType[]>

export type Difficulty = 'Hard' | 'Normal' | 'Easy'
export type OptionCount = 1 | 2 | 3 | 4 | 5

/** PRD requirement 4 — Scramble as multiple choice, or open-ended word ordering. */
export type ScrambleMode = 'choice' | 'openEnded'

export interface EngineOptions {
  difficulty: Difficulty
  optionCount: OptionCount
}

export interface GenerateOptions extends EngineOptions {
  /** PRD requirement 4. */
  scrambleMode: ScrambleMode
  /** PRD requirement 5 — show the "Choose = ..." word bank under a Cloze passage. */
  clozeWordList: boolean
  /** Renumber out-of-reading-order Cloze blanks (PRD §6.3 C3). */
  clozeRenumber: boolean
}

export const DEFAULT_GENERATE_OPTIONS: GenerateOptions = {
  difficulty: 'Hard',
  optionCount: 5,
  scrambleMode: 'choice',
  clozeWordList: true,
  clozeRenumber: true,
}

export type Answer =
  /** The 9 choice-based types, plus Scramble in 'choice' mode. */
  | { kind: 'choice'; choice: number }
  /** Scramble in 'openEnded' mode — the restored original sentence. */
  | { kind: 'sentence'; sentence: string }
  /** Cloze — one word per blank, in reading order. */
  | { kind: 'wordList'; words: { n: number; word: string }[] }

export interface QuestionMeta {
  /** What the engine actually used, which can differ from what was requested. */
  appliedDifficulty: Difficulty
  appliedOptionCount: number
  scrambleMode?: ScrambleMode
  clozeWordList?: boolean
  /** True when C3 renumbering changed the blank numbers. */
  clozeRenumbered?: boolean
  /** True once the question has been hand-edited; regenerating discards those edits. */
  edited?: boolean
  /** Engine attempts spent, including the throwaway token prime. */
  attempts: number
  ms: number
  /** Duplicate-detection key: type + which part of the passage was altered. */
  targetFingerprint: string
}

export interface Question {
  id: string
  /** 1-based; recomputed on delete/reorder. */
  number: number
  type: QuestionType
  /** Instruction + transformed passage, ready to typeset. */
  body: string
  /** Absent for open-ended Scramble and for Cloze. */
  options?: string[]
  /** Cloze word bank, when clozeWordList is on. */
  wordBank?: string[]
  answer: Answer
  meta: QuestionMeta
  warnings: string[]
}

/**
 * Page geometry, measured from the reference PDF
 * (2026-2 중간 문제/정의여고1_공통영어2_미래엔(김) 1과 본문_1_2.pdf) — PRD §3.3.
 * Used by both the on-screen preview and the PDF/DOCX exporters.
 */
export interface PrintGeometry {
  pageWidthPt: number
  pageHeightPt: number
  contentTopPt: number
  leftColumnXPt: number
  rightColumnXPt: number
  columnWidthPt: number
  /** One question must fit inside this height, or it gets shrunk. */
  questionColumnHeightPt: number
  /** The answer section flows deeper down the page than questions do. */
  answerColumnHeightPt: number
  lineHeightPt: number

  // --- typography ---------------------------------------------------------
  // Sizes are in CSS px because that is how they were specified. 1px = 0.75pt
  // exactly, so nothing is lost converting for DOCX or measuring against the pt
  // page geometry above.
  /** Document title and subtitle. */
  titleFontPx: number
  titleFontWeight: number
  titleFontStack: string
  /** Everything else: question headers, passages, options, answers. */
  bodyFontPx: number
  bodyFontStack: string
  /** Questions may shrink to this size to fit their column (PRD E26). */
  minBodyFontPx: number
}

/** CSS px to points. Exact: 1px = 1/96in, 1pt = 1/72in. */
export const pxToPt = (px: number): number => (px * 72) / 96
/** Points to CSS px. */
export const ptToPx = (pt: number): number => (pt * 96) / 72

export const PRINT_GEOMETRY: PrintGeometry = {
  pageWidthPt: 595.32,
  pageHeightPt: 841.92,
  contentTopPt: 25,
  leftColumnXPt: 28,
  rightColumnXPt: 309,
  columnWidthPt: 261,
  questionColumnHeightPt: 715,
  answerColumnHeightPt: 768,
  lineHeightPt: 16,

  titleFontPx: 16,
  titleFontWeight: 700,
  // Pretendard is installed as a family plus per-weight faces; the variable cut
  // is listed as a fallback in case only that one is present.
  titleFontStack: "Pretendard, 'Pretendard Variable', 'Malgun Gothic', sans-serif",
  bodyFontPx: 13,
  // Plain 'Noto Sans' is not always installed; 'Noto Sans KR' carries the same
  // Latin design and is what is present on this machine.
  bodyFontStack: "'Noto Sans', 'Noto Sans KR', 'Malgun Gothic', sans-serif",
  minBodyFontPx: 12,
}

export interface QuestionDocument {
  /** e.g. '미래엔(김) 1과 본문' */
  title: string
  /** e.g. 'Section 1, 2' */
  subtitle: string
  sourceText: string
  questions: Question[]
  layout: PrintGeometry
}

// --- generation requests/results crossing the IPC boundary -----------------

export interface GenerationRequest {
  passage: string
  /** Types to draw from, in the caller's intended order. */
  plan: QuestionType[]
  options: GenerateOptions
}

export interface GenerationFailure {
  type: QuestionType
  reason: string
  attempts: number
}

export interface GenerationResult {
  questions: Question[]
  failures: GenerationFailure[]
  /** Questions discarded because they duplicated an earlier fingerprint. */
  duplicatesRejected: number
  ms: number
}

export interface SelfTestResult {
  ok: boolean
  perType: { type: QuestionType; ok: boolean; attempts: number; ms: number; error?: string }[]
  contract: EngineContract
}

export interface EngineContract {
  missingFunctions: string[]
  missingElements: string[]
  dialogTrapInstalled: boolean
  /** The engine author's attribution banner — shown in the app's credits. */
  attribution: string[]
}
