// PdfExporter — renders the shared print HTML in a hidden window and prints it.
//
// The HTML and the fit script come from src/shared/print/layout.ts, the very same
// code the on-screen preview uses, so the PDF matches what the user checked.

import { BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

import { buildFitScript, renderPrintHtml, type FitReport } from '@shared/print/layout'
import { PRINT_GEOMETRY, type QuestionDocument } from '@shared/types'

export interface ExportResult {
  filePath: string
  bytes: number
  pageCount: number
  fit: FitReport
}

export class PdfExporter {
  /**
   * @param doc      document to print
   * @param filePath destination .pdf path
   */
  async export(doc: QuestionDocument, filePath: string): Promise<ExportResult> {
    const html = renderPrintHtml(doc)
    const win = new BrowserWindow({
      show: false,
      width: Math.ceil(PRINT_GEOMETRY.pageWidthPt),
      height: Math.ceil(PRINT_GEOMETRY.pageHeightPt),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
        devTools: false,
        offscreen: false,
      },
    })

    try {
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      // Layout has to settle before measuring, or scrollHeight reads zero.
      await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)', true)

      const fit = (await win.webContents.executeJavaScript(buildFitScript(), true)) as FitReport
      const pageCount = (await win.webContents.executeJavaScript(
        `document.querySelectorAll('.page').length`,
        true,
      )) as number

      const pdf = await win.webContents.printToPDF({
        // preferCSSPageSize makes the @page rule in the print CSS authoritative,
        // which keeps the page exactly 595.32 x 841.92pt. Passing pageSize in
        // inches instead loses ~0.4pt of width to rounding.
        preferCSSPageSize: true,
        printBackground: true,
        // Page size and all spacing come from the print CSS.
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      })
      await writeFile(filePath, pdf)

      return { filePath, bytes: pdf.byteLength, pageCount, fit }
    } finally {
      win.destroy()
    }
  }

  /** Renders to HTML only — used by tests and for debugging the layout. */
  renderHtml(doc: QuestionDocument): string {
    return renderPrintHtml(doc)
  }

  /** file:// URL for a produced PDF, for opening it in the shell. */
  static fileUrl(filePath: string): string {
    return pathToFileURL(filePath).toString()
  }
}
