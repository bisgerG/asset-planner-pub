#!/usr/bin/env node
/*
 * update_data.js — 抓取 → 計算 → 寫出 data.json / taiex_daily.json
 *
 * 由 GitHub Action 每日排程執行（也可手動 `node scripts/update_data.js`）。
 *
 * ── 這個儀表板在算什麼 ────────────────────────────────────────────────
 * 主體是「準備金回補版」策略：核心放 2x 槓桿 ETF、其餘留現金當準備金，
 * 依『大盤指數自歷史高點的回撤』分批把準備金投入核心，指數創新高則回補。
 * 它只對「已發生的價格」反應，不預測。
 *
 * 回測（backtest/pe_backtest.py，2000-07~2026-07，26.05 日曆年；2026-08-24 修完資料錯後重跑，
 *   下表 CAGR/Calmar 已換算成日曆年，不是腳本印的 交易日/252）：
 *   準備金 70/30  平均曝險 169%  CAGR 17.1%  MDD -77.1%  Calmar 0.222  最長水下 3.6 年（2026-08-24 重跑）
 *   固定 1.5x     平均曝險 150%  CAGR 14.4%  MDD -74.9%  Calmar 0.193  最長水下 6.3 年（2026-08-24 重跑）
 *   100% 0050    不開槓桿對照   CAGR 10.6%  MDD -58.0%  Calmar 0.183  最長水下 5.7 年
 *   ⚠ 2026-08-26:上面這行原本寫 15.3%/-74.7%/0.205,那是重跑前的舊值,與 rows 陣列不一致,已更正。
 *   2007-10 買在海嘯前最高點：準備金 70/30 回本 1.6 年 vs 固定 1.5x 5.7 年
 *
 * 加碼表 −25/−35/−45（權重 1:2:3）取自 backtest/tranche_final.py 的 8 方案比較：
 * 四條件平均 Calmar 0.251（最高）、全距 0.050（最穩）、深崩期 0.132（最佳，次名 0.108）。
 * V2.0 用的 −12/−22/−32/−42 已淘汰 —— −12% 在 26 年間觸發 9 次、54.5% 的日子處於
 * 已投入狀態，那不是準備金而是永久配置。
 *
 * ── P/E 在這裡的角色（重要） ──────────────────────────────────────────
 * 市場本益比【不用來決定槓桿倍率】。同一份回測測了 4 種映射家族、8 個變體
 * （絕對門檻表、expanding 分位數、onekoni 14/25、單邊尾端防禦），沒有一個
 * 打敗固定槓桿：trailing P/E 的分母落後價格，導致崩盤中滿槓、谷底反而降槓
 * （2008-09 P/E 11.2 → 滿槓；2009-03 谷底 P/E 27.4 → 降到最低槓桿）。
 * 這裡只把 P/E 當「估值溫度計」，用途有二：
 *   1. 一筆資金分批進場的『速度』（貴就慢慢進）
 *   2. 長期尾端警示（最貴五分位的未來 3~5 年年化僅 1.0%，其餘四分位 9~11%）
 * 連分批本身都不是優勢：實測 252 個歷史起點（持有 5 年），一次進場的終值中位數
 * 2.08x 勝過任何分批方式；分批只在最差情境有價值（最差 0.60x → 12 個月分批 0.72x）。
 *
 * ── 分批 + 價格加速器（V2.2 改動） ────────────────────────────────────
 * 慢分批單獨使用會嚴重傷害中位數，但配上「跌破加速水位就把剩餘現金一次投完」
 * 之後反而全面勝出。實測 1995-2026、持有 15 年、每 100 萬本金
 * （backtest/analogue_1997.py 的資料基礎，全樣本 190 個起點）：
 *
 *   規則                      1997類比中位   全樣本中位   全樣本25分位   全樣本最差
 *   立刻一次投入                  198 萬       661 萬       321 萬      146 萬
 *   分批 12 個月（無加速）           190 萬       521 萬       290 萬      163 萬
 *   分批 24 個月（無加速）           200 萬       465 萬       277 萬      161 萬
 *   分批 24 個月 + 跌 25% 加速      225 萬       667 萬       316 萬      174 萬  ← 採用
 *   等 -30% 才進（純等待）          252 萬       672 萬       345 萬      184 萬
 *
 * 純等待的數字最好，但它沒有截止日：2024 年那組近似起點（P/E 分位 81~89、
 * 回撤 -6~-9%）指數最低只到 -21.7~-23.8%，-30% 一次都沒觸發，等待者拿 101.6 萬、
 * 立刻進場者拿 275 萬。加上硬性截止日之後，「24 個月 + 加速器」拿到大部分好處。
 * ⚠ 加速器水位刻意設在第 1 批加碼的同一個水位（-25%）：那天會同時把核心剩餘額度
 *   投完、並投入第 1 批準備金。深處重壓是刻意的。
 * ⚠ 全樣本 15 年窗格的起點全在 1995-2011，每一個後面都跟著至少一次 -30% 崩盤
 *   （觸發率 100%），這對「等待／慢分批」是結構性有利的。
 *
 * ── 跨市場配置（V2.3 新增） ───────────────────────────────────────────
 * 上面整套講的是「台股這一份錢怎麼配」；V2.3 補上「總資金要不要全押台股」。
 * 答案是不要，但理由不是報酬 —— 是台股正二 100% 部位已經相當於 73% 全凱利，
 * 而混合之後同樣的持倉降到約 37%（≈ 三分之一凱利，不是半凱利）。
 * ⚠ 「半凱利 49~50%」是 README 另一張表（100% 滿倉、名目 2x）的數字，該表單押台股是 87%
 *   而非 73%，兩套口徑不可混用。分散來自『同時持有』，不是『換過去』。
 *   1995-2026、每個 sleeve 內部皆 70/30：100% 台股 Calmar 0.164、波動 36.19%、
 *   15 年最差 1.48x  →  台股40/SPX60 為 0.203、23.14%、2.70x。
 * 更重要的是模型風險：把台股正二的逆價差紅利歸零（α −0.42% → −5.11%/年），
 * 單押台股 Calmar 掉三成（0.164 → 0.114）、15 年最差世代虧錢（0.76x），混合仍有 0.180 / 1.97x。
 *
 * ── V2.4：那斯達克（QLD）下架 ─────────────────────────────────────────
 * 儀表板從三市場收斂為兩市場（台股正二 + S&P500 2x），並把「區間」改成一個
 * 預設值 40/60。QLD 的完整論證原文保留在 README「⚠ QLD 不是分散，是科技加碼」，
 * 頁面上收進一個說明按鈕。理由見下方 BLEND 常數的註解 —— 簡言之：最佳權重帶的
 * 下界本來就是 0，而 0 vs 10 的差異在自助檢定裡與雜訊無法區分，
 * 留著它只是把研究的不確定性外包給使用者。
 *
 * ── V2.6：創新高回補加上一季的遲滯閘 ──────────────────────────────────
 * 舊規則是「收盤創歷史新高就回補」。backtest/us_sleeve_rule.py 逐日量出那等於
 * 台股一年動手 9.0 次、美股 27.2 次 —— 美股有 10.8% 的日子在創新高（每 9 個
 * 交易日一次），台股只有 3.8%。同一條規則在美股退化成高頻再平衡。
 * 加上 resetGapDays = 63 之後（多起點、對同平均曝險基準）：
 *   台股 9.0 → 0.6 次/年，Calmar 差 +0.044 → +0.052
 *   美股 27.2 → 2.0 次/年，Calmar 差 −0.004 → −0.002
 * ⚠ 報酬面的改善在雜訊裡（八組閘門設定全落在 ±0.002，起點高度重疊）。
 *   這個改動的理由是「同樣的結果、少動手 12~25 倍」，不是「這樣比較賺」。
 * ⚠ 代價：閘門關著時曝險會漂高。台股中位 141%（舊 137%）、九成 ≤149%、
 *   史上最高 162%（2026-04~06 指數兩個半月漲 35% 那段）。
 * 因為 fired 狀態現在由重置歷史決定，reserveState() 已改成逐日模擬，
 * 不能再用「全期最高點 + maxDd」反推。
 *
 * ── 資料來源 ─────────────────────────────────────────────────────────
 *   加權指數日線  台灣證券交易所 FMTQIK
 *   市場 P/E     worldperatio.com（台灣）
 *   ⚠ 該站的台灣 P/E 係以 EWT ETF（iShares MSCI Taiwan）計算，非加權指數
 *     本身之本益比。證交所 OpenAPI 僅提供個股 P/E，無大盤彙總值。
 *
 * 失敗處理：任何抓取或解析失敗一律 exit(1) 且不覆寫既有檔案。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { fetchPe, fetchTaiexRange } = require('./sources.js');

// ── 策略參數（要調參只改這裡；index.html 一律從 data.json 讀）───────────
const STRATEGY = {
  // V3.1:內容版本(新手版重寫=V3.0、00631L→00685L=V3.1)。徽章曾長期停在 V2.6,
  // 讀者無從得知自己看的是改版後內容 —— 版本號跟著「內容」走,不是跟著「策略參數」走。
  version: 'V3.1',
  tool: 2,                       // 核心工具倍率（2x 槓桿 ETF）
  // 核心標的。頁面上「要買哪一檔」必須寫得出來 —— V2.3 以前全頁沒有出現過代號，
  // 只有「核心 2x 槓桿 ETF / 台股正二 / 正二」三種叫法輪流出現。
  //
  // V3.1 由 00631L 換成 00685L。理由不是費用（雖然也便宜 0.68%/年），是「基準一致」：
  // 本頁所有訊號都算在加權指數上（ATH、−25/−35/−45%、估值溫度計、26 年回測），
  // 而 00685L 追的「臺指日報酬兩倍指數」就是這個基準；00631L 追的是臺灣50，
  // 且 2026-05-19 起元大加進台積電現貨去真的追臺灣50、與 2× 加權「做出區隔」
  // —— 也就是它正在離開本頁的基準。實測見 backtest/tw_2x_products.py。
  product: { ticker: '00685L', name: '群益臺灣加權正2' },
  // onekoni 的 P/E 口徑（加權指數 ÷ 台股實績 EPS）—— 只用來做口徑對照，不決定槓桿。
  // 寫成常數是為了讓頁面用「今天的收盤」即時算，而不是硬編一個隔天就過期的數字。
  onekoni: { epsActual: 1448, epsEst: 1530, epsAsOf: '2026 Q1' },
  // 首次建倉的價格加速器：指數自 ATH 跌破此水位 → 核心剩餘額度一次投完。
  // 刻意與第 1 批加碼同水位，理由見檔頭。
  entryAccelLevel: -0.25,
  // 創新高重置的遲滯閘（V2.6 新增）。單位＝交易日。
  //
  // 舊規則是「只要收盤創歷史新高就重置」。backtest/us_sleeve_rule.py 量到那等於
  // 台股一年動手 9.0 次、美股 27.2 次 —— 因為美股有 10.8% 的日子在創新高。
  // 加上「距上次重置至少 63 個交易日」之後（67／45 個起點、對同平均曝險基準）：
  //   台股 重置 9.0→0.6 次/年，Calmar 差 +0.044→+0.052，勝率 93%→93%
  //   美股 重置 27.2→2.0 次/年，Calmar 差 −0.004→−0.002，勝率 34%→43%
  // 副作用查證：「曝險 >1.8x 最久卡住幾天」兩市場都與舊規則完全相同
  //（台股 3,971 日、美股 1,072 日）—— 深跌後回到新高本來就要好幾年，一季碰不到。
  // 美股 38.6 年裡「已投批次卻被閘擋住降槓桿」只發生 2 次。
  // 設 0 即回到舊行為。
  resetGapDays: 63,
  // 核心/準備金切分＝平時淨曝險（core × 2）；全部投入後一律 200%。
  // 滾動 15 年視窗顯示中位結果在 70/30 之後就持平，但最差視窗持續惡化
  // （4.94x→5.05x 但 3.27x→2.86x）、最長水下由 3.6 年跳到 5.7 年，故推薦停在 70/30。
  profiles: [
    { key: 'defensive', name: '防禦',  coreW: 0.50, reserveW: 0.50 },                      // 平時 100%
    { key: 'conserv',   name: '保守',  coreW: 0.60, reserveW: 0.40 },                      // 平時 120%
    { key: 'balanced',  name: '均衡',  coreW: 0.70, reserveW: 0.30, recommended: true },   // 平時 140%
    { key: 'aggr',      name: '積極',  coreW: 0.80, reserveW: 0.20 },                      // 平時 160%
  ],

  // backtest/analogue_1997.py：1997 高估值進場、持有 15 年（7 個重疊月起點）。
  // final 的單位是「萬」，且以本金 100 萬為基準 —— 頁面必須乘上使用者輸入的本金。
  // ⚠ 這五個數字原本寫死在 index.html 的兩個地方（失效模式表 + 首屏風格提示），
  //   結果本金改成 200 萬時上面的核心／準備金會變、這些不會，兩邊互相打臉。
  //   現在只存在這裡，兩個消費端都從 data.json 讀。
  analogue1997: {
    note: '1997 高估值進場、持有 15 年，本金 100 萬',
    rows: [
      { key: 'aggr',      label: '積極 80/20', expo: 160, final: 159, mdd: -85.6 },
      { key: 'balanced',  label: '均衡 70/30', expo: 140, final: 198, mdd: -83.8 },
      { key: 'conserv',   label: '保守 60/40', expo: 120, final: 239, mdd: -83.8 },
      { key: 'defensive', label: '防禦 50/50', expo: 100, final: 291, mdd: -83.8 },
      { key: null, label: '35/65（對照，<b>非可選風格</b>）', expo: 70, final: 363, mdd: -83.8 },
    ],
  },

  // ══ V2.5 新增：四組實測研究常數 ══════════════════════════════════════
  // 產出腳本：backtest/lev_vs_1x.py、rebalance_2x.py、monte_carlo.py
  // 全部是靜態回測結果，不隨每日資料變動，所以跟 BLEND 一樣寫死在這裡。
  research: {
    // ⑤ V3.1 新增：四檔正二各自對「理論 2× 加權含息」的實測。
    //    產出腳本：backtest/tw_2x_products.py（TWSE STOCK_DAY 官方日線，自檢全過）
    //
    //    為什麼要有這一組：本頁所有訊號都算在加權指數上，但四檔正二裡只有三檔追加權，
    //    規模最大的 00631L 追的是臺灣50。α 是「扣完所有費用後每年實際多／少賺」，
    //    比公開的內扣費率更有意義 —— 它把期貨轉倉、價差、追蹤技巧全部算進去了。
    products2x: {
      note: '共同期間 2017-03-30 ~ 2026-07-21（9.3 年，00685L 掛牌起）。'
        + 'α 對「理論 2× 加權含息」，已扣所有費用。費用與規模為 MoneyDJ 2026-07-29 查證值。',
      common: '2017-03-30 ~ 2026-07-21',
      feeAsOf: '2026-07-29',
      // value60 = 最近 60 個交易日的日均成交金額（億元）。用金額不用張數 ——
      // 00685L 在 2026-07-07 剛 1拆24，張數會虛增約 24 倍。
      // notrade/worstRun = 歷史上完全沒有成交的天數／最長連續天數，流動性的硬證據。
      rows: [
        { tk: '00685L', name: '群益臺灣加權正2', idx: '加權', fee: 0.48, aum: 617.5,
          beta: 2.0110, alpha: -0.15, r2: 0.9413, value60: 24.5, notrade: 39, worstRun: 5,
          worstFrom: '2022-05-31', worstTo: '2022-06-07',
          listed: '2017-03-30', pick: true },
        { tk: '00675L', name: '富邦臺灣加權正2', idx: '加權', fee: 0.75, aum: 284.1,
          beta: 2.0459, alpha: -1.31, r2: 0.9594, value60: 8.6, notrade: 0, worstRun: 0,
          listed: '2016-10-05' },
        { tk: '00663L', name: '國泰臺灣加權正2', idx: '加權', fee: 0.93, aum: 139.5,
          beta: 2.0533, alpha: -1.09, r2: 0.9522, value60: 13.5, notrade: 11, worstRun: 1,
          listed: '2016-07-14' },
        { tk: '00631L', name: '元大台灣50正2', idx: '臺灣50', fee: 1.16, aum: 2224.1,
          beta: 2.0652, alpha: -1.34, r2: 0.9577, value60: 101.3, notrade: 0, worstRun: 0,
          listed: '2014-10-31' },
      ],
      // 2026-05-19 元大把 00631L 改成「台積電現貨 39.63% ＋ 台指期 160.87%」，
      // 官方明講要追 2× 臺灣50、與 2× 加權「做出區隔」。台積電權重差 17.2pp 是事實，
      // 但到 2026-07-21 只有 44 個交易日，量不出脫鉤 —— 同期另外三檔落後幅度一樣
      //（都約 −5pp，那是每日重設的波動耗損）。頁面必須照實說「還量不出來」。
      shift: { date: '2026-05-19', tsmcSpot: 39.63, twFut: 160.87,
               w50: 60.9, wTwse: 43.7, days: 44, verdict: '尚無法量測' },
      // ✅ 2026-08-24 已結案。來源檔（Strategy repo 的 etf_00631L.csv）原本整個
      //    2016-02（13 個交易日）不見了，害 2016-03-01 變成一個假的單日大漲。
      //    已用完整正本補回並重跑整套回測（strategy.backtest.rows 是重跑後的值）。
      //    校準：β 2.0600 → 2.0596、α +0.17%/年 → −0.42%/年、R² 0.9482 → 0.9513。
      //    ⚠ 先前揭露的「終值高估 19.9%」是估的，偏大。同一支腳本做控制對照
      //      （壞資料 70.26x vs 好資料 61.72x）實測是 −12.2%；而相對於本頁
      //      先前刊出的 63.07x，修正後是 61.72x，即 −2.1%。
      alphaBug: { published: -0.14, corrected: -0.42, missingDays: 13,
                  gapFrom: '2016-02-01', gapTo: '2016-02-26', final26Inflation: 12.2,
                  fixedOn: '2026-08-24', oldFinal: 63.07, newFinal: 61.72 },
    },
    // ① 00631L 用臺股期貨建倉，追的是加權指數，不是它名字上的臺灣50。
    //    用累積年化報酬直接比，不靠迴歸（迴歸的 β 會被 0050 的個股噪音壓低，
    //    OLS 衰減偏誤會讓人誤以為「槓桿倍數不足」）。
    //    ⚠ 這一組是 2026-05-19 結構變更**之前**的歷史，仍然有效，但不再描述現在的 00631L。
    tracking: {
      note: '各段年化報酬。「2×」為每日重設、未扣成本的理論值。',
      rows: [
        { span: '2015~2019', etf: 20.23, idx2x: 18.24, e50x2: 20.71 },
        { span: '2020~2023', etf: 29.21, idx2x: 27.62, e50x2: 22.12 },
        { span: '2024~2026', etf: 91.94, idx2x: 101.44, e50x2: 134.98 },
        { span: '全期 2015~2026', etf: 36.73, idx2x: 36.53, e50x2: 40.37 },
      ],
    },
    // ③ 持有成本 = 實際 ETF 年化報酬 − 2×自己含息指數的年化報酬。
    //    正值代表「持有槓桿還倒收你錢」（逆價差補貼期）。
    cost: {
      ssoIrxCorr: -0.98,
      rows: [
        { span: '2015~2019', tw: 1.99, us: -3.21 },
        { span: '2020~2023', tw: 1.59, us: -4.50 },
        { span: '2024~2026', tw: -9.50, us: -8.23 },
        { span: '全期 2015~2026', tw: 0.20, us: -4.60 },
      ],
    },
    // ② 蒙地卡羅。四種配置跑在同一條重抽路徑上，所以「輸給原型」是配對比較。
    mc: {
      method: '循環區塊自助法：台股 1995-2026 母體、63 日區塊、10,000 條路徑、30 年',
      worstPath: 0.012,
      rows: [
        { label: '台股維持歷史漂移（含息 +9.8%/年）', lose: 5.1, wipe: 0.7, vs1x: 11.1 },
        { label: '台股變成日本（含息 +2.4%/年）', lose: 44.9, wipe: 15.6, vs1x: 60.8 },
      ],
    },
    // ④ 權重曲面是平的：三種成本情境下掃 0~100%，現行 40% 從沒掉出前二。
    blendFlat: {
      span: '1995-2026（31.6 年），每個 sleeve 內部皆 70/30 準備金',
      rows: [
        { label: 'A 歷史成本（本頁現行假設）', best: 40, bestCalmar: 0.235, cur: 0.235, win6040: 75.2, worst6040: 2.81, worstCur: 3.10 },
        { label: 'B 紅利反轉後', best: 30, bestCalmar: 0.191, cur: 0.191, win6040: 10.0, worst6040: 1.63, worstCur: 2.01 },
        { label: 'C 最近三年實際成本', best: 30, bestCalmar: 0.140, cur: 0.138, win6040: 4.3, worst6040: 0.90, worstCur: 1.16 },
      ],
    },
  },
  // 大盤指數自歷史高點回撤 → 分批投入準備金，權重 1:2:3（＝準備金的 1/6、2/6、3/6）。
  // 深處重壓是刻意的。tranche_final.py 的樣本是 2000-07~2026-07 共 232 個回撤週期，
  // 取其中【最深的 8 個】（.head(8)，樣本不含 1997）：本表在那 8 次的彈藥利用率是
  // [100,100,17,17,17,17,0,0]%，平均 33% —— 2 次完全不出手、4 次只投 1/6、
  // 2 次（2001-10、2008-11）三批全部投完。8 方案裡利用率最低的本表在深崩期 Calmar
  // 最高（0.132，次名 0.108）—— 閒置的彈藥就是保費本身。
  // ⚠ 舊註解寫的「利用率 33%→54% 對應 0.132→0.079」中的 0.079 在 tranche_final.py 的
  //   輸出與 README 裡都查不到，且 8 方案的平均利用率有並列值（不可能單調），已移除。
  tranches: [
    { level: -0.25, weight: 1 },
    { level: -0.35, weight: 2 },
    { level: -0.45, weight: 3 },
  ],
};

// 估值溫度計 → 一筆資金的分批進場速度（不影響槓桿）
// 分批是壓低最差情境的行為工具，不是擇時。
// V2.2：慢速由 9~12 拉長到 18~24 個月，但一律搭配價格加速器 —— 沒有加速器的
// 慢分批會把全樣本中位數從 661 萬砍到 465 萬，加速器才是讓慢分批可行的關鍵。
const PACE = [
  { minPct: 0.80, label: '慢速', months: '18 ~ 24 個月', note: '估值處於歷史高位，拉長分批以壓低最差情境；跌破加速水位即一次投完' },
  { minPct: 0.35, label: '中速', months: '9 ~ 12 個月',  note: '估值中性，標準分批速度；跌破加速水位即一次投完' },
  { minPct: 0.00, label: '快速', months: '0 ~ 3 個月',   note: '估值偏低，可直接一次建倉' },
];

// ── 跨市場配置（V2.3 新增；V2.4 收斂為兩市場）───────────────────────────
// 來源：backtest/us_portfolio.py（主表與壓測）、us_vs_tw.py（共同期間）、
//       us_robust.py（反過擬合檢定）、us_overlap.py（重疊 vs 分散）。
// 這些是「總資金該怎麼切」的長期結論，不隨每日行情變動，故寫成常數而非抓取。
//
// ⚠ V2.4：那斯達克（QLD）已從儀表板下架，只保留為「評估過但排除」的紀錄。
//   理由不是「NDX 很爛」，是 us_portfolio.py 的掃描結論本來就把 NDX 的最佳權重
//   帶壓在 0~10%，而 us_robust.py 又證明 0 vs 10 的差異在雜訊內：
//     台股40/SPX50/NDX10  Calmar 0.206 / 15年最差 2.58x / 水下 7.0 年 / 波動 23.71%
//     台股40/SPX60        Calmar 0.203 / 15年最差 2.70x / 水下 6.0 年 / 波動 23.14%
//   Calmar 只差 0.003，而最差情境、水下、波動三項 ndx=0 全部更好。
//   既然最佳權重帶的下界就是 0，把一個統計上撐不住、卻要求讀者做決定的維度
//   留在儀表板上，等於把研究的不確定性外包給使用者。
//
// ⚠ 立場改變（V2.4）：舊版是「因為分不出高下，所以我不給單點」——成本推給讀者。
//   新版是「因為分不出高下，所以我幫你選一個，照抄不會有事」——成本歸還作者。
//   demo 因此升格為「預設值」，range 降級為「可以在這個範圍內自己調」。
const BLEND = {
  span: '1995-01 ~ 2026-07（31.6 年）',
  method: '兩個 sleeve 各自內部跑核心 70 / 準備金 30、各自用自己市場的指數回撤觸發，再固定權重月再平衡',
  // 預設值（照抄即可）與可接受範圍
  range: { tw: [30, 50], spx: [50, 70] },
  demo: { tw: 40, spx: 60 },
  // 主表（us_portfolio.py）。保留「100% 那斯達克 2x」作為「不要單押任一市場」的反例，
  // 但它是對照列（ref），不是可選配置 —— 三市場混合列已移除。
  rows: [
    { name: '100% 台股正二',            tw: 100, spx: 0,   cagr: 13.8, vol: 36.42, mdd: -84.1, calmar: 0.164, uw: 7.4,  kelly: 75, med15: 5.44, worst15: 1.42, cur: true },
    { name: '100% S&P500 2x',          tw: 0,   spx: 100, cagr: 13.2, vol: 27.64, mdd: -73.0, calmar: 0.181, uw: 6.4,  kelly: 54, med15: 5.11, worst15: 2.31 },
    { name: '100% 那斯達克 2x（對照，非選項）', tw: 0, spx: 0, ndx: 100, cagr: 14.0, vol: 41.01, mdd: -96.6, calmar: 0.145, uw: 20.6, kelly: 86, med15: 8.97, worst15: 0.40, ref: true },
    { name: '台股50 / SPX50',           tw: 50,  spx: 50,  cagr: 15.1, vol: 23.98, mdd: -75.3, calmar: 0.200, uw: 6.3,  kelly: 38, med15: 6.08, worst15: 2.58 },
    { name: '台股40 / SPX60',           tw: 40,  spx: 60,  cagr: 15.0, vol: 23.20, mdd: -74.3, calmar: 0.201, uw: 6.0,  kelly: 37, med15: 6.00, worst15: 2.67, best: true },
  ],
  // 台股正二逆價差紅利反轉壓測（純 α −0.14% → −5.11%/年）
  // ⚠ us_portfolio.py 的壓測分支只跑過 40/50/10（0.180）與 40/40/20（0.176），
  //   沒有 40/60 的壓測值。未重跑回測，故此列沿用 40/50/10 作代表值並在頁面標明。
  //   10% NDX 對「台股紅利歸零後混合仍撐得住」這個結論不構成影響（NDX 不吃台指期紅利）。
  stress: {
    note: '把台股正二的逆價差紅利歸零（純 α −0.42% → −5.11%/年）之後重跑',
    rows: [
      { name: '100% 台股正二',          calmar: 0.114, uw: 10.0, med15: 2.91, worst15: 0.76, loss: 3, cur: true },
      { name: '混合（以 台股40/SPX50/NDX10 為代表）', calmar: 0.181, uw: 7.4, med15: 4.88, worst15: 1.98, loss: 0, proxy: true },
    ],
  },
  // 區塊自助法（252 日區塊、1000 條重抽路徑、三市場同步以保留相關性）
  // ⚠ 這個檢定是在【含那斯達克的三市場單純形】上做的，NDX 下架後未重算。
  bootstrap: { claim: '分散優於單押台股', winRate: 95.1, ci: [0.0014, 0.1586], universe: '三市場' },
  // 若真要分散，加什麼比那斯達克有效（皆為 1x，只能彼此互比）。
  // 保留 NDX 那一列 —— 它正是「為什麼沒有那斯達克」的第 ③ 點證據（倒數第二）。
  diversifiers: [
    { name: '美國長債 TLT',   corr: -0.310, dVol: -3.43 },
    { name: '黃金 GLD',      corr:  0.066, dVol: -2.81 },
    { name: '成熟市場 EFA',   corr:  0.869, dVol: -1.30 },
    { name: '美國小型股 IWM', corr:  0.888, dVol: -1.14 },
    { name: '那斯達克（對照）', corr:  0.852, dVol: -0.98, isNdx: true },
    { name: '新興市場 EEM',   corr:  0.813, dVol: -0.72 },
  ],
  // NDX 換手實測（us_overlap.py §3(b)）—— 只在「為什麼沒有那斯達克」的說明區使用。
  // ⚠ 口徑與主表不同：此表是 100% 滿倉、名目 2x、無準備金結構的月再平衡，
  //   所以 ndx=0 那列（28.78% / 16.2% / −81.5%）與主表的「台股40 / SPX60」
  //   （23.14% / 15.0% / −74.1%）是同一個配置的兩種算法，數字不可橫向比較。
  ndxSwap: [
    { ndx: 0,  vol: 28.78, cagr: 16.2, mdd: -81.5 },
    { ndx: 10, vol: 29.62, cagr: 17.0, mdd: -83.6 },
    { ndx: 20, vol: 30.72, cagr: 17.6, mdd: -87.1 },
    { ndx: 30, vol: 32.03, cagr: 18.2, mdd: -90.0 },
    { ndx: 60, vol: 37.11, cagr: 19.5, mdd: -95.7 },
  ],
};

// 同一套準備金 70/30 拉到台美共同期間重跑（us_vs_tw.py）。
// ⚠ 首頁主回測表的 Calmar 0.222 是 2000-07 起算；這張表誠實揭露起點選擇的貢獻。
const BACKTEST_COMMON = {
  span: '1995-01 ~ 2026-07（31.6 年，含 1997 亞洲金融風暴）',
  rows: [
    { name: '台股正二 準備金 70/30',        expo: 171, cagr: 13.8, mdd: -84.1, calmar: 0.164, uw: 7.4,  cur: true },
    { name: '台股正二（紅利反轉）',          expo: 170, cagr: 9.7,  mdd: -84.8, calmar: 0.115, uw: 10.0 },
    { name: 'S&P500 2x 準備金 70/30',      expo: 153, cagr: 13.6, mdd: -74.0, calmar: 0.184, uw: 6.4 },
    { name: 'S&P500 3x 準備金 70/30',      expo: 225, cagr: 16.5, mdd: -87.7, calmar: 0.188, uw: 6.9 },
    { name: '那斯達克 2x 準備金 70/30',      expo: 156, cagr: 14.1, mdd: -96.8, calmar: 0.145, uw: 21.0 },
  ],
};

const BOOTSTRAP_FROM = { y: 1995, m: 1 };  // 首次建檔起點
const REFRESH_MONTHS = 3;                  // 每次更新重抓最近幾個月

const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const r4 = (x) => Math.round(x * 10000) / 10000;

/** 以台北時區取今天 YYYY-MM-DD，避免 CI 在 UTC 上跨日誤標。 */
const todayTaipei = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

const PROJ = path.join(__dirname, '..');
const HIST_PATH = path.join(PROJ, 'taiex_daily.json');


/**
 * 讀取／建立／增量更新大盤日線序列。
 * 存成精簡格式 rows = [["1995-01-05", 7051.49], ...]；
 * 日漲跌不存，需要時由序列自身相減得出。
 */
async function syncTaiexHistory() {
  let hist = [];
  if (fs.existsSync(HIST_PATH)) {
    hist = JSON.parse(fs.readFileSync(HIST_PATH, 'utf8')).rows || [];
  }

  const now = new Date(Date.now() + 8 * 3600 * 1000);
  const to = { y: now.getUTCFullYear(), m: now.getUTCMonth() + 1 };

  let from;
  if (!hist.length) {
    from = BOOTSTRAP_FROM;
    console.log(`taiex_daily.json 不存在，自 ${from.y}-${String(from.m).padStart(2, '0')} 建檔（首次較久）…`);
  } else {
    let y = Number(hist[hist.length - 1][0].slice(0, 4));
    let m = Number(hist[hist.length - 1][0].slice(5, 7)) - (REFRESH_MONTHS - 1);
    while (m < 1) { m += 12; y -= 1; }
    from = { y, m };
  }

  const fresh = await fetchTaiexRange(from, to, (ym) => process.stdout.write(`  … ${ym}\r`));
  if (!fresh.length && !hist.length) throw new Error('FMTQIK 未取得任何資料，無法建檔');

  const map = new Map(hist);
  fresh.forEach((r) => map.set(r.date, r.close));
  const rows = [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  fs.writeFileSync(HIST_PATH, JSON.stringify({ updated: todayTaipei(), rows }) + '\n', 'utf8');
  console.log(`  大盤日線 ${rows.length} 筆（${rows[0][0]} ~ ${rows[rows.length - 1][0]}）`);
  return rows;
}


/**
 * 由日線序列算出歷史高點、目前回撤、各批加碼觸發狀態，以及創新高重置的閘門狀態。
 *
 * 這裡是逐日模擬，不是「取全期最高點再比一次」。加了 resetGapDays 之後兩者會分岔：
 * 新高照樣更新高水位（所以分批門檻跟著上移），但「減碼／回補／彈藥復活」這個動作
 * 必須距上次重置滿 resetGapDays 個交易日才執行。因此「哪幾批還活著」要由
 * 重置歷史決定，不能再用 maxDd 反推。
 */
function reserveState(rows) {
  const GAP = STRATEGY.resetGapDays || 0;
  const T = STRATEGY.tranches;

  let ath = -Infinity, athDate = null;
  let lastResetI = -1, lastResetDate = null, lastResetClose = null;
  let fired = new Set();
  // 自上次重置以來最深的「當下回撤」——與觸發判斷同一把尺（分母是當時的高水位）
  let worst = 0, trough = null, troughDate = null;
  let nReset = 0, nBlocked = 0;

  for (let i = 0; i < rows.length; i++) {
    const [d, c] = rows[i];
    const isHigh = c > ath;
    if (isHigh) { ath = c; athDate = d; }
    if (isHigh && (lastResetI < 0 || i - lastResetI >= GAP)) {
      lastResetI = i; lastResetDate = d; lastResetClose = c;
      fired.clear();
      worst = 0; trough = c; troughDate = d;
      nReset++;
    } else {
      if (isHigh) nBlocked++;
      const dd = c / ath - 1;
      if (dd < worst) { worst = dd; trough = c; troughDate = d; }
      T.forEach((t, k) => { if (dd <= t.level + 1e-12) fired.add(k); });
    }
  }

  const lastI = rows.length - 1;
  const last = { date: rows[lastI][0], close: rows[lastI][1] };
  const curDd = last.close / ath - 1;
  const maxDd = worst;

  // 閘門：要重置必須「距上次重置 ≥ GAP 個交易日」且「當天收盤創新高」。
  const elapsed = lastI - lastResetI;
  const gateIn = Math.max(0, GAP - elapsed);
  const etaMs = new Date(lastResetDate + 'T00:00:00Z').getTime()
    + Math.round(GAP * 365.25 / 252) * 86400000;
  const reset = {
    gapDays: GAP,
    lastDate: lastResetDate,
    lastClose: r2(lastResetClose),
    elapsed,
    gateOpen: gateIn === 0,
    gateIn,
    // 閘門開啟的日曆日估計值（交易日→日曆日換算，未扣假日，僅供顯示）
    gateEta: gateIn === 0 ? null : new Date(etaMs).toISOString().slice(0, 10),
    // 閘門開了之後，還要突破這個水位才會真的動手
    level: r2(ath),
    levelPct: r2((ath / last.close - 1) * 100),
    resets: nReset,
    blocked: nBlocked,
  };

  const totalW = T.reduce((s, t) => s + t.weight, 0);
  let firedW = 0;
  const tranches = T.map((t, i) => {
    const isFired = fired.has(i);
    if (isFired) firedW += t.weight;
    const triggerIndex = ath * (1 + t.level);
    return {
      no: i + 1,
      level: t.level,
      weight: t.weight,
      share: t.weight / totalW,          // 佔準備金的比例
      triggerIndex: Math.round(triggerIndex),
      fired: isFired,
      // 距離觸發：負值代表指數還要再跌這麼多點
      distPts: Math.round(triggerIndex - last.close),
      distPct: r2((triggerIndex / last.close - 1) * 100),
      leveredDd: r1((1 - Math.pow(1 + t.level, 2)) * -100),   // 正二約略回撤
    };
  });

  const deployed = firedW / totalW;
  const profiles = STRATEGY.profiles.map((p) => {
    const coreW = p.coreW + p.reserveW * deployed;
    return {
      ...p,
      curCoreW: r4(coreW),
      curReserveW: r4(1 - coreW),
      baseExposure: r2(p.coreW * STRATEGY.tool * 100),
      curExposure: r2(coreW * STRATEGY.tool * 100),
      fullExposure: r2(1 * STRATEGY.tool * 100),
    };
  });

  // 首次建倉的價格加速器（只影響「還沒進場的錢」，不影響已建立的部位）
  const accelIndex = ath * (1 + STRATEGY.entryAccelLevel);
  const entryAccel = {
    level: STRATEGY.entryAccelLevel,
    triggerIndex: Math.round(accelIndex),
    reached: last.close <= accelIndex + 1e-9,
    distPts: Math.round(accelIndex - last.close),
    distPct: r2((accelIndex / last.close - 1) * 100),
  };

  return {
    ath: r2(ath), athDate,
    trough: r2(trough), troughDate,
    curDd: r2(curDd * 100),
    maxDd: r2(maxDd * 100),
    deployed: r4(deployed),
    tranches, profiles, entryAccel, reset,
    nextTranche: tranches.find((t) => !t.fired) || null,
  };
}


/** 月底回撤序列（供走勢圖）。 */
function drawdownMonthly(rows) {
  const byMonth = new Map();
  let ath = -Infinity;
  for (const [d, c] of rows) {
    if (c > ath) ath = c;
    byMonth.set(d.slice(0, 7), c / ath - 1);   // 每月最後一筆會覆蓋前面的
  }
  return [...byMonth.entries()].map(([ym, dd]) => [ym, r2(dd * 100)]);
}


(async () => {
  console.log('更新中 …');
  // 先抓 P/E（不寫檔），失敗就完全不碰任何既有檔案；
  // syncTaiexHistory() 會寫入 taiex_daily.json，所以放在它後面。
  const peRaw = await fetchPe();
  const rows = await syncTaiexHistory();

  const last = { date: rows[rows.length - 1][0], close: rows[rows.length - 1][1] };
  const prevClose = rows.length > 1 ? rows[rows.length - 2][1] : last.close;
  const change = last.close - prevClose;

  // 頁面標題只顯示到小數兩位（28.53），但同頁歷史序列末點是全精度（28.5257）。
  // 兩者同月時採用全精度值。
  let pe = peRaw.value, peExact = false;
  const lastPe = peRaw.history[peRaw.history.length - 1];
  if (lastPe && lastPe[0] === peRaw.asOf.slice(0, 7) && Math.abs(lastPe[1] - peRaw.value) < 0.01) {
    pe = lastPe[1]; peExact = true;
  }
  if (!(pe > 0)) throw new Error(`P/E 不合理: ${pe}`);

  // 估值溫度計：目前 P/E 在完整歷史中的百分位
  const pv = peRaw.history.map((h) => h[1]);
  const pePct = pv.filter((v) => v <= pe).length / pv.length;
  const pace = PACE.find((p) => pePct >= p.minPct);

  const res = reserveState(rows);

  const payload = {
    version: STRATEGY.version,
    updated: todayTaipei(),
    product: STRATEGY.product,
    taiex: {
      date: last.date,
      close: r2(last.close),
      change: r2(change),
      changePct: r2(prevClose > 0 ? (change / prevClose) * 100 : 0),
    },
    reserve: res,
    strategy: {
      tool: STRATEGY.tool,
      // ⚠ 這裡不再輸出 tranches：它與 reserve.tranches 重複，而頁面吃的是後者。
      //   留著會讓維護者改了 strategy.tranches 卻發現畫面沒變。
      //   加碼水位的唯一真來源是上方的 STRATEGY.tranches → reserveState() → reserve.tranches。
      // ★ 2026-08-24 全表用修好的資料重跑（etf_00631L 補回 2016-02、tr_monthend 修 2018-12）。
      //   α 從 +0.17%/年 改為 −0.42%/年。下表的 CAGR/Calmar 一律已換算成日曆年 26.05 年，
      //   不是腳本印的「交易日÷252」（那會高約 0.4pp）。唯一數字來源是 Strategy/README.md §1。
      backtest: {
        span: '2000-07 ~ 2026-07（26.0 年）',
        // ★ 2026-08-24 全表用修好的資料重跑（見 alphaBug）。CAGR 與 Calmar 一律用
        //   日曆年 26.05 年換算，不用腳本印的「交易日÷252」（那會高約 0.4pp）。
        // ⚠ cur（本策略）而不是 best（最佳）—— 70/30 的 Calmar 0.222 是本表最低的一檔準備金；
        //   重跑後 Calmar 變成隨槓桿單調遞減（50/50 的 0.230 最高）。選 70/30 的理由是終值
        //   （61.72x vs 52.19x，高 18%）而最大回撤只差 5.8pp，且 3.6 年是最長水下「尚未跳升」的最後一格。
        //   README 原表有 50/50 與 80/20 兩列，這裡一併列出，不要只留對本策略有利的比較對象。
        // ── ref:true 的三列 = 「什麼都不做」的對照組（2026-08 新增 VTI / VOO）─────────
        //   口徑與上面各列**逐位對齊**（用固定 1.5x / 2.0x 兩列反查驗證過，逐位相同）：
        //     窗 2000-07-03~2026-07-21、CAGR 用日曆 26.05 年、水下＝連續交易日÷252、
        //     終值**含第一天的報酬**（把淨值序列除以 eq[0] 會洗掉首日，L=2.0 會從 60.09 掉到 59.59）。
        //   代理與偏誤方向：
        //     0050 → 台股發行量加權股價報酬指數（含息）。0050 掛牌於 2003-06，2000-2003 沒有它；
        //            0050 自己還要再扣約 0.32%/年內扣，所以這一列**略偏樂觀**。
        //     VTI  → VTSMX（1992 起，與 VTI 同一個投資組合）接 VTI（2001-06-15 掛牌）。
        //     VOO  → VFINX（1990 起）接 VOO（2010-09-09 掛牌）。兩者早期用的投資人級別內扣較高，**略偏保守**。
        //   ⚠ 美股兩列以**美元**計價（與 backtestCommon 的 S&P500 各列同慣例）。
        //   重算腳本：Strategy/sources/ref-rows/ref_rows.py
        rows: [
          { name: '準備金 70/30（本策略）',   expo: 169, fin: 61.72, cagr: 17.1, mdd: -77.1, calmar: 0.222, uw: 3.6, cur: true },
          { name: '準備金 80/20（更積極）',   expo: 179, fin: 64.03, cagr: 17.3, mdd: -79.9, calmar: 0.217, uw: 5.7 },
          { name: '準備金 60/40（較保守）',   expo: 159, fin: 57.52, cagr: 16.8, mdd: -74.2, calmar: 0.227, uw: 3.6 },
          { name: '準備金 50/50（最保守）',   expo: 150, fin: 52.19, cagr: 16.4, mdd: -71.3, calmar: 0.230, uw: 3.0 },
          { name: '固定 2.0x',              expo: 200, fin: 60.09, cagr: 17.0, mdd: -85.6, calmar: 0.199, uw: 6.8 },
          { name: '固定 1.5x',              expo: 150, fin: 33.60, cagr: 14.4, mdd: -74.9, calmar: 0.193, uw: 6.3 },
          { name: 'P/E 定槓桿（校正同曝險）',    expo: 150, fin: 21.32, cagr: 12.5, mdd: -76.0, calmar: 0.164, uw: 9.1 },
          { name: '100% 0050（不開槓桿，對照）',      expo: 100, fin: 13.78, cagr: 10.6, mdd: -58.0, calmar: 0.183, uw: 5.7, ref: true },
          { name: '100% VTI（美國全市場，美元計價）',    expo: 100, fin:  8.66, cagr:  8.6, mdd: -55.5, calmar: 0.156, uw: 5.5, ref: true },
          { name: '100% VOO（S&P500，美元計價）',       expo: 100, fin:  8.15, cagr:  8.4, mdd: -55.3, calmar: 0.152, uw: 6.1, ref: true },
        ],
      },
      backtestCommon: BACKTEST_COMMON,
      analogue1997: STRATEGY.analogue1997,
    },
    blend: BLEND,
    research: STRATEGY.research,
    onekoniEps: STRATEGY.onekoni,
    pe: {
      value: r4(pe), display: r2(pe), asOf: peRaw.asOf, exact: peExact,
      pctile: r4(pePct * 100),
      pace,
    },
    peHistory: peRaw.history.map(([ym, v]) => [ym, r4(v)]),
    ddHistory: drawdownMonthly(rows),
    sources: {
      pe: 'World PE Ratio（台灣）',
      peNote: '該站台灣 P/E 係以 EWT ETF（iShares MSCI Taiwan）計算，非加權指數本身之本益比',
      index: '台灣證券交易所 — 市場成交資訊 (FMTQIK)',
    },
  };

  fs.writeFileSync(path.join(PROJ, 'data.json'), JSON.stringify(payload, null, 2) + '\n', 'utf8');

  const rec = res.profiles.find((p) => p.recommended);
  console.log('\n已寫入 data.json');
  console.log(`  加權指數 ${payload.taiex.close}（${last.date}）  日漲跌 ${payload.taiex.change}（${payload.taiex.changePct}%）`);
  console.log(`  歷史高點 ${res.ath}（${res.athDate}）  目前回撤 ${res.curDd}%  波段最深 ${res.maxDd}%`);
  console.log(`  已觸發批次 ${res.tranches.filter((t) => t.fired).length}/${res.tranches.length}（準備金已投入 ${(res.deployed * 100).toFixed(0)}%）`);
  console.log(`  建議（${rec.name}）核心 ${(rec.curCoreW * 100).toFixed(0)}% / 準備金 ${(rec.curReserveW * 100).toFixed(0)}% → 淨曝險 ${rec.curExposure}%`);
  if (res.nextTranche) {
    const n = res.nextTranche;
    console.log(`  下一批：第 ${n.no} 批 @ 指數 ${n.triggerIndex}（回撤 ${(n.level * 100).toFixed(0)}%），還差 ${n.distPts} 點（${n.distPct}%）`);
  }
  const rs = res.reset;
  console.log(`  回補閘門（${rs.gapDays} 個交易日）：上次回補 ${rs.lastDate} @ ${rs.lastClose}，距今 ${rs.elapsed} 個交易日 → `
    + (rs.gateOpen ? `已開，等指數突破 ${rs.level}（還需 ${rs.levelPct}%）`
                   : `未開，還要 ${rs.gateIn} 個交易日（約 ${rs.gateEta}）`));
  console.log(`  　　全期共回補 ${rs.resets} 次；另有 ${rs.blocked} 個新高日被閘門擋下（舊規則會全部動手）`);
  console.log(`  市場 P/E ${payload.pe.display}（歷史第 ${payload.pe.pctile.toFixed(1)} 百分位）→ 分批速度 ${pace.label}：${pace.months}`);
  const ea = res.entryAccel;
  console.log(`  建倉加速器 @ 指數 ${ea.triggerIndex}（回撤 ${(ea.level * 100).toFixed(0)}%）：`
    + (ea.reached ? '已觸發 → 核心剩餘額度應一次投完'
                  : `還差 ${ea.distPts} 點（${ea.distPct}%）`));
  const rg = BLEND.range, dm = BLEND.demo;
  console.log(`  跨市場配置預設：台股 ${dm.tw}% / S&P500 2x ${dm.spx}%`
    + `（可調範圍 ${rg.tw[0]}~${rg.tw[1]}% / ${rg.spx[0]}~${rg.spx[1]}%，區間內差異為雜訊）`);
  const ok = STRATEGY.onekoni;
  console.log(`  onekoni 口徑 P/E（僅對照）：實績 EPS ${ok.epsActual} → ${(payload.taiex.close / ok.epsActual).toFixed(1)}`
    + `　法人預估 ${ok.epsEst} → ${(payload.taiex.close / ok.epsEst).toFixed(1)}`);
})().catch((e) => {
  console.error('更新失敗（既有檔案未變更）:', e.message);
  process.exit(1);
});
