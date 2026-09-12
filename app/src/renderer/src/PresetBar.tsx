// Presets — school-specific setups, saved inside the project folder so they
// travel with it between machines (PRD F1).

import { useState } from 'react'
import type { GenerationConfig, Preset } from '@shared/plan'

interface Props {
  presets: Preset[]
  current: GenerationConfig
  location: string | null
  onApply: (config: GenerationConfig) => void
  onSaved: () => void
  onError: (message: string) => void
}

export default function PresetBar({
  presets,
  current,
  location,
  onApply,
  onSaved,
  onError,
}: Props): React.JSX.Element {
  const [selected, setSelected] = useState('')
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')

  const apply = (presetName: string): void => {
    setSelected(presetName)
    const preset = presets.find((p) => p.name === presetName)
    if (preset) onApply(preset.config)
  }

  const save = async (): Promise<void> => {
    const trimmed = name.trim()
    if (!trimmed) {
      onError('프리셋 이름을 입력하세요')
      return
    }
    try {
      await window.aria.store.savePreset({ name: trimmed, config: current })
      setNaming(false)
      setName('')
      setSelected(trimmed)
      onSaved()
    } catch (e) {
      onError((e as Error).message)
    }
  }

  const remove = async (): Promise<void> => {
    if (!selected) return
    try {
      await window.aria.store.deletePreset(selected)
      setSelected('')
      onSaved()
    } catch (e) {
      onError((e as Error).message)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <select
          value={selected}
          onChange={(e) => apply(e.target.value)}
          className="min-w-0 flex-1 rounded border border-stone-300 px-2 py-1 text-sm"
        >
          <option value="">프리셋 선택…</option>
          {presets.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setNaming((v) => !v)}
          className="rounded border border-stone-300 bg-white px-2 py-1 text-sm"
        >
          저장
        </button>
        <button
          type="button"
          onClick={() => void remove()}
          disabled={!selected}
          className="rounded border border-stone-300 bg-white px-2 py-1 text-sm disabled:opacity-40"
        >
          삭제
        </button>
      </div>

      {naming ? (
        <div className="flex items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save()
              if (e.key === 'Escape') setNaming(false)
            }}
            placeholder="정의여고1"
            autoFocus
            className="min-w-0 flex-1 rounded border border-stone-300 px-2 py-1 text-sm"
          />
          <button
            type="button"
            onClick={() => void save()}
            className="rounded bg-stone-900 px-3 py-1 text-sm text-white"
          >
            확인
          </button>
        </div>
      ) : null}

      {location ? (
        <p className="truncate text-[11px] text-stone-400" title={location}>
          설정 저장 위치: {location}
        </p>
      ) : null}
    </div>
  )
}
