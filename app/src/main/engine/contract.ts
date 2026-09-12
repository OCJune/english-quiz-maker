// The engine's DOM/global contract, established by spike S1.
// These names are NOT obfuscated in ariaenglish_offline_4.html and are the only
// stable surface we depend on. If the bundled engine is ever replaced, the
// startup self-test (EngineBridge.selfTest) fails loudly on any drift.

import type { QuestionType } from '@shared/types'

/** Text areas, by their role in the engine's UI. */
export const EL = {
  /** TA1 — source passage. We write here. */
  source: 'productWordContentOriginal',
  /** TA3 — generated question + answer. We read here. */
  generated: 'productWordContentProcessed',
  /** TA2 — question stack (engine-native numbering path; used as a cross-check). */
  questionStack: 'supportTextArea1',
  /** TA4 — answer stack. */
  answerStack: 'supportTextArea2',

  optionCount: 'productWordOption',
  difficulty: 'productWordDifficulty',
  language: 'productWordLanguage',
  occupation: 'productWordOccupation',
  /** Must be forced to 'false' (Never Confirm) so confirm() never blocks. */
  confirm: 'optionToolConfirm',

  buttonStack: 'buttonStack',
  buttonApplyNumber: 'buttonApplyNumber',
} as const

/**
 * Generation MUST go through these buttons' event path.
 * Calling window.generatePerformance() directly scores 0/33 — the engine only
 * arms its one-shot capability token when invoked via the onclick path (S1).
 */
export const TYPE_BUTTON: Record<QuestionType, string> = {
  'Scramble': 'buttonScramble',
  'Shuffle': 'buttonShuffle',
  'Missing Sentence': 'buttonMissingSentence',
  'Wrong Sentence': 'buttonWrongSentence',
  'Correct Sentence': 'buttonCorrectSentence',
  'Multiple Choice': 'buttonMultipleChoice',
  'Blank': 'buttonBlank',
  'Binary Word': 'buttonBinaryWord',
  'Wrong Word': 'buttonWrongWord',
  'Correct Word': 'buttonCorrectWord',
  'Cloze': 'buttonCloze',
}

/** Globals that must exist for the bridge to work. */
export const REQUIRED_FUNCTIONS = [
  'load',
  'generatePerformance',
  'stackContent',
  'applyNumber',
  'setOptionNumber',
  'setOptionDifficulty',
  'setOptionLanguage',
  'setOptionOccupation',
] as const

/** Fixed engine settings — see PRD §3.2. */
export const FIXED = {
  language: 'English',
  occupation: 'Teacher',
  /** 'false' == Never Confirm. */
  confirm: 'false',
} as const

/**
 * The engine appends this 6-line attribution block to every generated output.
 * It is stripped from each question (the reference PDFs do not carry it) but
 * MUST remain visible in the app's credits screen — see PRD §3.2 and §6.3.
 */
export const ATTRIBUTION = [
  'For Mass Production www.AriaEnglish.com',
  'For Contact teamexercisevocabulary10@gmail.com',
  'Engine Design by Dani Sohn',
  'Copyright 2021 Dani Sohn',
  'Engine Version 0 Revision 4 Fix 04',
  'USE AT YOUR OWN RISK',
] as const

/** Engine runtime behaviour measured in S1/S2. */
export const TIMING = {
  /** Observed 4–36 ms per generation; 1 s is a generous ceiling. */
  generateTimeoutMs: 1000,
  /** A failed attempt arms the token for the next one, so retries are cheap. */
  maxAttempts: 4,
  /** Time for <body onload="load()"> to settle. */
  bootSettleMs: 900,
} as const
