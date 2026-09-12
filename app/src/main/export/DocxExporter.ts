// DOCX export — the same document model as the PDF, re-rendered as Word.
//
// Word lays columns out itself, so the geometry is expressed as page size,
// margins and a 2-column section (PRD §3.3), and an explicit column break after
// every question keeps the reference rule: one question per column, two per page.
//
// Word reflows text, so line breaks will not land exactly where the PDF puts
// them. The invariants that matter — question order, one per column, the answer
// sheet on its own pages — are preserved.

import { writeFile } from 'node:fs/promises'
import {
  AlignmentType,
  ColumnBreak,
  Document,
  PageBreak,
  Packer,
  Paragraph,
  TextRun,
} from 'docx'

import { PRINT_GEOMETRY, pxToPt, type Answer, type Question, type QuestionDocument } from '@shared/types'

export interface DocxExportResult {
  filePath: string
  bytes: number
  questionCount: number
}

const ptToTwip = (pt: number): number => Math.round(pt * 20)
/** Word sizes runs in half-points, so 13px (9.75pt) lands on the nearest half. */
const pxToHalfPt = (px: number): number => Math.round(pxToPt(px) * 2)

const G = PRINT_GEOMETRY
/** Derived from the measured column positions rather than stored separately. */
const GUTTER_PT = G.rightColumnXPt - (G.leftColumnXPt + G.columnWidthPt)

function textRuns(text: string, sizePx = G.bodyFontPx): TextRun[] {
  // A literal newline inside a run does nothing in Word; break explicitly.
  return text.split('\n').map(
    (line, index) =>
      new TextRun({ text: line, size: pxToHalfPt(sizePx), ...(index > 0 ? { break: 1 } : {}) }),
  )
}

function body(text: string, options: { spacingBefore?: number } = {}): Paragraph {
  return new Paragraph({
    children: textRuns(text),
    spacing: {
      line: ptToTwip(G.lineHeightPt),
      lineRule: 'exact',
      ...(options.spacingBefore ? { before: ptToTwip(options.spacingBefore) } : {}),
    },
    alignment: AlignmentType.JUSTIFIED,
  })
}

/** Document title and subtitle — the only text at the title size and weight. */
function title(text: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text,
        size: pxToHalfPt(G.titleFontPx),
        bold: G.titleFontWeight >= 600,
        font: G.titleFontStack.split(',')[0]?.replace(/['"]/g, '').trim(),
      }),
    ],
    spacing: { line: ptToTwip(G.lineHeightPt), lineRule: 'exact' },
  })
}

/** Question headers sit at body size, like everything else on the sheet. */
function questionHeader(text: string): Paragraph {
  return new Paragraph({
    children: textRuns(text),
    spacing: { line: ptToTwip(G.lineHeightPt), lineRule: 'exact' },
  })
}

function questionParagraphs(question: Question): Paragraph[] {
  const paragraphs: Paragraph[] = [
    questionHeader(`< Question ${question.number} >  ${question.type}`),
    body(question.body, { spacingBefore: G.lineHeightPt }),
  ]
  question.options?.forEach((option, index) => {
    paragraphs.push(
      body(`(${index + 1})  ${option}`, { spacingBefore: index === 0 ? G.lineHeightPt : 0 }),
    )
  })
  if (question.wordBank?.length) {
    paragraphs.push(body(`Choose  =  ${question.wordBank.join('  ')}`, { spacingBefore: G.lineHeightPt }))
  }
  return paragraphs
}

function answerParagraphs(question: Question): Paragraph[] {
  const head = `< Answer ${question.number} >`
  const answer: Answer = question.answer
  switch (answer.kind) {
    case 'choice':
      return [body(`${head}  (${answer.choice})`, { spacingBefore: G.lineHeightPt })]
    case 'sentence':
      return [body(`${head}\n${answer.sentence}`, { spacingBefore: G.lineHeightPt })]
    case 'wordList':
      return [
        body(
          `${head}\n\n${answer.words.map((w) => `${w.n}) ${w.word}`).join('\n')}`,
          { spacingBefore: G.lineHeightPt },
        ),
      ]
  }
}

export class DocxExporter {
  async export(doc: QuestionDocument, filePath: string): Promise<DocxExportResult> {
    const children: Paragraph[] = []

    if (doc.title) children.push(title(doc.title))
    if (doc.subtitle) children.push(title(doc.subtitle))
    if (doc.title || doc.subtitle) children.push(body(''))

    doc.questions.forEach((question, index) => {
      children.push(...questionParagraphs(question))
      // One question per column: break after every question except the last.
      if (index < doc.questions.length - 1) {
        children.push(new Paragraph({ children: [new ColumnBreak()] }))
      }
    })

    // The answer sheet starts on a fresh page, still two columns.
    if (doc.questions.length) {
      children.push(new Paragraph({ children: [new PageBreak()] }))
      doc.questions.forEach((question) => children.push(...answerParagraphs(question)))
    }

    const document = new Document({
      sections: [
        {
          properties: {
            page: {
              size: { width: ptToTwip(G.pageWidthPt), height: ptToTwip(G.pageHeightPt) },
              margin: {
                top: ptToTwip(G.contentTopPt),
                left: ptToTwip(G.leftColumnXPt),
                right: ptToTwip(G.pageWidthPt - (G.rightColumnXPt + G.columnWidthPt)),
                bottom: ptToTwip(G.pageHeightPt - G.contentTopPt - G.answerColumnHeightPt),
              },
            },
            column: { count: 2, space: ptToTwip(GUTTER_PT), equalWidth: true },
          },
          children,
        },
      ],
    })

    const buffer = await Packer.toBuffer(document)
    await writeFile(filePath, buffer)
    return { filePath, bytes: buffer.byteLength, questionCount: doc.questions.length }
  }
}
