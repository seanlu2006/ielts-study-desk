/* 約束 11 的延伸：Gemini 金鑰不可離開瀏覽器。
   settings.apiKey 住在 APP_STATE 裡，而 APP_STATE 整包會同步上雲，
   所以只要沒特別處理，使用者的金鑰就會被寫進 D1。
   這支測試把「上傳前剝掉金鑰」與「套用雲端資料時保住本機金鑰」兩件事釘住。 */
const fs = require('fs'), { JSDOM } = require('jsdom');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'ielts.html'), 'utf8');

const SECRET = 'AIza-THIS-MUST-NEVER-LEAVE-THE-BROWSER';

let store = {
  'ielts-cloud-settings': JSON.stringify({
    userId: 'u1', token: 'fake-token', autoSync: true, version: 3, lastSync: '',
  }),
  'ielts-app-state': JSON.stringify({
    'settings': { apiKey: SECRET, model: 'gemini-2.5-flash', accent: 'en-GB' },
    'vocab-library': [{ id: 'v1', word: 'mitigate', meaningZh: '減輕', box: 2,
                        nextReview: '2030-01-01', reviewCount: 1, lapses: 0, addedAt: '2026-01-01' }],
    'quiz-stats': { correct: 3, total: 5 },
  }),
};

let captured = null;

const dom = new JSDOM(html, {
  runScripts: 'dangerously', url: 'https://example.com/', pretendToBeVisual: true,
  beforeParse(win) {
    Object.defineProperty(win, 'localStorage', { value: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
    }});
    win.speechSynthesis = { cancel() {}, speak() {} };
    win.SpeechSynthesisUtterance = function () {};
    win.scrollTo = () => {};
    win.confirm = () => true;
    win.HTMLElement.prototype.scrollIntoView = function () {};
    // 攔下所有 fetch，記錄最後一次 PUT /api/progress 的 body
    win.fetch = (url, opts = {}) => {
      if (String(url).includes('/progress') && opts.method === 'PUT') {
        captured = { url: String(url), body: opts.body };
        return Promise.resolve({ ok: true, status: 200,
          json: () => Promise.resolve({ version: 4 }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    };
  },
});

const w = dom.window;

setTimeout(async () => {
  const R = [];
  const chk = (n, c, e = '') => R.push([c ? 'PASS' : 'FAIL', n, e]);

  // --- outgoingState() 本身 ---
  const out = w.outgoingState();
  chk('outgoingState 剝掉 apiKey', !('apiKey' in (out.settings || {})),
      JSON.stringify(out.settings));
  chk('outgoingState 保留其他設定', out.settings && out.settings.model === 'gemini-2.5-flash',
      JSON.stringify(out.settings));
  chk('outgoingState 保留學習進度', Array.isArray(out['vocab-library']) && out['vocab-library'].length === 1, '');
  chk('outgoingState 不動到 APP_STATE 本身',
      (w.eval('APP_STATE').settings || {}).apiKey === SECRET);

  // --- 實際上傳的 payload ---
  await w.cloudPush();
  chk('cloudPush 有送出請求', captured !== null, '');
  if (captured) {
    chk('上傳的 body 不含金鑰', captured.body.indexOf(SECRET) === -1,
        captured.body.slice(0, 120));
    const sent = JSON.parse(captured.body);
    chk('上傳的 state 仍帶 vocab', Array.isArray(sent.state['vocab-library']), '');
    chk('上傳仍帶 version(樂觀鎖沒被破壞)', typeof sent.version === 'number', String(sent.version));
  }

  // --- 從雲端拉回來時不可把本機金鑰清掉 ---
  await w.applyCloudState({
    'settings': { model: 'gemini-2.5-flash', accent: 'en-GB' },   // 雲端沒有 apiKey
    'vocab-library': [],
    'quiz-stats': { correct: 9, total: 10 },
  }, 7);
  chk('套用雲端資料後本機金鑰仍在', (w.eval('APP_STATE').settings || {}).apiKey === SECRET,
      JSON.stringify(w.eval('APP_STATE').settings));
  chk('套用雲端資料後雲端內容有生效', w.eval('APP_STATE')['quiz-stats'].correct === 9,
      JSON.stringify(w.eval('APP_STATE')['quiz-stats']));

  let fails = 0;
  for (const [s, n, e] of R) {
    if (s === 'FAIL') fails++;
    console.log(`${s}  ${n}${e ? '  → ' + e : ''}`);
  }
  console.log(`\n${R.length - fails}/${R.length} passed`);
  process.exit(fails ? 1 : 0);
}, 100);
