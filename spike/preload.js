// Runs before page scripts and shares the page's window (contextIsolation: false),
// so dialogs can be trapped WITHOUT modifying the engine HTML file.
window.__spy = { dialogs: [], errors: [] };
window.alert = function (m) { window.__spy.dialogs.push({ kind: 'alert', msg: String(m) }); };
window.confirm = function (m) { window.__spy.dialogs.push({ kind: 'confirm', msg: String(m) }); return true; };
window.prompt = function (m, d) { window.__spy.dialogs.push({ kind: 'prompt', msg: String(m) }); return d == null ? '' : d; };
window.addEventListener('error', function (e) { window.__spy.errors.push(String(e.message)); });
