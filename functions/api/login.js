/* POST /api/login  { userId, passphrase }
   驗證密語，成功回 token。 */
import { json, fail, hashPassphrase, timingSafeEqual, signToken, normalizeUserId } from './_lib.js';

export async function onRequestPost(context){
  const { request, env } = context;
  if(!env.TOKEN_SECRET) return fail(500, '伺服器未設定 TOKEN_SECRET，請聯絡管理者。');

  let body;
  try{ body = await request.json(); }catch(_){ return fail(400, '請求格式錯誤。'); }

  const userId = normalizeUserId(body.userId);
  const passphrase = String(body.passphrase || '');

  const user = await env.DB.prepare('SELECT pass_hash, salt FROM users WHERE id = ?').bind(userId).first();

  // 帳號不存在也走一次雜湊再比對，讓「帳號錯」與「密語錯」耗時接近，
  // 不從回應快慢洩漏帳號是否存在。對外訊息一律含糊帶過。
  const salt = user ? user.salt : '0'.repeat(32);
  const candidate = await hashPassphrase(passphrase, salt);
  const ok = user ? timingSafeEqual(candidate, user.pass_hash) : false;

  if(!ok) return fail(401, '帳號或密語不對。忘記密語的話，資料無法救回，只能重新註冊。');

  const token = await signToken(userId, env.TOKEN_SECRET);
  return json({ token, userId });
}
