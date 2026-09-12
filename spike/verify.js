// Verify the parser spec against the full S2 golden corpus, and validate the two
// post-processing transforms the PRD requires (Scramble open-ended, Cloze no word bank).
// Plain node -- no Electron needed.

const fs = require('fs');
const path = require('path');
const P = require('./parser');

const GOLDEN = path.join(__dirname, 'out', 'golden');
const passage = fs.readFileSync(path.join(__dirname, 'fixtures', 'passage.txt'), 'utf8').trim();
const log = (...a) => console.log(...a);

const files = [];
for (const dir of fs.readdirSync(GOLDEN)) {
  for (const f of fs.readdirSync(path.join(GOLDEN, dir))) {
    files.push({ type: dir.replace(/-/g, ' '), variant: f.replace('.txt', ''), file: path.join(GOLDEN, dir, f) });
  }
}
files.sort((a, b) => (a.type + a.variant).localeCompare(b.type + b.variant));

log(`=== parsing ${files.length} golden files ===`);
const rows = [];
let parsed = 0, withWarnings = 0;
for (const f of files) {
  const raw = fs.readFileSync(f.file, 'utf8');
  const r = P.parse(raw, f.type);
  if (r.ok) parsed++;
  if (r.ok && r.warnings.length) withWarnings++;
  rows.push({ ...f, r });
  if (!r.ok) log(`  FAIL ${f.type} ${f.variant}: ${r.error}`);
  else if (r.warnings.length) log(`  WARN ${f.type} ${f.variant}: ${r.warnings.join(' | ')}`);
}
log(`  parsed ${parsed}/${files.length}, with warnings ${withWarnings}`);

// --- per-type shape summary -------------------------------------------------
log('\n=== per-type shape (answer kind, option count by requested count) ===');
const byType = {};
for (const { type, variant, r } of rows) {
  if (!r.ok) continue;
  byType[type] = byType[type] || { kinds: new Set(), opts: {}, footer: new Set() };
  byType[type].kinds.add(r.answer.kind);
  const req = variant.split('opt')[1];
  byType[type].opts[req] = byType[type].opts[req] || new Set();
  byType[type].opts[req].add(r.options.length);
  byType[type].footer.add(r.footer ? r.footer.length : 0);
}
for (const [t, v] of Object.entries(byType)) {
  const opts = ['1', '3', '5'].map((k) => `req${k}->${[...(v.opts[k] || [])].join('/')}`).join(' ');
  log(`  ${t.padEnd(17)} answer=${[...v.kinds].join(',').padEnd(9)} options: ${opts}   footerLines=${[...v.footer].join(',')}`);
}

// --- C1: Scramble open-ended -----------------------------------------------
log('\n=== C1  Scramble: choice -> open-ended (answer sentence recovered & verified) ===');
let c1ok = 0, c1total = 0;
for (const { variant, r } of rows.filter((x) => x.type === 'Scramble')) {
  if (!r.ok) continue;
  c1total++;
  const t = P.toOpenEndedScramble(r, passage);
  if (t.ok && t.verified) c1ok++;
  log(`  ${t.ok && t.verified ? 'PASS' : 'FAIL'} ${variant.padEnd(12)} verified=${t.verified}` +
      `  words=${t.sentence ? t.sentence.split(' ').length : '-'}  "${(t.sentence || t.error).slice(0, 76)}…"`);
}
log(`  => ${c1ok}/${c1total} answer sentences recovered and found verbatim in the source passage`);

// Also confirm the body really is the open-ended form (a "( w / w / ... )" group).
const scrambleBodies = rows.filter((x) => x.type === 'Scramble' && x.r.ok)
  .map((x) => /\(\s*[^)]*\s\/\s[^)]*\)/.test(x.r.body));
log(`  body retains the "( w / w / ... )" group: ${scrambleBodies.filter(Boolean).length}/${scrambleBodies.length}`);

// --- C2: Cloze word bank ----------------------------------------------------
log('\n=== C2  Cloze: word bank present, strippable, answers intact ===');
let c2ok = 0, c2total = 0;
for (const { variant, r } of rows.filter((x) => x.type === 'Cloze')) {
  if (!r.ok) continue;
  c2total++;
  const stripped = P.stripClozeWordBank(r);
  const blanks = P.clozeBlankOrder(r.body);
  const bankOk = Array.isArray(r.wordBank) && r.wordBank.length > 0;
  const answersOk = r.answer.kind === 'wordList' && r.answer.words.length === blanks.length;
  const noResidue = !/Choose\s*=/.test(stripped.body) && stripped.wordBank === null;
  if (bankOk && answersOk && noResidue) c2ok++;
  log(`  ${bankOk && answersOk && noResidue ? 'PASS' : 'FAIL'} ${variant.padEnd(12)}` +
      ` bank=${r.wordBank ? r.wordBank.length : 0} blanks=${blanks.length} answers=${r.answer.words.length}` +
      ` residue=${!noResidue}`);
}
log(`  => ${c2ok}/${c2total}`);

// --- C3: Cloze blank numbering ---------------------------------------------
log('\n=== C3  Cloze blank numbering (engine quirk: out-of-reading-order blanks) ===');
let outOfOrder = 0, c3fixed = 0;
for (const { variant, r } of rows.filter((x) => x.type === 'Cloze')) {
  if (!r.ok) continue;
  const order = P.clozeBlankOrder(r.body);
  const inOrder = order.every((n, i) => n === i + 1);
  if (!inOrder) outOfOrder++;
  const fixed = P.renumberCloze(r);
  const after = P.clozeBlankOrder(fixed.body);
  const nowOk = after.every((n, i) => n === i + 1);
  const wordsAligned = fixed.answer.words.every((w, i) => w.n === i + 1) &&
                       fixed.answer.words.every((w) => w.word && w.word !== '?');
  if (nowOk && wordsAligned) c3fixed++;
  log(`  ${variant.padEnd(12)} bodyOrder=[${order.join(',')}]${inOrder ? ' (in order)' : ' OUT-OF-ORDER'}` +
      ` -> renumbered=${fixed.renumbered} nowInOrder=${nowOk} answersAligned=${wordsAligned}`);
}
log(`  => ${outOfOrder} of ${c2total} Cloze outputs were out of reading order; renumbering fixed ${c3fixed}/${c2total}`);

// --- engine auto-adjustment -------------------------------------------------
log('\n=== engine option-count honouring (requested vs delivered option count) ===');
const adj = [];
for (const { type, variant, r } of rows) {
  if (!r.ok) continue;
  const req = Number(variant.split('opt')[1]);
  if (r.options.length && r.options.length !== req) adj.push(`${type}/${variant}: asked ${req}, got ${r.options.length}`);
}
log(adj.length ? '  ' + adj.join('\n  ') : '  every option-bearing type delivered exactly the requested count');

// --- summary ----------------------------------------------------------------
const verdict = {
  goldenFiles: files.length,
  parsed: `${parsed}/${files.length}`,
  c1_scramble_openEnded: `${c1ok}/${c1total}`,
  c2_cloze_wordBank: `${c2ok}/${c2total}`,
  c3_cloze_renumber: `${c3fixed}/${c2total}`,
  clozeOutOfOrder: `${outOfOrder}/${c2total}`,
  optionCountMismatches: adj.length,
};
log('\n=== VERDICT ===');
log(JSON.stringify(verdict, null, 2));
fs.writeFileSync(path.join(__dirname, 'out', 'verify.json'), JSON.stringify({ verdict, rows: rows.map(({ type, variant, r }) => ({ type, variant, ok: r.ok, warnings: r.warnings, answerKind: r.ok && r.answer.kind, options: r.ok && r.options.length })) }, null, 2));
process.exit(parsed === files.length && c1ok === c1total && c2ok === c2total ? 0 : 1);
