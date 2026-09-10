const fs=require('fs'), {JSDOM}=require('jsdom');
const html=fs.readFileSync('ielts.html','utf8');
let store={}, failNext=false;
const dom=new JSDOM(html,{runScripts:'dangerously',url:'https://example.com/',pretendToBeVisual:true,
 beforeParse(win){
  Object.defineProperty(win,'localStorage',{value:{
    getItem:k=>k in store?store[k]:null,
    setItem:(k,v)=>{ if(failNext){const e=new Error('quota');e.name='QuotaExceededError';throw e;} store[k]=String(v);},
    removeItem:k=>{delete store[k];}}});
  win.speechSynthesis={cancel(){},speak(){}}; win.SpeechSynthesisUtterance=function(){};
  win.scrollTo=()=>{}; win.confirm=()=>true; win.HTMLElement.prototype.scrollIntoView=function(){};
  // jsdom 24 沒實作 Blob/File.text()，真瀏覽器有。用它支援的 FileReader 補上，
  // 匯入流程才測得到（否則 file.text() 直接丟錯，round-trip 永遠 FAIL）。
  if(!win.Blob.prototype.text){
    win.Blob.prototype.text=function(){return new Promise((res,rej)=>{
      const fr=new win.FileReader(); fr.onload=()=>res(fr.result); fr.onerror=()=>rej(fr.error); fr.readAsText(this);
    });};
  }
 }});
const w=dom.window, d=w.document;
setTimeout(async()=>{
  const R=[]; const chk=(n,c,e='')=>R.push([c?'PASS':'FAIL',n,e]);

  // quota warning must surface, not be swallowed
  failNext=true;
  d.getElementById('set-apikey').value='test-key';
  d.getElementById('set-save-btn').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  chk('quota failure surfaces a warning', d.getElementById('global-warning').textContent.includes('儲存空間已滿'),
      d.getElementById('global-warning').textContent.slice(0,30));
  failNext=false;

  // import a backup file
  const backup={_app:'ielts-study-desk',_version:2,state:{
    'vocab-library':[{id:'x1',word:'ubiquitous',meaningZh:'無所不在的',box:3,nextReview:'2030-01-01',reviewCount:2,lapses:0,addedAt:'2026-01-01'}],
    'error-notebook':[{id:'q1',date:'2026-05-05',skill:'listening',subtype:'數字聽寫',note:'漏聽'}],
    'settings':{apiKey:'restored-key',model:'gemini-2.5-flash',accent:'en-US'}}};
  const input=d.getElementById('data-import-file');
  const file=new w.File([JSON.stringify(backup)],'b.json',{type:'application/json'});
  Object.defineProperty(input,'files',{value:[file],configurable:true});
  input.dispatchEvent(new w.Event('change',{bubbles:true}));
  await new Promise(r=>setTimeout(r,150));

  chk('import restored vocab', d.querySelector('#vocab-stamp .n').textContent==='1', d.querySelector('#vocab-stamp .n').textContent);
  chk('import restored settings', d.getElementById('set-apikey').value==='restored-key', d.getElementById('set-apikey').value);
  chk('import restored model', d.getElementById('set-model').value==='gemini-2.5-flash','');
  chk('box-3 word not due yet', d.querySelector('#review-stamp .n').textContent==='0', d.querySelector('#review-stamp .n').textContent);
  chk('box distribution correct', d.querySelectorAll('#box-dist .c')[2].textContent==='1',
      [...d.querySelectorAll('#box-dist .c')].map(e=>e.textContent).join(','));
  chk('import status ok', d.getElementById('data-status').textContent.includes('已從備份檔還原'),'');
  chk('storage usage shown', /KB/.test(d.getElementById('storage-usage').textContent),'');

  const f=R.filter(r=>r[0]==='FAIL');
  R.forEach(([s,n,e])=>console.log(`${s}  ${n}${e?'  → '+e:''}`));
  console.log(`\n${R.length-f.length}/${R.length} passed`);
  process.exit(f.length?1:0);
},300);
