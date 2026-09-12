// Per-question review: reorder, drop, regenerate, or swap the type (PRD D2/D3).
//
// Regeneration goes through the engine again and is told the fingerprints already
// in the document, so a replacement is never a repeat of a question still on the page.

import { QUESTION_TYPES, type Question, type QuestionType } from '@shared/types'
import { pageOf } from '@shared/document'

interface Props {
  questions: Question[]
  busyId: string | null
  focusedId: string | null
  onFocus: (id: string) => void
  onMove: (id: string, delta: number) => void
  onRemove: (id: string) => void
  onRegenerate: (id: string, type: QuestionType) => void
  onEdit: (id: string) => void
}

export default function QuestionList({
  questions,
  busyId,
  focusedId,
  onFocus,
  onMove,
  onRemove,
  onRegenerate,
  onEdit,
}: Props): React.JSX.Element | null {
  if (!questions.length) return null

  return (
    <div className="border-t border-stone-200 pt-4">
      <p className="text-sm font-medium">
        문항 {questions.length}개
        <span className="ml-2 font-normal text-stone-500">{Math.ceil(questions.length / 2)}페이지</span>
      </p>

      <ul className="mt-2 space-y-1">
        {questions.map((question, index) => {
          const busy = busyId === question.id
          const shrunk = question.meta.appliedOptionCount
          return (
            <li
              key={question.id}
              className={`rounded border px-2 py-1.5 text-xs ${
                focusedId === question.id ? 'border-stone-900 bg-stone-50' : 'border-stone-200'
              } ${busy ? 'opacity-50' : ''}`}
            >
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onFocus(question.id)}
                  className="min-w-0 flex-1 truncate text-left"
                  title={`${question.number}번 문항 · ${pageOf(question)}페이지`}
                >
                  <span className="font-medium tabular-nums">{question.number}.</span>{' '}
                  {question.type}
                  {question.meta.edited ? (
                    <span className="ml-1 text-stone-500" title="직접 수정한 문항">
                      ✎
                    </span>
                  ) : null}
                  {question.warnings.length ? <span className="ml-1 text-amber-600">⚠</span> : null}
                </button>

                <button
                  type="button"
                  onClick={() => onMove(question.id, -1)}
                  disabled={busy || index === 0}
                  title="위로"
                  className="rounded border border-stone-300 px-1 leading-none disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => onMove(question.id, 1)}
                  disabled={busy || index === questions.length - 1}
                  title="아래로"
                  className="rounded border border-stone-300 px-1 leading-none disabled:opacity-30"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => onEdit(question.id)}
                  disabled={busy}
                  title="내용 직접 수정"
                  className="rounded border border-stone-300 px-1.5 leading-none disabled:opacity-30"
                >
                  ✎
                </button>
                <button
                  type="button"
                  onClick={() => onRegenerate(question.id, question.type)}
                  disabled={busy}
                  title="같은 유형으로 다시 생성"
                  className="rounded border border-stone-300 px-1.5 leading-none disabled:opacity-30"
                >
                  ↻
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(question.id)}
                  disabled={busy}
                  title="삭제"
                  className="rounded border border-stone-300 px-1.5 leading-none text-red-700 disabled:opacity-30"
                >
                  ✕
                </button>
              </div>

              {focusedId === question.id ? (
                <div className="mt-1.5 flex items-center gap-2 border-t border-stone-200 pt-1.5">
                  <label className="flex flex-1 items-center gap-1.5">
                    <span className="text-stone-500">유형 변경</span>
                    <select
                      value={question.type}
                      disabled={busy}
                      onChange={(e) => onRegenerate(question.id, e.target.value as QuestionType)}
                      className="min-w-0 flex-1 rounded border border-stone-300 px-1 py-0.5"
                    >
                      {QUESTION_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span className="text-stone-400">
                    {question.meta.appliedDifficulty} · opt {shrunk}
                  </span>
                </div>
              ) : null}

              {question.warnings.length && focusedId === question.id ? (
                <ul className="mt-1 space-y-0.5 text-amber-700">
                  {question.warnings.map((w, i) => (
                    <li key={i}>⚠ {w}</li>
                  ))}
                </ul>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
