// Layout tests: pagination and the print HTML contract.
//
// These are pure functions, so they run without Electron. The geometry they
// assert against is the reference PDF's measured layout (PRD §3.3).

import { describe, expect, it } from 'vitest'

import {
  PRINT_GEOMETRY,
  answerEntryLines,
  fitOptionsFor,
  buildFitScript,
  paginate,
  renderPrintHtml,
  type QuestionPage,
} from '../src/shared/print/layout'
import { pxToPt, type Answer, type Question, type QuestionDocument, type QuestionType } from '../src/shared/types'

function makeQuestion(n: number, type: QuestionType, answer: Answer, extra: Partial<Question> = {}): Question {
  return {
    id: `q${n}`,
    number: n,
    type,
    body: `body of question ${n}`,
    answer,
    meta: {
      appliedDifficulty: 'Hard',
      appliedOptionCount: 5,
      attempts: 1,
      ms: 5,
      targetFingerprint: `${type}::${n}`,
    },
    warnings: [],
    ...extra,
  }
}

function makeDoc(questions: Question[], overrides: Partial<QuestionDocument> = {}): QuestionDocument {
  return {
    title: '미래엔(김) 1과 본문',
    subtitle: 'Section 1, 2',
    sourceText: 'source',
    questions,
    layout: PRINT_GEOMETRY,
    ...overrides,
  }
}

const choice = (n: number): Answer => ({ kind: 'choice', choice: n })

describe('geometry matches the reference PDF', () => {
  it('keeps the measured page and column metrics', () => {
    expect(PRINT_GEOMETRY.pageWidthPt).toBeCloseTo(595.32, 2)
    expect(PRINT_GEOMETRY.pageHeightPt).toBeCloseTo(841.92, 2)
    expect(PRINT_GEOMETRY.leftColumnXPt).toBe(28)
    expect(PRINT_GEOMETRY.rightColumnXPt).toBe(309)
    // gutter = right column start - (left column start + width)
    expect(
      PRINT_GEOMETRY.rightColumnXPt - (PRINT_GEOMETRY.leftColumnXPt + PRINT_GEOMETRY.columnWidthPt),
    ).toBe(20)
    expect(PRINT_GEOMETRY.lineHeightPt).toBe(16)
  })

  it('keeps both columns inside the page', () => {
    const rightEdge = PRINT_GEOMETRY.rightColumnXPt + PRINT_GEOMETRY.columnWidthPt
    expect(rightEdge).toBeLessThanOrEqual(PRINT_GEOMETRY.pageWidthPt)
    expect(PRINT_GEOMETRY.contentTopPt + PRINT_GEOMETRY.questionColumnHeightPt).toBeLessThanOrEqual(
      PRINT_GEOMETRY.pageHeightPt,
    )
    expect(PRINT_GEOMETRY.contentTopPt + PRINT_GEOMETRY.answerColumnHeightPt).toBeLessThanOrEqual(
      PRINT_GEOMETRY.pageHeightPt,
    )
  })
})

describe('typography', () => {
  it('uses the specified sizes: title 16px bold, everything else 13px', () => {
    expect(PRINT_GEOMETRY.titleFontPx).toBe(16)
    expect(PRINT_GEOMETRY.titleFontWeight).toBe(700)
    expect(PRINT_GEOMETRY.bodyFontPx).toBe(13)
  })

  it('names Pretendard for the title and Noto Sans for the body', () => {
    expect(PRINT_GEOMETRY.titleFontStack).toMatch(/^Pretendard/)
    expect(PRINT_GEOMETRY.bodyFontStack).toMatch(/^'Noto Sans'/)
    // 'Noto Sans KR' is what is actually installed on this machine.
    expect(PRINT_GEOMETRY.bodyFontStack).toContain('Noto Sans KR')
  })

  it('converts px to pt exactly', () => {
    expect(pxToPt(16)).toBe(12)
    expect(pxToPt(13)).toBeCloseTo(9.75, 10)
  })

  it('leaves room to shrink a question before it overflows', () => {
    expect(PRINT_GEOMETRY.minBodyFontPx).toBeLessThan(PRINT_GEOMETRY.bodyFontPx)
  })
})

describe('paginate', () => {
  const questionPages = (doc: QuestionDocument): QuestionPage[] =>
    paginate(doc).filter((p): p is QuestionPage => p.kind === 'questions')

  it('puts exactly two questions on a page, one per column', () => {
    const doc = makeDoc(
      Array.from({ length: 30 }, (_, i) => makeQuestion(i + 1, 'Multiple Choice', choice(1))),
    )
    const pages = questionPages(doc)
    expect(pages).toHaveLength(15)
    for (const page of pages) {
      expect(page.slots).toHaveLength(2)
      expect(page.slots.every((s) => s.question !== null)).toBe(true)
    }
  })

  it('leaves the second column empty for an odd question count', () => {
    const doc = makeDoc(
      Array.from({ length: 7 }, (_, i) => makeQuestion(i + 1, 'Cloze', { kind: 'wordList', words: [] })),
    )
    const pages = questionPages(doc)
    expect(pages).toHaveLength(4)
    expect(pages[3]!.slots[0].question).not.toBeNull()
    expect(pages[3]!.slots[1].question).toBeNull()
  })

  it('places the title block in page 1 column 1 only', () => {
    const doc = makeDoc(
      Array.from({ length: 6 }, (_, i) => makeQuestion(i + 1, 'Blank', choice(2))),
    )
    const pages = questionPages(doc)
    expect(pages[0]!.slots[0].withTitleBlock).toBe(true)
    expect(pages[0]!.slots[1].withTitleBlock).toBe(false)
    for (const page of pages.slice(1)) {
      expect(page.slots.every((s) => !s.withTitleBlock)).toBe(true)
    }
  })

  it('keeps questions in document order across columns', () => {
    const doc = makeDoc(
      Array.from({ length: 5 }, (_, i) => makeQuestion(i + 1, 'Wrong Word', choice(3))),
    )
    const order = questionPages(doc).flatMap((p) => p.slots.map((s) => s.question?.number ?? null))
    expect(order).toEqual([1, 2, 3, 4, 5, null])
  })

  it('always appends at least one answer page, after the questions', () => {
    const doc = makeDoc([makeQuestion(1, 'Scramble', choice(2))])
    const pages = paginate(doc)
    const answers = pages.filter((p) => p.kind === 'answers')
    expect(answers.length).toBeGreaterThanOrEqual(1)
    expect(pages.findIndex((p) => p.kind === 'answers')).toBe(
      pages.filter((p) => p.kind === 'questions').length,
    )
  })

  it('reserves more answer pages when Cloze word lists are long', () => {
    const longCloze = makeQuestion(1, 'Cloze', {
      kind: 'wordList',
      words: Array.from({ length: 35 }, (_, i) => ({ n: i + 1, word: `w${i}` })),
    })
    const many = Array.from({ length: 12 }, (_, i) => ({ ...longCloze, id: `c${i}`, number: i + 1 }))
    const short = Array.from({ length: 12 }, (_, i) => makeQuestion(i + 1, 'Blank', choice(1)))
    const withCloze = paginate(makeDoc(many)).filter((p) => p.kind === 'answers').length
    const withChoice = paginate(makeDoc(short)).filter((p) => p.kind === 'answers').length
    expect(withCloze).toBeGreaterThan(withChoice)
  })
})

describe('answerEntryLines', () => {
  it('counts one line for a choice and one per word for a list', () => {
    expect(answerEntryLines(choice(4))).toBe(1)
    expect(
      answerEntryLines({ kind: 'wordList', words: [{ n: 1, word: 'a' }, { n: 2, word: 'b' }] }),
    ).toBe(4)
    expect(answerEntryLines({ kind: 'sentence', sentence: 'x' })).toBeGreaterThan(1)
  })
})

describe('renderPrintHtml', () => {
  const doc = makeDoc([
    makeQuestion(1, 'Multiple Choice', choice(3), { options: ['alpha', 'beta', 'gamma'] }),
    makeQuestion(2, 'Scramble', { kind: 'sentence', sentence: 'It was amazing.' }),
    makeQuestion(3, 'Cloze', {
      kind: 'wordList',
      words: [{ n: 1, word: 'animal' }, { n: 2, word: 'agreed' }],
    }, { wordBank: ['animal', 'agreed'] }),
  ])
  const html = renderPrintHtml(doc)

  it('emits the measured geometry into the stylesheet', () => {
    expect(html).toContain(`width: ${PRINT_GEOMETRY.pageWidthPt}pt`)
    expect(html).toContain(`height: ${PRINT_GEOMETRY.pageHeightPt}pt`)
    expect(html).toContain(`left: ${PRINT_GEOMETRY.leftColumnXPt}pt`)
    expect(html).toContain(`left: ${PRINT_GEOMETRY.rightColumnXPt}pt`)
    expect(html).toContain(`font-size: ${PRINT_GEOMETRY.bodyFontPx}px`)
  })

  it('styles the title block with the title font, size and weight', () => {
    expect(html).toContain(`font-family: ${PRINT_GEOMETRY.titleFontStack}`)
    expect(html).toContain(`font-size: ${PRINT_GEOMETRY.titleFontPx}px`)
    expect(html).toContain(`font-weight: ${PRINT_GEOMETRY.titleFontWeight}`)
  })

  it('sets question headers at body size, not title size', () => {
    const headRule = html.slice(html.indexOf('.q-head {'), html.indexOf('.q-head {') + 120)
    expect(headRule).toContain(`font-size: ${PRINT_GEOMETRY.bodyFontPx}px`)
    expect(headRule).not.toContain(`${PRINT_GEOMETRY.titleFontPx}px`)
  })

  it('renders the title block and both question headers in reference form', () => {
    expect(html).toContain('미래엔(김) 1과 본문')
    expect(html).toContain('Section 1, 2')
    expect(html).toContain('&lt; Question 1 &gt;')
    expect(html).toContain('Multiple Choice')
  })

  it('renders each answer kind in the reference form', () => {
    expect(html).toContain('&lt; Answer 1 &gt;&nbsp;&nbsp;(3)')
    expect(html).toContain('It was amazing.')
    expect(html).toContain('1) animal')
    expect(html).toContain('2) agreed')
  })

  it('shows the Cloze word bank when the question carries one', () => {
    expect(html).toContain('Choose')
  })

  it('escapes HTML in question text', () => {
    const nasty = makeDoc([
      makeQuestion(1, 'Blank', choice(1), { body: '<script>alert("x")</script> & more' }),
    ])
    const out = renderPrintHtml(nasty)
    expect(out).not.toContain('<script>alert')
    expect(out).toContain('&lt;script&gt;')
    expect(out).toContain('&amp; more')
  })

  it('omits the title block element when both title and subtitle are empty', () => {
    const out = renderPrintHtml(makeDoc([makeQuestion(1, 'Blank', choice(1))], { title: '', subtitle: '' }))
    // The `.title-block` CSS rule is always present; the element must not be.
    expect(out).not.toContain('<div class="title-block">')
    expect(html).toContain('<div class="title-block">')
  })

  it('puts every answer entry in the detached holder for the fit pass', () => {
    expect(html).toContain('id="answer-source"')
    const holder = html.slice(html.indexOf('id="answer-source"'))
    expect(holder.match(/&lt; Answer \d+ &gt;/g)).toHaveLength(3)
  })
})

describe('fit script', () => {
  it('carries the geometry-derived options', () => {
    const options = fitOptionsFor()
    expect(options.bodyFontPx).toBe(PRINT_GEOMETRY.bodyFontPx)
    expect(options.minBodyFontPx).toBe(PRINT_GEOMETRY.minBodyFontPx)
    // 16pt leading over a 13px body, both expressed in px.
    expect(options.lineHeightRatio).toBeCloseTo((16 * 96) / 72 / 13, 5)
  })

  it('serialises to a self-contained expression for the export window', () => {
    const script = buildFitScript()
    expect(script.startsWith('(')).toBe(true)
    expect(script).toContain('querySelectorAll')
    expect(script).toContain('answer-source')
    // Nothing from module scope may leak into the serialised source.
    expect(script).not.toContain('PRINT_GEOMETRY')
    expect(script).toContain(String(PRINT_GEOMETRY.minBodyFontPx))
  })
})
