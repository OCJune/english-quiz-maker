// DOCX export — checks the geometry and the structural rules that make the Word
// output match the reference layout: A4, two columns, one question per column,
// the answer sheet on a fresh page.

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import AdmZip from 'adm-zip'

import { DocxExporter } from '../src/main/export/DocxExporter'
import {
  PRINT_GEOMETRY,
  pxToPt,
  type Answer,
  type Question,
  type QuestionDocument,
  type QuestionType,
} from '../src/shared/types'

const ptToTwip = (pt: number): number => Math.round(pt * 20)

function makeQuestion(n: number, type: QuestionType, answer: Answer, extra: Partial<Question> = {}): Question {
  return {
    id: `q${n}`,
    number: n,
    type,
    body: `Question ${n} body text.`,
    answer,
    meta: {
      appliedDifficulty: 'Hard',
      appliedOptionCount: 5,
      attempts: 1,
      ms: 4,
      targetFingerprint: `${type}::${n}`,
    },
    warnings: [],
    ...extra,
  }
}

function makeDoc(count: number): QuestionDocument {
  const questions: Question[] = Array.from({ length: count }, (_, i) => {
    const n = i + 1
    if (n % 3 === 0) {
      return makeQuestion(n, 'Cloze', {
        kind: 'wordList',
        words: [
          { n: 1, word: 'animal' },
          { n: 2, word: 'agreed' },
        ],
      }, { wordBank: ['animal', 'agreed'] })
    }
    if (n % 3 === 1) {
      return makeQuestion(n, 'Multiple Choice', { kind: 'choice', choice: 2 }, {
        options: ['alpha', 'beta', 'gamma'],
      })
    }
    return makeQuestion(n, 'Scramble', { kind: 'sentence', sentence: 'It was amazing.' })
  })
  return {
    title: '미래엔(김) 1과 본문',
    subtitle: 'Section 1, 2',
    sourceText: 'source',
    questions,
    layout: PRINT_GEOMETRY,
  }
}

let dir: string
let file: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ariaforge-docx-'))
  file = join(dir, 'out.docx')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function documentXml(doc: QuestionDocument): Promise<string> {
  await new DocxExporter().export(doc, file)
  const zip = new AdmZip(await readFile(file))
  return zip.readAsText('word/document.xml')
}

describe('DocxExporter', () => {
  it('writes a real .docx package', async () => {
    const result = await new DocxExporter().export(makeDoc(4), file)
    expect(result.questionCount).toBe(4)
    expect(result.bytes).toBeGreaterThan(1000)

    const names = new AdmZip(await readFile(file)).getEntries().map((e) => e.entryName)
    expect(names).toContain('word/document.xml')
    expect(names).toContain('[Content_Types].xml')
  })

  it('uses the measured A4 page size and margins', async () => {
    const xml = await documentXml(makeDoc(2))
    expect(xml).toContain(`w:w="${ptToTwip(PRINT_GEOMETRY.pageWidthPt)}"`)
    expect(xml).toContain(`w:h="${ptToTwip(PRINT_GEOMETRY.pageHeightPt)}"`)
    expect(xml).toContain(`w:top="${ptToTwip(PRINT_GEOMETRY.contentTopPt)}"`)
    expect(xml).toContain(`w:left="${ptToTwip(PRINT_GEOMETRY.leftColumnXPt)}"`)
  })

  it('sets two equal columns with the measured gutter', async () => {
    const xml = await documentXml(makeDoc(2))
    const gutter =
      PRINT_GEOMETRY.rightColumnXPt - (PRINT_GEOMETRY.leftColumnXPt + PRINT_GEOMETRY.columnWidthPt)
    expect(xml).toMatch(/<w:cols[^>]*w:num="2"/)
    expect(xml).toContain(`w:space="${ptToTwip(gutter)}"`)
  })

  it('breaks the column after every question but the last', async () => {
    for (const count of [1, 2, 5, 12]) {
      const xml = await documentXml(makeDoc(count))
      const breaks = xml.match(/<w:br w:type="column"\/>/g) ?? []
      expect(breaks, `count ${count}`).toHaveLength(count - 1)
    }
  })

  it('starts the answer sheet on a new page', async () => {
    const xml = await documentXml(makeDoc(6))
    expect(xml.match(/<w:br w:type="page"\/>/g) ?? []).toHaveLength(1)
    const pageBreakAt = xml.indexOf('<w:br w:type="page"/>')
    expect(xml.indexOf('Answer 1')).toBeGreaterThan(pageBreakAt)
  })

  it('carries every question and answer, plus the title block', async () => {
    const xml = await documentXml(makeDoc(9))
    const text = xml.replace(/<[^>]+>/g, '')
    for (let n = 1; n <= 9; n++) {
      expect(text, `question ${n}`).toContain(`Question ${n} `)
      expect(text, `answer ${n}`).toContain(`Answer ${n} `)
    }
    expect(text).toContain('미래엔(김) 1과 본문')
    expect(text).toContain('Section 1, 2')
  })

  it('sets the title at the title size and bold, and the body at body size', async () => {
    const xml = await documentXml(makeDoc(2))
    const halfPt = (px: number): number => Math.round(pxToPt(px) * 2)
    expect(xml).toContain(`<w:sz w:val="${halfPt(PRINT_GEOMETRY.titleFontPx)}"`)
    expect(xml).toContain(`<w:sz w:val="${halfPt(PRINT_GEOMETRY.bodyFontPx)}"`)
    expect(xml).toContain('<w:b/>')
  })

  it('renders all three answer forms', async () => {
    const text = (await documentXml(makeDoc(3))).replace(/<[^>]+>/g, '')
    expect(text).toContain('(2)') // choice
    expect(text).toContain('It was amazing.') // sentence
    expect(text).toContain('1) animal') // word list
  })

  it('emits the Cloze word bank when present', async () => {
    const text = (await documentXml(makeDoc(3))).replace(/<[^>]+>/g, '')
    expect(text).toContain('Choose')
  })

  it('handles a document with no questions without emitting breaks', async () => {
    const empty: QuestionDocument = { ...makeDoc(1), questions: [] }
    const xml = await documentXml(empty)
    expect(xml.match(/<w:br w:type="column"\/>/g)).toBeNull()
    expect(xml.match(/<w:br w:type="page"\/>/g)).toBeNull()
  })
})
