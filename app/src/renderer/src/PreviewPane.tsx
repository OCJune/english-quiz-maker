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
  pageSizePx,
  renderPrintHtml,
  type FitDocument,
  type FitReport,
} from '@shared/print/layout'
import type { QuestionDocument } from '@shared/types'

const ZOOM_STEPS = [0.5, 0.65, 0.8, 1, 1.25, 1.5] as const

/** The print CSS is in pt; on-screen boxes are px. See pageSizePx. */
const PAGE = pageSizePx()

/** Horizontal padding of the scroll area (Tailwind p-4 on both sides). */
const SCROLL_PADDING_PX = 32

/** 'fit' follows the pane width; a number is a fixed zoom the user picked. */
type ZoomMode = 'fit' | number

interface Props {
  doc: QuestionDocument
  /** 1-based page to bring into view, e.g. the page of the question being edited. */
  focusPage?: number | null
  onFit?: (report: FitReport) => void
}

export default function PreviewPane({ doc, focusPage, onFit }: Props): React.JSX.Element {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [zoomMode, setZoomMode] = useState<ZoomMode>('fit')
  const [fitZoom, setFitZoom] = useState(0.65)
  const zoom = zoomMode === 'fit' ? fitZoom : zoomMode
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
    // The pane scrolls, not the frame. An inner scrollbar would steal 15px of
    // width and clip the page again.
    frameDoc.documentElement.style.overflow = 'hidden'
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

  // Fit mode: scale the page to the pane's width, and keep it fitted on resize.
  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    const update = (): void => {
      const available = container.clientWidth - SCROLL_PADDING_PX
      setFitZoom(Math.min(2, Math.max(0.3, available / PAGE.width)))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  // Scroll the selected question's page into view.
  useEffect(() => {
    const container = scrollRef.current
    if (!container || !focusPage) return
    container.scrollTo({ top: (focusPage - 1) * PAGE.height * zoom, behavior: 'smooth' })
  }, [focusPage, zoom])

  // Step from wherever the zoom is now, including a fitted value between steps.
  const step = (delta: number): void => {
    const next =
      delta > 0
        ? ZOOM_STEPS.find((z) => z > zoom + 1e-6)
        : [...ZOOM_STEPS].reverse().find((z) => z < zoom - 1e-6)
    if (next) setZoomMode(next)
  }
  const MIN_STEP = ZOOM_STEPS[0]
  const MAX_STEP = ZOOM_STEPS.at(-1) ?? MIN_STEP
  const canZoomOut = zoom > MIN_STEP + 1e-6
  const canZoomIn = zoom < MAX_STEP - 1e-6

  const frameWidth = PAGE.width
  const frameHeight = Math.max(1, pages) * PAGE.height
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
            onClick={() => setZoomMode('fit')}
            disabled={zoomMode === 'fit'}
            title="창 폭에 맞춤"
            className="mr-1 rounded border border-stone-300 px-2 py-0.5 disabled:bg-stone-900 disabled:text-white"
          >
            맞춤
          </button>
          <button
            type="button"
            onClick={() => step(-1)}
            disabled={!canZoomOut}
            className="rounded border border-stone-300 px-2 py-0.5 disabled:opacity-40"
          >
            −
          </button>
          <span className="w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            onClick={() => step(1)}
            disabled={!canZoomIn}
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

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto bg-stone-200 p-4"
        // Reserve the scrollbar's width up front, so fit mode does not oscillate
        // as the vertical scrollbar appears and disappears.
        style={{ scrollbarGutter: 'stable' }}
      >
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
