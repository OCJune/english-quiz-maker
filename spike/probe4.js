// Probe 4: the generators are gated on (flagValidate && code === globalCode),
// a one-shot token consumed on success. Find which invocation path arms it.
//
// globalCode changing after a call == a generator ran to completion.
//
// M1 direct call            generatePerformance('Cloze')
// M2 synthetic click        el.click()                    (isTrusted: false)
// M3 dispatchEvent          new MouseEvent('click')       (isTrusted: false)
// M4 trusted input event    webContents.sendInputEvent()  (isTrusted: true)

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ENGINE_SRC = path.join(ROOT, 'ariaenglish', 'ariaenglish_offline_4.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => process.stdout.write(a.join(' ') + '\n');

async function main() {
  const passage = fs.readFileSync(path.join(__dirname, 'fixtures', 'passage.txt'), 'utf8').trim();

  // Visible but parked far offscreen: keeps real hit-testing/input working
  // without putting a window in front of the user.
  const win = new BrowserWindow({
    x: -4000, y: -4000, width: 1400, height: 1000,
    show: true, skipTaskbar: true, focusable: true, opacity: 0,
    webPreferences: {
      nodeIntegration: false, contextIsolation: false, sandbox: true,
      backgroundThrottling: false, offscreen: false,
      preload: path.join(__dirname, 'preload.js'),
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

  const reset = () => js(`(() => {
    if (window.__spy) { window.__spy.dialogs.length = 0; window.__spy.errors.length = 0; }
    document.getElementById('productWordContentOriginal').value = ${JSON.stringify(passage)};
    document.getElementById('productWordContentProcessed').value = '';
    return { codeBefore: globalCode, flagBefore: flagValidate };
  })()`);

  const observe = () => js(`(() => {
    const v = document.getElementById('productWordContentProcessed').value;
    return { len: v.length, head: v.slice(0, 220),
             codeAfter: globalCode, flagAfter: flagValidate,
             dialogs: (window.__spy && window.__spy.dialogs.slice()) || [],
             errors: (window.__spy && window.__spy.errors.slice()) || [] };
  })()`);

  async function report(label, before, after) {
    const body = after.head.replace(/^\s*\S[^\n]*\n+/, '');
    const gen = body.trim().length > 20;
    log(`  ${gen ? 'GEN ' : '--- '} ${label.padEnd(26)} len=${String(after.len).padStart(5)}` +
        `  code ${before.codeBefore} -> ${after.codeAfter}${before.codeBefore !== after.codeAfter ? ' (CHANGED)' : ''}` +
        `  flag ${before.flagBefore} -> ${after.flagAfter}` +
        `${after.dialogs.length ? ' dialogs=' + JSON.stringify(after.dialogs) : ''}` +
        `${after.errors.length ? ' errors=' + JSON.stringify(after.errors) : ''}`);
    if (gen) log(`        ${JSON.stringify(after.head.slice(0, 200))}`);
    return gen;
  }

  log('--- invocation paths, target = #buttonCloze / generatePerformance("Cloze") ---');

  // M1 direct call
  let b = await reset();
  await js(`(() => { try { window.generatePerformance('Cloze'); } catch (e) {} return 1; })()`);
  await sleep(250);
  await report('M1 direct call', b, await observe());

  // M2 el.click()
  b = await reset();
  await js(`(() => { document.getElementById('buttonCloze').click(); return 1; })()`);
  await sleep(250);
  await report('M2 el.click()', b, await observe());

  // M3 dispatchEvent
  b = await reset();
  await js(`(() => {
    const el = document.getElementById('buttonCloze');
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return 1;
  })()`);
  await sleep(250);
  await report('M3 dispatchEvent', b, await observe());

  // M4 trusted input event at the button's real viewport coordinates
  const rect = await js(`(() => {
    const r = document.getElementById('buttonCloze').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: r.width, h: r.height };
  })()`);
  log(`  (button rect: ${JSON.stringify(rect)})`);
  b = await reset();
  win.webContents.focus();
  win.webContents.sendInputEvent({ type: 'mouseMove', x: rect.x, y: rect.y });
  win.webContents.sendInputEvent({ type: 'mouseDown', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseUp', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  await sleep(500);
  const m4 = await report('M4 sendInputEvent (trusted)', b, await observe());

  // If M4 worked, verify it generalises across types and is repeatable.
  if (m4) {
    log('\n--- M4 across all 11 types ---');
    const BUTTONS = {
      'Scramble': 'buttonScramble', 'Shuffle': 'buttonShuffle',
      'Missing Sentence': 'buttonMissingSentence', 'Wrong Sentence': 'buttonWrongSentence',
      'Correct Sentence': 'buttonCorrectSentence', 'Multiple Choice': 'buttonMultipleChoice',
      'Blank': 'buttonBlank', 'Binary Word': 'buttonBinaryWord',
      'Wrong Word': 'buttonWrongWord', 'Correct Word': 'buttonCorrectWord', 'Cloze': 'buttonCloze',
    };
    let ok = 0;
    for (const [type, id] of Object.entries(BUTTONS)) {
      const r2 = await js(`(() => {
        const r = document.getElementById('${id}').getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      })()`);
      const bb = await reset();
      win.webContents.sendInputEvent({ type: 'mouseMove', x: r2.x, y: r2.y });
      win.webContents.sendInputEvent({ type: 'mouseDown', x: r2.x, y: r2.y, button: 'left', clickCount: 1 });
      win.webContents.sendInputEvent({ type: 'mouseUp', x: r2.x, y: r2.y, button: 'left', clickCount: 1 });
      await sleep(350);
      if (await report(type, bb, await observe())) ok++;
    }
    log(`  => ${ok}/11 types generated via trusted input`);
  }

  win.destroy();
  app.exit(0);
}

setTimeout(() => { log('WATCHDOG'); app.exit(3); }, 120000);
app.whenReady().then(() => main().catch((e) => { log('ERR', e.stack); app.exit(2); }));
