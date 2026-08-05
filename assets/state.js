/* ═══════════════════════════════════════════════════════════════════════
   assets/state.js — ap_state_v2:全站唯一的事實來源(S2)

   語意要求見 docs/SPEC.md §8.3;JSON 形狀是 S2 的設計自由,以下是決定的形狀:

     ap_state_v2 = {
       schemaVersion: 2,
       input:  { …24 個設定欄位…, w:{ key: 小數 } },   ← 型別已正名(數字/小數,不是字串)
       result: { …ap_report_v1 的全部欄位…, computedAt, inputHash },
       ui:     { adv:{ 展開器 id: true/false } },
       founding:{ chk1..chk4, updated },          ← 地基自測(唯一的家是 /start/ 的地基題)
       shared: { investTotalWan, updated, src },
       ladder: { rung:1..9, source, score, market, reasons, updated }  ← S8,風險階梯的落點
     }

   `wizard`(S3 的 {tier:'穩健',…})已被 `ladder` 取代;getLadder() 仍讀得懂舊記錄。

   ── 型別正名 ────────────────────────────────────────────────────────
   舊的 firePlanner_v1 全部存字串(因為直接抄 DOM `.value`),於是「2」到底是
   2% 還是 2 萬,只能靠讀取端自己記得。新版一律存數字,而且**比例存小數**
   (docs/SPEC.md §1.1):infl 0.02、swr 0.035、carry 0.03、權重 0.30。
   格式化回 % 是 UI 層的事,由下面的 FIELDS 表單一負責換算。

   ── 為什麼還要同步寫回舊鍵 ──────────────────────────────────────────
   S2 的理由是「五頁的讀取端還沒改完」。**那個理由 S6 之後已經不成立** ——
   S7 逐頁確認過:六頁的 HTML 裡再也沒有一處直接讀這四個舊鍵,只剩註解提到它們。

   **S7 的決定:鏡射保留,但理由換成另一個。**
   本站部署在 GitHub Pages,沒有 service worker,但瀏覽器**會快取舊的 HTML**。
   一個剛用新版排完計畫的人,只要在快取過期前打開一個還是舊版的分頁(自己的另一個
   視窗、別人傳的連結、fork 出去的站),那份舊 HTML 讀的就是舊鍵 —— 鏡射一拿掉,
   他看到的是一份空計畫。每次存檔多寫 4 個鍵約 10KB(localStorage 有 5MB),
   代價幾乎是零,而「使用者以為資料不見了」是最傷信任的一種 bug。

   **什麼時候可以真的拿掉**:確認站台上線超過一個瀏覽器快取週期、
   且沒有任何 fork 還在讀舊鍵之後。拿掉時只刪 save() 裡的 4 行鏡射,
   **不要動遷移**(遷移是「讀得懂舊資料」,鏡射是「繼續產生舊資料」,兩件事)。

   鏡射的四個鍵:firePlanner_v1、ap_founding_v1、ap_report_v1、ap_shared_v1。
   (ap_wizard_v1 不在內 —— S3 之後精靈直接寫 v2 並轉址 /plan-result/,那條路徑整條退役。)

   ── 不搬家的兩組舊鍵(刻意)────────────────────────────────────────
   firePlanner_snapshots_v1(快照陣列,上限 20)與 2x.*(挑時機的本頁設定)
   **留在原地**。它們是單一頁面自己的資料、格式已經穩定,搬進 v2 只會多一層
   轉換風險。「不能掉資料」的要求由「不動它們」滿足。
   ═══════════════════════════════════════════════════════════════════════ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.APState = factory();
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this), function () {
'use strict';

const KEY      = 'ap_state_v2';
const K_PLAN   = 'firePlanner_v1';
const K_SNAP   = 'firePlanner_snapshots_v1';
const K_SHARED = 'ap_shared_v1';
const K_FOUND  = 'ap_founding_v1';
const K_REPORT = 'ap_report_v1';
const SCHEMA   = 2;

// 無痕模式 / 空間不足時 localStorage 會 throw。全站一律不讓它炸到呼叫端。
function lsGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
function lsSet(k,v){ try{ localStorage.setItem(k,v); return true; }catch(e){ return false; } }
function lsJSON(k){ try{ const r=localStorage.getItem(k); return r?JSON.parse(r):null; }catch(e){ return null; } }
const today = () => new Date().toISOString().slice(0,10);

/* ── 欄位表:DOM 表單 ↔ ap_state_v2.input 的單一真相 ────────────────
   順序刻意與舊的 LS_IDS 一致(前 24 欄),新欄位一律**加在最後** ——
   中間插欄會改動所有既有存檔的鏡射順序,沒有好處。
   kind: 'num' 原樣數字 | 'int' 取整 | 'pct' 表單填 % → state 存小數 | 'str' 字串 */
const FIELDS = [
  {id:'age',       key:'age',       kind:'int', def:35},
  {id:'retire',    key:'retire',    kind:'int', def:65},
  {id:'net',       key:'net',       kind:'num', def:50},
  {id:'mon',       key:'mon',       kind:'num', def:3},
  /* exp = **退休後**一年生活費(萬/年)。名字看不出來,但它只在退休後生效:
     buildFlowSchedule 把它排成 s:'ret' → e:'max' 的「基本生活費」,
     還決定 withdraw 與 fireNum。key 名稱不改(改了要動所有既有存檔的遷移路徑),
     改的是 UI 標籤 —— /plan/ 原本標「目前一年生活費」是錯的。 */
  {id:'exp',       key:'exp',       kind:'num', def:35},
  {id:'pension',   key:'pension',   kind:'num', def:0},
  {id:'infl',      key:'infl',      kind:'pct', def:0.02},
  {id:'swr',       key:'swr',       kind:'pct', def:0.035},
  {id:'dispmode',  key:'dispmode',  kind:'str', def:'real'},
  {id:'dcaMonths', key:'dcaMonths', kind:'int', def:0},
  {id:'glide',     key:'glide',     kind:'int', def:0},
  {id:'glideStart',key:'glideStart',kind:'int', def:45},
  {id:'mech',      key:'mech',      kind:'str', def:'both'},
  {id:'flexW',     key:'flexW',     kind:'int', def:0},
  {id:'engine',    key:'engine',    kind:'str', def:'param'},
  {id:'carry',     key:'carry',     kind:'pct', def:0.03},
  {id:'voldrag',   key:'voldrag',   kind:'pct', def:0.015},
  {id:'ssofin',    key:'ssofin',    kind:'pct', def:0.04},
  {id:'flows',     key:'flows',     kind:'str', def:''},
  {id:'floorA',    key:'floorA',    kind:'num', def:0},
  {id:'ceilA',     key:'ceilA',     kind:'num', def:0},
  {id:'abwHair',   key:'abwHair',   kind:'pct', def:0.01},
  {id:'abwTilt',   key:'abwTilt',   kind:'pct', def:0},
  {id:'bequest',   key:'bequest',   kind:'num', def:0},
  /* spendNow = **現在**一年生活費(萬/年)。**不進模擬**,只有兩個用途:
     ① /report/ 的緊急預備金建議(半年生活費)—— 那要蓋的是現在的開銷,不是退休後的;
     ② 精靈用它當「退休後要花多少」的錨點(預設一樣,使用者可以自己調)。
     改版前這兩件事都借用 exp,於是「緊急預備金 = 退休預算的一半」——
     一個把退休支出調低的人,他的緊急預備金建議會跟著變少,那是錯的。
     def:0 代表「沒填」,由 load() 退回 exp(見那裡的相容填值)。 */
  {id:'spendNow',  key:'spendNow',  kind:'num', def:0},
];
const FIELD_BY_ID = {}; FIELDS.forEach(f => FIELD_BY_ID[f.id] = f);
// 與 engine.js 的 ORDER 一致;這裡不 import engine,免得 state.js 綁死載入順序。
const WKEYS = ['TW50','L2','VT','VTI','VOO','QQQ','SSO','CASH','BOND','GOLD'];
const DEFAULT_W = {VT:0,VTI:0.33,VOO:0,TW50:0,QQQ:0,L2:0.30,SSO:0,CASH:0.37,BOND:0,GOLD:0};

/* 「結果過期」判斷刻意排除的欄位 —— 它們不影響任何運算,改了不該讓結果被判定過期。
   dispmode:只切實質/名目顯示(舊的 paramsHash() 就是這樣做的,是對的)。
   spendNow:只用來估緊急預備金與當精靈的錨點,一行都沒進 deriveOpts。
   ⚠ 少排除一個,使用者會看到莫名其妙的「設定改過了」橫幅;多排除一個,
     真正改了口徑的結果會被當成沒過期 —— 兩邊都不能亂加。 */
const HASH_SKIP = {dispmode:1, spendNow:1};

/* ── 字串 ↔ 型別 ──────────────────────────────────────────────── */
function parseField(f, raw){
  if (raw == null || raw === '') return f.kind === 'str' ? f.def : f.def;
  if (f.kind === 'str') return String(raw);
  const n = Number(raw);
  if (!isFinite(n)) return f.def;
  if (f.kind === 'int') return Math.round(n);
  if (f.kind === 'pct') return n / 100;
  return n;
}
// 回表單時的字串形式。pct 用 toFixed 之後再去掉尾隨的 0,
// 否則 0.035*100 會變成 3.5000000000000004,直接灌進 <input> 很難看。
function formatField(f, v){
  if (f.kind === 'str') return String(v == null ? f.def : v);
  let n = Number(v);
  if (!isFinite(n)) n = f.def;
  if (f.kind === 'pct') n = n * 100;
  return String(Math.round(n * 1e6) / 1e6);
}

function defaults(){
  const input = {};
  FIELDS.forEach(f => input[f.key] = f.def);
  input.w = Object.assign({}, DEFAULT_W);
  return {
    schemaVersion: SCHEMA,
    input,
    result: null,
    ui: {adv:{}},
    founding: null,
    shared: null,
    ladder: null,
    wizard: null,   // S3 的舊欄位,只為了讓 getLadder() 讀得懂舊存檔;新資料一律寫 ladder
  };
}

/* ── 一次性遷移:QLD → SSO(V2 起美股槓桿改用 SSO)──────────────────
   舊存檔的 key 若沒對應元素,loadSettings/applyParams 會「靜默忽略」——
   使用者存的 20~50% 槓桿部位會無聲消失、權重被自動正規化,他不會發現。
   這就是為什麼要有這張表。**重構中不准弄丟。** */
const KEY_MIGRATIONS = {qldfin:'ssofin', n_QLD:'n_SSO'};
let _migHit = false;
function migrateParams(s){
  if (!s || typeof s !== 'object') return s;
  for (const oldK in KEY_MIGRATIONS){
    const nk = KEY_MIGRATIONS[oldK];
    if (s[oldK] != null){ if (s[nk] == null){ s[nk] = s[oldK]; _migHit = true; } delete s[oldK]; }
  }
  return migrateValues(s);
}
// 值層級的修正(鍵名沒變、但值的格式或合法範圍變了)。KEY_MIGRATIONS 只能改名,做不到這個。
function migrateValues(s){
  // flows 字串一律要有版本前綴;沒有就當作最早的 v1 補上,之後改格式才知道怎麼升。
  if (typeof s.flows === 'string' && s.flows && !/^\d+\|/.test(s.flows)) s.flows = '1|' + s.flows;
  return s;
}

/* ── 舊的 firePlanner_v1(全字串)→ 型別化的 input ───────────────── */
function inputFromLegacy(raw){
  const s = migrateParams(Object.assign({}, raw));
  const input = {};
  FIELDS.forEach(f => input[f.key] = parseField(f, s[f.id]));
  const w = {};
  WKEYS.forEach(k => {
    const v = s['n_' + k];
    // 舊存檔沒有這個鍵 → 用預設權重,不是歸零。
    // 這是**刻意對齊舊行為**:改版前 buildWeights() 先把每格填成 DEFAULT_W,
    // loadSettings() 才用存檔覆寫「有出現的鍵」—— 沒出現的那格就停在 DEFAULT_W。
    // 改成歸零會讓一份更舊的存檔(欄位比較少)在升級後靜靜換掉配置,那正是要避免的事。
    w[k] = (v == null || v === '') ? (DEFAULT_W[k] || 0) : (Number(v) || 0) / 100;
  });
  input.w = w;
  return input;
}
/* ── input → 舊的 firePlanner_v1 形狀(鏡射寫回用)───────────────── */
function legacyFromInput(input){
  const s = {};
  FIELDS.forEach(f => s[f.id] = formatField(f, input[f.key]));
  WKEYS.forEach(k => s['n_' + k] = String(Math.round(((input.w && input.w[k]) || 0) * 100 * 1e6) / 1e6));
  return s;
}

/* ── 輸入雜湊:任何一頁都能判斷「這份結果是不是這份輸入算的」────────
   舊版 paramsHash 只在 /plan/ 的比較分頁裡用;SPEC §8.3 要求把它推廣到跨頁。 */
function inputHash(input){
  const parts = [];
  FIELDS.forEach(f => { if (!HASH_SKIP[f.key]) parts.push(f.key + '=' + input[f.key]); });
  WKEYS.forEach(k => parts.push(k + '=' + ((input.w && input.w[k]) || 0)));
  const str = parts.join('|');
  // FNV-1a,32 位。這裡只要「輸入變了 hash 就變」,不需要抗碰撞。
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++){ h ^= str.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
  return h.toString(36) + '.' + str.length.toString(36);
}

/* ── 載入(含首次遷移)────────────────────────────────────────── */
let _state = null;
let _migratedThisLoad = false;

function migrateLegacyInto(st){
  let touched = false;
  const plan = lsJSON(K_PLAN);
  if (plan && typeof plan === 'object'){ st.input = inputFromLegacy(plan); touched = true; }
  const found = lsJSON(K_FOUND);
  if (found && typeof found === 'object'){ st.founding = found; touched = true; }
  const shared = lsJSON(K_SHARED);
  if (shared && typeof shared === 'object'){ st.shared = shared; touched = true; }
  const rep = lsJSON(K_REPORT);
  if (rep && rep.in){
    // 舊的 ap_report_v1 沒有 inputHash —— 一律當成「過期」,因為無法證明它是這份 input 算的。
    // 這是刻意保守:寧可讓使用者按一次重算,也不要印出對不上設定的數字。
    st.result = Object.assign({}, rep, {computedAt: rep.updated || null, inputHash: null});
    touched = true;
  }
  return touched;
}

/* 新欄位的相容填值 —— 舊存檔沒有的欄位,要退回「與改版前完全相同」的行為,
   不是退回欄位的靜態預設值。兩條載入路徑(既有 v2、從舊鍵遷移)都要走。
   `spendNow`:改版前「現在的年支出」與「退休後年支出」是同一個數字(exp),
   所以沒填時就等於 exp —— 既有使用者的緊急預備金建議一塊錢都不會變。 */
function fillNewFields(input){
  if (!input) return input;
  if (!(+input.spendNow > 0)) input.spendNow = +input.exp || 0;
  return input;
}

function load(){
  if (_state) return _state;
  const cur = lsJSON(KEY);
  if (cur && cur.schemaVersion === SCHEMA && cur.input){
    _state = cur;
    if (!_state.ui) _state.ui = {adv:{}};
    if (!_state.ui.adv) _state.ui.adv = {};
    if (!_state.input.w) _state.input.w = Object.assign({}, DEFAULT_W);
    fillNewFields(_state.input);
    return _state;
  }
  // 沒有 v2(第一次載入這一版)→ 從六組舊鍵遷移。
  _state = defaults();
  _migratedThisLoad = migrateLegacyInto(_state);
  fillNewFields(_state.input);
  if (_migratedThisLoad) save();   // 立刻落地,下次不必再遷一次
  return _state;
}

/* ── 寫入(v2 + 鏡射舊鍵)────────────────────────────────────── */
function save(){
  const st = _state || (_state = defaults());
  st.schemaVersion = SCHEMA;
  lsSet(KEY, JSON.stringify(st));
  // ── 鏡射舊鍵:給「瀏覽器還快取著舊版 HTML」的人用。理由與拿掉的條件見檔頭。 ──
  lsSet(K_PLAN, JSON.stringify(legacyFromInput(st.input)));
  if (st.founding) lsSet(K_FOUND, JSON.stringify(st.founding));
  if (st.result)   lsSet(K_REPORT, JSON.stringify(st.result));
  if (st.shared)   lsSet(K_SHARED, JSON.stringify(st.shared));
  return st;
}

function getInput(){ return load().input; }
function setInput(input){
  const st = load();
  st.input = input;
  // 跨工具共享鍵:同站台的「② 挑時機」拿 investTotalWan 當「總資金」的預設值。
  // 只放這一個數字 —— 其餘資料各自留在自己的鍵裡,互不干擾。
  const n = Number(input.net);
  if (isFinite(n) && n > 0) st.shared = {investTotalWan:n, updated:today(), src:'plan'};
  return save();
}
function patchInput(partial){
  const st = load();
  st.input = Object.assign({}, st.input, partial);
  if (partial.w) st.input.w = Object.assign({}, st.input.w, partial.w);
  return setInput(st.input);
}

function setResult(result){
  const st = load();
  st.result = Object.assign({}, result, {
    computedAt: new Date().toISOString().slice(0,19),
    inputHash: inputHash(st.input),
  });
  return save();
}
function getResult(){ return load().result; }
/* 結果過期 = 「這份結果不是這份輸入算的」。
   各頁的反應不同(docs/IA.md §6.2):/plan-result/ 自己重算、/report/ 拒印、/plan/ 只亮橘點。 */
function isStale(){
  const st = load();
  if (!st.result) return true;
  if (!st.result.inputHash) return true;      // 從舊的 ap_report_v1 遷過來的,無從證明
  return st.result.inputHash !== inputHash(st.input);
}
/* 「證明得了它過期」——雜湊真的對不上,不是「沒有雜湊所以不知道」。
   兩者要分開:/plan-result/ 不確定就自己重算(便宜、使用者無感),
   但 /report/ 是拿來嚇人的橫幅,對剛升上來的舊使用者亮一次假警報,代價比較大。 */
function isProvablyStale(){
  const st = load();
  return !!(st.result && st.result.inputHash && st.result.inputHash !== inputHash(st.input));
}

function getFounding(){ return load().founding; }
function setFounding(obj){
  const st = load();
  st.founding = Object.assign({}, obj, {updated: today()});
  return save();
}

/* ── 風險階梯的落點(S8;取代 S3 的 wizard)──────────────────────────
   {rung:1..9, source:'wizard'|'manual'|'legacy', score, market, reasons, tier?, updated}

   S3 存的是 {tier:'穩健'} 這種字串,只夠 /plan-result/ 印一句「風險測驗 5/9 → 穩健型」。
   S8 把三套風險等級合併成一條九階的梯子(assets/engine.js 的 LADDER),於是這裡要存的
   變成**梯子上的位置**:/timing/ 靠它預選 profile、/plan-result/ 靠它講「為什麼是這個比例」。

   為什麼不放進 input:它不是模擬參數,放進去會讓 inputHash 變動 —— 使用者在
   /plan/ 把權重調回一模一樣,結果卻被判定成「過期」。(S3 就是這個理由,S8 沿用。)

   **rung 是輔助資訊,不是真相。** 真相永遠是 input.w。使用者在 /plan/ 手動改權重之後
   兩者會脫鉤,那時讀取端要自己用淨曝險回推最接近的一階並標示「你已自訂配置」。
   回推邏輯放在讀取端而不是這裡 —— state.js 刻意不 import engine(見 WKEYS 上方的註解),
   而回推需要 LADDER。

   刻意不鏡射回舊鍵 —— 舊版沒有對應的東西,寫過去只會變成沒人讀的垃圾。 */
function getLadder(){
  const st = load();
  if (st.ladder) return st.ladder;
  // S3 的 wizard 記錄 → 讀得懂,但**不猜 rung**。
  // 舊的三檔(保守/穩健/積極)與新的九階不是一對一,硬對一個數字過去,
  // 使用者會看到一個沒人算過的等級。留 null,讓讀取端用淨曝險回推 —— 那條路本來就要有。
  const w = st.wizard;
  if (w) return {rung:null, source:'legacy', tier:w.tier, score:w.score,
                 market:w.market, reasons:w.reasons, updated:w.updated};
  return null;
}
function setLadder(obj){
  const st = load();
  st.ladder = obj ? Object.assign({}, obj, {updated: today()}) : null;
  if (st.ladder) st.wizard = null;   // 遷移完就不留兩份
  return save();
}

/* 進階展開器的收合狀態(docs/IA.md §4.2)。天天用的人不該每天再展開一次同一段。 */
function getAdv(id){ const a = load().ui.adv; return a ? a[id] : undefined; }
function setAdv(id, open){ const st = load(); st.ui.adv[id] = !!open; save(); }

/* 「② 挑時機」的總資金優先序(docs/SPEC.md §8.3):
   本頁自己存過的 2x.capital > ap_state_v2 的可投資資產 > 預設 100。
   使用者一動 capIn 就以本頁為準,之後不再被覆寫 —— 這個順序不能改。 */
function investTotal(){
  const own = Number(lsGet('2x.capital'));
  if (isFinite(own) && own > 0) return own;
  const st = load();
  const n = Number(st.input && st.input.net);
  if (isFinite(n) && n > 0) return n;
  const sh = st.shared && Number(st.shared.investTotalWan);
  if (isFinite(sh) && sh > 0) return sh;
  return 100;
}

return {
  KEY, SCHEMA, FIELDS, FIELD_BY_ID, WKEYS, DEFAULT_W, KEY_MIGRATIONS, HASH_SKIP,
  LEGACY_KEYS: {plan:K_PLAN, snapshots:K_SNAP, shared:K_SHARED, founding:K_FOUND, report:K_REPORT},
  defaults, load, save,
  getInput, setInput, patchInput,
  getResult, setResult, isStale, isProvablyStale, inputHash,
  getFounding, setFounding,
  getLadder, setLadder,
  getAdv, setAdv,
  investTotal,
  parseField, formatField, inputFromLegacy, legacyFromInput,
  migrateParams, migrateValues,
  // /plan/ 用它決定要不要顯示「你存的 QLD 已改成 SSO」那條一次性提示
  get migrationHit(){ return _migHit; },
  get migratedFromLegacy(){ return _migratedThisLoad; },
};
});
