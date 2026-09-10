# 部署手冊 — Cloudflare Pages + D1 進度後端

> ✅ **已於 2026-08-03 首次部署完成。** 正式站：https://ielts-study-desk.pages.dev
> 帳號 seanlu2006@gmail.com｜Pages 專案 `ielts-study-desk`｜D1 `ielts-progress`（id `e9fc078d-dbf4-48eb-b428-db26ea4750d0`）｜`TOKEN_SECRET` 已設。
> **之後改 code 只要跑 `npm run deploy`**（見最下方「之後每次更新」）。下面的步驟一～五是當初怎麼建的紀錄，重建或換帳號時才需要。

給你（第一次弄後端）用的逐步流程。整套免費，不用信用卡。
每一步都標了「這步在做什麼」，照著打就好。

`wrangler` 已裝成本專案的 devDependency，指令一律用 `npx wrangler ...`（不用全域安裝）。

## 你會用到的東西

- 一個 Cloudflare 帳號（免費）：https://dash.cloudflare.com
- `wrangler`：Cloudflare 的命令列工具。安裝：

```bash
npm install -g wrangler
```

- 登入（會開瀏覽器要你授權）：

```bash
wrangler login
```

## 步驟一：建 D1 資料庫

```bash
wrangler d1 create ielts-progress
```

跑完它會印出一段設定，裡面有 `database_id = "xxxxxxxx-...."`。
**把那個 id 複製起來**，貼進 `wrangler.toml` 裡 `REPLACE_WITH_YOUR_D1_DATABASE_ID` 的位置。

## 步驟二：建資料表

先在本機測試庫建（本機模擬，用來 `wrangler pages dev`）：

```bash
wrangler d1 execute ielts-progress --file=./schema.sql --local
```

再灌到雲端正式庫：

```bash
wrangler d1 execute ielts-progress --file=./schema.sql --remote
```

## 步驟三：設定 token 密鑰

這把密鑰用來簽登入 token。**隨便打一段長亂碼就好，但要保密**，別放進任何檔案：

```bash
wrangler pages secret put TOKEN_SECRET
```

它會問你值，貼上你的亂碼（例如用 `openssl rand -hex 32` 產一個）後按 Enter。

## 步驟四：建 Pages 專案（非互動）

```bash
npx wrangler pages project create ielts-study-desk --production-branch=main
```

## 步驟五：部署

`npm run deploy` 會先跑 `build.mjs` 產生乾淨的 `dist/`（只有 `index.html` + `functions/`，
不含 node_modules / 測試檔），再上傳：

```bash
npm run deploy
```

部署完會給你網址（`https://ielts-study-desk.pages.dev`）。打開它，到「設定 → 雲端進度」註冊帳號就能用了。

> 為什麼不直接 `wrangler pages deploy .`？因為專案根目錄有 `node_modules` 和 `test*.js`，
> 直接部署會把上千個檔案一起上傳（超過 Pages 檔案數上限、又慢又髒）。所以走 `dist/`。

## 之後每次更新

改完 `ielts.html` 或 `functions/` 後，一行搞定：

```bash
npm run deploy
```

改了 `schema.sql`（加欄位之類）才需要另外重跑步驟二的 `--remote`。

## 本機邊改邊測（選用）

想在部署前先在自己電腦跑起來（含後端 API 與本機 D1）：

```bash
npm run dev
```

（等同 `build.mjs` + `wrangler pages dev dist`。本機 D1 要先跑過 `--local` 版的 schema，見步驟二。）

## 排查

- **註冊時說「伺服器未設定 TOKEN_SECRET」** → 步驟三沒做，或部署在設密鑰之前。設完再 `npm run deploy` 一次。
- **API 回 500 / 找不到表** → 步驟二的 `--remote` 沒跑，雲端庫還沒有表。
- **部署後第一次呼叫 API 出現 5xx（例如 522）** → 剛部署完 Functions 在全球傳播，通常幾秒後重試就好。
- **登入後同步一直失敗** → 打開瀏覽器 F12 的 Network 看 `/api/progress` 的回應訊息，前端會把後端錯誤原文顯示在雲端狀態列。
- **想看雲端存了什麼**：

```bash
npx wrangler d1 execute ielts-progress --remote --command "SELECT id, created_at FROM users"
```
