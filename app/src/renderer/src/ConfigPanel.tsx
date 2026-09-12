// Generation settings: which types, how many, and the two output variants.
//
// Two planning modes, both from the requirements interview (PRD D4):
//   random — a total, spread evenly over the selected types
//   manual — an explicit count per type

import {
  TYPE_GROUPS,
  type Difficulty,
  type GenerateOptions,
  type OptionCount,
  type QuestionType,
} from '@shared/types'
import { planSummary, type Ordering, type PlanConfig, type PlanMode } from '@shared/plan'

interface Props {
  plan: PlanConfig
  options: GenerateOptions
  unavailable: ReadonlyMap<QuestionType, string>
  preview: QuestionType[]
  onPlanChange: (next: PlanConfig) => void
  onOptionsChange: (next: GenerateOptions) => void
}

export default function ConfigPanel({
  plan,
  options,
  unavailable,
  preview,
  onPlanChange,
  onOptionsChange,
}: Props): React.JSX.Element {
  const setPlan = (patch: Partial<PlanConfig>): void => onPlanChange({ ...plan, ...patch })
  const setOptions = (patch: Partial<GenerateOptions>): void =>
    onOptionsChange({ ...options, ...patch })

  const toggleType = (type: QuestionType): void =>
    setPlan({
      selectedTypes: plan.selectedTypes.includes(type)
        ? plan.selectedTypes.filter((t) => t !== type)
        : [...plan.selectedTypes, type],
    })

  const setCount = (type: QuestionType, count: number): void =>
    setPlan({ perTypeCounts: { ...plan.perTypeCounts, [type]: Math.max(0, count) } })

  const manualTotal = plan.selectedTypes.reduce((sum, t) => sum + (plan.perTypeCounts[t] ?? 0), 0)
  const clozeSelected = plan.selectedTypes.includes('Cloze')

  return (
    <div className="space-y-5">
      <fieldset>
        <legend className="text-sm font-medium">출제 방식</legend>
        <div className="mt-2 flex gap-2">
          {(
            [
              ['random', '랜덤 배분'],
              ['manual', '유형별 지정'],
            ] as [PlanMode, string][]
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => setPlan({ mode })}
              className={`flex-1 rounded border px-3 py-1.5 text-sm ${
                plan.mode === mode
                  ? 'border-stone-900 bg-stone-900 text-white'
                  : 'border-stone-300 bg-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-medium">
          유형
          {plan.mode === 'manual' ? (
            <span className="ml-2 font-normal text-stone-500">합계 {manualTotal}문항</span>
          ) : null}
        </legend>
        <div className="mt-2 space-y-3">
          {Object.entries(TYPE_GROUPS).map(([group, types]) => (
            <div key={group}>
              <p className="text-xs font-medium text-stone-500">{group}</p>
              <div className="mt-1 space-y-1">
                {types.map((type) => {
                  const reason = unavailable.get(type)
                  const checked = plan.selectedTypes.includes(type)
                  return (
                    <div key={type} className="flex items-center gap-2">
                      <label
                        className={`flex flex-1 items-center gap-2 text-sm ${reason ? 'text-stone-400' : ''}`}
                        title={reason ?? ''}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!!reason}
                          onChange={() => toggleType(type)}
                        />
                        {type}
                        {reason ? <span className="text-xs">— {reason}</span> : null}
                      </label>
                      {plan.mode === 'manual' ? (
                        <input
                          type="number"
                          min={0}
                          max={50}
                          value={plan.perTypeCounts[type] ?? 0}
                          disabled={!checked || !!reason}
                          onChange={(e) => setCount(type, Number(e.target.value))}
                          className="w-16 rounded border border-stone-300 px-2 py-0.5 text-right text-sm disabled:bg-stone-100 disabled:text-stone-400"
                        />
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-3 text-sm">
        {plan.mode === 'random' ? (
          <label className="block">
            총 문항 수
            <input
              type="number"
              min={1}
              max={100}
              value={plan.totalCount}
              onChange={(e) => setPlan({ totalCount: Number(e.target.value) })}
              className="mt-1 w-full rounded border border-stone-300 px-2 py-1"
            />
          </label>
        ) : null}

        <label className="block">
          난이도
          <select
            value={options.difficulty}
            onChange={(e) => setOptions({ difficulty: e.target.value as Difficulty })}
            className="mt-1 w-full rounded border border-stone-300 px-2 py-1"
          >
            <option>Hard</option>
            <option>Normal</option>
            <option>Easy</option>
          </select>
        </label>

        <label className="block">
          출제 순서
          <select
            value={plan.ordering}
            onChange={(e) => setPlan({ ordering: e.target.value as Ordering })}
            className="mt-1 w-full rounded border border-stone-300 px-2 py-1"
          >
            <option value="shuffled">랜덤 섞기</option>
            <option value="grouped">유형별 묶음</option>
          </select>
        </label>

        <label className="block">
          {clozeSelected ? '빈칸 빈도' : '보기 개수'}
          <select
            value={options.optionCount}
            onChange={(e) => setOptions({ optionCount: Number(e.target.value) as OptionCount })}
            className="mt-1 w-full rounded border border-stone-300 px-2 py-1"
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        <label className="col-span-2 block">
          Scramble 방식
          <select
            value={options.scrambleMode}
            onChange={(e) =>
              setOptions({ scrambleMode: e.target.value as GenerateOptions['scrambleMode'] })
            }
            className="mt-1 w-full rounded border border-stone-300 px-2 py-1"
          >
            <option value="choice">객관식 (선지에서 고르기)</option>
            <option value="openEnded">서술형 (단어 배열, 정답은 문장)</option>
          </select>
        </label>
      </div>

      <div className="space-y-1 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={options.clozeWordList}
            onChange={(e) => setOptions({ clozeWordList: e.target.checked })}
          />
          Cloze 단어 목록 표시
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={options.clozeRenumber}
            onChange={(e) => setOptions({ clozeRenumber: e.target.checked })}
          />
          Cloze 빈칸 번호 재정렬
        </label>
      </div>

      {preview.length ? (
        <div className="rounded border border-stone-200 bg-stone-50 p-2 text-xs">
          <p className="font-medium">
            생성 예정 {preview.length}문항
            <span className="ml-2 font-normal text-stone-500">
              {plan.ordering === 'grouped' ? '유형별 묶음' : '랜덤 섞기'}
            </span>
          </p>
          <p className="mt-1 text-stone-600">
            {planSummary(preview)
              .map((s) => `${s.type} ${s.count}`)
              .join(' · ')}
          </p>
        </div>
      ) : null}
    </div>
  )
}
