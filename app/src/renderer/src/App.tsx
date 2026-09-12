// Generate -> review in a 2-column A4 preview -> export.
//
// Settings and the in-progress document are saved inside the project folder, so
// closing the app or carrying the folder to the other laptop loses nothing.

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_GENERATE_OPTIONS,
  PRINT_GEOMETRY,
  QUESTION_TYPES,
  type EngineContract,
  type GenerateOptions,
  type GenerationResult,
  type QuestionDocument,
  type QuestionType,
  type SelfTestResult,
} from '@shared/types'
import {
  DEFAULT_PLAN_CONFIG,
  buildPlan,
  type GenerationConfig,
  type PlanConfig,
  type Preset,
} from '@shared/plan'
import {
  fingerprintsOf,
  moveQuestion,
  pageOf,
  removeQuestion,
  replaceQuestion,
  updateQuestion,
  type QuestionEdit,
} from '@shared/document'
import type { Question } from '@shared/types'
import type { DocxExportResult, PdfExportResult } from '../../preload/index'
import ConfigPanel from './ConfigPanel'
import PresetBar from './PresetBar'
import PreviewPane from './PreviewPane'
import QuestionList from './QuestionList'
import QuestionEditor from './QuestionEditor'

const SAMPLE = `Volunteering at an Animal Sanctuary by Mia Watson. As the leader of our school club Care for Animals, I organized a volunteer trip to an animal sanctuary for my club members. An animal sanctuary is a special place where rescued, injured, or abused animals can live in a safe and caring environment. All the club members and I agreed that the sanctuary would be the perfect place to learn about animal care. Excited for a new experience, we set out to volunteer. July 29, Monday Our club arrived at the Free Animals sanctuary. Jane, the staff member in charge of animal care, welcomed us with a big smile and gave us a tour of the facility. It was amazing to see bears and elephants moving freely in a large field. Our tasks for the day included cleaning the shelter and preparing food for the animals. While cleaning the habitats, we checked if there were any hazards that could harm the animals. Then, we helped prepare the food by cutting up fruits and vegetables and dividing them into several large baskets. For old elephants with weak teeth, we chopped bananas instead of the sugarcane that they usually eat. Spending the whole day helping out with the animals was an incredible experience for me. It was a rewarding experience, and I was impressed with the attention the staff members gave to all the animals.`

const INITIAL_PLAN: PlanConfig = {
  ...DEFAULT_PLAN_CONFIG,
  selectedTypes: [...QUESTION_TYPES],
  perTypeCounts: Object.fromEntries(QUESTION_TYPES.map((t) => [t, 1])),
}

export default function App(): React.JSX.Element {
  const [contract, setContract] = useState<EngineContract | null>(null)
  const [status, setStatus] = useState('엔진 시작 중…')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  const [title, setTitle] = useState('미래엔(김) 1과 본문')
  const [subtitle, setSubtitle] = useState('Section 1, 2')
  const [passage, setPassage] = useState(SAMPLE)
  const [plan, setPlan] = useState<PlanConfig>(INITIAL_PLAN)
  const [options, setOptions] = useState<GenerateOptions>(DEFAULT_GENERATE_OPTIONS)

  const [stats, setStats] = useState<{ sentences: number; maxSentenceWords: number } | null>(null)
  const [presets, setPresets] = useState<Preset[]>([])
  const [storeLocation, setStoreLocation] = useState<string | null>(null)
  const [selfTest, setSelfTest] = useState<SelfTestResult | null>(null)
  const [result, setResult] = useState<GenerationResult | null>(null)
  /** The working document. Seeded by a generation run, then edited per question. */
  const [questions, setQuestions] = useState<Question[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  /** Question currently open in the hand editor. */
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null)
  const [exported, setExported] = useState<{ filePath: string; summary: string } | null>(null)

  const [restored, setRestored] = useState(false)
  const config = useMemo<GenerationConfig>(() => ({ plan, options }), [plan, options])

  // --- boot ---------------------------------------------------------------

  useEffect(() => {
    window.aria.engine
      .start()
      .then((c) => {
        setContract(c)
        setStatus('엔진 준비 완료')
      })
      .catch((e: Error) => setError(e.message))
    return window.aria.engine.onProgress(setProgress)
  }, [])

  const refreshPresets = useCallback(() => {
    window.aria.store
      .listPresets()
      .then(setPresets)
      .catch((e: Error) => setError(e.message))
  }, [])

  useEffect(() => {
    refreshPresets()
    window.aria.store.location().then(setStoreLocation).catch(() => setStoreLocation(null))
    window.aria.store
      .loadSession()
      .then((session) => {
        if (session) {
          setTitle(session.title)
          setSubtitle(session.subtitle)
          setPassage(session.passage)
          setPlan(session.config.plan)
          setOptions(session.config.options)
          setStatus('이전 작업을 복원했습니다')
        }
        setRestored(true)
      })
      .catch(() => {
        setRestored(true)
      })
  }, [refreshPresets])

  // Autosave, debounced. Only after a restore attempt, so a slow read cannot
  // overwrite the stored session with the defaults.
  useEffect(() => {
    if (!restored) return
    const timer = setTimeout(() => {
      void window.aria.store.saveSession({ title, subtitle, passage, config }).catch(() => undefined)
    }, 800)
    return () => clearTimeout(timer)
  }, [restored, title, subtitle, passage, config])

  useEffect(() => {
    window.aria.passage
      .normalize(passage)
      .then((r) => setStats({ sentences: r.sentences, maxSentenceWords: r.maxSentenceWords }))
      .catch(() => setStats(null))
  }, [passage])

  // --- derived ------------------------------------------------------------

  const unavailable = useMemo(() => {
    const reasons = new Map<QuestionType, string>()
    if (!stats) return reasons
    if (stats.sentences < 4) reasons.set('Shuffle', '문장 4개 이상 필요')
    if (stats.maxSentenceWords < 5) reasons.set('Scramble', '5단어 이상 문장 필요')
    return reasons
  }, [stats])

  /** Composition shown before generating; the real plan is rebuilt on generate. */
  const planPreview = useMemo(() => buildPlan(plan, unavailable).plan, [plan, unavailable])

  const doc = useMemo<QuestionDocument | null>(() => {
    if (!questions.length) return null
    return { title, subtitle, sourceText: passage, questions, layout: PRINT_GEOMETRY }
  }, [questions, title, subtitle, passage])

  const editingQuestion = useMemo(
    () => questions.find((q) => q.id === editingQuestionId) ?? null,
    [questions, editingQuestionId],
  )

  const focusedPage = useMemo(() => {
    const question = questions.find((q) => q.id === focusedId)
    return question ? pageOf(question) : null
  }, [questions, focusedId])

  // --- actions ------------------------------------------------------------

  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }, [])

  const onGenerate = (): void =>
    void run(async () => {
      const { plan: types, issues } = buildPlan(plan, unavailable)
      if (!types.length) throw new Error(issues.join(' / ') || '생성할 문항이 없습니다')
      setStatus(`${types.length}문항 생성 중…`)
      setExported(null)
      const r = await window.aria.engine.generate({ passage, plan: types, options })
      setResult(r)
      setQuestions(r.questions)
      setFocusedId(null)
      const notes = [
        `생성 ${r.questions.length}문항`,
        r.failures.length ? `실패 ${r.failures.length}` : null,
        r.duplicatesRejected ? `중복 폐기 ${r.duplicatesRejected}` : null,
        `${r.ms}ms`,
      ].filter(Boolean)
      setStatus(notes.join(' / '))
      if (issues.length) setError(issues.join(' / '))
    })

  const onExportPdf = (): void =>
    void run(async () => {
      if (!doc) throw new Error('먼저 문제를 생성하세요')
      setStatus('PDF 내보내기 중…')
      const r: PdfExportResult | null = await window.aria.exportPdf(doc)
      if (!r) {
        setStatus('내보내기 취소됨')
        return
      }
      const summary = `${r.pageCount}페이지, ${Math.round(r.bytes / 1024)} KB`
      setExported({ filePath: r.filePath, summary })
      setStatus(`PDF 저장 완료 — ${summary}`)
      if (r.fit.overflowing.length) {
        setError(`${r.fit.overflowing.join(', ')}번 문항이 단을 넘칩니다 — 재생성을 권합니다`)
      }
    })

  const onExportDocx = (): void =>
    void run(async () => {
      if (!doc) throw new Error('먼저 문제를 생성하세요')
      setStatus('DOCX 내보내기 중…')
      const r: DocxExportResult | null = await window.aria.exportDocx(doc)
      if (!r) {
        setStatus('내보내기 취소됨')
        return
      }
      const summary = `${r.questionCount}문항, ${Math.round(r.bytes / 1024)} KB`
      setExported({ filePath: r.filePath, summary })
      setStatus(`DOCX 저장 완료 — ${summary}`)
    })

  // --- per-question editing (PRD D2/D3) -----------------------------------

  const onMove = (id: string, delta: number): void => {
    setQuestions((prev) => moveQuestion(prev, id, delta))
    setFocusedId(id)
    setExported(null)
  }

  const onRemove = (id: string): void => {
    setQuestions((prev) => removeQuestion(prev, id))
    if (focusedId === id) setFocusedId(null)
    setExported(null)
  }

  const onEdit = (id: string): void => {
    setEditingQuestionId(id)
    setFocusedId(id)
  }

  const onSaveEdit = (id: string, edit: QuestionEdit): void => {
    setQuestions((prev) => updateQuestion(prev, id, edit))
    setEditingQuestionId(null)
    setExported(null)
    setStatus('문항을 수정했습니다')
  }

  const onRegenerate = (id: string, type: QuestionType): void => {
    const target = questions.find((q) => q.id === id)
    if (target?.meta.edited) {
      const ok = window.confirm(
        `${target.number}번 문항은 직접 수정한 내용이 있습니다. 다시 생성하면 수정 내용이 사라집니다. 계속할까요?`,
      )
      if (!ok) return
    }
    setEditingId(id)
    setError(null)
    setStatus(`${type} 재생성 중…`)
    void window.aria.engine
      .generateOne(type, passage, options, fingerprintsOf(questions, id))
      .then((question) => {
        setQuestions((prev) => replaceQuestion(prev, id, question))
        setFocusedId(question.id)
        setExported(null)
        setStatus(`${type} 재생성 완료`)
      })
      .catch((e: Error) => {
        setError(`재생성 실패 — ${e.message}`)
        setStatus('재생성 실패')
      })
      .finally(() => setEditingId(null))
  }

  const onSelfTest = (): void =>
    void run(async () => {
      setStatus('self-test 실행 중…')
      const r = await window.aria.engine.selfTest(passage)
      setSelfTest(r)
      setStatus(r.ok ? 'self-test 통과 (11/11)' : 'self-test 실패')
    })

  return (
    <div className="flex h-screen flex-col bg-stone-50 text-stone-900">
      <header className="border-b border-stone-200 bg-white px-6 py-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold">AriaForge</h1>
          <span className="text-xs text-stone-500">
            {status}
            {progress ? ` — ${progress.done}/${progress.total}` : ''}
          </span>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={onGenerate}
              disabled={busy || !contract || !planPreview.length}
              className="rounded bg-stone-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            >
              생성
            </button>
            <button
              type="button"
              onClick={onExportPdf}
              disabled={busy || !doc}
              className="rounded border border-stone-400 bg-white px-4 py-1.5 text-sm font-medium disabled:opacity-40"
            >
              PDF
            </button>
            <button
              type="button"
              onClick={onExportDocx}
              disabled={busy || !doc}
              className="rounded border border-stone-400 bg-white px-4 py-1.5 text-sm font-medium disabled:opacity-40"
            >
              DOCX
            </button>
            <button
              type="button"
              onClick={onSelfTest}
              disabled={busy || !contract}
              className="rounded border border-stone-300 bg-white px-3 py-1.5 text-sm disabled:opacity-40"
            >
              self-test
            </button>
          </div>
        </div>

        {error ? (
          <p className="mt-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {error}
          </p>
        ) : null}

        {exported ? (
          <p className="mt-2 flex items-center gap-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            <span className="min-w-0 flex-1 truncate" title={exported.filePath}>
              {exported.filePath}
              <span className="ml-2 text-emerald-700">{exported.summary}</span>
            </span>
            <button
              type="button"
              onClick={() => void window.aria.shell.openPath(exported.filePath)}
              className="rounded border border-emerald-300 bg-white px-2 py-0.5 text-xs"
            >
              열기
            </button>
            <button
              type="button"
              onClick={() => void window.aria.shell.showItemInFolder(exported.filePath)}
              className="rounded border border-emerald-300 bg-white px-2 py-0.5 text-xs"
            >
              폴더에서 보기
            </button>
          </p>
        ) : null}
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-[380px_1fr]">
        <section className="min-h-0 space-y-5 overflow-auto border-r border-stone-200 bg-white p-4">
          <PresetBar
            presets={presets}
            current={config}
            location={storeLocation}
            onApply={(c) => {
              setPlan(c.plan)
              setOptions(c.options)
              setStatus('프리셋을 적용했습니다')
            }}
            onSaved={refreshPresets}
            onError={setError}
          />

          <div className="grid gap-2 border-t border-stone-200 pt-4">
            <label className="block text-sm">
              제목
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="미래엔(김) 1과 본문"
                className="mt-1 w-full rounded border border-stone-300 px-2 py-1"
              />
            </label>
            <label className="block text-sm">
              부제목
              <input
                value={subtitle}
                onChange={(e) => setSubtitle(e.target.value)}
                placeholder="Section 1, 2"
                className="mt-1 w-full rounded border border-stone-300 px-2 py-1"
              />
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium" htmlFor="passage">
              지문
            </label>
            <textarea
              id="passage"
              value={passage}
              onChange={(e) => setPassage(e.target.value)}
              rows={8}
              className="mt-1 w-full rounded border border-stone-300 bg-white p-2 font-mono text-xs"
            />
            <p className="mt-1 text-xs text-stone-500">
              {passage.length}자
              {stats ? ` · 문장 ${stats.sentences}개 · 최장 문장 ${stats.maxSentenceWords}단어` : ''}
            </p>
          </div>

          <ConfigPanel
            plan={plan}
            options={options}
            unavailable={unavailable}
            preview={planPreview}
            onPlanChange={setPlan}
            onOptionsChange={setOptions}
          />

          <QuestionList
            questions={questions}
            busyId={editingId}
            focusedId={focusedId}
            onFocus={(id) => setFocusedId((prev) => (prev === id ? null : id))}
            onMove={onMove}
            onRemove={onRemove}
            onRegenerate={onRegenerate}
            onEdit={onEdit}
          />

          {result?.failures.length ? (
            <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs">
              <p className="font-semibold">실패 {result.failures.length}건</p>
              <ul className="mt-1 space-y-0.5">
                {result.failures.map((f, i) => (
                  <li key={i}>
                    <b>{f.type}</b> — {f.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {selfTest ? (
            <div className="rounded border border-stone-200 p-3">
              <p className="text-xs font-semibold">self-test</p>
              <ul className="mt-1 text-xs">
                {selfTest.perType.map((r) => (
                  <li key={r.type} className="flex justify-between gap-2 py-0.5">
                    <span className={r.ok ? '' : 'text-red-700'}>{r.type}</span>
                    <span className="text-stone-500">
                      {r.ok ? `${r.attempts}회 ${r.ms}ms` : (r.error ?? '실패')}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {contract ? (
            <div className="border-t border-stone-200 pt-3 text-[11px] leading-snug text-stone-500">
              <p className="font-medium">생성 엔진</p>
              {contract.attribution.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          ) : null}
        </section>

        {doc ? (
          <PreviewPane doc={doc} focusPage={focusedPage} />
        ) : (
          <section className="flex items-center justify-center text-sm text-stone-400">
            문제를 생성하면 2단 A4 미리보기가 표시됩니다
          </section>
        )}
      </main>

      {editingQuestion ? (
        <QuestionEditor
          question={editingQuestion}
          onSave={(edit) => onSaveEdit(editingQuestion.id, edit)}
          onCancel={() => setEditingQuestionId(null)}
        />
      ) : null}
    </div>
  )
}
