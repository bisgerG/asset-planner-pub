# 資產規劃指南 asset-planner

> 給台灣投資人的資產規劃站台:**先打地基 → 再配資金 → 最後挑時機**。
> 純前端、離線運算、**財務數字不外傳**;所有報酬皆為前瞻假設、非預測。

🔗 線上使用:**https://bisgerg.github.io/asset-planner-pub/**
(需先到 Settings → Pages 啟用,見下面「部署」)

## 六個頁面

主線是 **`/` → `/start/` → `/plan-result/` → `/report/`**;`/plan/` 與 `/timing/` 是想調細節時才進去的進階頁。

| 路徑 | 名稱 | 回答什麼問題 |
|---|---|---|
| `/` | 引導首頁 | 我該從哪一步開始?地基打好了嗎? |
| `/start/` | 🚀 快速開始精靈 | 九個白話問題 → **九階風險階梯**自己選一階,幫沒經驗的人配好第一版計畫 |
| `/plan-result/` | ★ 一頁式結果 | **你的計畫長什麼樣、撐不撐得住、接下來做什麼** |
| `/plan/` | ① 配資金(Coast FIRE 規劃器) | 幾歲能退休、錢怎麼分、槓桿開多少 |
| `/timing/` | ② 挑時機(2x 進場時機儀表板) | 何時進場、跌到哪加碼、今天該做什麼 |
| `/report/` | 📄 投資計劃書 | 把上面的結果變成一份可以列印、照著做的文件 |

### 六頁共用一層殼,**不能用 `file://` 直開**

六個頁面都 `<link>` / `<script>` 進 `assets/` 底下的共用檔:

| 檔案 | 內容 |
|---|---|
| `assets/ui.css` | 設計 token + 共用元件(導覽、展開器、名詞氣泡、出處標籤、風險橫幅、答案卡等) |
| `assets/engine.js` | 純函式引擎(零 DOM):模擬、現金流、里程碑、`buildResult` |
| `assets/charts.js` | 共用圖表(資產成長機率帶 band、配置甜甜圈 donut)—— 零狀態、資料與格式由呼叫端傳入 |
| `assets/state.js` | `ap_state_v2` 單一事實來源 + 舊鍵遷移 |
| `assets/shell.js` | 頂部導覽、進度指示、進階展開器、單一份名詞辭典 |

所以**一律要用靜態伺服器開**(見下面「本機預覽」)。`file://` 直開會少樣式、少導覽,
`/timing/`、`/report/`、`/plan-result/` 的 `fetch()` 還會被 CORS 擋掉。

### 跨頁資料

`ap_state_v2`(localStorage)是全站的單一事實來源,一份資料貫穿六頁 ——
在 `/start/` 或 `/plan/` 填的東西,`/plan-result/`、`/report/`、`/timing/` 直接讀得到。
所有資料只存在使用者自己的瀏覽器,**不上傳任何伺服器**。

## 本機預覽

純靜態,無建置步驟,任意靜態伺服器即可(需同網域才測得到跨頁互通):

```bash
cd asset-planner-pub
python -X utf8 -m http.server 8090   # 然後開 http://localhost:8090/
```

## 部署(GitHub Pages)

Settings → Pages → Source `Deploy from a branch`,Branch `main` / `/ (root)`。純靜態、無後端。

## 資料自動更新

兩份資料檔由排程的 GitHub Actions 自動抓取並 commit 回 repo,**不需要設定任何 secret**
(用內建的 `GITHUB_TOKEN`,靠 workflow 裡的 `permissions: contents: write` 取得寫入權):

| 檔案 | 內容 | 排程 | Workflow |
|---|---|---|---|
| `timing/data.json`<br>`timing/taiex_daily.json` | 加權指數日線與估值/回撤 | 每日(週一~六)UTC 10:30<br>≈ 台灣 18:30,收盤結算後 | `update-data.yml` |
| `plan/carry.json` | 期貨逆價差 → 槓桿持有成本 | 每月 1 號 UTC 01:00 | `update-carry.yml` |

兩支都可以在 Actions 分頁手動「Run workflow」。**fork 後記得到 Actions 分頁啟用排程**
—— GitHub 預設會停用 fork 來的 workflow,而且連續 60 天沒有 commit 活動也會自動停用排程。

`/timing/` 若超過三天沒更新會自己在頁面頂端亮出「資料可能已過期」橫幅,所以排程壞掉不會無聲無息。

手動重跑(從 repo 根執行,腳本用 `__dirname` 定位輸出):

```bash
node timing/scripts/update_data.js    # 大盤日線 → timing/*.json
node plan/scripts/update_carry.js     # 逆價差   → plan/carry.json
```

需 Node 18+,只用內建 `https`/`fs`,無需 `npm install`。

## 關於本 repo

這是**部署用的網站包**。以下東西留在開發 repo,**不在這裡**:

- 規格與決策文件(`docs/SPEC.md`、`docs/IA.md`、`docs/HANDOFF.md`)—— 程式碼註解裡若引用到它們,是指開發 repo 的版本
- 四支護欄測試,含 `golden.json`(581 個數字、零容差的口徑回歸)
- `timing/backtest/` 的 Python 回測腳本與歷史資料快取 —— `timing/README.md` 的結論全部出自那些腳本

> ⚠ **要改 `assets/engine.js` 請回開發 repo 改。** 那邊有 golden 護欄會告訴你哪個畫面上的數字被動到了,這裡沒有。

## 原始專案

本站由兩個獨立工具合併而成,詳細方法論分別見
[`plan/README.md`](plan/README.md)(配資金)與 [`timing/README.md`](timing/README.md)(挑時機)。

## ⚠ 免責聲明

本站僅供**教育與試算用途,非投資建議**。所有報酬皆為前瞻假設、非保證,過去績效不代表未來。
槓桿投資可能造成重大虧損,請依自身狀況審慎評估。

## 授權

[MIT](LICENSE) —— 但**請先打開 `LICENSE` 把版權人欄位填上你的名字或 GitHub 帳號**(目前是佔位符)。
不想採 MIT 就直接換掉整份;沒有 LICENSE 的公開 repo 在法律上是「保留全部權利」,別人不能合法 fork。

---

🤖 部分內容由 [Claude Code](https://claude.com/claude-code) 協助開發。
