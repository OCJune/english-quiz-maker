// Probe 3: does the engine generate when the HTML file is PRISTINE?
// V1 = untouched engine file + preload dialog trap (no file modification).
// V2 = instrumented engine file (script injected into <head>), for comparison.
//
// Also dumps what the engine's own validation state looks like in each case.

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
window.alert = function (m) { window.__spy.dialogs.push({ kind: 'alert', msg: String(m) }); };
window.confirm = function (m) { window.__spy.dialogs.push({ kind: 'confirm', msg: String(m) }); return true; };
window.prompt = function (m, d) { window.__spy.dialogs.push({ kind: 'prompt', msg: String(m) }); return d == null ? '' : d; };
window.addEventListener('error', function (e) { window.__spy.errors.push(String(e.message)); });
</script>`;

function instrumented() {
  const src = fs.readFileSync(ENGINE_SRC, 'utf8');
  const at = src.indexOf('<head>');
  fs.mkdirSync(WORK, { recursive: true });
  const dst = path.join(WORK, 'engine.instrumented.html');
  fs.writeFileSync(dst, src.slice(0, at + 6) + '\n' + TRAP + src.slice(at + 6), 'utf8');
  return dst;
}

const TYPES = ['Cloze', 'Multiple Choice', 'Scramble', 'Correct Sentence'];

async function runVariant(name, file, webPreferences) {
  log(`\n######## ${name}`);
  log(`  file: ${path.basename(file)}  prefs: ${JSON.stringify(webPreferences)}`);
  const win = new BrowserWindow({ show: false, webPreferences });
  const dialogs = [];
  // If the trap fails, a real modal would block -- log that we got here instead.
  await win.loadFile(file);
  await sleep(900);
  const js = (c) => win.webContents.executeJavaScript(c, true);

  const state = await js(`({
    trapInstalled: typeof window.__spy === 'object',
    alertIsNative: /\\[native code\\]/.test(String(window.alert)),
    generate: typeof window.generatePerformance,
    flagValidate: (typeof flagValidate === 'undefined') ? 'undef' : flagValidate,
    globalFlagLoad: (typeof globalFlagLoad === 'undefined') ? 'undef' : globalFlagLoad,
    licenseLen: (typeof globalLicense === 'undefined') ? null : globalLicense.length,
    getLicenseLen: (() => { try { return String(window.getLicense()).length; } catch (e) { return 'threw:' + e.message; } })(),
    licenseMatches: (() => { try { return String(window.getLicense()) === String(globalLicense); } catch (e) { return 'threw'; } })(),
    dialogsAtLoad: (window.__spy && window.__spy.dialogs) || null,
  })`);
  log('  state:', JSON.stringify(state));

  const passage = fs.readFileSync(path.join(__dirname, 'fixtures', 'passage.txt'), 'utf8').trim();
  await js(`(() => {
    const set = (id, v, fn) => { const e = document.getElementById(id); e.value = v; if (fn) window[fn](); };
    set('productWordOption', '5', 'setOptionNumber');
    set('productWordDifficulty', 'Hard', 'setOptionDifficulty');
    set('productWordLanguage', 'English', 'setOptionLanguage');
    set('productWordOccupation', 'Teacher', 'setOptionOccupation');
    document.getElementById('optionToolConfirm').value = 'false';
    return true;
  })()`);

  let generated = 0;
  for (const type of TYPES) {
    await js(`(() => {
      if (window.__spy) { window.__spy.dialogs.length = 0; window.__spy.errors.length = 0; }
      document.getElementById('productWordContentOriginal').value = ${JSON.stringify(passage)};
      document.getElementById('productWordContentProcessed').value = '';
      try { window.generatePerformance(${JSON.stringify(type)}); } catch (e) {}
      return true;
    })()`);
    await sleep(200);
    const r = await js(`(() => {
      const v = document.getElementById('productWordContentProcessed').value;
      return { len: v.length, head: v.slice(0, 180),
               dialogs: (window.__spy && window.__spy.dialogs.slice()) || [],
               errors: (window.__spy && window.__spy.errors.slice()) || [] };
    })()`);
    const body = r.head.replace(/^\s*\S[^\n]*\n+/, '');
    const ok = r.len > 60 && body.trim().length > 20;
    if (ok) generated++;
    log(`  ${ok ? 'GEN ' : '--- '} ${type.padEnd(17)} len=${String(r.len).padStart(5)}` +
        `${r.dialogs.length ? ' dialogs=' + JSON.stringify(r.dialogs) : ''}` +
        `${r.errors.length ? ' errors=' + JSON.stringify(r.errors) : ''}`);
    if (ok) log(`        ${JSON.stringify(r.head.slice(0, 150))}`);
  }
  log(`  => generated ${generated}/${TYPES.length}`);
  win.destroy();
  return { name, state, generated, of: TYPES.length };
}

async function main() {
  const out = [];
  out.push(await runVariant(
    'V1  pristine HTML + preload trap',
    ENGINE_SRC,
    { nodeIntegration: false, contextIsolation: false, sandbox: true,
      backgroundThrottling: false, preload: path.join(__dirname, 'preload.js') }
  ));
  out.push(await runVariant(
    'V2  instrumented HTML, no preload',
    instrumented(),
    { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false }
  ));

  log('\n=== verdict ===');
  for (const r of out) log(`  ${r.name.padEnd(38)} ${r.generated}/${r.of}   flagValidate=${r.state.flagValidate}  licenseMatches=${r.state.licenseMatches}`);
  fs.writeFileSync(path.join(__dirname, 'out', 'probe3.json'), JSON.stringify(out, null, 2), 'utf8');
  app.exit(0);
}

setTimeout(() => { log('WATCHDOG TIMEOUT -- likely a blocking native dialog'); app.exit(3); }, 90000);
app.whenReady().then(() => main().catch((e) => { log('ERR', e.stack); app.exit(2); }));
