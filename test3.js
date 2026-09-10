const fs=require('fs'), {JSDOM}=require('jsdom');
const html=fs.readFileSync('ielts.html','utf8');

const MODELS={models:[
 {name:'models/gemini-3.5-flash',supportedGenerationMethods:['generateContent']},
 {name:'models/gemini-3.1-flash-lite',supportedGenerationMethods:['generateContent']},
 {name:'models/gemini-3.1-pro-preview',supportedGenerationMethods:['generateContent']},
 {name:'models/text-embedding-004',supportedGenerationMethods:['embedContent']},
 {name:'models/gemini-2.5-flash-tts',supportedGenerationMethods:['generateContent']},
 {name:'models/imagen-4.0-generate',supportedGenerationMethods:['generateContent']},
 {name:'models/aqa',supportedGenerationMethods:['generateAnswer']},
]};

function run(seedState, fetchImpl){
 return new Promise(resolve=>{
  const store={'ielts-app-state':JSON.stringify(seedState)};
  const calls=[];
  const dom=new JSDOM(html,{runScripts:'dangerously',url:'https://example.com/',pretendToBeVisual:true,
   beforeParse(win){
    Object.defineProperty(win,'localStorage',{value:{
      getItem:k=>k in store?store[k]:null,setItem:(k,v)=>{store[k]=String(v);},removeItem:k=>{delete store[k];}}});
    win.speechSynthesis={cancel(){},speak(){}}; win.SpeechSynthesisUtterance=function(){};
    win.scrollTo=()=>{}; win.confirm=()=>true; win.HTMLElement.prototype.scrollIntoView=function(){};
    win.fetch=(url,opts)=>{calls.push(String(url)); return fetchImpl(String(url),opts,win);};
   }});
  setTimeout(()=>resolve({w:dom.window,d:dom.window.document,store,calls}),400);
 });
}
const ok=body=>Promise.resolve({ok:true,status:200,json:async()=>body});
const err=(status,message)=>Promise.resolve({ok:false,status,json:async()=>({error:{message}})});

(async()=>{
 const R=[]; const chk=(n,c,e='')=>R.push([c?'PASS':'FAIL',n,e]);
 const opts=d=>[...d.querySelectorAll('#set-model option')].map(o=>o.value);

 // --- 1. auto-fetch on startup, filtering non-chat models ---
 let t=await run({settings:{apiKey:'k1',model:'gemini-2.0-flash',accent:'en-GB'}},u=>
   u.includes('/models?')?ok(MODELS):err(500,'unexpected'));
 chk('auto-fetched model list on startup', t.calls.some(u=>u.includes('/v1beta/models?')),'');
 chk('embedding/tts/imagen/aqa filtered out',
   JSON.stringify(opts(t.d))==='["gemini-3.1-flash-lite","gemini-3.1-pro-preview","gemini-3.5-flash"]',
   JSON.stringify(opts(t.d)));
 chk('retired gemini-2.0-flash replaced with a flash model',
   t.d.getElementById('set-model').value==='gemini-3.5-flash', t.d.getElementById('set-model').value);
 chk('new model persisted',
   JSON.parse(t.store['ielts-app-state']).settings.model==='gemini-3.5-flash','');
 chk('lite is labelled as the roomiest quota',
   /額度最寬鬆/.test([...t.d.querySelectorAll('#set-model option')][0].textContent),'');
 chk('no warning banner once key+model are set',
   t.d.getElementById('global-warning').textContent.trim()==='', t.d.getElementById('global-warning').textContent);

 // --- 2. cached list means no refetch ---
 t=await run({settings:{apiKey:'k1',model:'gemini-3.5-flash',accent:'en-GB'},
              'model-list':['gemini-3.5-flash','gemini-3.1-flash-lite']},()=>err(500,'should not be called'));
 chk('cached list avoids a startup request', !t.calls.some(u=>u.includes('/v1beta/models?')), t.calls.join(','));
 chk('cached list populates dropdown', opts(t.d).length===2, JSON.stringify(opts(t.d)));

 // --- 3. 429 with limit: 0 must NOT be reported as "slow down" ---
 t=await run({settings:{apiKey:'k1',model:'gemini-3.1-pro-preview',accent:'en-GB'},
              'model-list':['gemini-3.1-pro-preview']},
   u=>u.includes(':generateContent')
     ? err(429,'Quota exceeded for quota metric ... limit: 0 ... free_tier_requests')
     : ok(MODELS));
 t.d.getElementById('vocab-input').value='mitigate';
 t.d.getElementById('vocab-search-btn').dispatchEvent(new t.w.MouseEvent('click',{bubbles:true}));
 await new Promise(r=>setTimeout(r,200));
 let msg=t.d.getElementById('vocab-status').textContent;
 chk('limit:0 explained as no quota for this model', /沒有可用額度/.test(msg), msg.slice(0,50));
 chk('limit:0 does NOT say to wait a minute', !/等一分鐘/.test(msg), msg.slice(0,50));

 // --- 4. a genuine rate limit still says to wait ---
 t=await run({settings:{apiKey:'k1',model:'gemini-3.5-flash',accent:'en-GB'},'model-list':['gemini-3.5-flash']},
   u=>u.includes(':generateContent')?err(429,'Resource has been exhausted (e.g. check quota).'):ok(MODELS));
 t.d.getElementById('vocab-input').value='mitigate';
 t.d.getElementById('vocab-search-btn').dispatchEvent(new t.w.MouseEvent('click',{bubbles:true}));
 await new Promise(r=>setTimeout(r,200));
 msg=t.d.getElementById('vocab-status').textContent;
 chk('real rate limit says wait a minute', /等一分鐘/.test(msg), msg.slice(0,50));

 // --- 5. 404 on a retired model ---
 t=await run({settings:{apiKey:'k1',model:'gemini-2.0-flash',accent:'en-GB'},'model-list':['gemini-2.0-flash']},
   u=>u.includes(':generateContent')?err(404,'not found'):ok(MODELS));
 t.d.getElementById('vocab-input').value='mitigate';
 t.d.getElementById('vocab-search-btn').dispatchEvent(new t.w.MouseEvent('click',{bubbles:true}));
 await new Promise(r=>setTimeout(r,200));
 msg=t.d.getElementById('vocab-status').textContent;
 chk('404 points at the retired model', /退役/.test(msg) && /gemini-2\.0-flash/.test(msg), msg.slice(0,60));

 // --- 6. no key at all ---
 t=await run({}, ()=>err(500,'nope'));
 chk('no key shows the setup warning', /還沒設定 Gemini API 金鑰/.test(t.d.getElementById('global-warning').textContent),'');
 chk('no key means no network call', t.calls.length===0, t.calls.join(','));

 // --- 7. manual "load models" button ---
 t=await run({settings:{apiKey:'k1',model:'',accent:'en-GB'},'model-list':['stale-model']},
   u=>u.includes('/models?')?ok(MODELS):err(500,'x'));
 t.d.getElementById('set-load-models').dispatchEvent(new t.w.MouseEvent('click',{bubbles:true}));
 await new Promise(r=>setTimeout(r,200));
 chk('manual refresh replaces the stale list', opts(t.d).includes('gemini-3.5-flash') && !opts(t.d).includes('stale-model'),
   JSON.stringify(opts(t.d)));
 chk('refresh reports how many were found', /找到 3 個可用模型/.test(t.d.getElementById('model-status').textContent),
   t.d.getElementById('model-status').textContent);

 const f=R.filter(r=>r[0]==='FAIL');
 R.forEach(([s,n,e])=>console.log(`${s}  ${n}${e?'  → '+e:''}`));
 console.log(`\n${R.length-f.length}/${R.length} passed`);
 process.exit(f.length?1:0);
})();
