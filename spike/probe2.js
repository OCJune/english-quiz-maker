// Probe 2: is the empty output caused by the INPUT or by the ENVIRONMENT?
// Matrix of candidate passages x types, using both entry points.
// Control group = the exact sample paragraph the vendor manual documents as working.

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

// The vendor manual's own sample paragraph -- documented as producing output.
const MANUAL = 'Remove this paragraph and place here 1 single paragraph which you want to process. '
  + "If it doesn't work properly as expected, there are a few things you can consider. "
  + 'The number option indicates the number of options. '
  + 'The language option should properly meet the paragraph. '
  + 'The difficulty determines which vocabulary to blank out and to put in as options. '
  + 'It is recommended that the difficulty should meet the paragraph. '
  + 'Last but not least, not all browsers have been tested so try a different browser.';

const TYPES = ['Cloze', 'Multiple Choice', 'Scramble', 'Correct Sentence', 'Binary Word'];

async function main() {
  const mine = fs.readFileSync(path.join(__dirname, 'fixtures', 'passage.txt'), 'utf8').trim();

  const CASES = {
    'A default-TA1': 'Tested on latest Chrome and Opera browsers.',
    'B manual-sample': MANUAL,
    'C mine-1line': mine,
    'D mine-per-line': mine.replace(/(?<=\.) (?=[A-Z])/g, '\n'),
    'E manual-per-line': MANUAL.replace(/(?<=\.) (?=[A-Z])/g, '\n'),
    'F mine-blankline': mine.replace(/(?<=\.) (?=[A-Z])/g, '\n\n'),
  };

  const win = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  await win.loadFile(buildInstrumented());
  await sleep(800);
  const js = (c) => win.webContents.executeJavaScript(c, true);

  await js(`(() => {
    const set = (id, v, fn) => { const e = document.getElementById(id); e.value = v; if (fn) window[fn](); };
    set('productWordOption', '5', 'setOptionNumber');
    set('productWordDifficulty', 'Hard', 'setOptionDifficulty');
    set('productWordLanguage', 'English', 'setOptionLanguage');
    set('productWordOccupation', 'Teacher', 'setOptionOccupation');
    document.getElementById('optionToolConfirm').value = 'false';
    return true;
  })()`);

  const results = [];
  for (const [label, text] of Object.entries(CASES)) {
    log(`\n=== ${label}  (${text.length} chars, ${text.split('\n').length} lines) ===`);
    for (const type of TYPES) {
      const r = await js(`(() => {
        window.__spy.dialogs.length = 0; window.__spy.errors.length = 0;
        document.getElementById('productWordContentOriginal').value = ${JSON.stringify(text)};
        document.getElementById('productWordContentProcessed').value = '';
        let threw = null;
        try { window.generatePerformance(${JSON.stringify(type)}); } catch (e) { threw = String(e.message); }
        const v = document.getElementById('productWordContentProcessed').value;
        return { len: v.length, head: v.slice(0, 200), threw,
                 code: (typeof globalCode === 'undefined') ? null : globalCode,
                 dialogs: window.__spy.dialogs.slice(), errors: window.__spy.errors.slice() };
      })()`);
      await sleep(120);
      const v = await js(`document.getElementById('productWordContentProcessed').value`);
      const body = v.replace(/^\s*\S[^\n]*\n+/, ''); // strip the leading type label line
      const ok = body.trim().length > 40;
      results.push({ label, type, len: v.length, ok, code: r.code });
      log(`  ${ok ? 'GEN ' : '--- '} ${type.padEnd(17)} len=${String(v.length).padStart(5)} code=${r.code}` +
          `${r.threw ? ' threw=' + r.threw : ''}${r.dialogs.length ? ' dialogs=' + JSON.stringify(r.dialogs) : ''}` +
          `${r.errors.length ? ' errors=' + JSON.stringify(r.errors) : ''}`);
      if (ok) log(`        head: ${JSON.stringify(v.slice(0, 160))}`);
    }
  }

  log('\n=== summary: generated / attempted per case ===');
  for (const label of Object.keys(CASES)) {
    const rs = results.filter((r) => r.label === label);
    log(`  ${label.padEnd(18)} ${rs.filter((r) => r.ok).length}/${rs.length}`);
  }

  fs.writeFileSync(path.join(__dirname, 'out', 'probe2.json'), JSON.stringify(results, null, 2), 'utf8');
  win.destroy();
  app.exit(0);
}

app.whenReady().then(() => main().catch((e) => { log('ERR', e.stack); app.exit(2); }));
