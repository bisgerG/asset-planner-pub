#!/usr/bin/env node
/*
 * sources.js — 兩個資料抓取器
 *
 *   fetchTaiex() 台灣證券交易所 FMTQIK（每日市場成交資訊）→ 加權指數收盤 + 漲跌點數
 *   fetchPe()    worldperatio.com（台灣）→ 市場 P/E 現值、資料日、月度歷史序列
 *
 * 只用 Node 內建模組,無 npm 相依(與 fire-planner/scripts/update_carry.js 同一模式)。
 * 任何一個抓取失敗一律 throw,由呼叫端決定不覆寫既有 data.json。
 */
'use strict';
const https = require('https');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/** GET 一個網址,自動跟隨 301/302(worldperatio 的 www. 會跳裸網域)。 */
function get(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en,zh-TW;q=0.9' } }, (res) => {
      const code = res.statusCode;
      if (code >= 300 && code < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) return reject(new Error(`redirect 次數過多: ${url}`));
        const next = new URL(res.headers.location, url).toString();
        return resolve(get(next, redirectsLeft - 1));
      }
      if (code !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${code}: ${url}`));
      }
      let s = '';
      res.setEncoding('utf8');
      res.on('data', (d) => (s += d));
      res.on('end', () => resolve(s));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error(`timeout: ${url}`)); });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- TAIEX ----

/** 民國日期 '115/07/24' → '2026-07-24' */
function rocToDate(s) {
  const m = String(s).trim().match(/^(\d+)\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) throw new Error(`無法解析民國日期: ${s}`);
  const y = Number(m[1]) + 1911;
  return `${y}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

/** '43,654.84' → 43654.84 ; 'X' / '--' → NaN */
function num(s) {
  const v = Number(String(s).replace(/[,\s]/g, ''));
  return Number.isFinite(v) ? v : NaN;
}

/** 抓某年月的 FMTQIK,回傳 [{date, close, change}, ...];查無資料回傳 []。 */
async function fetchFmtqikMonth(year, month) {
  const ym = `${year}${String(month).padStart(2, '0')}01`;
  const url = `https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK?date=${ym}&response=json`;
  const j = JSON.parse(await get(url));
  // 「查無資料」與「抓取出錯」必須分開處理。
  // 舊版兩者都 return []，而 update_data.js 的 REFRESH_MONTHS 只回頭補最近 3 個月 ——
  // 於是建檔當時任何一次暫時性失敗，都會在 taiex_daily.json 裡留下永久補不回來的洞
  // （實際後果：2008-12、2009-01 等 10 個月整月缺漏，金融海嘯谷底的回撤因此被低估約 2pp）。
  // 現在只有證交所明確回覆「沒有符合條件的資料」才視為合法空月份，其餘一律拋錯：
  // 整支腳本會中止、當日不覆寫任何檔案，網站繼續沿用上一份好的資料。
  if (j.stat !== 'OK') {
    if (/沒有符合條件|查無資料|no data/i.test(String(j.stat))) return [];
    throw new Error(`FMTQIK ${year}-${String(month).padStart(2, '0')} 回應異常: ${j.stat}`);
  }
  if (!Array.isArray(j.data)) {
    throw new Error(`FMTQIK ${year}-${String(month).padStart(2, '0')} 缺少 data 陣列`);
  }

  const fields = j.fields || [];
  const iDate = fields.indexOf('日期');
  const iClose = fields.indexOf('發行量加權股價指數');
  const iChange = fields.indexOf('漲跌點數');
  if (iDate < 0 || iClose < 0 || iChange < 0) {
    throw new Error(`FMTQIK 欄位結構改變: ${JSON.stringify(fields)}`);
  }

  return j.data
    .map((r) => ({ date: rocToDate(r[iDate]), close: num(r[iClose]), change: num(r[iChange]) }))
    .filter((r) => Number.isFinite(r.close));
}

/**
 * 加權指數最新收盤。
 * 同時抓當月與上月(月初時當月可能還沒資料),合併後取日期最大的一筆。
 */
async function fetchTaiex(today = new Date()) {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth() + 1; // 1-based
  const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };

  const cur = await fetchFmtqikMonth(y, m);
  await sleep(400); // 對證交所客氣一點
  const pre = await fetchFmtqikMonth(prev.y, prev.m);

  const rows = [...pre, ...cur].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (!rows.length) throw new Error('FMTQIK 未取得任何交易日資料');

  const last = rows[rows.length - 1];
  const prevClose = last.close - last.change;
  return {
    date: last.date,
    close: last.close,
    change: last.change,
    changePct: prevClose > 0 ? (last.change / prevClose) * 100 : 0,
  };
}

// ------------------------------------------------------------------- P/E ----

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/** '24 July 2026' → '2026-07-24' */
function enDateToIso(s) {
  const m = String(s).trim().match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (!m) throw new Error(`無法解析英文日期: ${s}`);
  const mi = MONTHS.findIndex((x) => x.toLowerCase() === m[2].toLowerCase());
  if (mi < 0) throw new Error(`未知月份: ${m[2]}`);
  return `${m[3]}-${String(mi + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/**
 * worldperatio 台灣頁 → { value, asOf, history }
 * history 為 [['1995-01', 26.2634], ...] 月度序列(1995 至今)。
 *
 * 注意:該站的台灣 P/E 是以 EWT ETF(iShares MSCI Taiwan)計算,
 *      並非加權指數本身的本益比。頁面上必須據實標註。
 */
async function fetchPe() {
  const html = await get('https://worldperatio.com/area/taiwan/');

  // --- 現值與資料日:剝掉 script、去標籤、壓空白後比對可見文字 ---
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#8201;|&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');

  const cur = text.match(/Taiwan Stock Market P\/E Ratio\s+([\d.]+)\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/);
  if (!cur) throw new Error('worldperatio 頁面結構改變:找不到 P/E 現值與資料日');
  const value = Number(cur[1]);
  const asOf = enDateToIso(cur[2]);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`P/E 現值不合理: ${cur[1]}`);

  // --- 月度歷史:頁內 JS 變數 detailPE_data = [[Date.UTC(1995, 0, 1),26.2634], ...] ---
  const blk = html.match(/detailPE_data\s*=\s*(\[[\s\S]*?\])\s*;/);
  if (!blk) throw new Error('worldperatio 頁面結構改變:找不到 detailPE_data');

  const history = [];
  const re = /Date\.UTC\(\s*(\d{4})\s*,\s*(\d{1,2})\s*,\s*\d{1,2}\s*\)\s*,\s*([\d.]+)/g;
  let m;
  while ((m = re.exec(blk[1])) !== null) {
    const yy = Number(m[1]);
    const mm = Number(m[2]) + 1; // Date.UTC 月份是 0-based
    const v = Number(m[3]);
    if (Number.isFinite(v)) history.push([`${yy}-${String(mm).padStart(2, '0')}`, v]);
  }
  if (history.length < 100) throw new Error(`detailPE_data 解析結果過少(${history.length} 點),疑似格式改變`);

  return { value, asOf, history };
}

/**
 * 抓一段期間的加權指數日線，回傳 [{date, close, change}, ...]（已依日期排序去重）。
 * from / to 為 {y, m}。用於建立與增量更新 taiex_daily.json。
 */
async function fetchTaiexRange(from, to, onProgress) {
  const seen = new Map();
  let y = from.y, m = from.m, n = 0;
  while (y < to.y || (y === to.y && m <= to.m)) {
    const rows = await fetchFmtqikMonth(y, m);
    rows.forEach((r) => seen.set(r.date, r));
    if (rows.length) await sleep(400);          // 對證交所客氣一點
    if (onProgress && ++n % 24 === 0) onProgress(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { y += 1; m = 1; }
  }
  return [...seen.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

module.exports = { get, fetchTaiex, fetchPe, fetchFmtqikMonth, fetchTaiexRange, rocToDate, num, enDateToIso };
