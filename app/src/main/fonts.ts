// Serves the bundled print fonts over a custom scheme.
//
// The print document is rendered in two places — a srcdoc iframe in the renderer
// and a hidden window in the exporter — and neither can reliably load `file://`
// font files: in development the renderer's origin is http://localhost, and a
// file:// subresource from an http origin is blocked. A privileged scheme works
// the same way in both, in dev and when packaged, so the preview and the PDF use
// the identical font.
//
// @font-face declares these under the real family names, so a bundled font wins
// over whatever happens to be installed and every machine prints the same.

import { protocol, net } from 'electron'
import { pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'

import { resolveResource } from './resources'

export const FONT_SCHEME = 'aria-font'

/** file name -> the family and weight it provides. */
export const BUNDLED_FONTS = [
  { file: 'Pretendard-Bold.otf', family: 'Pretendard', weight: 700, format: 'opentype' },
  { file: 'NotoSansKR-Regular.ttf', family: 'Noto Sans', weight: 400, format: 'truetype' },
] as const

/** Must run before app.whenReady(). */
export function registerFontScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: FONT_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
    },
  ])
}

/** Must run after app.whenReady(). */
export function serveFonts(): void {
  protocol.handle(FONT_SCHEME, (request) => {
    const name = new URL(request.url).pathname.replace(/^\/+/, '')
    const known = BUNDLED_FONTS.find((font) => font.file === name)
    if (!known) return new Response('not found', { status: 404 })

    let file: string
    try {
      file = resolveResource('fonts', known.file)
    } catch {
      return new Response('font not bundled', { status: 404 })
    }
    if (!existsSync(file)) return new Response('font not bundled', { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })
}

/** True when every bundled font is actually present — checked by the self-test. */
export function bundledFontsPresent(): { file: string; present: boolean }[] {
  return BUNDLED_FONTS.map((font) => {
    try {
      return { file: font.file, present: existsSync(resolveResource('fonts', font.file)) }
    } catch {
      return { file: font.file, present: false }
    }
  })
}
