/* /api/progress
     GET  → 取回這個帳號的整包進度與 version
     PUT  { state, version } → 上傳進度，version 對不上回 409（樂觀鎖）
   兩個都要帶 Authorization: Bearer <token>。 */
import { json, fail, requireUser } from './_lib.js';

const MAX_STATE_BYTES = 4 * 1024 * 1024; // 4MB，比 localStorage 上限還寬，撞到才提醒

async function auth(request, env){
  try{ return { userId: await requireUser(request, env) }; }
  catch(e){ if(e instanceof Response) return { response: e }; throw e; }
}

export async function onRequestGet(context){
  const { request, env } = context;
  const a = await auth(request, env);
  if(a.response) return a.response;

  const row = await env.DB.prepare(
    'SELECT state, version, updated_at FROM progress WHERE user_id = ?'
  ).bind(a.userId).first();

  if(!row) return json({ state:null, version:0, updatedAt:null }); // 新帳號還沒存過
  let state;
  try{ state = JSON.parse(row.state); }catch(_){ state = null; }
  return json({ state, version: row.version, updatedAt: row.updated_at });
}

export async function onRequestPut(context){
  const { request, env } = context;
  const a = await auth(request, env);
  if(a.response) return a.response;

  let body;
  try{ body = await request.json(); }catch(_){ return fail(400, '請求格式錯誤。'); }
  if(body.state == null) return fail(400, '沒有收到要儲存的資料。');

  const stateStr = JSON.stringify(body.state);
  if(stateStr.length > MAX_STATE_BYTES){
    return fail(413, '進度資料太大，超過上限。請先在設定頁清一些舊的寫作紀錄再同步。');
  }
  const clientVersion = Number(body.version) || 0;
  const now = new Date().toISOString();

  const current = await env.DB.prepare('SELECT version FROM progress WHERE user_id = ?')
    .bind(a.userId).first();

  if(!current){
    // 第一次存：這個帳號還沒有 progress 列。用條件插入擋掉「兩台同時第一次存」的競態。
    const res = await env.DB.prepare(
      'INSERT INTO progress (user_id, state, version, updated_at) VALUES (?, ?, 1, ?) ' +
      'ON CONFLICT(user_id) DO NOTHING'
    ).bind(a.userId, stateStr, now).run();
    if(res.meta.changes === 0){
      // 另一台裝置搶先插入了，回傳它的版本讓前端去下載
      const winner = await env.DB.prepare('SELECT state, version FROM progress WHERE user_id = ?')
        .bind(a.userId).first();
      return json({ conflict:true, state: JSON.parse(winner.state), version: winner.version }, 409);
    }
    return json({ version: 1, updatedAt: now });
  }

  // 已有資料：只在 version 相符時才覆蓋，否則回 409 附上雲端現況
  const res = await env.DB.prepare(
    'UPDATE progress SET state = ?, version = version + 1, updated_at = ? WHERE user_id = ? AND version = ?'
  ).bind(stateStr, now, a.userId, clientVersion).run();

  if(res.meta.changes === 0){
    const winner = await env.DB.prepare('SELECT state, version FROM progress WHERE user_id = ?')
      .bind(a.userId).first();
    return json({ conflict:true, state: JSON.parse(winner.state), version: winner.version }, 409);
  }
  return json({ version: clientVersion + 1, updatedAt: now });
}
