// Probe: why does generatePerformance() leave only the type label in Text Area 3?
// Samples TA3 over time and dumps engine-internal globals.

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ENGINE_SRC = path.join(ROOT, 'ariaenglish', 'ariaenglish_offline_4.html');
const WORK = path.join(__dirname, '.work');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => process.stdout.write(a.join(' ') + '\n');

const TRAP = `<script>
window.__spy = { dialogs: [], errors: [] };
window.alert   = function (m) { window.__spy.dialogs.push({ kind: 'alert',   msg: String(m) }); };
window.confirm = function (m) { window.__spy.dialogs.push({ kind: 'confirm', msg: String(m) }); return true; };
window.prompt  = function (m, d) { window.__spy.dialogs.push({ kind: 'prompt', msg: String(m) }); return d == null ? '' : d; };
window.addEventListener('error', function (e) { window.__spy.errors.push(String(e.message)); });
</script>`;

function buildInstrumented() {
  const src = fs.readFileSync(ENGINE_SRC, 'utf8');
  const at = src.indexOf('<head>');
  const out = src.slice(0, at + 6) + '\n' + TRAP + src.slice(at + 6);
  fs.mkdirSync(WORK, { recursive: true });
  const dst = path.join(WORK, 'engine.instrumented.html');
  fs.writeFileSync(dst, out, 'utf8');
  return dst;
}

async function main() {
  const passage = fs.readFileSync(path.join(__dirname, 'fixtures', 'passage.txt'), 'utf8').trim();
  const win = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  await win.loadFile(buildInstrumented());
  await sleep(800);
  const js = (c) => win.webContents.executeJavaScript(c, true);

  // 1. Which global names look like engine state (non-obfuscated only)?
  const globals = await js(`(() => {
    const out = {};
    for (const k of Object.keys(window)) {
      if (/^_0x/.test(k)) continue;
      const t = typeof window[k];
      if (t === 'function') continue;
      if (!/^(global|flag|string|number|array|option|product|support)/i.test(k)) continue;
      let v = window[k];
      if (v && typeof v === 'object') { try { v = '[' + (Array.isArray(v) ? 'array:' + v.length : v.constructor && v.constructor.name) + ']'; } catch (e) { v = '[obj]'; } }
      else v = String(v).slice(0, 120);
      out[k] = t + ' = ' + v;
    }
    return out;
  })()`);
  log('--- engine globals (non-obfuscated, non-function) ---');
  for (const [k, v] of Object.entries(globals)) log('  ', k, ':', v);

  // 2. Set the passage and watch TA3 evolve over time.
  log('\n--- generatePerformance("Cloze") timeline ---');
  await js(`(() => {
    const ta1 = document.getElementById('productWordContentOriginal');
    ta1.value = ${JSON.stringify(passage)};
    ta1.dispatchEvent(new Event('input',  { bubbles: true }));
    ta1.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('productWordContentProcessed').value = '';
    window.__spy.dialogs.length = 0; window.__spy.errors.length = 0;
    return true;
  })()`);

  const before = await js(`({
    ta1len: document.getElementById('productWordContentOriginal').value.length,
    cached: (typeof globalStringProductContentOriginal === 'undefined') ? null : globalStringProductContentOriginal.length,
    flagValidate: (typeof flagValidate === 'undefined') ? null : flagValidate,
  })`);
  log('before:', JSON.stringify(before));

  const t0 = Date.now();
  const threw = await js(`(() => { try { window.generatePerformance('Cloze'); return null; } catch (e) { return String(e.message); } })()`);
  log('invoke threw:', threw, ' (', Date.now() - t0, 'ms )');

  for (const ms of [0, 50, 150, 400, 1000, 2000, 3000]) {
    await sleep(ms === 0 ? 0 : ms);
    const s = await js(`(() => {
      const v = document.getElementById('productWordContentProcessed').value;
      return { len: v.length, head: v.slice(0, 140), dialogs: window.__spy.dialogs.slice(), errors: window.__spy.errors.slice() };
    })()`);
    log(`  t+${String(Date.now() - t0).padStart(5)}ms len=${String(s.len).padStart(5)} head=${JSON.stringify(s.head)}` +
        `${s.dialogs.length ? ' dialogs=' + JSON.stringify(s.dialogs) : ''}${s.errors.length ? ' errors=' + JSON.stringify(s.errors) : ''}`);
  }

  const after = await js(`({
    cached: (typeof globalStringProductContentOriginal === 'undefined') ? null : globalStringProductContentOriginal.length,
    flagValidate: (typeof flagValidate === 'undefined') ? null : flagValidate,
    ta2: document.getElementById('supportTextArea1').value.length,
    ta4: document.getElementById('supportTextArea2').value.length,
  })`);
  log('after :', JSON.stringify(after));

  // 3. Does a real user click behave differently from the direct call?
  log('\n--- real click on #buttonCloze ---');
  await js(`(() => {
    document.getElementById('productWordContentProcessed').value = '';
    window.__spy.dialogs.length = 0;
    document.getElementById('buttonCloze').click();
    return true;
  })()`);
  await sleep(1200);
  const viaClick = await js(`(() => {
    const v = document.getElementById('productWordContentProcessed').value;
    return { len: v.length, head: v.slice(0, 300), dialogs: window.__spy.dialogs.slice() };
  })()`);
  log('  via click:', JSON.stringify(viaClick));

  win.destroy();
  app.exit(0);
}

app.whenReady().then(() => main().catch((e) => { log('ERR', e.stack); app.exit(2); }));
