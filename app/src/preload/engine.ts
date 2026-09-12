// Preload for the hidden ENGINE window.
//
// Runs before the engine's own scripts and shares the page's window object
// (contextIsolation: false), which is what lets us trap dialogs WITHOUT editing
// ariaenglish_offline_4.html. The engine always reports errors through alert()
// ("오류 메세지는 항상 출력됩니다" — vendor manual §32), and a native modal in a
// hidden window would block generation forever.

interface Dialog {
  kind: 'alert' | 'confirm' | 'prompt'
  msg: string
}

interface AriaTrap {
  installed: true
  dialogs: Dialog[]
  errors: string[]
  reset(): void
}

const trap: AriaTrap = {
  installed: true,
  dialogs: [],
  errors: [],
  reset() {
    trap.dialogs.length = 0
    trap.errors.length = 0
  },
}

const w = window as unknown as Record<string, unknown>
w.__ariaTrap = trap

window.alert = (msg?: unknown): void => {
  trap.dialogs.push({ kind: 'alert', msg: String(msg) })
  trap.errors.push(String(msg))
}
window.confirm = (msg?: unknown): boolean => {
  trap.dialogs.push({ kind: 'confirm', msg: String(msg) })
  return true // the engine is configured to Never Confirm; this is belt and braces
}
window.prompt = (msg?: unknown, def?: string): string | null => {
  trap.dialogs.push({ kind: 'prompt', msg: String(msg) })
  return def ?? ''
}
window.addEventListener('error', (e) => {
  trap.errors.push(e.message)
})
