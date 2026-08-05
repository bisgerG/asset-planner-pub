/* ═══════════════════════════════════════════════════════════════════════
   assets/charts.js — 共用圖表(S11)

   只放兩個 canvas 函式:band(資產成長機率帶)與 donut(配置甜甜圈)。
   改版前同一張機率帶圖有兩份手寫實作(/plan/ drawChart、/report/ drawBand),
   已經開始漂移(退休線一份用 --warn 一份沒畫)——這裡收成單一來源。
   比例條/迷你階梯**不在**這裡:那些是 ui.css 的 .ap-bar(HTML/CSS,
   可列印、可讀屏、零 DPR 成本),canvas 版是過度工程。

   純繪圖約定:零狀態存取、不 import engine、不碰 localStorage;
   資料(result.band)、色彩(E.ASSET_COLOR)、格式(wan)全部由呼叫端傳入。

   視覺規格(依 docs/IA.md §4.3 色彩語彙):
   - 機率帶單一色相(navy):p10–p90 淡填、p50 實線、邊線半透明。
     p10 **不上紅** —— 它是分布的一端,不是警告狀態。
   - 退休年齡垂直虛線用 --core(規則水位)。/report/ 舊版誤用 --warn(橘),
     這裡依語彙表修正 —— 退休年齡是規則,不是風險。
   - 線的身分用**右端直接標籤**,不用圖例;文字一律 ink/muted,不穿系列色。
   ═══════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

const NAVY = '#16255c', CORE = '#1b4b8f', INK = '#1b2333',
      MUTED = '#5b6478', GRID = '#eef1f6', AXIS = '#8a90a0';
const FONT = '"Noto Sans TC","PingFang TC","Microsoft JhengHei",system-ui,sans-serif';

/* 預設的萬/億格式。呼叫端幾乎都有自己的 wan()(口徑一致),請優先傳進來。 */
function fmtWan(v) {
  if (!isFinite(v)) return '—';
  if (v >= 10000) return (v / 10000).toFixed(v >= 100000 ? 0 : 1) + '億';
  return Math.round(v).toLocaleString('zh-TW') + '萬';
}

/* 對數刻度的 y 軸格線值:1/2/5 × 10^e,太多時退到只留 10 的冪。 */
function logTicks(lo, hi) {
  const out = [];
  const e0 = Math.floor(Math.log10(lo)), e1 = Math.ceil(Math.log10(hi));
  for (let e = e0; e <= e1; e++) [1, 2, 5].forEach(m => {
    const v = m * Math.pow(10, e);
    if (v >= lo && v <= hi) out.push(v);
  });
  if (out.length > 6) {
    const pow = out.filter(v => /^10*$/.test(String(v)));
    return pow.length >= 2 ? pow : out.filter((_, i) => i % 2 === 0);
  }
  return out;
}

/* ── 資產成長機率帶 ──────────────────────────────────────────────────
   band(canvas, B, opts) → boolean(false = 資料不足,呼叫端整段不畫)

   B    = result.band 形狀 {ages:[], p10:[], p50:[], p90:[]}(單位:萬)
   opts = {
     retireAge : Number|null   退休年齡垂直虛線(--core)
     target    : Number|null   目標金額水平虛線 + 「目標 X」標籤(--core)
     fmt       : v=>String     金額格式(預設內建萬/億)
     labels    : {p50,p10,p90} 右端直接標籤(預設 普通情境/壞情境/好情境)
     probe     : Element|null  讀數容器;給了就綁 pointer → 逐年讀數 + 十字線
     height    : Number        CSS px,預設 190
   }
   同一 canvas 重複呼叫安全:會先解除上一次的監聽再重綁。 */
function band(cv, B, opts) {
  if (!cv || !B || !B.ages || !B.p10 || !B.p50 || !B.p90) return false;
  const n = B.ages.length;
  if (n < 2 || B.p10.length !== n || B.p50.length !== n || B.p90.length !== n) return false;

  const o = opts || {};
  const H = o.height || 190;
  const fmt = o.fmt || fmtWan;
  const LB = Object.assign({ p50: '普通情境', p10: '壞情境', p90: '好情境' }, o.labels || {});

  // 值域(對數)。p10 可能觸 0(壞路徑花光)——夾到 1 萬,對數刻度下視覺上就是「貼地」。
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) {
    const a = B.p10[i], b = B.p90[i];
    if (isFinite(a) && a > 0) lo = Math.min(lo, a);
    if (isFinite(b) && b > 0) hi = Math.max(hi, b);
  }
  if (!isFinite(lo) || !isFinite(hi) || hi <= 0) return false;
  lo = Math.max(1, lo * 0.8); hi = hi * 1.15;
  if (lo >= hi) lo = hi / 10;
  const l0 = Math.log10(lo), l1 = Math.log10(hi);

  // 舊呼叫殘留的監聽先拆掉(重算後整頁重繪會再進來一次)
  if (cv.__apBandCleanup) { try { cv.__apBandCleanup(); } catch (e) {} }

  let hoverI = -1;
  let geo = null;   // 最近一次 draw() 的繪圖區 {ml,pw},給 probe 換算索引用

  function draw() {
    const dpr = root.devicePixelRatio || 1;
    const W = cv.clientWidth || (cv.parentNode && cv.parentNode.clientWidth) || 640;
    cv.width = W * dpr; cv.height = H * dpr;
    cv.style.height = H + 'px';
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    c.font = '11px ' + FONT;

    // 右緣留給三條線的直接標籤(量最寬的那個字串)
    const labelW = Math.max(c.measureText(LB.p50).width,
                            c.measureText(LB.p10).width,
                            c.measureText(LB.p90).width);
    const ticks = logTicks(lo, hi);
    c.font = '10px ' + FONT;
    const yLabW = ticks.reduce((m, v) => Math.max(m, c.measureText(fmt(v)).width), 0);
    const ml = Math.ceil(yLabW) + 8, mr = Math.ceil(labelW) + 10, mt = 8, mb = 20;
    const pw = W - ml - mr, ph = H - mt - mb;
    if (pw < 60) { geo = null; return; }   // 容器過窄(收合中的 details)——等展開重繪
    geo = { ml, pw };

    const xs = i => ml + i / (n - 1) * pw;
    const ys = v => mt + (1 - (Math.log10(Math.max(v, lo)) - l0) / (l1 - l0)) * ph;

    // 格線(退隱)+ y 標籤
    c.strokeStyle = GRID; c.fillStyle = AXIS; c.lineWidth = 1;
    ticks.forEach(v => {
      const y = ys(v);
      c.beginPath(); c.moveTo(ml, y); c.lineTo(ml + pw, y); c.stroke();
      c.fillText(fmt(v), ml - 6 - c.measureText(fmt(v)).width, y + 3);
    });

    // x 標籤:每 10 歲一個
    c.textAlign = 'center';
    for (let i = 0; i < n; i++) {
      if (B.ages[i] % 10 === 0) c.fillText(B.ages[i] + '歲', xs(i), H - 6);
    }
    c.textAlign = 'left';

    // 目標水平虛線(--core:規則,不是損益)
    if (o.target != null && isFinite(o.target) && o.target > lo && o.target < hi) {
      const y = ys(o.target);
      c.strokeStyle = CORE; c.setLineDash([4, 3]); c.lineWidth = 1;
      c.beginPath(); c.moveTo(ml, y); c.lineTo(ml + pw, y); c.stroke(); c.setLineDash([]);
      c.fillStyle = CORE; c.font = '10px ' + FONT;
      c.fillText('目標 ' + fmt(o.target), ml + 4, y - 4);
    }

    // 退休年齡垂直虛線(--core)
    const ri = o.retireAge != null ? B.ages.indexOf(o.retireAge) : -1;
    if (ri >= 0) {
      c.strokeStyle = CORE; c.setLineDash([4, 3]); c.lineWidth = 1;
      c.beginPath(); c.moveTo(xs(ri), mt); c.lineTo(xs(ri), mt + ph); c.stroke(); c.setLineDash([]);
      c.fillStyle = MUTED; c.font = '10px ' + FONT;
      const t = '退休';
      const tx = Math.min(xs(ri) + 4, ml + pw - c.measureText(t).width);
      c.fillText(t, tx, mt + 10);
    }

    // p10–p90 帶(單一色相淡填)
    c.fillStyle = 'rgba(22,37,92,.10)';
    c.beginPath();
    for (let i = 0; i < n; i++) { const y = ys(B.p90[i]); i ? c.lineTo(xs(i), y) : c.moveTo(xs(i), y); }
    for (let i = n - 1; i >= 0; i--) c.lineTo(xs(i), ys(B.p10[i]));
    c.closePath(); c.fill();

    // 邊線(半透明細線)與中位實線
    c.strokeStyle = 'rgba(22,37,92,.4)'; c.lineWidth = 1;
    [B.p90, B.p10].forEach(arr => {
      c.beginPath();
      for (let i = 0; i < n; i++) { const y = ys(arr[i]); i ? c.lineTo(xs(i), y) : c.moveTo(xs(i), y); }
      c.stroke();
    });
    c.strokeStyle = NAVY; c.lineWidth = 2;
    c.beginPath();
    for (let i = 0; i < n; i++) { const y = ys(B.p50[i]); i ? c.lineTo(xs(i), y) : c.moveTo(xs(i), y); }
    c.stroke();

    // 十字線(probe 懸停中)
    if (hoverI >= 0 && hoverI < n) {
      c.strokeStyle = 'rgba(27,75,143,.45)'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(xs(hoverI), mt); c.lineTo(xs(hoverI), mt + ph); c.stroke();
      c.fillStyle = NAVY;
      [B.p50[hoverI]].forEach(v => {
        c.beginPath(); c.arc(xs(hoverI), ys(v), 3, 0, 2 * Math.PI); c.fill();
      });
    }

    // 右端直接標籤(取代圖例;文字不穿系列色 —— p50 用 ink 粗體,其餘 muted)
    c.font = '11px ' + FONT;
    const ends = [
      { y: ys(B.p90[n - 1]), text: LB.p90, ink: MUTED, bold: false },
      { y: ys(B.p50[n - 1]), text: LB.p50, ink: INK,   bold: true  },
      { y: ys(B.p10[n - 1]), text: LB.p10, ink: MUTED, bold: false },
    ].sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) {
      if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13;
    }
    ends.forEach(e => {
      c.font = (e.bold ? '700 ' : '') + '11px ' + FONT;
      c.fillStyle = e.ink;
      c.fillText(e.text, ml + pw + 6, Math.max(mt + 8, Math.min(e.y + 4, mt + ph)));
    });
  }

  draw();

  // ── 互動:讀數列(probe)+ 十字線 ─────────────────────────────
  const cleanups = [];
  if (o.probe) {
    const probe = o.probe;
    const hint = '(手指或滑鼠放在圖上,看逐年數字)';
    probe.textContent = hint;
    const move = ev => {
      if (!geo) return;
      const r = cv.getBoundingClientRect();
      const frac = (ev.clientX - r.left - geo.ml) / Math.max(1, geo.pw);
      const i = Math.max(0, Math.min(n - 1, Math.round(frac * (n - 1))));
      if (i !== hoverI) {
        hoverI = i; draw();
        probe.textContent = B.ages[i] + '歲:' + LB.p50 + ' ' + fmt(B.p50[i])
          + '・' + LB.p10 + ' ' + fmt(B.p10[i]) + '・' + LB.p90 + ' ' + fmt(B.p90[i]);
      }
    };
    const leave = () => { hoverI = -1; draw(); probe.textContent = hint; };
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerdown', move);
    cv.addEventListener('pointerleave', leave);
    cleanups.push(() => {
      cv.removeEventListener('pointermove', move);
      cv.removeEventListener('pointerdown', move);
      cv.removeEventListener('pointerleave', leave);
    });
  }

  // 容器變寬(視窗縮放、details 展開)就重繪。
  // 只在寬度真的變了才畫 —— draw() 會動 canvas 屬性,無條件重繪有回饋迴圈風險。
  if (typeof ResizeObserver !== 'undefined') {
    let lastW = cv.clientWidth;
    const ro = new ResizeObserver(() => {
      const w = cv.clientWidth;
      if (w !== lastW) { lastW = w; draw(); }
    });
    ro.observe(cv.parentNode || cv);
    cleanups.push(() => ro.disconnect());
  } else {
    const onR = () => draw();
    root.addEventListener('resize', onR);
    cleanups.push(() => root.removeEventListener('resize', onR));
  }
  cv.__apBandCleanup = () => cleanups.forEach(f => f());

  return true;
}

/* ── 配置甜甜圈 ──────────────────────────────────────────────────────
   donut(canvas, segments, opts)
   segments = [{key, value, color, label}](value 為 0~1 權重;color 由呼叫端
   傳 E.ASSET_COLOR[k] —— 全站同一份,已通過白底 3:1 與相鄰色盲分離驗證)
   opts = {size:148, hole:.58}
   圖例在旁邊的 HTML 表格裡,圓餅本身不寫字(小螢幕字會疊)。
   相鄰扇形之間畫 2px 表面色縫(單一扇形時不畫,免得多一道孤縫)。 */
function donut(cv, segments, opts) {
  if (!cv || !segments) return;
  const o = opts || {};
  const S = o.size || 148, hole = o.hole == null ? 0.58 : o.hole;
  const dpr = root.devicePixelRatio || 1;
  cv.width = S * dpr; cv.height = S * dpr;
  cv.style.width = S + 'px'; cv.style.height = S + 'px';
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, S, S);

  const segs = segments.filter(s => s && s.value > 0);
  const total = segs.reduce((m, s) => m + s.value, 0);
  if (!total) return;

  const cx = S / 2, cy = S / 2, rO = S / 2 - 2, rI = rO * hole;
  let a0 = -Math.PI / 2;
  const bounds = [];
  segs.forEach(s => {
    const a1 = a0 + (s.value / total) * 2 * Math.PI;
    c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, rO, a0, a1); c.closePath();
    c.fillStyle = s.color || '#888'; c.fill();
    bounds.push(a0);
    a0 = a1;
  });

  // 2px 表面色縫(mark spacer)。單一扇形時跳過。
  if (segs.length > 1) {
    c.strokeStyle = '#fff'; c.lineWidth = 2;
    bounds.forEach(a => {
      c.beginPath(); c.moveTo(cx, cy);
      c.lineTo(cx + Math.cos(a) * rO, cy + Math.sin(a) * rO); c.stroke();
    });
  }

  // 中空
  c.beginPath(); c.arc(cx, cy, rI, 0, 2 * Math.PI);
  c.fillStyle = '#fff'; c.fill();
}

root.APCharts = { band, donut };
})(typeof window !== 'undefined' ? window : this);
