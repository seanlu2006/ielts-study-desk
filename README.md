# 考場筆記 · IELTS Study Desk

把查過的單字、答錯的題目和寫作回饋收在同一個地方，並自動排出明天該複習什麼。

**線上版：https://ielts-study-desk.pages.dev** — 不用註冊就能開始用，資料存在你自己的瀏覽器。

---

## 為什麼做這個

我在準備 IELTS 的時候，資料是散的：單字查在翻譯網站、練習題寫在筆記本、作文丟給 AI 改完關掉分頁就沒了。
過兩天想複習，根本不記得上禮拜哪裡錯。Anki 要自己做卡片，做卡片本身就夠煩到讓人放棄。

所以我想要一個東西：**查過的字自動變成複習卡，答錯的題目自動進錯題本，然後告訴我今天該複習哪幾個字。**
市面上的 App 要嘛只做單字、要嘛只做題目，沒有把「輸入 → 犯錯 → 複習」串成一條線的，就自己寫一個。

## 核心功能

- **查單字自動變複習卡** — 輸入英文單字，Gemini 回 IPA、中英字義、搭配詞、例句、同義字與大約的 band 分數。先出預覽，按「加入單字庫」才真的存進去並排進複習佇列（避免查錯字污染單字庫）。
- **Leitner 五盒間隔重複** — 答對往上升一盒、答錯直接掉回第一盒。五個盒子的複習間隔是 1 / 2 / 4 / 7 / 14 天。
- **兩種複習模式** — 「認得」看英文想中文；「反向測驗」看中文拼英文，逼出 production recall，不是看到就覺得自己會了。
- **錯題自動進錯誤筆記本** — 練習題答錯、作文某項評分偏低，都會自動記下技能與子題型，畫成弱點分布圖，可以再叫 AI 針對分布做診斷。
- **依單字庫出題** — 用你自己的單字和弱項生成閱讀、寫作、聽力、口說題；聽力題用瀏覽器的 Web Speech API 唸出來，可切英式／美式腔。
- **跨裝置同步（選用）** — 不註冊就全部存本機。註冊後整包進度同步到 Cloudflare D1，用樂觀鎖擋住兩台裝置互相覆蓋。

## 快速開始

最快的方式是直接開 [線上版](https://ielts-study-desk.pages.dev)。想在本機看程式碼跑起來：

```bash
git clone https://github.com/seanlu2006/ielts-study-desk.git
cd ielts-study-desk
open ielts.html          # Linux 用 xdg-open，Windows 用 start
```

前端是單一 HTML 檔，雙擊就會開，介面與本機資料（單字庫、複習、錯題本）都能用。
但 `/api` 在 `file://` 底下不存在，所以雲端同步會停用；要完整跑就用下面的 `npm run dev`。

要跑完整環境（前端 + API + 本機 D1）或跑測試：

```bash
npm install

# 建本機 D1 測試庫（只有第一次要做）
npx wrangler d1 execute ielts-progress --file=./schema.sql --local

npm test    # 94 個 jsdom 檢查，不會真的打 API
npm run dev # 前端 + Pages Functions + 本機 D1
```

要用 AI 功能，得到網站的「設定」頁貼上自己的 [Google AI Studio](https://aistudio.google.com/apikey) Gemini API Key。
金鑰只存在你的瀏覽器，不會經過我的伺服器。

自己部署一份的完整流程（建 D1、灌 schema、設 `TOKEN_SECRET`）寫在 [`DEPLOY-backend.md`](DEPLOY-backend.md)。
`wrangler.toml` 裡的 `database_id` 要換成你自己 `wrangler d1 create` 拿到的 ID。

## 技術架構

| 層 | 選用 |
|---|---|
| 前端 | 單一 HTML 檔，原生 JS，無框架、無建置步驟、無 runtime 相依 |
| 本機儲存 | `localStorage`（單一 key `ielts-app-state`），支援 JSON 匯出／匯入 |
| 後端（選用） | Cloudflare Pages Functions + D1（SQLite） |
| AI | Google Gemini，由使用者自備金鑰、瀏覽器直接呼叫 |
| 語音 | Web Speech API |
| 測試 | jsdom，94 個檢查 |

### 幾個選擇背後的理由

**為什麼是單一 HTML 檔，不用 React？**
這是我每天自己要用的工具，不是要長期維護的產品。加上框架就多出建置步驟、依賴更新和 `node_modules`；
單檔的好處是可以直接 double-click 打開、飛機上沒網路也能複習單字、整份丟給 AI 讀還讀得完。
代價很實在：2,200 行 CSS + JS 全擠在一個檔案裡，再長下去就得拆，目前還沒到那個點。

**為什麼是 Cloudflare Pages + D1，不是 Node + Postgres？**
需求只有「幾個 API 端點 + 一張使用者表 + 一張進度表」，架一台真的伺服器完全過剩。
Pages Functions 跟前端同源，所以完全不用處理 CORS；D1 是 SQLite 語法，不用學新查詢語言；
免費額度對個人專案綽綽有餘，而且沒有伺服器要顧、沒有東西會半夜掛掉。
代價是跑在 Workers runtime 而不是 Node，所以裝不了 `bcrypt` 這類原生套件——密碼雜湊只能用 Web Crypto 的 PBKDF2 自己刻。

**為什麼使用者要自備 Gemini 金鑰？**
我不想幫所有使用者付 API 費用，也不想存別人的金鑰。金鑰留在使用者瀏覽器、直接打 Google，
我的後端從頭到尾看不到它。代價是金鑰暴露在前端，所以要靠 Google Cloud Console 的 HTTP referrer 限制擋住盜用。

**為什麼同步要做樂觀鎖？**
上一版用 JSONBin 做同步，是 last-write-wins——手機上複習完，回到電腦一存就把手機的進度蓋掉了。
現在每筆進度帶一個 `version`，上傳時版本對不上就回 409 並附上雲端現況，前端採用雲端版並掛橘色橫幅提醒，
不會安靜地吃掉你的資料。加後端的直接導火線則是 iOS Safari：連續七天沒開，`localStorage` 會被系統清掉。

### 資料怎麼流

```text
查單字
  瀏覽器 ──直接呼叫──> Gemini API        （金鑰不經過我的伺服器）
        <──單字結構化資料──
        └─> 預覽卡 ──按「加入」──> localStorage['ielts-app-state']
                                        └─> Leitner 佇列，排定 nextReview

同步（選用，登入後）
  localStorage ──PUT /api/progress { state, version }──> Pages Function
                                                            └─> D1 progress 表
                                                                 version 相符才寫
                                <──409 + 雲端現況──  版本對不上就擋下來
```

### 帳號那部分怎麼處理

後端只有三個端點：`POST /api/register`、`POST /api/login`、`GET|PUT /api/progress`。

- 密語不存明文，只存 PBKDF2-HMAC-SHA256（10 萬次迭代）+ 每人獨立的鹽
- 登入 token 是無狀態的 HMAC-SHA256 簽章串，30 天到期，不用開 session 表
- 雜湊比對走定值時間，帳號不存在時也照樣跑一次假雜湊，避免從回應快慢反推帳號存不存在
- `TOKEN_SECRET` 用 `wrangler pages secret put` 設定，不進版控

## 專案結構

```text
ielts.html              前端全部：CSS、JS、七個功能模組都在這一個檔案裡
functions/api/
  ├── _lib.js           後端共用：PBKDF2 雜湊、token 簽驗、HTTP 回應工具
  ├── register.js       建帳號，成功回一張 token
  ├── login.js          驗密語，成功回 token
  └── progress.js       進度讀寫，PUT 走樂觀鎖，衝突回 409
tests/                  jsdom 測試，用 npm test 依編號跑，共 94 個檢查
schema.sql              D1 建表：users + progress
wrangler.toml           Cloudflare Pages 與 D1 綁定設定
build.mjs               產生 dist/：ielts.html 改名成 index.html + 複製 functions/
DEPLOY-backend.md       第一次架後端的逐步流程
CLAUDE.md               給 AI 協作者的開發約束（踩過的坑都記在裡面）
```

## 已知限制

- **口說模組沒有實作。** 介面上有入口，但要真的能用得接 `MediaRecorder` 錄音再送去評分，工程量比其他模組大一個量級，還沒動。
- **後端沒有自動化測試。** 94 個測試全部涵蓋前端；註冊、登入、樂觀鎖衝突目前只能用 `npm run dev` 手動驗。這是我自己覺得最該補的一塊。
- **同步衝突是「雲端優先 + 大聲提醒」，不是真的合併。** 兩台裝置同時改的話，後上傳的那台會被要求採用雲端版，本機那次變更會不見（有橫幅提醒，不是靜默）。要做得更好得寫欄位級 merge。
- **手機版側邊欄在約 375px 寬的螢幕上會擠壞**，中文字直排、產生橫向捲軸。`@media (max-width:800px)` 那段要重寫。

## License

[MIT](LICENSE)
