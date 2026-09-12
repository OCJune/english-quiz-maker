import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { EngineBridge } from './engine/EngineBridge'
import { bundledFontsPresent, registerFontScheme, serveFonts } from './fonts'
import { renderPrintHtml } from '@shared/print/layout'
import { PdfExporter } from './export/PdfExporter'
import { DocxExporter } from './export/DocxExporter'
import { registerIpc } from './ipc'
import { selfTestPassage } from './resources'
import { DEFAULT_GENERATE_OPTIONS, PRINT_GEOMETRY, QUESTION_TYPES } from '@shared/types'
import {
  fingerprintsOf,
  moveQuestion,
  removeQuestion,
  replaceQuestion,
  updateQuestion,
} from '@shared/document'
import { readFile } from 'node:fs/promises'
import AdmZip from 'adm-zip'

// A packaged app has no console, so an early failure would only show as an
// unexplained "Error" dialog. Record it where it can be read.
const crashLog = join(tmpdir(), 'ariaforge-crash.log')
function recordFatal(context: string, error: unknown): void {
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error)
  try {
    writeFileSync(crashLog, `[${new Date().toISOString()}] ${context}\n${detail}\n`, 'utf8')
  } catch {
    // Nothing useful to do.
  }
}
process.on('uncaughtException', (error) => recordFatal('uncaughtException', error))
process.on('unhandledRejection', (reason) => recordFatal('unhandledRejection', reason))

// Must happen before the app is ready, so the scheme is privileged.
registerFontScheme()

const engine = new EngineBridge()
let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    title: 'AriaForge',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devServer = process.env.ELECTRON_RENDERER_URL
  if (devServer) void mainWindow.loadURL(devServer)
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

/**
 * `--self-test` boots the engine, generates one question of every type and exits.
 * This is the guard PRD R8 asks for: the one-shot token recipe is undocumented
 * engine behaviour, so drift has to fail loudly rather than silently produce
 * nothing. Runs headless so it can be used from a terminal or CI.
 */
/**
 * Report sink for the headless check modes.
 *
 * A packaged Windows app is a GUI subsystem binary, so `process.stdout` never
 * reaches the terminal. `--report <file>` makes the checks usable against a
 * packaged build and in CI; without it they print as before.
 */
function createReporter(): (line: string) => void {
  const index = process.argv.indexOf('--report')
  const file = index >= 0 ? process.argv[index + 1] : undefined
  const lines: string[] = []
  if (file) {
    process.on('exit', () => {
      try {
        writeFileSync(file, `${lines.join('\n')}\n`, 'utf8')
      } catch {
        // Nothing useful to do while exiting.
      }
    })
  }
  return (line: string): void => {
    lines.push(line)
    process.stdout.write(`${line}\n`)
  }
}

async function runSelfTest(): Promise<number> {
  const out = createReporter()
  try {
    const contract = await engine.start()
    out(`engine contract OK — dialog trap ${contract.dialogTrapInstalled ? 'installed' : 'MISSING'}`)

    const result = await engine.selfTest(selfTestPassage())
    for (const r of result.perType) {
      out(
        `  ${r.ok ? 'OK  ' : 'FAIL'} ${r.type.padEnd(17)} ` +
          (r.ok ? `${r.attempts} attempt(s) ${r.ms}ms` : (r.error ?? 'unknown error')),
      )
    }
    const passed = result.perType.filter((r) => r.ok).length
    out(`\n${passed}/${result.perType.length} types generated`)
    out('\nengine attribution:')
    for (const line of contract.attribution) out(`  ${line}`)
    return result.ok ? 0 : 1
  } catch (err) {
    out(`SELF-TEST ERROR: ${String((err as Error).stack ?? err)}`)
    return 2
  }
}

/**
 * `--export-sample <path> [count]` runs the whole pipeline headlessly — generate,
 * lay out, print — so the produced PDF can be measured against the reference.
 */
async function runExportSample(filePath: string, count: number): Promise<number> {
  const out = createReporter()
  try {
    await engine.start()
    const passage = selfTestPassage()
    const plan = Array.from({ length: count }, (_, i) => QUESTION_TYPES[i % QUESTION_TYPES.length]!)
    const result = await engine.generate({ passage, plan, options: DEFAULT_GENERATE_OPTIONS })
    out(`generated ${result.questions.length}/${count}, failures ${result.failures.length}`)
    for (const failure of result.failures) out(`  FAIL ${failure.type}: ${failure.reason}`)
    if (!result.questions.length) return 1

    const exported = await new PdfExporter().export(
      {
        title: '미래엔(김) 1과 본문',
        subtitle: 'Section 1, 2',
        sourceText: passage,
        questions: result.questions,
        layout: PRINT_GEOMETRY,
      },
      filePath,
    )
    const docxPath = filePath.replace(/\.pdf$/i, '.docx')
    const docxResult = await new DocxExporter().export(
      {
        title: '미래엔(김) 1과 본문',
        subtitle: 'Section 1, 2',
        sourceText: passage,
        questions: result.questions,
        layout: PRINT_GEOMETRY,
      },
      docxPath,
    )
    out(`docx: ${docxResult.filePath} (${docxResult.bytes} bytes, ${docxResult.questionCount} questions)`)
    out(`pdf: ${exported.filePath}`)
    out(`pages: ${exported.pageCount}  bytes: ${exported.bytes}`)
    out(`fit: shrunk=${JSON.stringify(exported.fit.shrunk)} overflowing=${JSON.stringify(exported.fit.overflowing)}`)
    out(`     answerPagesUsed=${exported.fit.answerPagesUsed} removed=${exported.fit.answerPagesRemoved} truncated=${exported.fit.answersTruncated}`)
    return exported.fit.answersTruncated ? 1 : 0
  } catch (err) {
    out(`EXPORT SAMPLE ERROR: ${String((err as Error).stack ?? err)}`)
    return 2
  }
}

/**
 * `--edit-check` exercises per-question editing against the real engine:
 * generate a set, then regenerate several questions while excluding the
 * fingerprints already in the document, and confirm nothing repeats.
 */
async function runEditCheck(count: number): Promise<number> {
  const out = createReporter()
  try {
    await engine.start()
    const passage = selfTestPassage()
    const plan = Array.from({ length: count }, (_, i) => QUESTION_TYPES[i % QUESTION_TYPES.length]!)
    const result = await engine.generate({ passage, plan, options: DEFAULT_GENERATE_OPTIONS })
    let questions = result.questions
    out(`generated ${questions.length}/${count}`)

    let replaced = 0
    for (let i = 0; i < Math.min(6, questions.length); i++) {
      const target = questions[i]!
      const exclude = fingerprintsOf(questions, target.id)
      const fresh = await engine.generateOne(target.type, passage, DEFAULT_GENERATE_OPTIONS, exclude)
      if (exclude.includes(fresh.meta.targetFingerprint)) {
        out(`  DUPLICATE for ${target.type} — regeneration collided with an existing question`)
        return 1
      }
      questions = replaceQuestion(questions, target.id, fresh)
      replaced++
    }
    out(`regenerated ${replaced} questions, no duplicates`)

    questions = moveQuestion(questions, questions[0]!.id, 3)
    questions = removeQuestion(questions, questions[2]!.id)
    const numbers = questions.map((q) => q.number)
    const sequential = numbers.every((n, i) => n === i + 1)
    out(`after move+remove: ${questions.length} questions, numbering ${sequential ? 'OK' : 'BROKEN'}`)
    if (!sequential) return 1

    const prints = new Set(questions.map((q) => q.meta.targetFingerprint))
    out(`distinct fingerprints: ${prints.size}/${questions.length}`)
    return prints.size === questions.length ? 0 : 1
  } catch (err) {
    out(`EDIT CHECK ERROR: ${String((err as Error).stack ?? err)}`)
    return 2
  }
}

/**
 * `--edit-export-check` proves a hand edit reaches both exporters: generate,
 * rewrite one question's body, options and answer, then read the edit back out
 * of the produced PDF and DOCX.
 */
async function runEditExportCheck(dir: string): Promise<number> {
  const out = createReporter()
  const MARKER = 'HAND-EDITED BODY MARKER'
  const OPTION = 'hand-edited-option'
  try {
    await engine.start()
    const passage = selfTestPassage()
    const result = await engine.generate({
      passage,
      plan: ['Multiple Choice', 'Cloze', 'Scramble', 'Blank'],
      options: DEFAULT_GENERATE_OPTIONS,
    })
    if (result.questions.length < 4) {
      out(`only generated ${result.questions.length}/4`)
      return 1
    }

    const target = result.questions[0]!
    const edited = updateQuestion(result.questions, target.id, {
      body: `${MARKER}\n${target.body}`,
      options: [OPTION, 'second', 'third'],
      answer: { kind: 'choice', choice: 3 },
    })
    out(`edited question ${target.number} (${target.type}); edited flag = ${edited[0]!.meta.edited}`)

    const doc = {
      title: '수정 확인 문서',
      subtitle: 'Edited Section',
      sourceText: passage,
      questions: edited,
      layout: PRINT_GEOMETRY,
    }

    const pdfPath = `${dir}/edited.pdf`
    const docxPath = `${dir}/edited.docx`
    await new PdfExporter().export(doc, pdfPath)
    await new DocxExporter().export(doc, docxPath)

    const pdfBytes = await readFile(pdfPath)
    const docxXml = new AdmZip(await readFile(docxPath)).readAsText('word/document.xml')
    const docxText = docxXml.replace(/<[^>]+>/g, '')

    const checks: [string, boolean][] = [
      ['docx keeps the edited body', docxText.includes(MARKER)],
      ['docx keeps the edited option', docxText.includes(OPTION)],
      ['docx keeps the edited answer (3)', docxText.includes('Answer 1 ')],
      ['docx keeps the edited title', docxText.includes('수정 확인 문서')],
      ['pdf was written', pdfBytes.byteLength > 10000],
    ]
    for (const [label, ok] of checks) out(`  ${ok ? 'OK  ' : 'FAIL'} ${label}`)
    out(`pdf: ${pdfPath} (${pdfBytes.byteLength} bytes)`)
    return checks.every(([, ok]) => ok) ? 0 : 1
  } catch (err) {
    out(`EDIT EXPORT CHECK ERROR: ${String((err as Error).stack ?? err)}`)
    return 2
  }
}

/**
 * `--font-check` proves the bundled fonts are served and actually used by the
 * print document, rather than silently falling back to whatever is installed.
 */
async function runFontCheck(): Promise<number> {
  const out = createReporter()
  try {
    for (const f of bundledFontsPresent()) out(`  ${f.present ? 'OK  ' : 'FAIL'} bundled: ${f.file}`)
    if (bundledFontsPresent().some((f) => !f.present)) return 1

    const doc = {
      title: '미래엔(김) 1과 본문',
      subtitle: 'Section 1, 2',
      sourceText: '',
      questions: [],
      layout: PRINT_GEOMETRY,
    }
    const win = new BrowserWindow({
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
    })
    const html = renderPrintHtml(doc)
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)', true)

    interface FontReport {
      matched: number[]
      faces: { family: string; weight: string; status: string }[]
    }
    // A face stays "unloaded" until something on the page needs it, so ask for
    // each one explicitly: that is what proves the aria-font scheme serves it.
    const report = (await win.webContents.executeJavaScript(`(async () => {
      const requested = await Promise.all([
        document.fonts.load("700 16px 'Pretendard'"),
        document.fonts.load("400 13px 'Noto Sans'"),
      ]);
      return {
        matched: requested.map((faces) => faces.length),
        faces: [...document.fonts].map((f) => ({
          family: f.family, weight: f.weight, status: f.status,
        })),
      };
    })()`, true)) as FontReport

    out('')
    out('  @font-face entries loaded by the document:')
    for (const face of report.faces) out(`    ${face.family} ${face.weight} -> ${face.status}`)
    const allMatched = report.matched.length === 2 && report.matched.every((n) => n > 0)
    const allLoaded = report.faces.length === 2 && report.faces.every((f) => f.status === 'loaded')
    out(`  ${allMatched ? 'OK  ' : 'FAIL'} both families resolved to a bundled @font-face`)
    out(`  ${allLoaded ? 'OK  ' : 'FAIL'} both faces fetched over ${'aria-font://'} and loaded`)
    win.destroy()
    return allMatched && allLoaded ? 0 : 1
  } catch (err) {
    out(`FONT CHECK ERROR: ${String((err as Error).stack ?? err)}`)
    return 2
  }
}

app.whenReady().then(async () => {
  serveFonts()

  if (process.argv.includes('--font-check')) {
    const code = await runFontCheck()
    app.exit(code)
    return
  }

  const editExportFlag = process.argv.indexOf('--edit-export-check')
  if (editExportFlag >= 0) {
    const dir = process.argv[editExportFlag + 1]
    if (!dir) {
      process.stdout.write('usage: --edit-export-check <dir>\n')
      app.exit(2)
      return
    }
    const code = await runEditExportCheck(dir)
    engine.dispose()
    app.exit(code)
    return
  }

  const editFlag = process.argv.indexOf('--edit-check')
  if (editFlag >= 0) {
    const count = Number(process.argv[editFlag + 1] ?? '12')
    const code = await runEditCheck(Number.isFinite(count) ? count : 12)
    engine.dispose()
    app.exit(code)
    return
  }

  const sampleFlag = process.argv.indexOf('--export-sample')
  if (sampleFlag >= 0) {
    const target = process.argv[sampleFlag + 1]
    const count = Number(process.argv[sampleFlag + 2] ?? '8')
    if (!target) {
      process.stdout.write('usage: --export-sample <path.pdf> [count]\n')
      app.exit(2)
      return
    }
    const code = await runExportSample(target, Number.isFinite(count) ? count : 8)
    engine.dispose()
    app.exit(code)
    return
  }

  if (process.argv.includes('--self-test')) {
    const code = await runSelfTest()
    engine.dispose()
    app.exit(code)
    return
  }

  registerIpc(engine, () => mainWindow)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  engine.dispose()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => engine.dispose())
