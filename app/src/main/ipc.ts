// IPC wiring. Engine and export errors surface to the renderer as rejected
// invokes so the UI can report them instead of failing silently.

import { dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { EngineBridge } from './engine/EngineBridge'
import { countSentences, maxSentenceWords, normalizePassage } from './engine/transforms'
import { PdfExporter, type ExportResult } from './export/PdfExporter'
import { DocxExporter, type DocxExportResult } from './export/DocxExporter'
import { Store } from './store/Store'
import { resolveDataRoot } from './resources'
import type { Preset, SessionState } from '@shared/plan'
import type { GenerateOptions, GenerationRequest, QuestionDocument, QuestionType } from '@shared/types'

export function registerIpc(engine: EngineBridge, getWindow: () => BrowserWindow | null): void {
  const pdf = new PdfExporter()
  const docx = new DocxExporter()
  const store = new Store(resolveDataRoot())

  ipcMain.handle('engine:start', () => engine.start())

  ipcMain.handle('engine:selfTest', (_e, passage: string) => engine.selfTest(passage))

  ipcMain.handle('engine:generate', (_e, request: GenerationRequest) =>
    engine.generate(request, (done, total) => {
      getWindow()?.webContents.send('engine:progress', { done, total })
    }),
  )

  ipcMain.handle(
    'engine:generateOne',
    (_e, type: QuestionType, passage: string, options: GenerateOptions, exclude: string[] = []) =>
      engine.generateOne(type, passage, options, exclude),
  )

  ipcMain.handle('passage:normalize', (_e, text: string) => {
    const normalized = normalizePassage(text)
    return {
      text: normalized,
      sentences: countSentences(normalized),
      maxSentenceWords: maxSentenceWords(normalized),
    }
  })

  /**
   * Writes a PDF. Returns null when the user cancels the save dialog -- that is a
   * normal outcome, not an error.
   */
  /** Returns null when the user cancels — a normal outcome, not an error. */
  async function askWhereToSave(
    doc: QuestionDocument,
    extension: string,
    dialogTitle: string,
    filterName: string,
  ): Promise<string | null> {
    const parent = getWindow()
    const suggested = `${doc.title || '영어문제'}${doc.subtitle ? ` ${doc.subtitle}` : ''}.${extension}`
    const options = {
      title: dialogTitle,
      defaultPath: suggested.replace(/[\/:*?"<>|]/g, '_'),
      filters: [{ name: filterName, extensions: [extension] }],
    }
    const { canceled, filePath } = parent
      ? await dialog.showSaveDialog(parent, options)
      : await dialog.showSaveDialog(options)
    return canceled || !filePath ? null : filePath
  }

  ipcMain.handle(
    'export:pdf',
    async (_e, doc: QuestionDocument): Promise<ExportResult | null> => {
      const filePath = await askWhereToSave(doc, 'pdf', 'PDF로 내보내기', 'PDF')
      return filePath ? pdf.export(doc, filePath) : null
    },
  )

  // --- presets and session (kept inside the project folder, PRD F1/F2) ------

  ipcMain.handle('store:location', () => store.location)
  ipcMain.handle('store:loadSession', () => store.loadSession())
  ipcMain.handle('store:saveSession', (_e, state: Omit<SessionState, 'savedAt'>) =>
    store.saveSession(state),
  )
  ipcMain.handle('store:listPresets', () => store.listPresets())
  ipcMain.handle('store:savePreset', (_e, preset: Omit<Preset, 'updatedAt'>) =>
    store.savePreset(preset),
  )
  ipcMain.handle('store:deletePreset', (_e, name: string) => store.deletePreset(name))

  ipcMain.handle(
    'export:docx',
    async (_e, doc: QuestionDocument): Promise<DocxExportResult | null> => {
      const filePath = await askWhereToSave(doc, 'docx', 'DOCX로 내보내기', 'Word 문서')
      return filePath ? docx.export(doc, filePath) : null
    },
  )

  ipcMain.handle('shell:showItemInFolder', (_e, filePath: string) => {
    shell.showItemInFolder(filePath)
  })

  ipcMain.handle('shell:openPath', (_e, filePath: string) => shell.openPath(filePath))
}
