const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync('ielts.html', 'utf8');

// Seed localStorage with legacy-shaped data (no ids, no SRS fields) to test migration,
// and include a word with an apostrophe — the case that broke the original build.
const seedState = {
  'vocab-library': [
    { word: "mitigate", ipa: "/ˈmɪtɪɡeɪt/", partOfSpeech: "v.", meaningZh: "減輕",
      meaningEn: "make less severe", collocations: ["mitigate the impact"],
      linkingWords: ["in order to"], examples: ["Planting trees can mitigate flooding."],
      synonyms: ["alleviate"], band: "6.5-7.5" },
    { word: "don't panic", ipa: "/dəʊnt ˈpænɪk/", partOfSpeech: "phr.", meaningZh: "別慌",
      meaningEn: "stay calm", collocations: [], linkingWords: [], examples: [], synonyms: [], band: "5.0" },
    { word: '<img src=x onerror="alert(1)">', ipa: "", partOfSpeech: "", meaningZh: "XSS 測試",
      meaningEn: "", collocations: [], linkingWords: [], examples: [], synonyms: [], band: "" }
  ],
  'error-notebook': [
    { id:'e1', date:'2026-07-01', skill:'reading', subtype:'T/F/NG', note:'混淆 False 與 Not Given' },
    { id:'e2', date:'2026-07-02', skill:'writing', subtype:'連接詞使用', note:'however 用錯位置' },
    { id:'e3', date:'2026-07-02', skill:'reading', subtype:'T/F/NG', note:'又錯一次' }
  ],
  'schedule-blank': [],
  'writing-history': []
};

const store = { 'ielts-app-state': JSON.stringify(seedState) };

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'https://example.com/',
  pretendToBeVisual: true,
  beforeParse(win) {
    Object.defineProperty(win, 'localStorage', {
      value: {
        getItem: k => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: k => { delete store[k]; }
      }
    });
    win.speechSynthesis = { cancel(){}, speak(){} };
    win.SpeechSynthesisUtterance = function(){};
    win.scrollTo = () => {};
    win.confirm = () => true;
    win.alert = (m) => { throw new Error('XSS FIRED: ' + m); };
    win.HTMLElement.prototype.scrollIntoView = function(){};
  }
});

const { window } = dom;
const doc = window.document;
const errors = [];
window.addEventListener('error', e => errors.push('window error: ' + e.message));
const origErr = console.error;
console.error = (...a) => errors.push('console.error: ' + a.join(' '));

function q(sel){ return doc.querySelector(sel); }
function txt(sel){ const e = q(sel); return e ? e.textContent.trim() : '<missing ' + sel + '>'; }
function click(el){ el.dispatchEvent(new window.MouseEvent('click', { bubbles:true })); }

setTimeout(() => {
  const results = [];
  const check = (name, cond, extra='') => results.push([cond ? 'PASS' : 'FAIL', name, extra]);

  // --- migration + render ---
  check('3 words loaded', txt('#vocab-stamp .n') === '3', txt('#vocab-stamp .n'));
  check('all 3 due today', txt('#review-stamp .n') === '3', txt('#review-stamp .n'));
  check('nav due badge shown', /3/.test(txt('#nav-due-count')), txt('#nav-due-count'));
  const migrated = JSON.parse(store['ielts-app-state'])['vocab-library'];
  check('ids assigned', migrated.every(v => v.id && v.box === 1 && v.nextReview), '');

  // --- XSS: the injected img must be inert text, not a live element ---
  check('no XSS element in vocab list', q('#vocab-list img') === null, '');
  check('apostrophe word rendered', doc.getElementById('vocab-list').textContent.includes("don't panic"), '');

  // --- speak button with apostrophe word must not throw ---
  const speakBtns = doc.querySelectorAll('#vocab-list [data-act="speak"]');
  check('speak buttons present', speakBtns.length === 3, String(speakBtns.length));
  speakBtns.forEach(b => click(b));
  check('speak on tricky words did not error', errors.length === 0, errors.join(' | '));

  // --- review flow ---
  click(doc.querySelector('.nav button[data-m="review"]'));
  check('review module active', doc.getElementById('m-review').classList.contains('active'), '');
  check('card front shown', q('#review-area .review-word') !== null, '');
  check('answer hidden before reveal', q('#review-area .review-back') === null, '');
  click(q('#review-area [data-act="review-reveal"]'));
  check('answer shown after reveal', q('#review-area .review-back') !== null, '');

  // answer correctly -> should move to box 2 with a future nextReview
  const firstWord = q('#review-area .review-word').textContent;
  click(q('#review-area [data-act="review-grade"][data-ok="1"]'));
  const after = JSON.parse(store['ielts-app-state'])['vocab-library'].find(v => v.word === firstWord);
  check('correct answer promotes to box 2', after.box === 2, 'box=' + after.box);
  check('nextReview pushed forward', after.nextReview > new Date().toISOString().slice(0,10), after.nextReview);
  check('due count dropped to 2', txt('#review-stamp .n') === '2', txt('#review-stamp .n'));

  // answer wrong -> stays box 1, requeued once
  click(q('#review-area [data-act="review-reveal"]'));
  const wrongWord = q('#review-area .review-word').textContent;
  click(q('#review-area [data-act="review-grade"][data-ok="0"]'));
  const w = JSON.parse(store['ielts-app-state'])['vocab-library'].find(v => v.word === wrongWord);
  check('wrong answer keeps box 1', w.box === 1, 'box=' + w.box);
  check('lapse counted', w.lapses === 1, 'lapses=' + w.lapses);

  // drain the rest of the queue, make sure it terminates
  let guard = 0;
  while (q('#review-area [data-act="review-reveal"]') && guard++ < 40) {
    click(q('#review-area [data-act="review-reveal"]'));
    click(q('#review-area [data-act="review-grade"][data-ok="1"]'));
  }
  check('queue terminates', guard < 40, 'iterations=' + guard);
  check('finish state shown', doc.getElementById('review-area').textContent.includes('今天的複習做完了'), '');

  // --- error chart ---
  click(doc.querySelector('.nav button[data-m="errors"]'));
  check('errors counted', txt('#errors-stamp .n') === '3', txt('#errors-stamp .n'));
  check('T/F/NG is top weakness', doc.querySelector('#errors-chart .bar-label').textContent.includes('T/F/NG'), '');

  // --- quiz grading by index (the string-equality bug) ---
  click(doc.querySelector('.nav button[data-m="quiz"]'));
  window.CURRENT_QUIZ = undefined; // not exposed; drive through the module instead
  const runQuiz = window.eval(`(function(quiz){
    CURRENT_QUIZ = quiz; QUIZ_GRADED = false; renderQuiz();
  })`);
  runQuiz([
    // answer text deliberately differs from the option by punctuation/case —
    // exact string equality would mark a correct pick as wrong
    { skill:'reading', subtype:'T/F/NG', question:'Q1', options:['True','False','Not Given'],
      answerIndex:2, answer:'not given.', explanation:'e1' },
    { skill:'listening', subtype:'細節題', question:'What time?', audioScript:'The train leaves at six.',
      options:['Five','Six'], answerIndex:1, answer:'Six', explanation:'e2' }
  ]);
  check('listening script hidden before submit',
    doc.getElementById('script-1').style.display === 'none', '');
  // pick the right answer for Q1, wrong for Q2
  doc.querySelectorAll('input[name="q0"]')[2].checked = true;
  doc.querySelectorAll('input[name="q1"]')[0].checked = true;
  click(q('[data-act="quiz-submit"]'));
  check('Q1 graded correct despite text mismatch',
    doc.getElementById('qresult-0').textContent.includes('正確'), txt('#qresult-0').slice(0,40));
  check('Q2 graded wrong', doc.getElementById('qresult-1').textContent.includes('錯誤'), '');
  check('listening transcript revealed after submit',
    doc.getElementById('script-1').style.display === 'block', '');
  check('accuracy stamp = 50%', txt('#quiz-stamp .n') === '50%', txt('#quiz-stamp .n'));
  const errs2 = JSON.parse(store['ielts-app-state'])['error-notebook'];
  check('only the wrong answer logged', errs2.length === 4, 'count=' + errs2.length);

  // --- blank plan edit by index ---
  click(doc.querySelector('.nav button[data-m="schedule"]'));
  click(doc.getElementById('plan-add-row-btn'));
  click(doc.getElementById('plan-add-row-btn'));
  const rowInputs = doc.querySelectorAll('#blank-plan-body input[type="text"]');
  rowInputs[1].value = 'second row task';
  rowInputs[1].dispatchEvent(new window.Event('change', { bubbles:true }));
  const plan = JSON.parse(store['ielts-app-state'])['schedule-blank'];
  check('correct plan row edited', plan[1].tasks === 'second row task', JSON.stringify(plan));

  // --- no stray errors overall ---
  check('no runtime errors', errors.length === 0, errors.join(' | '));

  const fails = results.filter(r => r[0] === 'FAIL');
  results.forEach(([s, n, e]) => console.log(`${s}  ${n}${e ? '  → ' + e : ''}`));
  console.log(`\n${results.length - fails.length}/${results.length} passed`);
  process.exit(fails.length ? 1 : 0);
}, 300);
