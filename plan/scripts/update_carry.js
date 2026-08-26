#!/usr/bin/env node
/*
 * update_carry.js — 量測台股正二(00685L 群益臺灣加權正2)的「逆價差/轉倉」拖累,寫入 carry.json
 *
 * 由 GitHub Action 每月跑一次(也可手動觸發)。在 Action 伺服器上執行,無 CORS 限制。
 *
 * ══ 2026-08 兩處修正 ═══════════════════════════════════════════════════════
 * ① **基準換掉:0050 → ^TWII。**
 *    舊版把 00631L 對 **0050** 迴歸。那是**指數錯配**,不是成本:
 *    00631L 交付的是「2× 加權指數」,0050 追的是「臺灣50」,兩個指數本身近年就差很多
 *    (2024~2026 段,2×臺灣50 年化 134.98% vs 2×加權 101.44%)。
 *    症狀非常清楚 —— 迴歸出來的 **β 只有 1.86**,而對 ^TWII 迴歸是 **2.04**。
 *    舊版把這個缺口讀成「衰減偏誤」,再把它當成年化 −6.7% 的 α,推出
 *    `recommendedCarry = 5`(滑桿上限)。那 5% 裡有一大半是指數差,不是持有成本。
 *    ⚠ 這個錯誤與標的無關:把 00685L 拿去對 0050 迴歸,α 一樣是 −4.25%/年。
 * ② **標的換掉:00631L → 00685L**,與「② 挑時機」同一個決定(基準一致、內扣 0.48% 最低)。
 *
 * ══ 方法 ═══════════════════════════════════════════════════════════════════
 *   1. 抓 ^TWII(加權**價格**指數)與 00685L.TW 日收,對多視窗做 OLS:r_2x = α + β·r_1x。
 *   2. ^TWII 不含息,而 ETF 實際交付的是 2× **含息**,所以 α 會先天多出約 2× 現金殖利率。
 *      真正的拖累 = 2q − α_price;再扣掉內扣,剩下的才是逆價差/轉倉那一層:
 *          carry = 2q − α_price − 內扣
 *   3. q(加權指數現金殖利率)是**假設值**,不是抓來的 —— 見 DIV_YIELD 的註解。
 *
 * ══ 侷限(網頁上要照實標)═══════════════════════════════════════════════════
 *   · q 是常數假設,而它每年都在動;q 差 0.5 個百分點,carry 就差 1 個百分點。
 *   · 短視窗雜訊大(1 年的 α 對單一年度的行情極敏感)。
 *   · **精確值請看「② 挑時機」的 research.products2x**:那一份用證交所「發行量加權股價
 *     報酬指數」直接對照,不需要 q 這個假設。00685L 掛牌至今(9.3 年)量到的全期
 *     α 是 **−0.15%/年**(已扣所有費用)—— 也就是說,**拉長看幾乎沒有成本**,
 *     近幾年的拖累是 2022 年之後逆價差反轉造成的,不是常態。
 *
 * ⚠ 這支腳本的輸出**不再自動覆蓋 /plan/ 的滑桿**。滑桿預設一律是
 *   assets/engine.js 的 DEFAULTS.carryDrag(3.0%),因為九階風險階梯的 mu 就是照那個值
 *   校準的 —— 讓 carry.json 偷偷把滑桿改成 5%,會使同一個人在「★ 我的計畫」
 *   與「⚙ 配資金」看到兩組對不起來的年化。carry.json 現在只負責**顯示實測值**。
 */
'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let s = '';
      res.on('data', (d) => (s += d));
      res.on('end', () => resolve(s));
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function yahooDaily(sym, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=1d`;
  const j = JSON.parse(await get(url));
  const r = j.chart.result[0];
  const ts = r.timestamp;
  const adj = (r.indicators.adjclose && r.indicators.adjclose[0].adjclose) || r.indicators.quote[0].close;
  const out = [];
  for (let i = 0; i < ts.length; i++) if (adj[i] != null) out.push([ts[i], adj[i]]);
  return out;
}

// OLS 迴歸 r2 = α + β·r1
function regress(a, b) {
  const mapA = new Map(a), mapB = new Map(b);
  const keys = [...mapA.keys()].filter((k) => mapB.has(k)).sort((x, y) => x - y);
  const X = [], Y = [];
  for (let i = 1; i < keys.length; i++) {
    X.push(mapA.get(keys[i]) / mapA.get(keys[i - 1]) - 1);
    Y.push(mapB.get(keys[i]) / mapB.get(keys[i - 1]) - 1);
  }
  const n = X.length;
  const mx = X.reduce((s, v) => s + v, 0) / n, my = Y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (X[i] - mx) * (Y[i] - my); sxx += (X[i] - mx) ** 2; }
  const beta = sxy / sxx;
  const alphaDaily = my - beta * mx;
  return { beta, alphaDaily, alphaAnnual: Math.pow(1 + alphaDaily, 252) - 1, n };
}

const PRODUCT = '00685L.TW';   // 群益臺灣加權正2 —— 與 /timing/ 同一個標的
const INDEX = '^TWII';         // 加權**價格**指數(不含息)
const FEE = 0.0048;            // 00685L 內扣(MoneyDJ 2026-07 查證)
/* 加權指數現金殖利率。近年落在 2.7%~3.8%,這裡取 3.4% 當中間值。
   ⚠ 它是**假設值**,而且是本方法最大的不確定來源:q 每差 0.5pp,算出來的 carry 就差 1pp。
   要精確值請用「② 挑時機」那條用證交所報酬指數的管線(不需要這個假設)。 */
const DIV_YIELD = 0.034;

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const round1 = (x) => Math.round(x * 10) / 10;
const round2 = (x) => Math.round(x * 100) / 100;

(async () => {
  try {
    const idx = await yahooDaily(INDEX, '5y');
    const etf = await yahooDaily(PRODUCT, '5y');
    const windows = { '1y': 252, '2y': 504, '3y': 756, '5y': idx.length };
    const out = {};
    for (const [k, len] of Object.entries(windows)) {
      const reg = regress(idx.slice(-len), etf.slice(-len));
      // α 是對「價格指數」量的,要先換算成對「含息」的,才是真正的拖累
      const drag = 2 * DIV_YIELD - reg.alphaAnnual;   // 全部成本(含內扣)
      out[k] = {
        beta: round2(reg.beta),
        alphaVsPrice: round1(reg.alphaAnnual * 100),  // 對價格指數的年化 α %
        carry: round1((drag - FEE) * 100),            // 扣掉內扣之後的逆價差/轉倉 %
        days: reg.n,
      };
    }
    const lastTs = idx[idx.length - 1][0];
    const payload = {
      updated: new Date().toISOString().slice(0, 10),
      dataAsOf: new Date(lastTs * 1000).toISOString().slice(0, 10),
      product: PRODUCT,
      // 只顯示、不自動套用滑桿(見檔頭 ⚠)。保留欄位是為了讓舊版前端不至於壞掉。
      applyToSlider: false,
      measured5y: out['5y'] ? out['5y'].carry : null,
      divYield: round1(DIV_YIELD * 100),
      fee: round2(FEE * 100),
      windows: out,
      method: `${PRODUCT} vs ${INDEX} 日報酬 OLS 迴歸;carry = 2×現金殖利率(假設 ${round1(DIV_YIELD * 100)}%) − α − 內扣 ${round2(FEE * 100)}%`,
      note: `粗估,只看方向。現金殖利率是常數假設(差 0.5pp → carry 差 1pp),短視窗雜訊大。`
        + `精確值見「② 挑時機」的 products2x:00685L 掛牌至今 9.3 年的全期 α 是 −0.15%/年(已扣所有費用)。`
        + `滑桿預設固定 3.0%(= 九階風險階梯校準時用的值),這裡的數字只供對照,可手動覆蓋。`,
      source: 'Yahoo Finance',
    };
    const outPath = path.join(__dirname, '..', 'carry.json');
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    console.log('已寫入', outPath);
    console.log(JSON.stringify(payload, null, 2));
  } catch (e) {
    console.error('更新失敗:', e.message);
    process.exit(1);
  }
})();
