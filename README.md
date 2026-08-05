# 資產規劃指南 asset-planner

> 給台灣投資人的資產規劃站台:**先打地基 → 再配資金 → 最後挑時機**。
> 純前端、離線運算、**財務數字不外傳**;所有報酬皆為前瞻假設、非預測。

<!-- 部署後把這行換成你的 GitHub Pages 網址 -->
🔗 線上使用:`https://<你的帳號>.github.io/<repo 名>/`

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

## 資料檔(打包時的快照)

| 檔案 | 內容 | 原更新頻率 |
|---|---|---|
| `plan/carry.json` | 期貨逆價差 → 槓桿持有成本 | 每月 |
| `timing/data.json` | 大盤日線衍生的估值/回撤資料 | 每日 |

這兩份是**打包當下的快照**。開發 repo 由 GitHub Actions 排程自動更新;
本部署包不含那些腳本,資料要更新就從開發 repo 重新打包(或把
`plan/scripts/update_carry.js`、`timing/scripts/update_data.js` 與對應 workflow 搬過來)。

## 關於本包

這是**純網站部署包**:規格文件(SPEC/IA/HANDOFF)、四支護欄測試(含 `golden.json`
零容差口徑回歸)、資料更新腳本與歷史回測都留在開發 repo。
要改 `assets/engine.js` 請回開發 repo 改 —— 那邊有 581 個數字的 golden 護欄擋著,這裡沒有。

## 原始專案

本站由兩個獨立工具合併而成:

- 配資金:[bisgerG/fire-planner](https://github.com/bisgerG/fire-planner) — 詳細方法論見 [`plan/README.md`](plan/README.md)
- 挑時機:2x 進場時機儀表板 — 詳細方法論見 [`timing/README.md`](timing/README.md)

## ⚠ 免責聲明

本站僅供**教育與試算用途,非投資建議**。所有報酬皆為前瞻假設、非保證,過去績效不代表未來。
槓桿投資可能造成重大虧損,請依自身狀況審慎評估。

---

🤖 部分內容由 [Claude Code](https://claude.com/claude-code) 協助開發。
