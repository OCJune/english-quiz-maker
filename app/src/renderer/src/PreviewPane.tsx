// 2-column A4 preview.
//
// Renders the very same HTML the PDF exporter prints (src/shared/print/layout.ts)
// inside an iframe, then runs the shared fitting pass on it. What is on screen is
// what comes out of the printer.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  PRINT_GEOMETRY,
  fitDocument,
  fitOptionsFor,
  renderPrintHtml,
  type FitDocument,
  type FitReport,
} from '@shared/print/layout'
import type { QuestionDocument } from '@shared/types'

const ZOOM_STEPS = [0.5, 0.65, 0.8, 1, 1.25, 1.5] as const

interface Props {
  doc: QuestionDocument
  /** 1-based page to bring into view, e.g. the page of the question being edited. */
  focusPage?: number | null
  onFit?: (report: FitReport) => void
}

export default function PreviewPane({ doc, focusPage, onFit }: Props): React.JSX.Element {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(0.65)
  const [pages, setPages] = useState(0)
  const [fit, setFit] = useState<FitReport | null>(null)

  const html = renderPrintHtml(doc)

  // Fit once the iframe has laid the document out. Called directly rather than
  // eval'd, so the renderer's CSP needs no 'unsafe-eval'.
  const runFit = useCallback(() => {
    const frameDoc = frameRef.current?.contentDocument
    if (!frameDoc) return
    // The only cast in the preview path: a real Document satisfies FitDocument
    // structurally, but TS cannot see that across the two lib sets.
    const report = fitDocument(frameDoc as unknown as FitDocument, fitOptionsFor())
    setFit(report)
    setPages(frameDoc.querySelectorAll('.page').length)
    onFit?.(report)
  }, [onFit])

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    let cancelled = false
    const onLoad = (): void => {
      if (cancelled) return
      // Wait for webfont metrics before measuring, or heights read short.
      void frame.contentDocument?.fonts?.ready.then(() => {
        if (!cancelled) runFit()
      })
    }
    frame.addEventListener('load', onLoad)
    frame.srcdoc = html
    return () => {
      cancelled = true
      frame.removeEventListener('load', onLoad)
    }
  }, [html, runFit])

  // Scroll the selected question's page into view.
  useEffect(() => {
    const container = scrollRef.current
    if (!container || !focusPage) return
    container.scrollTo({ top: (focusPage - 1) * PRINT_GEOMETRY.pageHeightPt * zoom, behavior: 'smooth' })
  }, [focusPage, zoom])

  const zoomIndex = ZOOM_STEPS.indexOf(zoom as (typeof ZOOM_STEPS)[number])
  const step = (delta: number): void => {
    const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, zoomIndex + delta))]
    if (next) setZoom(next)
  }

  const frameWidth = PRINT_GEOMETRY.pageWidthPt
  const frameHeight = Math.max(1, pages) * PRINT_GEOMETRY.pageHeightPt
  const issues = fit ? fit.overflowing.length + (fit.answersTruncated ? 1 : 0) : 0

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-stone-200 bg-white px-3 py-2 text-xs">
        <span className="font-medium">미리보기</span>
        <span className="text-stone-500">
          {pages ? `${pages}페이지` : '—'}
          {fit ? ` · 정답지 ${fit.answerPagesUsed}페이지` : ''}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => step(-1)}
            disabled={zoomIndex <= 0}
            className="rounded border border-stone-300 px-2 py-0.5 disabled:opacity-40"
          >
            −
          </button>
          <span className="w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            onClick={() => step(1)}
            disabled={zoomIndex >= ZOOM_STEPS.length - 1}
            className="rounded border border-stone-300 px-2 py-0.5 disabled:opacity-40"
          >
            +
          </button>
        </div>
      </div>

      {fit && (fit.shrunk.length > 0 || issues > 0) ? (
        <div
          className={`border-b px-3 py-2 text-xs ${
            issues > 0 ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-800'
          }`}
        >
          {fit.shrunk.length > 0 ? (
            <p>
              단에 맞추려고 글자 크기를 줄인 문항:{' '}
              {fit.shrunk.map((s) => `${s.number}번 ${s.fontPx}px`).join(', ')}
            </p>
          ) : null}
          {fit.overflowing.length > 0 ? (
            <p>
              최소 {PRINT_GEOMETRY.minBodyFontPx}px 에서도 단을 넘치는 문항:{' '}
              {fit.overflowing.join(', ')}번 — 재생성을 권합니다
            </p>
          ) : null}
          {fit.answersTruncated ? <p>정답지 공간이 부족해 일부 항목이 배치되지 않았습니다</p> : null}
        </div>
      ) : null}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto bg-stone-200 p-4">
        {/* The iframe renders at true A4 size and is scaled; the wrapper reserves
            the scaled footprint so the scroll area is correct. */}
        <div
          className="mx-auto"
          style={{ width: frameWidth * zoom, height: frameHeight * zoom }}
        >
          <iframe
            ref={frameRef}
            title="문제지 미리보기"
            sandbox="allow-same-origin"
            className="block border-0 bg-white shadow"
            style={{
              width: frameWidth,
              height: frameHeight,
              transform: `scale(${zoom})`,
              transformOrigin: 'top left',
            }}
          />
        </div>
      </div>
    </div>
  )
}
