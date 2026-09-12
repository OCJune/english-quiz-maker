// Probe 5: nail down the minimal, reliable invocation recipe.
//
// Hypothesis: the engine keeps a one-shot token (flagValidate + globalCode).
// An onclick-path invocation arms it; the NEXT invocation consumes it and
// produces output. So the first call after load is a throwaway "prime", and
// after that every call should succeed.
//
// Candidate recipes, scored over many consecutive generations:
//   R1  prime once with el.click(), then direct generatePerformance() calls
//   R2  dispatchEvent('click') on the type's button every time
//   R3  direct generatePerformance() every time, no prime at all (control)

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ENGINE_SRC = path.join(ROOT, 'ariaenglish', 'ariaenglish_offline_4.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => process.stdout.write(a.join(' ') + '\n');

const BUTTONS = {
  'Scramble': 'buttonScramble', 'Shuffle': 'buttonShuffle',
  'Missing Sentence': 'buttonMissingSentence', 'Wrong Sentence': 'buttonWrongSentence',
  'Correct Sentence': 'buttonCorrectSentence', 'Multiple Choice': 'buttonMultipleChoice',
  'Blank': 'buttonBlank', 'Binary Word': 'buttonBinaryWord',
  'Wrong Word': 'buttonWrongWord', 'Correct Word': 'buttonCorrectWord', 'Cloze': 'buttonCloze',
};
const TYPES = Object.keys(BUTTONS);

async function main() {
  const passage = fs.readFileSync(path.join(__dirname, 'fixtures', 'passage.txt'), 'utf8').trim();
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false, contextIsolation: false, sandbox: true,
      backgroundThrottling: false, preload: path.join(__dirname, 'preload.js'),
    },
  });
  await win.loadFile(ENGINE_SRC);
  await sleep(900);
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

  // One attempt. `how` selects the invocation path.
  async function attempt(type, how) {
    const invoke = how === 'direct'
      ? `try { window.generatePerformance(${JSON.stringify(type)}); } catch (e) {}`
      : how === 'click'
        ? `document.getElementById('${BUTTONS[type]}').click();`
        : `document.getElementById('${BUTTONS[type]}').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));`;
    const r = await js(`(() => {
      if (window.__spy) { window.__spy.dialogs.length = 0; window.__spy.errors.length = 0; }
      document.getElementById('productWordContentOriginal').value = ${JSON.stringify(passage)};
      document.getElementById('productWordContentProcessed').value = '';
      const codeBefore = globalCode, flagBefore = flagValidate;
      ${invoke}
      const v = document.getElementById('productWordContentProcessed').value;
      return { len: v.length, out: v, codeBefore, flagBefore,
               codeAfter: globalCode, flagAfter: flagValidate,
               dialogs: (window.__spy && window.__spy.dialogs.slice()) || [] };
    })()`);
    const body = r.out.replace(/^\s*\S[^\n]*\n+/, '');
    return { ...r, gen: body.trim().length > 100 };
  }

  async function score(label, how, { prime }) {
    log(`\n### ${label}`);
    await win.webContents.reload();
    await sleep(900);
    await js(`(() => {
      const set = (id, v, fn) => { const e = document.getElementById(id); e.value = v; if (fn) window[fn](); };
      set('productWordOption', '5', 'setOptionNumber');
      set('productWordDifficulty', 'Hard', 'setOptionDifficulty');
      set('productWordLanguage', 'English', 'setOptionLanguage');
      set('productWordOccupation', 'Teacher', 'setOptionOccupation');
      document.getElementById('optionToolConfirm').value = 'false';
      return true;
    })()`);

    if (prime) {
      const p = await attempt('Cloze', 'click');
      log(`  prime(click): gen=${p.gen} flag ${p.flagBefore}->${p.flagAfter} code ${p.codeBefore}->${p.codeAfter}`);
    }

    let ok = 0, n = 0, firstFail = null;
    const perType = {};
    for (let i = 0; i < 33; i++) {
      const type = TYPES[i % TYPES.length];
      const r = await attempt(type, how);
      n++;
      if (r.gen) ok++; else if (firstFail === null) firstFail = `${i}:${type}`;
      perType[type] = perType[type] || { ok: 0, n: 0 };
      perType[type].n++;
      if (r.gen) perType[type].ok++;
      if (i < 4 || !r.gen) {
        log(`   #${String(i).padStart(2)} ${r.gen ? 'GEN ' : '--- '} ${type.padEnd(17)} len=${String(r.len).padStart(5)}` +
            ` flag ${r.flagBefore}->${r.flagAfter} code ${r.codeBefore}->${r.codeAfter}`);
      }
    }
    log(`  => ${ok}/${n} generated` + (firstFail ? `  firstFail=${firstFail}` : '  (all succeeded)'));
    log(`  per-type: ${Object.entries(perType).map(([t, v]) => `${t.split(' ')[0]} ${v.ok}/${v.n}`).join(', ')}`);
    return { label, ok, n };
  }

  const results = [];
  results.push(await score('R1  prime once (click), then DIRECT calls', 'direct', { prime: true }));
  results.push(await score('R2  dispatchEvent on button every time', 'dispatch', { prime: false }));
  results.push(await score('R3  direct calls, no prime (control)', 'direct', { prime: false }));

  log('\n=== RECIPE SCOREBOARD ===');
  for (const r of results) log(`  ${r.label.padEnd(44)} ${r.ok}/${r.n}`);

  fs.writeFileSync(path.join(__dirname, 'out', 'probe5.json'), JSON.stringify(results, null, 2), 'utf8');
  win.destroy();
  app.exit(0);
}

setTimeout(() => { log('WATCHDOG'); app.exit(3); }, 180000);
app.whenReady().then(() => main().catch((e) => { log('ERR', e.stack); app.exit(2); }));
