/* test4.js — 反向測驗（看中文拼英文）與學習連續天數／統計
   延續 test.js 的 jsdom 驅動風格，mock localStorage / speechSynthesis，不打真 API。 */
const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'ielts.html'), 'utf8');

const seedState = {
  'vocab-library': [
    { id:'w1', word:'ubiquitous', ipa:'/juːˈbɪkwɪtəs/', partOfSpeech:'adj.', meaningZh:'無所不在的',
      meaningEn:'present everywhere', collocations:['ubiquitous presence'], linkingWords:[], examples:['Smartphones are ubiquitous.'], synonyms:['omnipresent'], band:'7',
      box:1, nextReview:'2020-01-01', reviewCount:0, lapses:0, addedAt:'2026-01-01' },
    { id:'w2', word:'mitigate', ipa:'/ˈmɪtɪɡeɪt/', partOfSpeech:'v.', meaningZh:'減輕',
      meaningEn:'make less severe', collocations:[], linkingWords:[], examples:[], synonyms:[], band:'6.5',
      box:1, nextReview:'2020-01-01', reviewCount:0, lapses:0, addedAt:'2026-01-01' }
  ]
};
const store = { 'ielts-app-state': JSON.stringify(seedState) };

const dom = new JSDOM(html, {
  runScripts:'dangerously', url:'https://example.com/', pretendToBeVisual:true,
  beforeParse(win){
    Object.defineProperty(win, 'localStorage', { value:{
      getItem:k=>(k in store?store[k]:null),
      setItem:(k,v)=>{ store[k]=String(v); },
      removeItem:k=>{ delete store[k]; }
    }});
    win.speechSynthesis={cancel(){},speak(){}}; win.SpeechSynthesisUtterance=function(){};
    win.scrollTo=()=>{}; win.confirm=()=>true; win.HTMLElement.prototype.scrollIntoView=function(){};
    win.alert=(m)=>{ throw new Error('XSS FIRED: '+m); };
  }
});
const w=dom.window, d=w.document;
const errors=[];
w.addEventListener('error', e=>errors.push('window error: '+e.message));
const origErr=console.error; console.error=(...a)=>errors.push('console.error: '+a.join(' '));
const q=s=>d.querySelector(s);
const click=el=>el && el.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));

setTimeout(()=>{
  const R=[]; const chk=(n,c,e='')=>R.push([c?'PASS':'FAIL',n,e]);

  // 進複習模組
  click(d.querySelector('.nav button[data-m="review"]'));

  // --- 學習統計預設就該渲染 ---
  chk('stats tiles rendered', d.querySelectorAll('#review-stats .stat-tile').length === 4,
      String(d.querySelectorAll('#review-stats .stat-tile').length));
  chk('week dots has 7 cells', d.querySelectorAll('#week-dots .d').length === 7,
      String(d.querySelectorAll('#week-dots .d').length));
  chk('today cell marked', d.querySelectorAll('#week-dots .d.today').length === 1, '');

  // 預設是認得模式：看得到英文單字
  chk('recognition shows English word', q('#review-area .review-word') !== null, '');

  // --- 切到反向測驗（看中文拼英文）---
  click(d.querySelector('#review-mode-seg [data-mode="production"]'));
  chk('mode persisted to localStorage', store['ielts-review-mode'] === 'production', store['ielts-review-mode']);
  chk('production hides English word', q('#review-area .review-word') === null, '');
  chk('production shows Chinese prompt', q('#review-area .type-prompt') !== null, '');
  chk('production has type input', q('#review-area #review-type') !== null, '');

  // 目前這張卡的正解（英文在畫面上是藏著的，從內部狀態取來模擬使用者拼對）
  const curWord = w.eval('VOCAB.find(x=>x.id===REVIEW_QUEUE[0].id).word');

  // --- 拼對 ---
  d.getElementById('review-type').value = curWord;
  click(q('#review-area [data-act="review-check"]'));
  chk('correct spelling flagged hit', q('#review-area .type-result.hit') !== null, '');
  chk('answer revealed equals word', q('#review-area .type-answer') &&
      q('#review-area .type-answer').textContent === curWord, '');
  chk('grade buttons appear after check', q('#review-area [data-act="review-grade"]') !== null, '');

  // 評「記得」→ 應升到第 2 盒（沿用原本 Leitner 判分）
  click(q('#review-area [data-act="review-grade"][data-ok="1"]'));
  const promoted = JSON.parse(store['ielts-app-state'])['vocab-library'].find(v=>v.word===curWord);
  chk('production correct promotes box', promoted.box === 2, 'box='+promoted.box);

  // --- 拼錯 ---（下一張卡仍在 production 模式）
  const nextWord = w.eval('VOCAB.find(x=>x.id===REVIEW_QUEUE[0].id).word');
  d.getElementById('review-type').value = nextWord + 'zzz';
  click(q('#review-area [data-act="review-check"]'));
  chk('wrong spelling flagged miss', q('#review-area .type-result.miss') !== null, '');
  chk('miss still shows correct answer', q('#review-area .type-answer').textContent === nextWord, '');

  // --- 連續天數：評分後今天要進 study-log ---
  const log = JSON.parse(store['ielts-app-state'])['study-log'] || [];
  const today = w.eval('todayStr()');
  chk('study-log records today after grading', log.includes(today), JSON.stringify(log));
  chk('streak tile >= 1', parseInt(d.querySelector('#review-stats .stat-tile.flame .v').textContent,10) >= 1,
      d.querySelector('#review-stats .stat-tile.flame .v').textContent);

  // --- studyStreak 連續／中斷邏輯（用 app 自己的日期函式算期望值，避開時區歧義）---
  const streakOf = w.eval(`(function(dates){ APP_STATE['study-log']=dates; return studyStreak(); })`);
  const T  = w.eval('todayStr()');
  const y1 = w.eval('addDays(todayStr(),-1)');
  const y2 = w.eval('addDays(todayStr(),-2)');
  chk('streak counts 3 consecutive incl today', streakOf([T,y1,y2]) === 3, String(streakOf([T,y1,y2])));
  chk('streak continues from yesterday when today empty', streakOf([y1,y2]) === 2, String(streakOf([y1,y2])));
  chk('streak breaks on gap', streakOf([T,y2]) === 1, String(streakOf([T,y2])));
  chk('empty log = 0 streak', streakOf([]) === 0, String(streakOf([])));

  // 切回認得模式應恢復
  click(d.querySelector('#review-mode-seg [data-mode="recognition"]'));
  chk('switch back to recognition', store['ielts-review-mode'] === 'recognition', store['ielts-review-mode']);

  chk('no runtime errors', errors.length === 0, errors.join(' | '));

  const f=R.filter(r=>r[0]==='FAIL');
  R.forEach(([s,n,e])=>console.log(`${s}  ${n}${e?'  → '+e:''}`));
  console.log(`\n${R.length-f.length}/${R.length} passed`);
  process.exit(f.length?1:0);
}, 300);
