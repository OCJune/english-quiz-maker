// Preload for the app window. Exposes a narrow, typed IPC surface; the renderer
// never touches Electron or Node directly.

import { contextBridge, ipcRenderer } from 'electron'
import type {
  EngineContract,
  GenerateOptions,
  GenerationRequest,
  GenerationResult,
  Question,
  QuestionDocument,
  QuestionType,
  SelfTestResult,
} from '@shared/types'
import type { FitReport } from '@shared/print/layout'
import type { Preset, SessionState } from '@shared/plan'

export interface ProgressEvent {
  done: number
  total: number
}

export interface PdfExportResult {
  filePath: string
  bytes: number
  pageCount: number
  fit: FitReport
}

export interface DocxExportResult {
  filePath: string
  bytes: number
  questionCount: number
}

const api = {
  engine: {
    start: (): Promise<EngineContract> => ipcRenderer.invoke('engine:start'),
    selfTest: (passage: string): Promise<SelfTestResult> =>
      ipcRenderer.invoke('engine:selfTest', passage),
    generate: (request: GenerationRequest): Promise<GenerationResult> =>
      ipcRenderer.invoke('engine:generate', request),
    generateOne: (
      type: QuestionType,
      passage: string,
      options: GenerateOptions,
      /** Fingerprints already in the document, so the new question is not a repeat. */
      exclude: string[] = [],
    ): Promise<Question> =>
      ipcRenderer.invoke('engine:generateOne', type, passage, options, exclude),
    onProgress: (cb: (e: ProgressEvent) => void): (() => void) => {
      const listener = (_: unknown, e: ProgressEvent): void => cb(e)
      ipcRenderer.on('engine:progress', listener)
      return () => ipcRenderer.removeListener('engine:progress', listener)
    },
  },
  passage: {
    normalize: (
      text: string,
    ): Promise<{ text: string; sentences: number; maxSentenceWords: number }> =>
      ipcRenderer.invoke('passage:normalize', text),
  },
  exportPdf: (doc: QuestionDocument): Promise<PdfExportResult | null> =>
    ipcRenderer.invoke('export:pdf', doc),
  exportDocx: (doc: QuestionDocument): Promise<DocxExportResult | null> =>
    ipcRenderer.invoke('export:docx', doc),
  store: {
    location: (): Promise<string> => ipcRenderer.invoke('store:location'),
    loadSession: (): Promise<SessionState | null> => ipcRenderer.invoke('store:loadSession'),
    saveSession: (state: Omit<SessionState, 'savedAt'>): Promise<void> =>
      ipcRenderer.invoke('store:saveSession', state),
    listPresets: (): Promise<Preset[]> => ipcRenderer.invoke('store:listPresets'),
    savePreset: (preset: Omit<Preset, 'updatedAt'>): Promise<Preset> =>
      ipcRenderer.invoke('store:savePreset', preset),
    deletePreset: (name: string): Promise<void> => ipcRenderer.invoke('store:deletePreset', name),
  },
  shell: {
    showItemInFolder: (filePath: string): Promise<void> =>
      ipcRenderer.invoke('shell:showItemInFolder', filePath),
    openPath: (filePath: string): Promise<string> => ipcRenderer.invoke('shell:openPath', filePath),
  },
} as const

export type AriaApi = typeof api

contextBridge.exposeInMainWorld('aria', api)
