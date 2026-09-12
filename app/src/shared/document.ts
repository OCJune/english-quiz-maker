// Document editing — reorder, drop and replace questions after generation (PRD D2/D3).
//
// Pure functions over the question list. Numbering is derived, never stored by
// hand: every operation returns a list renumbered 1..N so the question headers
// and the answer sheet can never drift apart.

import type { Answer, Question } from './types'

/** Renumber 1..N in place order. */
export function renumber(questions: readonly Question[]): Question[] {
  return questions.map((question, index) =>
    question.number === index + 1 ? question : { ...question, number: index + 1 },
  )
}

export function removeQuestion(questions: readonly Question[], id: string): Question[] {
  return renumber(questions.filter((q) => q.id !== id))
}

/** Replace one question, keeping its position. */
export function replaceQuestion(
  questions: readonly Question[],
  id: string,
  replacement: Question,
): Question[] {
  const index = questions.findIndex((q) => q.id === id)
  if (index < 0) return [...questions]
  const next = [...questions]
  next[index] = replacement
  return renumber(next)
}

/** Move a question by `delta` positions, clamped to the ends. */
export function moveQuestion(questions: readonly Question[], id: string, delta: number): Question[] {
  const from = questions.findIndex((q) => q.id === id)
  if (from < 0 || delta === 0) return [...questions]
  const to = Math.min(questions.length - 1, Math.max(0, from + delta))
  if (to === from) return [...questions]

  const next = [...questions]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved!)
  return renumber(next)
}

/** Fingerprints already in the document, so a regeneration does not repeat one. */
export function fingerprintsOf(questions: readonly Question[], exceptId?: string): string[] {
  return questions.filter((q) => q.id !== exceptId).map((q) => q.meta.targetFingerprint)
}

/** Which printed page a question lands on: two per page, one per column. */
export function pageOf(question: Question): number {
  return Math.ceil(question.number / 2)
}

// ---------------------------------------------------------------------------
// Hand editing (PRD D2 — the generated text is a starting point, not the last word)
// ---------------------------------------------------------------------------

/** The parts of a question the user may rewrite by hand. */
export interface QuestionEdit {
  body: string
  options?: string[]
  wordBank?: string[]
  answer: Answer
}

/**
 * Apply a hand edit. Marks the question as edited so the UI can warn that
 * regenerating would throw the changes away.
 */
export function updateQuestion(
  questions: readonly Question[],
  id: string,
  edit: QuestionEdit,
): Question[] {
  const index = questions.findIndex((q) => q.id === id)
  if (index < 0) return [...questions]

  const current = questions[index]!
  const next = [...questions]
  next[index] = {
    ...current,
    body: edit.body,
    // Empty lists are dropped so the renderers stay on the "no options" path.
    ...(edit.options?.length ? { options: edit.options } : { options: undefined }),
    ...(edit.wordBank?.length ? { wordBank: edit.wordBank } : { wordBank: undefined }),
    answer: edit.answer,
    meta: { ...current.meta, edited: true },
  }
  return renumber(next)
}

/**
 * Problems that would make a question print wrong. Reported in the editor rather
 * than blocking, except where the exporters would produce nonsense.
 */
export function validateEdit(edit: QuestionEdit): string[] {
  const issues: string[] = []

  if (!edit.body.trim()) issues.push('본문이 비어 있습니다')

  if (edit.options?.some((option) => !option.trim())) issues.push('빈 선지가 있습니다')

  switch (edit.answer.kind) {
    case 'choice': {
      const count = edit.options?.length ?? 0
      if (!Number.isInteger(edit.answer.choice) || edit.answer.choice < 1) {
        issues.push('정답 번호는 1 이상의 정수여야 합니다')
      } else if (count && edit.answer.choice > count) {
        issues.push(`정답 번호가 선지 수(${count})를 넘습니다`)
      }
      break
    }
    case 'sentence':
      if (!edit.answer.sentence.trim()) issues.push('정답 문장이 비어 있습니다')
      break
    case 'wordList': {
      if (!edit.answer.words.length) issues.push('정답 단어가 없습니다')
      if (edit.answer.words.some((w) => !w.word.trim())) issues.push('빈 정답 단어가 있습니다')
      const blanks = (edit.body.match(/\d+\)\s*_+/g) ?? []).length
      if (blanks && blanks !== edit.answer.words.length) {
        issues.push(`본문 빈칸 ${blanks}개와 정답 ${edit.answer.words.length}개가 맞지 않습니다`)
      }
      break
    }
  }
  return issues
}

/** Pull the editable parts out of a question, for seeding the editor. */
export function toEdit(question: Question): QuestionEdit {
  return {
    body: question.body,
    ...(question.options ? { options: [...question.options] } : {}),
    ...(question.wordBank ? { wordBank: [...question.wordBank] } : {}),
    answer:
      question.answer.kind === 'wordList'
        ? { kind: 'wordList', words: question.answer.words.map((w) => ({ ...w })) }
        : { ...question.answer },
  }
}
