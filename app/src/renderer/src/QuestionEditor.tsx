// Hand-edit one question: body, options, Cloze word bank and the answer.
//
// The generated text is a starting point — anything the engine got slightly wrong
// can be fixed here, and the change flows straight into the preview and both
// exporters because they all read the same document model.

import { useEffect, useMemo, useState } from 'react'
import { toEdit, validateEdit, type QuestionEdit } from '@shared/document'
import type { Answer, Question } from '@shared/types'

interface Props {
  question: Question
  onSave: (edit: QuestionEdit) => void
  onCancel: () => void
}

export default function QuestionEditor({ question, onSave, onCancel }: Props): React.JSX.Element {
  const [edit, setEdit] = useState<QuestionEdit>(() => toEdit(question))

  // Re-seed when a different question is opened.
  useEffect(() => setEdit(toEdit(question)), [question])

  const issues = useMemo(() => validateEdit(edit), [edit])
  const patch = (next: Partial<QuestionEdit>): void => setEdit((prev) => ({ ...prev, ...next }))

  const setOption = (index: number, value: string): void => {
    const options = [...(edit.options ?? [])]
    options[index] = value
    patch({ options })
  }

  const setAnswer = (answer: Answer): void => patch({ answer })

  const setWord = (index: number, value: string): void => {
    if (edit.answer.kind !== 'wordList') return
    const words = edit.answer.words.map((w, i) => (i === index ? { ...w, word: value } : w))
    setAnswer({ kind: 'wordList', words })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div className="flex max-h-full w-full max-w-3xl flex-col rounded-lg bg-white shadow-xl">
        <header className="flex items-baseline gap-3 border-b border-stone-200 px-5 py-3">
          <h2 className="text-sm font-semibold">
            {`< Question ${question.number} >`} {question.type}
          </h2>
          <span className="text-xs text-stone-500">
            {question.meta.edited ? '수정됨' : '생성 직후'}
          </span>
          <span className="ml-auto text-xs text-stone-400">Esc 취소 · Ctrl+Enter 저장</span>
        </header>

        <div
          className="min-h-0 flex-1 space-y-4 overflow-auto px-5 py-4"
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancel()
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !issues.length) onSave(edit)
          }}
        >
          <label className="block text-sm">
            본문
            <textarea
              value={edit.body}
              onChange={(e) => patch({ body: e.target.value })}
              rows={12}
              autoFocus
              className="mt-1 w-full rounded border border-stone-300 p-2 font-mono text-xs leading-relaxed"
            />
          </label>

          {edit.options ? (
            <fieldset className="text-sm">
              <legend className="font-medium">선지</legend>
              <div className="mt-1 space-y-1">
                {edit.options.map((option, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <span className="w-8 shrink-0 text-right text-xs tabular-nums text-stone-500">
                      ({index + 1})
                    </span>
                    <input
                      value={option}
                      onChange={(e) => setOption(index, e.target.value)}
                      className="min-w-0 flex-1 rounded border border-stone-300 px-2 py-1 font-mono text-xs"
                    />
                    <button
                      type="button"
                      title="이 선지 삭제"
                      onClick={() => {
                        const options = edit.options!.filter((_, i) => i !== index)
                        const answer =
                          edit.answer.kind === 'choice' && edit.answer.choice > options.length
                            ? ({ kind: 'choice', choice: options.length } as Answer)
                            : edit.answer
                        patch({ options, answer })
                      }}
                      className="rounded border border-stone-300 px-1.5 text-xs text-red-700"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => patch({ options: [...(edit.options ?? []), ''] })}
                  className="rounded border border-stone-300 px-2 py-0.5 text-xs"
                >
                  선지 추가
                </button>
              </div>
            </fieldset>
          ) : null}

          {edit.wordBank ? (
            <label className="block text-sm">
              단어 목록 (Choose =) — 공백으로 구분
              <input
                value={edit.wordBank.join('  ')}
                onChange={(e) => patch({ wordBank: e.target.value.split(/\s+/).filter(Boolean) })}
                className="mt-1 w-full rounded border border-stone-300 px-2 py-1 font-mono text-xs"
              />
            </label>
          ) : null}

          <fieldset className="text-sm">
            <legend className="font-medium">정답</legend>
            {edit.answer.kind === 'choice' ? (
              <div className="mt-1 flex items-center gap-2">
                <span className="text-xs text-stone-500">선지 번호</span>
                <input
                  type="number"
                  min={1}
                  max={edit.options?.length || undefined}
                  value={edit.answer.choice}
                  onChange={(e) => setAnswer({ kind: 'choice', choice: Number(e.target.value) })}
                  className="w-20 rounded border border-stone-300 px-2 py-1"
                />
                {edit.options?.length ? (
                  <span className="truncate text-xs text-stone-500">
                    {edit.options[edit.answer.choice - 1] ?? '(해당 선지 없음)'}
                  </span>
                ) : null}
              </div>
            ) : null}

            {edit.answer.kind === 'sentence' ? (
              <textarea
                value={edit.answer.sentence}
                onChange={(e) => setAnswer({ kind: 'sentence', sentence: e.target.value })}
                rows={2}
                className="mt-1 w-full rounded border border-stone-300 p-2 font-mono text-xs"
              />
            ) : null}

            {edit.answer.kind === 'wordList' ? (
              <div className="mt-1 grid grid-cols-2 gap-1">
                {edit.answer.words.map((word, index) => (
                  <div key={word.n} className="flex items-center gap-1.5">
                    <span className="w-7 shrink-0 text-right text-xs tabular-nums text-stone-500">
                      {word.n})
                    </span>
                    <input
                      value={word.word}
                      onChange={(e) => setWord(index, e.target.value)}
                      className="min-w-0 flex-1 rounded border border-stone-300 px-2 py-0.5 font-mono text-xs"
                    />
                  </div>
                ))}
              </div>
            ) : null}
          </fieldset>

          {issues.length ? (
            <ul className="space-y-0.5 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
              {issues.map((issue, i) => (
                <li key={i}>⚠ {issue}</li>
              ))}
            </ul>
          ) : null}
        </div>

        <footer className="flex items-center gap-2 border-t border-stone-200 px-5 py-3">
          <p className="flex-1 text-xs text-stone-500">
            저장하면 미리보기와 PDF · DOCX 에 바로 반영됩니다. 이 문항을 다시 생성하면 수정 내용은
            사라집니다.
          </p>
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-stone-300 px-4 py-1.5 text-sm"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => onSave(edit)}
            disabled={issues.length > 0}
            className="rounded bg-stone-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            저장
          </button>
        </footer>
      </div>
    </div>
  )
}
