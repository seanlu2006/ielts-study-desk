/* POST /api/register  { userId, passphrase }
   建立新帳號，成功回一張 token（等於順手登入）。 */
import { json, fail, genSalt, hashPassphrase, signToken, normalizeUserId } from './_lib.js';

export async function onRequestPost(context){
  const { request, env } = context;
  if(!env.TOKEN_SECRET) return fail(500, '伺服器未設定 TOKEN_SECRET，請聯絡管理者。');

  let body;
  try{ body = await request.json(); }catch(_){ return fail(400, '請求格式錯誤。'); }

  const userId = normalizeUserId(body.userId);
  const passphrase = String(body.passphrase || '');

  // 帳號與密語的基本門檻，訊息要能指出怎麼改
  if(userId.length < 3 || userId.length > 40 || !/^[a-z0-9_-]+$/.test(userId)){
    return fail(400, '帳號需 3–40 字，只能用小寫英數、底線或連字號。');
  }
  if(passphrase.length < 6){
    return fail(400, '通關密語至少 6 個字，越長越安全。');
  }

  const existing = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first();
  if(existing) return fail(409, '這個帳號已經有人用了，換一個，或直接改用「登入」。');

  const salt = genSalt();
  const passHash = await hashPassphrase(passphrase, salt);
  const now = new Date().toISOString();

  await env.DB.prepare('INSERT INTO users (id, pass_hash, salt, created_at) VALUES (?, ?, ?, ?)')
    .bind(userId, passHash, salt, now).run();

  const token = await signToken(userId, env.TOKEN_SECRET);
  return json({ token, userId }, 201);
}
