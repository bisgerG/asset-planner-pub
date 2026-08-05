#!/usr/bin/env node
/*
 * update_carry.js — 估算台股正二(00631L)的「逆價差+成本拖累」,寫入 carry.json
 *
 * 由 GitHub Action 每月跑一次(也可手動觸發)。在 Action 伺服器上執行,無 CORS 限制。
 *
 * 方法(誠實標註:這是粗估,非精準值):
 *   - 抓 Yahoo Finance 的 0050.TW(1x 標的代理)與 00631L.TW(正二)日收(adjclose≈含息)。
 *   - 對多個視窗(1y/2y/3y/5y)做 OLS 迴歸 r_2x = α + β·r_1x,年化 α。
 *   - 逆價差/roll 拖累 ≈ −α_年化 − 內扣(1.3%)。
 *   - recommendedCarry 用近 3 年(兼顧近期規律與穩定),clamp 到滑桿範圍 [-1, 5]。
 *
 * 侷限:ETF 對 ETF 迴歸有衰減偏誤(β 常落在 ~1.85,而非 2.0)、短視窗雜訊大。
 *   真正精準需證交所「報酬指數(含息)」+ 校準 β=2.05 的多年迴歸(本機資料管線)。
 *   因此網頁會把這個值標成「粗估、僅供方向參考」,滑桿仍可手動覆蓋。
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
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?range=${range}&interval=1d`;
  const j = JSON.parse(await get(url));
  const r = j.chart.result[0];
  const ts = r.timestamp;
  const adj = (r.indicators.adjclose && r.indicators.adjclose[0].adjclose) || r.indicators.quote[0].close;
  const out = [];
  for (let i = 0; i < ts.length; i++) if (adj[i] != null) out.push([ts[i], adj[i]]);
  return out;
}

// OLS 迴歸 r2 = α + β·r1,回傳 {beta, alphaDaily, alphaAnnual, n}
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
  const alphaAnnual = Math.pow(1 + alphaDaily, 252) - 1;
  return { beta, alphaDaily, alphaAnnual, n };
}

const FEE = 0.013;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const round1 = (x) => Math.round(x * 10) / 10;
const round2 = (x) => Math.round(x * 100) / 100;

(async () => {
  try {
    // 抓 5 年,各視窗從尾端切
    const a5 = await yahooDaily('0050.TW', '5y');
    const b5 = await yahooDaily('00631L.TW', '5y');
    const windows = { '1y': 252, '2y': 504, '3y': 756, '5y': a5.length };
    const out = {};
    for (const [k, len] of Object.entries(windows)) {
      const reg = regress(a5.slice(-len), b5.slice(-len));
      const carry = -reg.alphaAnnual - FEE; // 逆價差/roll(扣內扣)
      out[k] = {
        beta: round2(reg.beta),
        alpha: round1(reg.alphaAnnual * 100),   // 年化 α %
        carry: round1(carry * 100),             // 逆價差/roll 拖累 %
        days: reg.n,
      };
    }
    // 採用近 5 年平均(最穩、最接近報告長期值);近 1 年另外顯示讓使用者看「當年是否惡化」
    const recommended = clamp(Math.round(out['5y'].carry * 2) / 2, -1, 5);
    const lastTs = a5[a5.length - 1][0];
    const payload = {
      updated: new Date().toISOString().slice(0, 10),
      dataAsOf: new Date(lastTs * 1000).toISOString().slice(0, 10),
      recommendedCarry: recommended,
      windows: out,
      method: '00631L vs 0050 日報酬 OLS 迴歸 α(Yahoo adjclose);recommended=近5年平均 clamp[-1,5];另列近1年(當年)供觀察惡化',
      note: '粗估;逆價差先天雜訊大、ETF對ETF有衰減偏誤,僅供方向參考。精確值需證交所報酬指數+校準β=2.05。滑桿可手動覆蓋。',
      source: 'Yahoo Finance',
    };
    // 以腳本自身位置定位輸出,不吃 cwd —— CI 從 repo 根執行 `node plan/scripts/update_carry.js`
    // 時,cwd 是 repo 根,會把 carry.json 寫到站台根目錄而不是 plan/ 底下。
    const outPath = path.join(__dirname, '..', 'carry.json');
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    console.log('已寫入', outPath);
    console.log(JSON.stringify(payload, null, 2));
  } catch (e) {
    console.error('更新失敗:', e.message);
    process.exit(1);
  }
})();
