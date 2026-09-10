# CLAUDE.md — IELTS 個人讀書站

給接手的 Claude Code。動手前先讀完這份，特別是「不可破壞的約束」那節。

## 這是什麼

一個雅思讀書網站。前端仍是**單一 HTML 檔，無 build step、無框架、無 npm 相依**，
可離線開啟；使用者自備 Gemini API 金鑰，瀏覽器直接呼叫 Google API。

**2026-08 起多了一個「選用」的後端**：Cloudflare Pages Functions + D1，用來做多人的跨裝置進度儲存。
不登入時前端照舊全靠 localStorage，一切離線可用；登入後才會把整包進度同步到雲端。
所以「無後端」這條已不再絕對——是刻意的取捨，原因見下方「為什麼加後端」。

檔案：
- `ielts.html`（約 2000 行，含 CSS 與 JS）＝ 前端全部
- `functions/api/*.js` ＝ 後端 API（register / login / progress + 共用 `_lib.js`）
- `schema.sql`、`wrangler.toml` ＝ D1 建表與部署設定
- `DEPLOY-backend.md` ＝ 給非後端背景的人的逐步部署手冊

部署：`cp ielts.html index.html && wrangler pages deploy .`（細節見 DEPLOY-backend.md）。
仍沿用「首頁要叫 index.html」的規則，只是改用複製而非改名，保留 `ielts.html` 方便改。

### 為什麼加後端
原本只有 localStorage + JSONBin 同步，兩個痛點：iOS Safari 七天沒開會清掉 localStorage；
JSONBin 是 last-write-wins 且用帳號主金鑰，不安全。使用者預期人數會從 1 長到多人，
所以直接上「帳號 + D1」一次到位，而不是做會丟掉的 JSONBin 強化。**JSONBin 那套已整段移除。**

## 六大功能

| 模組 | 說明 |
|---|---|
| 單字庫 | **查詢與加入分兩步**：查詢 → Gemini 回 IPA/字義/搭配詞/例句/同義字 → 顯示預覽（`VOCAB_PREVIEW`，尚未存）→ 按「加入單字庫」才寫入並排進複習佇列。可「捨棄」不加 |
| 今日複習 | Leitner 五盒間隔重複。**兩種模式**：認得（看英文想中文）／**反向測驗**（看中文拼英文，production recall）。頂部有**學習儀表板**：連續天數、待複習、已掌握、近 7 天活動 |
| 擬真考題 | 依單字庫與弱項生成雅思題，聽力用 speechSynthesis 朗讀 |
| 錯誤筆記本 | 自動記錄答錯題目與寫作低分項，畫弱點分布，可請 AI 診斷 |
| 寫作批改 | 依 IELTS 四項評分標準批改 + 範文 |
| 讀書計畫 | 空白表手填 + AI 依弱點生成 |
| 雲端進度 | （設定頁）帳號 + 密語登入，整包進度同步到 Cloudflare D1，樂觀鎖防互蓋 |

## 檔案結構（行號為改動前的參考，會位移）

```
1-9      <head> + 字型
9-206    <style>：全部 CSS。設計 token 在 :root
207-596  <body>：sidebar + 七個 .module
597-     <script>：全部 JS
```

JS 內部區塊順序：

```
小工具 (escapeHtml / todayStr / uid / setStatus)
儲存層 (APP_STATE / storeGet / storeSet)
雲端同步 (JSONBin，選用)
Gemini (模型探索 / callGemini / callGeminiJSON)
事件委派 (ACTIONS 表)
導覽
單字庫 → 複習 → 考題 → 錯誤筆記本 → 寫作 → 計畫 → 設定 → 初始化
```

## 資料模型

全部存在 `localStorage` 的單一 key `ielts-app-state` 下，值是一個物件：

```js
{
  'settings':        { apiKey, model, accent },
  'model-list':      ['gemini-3.5-flash', ...],   // API 探索結果快取
  'vocab-library':   [VocabItem],
  'error-notebook':  [ErrorItem],
  'writing-history': [WritingItem],   // 上限 20 筆
  'schedule-blank':  [{ date, tasks, done }],
  'schedule-smart':  [{ date, focus, tasks[], durationMinutes }],
  'quiz-current':    [QuizItem],
  'quiz-stats':      { correct, total },
  'error-analysis':  { text, date },
  'study-log':       ['YYYY-MM-DD']   // 有評分的日子，算連續天數與近 7 天活動用
}
```

`review-mode`（認得/反向）刻意存**獨立的 localStorage key `ielts-review-mode`**，
不進 APP_STATE：它是介面偏好，不是學習進度，不該跟著雲端同步或備份匯出。

雲端登入狀態存在 `ielts-cloud-settings`：`{ userId, token, autoSync, version, lastSync }`。
`token` 是登入後拿到的、會過期的簽章串，**不放進 APP_STATE**（同 JSONBin 金鑰當年的理由：備份不該帶走憑證）。
`version` 是樂觀鎖用的本機已知版本號。

`VocabItem`：
```js
{
  id, word, ipa, partOfSpeech, meaningZh, meaningEn,
  collocations[], linkingWords[], examples[], synonyms[], band,
  box: 1..5,          // Leitner 盒號
  nextReview: 'YYYY-MM-DD',
  reviewCount, lapses, addedAt
}
```

## 不可破壞的約束

違反以下任何一項就是回歸 bug，這些都是踩過坑才修的。

1. **不可使用 inline `onclick` / `onchange`。**
   單字可能含撇號（`don't`）。瀏覽器會先把 HTML 實體解碼再交給 JS，`onclick="speak('don&#39;t')"` 會變成語法錯誤。
   一律用 `data-act="xxx"` + `ACTIONS` 表委派。`data-change` 同理。

2. **不可用 `toISOString().slice(0,10)` 取日期。**
   那是 UTC，台灣早上八點前會算成前一天，複習到期日與錯誤紀錄日期都會錯。用 `todayStr()`。

3. **陣列項目一律用 `id` 定位，不可用索引。**
   列表有反轉與排序，索引會對不上，會刪錯 / 改錯項目。

4. **所有進 innerHTML 的資料都要過 `escapeHtml()`。**
   內容來自 Gemini 與使用者輸入，兩者都不可信。

5. **選擇題比對用 `answerIndex`，不可用 `answer` 字串全等。**
   AI 常回 `"not given."` 而選項是 `"Not Given"`，全等比對會把答對判成答錯，然後污染錯題本與弱點分析。
   `resolveAnswerIndex()` 有 fallback，別拿掉。

6. **`localStorage` 寫入失敗必須讓使用者看見。**
   `saveLocalState()` 失敗會掛橘色橫幅。不要改回靜默 `catch{}`——使用者會以為有存到。

7. **不可寫死 Gemini 模型名稱當預設值。**
   Google 換版本很勤（`gemini-2.0-flash` 已於 2026-03-03 退役）。
   模型清單一律跟 `GET /v1beta/models` 要。`FALLBACK_MODELS` 只在完全抓不到時當備援。

8. **429 必須分兩種處理。**
   模型對該專案沒有配額時，Google 回的是 429 + `limit: 0`，不是 404。
   這種要提示「換一個模型」，不能提示「等一分鐘」——等再久都一樣失敗。

9. **複習佇列的重試最多一次。**
   答錯的字會 `push` 回佇列，靠 `item.retried` 旗標防止無限迴圈。

10. **雲端上傳一定要帶 `version` 走樂觀鎖，衝突（409）不可靜默覆蓋。**
    後端 `PUT /api/progress` 只在版本相符才寫，否則回 409 附上雲端現況。
    前端收到 409 要採用雲端版並掛橘色橫幅提醒使用者（這是約束 6 的延伸，換裝置場景）。
    別為了「省事」改成無條件覆蓋——那就退回當年 JSONBin 互蓋的坑。

11. **憑證（token）與介面偏好不可進 APP_STATE。**
    `token` 存 `ielts-cloud-settings`、`review-mode` 存 `ielts-review-mode`。
    APP_STATE 會被同步上雲、被備份匯出，混進憑證等於外洩、混進偏好等於跨裝置互相打架。

12. **後端密語只存雜湊，token 用伺服器密鑰簽。**
    `_lib.js` 用 PBKDF2 加鹽雜湊密語、HMAC 簽 token；`TOKEN_SECRET` 走 `wrangler pages secret`，
    不進版本庫。別把密語存明文，也別把密鑰寫進 `wrangler.toml`。

（`todayStr()` 那條同樣管到 `study-log` 與連續天數——用本地時區記日期，別用 UTC，否則早上會少算一天。）

## 測試

`test.js` … `test5.js`，用 jsdom 驅動，共 **94** 個檢查。

```bash
npm install jsdom
npm test   # 依序跑 test.js ~ test5.js
```

- `test.js`（29）：資料遷移、XSS、撇號單字、複習升降盒、佇列終止、考題判分、計畫表編輯
- `test2.js`（8）：localStorage 配額爆掉的警告、備份匯出匯入 round-trip
- `test3.js`（16）：模型探索與過濾、退役模型自動替換、429/404 錯誤分類
- `test4.js`（22）：反向測驗（拼字對錯、翻面自評、升盒）、學習儀表板、連續天數的連續/中斷/延續邏輯
- `test5.js`（19）：單字庫查詢/加入拆兩步（查詢只預覽、加入才寫入、捨棄、重複字防呆）

**改完一定要五個都跑過（`npm test`）。** 測試會 mock `fetch`、`localStorage`、`speechSynthesis`，不會真的打 API。

> ⚠️ 前任交接說「53 全過」其實是假綠燈：jsdom 24 沒實作 `File.text()`，`test2.js` 的匯入 4 條一直 FAIL。
> 已在 `test2.js` 的 `beforeParse` 補上 `FileReader` polyfill（只動測試、沒動產品），現在匯入 round-trip 真的測得到。

後端 `functions/*` 目前**沒有自動化測試**（需要 Cloudflare Workers + D1 執行環境，jsdom 測不到）。
本機驗證請用 `wrangler pages dev .` 手動走註冊/登入/同步/衝突。這是已知缺口，之後值得補 integration test。

新增功能請一併補測試，特別是任何碰到上面十二條約束的地方。

## 程式碼慣例

- 識別字用英文，註解用繁體中文且只寫「為什麼」，不寫「做什麼」
- 不引入任何 runtime 相依，維持單檔可離線開啟
- CSS 顏色一律走 `:root` 的 token，不要硬幹十六進位色碼
- 使用者可見的文字全部繁體中文
- 錯誤訊息要能指出下一步動作，不要只說「失敗」

## 已知限制與待辦

**目前不做，但知道它在**

- 雲端衝突解法是「雲端優先 + 大聲提醒」，不是真正的合併。單帳號多裝置同時改的機率低，可接受；要更好就得做欄位級 merge
- 衝突時本機那次未同步的變更會被雲端版覆蓋（有橫幅提醒、非靜默）。之後可加「保留本機 / 用雲端」的選擇 UI
- 口說模組沒有實作。需要 `MediaRecorder` 錄音再送 Gemini，工程量大一個量級
- `localStorage` 上限約 5MB；雲端 `state` 上限 4MB（後端擋）。寫作紀錄已限 20 筆，長期重度使用仍可能撞牆，屆時要遷 IndexedDB
- Gemini 金鑰仍在瀏覽器（使用者自備）。這次只搬「進度」到後端，沒搬金鑰。要藏金鑰得再開一個 `/api/gemini` proxy 端點

**下一步優先做**

1. ✅ ~~反向測驗（看中文拼英文）~~ 已做，見複習模組的「看中文 → 拼英文」
2. ✅ ~~複習連續天數 / 統計圖表~~ 已做，見複習模組頂部學習儀表板
3. 補後端 integration test（`wrangler pages dev` + 打 API 驗證註冊/登入/樂觀鎖）
4. 聽力題支援語速調整與逐句重播
5. 匯出成 Anki apkg 或 CSV，讓使用者不被這個站綁死
6. 反向測驗可再加「搭配詞克漏字」「同義字改寫」——`VocabItem` 已存 `collocations` / `synonyms`，資料現成

## 給使用者的操作提醒

如果 AI 功能一直失敗：

1. 到「設定」貼上金鑰 → 儲存 → 清單會自動載入
2. 選 `flash-lite` 系列，免費額度最寬鬆
3. 還是 429 就去 AI Studio 看 usage 頁的實際數字
4. 掛上網域後記得去 Google Cloud Console 幫金鑰加 HTTP referrer 限制
5. **建議到設定頁註冊雲端帳號並開自動同步**，進度就存到雲端、換裝置能接續。**iOS Safari 連續七天沒開會清掉 localStorage，登入雲端就不怕。** 沒登入的話仍要每週手動匯出備份
6. 密語忘記救不回（伺服器只存雜湊），請記牢
