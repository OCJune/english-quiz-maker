// ResultParser — Text Area 3 raw output -> structured Question.
// Spec derived from the S2 golden corpus (11 types x 3 difficulties x 3 option counts).
//
// Canonical shape of every engine output:
//
//   <blank>
//   <Type label>                     e.g. "Cloze"
//   <blank>
//   <question body>                  one or more lines
//   [<blank> "Choose  =  w  w  ..."] Cloze only
//   [<blank> "(1)  ..." .. "(N)  ..."] option-bearing types only
//   <blank>
//   "Answer  =  (N)"                 choice types
//   "Answer  =  "  + blank + "1) w"… wordList types (Cloze)
//   <blank>
//   <6-line attribution footer>      ALWAYS appended
//
// Note: the footer is the engine author's attribution. It is stripped from the
// printed question (the existing hand-made PDFs do not carry it) but the app must
// still surface it in its credits screen -- see FOOTER_LINES.

const FOOTER_FIRST = 'For Mass Production www.AriaEnglish.com';
const FOOTER_LINES = [
  'For Mass Production www.AriaEnglish.com',
  'For Contact teamexercisevocabulary10@gmail.com',
  'Engine Design by Dani Sohn',
  'Copyright 2021 Dani Sohn',
  'Engine Version 0 Revision 4 Fix 04',
  'USE AT YOUR OWN RISK',
];

const RE_ANSWER = /^Answer\s*=\s*(.*)$/;
const RE_CHOOSE = /^Choose\s*=\s*(.*)$/;
const RE_OPTION = /^\((\d+)\)\s+(.*)$/;
const RE_WORDANS = /^(\d+)\)\s*(.*)$/;
const RE_CHOICE = /^\((\d+)\)$/;

function parse(raw, expectedType) {
  const warnings = [];
  const lines = raw.replace(/\r\n/g, '\n').split('\n');

  // --- label -------------------------------------------------------------
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  const label = (lines[i] || '').trim();
  if (!label) return { ok: false, error: 'no label line', warnings };
  if (expectedType && label !== expectedType) warnings.push(`label "${label}" != requested "${expectedType}"`);
  i++;

  // --- footer ------------------------------------------------------------
  let footerAt = lines.findIndex((l) => l.trim() === FOOTER_FIRST);
  let footer = null;
  if (footerAt >= 0) {
    footer = lines.slice(footerAt).map((l) => l.trim()).filter(Boolean);
    const expected = FOOTER_LINES.join('|');
    if (footer.join('|') !== expected) warnings.push('footer text differs from the known 6 lines');
  } else {
    warnings.push('attribution footer not found');
    footerAt = lines.length;
  }
  const content = lines.slice(i, footerAt);

  // --- locate markers ----------------------------------------------------
  let answerAt = -1, chooseAt = -1, firstOptionAt = -1;
  for (let k = 0; k < content.length; k++) {
    const t = content[k].trim();
    if (answerAt < 0 && RE_ANSWER.test(t)) answerAt = k;
    if (chooseAt < 0 && RE_CHOOSE.test(t)) chooseAt = k;
    if (firstOptionAt < 0 && answerAt < 0 && RE_OPTION.test(t)) firstOptionAt = k;
  }
  if (answerAt < 0) return { ok: false, error: 'no "Answer =" line', warnings, label };

  // --- options -----------------------------------------------------------
  const options = [];
  if (firstOptionAt >= 0) {
    for (let k = firstOptionAt; k < answerAt; k++) {
      const m = content[k].trim().match(RE_OPTION);
      if (m) options.push({ n: Number(m[1]), text: m[2].trim() });
      else if (content[k].trim()) warnings.push(`unparsed line in option block: ${JSON.stringify(content[k].slice(0, 60))}`);
    }
    const ns = options.map((o) => o.n);
    if (ns.some((n, idx) => n !== idx + 1)) warnings.push(`option numbers not 1..N: ${ns.join(',')}`);
  }

  // --- Cloze "Choose =" word bank ---------------------------------------
  let wordBank = null;
  if (chooseAt >= 0) {
    const m = content[chooseAt].trim().match(RE_CHOOSE);
    wordBank = m[1].split(/\s+/).filter(Boolean);
  }

  // --- body --------------------------------------------------------------
  const bodyEnd = Math.min(...[firstOptionAt, chooseAt, answerAt].filter((v) => v >= 0));
  const body = content.slice(0, bodyEnd).join('\n').replace(/^\n+|\n+$/g, '');

  // --- answer ------------------------------------------------------------
  const answerInline = content[answerAt].trim().match(RE_ANSWER)[1].trim();
  let answer;
  if (RE_CHOICE.test(answerInline)) {
    answer = { kind: 'choice', choice: Number(answerInline.match(RE_CHOICE)[1]) };
    if (options.length && (answer.choice < 1 || answer.choice > options.length)) {
      warnings.push(`answer (${answer.choice}) outside 1..${options.length}`);
    }
  } else if (!answerInline) {
    const words = [];
    for (let k = answerAt + 1; k < content.length; k++) {
      const t = content[k].trim();
      if (!t) continue;
      const m = t.match(RE_WORDANS);
      if (m) words.push({ n: Number(m[1]), word: m[2].trim() });
      else warnings.push(`unparsed answer line: ${JSON.stringify(t.slice(0, 60))}`);
    }
    if (!words.length) return { ok: false, error: 'empty "Answer =" with no word list', warnings, label };
    answer = { kind: 'wordList', words };
  } else {
    answer = { kind: 'sentence', sentence: answerInline };
    warnings.push(`unexpected inline answer form: ${JSON.stringify(answerInline.slice(0, 60))}`);
  }

  return { ok: true, label, body, options, wordBank, answer, footer, warnings };
}

// ---------------------------------------------------------------------------
// C1 — Scramble: choice form -> open-ended form.
// The correct option is the original word order; joining it yields the answer
// sentence. Cross-checked against the source passage.
// ---------------------------------------------------------------------------
const norm = (s) => s.replace(/\s+/g, ' ').trim();

function toOpenEndedScramble(parsed, sourcePassage) {
  if (parsed.answer.kind !== 'choice') return { ok: false, error: 'no choice answer' };
  const opt = parsed.options.find((o) => o.n === parsed.answer.choice);
  if (!opt) return { ok: false, error: `option ${parsed.answer.choice} missing` };
  const sentence = norm(opt.text.split('/').map((w) => w.trim()).filter(Boolean).join(' '));
  const verified = norm(sourcePassage).includes(sentence);
  return {
    ok: true,
    verified,
    sentence,
    // Open-ended question keeps the body's "( w / w / ... )" and drops the options.
    body: parsed.body,
    options: [],
    answer: { kind: 'sentence', sentence },
  };
}

// ---------------------------------------------------------------------------
// C2 — Cloze: drop the "Choose =" word bank.
// ---------------------------------------------------------------------------
function stripClozeWordBank(parsed) {
  return { ...parsed, wordBank: null, body: parsed.body };
}

// ---------------------------------------------------------------------------
// C3 — Cloze: the engine can emit blank numbers out of reading order
// (observed: 1,2,3,13,4,...,14). Renumber body + answer list to reading order.
// ---------------------------------------------------------------------------
function clozeBlankOrder(body) {
  return [...body.matchAll(/(\d+)\)\s*_+/g)].map((m) => Number(m[1]));
}

function renumberCloze(parsed) {
  const order = clozeBlankOrder(parsed.body);
  if (!order.length) return { ...parsed, renumbered: false };
  const inOrder = order.every((n, i) => n === i + 1);
  if (inOrder) return { ...parsed, renumbered: false };

  const map = new Map(order.map((oldN, idx) => [oldN, idx + 1]));
  const body = parsed.body.replace(/(\d+)\)(\s*_+)/g, (_, n, rest) => `${map.get(Number(n)) ?? n})${rest}`);
  const byOld = new Map(parsed.answer.words.map((w) => [w.n, w.word]));
  const words = order.map((oldN, idx) => ({ n: idx + 1, word: byOld.get(oldN) ?? '?' }));
  return { ...parsed, body, answer: { kind: 'wordList', words }, renumbered: true, originalOrder: order };
}

module.exports = {
  parse, toOpenEndedScramble, stripClozeWordBank, renumberCloze, clozeBlankOrder,
  FOOTER_LINES, norm,
};
