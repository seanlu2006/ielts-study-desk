/* test5.js — 單字庫「查詢」與「加入」拆成兩步
   驗證查詢只產生預覽、加入才寫入、捨棄可放棄、重複字不會加兩次。
   直接驅動 VOCAB_PREVIEW / ACTIONS，不必 mock Gemini（那條錯誤路徑 test3 已涵蓋）。 */
const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'ielts.html'), 'utf8');

const seedState = {
  'vocab-library': [
    { id:'m1', word:'mitigate', ipa:'/ˈmɪtɪɡeɪt/', partOfSpeech:'v.', meaningZh:'減輕',
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
console.error=(...a)=>errors.push('console.error: '+a.join(' '));
const q=s=>d.querySelector(s);
const click=el=>el && el.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
const lib=()=>JSON.parse(store['ielts-app-state'])['vocab-library'];

function setPreview(word){
  w.eval(`VOCAB_PREVIEW = ${JSON.stringify({
    word, ipa:'/luːsɪd/', partOfSpeech:'adj.', meaningZh:'清晰的', meaningEn:'clear and easy to understand',
    collocations:['a lucid explanation'], linkingWords:[], examples:['She gave a lucid summary.'], synonyms:['clear'], band:'7'
  })}; renderVocabPreview();`);
}

setTimeout(()=>{
  const R=[]; const chk=(n,c,e='')=>R.push([c?'PASS':'FAIL',n,e]);

  // 起始：1 個字，沒有預覽卡
  chk('starts with 1 word', lib().length === 1, String(lib().length));
  chk('no preview initially', q('#vocab-preview .card') === null, '');

  // --- 查詢 → 只出現預覽，尚未寫入 ---
  setPreview('lucid');
  chk('preview card shown after query', q('#vocab-preview [data-act="vocab-add"]') !== null, '');
  chk('preview shows the word', /lucid/.test(q('#vocab-preview').textContent), '');
  chk('preview marked not-yet-added', /尚未加入/.test(q('#vocab-preview').textContent), '');
  chk('query does NOT write to library yet', lib().length === 1, String(lib().length));

  // --- 加入 → 才寫入單字庫與複習佇列 ---
  click(q('#vocab-preview [data-act="vocab-add"]'));
  chk('add writes to library', lib().length === 2, String(lib().length));
  chk('added word present', lib().some(v=>v.word==='lucid'), '');
  const added = lib().find(v=>v.word==='lucid');
  chk('added word got id + box 1', !!added.id && added.box === 1, JSON.stringify({id:added.id,box:added.box}));
  chk('added word queued for review today', added.nextReview === w.eval('todayStr()'), added.nextReview);
  chk('preview cleared after add', q('#vocab-preview .card') === null, '');
  chk('vocab stamp updated to 2', q('#vocab-stamp .n').textContent === '2', q('#vocab-stamp .n').textContent);
  chk('in review queue', w.eval('REVIEW_QUEUE.some(x=>{const v=VOCAB.find(y=>y.id===x.id);return v&&v.word==="lucid";})') === true, '');

  // --- 捨棄 → 放棄預覽，不寫入 ---
  setPreview('ephemeral');
  chk('second preview shown', /ephemeral/.test(q('#vocab-preview').textContent), '');
  click(q('#vocab-preview [data-act="vocab-preview-cancel"]'));
  chk('cancel clears preview', q('#vocab-preview .card') === null, '');
  chk('cancel does not add', lib().length === 2, String(lib().length));

  // --- 重複字防呆：預覽一個已在庫裡的字，加入不應變兩筆 ---
  setPreview('mitigate');
  click(q('#vocab-preview [data-act="vocab-add"]'));
  chk('duplicate word not added twice', lib().filter(v=>v.word==='mitigate').length === 1,
      String(lib().filter(v=>v.word==='mitigate').length));
  chk('duplicate clears preview + warns', q('#vocab-preview .card') === null &&
      /已經在單字庫裡/.test(q('#vocab-status').textContent), q('#vocab-status').textContent);

  chk('no runtime errors', errors.length === 0, errors.join(' | '));

  const f=R.filter(r=>r[0]==='FAIL');
  R.forEach(([s,n,e])=>console.log(`${s}  ${n}${e?'  → '+e:''}`));
  console.log(`\n${R.length-f.length}/${R.length} passed`);
  process.exit(f.length?1:0);
}, 300);
