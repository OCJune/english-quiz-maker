// EngineBridge — drives ariaenglish_offline_4.html in a hidden BrowserWindow.
//
// The engine is a black box (PRD D1). Everything known about how to invoke it
// comes from spike S1/S2; see src/main/engine/contract.ts for the contract and
// spike/SPIKE-REPORT.md for the evidence.
//
// Two facts shape this class:
//
//  1. Generation is gated on a one-shot capability token. Every generator starts
//     with `if (!flagValidate || code !== globalCode) return ''` and consumes the
//     token on success. The token is armed ONLY when generatePerformance runs
//     through a button's event path, so we dispatch a click and never call the
//     function directly (direct calls: 0/33, dispatched clicks: 32/33). A gated
//     attempt arms the token for the next one, which is why retrying works and
//     why the first generation after load is a throwaway prime.
//
//  2. The engine keeps a single global state, so calls must be serialised.

import { BrowserWindow, session } from 'electron'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

import { resolveResource } from '../resources'


import {
  ATTRIBUTION,
  EL,
  FIXED,
  REQUIRED_FUNCTIONS,
  TIMING,
  TYPE_BUTTON,
} from './contract'
import { ParseError, isRealOutput, parse, type ParsedOutput } from './ResultParser'
import {
  fingerprint,
  renumberCloze,
  stripClozeWordBank,
  toOpenEndedScramble,
} from './transforms'
import {
  QUESTION_TYPES,
  type EngineContract,
  type EngineOptions,
  type GenerateOptions,
  type GenerationFailure,
  type GenerationRequest,
  type GenerationResult,
  type Question,
  type QuestionType,
  type SelfTestResult,
} from '@shared/types'

/** The bundled engine is version-pinned — never modified, never re-fetched. */
const ENGINE_FILE = 'ariaenglish_offline_4.html'

interface Attempt {
  raw: string
  threw: string | null
  dialogs: { kind: string; msg: string }[]
  errors: string[]
  engineOptionCount: number | null
  engineDifficulty: string | null
}

export class EngineBridge {
  private win: BrowserWindow | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private appliedOptions: EngineOptions | null = null
  private primed = false

  /** Serialise every engine interaction — the engine shares one global state. */
  private run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task)
    this.queue = next.catch(() => undefined)
    return next
  }

  private get contents() {
    if (!this.win || this.win.isDestroyed()) throw new Error('engine window is not running')
    return this.win.webContents
  }

  private js<T>(code: string): Promise<T> {
    return this.contents.executeJavaScript(code, true) as Promise<T>
  }

  // --- lifecycle -----------------------------------------------------------

  async start(): Promise<EngineContract> {
    if (this.win && !this.win.isDestroyed()) return this.readContract()

    // The engine makes no network requests (S1: zero attempted). Block anything
    // that is not a local file as defence in depth.
    const partition = 'persist:aria-engine'
    const engineSession = session.fromPartition(partition)
    engineSession.webRequest.onBeforeRequest((details, cb) =>
      cb({ cancel: !details.url.startsWith('file://') }),
    )

    this.win = new BrowserWindow({
      show: false,
      width: 1400,
      height: 1000,
      webPreferences: {
        nodeIntegration: false,
        // contextIsolation MUST be false: the engine preload has to share the
        // page's window object to trap alert/confirm/prompt before the engine's
        // own scripts run. This is what lets us leave the engine file unmodified.
        contextIsolation: false,
        sandbox: true,
        backgroundThrottling: false,
        devTools: false,
        partition,
        preload: join(__dirname, '../preload/engine.js'),
      },
    })

    // The engine file is loaded as-is. Never modify or rewrite it.
    await this.win.loadFile(resolveResource('engine', ENGINE_FILE))
    await delay(TIMING.bootSettleMs)

    const contract = await this.readContract()
    if (contract.missingFunctions.length || contract.missingElements.length) {
      throw new Error(
        'bundled engine does not match the expected contract — ' +
          `missing functions: [${contract.missingFunctions.join(', ')}], ` +
          `missing elements: [${contract.missingElements.join(', ')}]`,
      )
    }
    if (!contract.dialogTrapInstalled) {
      throw new Error('dialog trap was not installed; a native alert() would block generation')
    }

    this.appliedOptions = null
    this.primed = false
    return contract
  }

  dispose(): void {
    this.win?.destroy()
    this.win = null
    this.primed = false
    this.appliedOptions = null
  }

  private async readContract(): Promise<EngineContract> {
    return this.js<EngineContract>(`(() => {
      const fns = ${JSON.stringify(REQUIRED_FUNCTIONS)};
      const ids = ${JSON.stringify([...Object.values(EL), ...Object.values(TYPE_BUTTON)])};
      return {
        missingFunctions: fns.filter((f) => typeof window[f] !== 'function'),
        missingElements: ids.filter((i) => !document.getElementById(i)),
        dialogTrapInstalled: !!(window.__ariaTrap && window.__ariaTrap.installed),
        attribution: ${JSON.stringify(ATTRIBUTION)},
      };
    })()`)
  }

  // --- settings ------------------------------------------------------------

  private async applyOptions(opts: EngineOptions): Promise<void> {
    if (
      this.appliedOptions &&
      this.appliedOptions.difficulty === opts.difficulty &&
      this.appliedOptions.optionCount === opts.optionCount
    ) {
      return
    }
    await this.js(`(() => {
      const set = (id, value, fn) => {
        const el = document.getElementById(id);
        el.value = value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        if (fn) window[fn]();
      };
      set(${q(EL.optionCount)}, ${q(String(opts.optionCount))}, 'setOptionNumber');
      set(${q(EL.difficulty)}, ${q(opts.difficulty)}, 'setOptionDifficulty');
      set(${q(EL.language)}, ${q(FIXED.language)}, 'setOptionLanguage');
      set(${q(EL.occupation)}, ${q(FIXED.occupation)}, 'setOptionOccupation');
      // Never Confirm -- otherwise confirm() would block automation.
      document.getElementById(${q(EL.confirm)}).value = ${q(FIXED.confirm)};
      return true;
    })()`)
    this.appliedOptions = { ...opts }
  }

  // --- raw generation ------------------------------------------------------

  /** One dispatch through the button's event path. */
  private attempt(type: QuestionType, passage: string): Promise<Attempt> {
    return this.js<Attempt>(`(() => {
      const trap = window.__ariaTrap;
      if (trap) trap.reset();
      const source = document.getElementById(${q(EL.source)});
      const generated = document.getElementById(${q(EL.generated)});
      source.value = ${JSON.stringify(passage)};
      generated.value = '';
      let threw = null;
      try {
        document.getElementById(${q(TYPE_BUTTON[type])}).dispatchEvent(
          new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      } catch (e) { threw = String((e && e.message) || e); }
      const num = (n) => { try { return eval(n); } catch (e) { return null; } };
      return {
        raw: generated.value,
        threw,
        dialogs: trap ? trap.dialogs.slice() : [],
        errors: trap ? trap.errors.slice() : [],
        engineOptionCount: num('numberOption'),
        engineDifficulty: num('stringDifficulty'),
      };
    })()`)
  }

  /**
   * Generate until the engine yields a real question. A gated attempt returns
   * only the type label and arms the token, so retrying is the mechanism — not
   * a workaround for flakiness.
   */
  private async generateRaw(
    type: QuestionType,
    passage: string,
  ): Promise<{ attempt: Attempt; attempts: number; ms: number }> {
    const started = Date.now()
    let last: Attempt | null = null
    for (let n = 1; n <= TIMING.maxAttempts; n++) {
      const attempt = await withTimeout(
        this.attempt(type, passage),
        TIMING.generateTimeoutMs,
        `engine did not respond within ${TIMING.generateTimeoutMs}ms for ${type}`,
      )
      last = attempt
      this.primed = true
      if (attempt.errors.length) {
        throw new Error(`engine raised an error generating ${type}: ${attempt.errors.join('; ')}`)
      }
      if (isRealOutput(attempt.raw)) {
        return { attempt, attempts: n, ms: Date.now() - started }
      }
    }
    const detail = last?.threw ? ` (${last.threw})` : ''
    throw new Error(
      `engine produced no question for ${type} after ${TIMING.maxAttempts} attempts${detail}`,
    )
  }

  /** Burn one generation so the capability token is armed. */
  private async prime(passage: string, opts: EngineOptions): Promise<void> {
    if (this.primed) return
    await this.applyOptions(opts)
    await this.attempt('Cloze', passage)
    this.primed = true
  }

  // --- one question --------------------------------------------------------

  private buildQuestion(
    type: QuestionType,
    parsed: ParsedOutput,
    raw: Attempt,
    passage: string,
    opts: GenerateOptions,
    attempts: number,
    ms: number,
  ): Question {
    const warnings = [...parsed.warnings]
    let body = parsed.body
    let options: string[] | undefined = parsed.options.length ? parsed.options : undefined
    let wordBank: string[] | undefined = parsed.wordBank ?? undefined
    let answer = parsed.answer
    let clozeRenumbered: boolean | undefined

    // PRD requirement 4 — open-ended Scramble.
    if (type === 'Scramble' && opts.scrambleMode === 'openEnded') {
      const transformed = toOpenEndedScramble(parsed, passage)
      if ('error' in transformed) {
        throw new Error(`open-ended Scramble transform failed: ${transformed.error}`)
      }
      if (!transformed.verified) {
        throw new Error(
          'open-ended Scramble transform failed: the restored sentence was not found ' +
            'verbatim in the source passage',
        )
      }
      body = transformed.body
      options = undefined
      answer = { kind: 'sentence', sentence: transformed.sentence }
    }

    if (type === 'Cloze') {
      // PRD §6.3 C3 — put out-of-order blank numbers back into reading order.
      if (opts.clozeRenumber) {
        const renumbered = renumberCloze(parsed)
        if ('error' in renumbered) throw new Error(`Cloze renumbering failed: ${renumbered.error}`)
        body = renumbered.body
        answer = { kind: 'wordList', words: renumbered.words }
        clozeRenumbered = renumbered.changed
        if (renumbered.changed) {
          warnings.push(
            `engine numbered blanks out of reading order [${renumbered.originalOrder?.join(',')}]; renumbered`,
          )
        }
      }
      // PRD requirement 5 — hide the word bank.
      if (!opts.clozeWordList) wordBank = stripClozeWordBank(parsed).wordBank ?? undefined
    }

    return {
      id: randomUUID(),
      number: 0, // assigned by the caller once the document order is known
      type,
      body,
      ...(options ? { options } : {}),
      ...(wordBank ? { wordBank } : {}),
      answer,
      meta: {
        appliedDifficulty: (raw.engineDifficulty as Question['meta']['appliedDifficulty']) ?? opts.difficulty,
        appliedOptionCount: raw.engineOptionCount ?? opts.optionCount,
        ...(type === 'Scramble' ? { scrambleMode: opts.scrambleMode } : {}),
        ...(type === 'Cloze' ? { clozeWordList: opts.clozeWordList, clozeRenumbered } : {}),
        attempts,
        ms,
        targetFingerprint: fingerprint(type, parsed),
      },
      warnings,
    }
  }

  /**
   * Generate one question whose fingerprint is not already taken.
   *
   * Retries cover two things that are expected rather than exceptional: a variant
   * that duplicates an existing question, and a transform that cannot be verified
   * (an open-ended Scramble whose sentence is not found in the passage).
   */
  private async generateUnique(
    type: QuestionType,
    passage: string,
    options: GenerateOptions,
    taken: ReadonlySet<string>,
    maxRounds = 5,
  ): Promise<{ question: Question; duplicatesRejected: number }> {
    let duplicatesRejected = 0
    let lastError = 'unknown error'

    for (let round = 0; round < maxRounds; round++) {
      try {
        const { attempt, attempts, ms } = await this.generateRaw(type, passage)
        const parsed = parse(attempt.raw, type)
        const question = this.buildQuestion(type, parsed, attempt, passage, options, attempts, ms)
        if (taken.has(question.meta.targetFingerprint)) {
          duplicatesRejected++
          lastError = '생성된 변형이 모두 기존 문항과 중복됩니다'
          continue
        }
        return { question, duplicatesRejected }
      } catch (err) {
        lastError =
          err instanceof ParseError
            ? `parse failed: ${err.message}`
            : String((err as Error).message ?? err)
      }
    }
    throw new Error(lastError)
  }

  /** Generate a single question, avoiding the fingerprints already in the document. */
  generateOne(
    type: QuestionType,
    passage: string,
    opts: GenerateOptions,
    exclude: readonly string[] = [],
  ): Promise<Question> {
    return this.run(async () => {
      await this.applyOptions(opts)
      await this.prime(passage, opts)
      const { question } = await this.generateUnique(type, passage, opts, new Set(exclude))
      return question
    })
  }

  // --- a whole document ----------------------------------------------------

  /**
   * Generate the planned questions in order, rejecting duplicates and reporting
   * per-question failures instead of aborting the batch (PRD E12).
   */
  generate(
    request: GenerationRequest,
    onProgress?: (done: number, total: number) => void,
  ): Promise<GenerationResult> {
    return this.run(async () => {
      const started = Date.now()
      const { passage, plan, options } = request
      const questions: Question[] = []
      const failures: GenerationFailure[] = []
      const seen = new Set<string>()
      let duplicatesRejected = 0

      await this.applyOptions(options)
      await this.prime(passage, options)

      for (const [index, type] of plan.entries()) {
        try {
          const result = await this.generateUnique(type, passage, options, seen)
          duplicatesRejected += result.duplicatesRejected
          seen.add(result.question.meta.targetFingerprint)
          result.question.number = questions.length + 1
          questions.push(result.question)
        } catch (err) {
          failures.push({
            type,
            reason: String((err as Error).message ?? err),
            attempts: 0,
          })
        }
        onProgress?.(index + 1, plan.length)
      }

      return { questions, failures, duplicatesRejected, ms: Date.now() - started }
    })
  }

  // --- startup self-test ---------------------------------------------------

  /**
   * Generate one question of each type. Guards against engine drift (PRD R8):
   * if the bundled engine is ever swapped and the invocation recipe stops
   * working, this fails at startup rather than silently producing nothing.
   */
  selfTest(passage: string): Promise<SelfTestResult> {
    return this.run(async () => {
      const contract = await this.readContract()
      const perType: SelfTestResult['perType'] = []
      await this.applyOptions({ difficulty: 'Hard', optionCount: 5 })
      await this.prime(passage, { difficulty: 'Hard', optionCount: 5 })

      for (const type of QUESTION_TYPES) {
        try {
          const { attempts, ms, attempt } = await this.generateRaw(type, passage)
          parse(attempt.raw, type)
          perType.push({ type, ok: true, attempts, ms })
        } catch (err) {
          perType.push({ type, ok: false, attempts: 0, ms: 0, error: String((err as Error).message ?? err) })
        }
      }
      return { ok: perType.every((r) => r.ok), perType, contract }
    })
  }
}

// --- helpers ---------------------------------------------------------------

const q = (s: string): string => JSON.stringify(s)
const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}
