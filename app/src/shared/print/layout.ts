// Print layout — ONE implementation, two consumers.
//
// The on-screen preview (an iframe in the renderer) and the exported PDF (a hidden
// BrowserWindow in main) both render the HTML produced here, so what the user
// checks is exactly what gets printed.
//
// Geometry is measured from the reference PDF
// (2026-2 중간 문제/정의여고1_공통영어2_미래엔(김) 1과 본문_1_2.pdf) — see PRD §3.3:
//
//   A4 595.32 x 841.92 pt, two columns at x=28..289 and x=309..569 (gutter 20pt)
//   body 10pt / heading 12pt / line-height 16pt
//   question pages: exactly one question per column, content top 25pt, never past ~740pt
//   answer page:    same two columns, flowing, content runs to ~793pt
//   page 1 column 1: title block, with question 1 flowing beneath it
//
// No Node or DOM APIs here: this module must import cleanly in main and renderer.

import {
  PRINT_GEOMETRY,
  ptToPx,
  type Answer,
  type PrintGeometry,
  type Question,
  type QuestionDocument,
} from '../types'

export { PRINT_GEOMETRY, type PrintGeometry }

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export interface QuestionSlot {
  question: Question | null
  /** The title block sits above the first question, in page 1 column 1. */
  withTitleBlock: boolean
}

export interface QuestionPage {
  kind: 'questions'
  pageNumber: number
  slots: [QuestionSlot, QuestionSlot]
}

export interface AnswerPage {
  kind: 'answers'
  pageNumber: number
}

export type PrintPage = QuestionPage | AnswerPage

/** How many lines an answer entry occupies, used to size the answer section. */
export function answerEntryLines(answer: Answer): number {
  switch (answer.kind) {
    case 'choice':
      return 1
    case 'sentence':
      // header line + the sentence (which may wrap; assume up to two lines)
      return 3
    case 'wordList':
      // header line + blank + one line per word
      return 2 + answer.words.length
  }
}

export function paginate(doc: QuestionDocument, geometry = PRINT_GEOMETRY): PrintPage[] {
  const pages: PrintPage[] = []
  const questions = doc.questions

  // Exactly two questions per page, one per column.
  const questionPageCount = Math.max(1, Math.ceil(questions.length / 2))
  for (let p = 0; p < questionPageCount; p++) {
    pages.push({
      kind: 'questions',
      pageNumber: p + 1,
      slots: [
        { question: questions[p * 2] ?? null, withTitleBlock: p === 0 },
        { question: questions[p * 2 + 1] ?? null, withTitleBlock: false },
      ],
    })
  }

  // Answer pages are pre-created generously; the fit script drops unused ones
  // after measuring, so no entry can be silently clipped.
  const linesPerColumn = Math.floor(geometry.answerColumnHeightPt / geometry.lineHeightPt)
  const totalLines = questions.reduce((sum, q) => sum + answerEntryLines(q.answer), 0)
  const columns = Math.max(1, Math.ceil(totalLines / linesPerColumn))
  const answerPageCount = Math.ceil(columns / 2) + 1 // +1 headroom for wrapping

  for (let p = 0; p < answerPageCount; p++) {
    pages.push({ kind: 'answers', pageNumber: questionPageCount + p + 1 })
  }
  return pages
}

// ---------------------------------------------------------------------------
// HTML rendering
// ---------------------------------------------------------------------------

const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

function renderQuestion(question: Question): string {
  const parts: string[] = [
    `<div class="q-head">&lt; Question ${question.number} &gt;&nbsp;&nbsp;${escapeHtml(question.type)}</div>`,
    `<div class="q-body">${escapeHtml(question.body)}</div>`,
  ]
  if (question.options?.length) {
    const options = question.options
      .map((option, i) => `<div class="q-option">(${i + 1})&nbsp;&nbsp;${escapeHtml(option)}</div>`)
      .join('')
    parts.push(`<div class="q-options">${options}</div>`)
  }
  if (question.wordBank?.length) {
    parts.push(
      `<div class="q-wordbank">Choose&nbsp;&nbsp;=&nbsp;&nbsp;${escapeHtml(question.wordBank.join('  '))}</div>`,
    )
  }
  return `<div class="question" data-number="${question.number}">${parts.join('')}</div>`
}

function renderAnswerEntry(question: Question): string {
  const head = `&lt; Answer ${question.number} &gt;`
  const answer = question.answer
  switch (answer.kind) {
    case 'choice':
      return `<div class="answer">${head}&nbsp;&nbsp;(${answer.choice})</div>`
    case 'sentence':
      return `<div class="answer">${head}<div class="answer-sentence">${escapeHtml(answer.sentence)}</div></div>`
    case 'wordList': {
      const words = answer.words
        .map((w) => `<div class="answer-word">${w.n}) ${escapeHtml(w.word)}</div>`)
        .join('')
      return `<div class="answer">${head}<div class="answer-words">${words}</div></div>`
    }
  }
}

function renderTitleBlock(doc: QuestionDocument): string {
  if (!doc.title && !doc.subtitle) return ''
  const lines: string[] = []
  if (doc.title) lines.push(`<div class="doc-title">${escapeHtml(doc.title)}</div>`)
  if (doc.subtitle) lines.push(`<div class="doc-subtitle">${escapeHtml(doc.subtitle)}</div>`)
  return `<div class="title-block">${lines.join('')}</div>`
}

/**
 * Fonts are bundled with the app and served over the `aria-font` scheme (see
 * src/main/fonts.ts), so the preview and the PDF use the same files no matter
 * what is installed on the machine. Declaring them under the real family names
 * means a bundled font wins over an installed copy of the same name.
 */
const FONT_FACES = `
@font-face {
  font-family: 'Pretendard';
  src: url('aria-font://f/Pretendard-Bold.otf') format('opentype');
  font-weight: 700;
  font-style: normal;
  font-display: block;
}
@font-face {
  font-family: 'Noto Sans';
  src: url('aria-font://f/NotoSansKR-Regular.ttf') format('truetype');
  font-weight: 400;
  font-style: normal;
  font-display: block;
}`.trim()

function css(g: PrintGeometry): string {
  const bottomGapQuestions = g.pageHeightPt - g.contentTopPt - g.questionColumnHeightPt
  return `
${FONT_FACES}
@page { size: ${g.pageWidthPt}pt ${g.pageHeightPt}pt; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
body {
  font-family: ${g.bodyFontStack};
  color: #000;
  font-size: ${g.bodyFontPx}px;
  line-height: ${g.lineHeightPt}pt;
  -webkit-font-smoothing: antialiased;
}
.page {
  position: relative;
  width: ${g.pageWidthPt}pt;
  height: ${g.pageHeightPt}pt;
  overflow: hidden;
  background: #fff;
  break-after: page;
  page-break-after: always;
}
.page:last-of-type { break-after: auto; page-break-after: auto; }
.col {
  position: absolute;
  top: ${g.contentTopPt}pt;
  width: ${g.columnWidthPt}pt;
}
.col.left  { left: ${g.leftColumnXPt}pt; }
.col.right { left: ${g.rightColumnXPt}pt; }
.page.questions .col { height: ${g.questionColumnHeightPt}pt; overflow: hidden; }
.page.answers   .col { height: ${g.answerColumnHeightPt}pt; overflow: hidden; }

.title-block { margin-bottom: ${g.lineHeightPt}pt; }
.doc-title, .doc-subtitle {
  font-family: ${g.titleFontStack};
  font-size: ${g.titleFontPx}px;
  font-weight: ${g.titleFontWeight};
  line-height: ${g.lineHeightPt}pt;
}

/* Question headers are part of "everything else" — same size as the passage. */
.q-head { font-size: ${g.bodyFontPx}px; line-height: ${g.lineHeightPt}pt; }
.q-body { white-space: pre-wrap; text-align: justify; }
.q-options { margin-top: ${g.lineHeightPt}pt; }
.q-option { white-space: pre-wrap; }
.q-wordbank { margin-top: ${g.lineHeightPt}pt; white-space: pre-wrap; }
.question > * + * { margin-top: 0; }
.q-body, .q-options, .q-wordbank { margin-top: ${g.lineHeightPt}pt; }

.answer + .answer { margin-top: ${g.lineHeightPt}pt; }
.answer-sentence { white-space: pre-wrap; }
.answer-words { margin-top: ${g.lineHeightPt}pt; }

/* Only visible in the preview; print keeps a clean white page. */
.page { outline: 0; }

/* Set by the fit script when a question had to be shrunk and still overflows. */
.question[data-overflow='true'] { outline: 1pt solid #c00; }

/* Bottom gap kept for reference: ${bottomGapQuestions.toFixed(1)}pt below the question columns. */
`.trim()
}

export function renderPrintHtml(doc: QuestionDocument, geometry = PRINT_GEOMETRY): string {
  const pages = paginate(doc, geometry)
  const body = pages
    .map((page) => {
      if (page.kind === 'questions') {
        const cols = page.slots
          .map((slot, index) => {
            const side = index === 0 ? 'left' : 'right'
            const title = slot.withTitleBlock ? renderTitleBlock(doc) : ''
            const question = slot.question ? renderQuestion(slot.question) : ''
            return `<div class="col ${side}">${title}${question}</div>`
          })
          .join('')
        return `<div class="page questions" data-page="${page.pageNumber}">${cols}</div>`
      }
      return (
        `<div class="page answers" data-page="${page.pageNumber}">` +
        `<div class="col left"></div><div class="col right"></div>` +
        `</div>`
      )
    })
    .join('\n')

  // Answer entries start life in a detached holder; the fit script distributes
  // them into the answer columns by measurement.
  const answerHolder = doc.questions.map(renderAnswerEntry).join('')

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>${escapeHtml(doc.title || 'AriaForge')}</title>
<style>
${css(geometry)}
</style>
</head>
<body>
${body}
<div id="answer-source" hidden>${answerHolder}</div>
</body>
</html>`
}

// ---------------------------------------------------------------------------
// Fitting
//
// Written once as a real function. The renderer calls it directly on the preview
// iframe's document; main serialises it with buildFitScript() and injects it into
// the export window. A string-only version would need `unsafe-eval` in the
// renderer's CSP, and two copies would drift.
//
// fitDocument must stay closure-free: every value it needs arrives as an argument,
// because its source is evaluated in another document's context.
// ---------------------------------------------------------------------------

export interface FitReport {
  /** Questions that had to be shrunk, with the size they ended up at. */
  shrunk: { number: number; fontPx: number }[]
  /** Questions still taller than their column at the minimum size. */
  overflowing: number[]
  answerPagesUsed: number
  answerPagesRemoved: number
  /** True when an answer entry could not be placed — should never happen. */
  answersTruncated: boolean
}

/**
 * The slice of the DOM that fitting needs, declared structurally so this module
 * compiles in both the Node and the browser tsconfig without pulling in the DOM lib.
 */
export interface FitElement {
  scrollHeight: number
  clientHeight: number
  children: ArrayLike<FitElement>
  style: { fontSize: string; lineHeight: string }
  querySelector(selectors: string): FitElement | null
  querySelectorAll(selectors: string): ArrayLike<FitElement>
  getAttribute(name: string): string | null
  setAttribute(name: string, value: string): void
  appendChild(child: FitElement): void
  removeChild(child: FitElement): void
  remove(): void
}

export interface FitDocument {
  querySelectorAll(selectors: string): ArrayLike<FitElement>
  getElementById(id: string): FitElement | null
}

export interface FitOptions {
  bodyFontPx: number
  minBodyFontPx: number
  /** Line height as a multiple of font size, preserved while shrinking. */
  lineHeightRatio: number
  stepPx: number
}

export function fitDocument(doc: FitDocument, options: FitOptions): FitReport {
  const report: FitReport = {
    shrunk: [],
    overflowing: [],
    answerPagesUsed: 0,
    answerPagesRemoved: 0,
    answersTruncated: false,
  }
  const fits = (col: FitElement): boolean => col.scrollHeight <= col.clientHeight + 0.5

  // --- questions: shrink anything that does not fit its column --------------
  for (const col of Array.from(doc.querySelectorAll('.page.questions .col'))) {
    const question = col.querySelector('.question')
    if (!question || fits(col)) continue
    let px = options.bodyFontPx
    while (px - options.stepPx >= options.minBodyFontPx - 1e-9 && !fits(col)) {
      px = Math.round((px - options.stepPx) * 100) / 100
      question.style.fontSize = `${px}px`
      question.style.lineHeight = `${px * options.lineHeightRatio}px`
    }
    const number = Number(question.getAttribute('data-number'))
    if (px !== options.bodyFontPx) report.shrunk.push({ number, fontPx: px })
    if (!fits(col)) {
      report.overflowing.push(number)
      question.setAttribute('data-overflow', 'true')
    }
  }

  // --- answers: distribute entries across the pre-created columns ----------
  const source = doc.getElementById('answer-source')
  const columns = Array.from(doc.querySelectorAll('.page.answers .col'))
  if (source && columns.length) {
    const entries = Array.from(source.children)
    source.remove()
    let index = 0
    for (const entry of entries) {
      let placed = false
      while (index < columns.length) {
        const col = columns[index]!
        col.appendChild(entry)
        if (fits(col)) {
          placed = true
          break
        }
        col.removeChild(entry)
        index++
      }
      if (!placed) {
        report.answersTruncated = true
        break
      }
    }

    // Drop answer pages that ended up empty.
    for (const page of Array.from(doc.querySelectorAll('.page.answers'))) {
      const used = Array.from(page.querySelectorAll('.col')).some((c) => c.children.length > 0)
      if (used) report.answerPagesUsed++
      else {
        page.remove()
        report.answerPagesRemoved++
      }
    }
  }
  return report
}

export function fitOptionsFor(geometry: PrintGeometry = PRINT_GEOMETRY): FitOptions {
  return {
    bodyFontPx: geometry.bodyFontPx,
    minBodyFontPx: geometry.minBodyFontPx,
    // Leading stays tied to the measured 16pt line height, so a shrunk question
    // keeps the same rhythm as the rest of the page. Both sides in px.
    lineHeightRatio: ptToPx(geometry.lineHeightPt) / geometry.bodyFontPx,
    stepPx: 0.5,
  }
}

/** Source for `webContents.executeJavaScript`, for the PDF export window. */
export function buildFitScript(geometry: PrintGeometry = PRINT_GEOMETRY): string {
  return `(${fitDocument.toString()})(document, ${JSON.stringify(fitOptionsFor(geometry))})`
}

// ---------------------------------------------------------------------------
// Screen sizing
//
// The print CSS sizes pages in pt. Anything that sizes a box on screen from
// inline styles works in px, so it must convert: feeding the pt number straight
// into a px style made the preview frame 595px wide for a 794px page and cut off
// the right column.
// ---------------------------------------------------------------------------

/** One printed page, in CSS px. */
export function pageSizePx(geometry: PrintGeometry = PRINT_GEOMETRY): { width: number; height: number } {
  return { width: ptToPx(geometry.pageWidthPt), height: ptToPx(geometry.pageHeightPt) }
}
