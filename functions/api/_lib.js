/* ============================================================
   後端共用工具（跑在 Cloudflare Workers 執行環境）
   ------------------------------------------------------------
   底線開頭的檔案不會被 Pages Functions 當成路由，所以放共用碼很安全。
   只用 Web Crypto，不引入任何 npm 相依。
   ============================================================ */

const PBKDF2_ITERATIONS = 100000; // 夠慢到讓暴力破解不划算，又不會拖垮邊緣節點
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // token 有效 30 天，之後要重新登入

/* ---- 編碼小工具 ---- */
function bufToHex(buf){
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function b64urlEncode(str){
  // btoa 只吃 latin1，先把 UTF-8 轉成安全的位元組序列
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for(const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s){
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for(let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function b64urlFromBuf(buf){
  let bin = '';
  for(const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* ---- 密語雜湊 ---- */
export function genSalt(){
  return bufToHex(crypto.getRandomValues(new Uint8Array(16)));
}
export async function hashPassphrase(passphrase, saltHex){
  const enc = new TextEncoder();
  const saltBytes = new Uint8Array(saltHex.match(/../g).map(h => parseInt(h, 16)));
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name:'PBKDF2', salt:saltBytes, iterations:PBKDF2_ITERATIONS, hash:'SHA-256' },
    keyMaterial, 256
  );
  return bufToHex(bits);
}
/* 定值時間比對，避免用 === 比雜湊時洩漏時間資訊 */
export function timingSafeEqual(a, b){
  if(a.length !== b.length) return false;
  let diff = 0;
  for(let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ---- token 簽章／驗證（無狀態，不需 session 表） ---- */
async function hmac(secret, data){
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name:'HMAC', hash:'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return b64urlFromBuf(sig);
}
export async function signToken(userId, secret){
  const payload = { u: userId, exp: Math.floor(Date.now()/1000) + TOKEN_TTL_SECONDS };
  const body = b64urlEncode(JSON.stringify(payload));
  const sig = await hmac(secret, body);
  return `${body}.${sig}`;
}
/* 驗證成功回 userId，失敗回 null。過期、被竄改、格式錯都算失敗 */
export async function verifyToken(token, secret){
  if(!token || token.indexOf('.') < 0) return null;
  const [body, sig] = token.split('.');
  const expected = await hmac(secret, body);
  if(!timingSafeEqual(sig, expected)) return null;
  let payload;
  try{ payload = JSON.parse(b64urlDecode(body)); }catch(_){ return null; }
  if(!payload || !payload.u || !payload.exp) return null;
  if(payload.exp < Math.floor(Date.now()/1000)) return null;
  return payload.u;
}

/* ---- HTTP 回應小工具 ---- */
export function json(data, status){
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type':'application/json; charset=utf-8' }
  });
}
/* 錯誤訊息一律附「下一步能做什麼」，跟前端的訊息慣例一致 */
export function fail(status, message){
  return json({ error: message }, status);
}

/* 從 Authorization: Bearer xxx 取出 token，並驗證。
   回傳 userId 或丟出可直接回給前端的 Response */
export async function requireUser(request, env){
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const userId = await verifyToken(token, env.TOKEN_SECRET);
  if(!userId) throw fail(401, '登入已失效，請回設定頁重新登入。');
  return userId;
}

/* 帳號正規化：轉小寫去空白，避免 "Sean" 與 "sean " 被當成兩個人 */
export function normalizeUserId(raw){
  return String(raw || '').trim().toLowerCase();
}
