// S1/S2 spike — drive ariaenglish_offline_4.html from a hidden Electron BrowserWindow.
//
// INVOCATION RECIPE (established by probe4/probe5):
//   The generators are gated on a one-shot token: getXxx(content, code) returns ''
//   unless `flagValidate === true && code === globalCode`. The token is armed only
//   when generatePerformance() runs through a button's event path, and it is
//   consumed on success. So:
//     * calling window.generatePerformance(type) directly NEVER works  (0/33)
//     * dispatching a click on the type's button works                 (32/33)
//     * the single failure is the first dispatch after page load -- a throwaway
//       "prime" that arms the token
//   Therefore every generation dispatches a click, and a failed attempt is retried
//   (the failed attempt itself arms the token for the retry).
//
// S1: contract + dialog traps + all 11 types produce real output.
// S2: golden corpus over 11 types x 3 difficulties x 3 option counts, engine
//     auto-adjustment behaviour, output-variety probe, and the stack/number format.

const { app, BrowserWindow, session } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ENGINE_SRC = path.join(ROOT, 'ariaenglish', 'ariaenglish_offline_4.html');
const PASSAGE = path.join(__dirname, 'fixtures', 'passage.txt');
const OUT = path.join(__dirname, 'out');

const BUTTONS = {
  'Scramble': 'buttonScramble',
  'Shuffle': 'buttonShuffle',
  'Missing Sentence': 'buttonMissingSentence',
  'Wrong Sentence': 'buttonWrongSentence',
  'Correct Sentence': 'buttonCorrectSentence',
  'Multiple Choice': 'buttonMultipleChoice',
  'Blank': 'buttonBlank',
  'Binary Word': 'buttonBinaryWord',
  'Wrong Word': 'buttonWrongWord',
  'Correct Word': 'buttonCorrectWord',
  'Cloze': 'buttonCloze',
};
const TYPES = Object.keys(BUTTONS);
const DIFFICULTIES = ['Hard', 'Normal', 'Easy'];
const OPTION_COUNTS = ['1', '3', '5'];

const MODE = (process.argv.find((a) => a.startsWith('--mode=')) || '--mode=s1').split('=')[1];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => process.stdout.write(a.join(' ') + '\n');

// A label-only result looks like "\nCloze\n\n"; a real one is >1.5KB.
function splitLabel(raw) {
  const m = raw.match(/^\s*([^\n]+)\n+/);
  return { label: m ? m[1].trim() : null, body: m ? raw.slice(m[0].length) : raw };
}
const isReal = (raw) => splitLabel(raw).body.trim().length > 100;

class Engine {
  constructor(win) { this.win = win; }
  js(code) { return this.win.webContents.executeJavaScript(code, true); }

  contract() {
    return this.js(`(() => {
      const fns = ['load','generatePerformance','randomGenerate','stackContent','applyNumber',
                   'setOptionNumber','setOptionDifficulty','setOptionLanguage','setOptionOccupation',
                   'getLicense','saveContent','loadContent','replaceTextArea'];
      const ids = ['productWordContentOriginal','productWordContentProcessed',
                   'supportTextArea1','supportTextArea2','supportTextArea3','supportTextArea4',
                   'productWordOption','productWordDifficulty','productWordLanguage',
                   'productWordOccupation','optionToolConfirm','buttonStack','buttonApplyNumber',
                   ${TYPES.map((t) => JSON.stringify(BUTTONS[t])).join(',')}];
      const safe = (f) => { try { return f(); } catch (e) { return 'threw:' + e.message; } };
      return {
        fns: Object.fromEntries(fns.map((f) => [f, typeof window[f]])),
        missingFns: fns.filter((f) => typeof window[f] !== 'function'),
        missingIds: ids.filter((i) => !document.getElementById(i)),
        trapInstalled: typeof window.__spy === 'object',
        alertIsNative: /\\[native code\\]/.test(String(window.alert)),
        license: {
          banner: safe(() => String(globalLicense).split('\\n')[0]),
          matchesGetLicense: safe(() => String(window.getLicense()) === String(globalLicense)),
        },
        tokenAtLoad: safe(() => ({ flagValidate: flagValidate, globalCode: globalCode })),
        dialogsAtLoad: (window.__spy && window.__spy.dialogs.slice()) || null,
        errorsAtLoad: (window.__spy && window.__spy.errors.slice()) || null,
      };
    })()`);
  }

  setOptions({ difficulty, optionCount, language = 'English', occupation = 'Teacher' }) {
    const a = JSON.stringify({ difficulty, optionCount, language, occupation });
    return this.js(`(() => {
      const o = ${a};
      const set = (id, v, fn) => {
        const el = document.getElementById(id);
        el.value = v;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        if (fn) { try { window[fn](); } catch (e) { return 'threw:' + e.message; } }
        return el.value;
      };
      set('productWordOption', o.optionCount, 'setOptionNumber');
      set('productWordDifficulty', o.difficulty, 'setOptionDifficulty');
      set('productWordLanguage', o.language, 'setOptionLanguage');
      set('productWordOccupation', o.occupation, 'setOptionOccupation');
      document.getElementById('optionToolConfirm').value = 'false';
      // Engine-internal values actually in force (may be auto-adjusted downward).
      const g = (n) => { try { return eval(n); } catch (e) { return null; } };
      return { engineOption: g('numberOption'), engineDifficulty: g('stringDifficulty'),
               engineLanguage: g('stringLanguage'), engineOccupation: g('stringOccupation') };
    })()`);
  }

  // One dispatch attempt through the button's event path.
  attempt(type, passage) {
    return this.js(`(() => {
      if (window.__spy) { window.__spy.dialogs.length = 0; window.__spy.errors.length = 0; }
      const ta1 = document.getElementById('productWordContentOriginal');
      const ta3 = document.getElementById('productWordContentProcessed');
      ta1.value = ${JSON.stringify(passage)};
      ta3.value = '';
      const g = (n) => { try { return eval(n); } catch (e) { return null; } };
      const before = { flag: g('flagValidate'), code: g('globalCode') };
      let threw = null;
      try {
        document.getElementById(${JSON.stringify(BUTTONS[type])})
          .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      } catch (e) { threw = String(e.message); }
      return { raw: ta3.value, threw, before,
               after: { flag: g('flagValidate'), code: g('globalCode') },
               engineOption: g('numberOption'), engineDifficulty: g('stringDifficulty'),
               dialogs: (window.__spy && window.__spy.dialogs.slice()) || [],
               errors: (window.__spy && window.__spy.errors.slice()) || [] };
    })()`);
  }

  // Robust generate: a failed attempt arms the token, so retry absorbs priming.
  async generate(type, passage, maxAttempts = 4) {
    const t0 = Date.now();
    const tries = [];
    for (let i = 0; i < maxAttempts; i++) {
      const r = await this.attempt(type, passage);
      tries.push({ flag: `${r.before.flag}->${r.after.flag}`, chars: r.raw.length, threw: r.threw });
      if (isReal(r.raw)) {
        return { type, ok: true, attempts: i + 1, ms: Date.now() - t0, raw: r.raw,
                 ...splitLabel(r.raw), engineOption: r.engineOption,
                 engineDifficulty: r.engineDifficulty, dialogs: r.dialogs, errors: r.errors, tries };
      }
      await sleep(20);
    }
    return { type, ok: false, attempts: maxAttempts, ms: Date.now() - t0, raw: '', label: null, body: '', tries };
  }

  // Stack + number path, to capture the "< Question N >" / "< Answer N >" format.
  async stackSample(passage, types) {
    await this.js(`(() => {
      document.getElementById('supportTextArea1').value = '';
      document.getElementById('supportTextArea2').value = '';
      return true;
    })()`);
    for (const t of types) {
      const r = await this.generate(t, passage);
      if (!r.ok) { log(`    (stackSample: ${t} failed, skipping)`); continue; }
      await this.js(`document.getElementById('buttonStack')
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))`);
      await sleep(60);
    }
    await this.js(`document.getElementById('buttonApplyNumber')
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))`);
    await sleep(150);
    return this.js(`({
      questionStack: document.getElementById('supportTextArea1').value,
      answerStack:   document.getElementById('supportTextArea2').value,
      dialogs: (window.__spy && window.__spy.dialogs.slice()) || [],
    })`);
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

async function main() {
  const passage = fs.readFileSync(PASSAGE, 'utf8').trim();
  fs.mkdirSync(OUT, { recursive: true });

  // Prove the engine needs no network.
  const blocked = [];
  session.defaultSession.webRequest.onBeforeRequest((d, cb) => {
    const allow = d.url.startsWith('file://') || d.url.startsWith('devtools://');
    if (!allow) blocked.push(d.url);
    cb({ cancel: !allow });
  });

  const win = new BrowserWindow({
    show: false,
    width: 1400,
    height: 1000,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: false, // preload must share the page window to trap dialogs
      sandbox: true,
      backgroundThrottling: false,
      devTools: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // The ENGINE FILE IS NOT MODIFIED -- dialog traps come from preload.js.
  await win.loadFile(ENGINE_SRC);
  await sleep(900);

  const eng = new Engine(win);
  const report = {
    mode: MODE,
    when: new Date().toISOString(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    engineFile: ENGINE_SRC,
    engineBytes: fs.statSync(ENGINE_SRC).size,
    engineFileModified: false,
    recipe: 'dispatchEvent(MouseEvent click) on the type button; retry absorbs the one-shot token prime',
    passageChars: passage.length,
  };

  // ---------------- S1 ----------------
  report.contract = await eng.contract();
  const c = report.contract;
  log('== S1 contract ==');
  log('  missing functions :', c.missingFns.length ? c.missingFns.join(', ') : '(none)');
  log('  missing DOM ids   :', c.missingIds.length ? c.missingIds.join(', ') : '(none)');
  log('  dialog trap       :', c.trapInstalled ? 'installed' : 'MISSING', '| alert native?', c.alertIsNative);
  log('  license banner    :', JSON.stringify(c.license));
  log('  token at load     :', JSON.stringify(c.tokenAtLoad));
  log('  dialogs at load   :', JSON.stringify(c.dialogsAtLoad), '| errors:', JSON.stringify(c.errorsAtLoad));

  report.optionsApplied = await eng.setOptions({ difficulty: 'Hard', optionCount: '5' });
  log('  options in force  :', JSON.stringify(report.optionsApplied));

  log('\n== S1 generation, 11 types ==');
  report.s1 = [];
  for (const t of TYPES) {
    const r = await eng.generate(t, passage);
    if (r.ok) fs.writeFileSync(path.join(OUT, `s1_${t.replace(/ /g, '-')}.txt`), r.raw, 'utf8');
    const { raw, body, ...meta } = r;
    report.s1.push({ ...meta, bodyChars: body.length });
    log(`  ${r.ok ? 'OK  ' : 'FAIL'} ${t.padEnd(17)} label=${String(r.label).padEnd(17)}` +
        ` body=${String(r.body.length).padStart(5)}ch attempts=${r.attempts} ${r.ms}ms` +
        `${r.dialogs && r.dialogs.length ? ' dialogs=' + JSON.stringify(r.dialogs) : ''}` +
        `${r.errors && r.errors.length ? ' errors=' + JSON.stringify(r.errors) : ''}`);
  }
  const okCount = report.s1.filter((r) => r.ok).length;

  // ---------------- S2 ----------------
  if (MODE === 's2') {
    log('\n== S2 golden corpus: 11 types x 3 difficulties x 3 option counts ==');
    report.s2 = [];
    const gdir = path.join(OUT, 'golden');
    for (const type of TYPES) {
      const line = [];
      for (const difficulty of DIFFICULTIES) {
        for (const optionCount of OPTION_COUNTS) {
          const inForce = await eng.setOptions({ difficulty, optionCount });
          const r = await eng.generate(type, passage);
          const rel = path.join(type.replace(/ /g, '-'), `${difficulty}-opt${optionCount}.txt`);
          if (r.ok) {
            fs.mkdirSync(path.join(gdir, path.dirname(rel)), { recursive: true });
            fs.writeFileSync(path.join(gdir, rel), r.raw, 'utf8');
          }
          report.s2.push({
            type, requested: { difficulty, optionCount }, inForce,
            ok: r.ok, attempts: r.attempts, ms: r.ms,
            bodyChars: r.body.length, label: r.label,
            engineOption: r.engineOption, engineDifficulty: r.engineDifficulty,
            file: r.ok ? rel : null,
          });
          line.push(`${difficulty[0]}${optionCount}:${r.ok ? r.body.length : 'FAIL'}`);
        }
      }
      log(`  ${type.padEnd(17)} ${line.join(' ')}`);
    }

    log('\n== S2 output variety: 12 runs per type on the same passage ==');
    report.variety = {};
    await eng.setOptions({ difficulty: 'Hard', optionCount: '5' });
    for (const type of TYPES) {
      const seen = new Map();
      let fails = 0;
      for (let i = 0; i < 12; i++) {
        const r = await eng.generate(type, passage);
        if (r.ok) seen.set(r.body, (seen.get(r.body) || 0) + 1);
        else fails++;
      }
      const dup = [...seen.values()].filter((n) => n > 1).reduce((a, b) => a + b - 1, 0);
      report.variety[type] = { runs: 12, ok: 12 - fails, distinct: seen.size, duplicateHits: dup };
      log(`  ${type.padEnd(17)} distinct ${String(seen.size).padStart(2)}/${12 - fails}` +
          `${dup ? `  (duplicates: ${dup})` : ''}${fails ? `  FAILS ${fails}` : ''}`);
    }

    log('\n== S2 stack / applyNumber format ==');
    report.stackSample = await eng.stackSample(passage, ['Correct Sentence', 'Binary Word', 'Scramble', 'Cloze']);
    fs.writeFileSync(path.join(OUT, 'stack_questions.txt'), report.stackSample.questionStack, 'utf8');
    fs.writeFileSync(path.join(OUT, 'stack_answers.txt'), report.stackSample.answerStack, 'utf8');
    log(`  question stack ${report.stackSample.questionStack.length}ch, answer stack ${report.stackSample.answerStack.length}ch`);
    log('  answer stack preview:\n' + report.stackSample.answerStack.split('\n').slice(0, 14).map((l) => '    ' + l).join('\n'));
  }

  report.blockedNetworkRequests = blocked;
  report.verdict = {
    s1_types_ok: `${okCount}/${TYPES.length}`,
    s1_pass: okCount === TYPES.length,
    engine_file_unmodified: true,
    network_requests_attempted: blocked.length,
    s2_ok: report.s2 ? `${report.s2.filter((r) => r.ok).length}/${report.s2.length}` : null,
  };
  writeJson(path.join(OUT, `report_${MODE}.json`), report);
  log('\n=== VERDICT ===');
  log(JSON.stringify(report.verdict, null, 2));

  win.destroy();
  app.exit(report.verdict.s1_pass ? 0 : 1);
}

setTimeout(() => { log('WATCHDOG TIMEOUT'); app.exit(3); }, 900000);
app.whenReady().then(() => main().catch((e) => { log('SPIKE ERROR:', e.stack || String(e)); app.exit(2); }));
