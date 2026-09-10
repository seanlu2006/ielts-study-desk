-- IELTS 讀書站 · 進度後端資料表
-- 灌進 D1： wrangler d1 execute ielts-progress --file=./schema.sql --remote

-- 使用者。密語不存明文，只存 PBKDF2 雜湊 + 每人不同的鹽。
CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,   -- 使用者自取的帳號（大小寫不敏感，見 register.js 會轉小寫）
  pass_hash  TEXT NOT NULL,      -- PBKDF2-HMAC-SHA256 雜湊（hex）
  salt       TEXT NOT NULL,      -- 每人獨立的鹽（hex）
  created_at TEXT NOT NULL
);

-- 進度。整包 APP_STATE 序列化成一段 JSON 存在 state。
-- version 做樂觀鎖：前端上傳時要帶上它讀到的 version，
-- 對不上就回 409，避免兩台裝置靜默互蓋（呼應前端約束 6）。
CREATE TABLE IF NOT EXISTS progress (
  user_id    TEXT PRIMARY KEY,
  state      TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
