/* ═══════════════════════════════════════════════════════════════════════
   assets/engine.js — 資產規劃引擎(純函式,零 DOM)

   S2 從 plan/index.html 的 <script> 原封不動搬出來。**數學一行都沒有改。**
   已知的 17 項口徑不一致(docs/SPEC.md §10 的 C1–C17)全部留在原地,
   由 S5/S7 統一處理 —— 搬家與改口徑分兩次做,否則出事時分不清是誰弄壞的。

   為什麼要抽出來(docs/IA.md §8):
   ① /plan-result/(S4)必須自己會算,不能等使用者先去 /plan/ 按過「開始計算」;
   ② 測試腳本本來要用正則從 HTML 切 <script>、再砍掉 `buildWeights();` 之後的初始化 ——
      那個字串一改測試就無聲失效。改成 require 這支檔案之後,那一環拿掉了。

   同時支援瀏覽器 <script src> 與 Node require:
     瀏覽器 → window.APEngine
     Node   → require('../../assets/engine.js')

   單位慣例(docs/SPEC.md §1.1):金額=萬元、比例=小數(0.07)、年齡=整數歲、時間步=月。
   引擎全程跑「實質」(今天的購買力);名目只是顯示層的換算。
   ═══════════════════════════════════════════════════════════════════════ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.APEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this), function () {
'use strict';

// ---------- 數值工具 ----------
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

/* ── 可重現的隨機源(docs/SPEC.md §1.4 / 差異 C14)────────────────────
   simulate() 收到 opts.seed 時改用 mulberry32,同一顆 seed 逐位元可重現;
   沒傳 seed 就是 Math.random(),**UI 行為與改版前完全一樣**。
   四支測試腳本傳固定 seed 之後,golden.json 才有意義(S7 的前置條件)。

   三個抽樣函式都吃一個可選的 rand 參數而不是讀模組層變數 —— 模組層變數會讓
   兩個同時進行的 simulate() 互相汙染(比較分頁一次跑三組),而且沒有辦法測。 */
function mulberry32(a){
  a = a >>> 0;
  return function(){
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// seed 可以是數字或字串(字串走 FNV-1a,與 state.js 的 inputHash 同一套)
function seedRand(seed){
  if (seed == null) return Math.random;
  let h;
  if (typeof seed === 'number' && isFinite(seed)) h = Math.floor(seed) >>> 0;
  else { const s = String(seed); h = 0x811c9dc5; for (let i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; } }
  return mulberry32(h || 1);
}
function randn(rand){const R=rand||Math.random;let u=0,v=0;while(u===0)u=R();while(v===0)v=R();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);}
// Student-t (df) normalised to unit variance
function studentT(df,rand){const R=rand||Math.random;let chi=0;for(let i=0;i<df;i++){const z=randn(R);chi+=z*z;}const t=randn(R)/Math.sqrt(chi/df);return t/Math.sqrt(df/(df-2));}

// ---------- 標的 ----------
// muNom: 名目幾何年化基準; sigma: 年化波動; rho: 與市場因子相關
// 正二/SSO 基準 = 2×標的 − 波動耗損(volDrag,可調)− 內扣 − 逆價差(carryDrag,可調)/融資(ssoFin)

// 三個成本假設的預設值 —— 與 /plan/ 三支滑桿的 HTML 預設一致(SPEC §2.2)。
// 抽成模組之後不能再靠 getVolDrag()/getFin() 讀 DOM,所以預設值要有一個明確的家。
const DEFAULTS = { carryDrag: 0.03, volDrag: 0.015, ssoFin: 0.04 };

// ── 槓桿標的的單一真相 ─────────────────────────────────────
// 倍率、內扣、吃哪種成本拖累(逆價差 vs 融資)只寫這一次。
// 新增/移除槓桿標的只改這張表 —— 曾散落在 7 個三元判斷 + 3 份內扣硬編碼。
const LEV = {
  // er = 內扣費用。台股正二在 2026-08 由 00631L 換成 00685L(見 assetDefs().L2 的說明),
  // 內扣跟著從 1.16%(元大)換成 0.48%(群益)—— 四檔台股正二裡最低的一檔。
  L2:  {mult:2, er:0.0048, drag:'carry'},   // 台指期逆價差
  SSO: {mult:2, er:0.0089, drag:'fin'  },   // SWAP 融資成本(每日 2 倍 S&P500)
};
const isLev = k => !!LEV[k];
/* 淨曝險倍率。**定義是 beta**(「大盤動 1 元,你這份錢會動幾元」),不是「總風險」。
   ── S8 修正:BOND 從 0.3 改成 0 ────────────────────────────────────
   0.3 這個值與模擬本身矛盾。單因子模型裡每個標的的因子載荷是 sigma × rho:
       TW50 = 0.21 × 0.80 = +0.168
       BOND = 0.06 × (−0.10) = −0.006      → 相對 TW50 的 beta = **−0.036**
   也就是說引擎在模擬時把債券當成 beta ≈ 0(甚至微負)的資產,畫面上卻收它 0.3 ——
   債重的組合因此被系統性高估曝險。S8 讓九階風險階梯全面改用債券當防禦部位,
   這個誤差會從「少數範本卡的小數點」變成「主線上每個人都看到的數字」,所以必須先修。
   **取 0 而不是 −0.036**:負的曝險貢獻要多一段解釋才講得清,而 3.6% 的差距
   不值得那段解釋;取 0 的方向也偏保守(略微高估曝險)。
   代價要寫明:債券自己的利率風險(σ=6%、歷史最大回撤 −17%)**不會**出現在淨曝險裡 ——
   淨曝險只量市場 beta。那份風險由旁邊的「回撤」欄位負責,兩個數字各有分工。 */
const levMult = k => (LEV[k] ? LEV[k].mult : (k === 'CASH' || k === 'BOND' ? 0 : 1));

// 依畫面順序排(台股→海外→防禦):圓餅/長條的鄰接順序=表單順序,
// 且兩支 2x 槓桿(L2/SSO)不相鄰 —— 10 色盤在白底的色盲分離靠這個排序才過得了關。
const ORDER = ['TW50','L2','VT','VTI','VOO','QQQ','SSO','CASH','BOND','GOLD'];
const LEV_KEYS = ORDER.filter(isLev);
const DEFAULT_W = {VT:0,VTI:33,VOO:0,TW50:0,QQQ:0,L2:30,SSO:0,CASH:37,BOND:0,GOLD:0};

function l2muNom(carryDrag, volDrag){
  if(carryDrag==null)carryDrag=DEFAULTS.carryDrag;
  if(volDrag==null)volDrag=DEFAULTS.volDrag;
  const muU=0.07;return 2*muU-volDrag-LEV.L2.er-carryDrag;
}
// SSO(美股2x,每日 2 倍 S&P500):無逆價差,改扣 SWAP 融資成本(≈美元短率)
function ssoMuNom(financing, volDrag){
  if(financing==null)financing=DEFAULTS.ssoFin;
  if(volDrag==null)volDrag=DEFAULTS.volDrag;
  const muU=0.07;return 2*muU-volDrag-LEV.SSO.er-financing;
}
function assetDefs(carryDrag, volDrag, ssoFin){
  if(carryDrag==null)carryDrag=DEFAULTS.carryDrag;
  if(volDrag==null)volDrag=DEFAULTS.volDrag;
  if(ssoFin==null)ssoFin=DEFAULTS.ssoFin;
  return {
    VT:  {name:'VT 全球股',muNom:0.065,sigma:0.16,rho:0.88},
    VTI: {name:'VTI 美股大盤',muNom:0.07,sigma:0.16,rho:0.85},
    VOO: {name:'VOO 標普500',muNom:0.07,sigma:0.16,rho:0.85},
    TW50:{name:'0050 台股大盤',muNom:0.07,sigma:0.21,rho:0.80},
    QQQ: {name:'QQQ 那斯達克100',muNom:0.08,sigma:0.22,rho:0.82},
    L2:  {name:'00685L 正二(台股2x)',muNom:l2muNom(carryDrag,volDrag),sigma:0.42,rho:0.80},
    SSO: {name:'SSO 標普500 2x',muNom:ssoMuNom(ssoFin,volDrag),sigma:0.32,rho:0.85},
    CASH:{name:'現金/短債(準備金)',muNom:0.015,sigma:0.01,rho:0.0},
    BOND:{name:'債券(後期)',muNom:0.04,sigma:0.06,rho:-0.10},
    GOLD:{name:'黃金(選配)',muNom:0.045,sigma:0.15,rho:0.10},
  };
}

/* ── 畫面用的標的資料(純資料,沒有 DOM)──────────────────────
   放在引擎裡是為了讓 /plan/、/plan-result/、/report/ 共用同一份名字與顏色。

   ⚠ `volHist` / `dd` 是**歷史實測值,引擎完全沒有用到**(差異 C4,S5 落地)。
   改版前這個欄位叫 `vol`,而 /plan/ 1.3 每一格顯示的就是它 —— 但拿去模擬的是
   assetDefs().sigma,兩者最多差 6 個百分點(SSO 顯示 38%、模擬 32%),
   畫面上卻沒有任何地方說這件事。改名成 volHist 是為了讓「拿錯」變成 undefined 而不是
   靜靜地顯示另一個數字;1.3 現在顯示 sigma,volHist 只當風險教育的參考欄位。

   role 是「ⓘ 理由」展開層的內容(可含 HTML)。S5 把原 tab4 觀念卡裡
   「為什麼用 SSO 不用 QLD」與「年輕人的安全部位是現金不是債券」兩張,
   搬進它們解釋的那一格(docs/IA.md §5.5 的觀念卡拆散對照表)。 */
const ASSET_META={
  VT:  {tag:'🟢',volHist:0.17,dd:-0.58,role:'VT｜全球股票一網打盡(美歐日及新興市場數千檔)。最分散、最不押單一國家,倖存者偏差風險最低,適合當核心打底、長抱不用管。報酬不會最高但最穩、最省心。USD 計價,含匯率風險。'},
  VTI: {tag:'🟢',volHist:0.18,dd:-0.55,role:'VTI｜一檔抱滿整個美股(大中小型全含)。過去長期動能最強、科技權重高,當核心成長引擎。風險:集中單一國家(美國)、USD 計價含匯率。'},
  VOO: {tag:'🟢',volHist:0.18,dd:-0.55,role:'VOO｜美國 S&P 500,500 大企業,美股最經典的大盤指標。跟 VTI(全美股)幾乎一樣(VTI 多含中小型股),兩者選一即可、別重複。核心打底、長抱不用管。USD 計價,含匯率風險。'},
  TW50:{tag:'🟡',volHist:0.21,dd:-0.57,role:'0050｜台股前 50 大權值股,等於押台股大盤。優點:台幣計價、無匯率、你最熟悉的市場。風險:高度集中台積電(占比極高),買它等於半押一檔股票。'},
  QQQ: {tag:'🟠',volHist:0.22,dd:-0.83,role:'QQQ｜那斯達克 100,美股科技成長股集中(蘋果、輝達、微軟…)。長期報酬亮眼但波動大、估值常偏高;2000 網路泡沫曾崩 −83%。當進攻配置、別當全部。'},
  /* 2026-08:台股正二的主標的由 00631L(元大台灣50正2)換成 00685L(群益臺灣加權正2)。
     理由不是費用(雖然 0.48% 對 1.16% 也便宜一半以上),是**基準一致**:
     本站所有加碼訊號看的是加權指數,00685L 追的就是它;00631L 追的是臺灣50,
     而且 2026-05-19 起元大加進台積電現貨、官方明講要與 2 倍加權「做出區隔」。
     與「② 挑時機」同一個決定,見 timing/scripts/update_data.js 的 product 欄。 */
  L2:  {tag:'🔴',volHist:0.42,dd:-0.84,role:'00685L 正二(群益臺灣加權正2)｜每天讓你的漲跌變成台股大盤的兩倍。'
    +'<br>本策略拿它當「崩盤時用準備金抄底、加速修復」的工具,不是平常抱好抱滿的東西。'
    +'<br><br><b>⚠ 三件事先知道:</b>'
    +'<br>① 帳面最深跌過 <b>−84%</b>,而且可能好幾年回不來。'
    +'<br>② 它比 00631L 薄(日均成交約四分之一),大跌那幾天想立刻買到想要的量,價差可能難看。'
    +'<br>③ <b>絕對不要再拿它去融資或質押</b> —— 它本身已經是槓桿,再借一次才是真的會歸零。'
    +'<br><span class="mut">為什麼不是規模最大的 00631L(元大台灣50正2)?因為它追的是<b>臺灣50</b>,不是本站訊號在看的<b>大盤</b>,'
    +'而且 2026-05-19 起元大加進台積電現貨去強化追臺灣50,官方明講要與 2 倍大盤「做出區隔」——'
    +'買 00631L 而照本站的訊號操作,<b>你看的和你買的不是同一個指數</b>。完整說明在「② 挑時機」。</span>'},
  // ↓ 原 tab4 觀念卡「為什麼用 SSO 不用 QLD」整張搬進來(IA §5.5)——
  //   放在一個誰都不會點的分頁裡等於沒有,搬到它解釋的那一格才會被讀到。
  SSO: {tag:'🔴',volHist:0.38,dd:-0.85,role:'SSO｜S&P500 的「每日 2 倍槓桿」。靠 SWAP 借錢開槓桿,成本跟著美元利率走(利率高時拖累大),沒有台股的逆價差;2008 金融海嘯實測最深 −85%、花了 6 年才回到前高。它是美股那份錢的槓桿引擎。'
    +'<br><br><b>📌 為什麼是 SSO,不是 QLD(2x 那斯達克)?因為 QLD 是加碼,不是分散。</b>'
    +'<br>①「標普500 + 那斯達克」聽起來像兩個市場,其實是一個半:用月報酬迴歸,那斯達克 100 有 <b>69.4%</b> 的漲跌可以直接被 S&P500 解釋<span class="src fixed">回測值</span>。把美股槓桿押在 QLD 上,等於把同一批科技股再壓一次 —— <b>報酬和風險一起放大,那叫加碼,不叫分散</b>。'
    +'<br>②「崩盤加碼」這類策略靠「創新高」補回準備金,而那斯達克曾經 <b>15.6 年</b>沒創新高(2000-04 → 2015-11)。準備金在 2000 年就打完,之後十幾年一發子彈都補不回來 —— 連 2008 年那場大特價都只能空手看。'
    +'<br>③ 同一套 70/30 準備金策略,從 2000 年起算<span class="src fixed">回測值</span>:<b>SSO</b> 年化 10.5%、最深 −73%、報酬÷回撤 <b>0.144</b>、最久 6.1 年回不了本;<b>QLD</b> 年化 6.2%、最深 <b>−96.6%</b>、報酬÷回撤 <b>0.064</b>、最久 <b>19.8 年</b>回不了本。'
    +'<br>④ 把 S&P500 換成那斯達克,波動只會單調變大、回撤只會單調變深(0% 那斯達克 → 波動 28.8%/最深 −81.5%;60% → 波動 37.1%/最深 −95.7%)。分散的定義是降低組合風險,那斯達克做不到。'
    +'<br><span class="mut">⚠ 那是歷史,不是承諾。同一套 QLD 策略改從 2010 年起算,報酬÷回撤會從 0.064 跳到 0.522 —— <b>差別只在起點</b>。只給你看 2010 年起算的美股槓桿回測,都該當廣告看。另外 <b>QQQ(不開槓桿)仍留在選單裡</b>可當進攻配置,被換掉的只有「槓桿版」。來源:姊妹工具「📈 挑時機」的 us_overlap / us_reserve 回測。</span>'},
  CASH:{tag:'🟢',volHist:0.01,dd:0,role:'現金/短債｜<b>有開槓桿時</b>它是策略的核心武器:①崩盤時的抄底彈藥 ②讓你抱得住、不被洗出場。「準備金比例」是槓桿策略最重要的旋鈕。'
    +'<br><span class="mut">沒開槓桿的組合請看下面「債券」那一格 —— 那種情況下現金只是零利率的保險費。</span>'},
  /* ↓ 原 tab4 觀念卡「年輕人的安全部位是現金準備金,不是債券」搬進來(IA §5.5)。
     ── S8 改寫:原文的方向是反的 ─────────────────────────────────────
     原文寫「年輕人的安全部位是現金準備金,不是債券」,而且寫成全站通則。實測推翻了它:
     ① **沒有槓桿時,加碼機制根本不會啟動**(hasMech 要求有槓桿標的)——
        無槓桿配置下 mech='both' 與 mech='rebal' 的模擬結果**逐位元相同**。
        現金那時候沒有任何選擇權價值,只是 −0.5% 實質報酬的保險費。
     ② 兩具引擎的穩健性掃描(param 與 hist 各 3000 條、同 seed)顯示:除了
        「股票 ≤20%」那一列之外,**每一個股票比重的最佳解都是防禦部位全放債券**。
        50% 股票那一組:防禦全現金的退休 P10 是 1185 萬,全債券是 1483 萬。
     ③ 原文用「長債 2022 跌 −30%」當論據,但**引擎模的不是長債**:sigma=6%、
        歷史最大回撤 −17%,那是綜合債/中天期(AGG 那一類,2022 實際約 −13%)的參數。
        論據與模型講的是兩種不同的資產,這次一併收斂。
     真正成立的是**有範圍的版本**,寫在下面。 */
  BOND:{tag:'🟡',volHist:0.06,dd:-0.17,role:'債券｜<b>沒開槓桿時</b>,它就是你的防禦部位 —— 比現金好,而且不是差一點點。'
    +'<br><br><b>📌 現金的價值來自「崩盤時能加碼」,不是「因為它安全」。</b>'
    +'<br>沒有槓桿部位,崩盤加碼機制<b>根本不會啟動</b>(本工具實測:無槓桿時開不開加碼,結果一模一樣)。那時候的現金賺 1.5%、通膨吃掉 2%,<b>實質是負的</b>,而債券賺 4% 而且與股市微幅負相關 —— 同樣的股票比重下,換成債券<b>報酬更高、回撤反而更淺</b>。'
    +'<br><b>所以:沒開槓桿 → 防禦部位用債券;有開槓桿 → 防禦部位用現金(那才是彈藥)。</b>本工具的風險階梯就是照這條線切的。'
    +'<br><span class="mut">兩個例外要留現金:① <b>股票只剩兩成上下</b>時防禦部位佔了八成,債券參數本身變成主要風險,這時債現各半比較穩;② 已退休、要應付短期提領。</span>'
    +'<br><span class="mut">⚠ 這裡的「債券」是<b>綜合債/中天期</b>(波動 6%、歷史最深 −17%),<b>不是長天期公債</b>(2022 曾跌 −30%)。買錯天期,上面這段就不成立。</span>'},
  GOLD:{tag:'🟡',volHist:0.16,dd:-0.45,role:'黃金｜危機時與股市低相關的分散工具,但長期無息、報酬普通。當「睡得安穩」的選配小量(建議 ≤5–10%),預設 0。'},
};
// 白底可讀配色:全組通過 3:1 對比與相鄰色盲分離驗證(CASH 刻意無彩度=無曝險的中性灰)。
// L2 用 2x 的 --up 紅(槓桿=燙手)、TW50 用海軍藍、QQQ 用 --warn 橘(進攻)。
const ASSET_COLOR={TW50:'#2159a5',L2:'#c62828',VT:'#7b4fa8',VTI:'#2e7d32',VOO:'#0f8ea3',QQQ:'#e2711d',SSO:'#b3186b',CASH:'#8b95a6',BOND:'#3949ab',GOLD:'#b8860b'};
const SHORT={VT:'VT',VTI:'VTI',VOO:'VOO',TW50:'0050',QQQ:'QQQ',L2:'正二',SSO:'SSO',CASH:'現金',BOND:'債',GOLD:'金'};
const DNAME={VT:'VT 全球股',VTI:'VTI 美股',VOO:'VOO 標普500',TW50:'0050 台股',QQQ:'QQQ 那斯達克',L2:'00685L 正二',SSO:'SSO 標普500 2x',CASH:'現金準備金',BOND:'債券',GOLD:'黃金'};
const CATS=[
  {label:'🇹🇼 台股(國內)',keys:['TW50','L2']},
  {label:'🌎 海外股',keys:['VT','VTI','VOO','QQQ','SSO']},
  {label:'🛡️ 防禦／其他',keys:['CASH','BOND','GOLD']},
];

/* ═══ 統一風險階梯(S8)═══════════════════════════════════════════════
   改版前站台有**三套互不相通的風險等級**:精靈 3 檔(無槓桿)、這裡的範本卡 5 張
   (最高只到 125% 曝險)、/timing/ 的 4 個 profile(100–160%)。結果是回測最佳的
   「70% 正二 + 30% 準備金」變成孤島 —— 精靈使用者永遠到不了它。
   S8 把三套合併成**一條九階的梯子**,淨曝險單調遞增,第 6–9 階直接沿用
   /timing/ 現有的四個 profile(那些組成有 26 年日線回測,**不改、不重新校準**)。

   ── 為什麼 1–5 階用債券、6–9 階用現金 ──────────────────────────────
   不是不一致,是實跑出來的分界線(理由詳見 ASSET_META.BOND):
   現金的價值來自「崩盤時能加碼」,而加碼機制要有槓桿標的才會啟動。
   **分水嶺以下沒有彈藥的用途 → 用債券;以上才是真彈藥 → 用現金。**

   ── 欄位 ────────────────────────────────────────────────────────
     rung   1–9,唯一識別;ap_state_v2.ladder.rung 存的就是它
     lev    是否跨過槓桿分水嶺(true 的階一律要使用者主動點選,問卷不會自動給)
     w      每個市場的權重,百分比整數(與表單同單位;呼叫端自己 /100)
            第 6–9 階**沒有 BOTH**,原因是**還沒校準過**,不是引擎做不到(差異 C29):
            加碼觸發是組合層級的(全程只有一個 mkt/peak/fired[],水位取所有股票部位的加權
            指數 idxRet),加碼金額也早就按比例分給所有槓桿標的;param 引擎又只有一個共同
            市場因子。要開放的話是補 `BOTH:{L2,SSO,CASH}` 再重跑 calibrate_wizard.js,
            **不是**改機制。ladderWeights() 目前用 `L.w[market]||L.w.TW` 退回台股。
     dd/mu  依市場分別存;**由 plan/tests/calibrate_wizard.js 實跑校準,不要憑感覺改**
            dd = 累積期回撤 P90,**正的小數**(0.31 = 一度跌 31%),顯示時自己補負號
            mu = **從模擬中位反推的隱含名目年化**,小數
                 刻意不用 blendedMuNom(權重加權平均)—— 那個數字不含崩盤加碼的貢獻,
                 對槓桿階會說謊:台股 rung5 加權 6.4% > rung6 的 4.9%,可是退休中位
                 卻是 2893萬 < 3348萬。九階要用同一把尺,那把尺只能是模擬本身。
     skipMkt 這一階在哪些市場**不提供**(見下方「為什麼美股沒有 rung 6/7」)
     when   什麼條件下適合 —— 槓桿階的這一段是把關文案,不可省略
   只帶入「投組 + 策略」,不動個人數字(年齡/資產/月投入)。 */
const LADDER=[
  {rung:1,emoji:'🛡',name:'守成',lev:false,mech:'rebal',glide:0,glideStart:45,flexW:1,dca:0,swr:3.25,
   w:{TW:{TW50:20,BOND:40,CASH:40}, US:{VT:20,BOND:40,CASH:40}, BOTH:{TW50:10,VT:10,BOND:40,CASH:40}},
   dd:{TW:0.1031,US:0.0832,BOTH:0.0825}, mu:{TW:0.0408,US:0.0387,BOTH:0.0395},
   when:'距退休不到 5 年、已退休、或還沒存到緊急預備金。這一階刻意留 40% 現金:股票只剩兩成的時候,剩下八成如果全押債券,債券自己的漲跌反而會變成你最大的風險 —— 債和現金各半才穩。'},
  {rung:2,emoji:'🟢',name:'保守',lev:false,mech:'rebal',glide:0,glideStart:45,flexW:1,dca:0,swr:3.5,
   w:{TW:{TW50:35,BOND:65}, US:{VT:35,BOND:65}, BOTH:{TW50:18,VT:17,BOND:65}},
   dd:{TW:0.2128,US:0.1662,BOTH:0.1657}, mu:{TW:0.0565,US:0.0527,BOTH:0.0547},
   when:'距退休 5–9 年,或跌下去會想先停止投入觀望的人。一次崩盤大約痛兩成,那是多數人真的忍得住的水位。'},
  {rung:3,emoji:'🟢',name:'穩健',lev:false,mech:'rebal',glide:0,glideStart:45,flexW:1,dca:0,swr:3.5,
   w:{TW:{TW50:50,BOND:50}, US:{VT:50,BOND:50}, BOTH:{TW50:25,VT:25,BOND:50}},
   dd:{TW:0.3238,US:0.2499,BOTH:0.2350}, mu:{TW:0.0625,US:0.0571,BOTH:0.0596},
   when:'距退休 10–14 年,或雖然年限長、但崩盤時只打算「什麼都不做」的人。整條梯子上報酬÷回撤最好的一格。'},
  {rung:4,emoji:'🟡',name:'成長',lev:false,mech:'rebal',glide:0,glideStart:45,flexW:1,dca:0,swr:3.5,
   w:{TW:{TW50:65,BOND:35}, US:{VT:65,BOND:35}, BOTH:{TW50:33,VT:32,BOND:35}},
   dd:{TW:0.4077,US:0.3094,BOTH:0.3207}, mu:{TW:0.0671,US:0.0608,BOTH:0.0646},
   when:'距退休 15 年以上、收入穩定,而且崩盤時做得到不動或加碼。'},
  {rung:5,emoji:'🟠',name:'積極',lev:false,mech:'rebal',glide:0,glideStart:45,flexW:1,dca:0,swr:3.5,
   w:{TW:{TW50:80,BOND:20}, US:{VT:80,BOND:20}, BOTH:{TW50:40,VT:40,BOND:20}},
   dd:{TW:0.5009,US:0.3825,BOTH:0.4038}, mu:{TW:0.0703,US:0.0640,BOTH:0.0684},
   when:'距退休 25 年以上、收入很穩、地基都補齊。這是**不開槓桿的天花板**,問卷最多推薦到這一階。'},

  /* ══════════ 槓桿分水嶺 ══════════
     以下四階直接對應 /timing/ 的四個 profile(coreW/reserveW = 50/50、60/40、70/30、80/20)。
     組成不動,因為那是有 26 年日線回測的東西。三個差異要說明:
     ① mech 用 deep3(−25/−35/−45),與 /timing/ 同一張表;
     ② glide:1 —— /timing/ 沒有隨齡降槓(它是「今天怎麼做」的工具),但**規劃工具必須有**:
        35 歲跑 140% 曝險可以,64 歲還跑 140% 不行。這讓這裡的數字比 /timing/ 的回測保守,
        方向是安全的那一邊;
     ③ dca:12 —— 槓桿階一律分 12 個月進場,避開「槓桿在頂部歐印」。四階一致,
        所以階與階之間仍然可比。 */
  {rung:6,emoji:'🔵',name:'槓桿·防禦',lev:true,mech:'deep3',glide:1,glideStart:45,flexW:1,dca:12,swr:3.5,
   w:{TW:{L2:50,CASH:50}, US:{SSO:50,CASH:50}, BOTH:{L2:25,SSO:25,CASH:50}},
   dd:{TW:0.6632,US:0.4804,BOTH:0.5049}, mu:{TW:0.0820,US:0.0584,BOTH:0.0695}, skipMkt:['US'],
   when:'槓桿的最低劑量:一半 2 倍 ETF、一半準備金,平常的放大倍數剛好等於「全押大盤」。'},
  {rung:7,emoji:'🟣',name:'槓桿·保守',lev:true,mech:'deep3',glide:1,glideStart:45,flexW:1,dca:12,swr:3.5,
   w:{TW:{L2:60,CASH:40}, US:{SSO:60,CASH:40}, BOTH:{L2:30,SSO:30,CASH:40}},
   dd:{TW:0.6831,US:0.5110,BOTH:0.5376}, mu:{TW:0.0870,US:0.0633,BOTH:0.0749}, skipMkt:['US'],
   when:'比全押大盤多兩成曝險,準備金仍然厚。想開槓桿但還在適應回撤的人。'},
  {rung:8,emoji:'⭐',name:'槓桿·均衡',lev:true,mech:'deep3',glide:1,glideStart:45,flexW:1,dca:12,swr:3.5,
   w:{TW:{L2:70,CASH:30}, US:{SSO:70,CASH:30}, BOTH:{L2:35,SSO:35,CASH:30}},
   dd:{TW:0.7093,US:0.5529,BOTH:0.5729}, mu:{TW:0.0912,US:0.0675,BOTH:0.0801},
   when:'本站回測 26 年表現最好的一格(「② 挑時機」的預設策略)。判準只有一個:你能不能在帳面一度只剩兩成的時候不賣掉?答不出來就往上選一階 —— 第 7 階少賺約 0.4 個百分點,但最深跌淺 3 個百分點。'},
  {rung:9,emoji:'🔴',name:'槓桿·積極',lev:true,mech:'deep3',glide:1,glideStart:45,flexW:1,dca:12,swr:3.5,
   w:{TW:{L2:80,CASH:20}, US:{SSO:80,CASH:20}, BOTH:{L2:40,SSO:40,CASH:20}},
   dd:{TW:0.7398,US:0.5948,BOTH:0.6156}, mu:{TW:0.0945,US:0.0718,BOTH:0.0851},
   when:'準備金只剩兩成,大跌時子彈很快就打完。比第 8 階多的年化不到 0.4 個百分點,最深跌卻多 3 個百分點、而且要更久才回得來 —— 多承受的比多拿到的多。'},
];
/* ── 為什麼「兩邊都要」也有槓桿階了(S10)─────────────────────────
   改版前第 6–9 階只有 TW/US 兩組,理由寫的是「準備金加碼要盯單一指數,兩個市場的
   回撤水位會打架」—— **那是錯的**(差異 C29):simulate() 全程只有一個 mkt/peak/fired[],
   水位取所有股票部位的加權 idxRet;加碼金額本來就按比例分給所有槓桿標的;
   param 引擎每月也只抽一個共同市場因子。真正的原因只是「沒有校準過」。
   S10 補上 BOTH = 正二與 SSO 各半(與無槓桿階的 BOTH 同一個慣例:對半分),重跑校準。

   結果值得記一筆 —— 第 8 階三個市場的「模擬年化 ÷ 累積回撤 P90」:
     台股 8.64% / 71.0% = 0.122      美股 6.75% / 55.3% = 0.122
     **都要 7.80% / 57.3% = 0.136**  ← 三者最高
   分散在槓桿階同樣有效,而且比在無槓桿階更明顯(回撤幾乎貼齊純美股、報酬卻拉高一大截)。
   ⚠ 但要記得單因子模型的限制:它給 L2–SSO 的相關只有 ρ_L2×ρ_SSO = 0.80×0.85 = 0.68,
   卻也給 TW50–L2 只有 0.64(實際接近 1)。**跨市場分散被低估、同市場分散被高估**,
   所以上面那個 0.136 的優勢是「至少這麼多」而不是「剛好這麼多」,但方向不會反。

   ── 為什麼「都要」也沒有 rung 6(skipMkt 含 'BOTH')──
   跟美股同一個理由,支配性自檢直接抓到:
     都要 rung 5(0050 40/VT 40/債 20)   回撤P90 −40%  退休中位 2793萬
     都要 rung 6(正二 25/SSO 25/現 50)  回撤P90 −50%  退休中位 2750萬  ← 更痛而且更少
   rung 7 起就翻正(−54% / 3045萬),所以只擋 rung 6。

   ── 為什麼美股沒有 rung 6/7(skipMkt 含 'US')─────────────────────────
   校準腳本的單調性自檢抓到的:美股的槓桿低階被自己的第 5 階**嚴格支配** ——
   同樣 4000 條、seed 12345、35→65 歲:
     美股 rung 5(VT 80/債 20)  回撤P90 −38%  退休中位 2566萬
     美股 rung 6(SSO 50/現 50) 回撤P90 −48%  退休中位 2311萬   ← 更痛而且更少
     美股 rung 7(SSO 60/現 40) 回撤P90 −51%  退休中位 2531萬   ← 同樣被 rung 5 支配
   原因是 SSO 的融資成本假設(ssoFin 預設 4%)把 ssoMuNom 壓到 7.6%,只比 VT 的 6.5%
   高 1.1pp,卻要付雙倍波動;配上 40–50% 只賺 1.5% 的現金就翻不了身。
   台股沒有這個問題(正二 8.2%、σ 42%,深觸發加碼吃得到那份波動),所以 TW 六階全留。
   **已知被支配的選項不該出現在選單上** —— 這是引導路徑,不是參數沙盒;
   想手動配 SSO 50/現 50 的人在 /plan/ 還是配得出來。
   ⚠ 這張 skipMkt 是**校準結果**,不是偏好。ssoFin 或 LADDER 的組成一改就要重跑
   calibrate_wizard.js 的單調性自檢,依結果增刪。 */
const LADDER_BY_RUNG={}; LADDER.forEach(L=>LADDER_BY_RUNG[L.rung]=L);
const LEV_RUNG_MIN=6;              // 槓桿分水嶺:rung >= 這個值就是槓桿階
const MAX_AUTO_RUNG=LEV_RUNG_MIN-1;// 問卷自動推薦的上限 —— 永遠不會跨過分水嶺
/** 這個市場實際可選的階(去掉沒有該市場版本的、以及已知被支配的)。 */
function ladderRungs(market){
  // S10 起九階 × 三市場全部有權重(槓桿階的 BOTH = 正二與 SSO 各半),
  // 所以這裡只剩兩條規則:有沒有該市場的權重、有沒有被支配。
  // 改版前槓桿階走 `L.lev ? true` 的特例(沒有 BOTH 也硬給,再靠 A.levMkt 補問一邊)—— 已拿掉。
  return LADDER.filter(L=>{
    if(L.skipMkt&&L.skipMkt.indexOf(market)>=0) return false;
    return !!L.w[market];
  });
}
// 階梯權重 → 十個標的的完整權重物件(沒給的一律 0,避免殘留舊設定)
function ladderWeights(rung,market){
  const L=LADDER_BY_RUNG[rung]; const w={}; ORDER.forEach(k=>w[k]=0);
  if(!L) return w;
  // 退回 TW 只是防呆(市場字串壞掉時不要回一組全 0 的權重);
  // 正常路徑上每一階都有 TW/US/BOTH 三組,這條不會觸發。
  const src=L.w[market]||L.w.TW;
  Object.keys(src).forEach(k=>{if(w[k]!=null)w[k]=src[k];});
  return w;
}

// ---------- 混合報酬 ----------
function blendedMuNom(w,defs){let m=0,tot=0;ORDER.forEach(k=>{m+=w[k]*defs[k].muNom;tot+=w[k];});return tot>0?m/tot:0;}
/* 淨曝險 —— **一律正規化**(docs/SPEC.md 差異 C3,S5 落地)。
   改版前這裡不正規化,而 /plan/ 1.3 面板的大數字(updateWsum)有正規化 ——
   權重合計 = 100% 時兩者相同,不等於 100% 時同一個「淨曝險」會有兩個值。
   1.3 明白允許不湊到 100(「不必自己湊,會自動正規化」),所以那是使用者踩得到的。
   模擬本身也是先正規化再跑,所以正規化版才是「真的會發生的曝險」。 */
function netExposure(w){ // 槓桿倍率統一查 LEV 表
  let e=0,tot=0;ORDER.forEach(k=>{e+=w[k]*levMult(k);tot+=w[k];});
  return tot>1e-12?e/tot:0;
}

/* ── 崩盤加碼的觸發水位與投入比例 ──────────────────────────
   單一真相:simulate()、scenRun()、/report/ 第 5 節、**以及「② 挑時機」的 deep3** 都吃這一份。
   (原本 /report/ 複製了一份,靠註解要求「必須與 plan/index.html 一致」—— SPEC C17。)

   ── S8 新增 deep3 ────────────────────────────────────────────────
   改版前這裡只有兩張表,而 `/timing/` 的主策略「準備金 70/30」用的是**第三張**
   (−25/−35/−45、權重 1:2:3)—— 同一支正二,兩頁給的加碼水位不一樣,而這段註解
   卻寫著「單一真相」。deep3 把那張表收進來,兩頁從此同源。
   POR 對應 timing/data.json 的 tranches[].share(1:2:3 → 1/6, 2/6, 3/6);
   flow_test.js 有回歸斷言盯著這兩份不准再分家。

   ⚠ **收進來的只有觸發表,不是整套策略。** /plan/ 的引擎複製不了 /timing/ 的回測:
     ① 引擎是**月步**的,dd 只看月底值 → 盤中與月中的谷底看不見 →
        −25/−35/−45 這種深觸發的開火次數被系統性低估 → MC 會**低估加碼的貢獻**;
     ② `hist` 引擎更糟(年報酬平滑成月步,年內崩盤被抹平,SPEC §2.5);
     ③ 沒有 /timing/ 的 **63 日重置閘門**(data.json 的 reset.gapDays)——
        這裡每創新高就把 fired 全部清空。
   槓桿階的「最壞會多壞」要導向 /timing/ 的日線回測,不要拿這裡的 MC 數字冒充。 */
const MECH_BANDS={
  orig: {THR:[-0.25,-0.40],            POR:[0.5,0.5]},
  def:  {THR:[-0.12,-0.22,-0.32,-0.42],POR:[0.1,0.2,0.3,0.4]},
  deep3:{THR:[-0.25,-0.35,-0.45],      POR:[1/6,2/6,3/6]},   // ← 與「② 挑時機」同一張表
};
// 查表而不是三元式:再多一張表時不必再改這裡的判斷式。未知的 mech 一律退回 def。
function mechBands(mech){return MECH_BANDS[mech==='deep3'?'deep3':(mech==='orig'?'orig':'def')];}
/* 「這個機制會不會做崩盤加碼?」的**單一真相**。
   S8 加 deep3 時發現這個判斷散在四個地方各寫一份(simulate、scenRun、
   /plan-result/ ❹、/report/ 第 5 節),漏掉任何一份的後果是**靜默的**:
   /plan-result/ 那一份漏了,選第 8 階的人會看到「跌的時候不加碼」——
   而崩盤加碼正是那一階的核心。所以收成一個函式。 */
const MECH_WITH_RESERVE={both:1, reserve:1, orig:1, deep3:1};
function mechHasReserve(mech){return !!MECH_WITH_RESERVE[mech];}

// ---------- 歷史 block-bootstrap 資料(美國年報酬 1928–2024,Damodaran NYU Stern;CPI: usinflationcalculator)----------
// 名目年報酬,於載入時換算成「實質」(real =(1+名目)/(1+CPI)−1)以對齊引擎的實質框架
const HIST_Y0=1928;
const HIST_STOCK_NOM="0.4381,-0.0830,-0.2512,-0.4384,-0.0864,0.4998,-0.0119,0.4674,0.3194,-0.3534,0.2928,-0.0110,-0.1067,-0.1277,0.1917,0.2506,0.1903,0.3582,-0.0843,0.0520,0.0570,0.1830,0.3081,0.2368,0.1815,-0.0121,0.5256,0.3260,0.0744,-0.1046,0.4372,0.1206,0.0034,0.2664,-0.0881,0.2261,0.1642,0.1240,-0.0997,0.2380,0.1081,-0.0824,0.0356,0.1422,0.1876,-0.1431,-0.2590,0.3700,0.2383,-0.0698,0.0651,0.1852,0.3174,-0.0470,0.2042,0.2234,0.0615,0.3124,0.1849,0.0581,0.1654,0.3148,-0.0306,0.3023,0.0749,0.0997,0.0133,0.3720,0.2268,0.3310,0.2834,0.2089,-0.0903,-0.1185,-0.2197,0.2836,0.1074,0.0483,0.1561,0.0548,-0.3655,0.2594,0.1482,0.0210,0.1589,0.3215,0.1352,0.0138,0.1177,0.2161,-0.0423,0.3121,0.1802,0.2847,-0.1804,0.2606,0.2488".split(",").map(Number);
const HIST_BOND_NOM="0.0084,0.0420,0.0454,-0.0256,0.0879,0.0186,0.0796,0.0447,0.0502,0.0138,0.0421,0.0441,0.0540,-0.0202,0.0229,0.0249,0.0258,0.0380,0.0313,0.0092,0.0195,0.0466,0.0043,-0.0030,0.0227,0.0414,0.0329,-0.0134,-0.0226,0.0680,-0.0210,-0.0265,0.1164,0.0206,0.0569,0.0168,0.0373,0.0072,0.0291,-0.0158,0.0327,-0.0501,0.1675,0.0979,0.0282,0.0366,0.0199,0.0361,0.1598,0.0129,-0.0078,0.0067,-0.0299,0.0820,0.3281,0.0320,0.1373,0.2571,0.2428,-0.0496,0.0822,0.1769,0.0624,0.1500,0.0936,0.1421,-0.0804,0.2348,0.0143,0.0994,0.1492,-0.0825,0.1666,0.0557,0.1512,0.0038,0.0449,0.0287,0.0196,0.1021,0.2010,-0.1112,0.0846,0.1604,0.0297,-0.0910,0.1075,0.0128,0.0069,0.0280,-0.0002,0.0964,0.1133,-0.0442,-0.1783,0.0388,-0.0164".split(",").map(Number);
const HIST_CPI="-0.017,0.0,-0.023,-0.09,-0.099,-0.051,0.031,0.022,0.015,0.036,-0.021,-0.014,0.007,0.05,0.109,0.061,0.017,0.023,0.083,0.144,0.081,-0.012,0.013,0.079,0.019,0.008,0.007,-0.004,0.015,0.033,0.028,0.007,0.017,0.01,0.01,0.013,0.013,0.016,0.029,0.031,0.042,0.055,0.057,0.044,0.032,0.062,0.11,0.091,0.058,0.065,0.076,0.113,0.135,0.103,0.062,0.032,0.043,0.036,0.019,0.036,0.041,0.048,0.054,0.042,0.03,0.03,0.026,0.028,0.03,0.023,0.016,0.022,0.034,0.028,0.016,0.023,0.027,0.034,0.032,0.028,0.038,-0.004,0.016,0.032,0.021,0.015,0.016,0.001,0.013,0.021,0.024,0.018,0.012,0.047,0.08,0.041,0.029".split(",").map(Number);
// 換算實質年報酬
const HIST_SR=HIST_STOCK_NOM.map((s,i)=>(1+s)/(1+HIST_CPI[i])-1); // 美股實質
const HIST_BR=HIST_BOND_NOM.map((b,i)=>(1+b)/(1+HIST_CPI[i])-1); // 美債實質
const HIST_N=HIST_SR.length; // 97
// 區塊抽樣:連續 4~12 年為一塊、串接到填滿年限(保留多年序列/動能/均值回歸/失落十年)
function sampleBlockYears(n,rand){
  const R=rand||Math.random;
  const out=[];
  while(out.length<n){
    const blk=4+Math.floor(R()*9), s=Math.floor(R()*HIST_N);
    for(let j=0;j<blk&&out.length<n;j++)out.push((s+j)%HIST_N);
  }
  return out;
}
// 某年某標的的「實質年報酬」(股票類一律用美股史代理;槓桿=2×標的−耗損;債/金/現金各自處理)
function histAnnualReal(k,yi,vd,cdg,qf){
  if(k==='BOND')return HIST_BR[yi];
  if(k==='CASH')return 0;        // 現金實質≈0(歷史上幾乎只追平通膨)
  if(k==='GOLD')return 0.01;     // 黃金以長期實質~1%代理(無逐年資料)
  const s=HIST_SR[yi];
  // (1+s)² 近似每日重設 2x 的年內非線性(−50%年→−75%);再扣 vd 代表年內每日波動耗損(年資料看不到)、內扣、逆價差/融資
  if(k==='L2') return Math.max(-0.95,Math.pow(1+s,2)-1-(vd+LEV.L2.er+cdg));   // 正二
  if(k==='SSO')return Math.max(-0.95,Math.pow(1+s,2)-1-(vd+LEV.SSO.er+qf));   // SSO
  return s; // VOO/VTI/VT/TW50/QQQ 一律以美股實質史代理
}

// ═══════════ 現金流時間軸 ═══════════
// 一筆現金流 = {n 名稱, amt 金額(萬), freq 'y'|'m', kind 'inc'|'exp', cat 'ess'|'disc', real 0|1, s 起, e 迄}
// 起訖錨點:'now' / 'ret'(退休) / 'max'(最大年齡) / 數字(歲);e==='once' 代表一次性事件。
// real=0(名目)表示金額固定不動、購買力隨通膨遞減 —— 房貸月付就是這種。
const FLOW_MAX=20, FLOW_VER='1';
function flowClean(s){return String(s==null?'':s).replace(/[,;|\r\n]/g,' ').trim().slice(0,12);}

// 這個字串會來自分享連結,等同敵意輸入:壞的列一律丟棄,絕不 throw,數值全部 clamp。
function parseFlows(str){
  const out=[];
  try{
    if(!str)return out;
    let body=String(str);
    const bar=body.indexOf('|');
    if(bar>0&&/^\d+$/.test(body.slice(0,bar)))body=body.slice(bar+1); // 去掉版本前綴
    const anchor=(v,def)=>{const t=String(v==null?'':v).trim();
      if(t==='now'||t==='ret'||t==='max'||t==='once')return t;
      const n=+t;return isFinite(n)?clamp(Math.round(n),0,120):def;};
    body.split(';').forEach(row=>{
      if(!row)return;
      const f=row.split(',');
      if(f.length<8)return;
      const amt=+f[1];
      if(!isFinite(amt)||amt<0)return;
      const kind=f[3]==='inc'?'inc':'exp';
      out.push({id:'f'+out.length,n:flowClean(f[0])||(kind==='inc'?'收入':'支出'),
        amt:Math.min(amt,1e6),freq:f[2]==='m'?'m':'y',kind,
        cat:f[4]==='disc'?'disc':'ess',real:f[5]==='0'?0:1,
        s:anchor(f[6],'now'),e:anchor(f[7],'max')});
    });
  }catch(e){}
  return out.slice(0,FLOW_MAX);
}
function serializeFlows(arr){
  if(!arr||!arr.length)return '';
  return FLOW_VER+'|'+arr.slice(0,FLOW_MAX).map(f=>[flowClean(f.n),(+f.amt||0),
    (f.freq==='m'?'m':'y'),(f.kind==='inc'?'inc':'exp'),
    (f.kind==='inc'?'':(f.cat==='disc'?'disc':'ess')),(f.real?1:0),f.s,f.e].join(',')).join(';');
}

// 把起訖錨點解析成月索引 [起,迄](含兩端),空區間回 null。
// 慣例(與引擎的迴圈邊界對齊):simulate 的 mo 從 1 跑到 nMonths、ageNow=age0+mo/12,
// 貢獻發生在 ageNow<=retire(即 mo<=rMo),提領發生在其後 —— 所以
//   'ret' 當【起點】= rMo+1(退休後第一個月);當【終點】= rMo(最後一個工作月)。
//   數字歲當【起點】= 剛滿該歲那個月;當【終點】= 該歲生日的前一個月,
//   因此「40 歲→50 歲」剛好是 10 年整,「70 歲→max(95)」是 25 年又 1 個月。
function flowMonths(f,age0,retire,nMonths){
  const rMo=Math.round((retire-age0)*12);
  let s=f.s==='now'?1:f.s==='ret'?rMo+1:f.s==='max'?nMonths:Math.round((+f.s-age0)*12);
  if(f.e==='once'){s=Math.max(1,s);return s<=nMonths?[s,s]:null;}
  let e=f.e==='ret'?rMo:f.e==='max'?nMonths:f.e==='now'?0:Math.round((+f.e-age0)*12)-1;
  s=Math.max(1,s);e=Math.min(nMonths,e);
  return s<=e?[s,e]:null;
}

// 攤平成「每月實質金額」查表。這一步與模擬路徑無關(引擎全程跑實質),
// 所以 1500 條路徑共用同一份表 —— 建表 O(月數),路徑迴圈裡只是陣列查詢,零額外成本。
function buildFlowSchedule(flows,o){
  const age0=o.age0,retire=o.retire,maxAge=o.maxAge,infl=o.infl||0;
  const nMonths=Math.round((maxAge-age0)*12);
  const inc=new Float64Array(nMonths+2),ess=new Float64Array(nMonths+2),disc=new Float64Array(nMonths+2);
  // 兩筆合成列:1.1 填的年支出與年金永遠存在,舊設定因此零遷移。
  const list=[];
  if(+o.exp>0)    list.push({n:'基本生活費',amt:+o.exp,    freq:'y',kind:'exp',cat:'ess',real:1,s:'ret',e:'max'});
  if(+o.pension>0)list.push({n:'年金/勞退', amt:+o.pension,freq:'y',kind:'inc',cat:'ess',real:1,s:'ret',e:'max'});
  (flows||[]).forEach(f=>list.push(f));
  list.forEach(f=>{
    const r=flowMonths(f,age0,retire,nMonths);
    if(!r)return;
    const amt=+f.amt||0;
    if(amt<=0)return;
    const perMo=f.e==='once'?amt:(amt/(f.freq==='m'?1:12));
    const tgt=f.kind==='inc'?inc:(f.cat==='disc'?disc:ess);
    for(let mo=r[0];mo<=r[1];mo++)tgt[mo]+=f.real?perMo:perMo*Math.pow(1+infl,-mo/12);
  });
  // 退休後第一年的年化基準 —— 彈性提領的上下限要用它當錨。
  const rMo=Math.round((retire-age0)*12);
  let baseAtRetire=0,incAtRetire=0;
  for(let mo=rMo+1;mo<=Math.min(nMonths,rMo+12);mo++){baseAtRetire+=ess[mo]+disc[mo];incAtRetire+=inc[mo];}
  return {nMonths,inc,ess,disc,baseAtRetire,incAtRetire,hasFlows:!!(flows&&flows.length)};
}

// ═══════════ 攤銷式提領(ABW / TPAW 式)的現值表 ═══════════
// 「總資產 = 現在的投資部位 + 未來所有收入的現值」,再把它攤銷到剩餘的每一個月 ——
// 這就是算房貸月付金的同一套數學,只是反過來用。
// 三張表全部與模擬路徑無關(實質空間、確定性),所以整場模擬只算一次、路徑迴圈裡只查表。
//   pvInc[mo]  = 第 mo 個月起、剩餘所有收入的現值
//   annFac[mo] = 剩餘月數的年金因子(含支出傾斜);想花的錢 = 可攤銷金額 ÷ 這個數
//   pvBeq[mo]  = 想留給後代的終值,折現回第 mo 個月
function buildPVTables(S,o){
  const N=S.nMonths;
  const rm=Math.pow(1+Math.max(0,o.rDisc||0),1/12)-1;      // 月折現率(實質)
  const gm=Math.pow(1+(o.tilt||0),1/12)-1;                  // 月支出成長率(傾斜)
  const q=(1+gm)/(1+rm);
  const pvInc=new Float64Array(N+2),annFac=new Float64Array(N+2),pvBeq=new Float64Array(N+2);
  pvInc[N+1]=0;annFac[N+1]=0;pvBeq[N+1]=0;
  for(let mo=N;mo>=0;mo--){
    pvInc[mo]=(S.inc[mo]||0)+pvInc[mo+1]/(1+rm);
    annFac[mo]=1+q*annFac[mo+1];
    pvBeq[mo]=(mo===N)?Math.max(0,o.bequest||0):pvBeq[mo+1]/(1+rm);
  }
  return {pvInc,annFac,pvBeq,rm,gm,rDisc:o.rDisc||0};
}

// ---------- Monte Carlo（月步;含分批進場 + 準備金谷底加碼）----------
function simulate(w,defs,opts){
  const {age0,maxAge,retire,annualContrib,infl,paths}=opts;
  const histMode=opts.engine==='hist'; // 歷史 block-bootstrap 模式
  // 可重現的隨機源(C14)。沒傳 seed → Math.random,行為與改版前逐字相同。
  const rnd=seedRand(opts.seed);
  const _vd=(opts.volDrag!=null?opts.volDrag:0.015), _cdg=(opts.carryDrag!=null?opts.carryDrag:0.03), _qf=(opts.ssoFin!=null?opts.ssoFin:0.04);
  const dcaMonths=Math.max(0,opts.dcaMonths||0), dcaTr=Math.max(1,opts.dcaTranches||1);
  const annualWithdraw=Math.max(0,opts.withdraw||0); // 退休後每年提領(實質,今天購買力)
  // 提領模式:fixed 固定 / collar 彈性上下限(70~120%) / abw 攤銷式。
  // 舊呼叫端只傳布林 flexWithdraw,自動對應到 collar —— 既有測試與快照不必改。
  const wMode=opts.wMode||(opts.flexWithdraw?'collar':'fixed');
  const flexWithdraw=(wMode==='collar');
  // 現金流排程。沒帶 sched 的呼叫端(舊測試、run_presets)自動退回「退休後固定提領」的等價表,
  // 所以既有呼叫端一行都不用改。
  const S=opts.sched||buildFlowSchedule([],{age0,retire,maxAge,infl,exp:annualWithdraw,pension:0});
  // 支出上下限(選填,萬/年 → 換成月)。0 = 不設限。
  const floorM=Math.max(0,opts.floorA||0)/12, ceilM=Math.max(0,opts.ceilA||0)/12;
  let tot=0;ORDER.forEach(k=>tot+=w[k]);const wn={};ORDER.forEach(k=>wn[k]=tot>0?w[k]/tot:0);
  const active=ORDER.filter(k=>wn[k]>1e-9);
  // 生命週期降槓:啟用時把 BOND 納入(降槓的目的地),即使初始權重 0
  const glideOn=(+(opts.glide||0))===1 && active.some(isLev);
  if(glideOn && !active.includes('BOND')) active.push('BOND');
  const nYears=maxAge-age0, nMonths=nYears*12;
  // C5 的第二道防線:cols[] 用 nYears 當索引,非整數或非正數就會靜靜地變成 undefined
  // 再丟一個看不懂的 TypeError。deriveOpts 已經在入口取整,這裡是給直接傳 opts 的
  // 呼叫端(四支測試腳本)的可讀錯誤 —— 訊息要說得出「哪個值不對」。
  if(!(nYears>0)||nYears!==Math.round(nYears))
    throw new RangeError('simulate: maxAge−age0 必須是正整數(收到 age0='+age0+', maxAge='+maxAge+')');
  const dM={},sM={},rho={};
  active.forEach(k=>{dM[k]=Math.log(1+Math.max(-0.99,defs[k].muNom-infl))/12;sM[k]=defs[k].sigma/Math.sqrt(12);rho[k]=defs[k].rho;});
  // 1x「全市場指數」月參數:正二→0050標的、SSO→標普500(VOO)標的(供準備金觸發用,不含槓桿)
  function uM(k){
    if(k==='L2') return {d:Math.log(1+Math.max(-0.99,defs.TW50.muNom-infl))/12,s:defs.TW50.sigma/Math.sqrt(12),rho:defs.TW50.rho};
    if(k==='SSO')return {d:Math.log(1+Math.max(-0.99,defs.VOO.muNom-infl))/12,s:defs.VOO.sigma/Math.sqrt(12),rho:defs.VOO.rho};
    return {d:dM[k],s:sM[k],rho:rho[k]};
  }
  const equityKeys=active.filter(k=>k!=='CASH'&&k!=='BOND');
  let eqTot=0;equityKeys.forEach(k=>eqTot+=wn[k]);
  const eqW={};equityKeys.forEach(k=>eqW[k]=eqTot>0?wn[k]/eqTot:0);
  const leverKeys=active.filter(isLev);
  let leverW=0;leverKeys.forEach(k=>leverW+=wn[k]);
  // 生命週期降槓:隨齡把正二/SSO 逐步移到債券(退休前約降 70% 槓桿)
  const glideStart=Math.max(age0,+(opts.glideStart||45)), glideEnd=retire, deleverFrac=0.7;
  function wnAt(age){
    if(!glideOn) return wn;
    const t=clamp((age-glideStart)/Math.max(1,glideEnd-glideStart),0,1);
    if(t<=0) return wn;
    const w2={};active.forEach(k=>w2[k]=wn[k]||0);
    let freed=0;leverKeys.forEach(k=>{const cut=wn[k]*t*deleverFrac;w2[k]-=cut;freed+=cut;});
    w2['BOND']=(w2['BOND']||0)+freed;
    return w2;
  }
  // 攤銷式提領的折現率:用「退休當下」的權重(降槓桿之後的那一組),不是累積期的。
  // 減法而非 Fisher 精確式 —— 與引擎自己的慣例一致(月漂移也是 muNom-infl),
  // 這樣攤銷路徑在建構上就對齊模擬的中位路徑,差那 0.1pp 不值得換掉一致性。
  let PV=null,abwRate=0;
  if(wMode==='abw'){
    const wRet=wnAt(retire);
    let muRet=0;ORDER.forEach(k=>{if(active.indexOf(k)>=0)muRet+=(wRet[k]||0)*defs[k].muNom;});
    // 保守折扣:折現率壓得比預期報酬低一點 = 前期刻意少花、留更多給後面。
    abwRate=clamp(muRet-infl-(opts.abwHair!=null?opts.abwHair:0.01),0,0.06);
    PV=buildPVTables(S,{rDisc:abwRate,tilt:opts.abwTilt||0,bequest:opts.bequest||0});
  }
  const hasMech=(opts.reserveMech!==false)&&wn['CASH']>1e-9&&leverKeys.length>0&&equityKeys.length>0;
  // 現金回市場機制:both(再平衡+加碼,預設) / rebal(純偏離帶再平衡) / reserve(純-12/-22/-32/-42) / orig(原型712 -25/-40) / bh(買進持有)
  const mech=opts.mech||'both';
  const _bands=mechBands(mech);
  const THR=_bands.THR, POR=_bands.POR;
  // 分批:非現金核心於 dcaMonths 內分 dcaTr 筆投入;現金準備金第一天就到位
  const coreKeys=active.filter(k=>k!=='CASH');let coreW=0;coreKeys.forEach(k=>coreW+=wn[k]);
  const coreRW={};coreKeys.forEach(k=>coreRW[k]=coreW>0?wn[k]/coreW:0);
  const trM=[];for(let j=0;j<dcaTr;j++)trM.push(Math.round(j*dcaMonths/dcaTr));
  const cashM=Math.log(1+Math.max(-0.5,0.015-infl))/12; // 待投核心放現金、賺現金利率

  const cols=[];for(let y=0;y<=nYears;y++)cols.push(new Float64Array(paths));
  const Vfinal=new Float64Array(paths),VatRetire=new Float64Array(paths),maxDDarr=new Float64Array(paths),early3=new Float64Array(paths),survive=new Float64Array(paths);
  // ── 回撤三分(docs/SPEC.md 決議 D1)────────────────────────────────
  //   ddAccum  只計退休前(累積期)的最深回撤 → 這才是「市場會讓你痛多深」
  //   early3   前 36 個月 → 進場時機風險
  //   maxDDarr 全期(= ddAll)→ 含退休後照計畫花掉的部分,**不是市場跌的**
  // maxDDarr 在退休後會把「照計畫提領」記成回撤(固定提領 P90 −100%、ABW 中位 −100%),
  // 所以給使用者看的一律是 ddAccum;maxDDarr 保留原樣不動(既有呼叫端與測試靠它)。
  const ddAccumArr=new Float64Array(paths);
  // 必要 vs 彈性支出的量測(見 §結果 2.1):
  //   essOK   = 這條路徑「每一個月的必要支出都付得出來」→ 這才是真正的底線(**全期**都算)
  //   lifeRat = 實際花掉 ÷ 原本想花,**只算退休後**(差異 C12,S5 落地)
  //   discRat = 只看被標成「彈性」的部分達成多少(沒標任何彈性支出時為 NaN)
  //
  // C12:改版前 lifeRat 的分母含退休前的 1.5 現金流支出(例如 45 歲買房頭期款 300 萬),
  // 於是「生活水準達成率」會被一筆與退休生活無關的支出稀釋,名字與內容對不上。
  // 退休前的現金流付不付得出來由 essOK 負責(它本來就全期都算),兩個指標因此各有分工。
  const essOK=new Float64Array(paths),lifeRat=new Float64Array(paths),discRat=new Float64Array(paths);
  const net0=opts.net0;const rIdx=clamp(retire-age0,0,nYears);
  const rMoS=Math.round((retire-age0)*12); // 最後一個工作月的月索引(提領從 rMoS+1 起)
  const ruinCut=(wMode==='abw')?nMonths-12:nMonths; // ABW 的末期歸零是計畫完成,不算破產
  // 已屆退休(rMoS<1)時累積期是空的 —— 退回「前 36 個月」,讓呼叫端永遠拿得到一個有意義的
  // 數字,而不是 0(0 會被讀成「最壞不會跌」)。呼叫端要換掉標籤,見 /plan-result/ ❺。
  const ddAccCut=rMoS>=1?rMoS:36;

  for(let p=0;p<paths;p++){
    const h={};active.forEach(k=>h[k]=0);h['CASH']=(wn['CASH']||0)*net0;
    let pend=coreW*net0, trIdx=0, trDep=0;const totT=trM.length;
    const deploy=()=>{const a=pend/(totT-trDep);pend-=a;trDep++;coreKeys.forEach(k=>h[k]+=a*coreRW[k]);};
    while(trIdx<totT&&trM[trIdx]===0){deploy();trIdx++;}
    let mkt=1,peak=1,maxdd=0,peakV=net0,reserveBase=h['CASH']||0,fired=[false,false,false,false],edd=0,ddAcc=0,ruined=false,Vret=0;
    let essShort=0,wantSum=0,gotSum=0,discWantSum=0,discGotSum=0,abwWant=0;
    const histYears=histMode?sampleBlockYears(nYears,rnd):null; // 本條路徑的歷史年份序列
    cols[0][p]=net0;
    for(let mo=1;mo<=nMonths;mo++){
      const ageNow=age0+mo/12;
      const wT=wnAt(ageNow);
      let idxRet=0;
      if(histMode){
        const yi=histYears[Math.floor((mo-1)/12)];
        const sMon=Math.pow(1+HIST_SR[yi],1/12)-1; // 1x 標的(美股實質)月報酬,供準備金觸發
        for(let i=0;i<active.length;i++){
          const k=active[i];
          h[k]*=Math.pow(1+histAnnualReal(k,yi,_vd,_cdg,_qf),1/12); // 年報酬平滑成月步
          if(eqW[k]>0)idxRet+=eqW[k]*sMon;
        }
      }else{
        const m=studentT(5,rnd);
        for(let i=0;i<active.length;i++){
          const k=active[i];const eps=randn(rnd);
          const shock=rho[k]*m+Math.sqrt(Math.max(0,1-rho[k]*rho[k]))*eps;
          h[k]*=Math.exp(dM[k]+sM[k]*shock);
          if(eqW[k]>0){const u=uM(k);const us=u.rho*m+Math.sqrt(Math.max(0,1-u.rho*u.rho))*eps;idxRet+=eqW[k]*(Math.exp(u.d+u.s*us)-1);}
        }
      }
      pend*=Math.exp(cashM);
      // 定期定額:只在退休前(mo<=rMo)。
      if(ageNow<=retire){for(let i=0;i<active.length;i++)h[active[i]]+=(annualContrib/12)*(wT[active[i]]||0);}
      // 現金流:支出全期都可能發生(買房頭期款、育兒在退休前),所以不再綁在「退休後」分支裡。
      // 收支先淨額再動部位 —— 淨流入按目標權重買進,淨流出 pro-rata 賣出。
      {
        const fIn=S.inc[mo]||0;
        const essW=S.ess[mo]||0, discW=S.disc[mo]||0;
        const wantRaw=essW+discW;                     // 這個月「原本想花」的總額(實質萬)
        let want=wantRaw;
        let Vc=pend;for(let i=0;i<active.length;i++)Vc+=h[active[i]];
        // 攤銷式提領:把「投資部位 + 未來收入現值 − 遺產目標」攤銷到剩餘月數。
        // 每 12 個月重算一次就好 —— 沒有人每個月重編預算,而且省 12 倍計算。
        // 數學上它花不完(永遠只花剩餘財富的一部分),風險因此從「錢花光」轉成「花得少」。
        if(wMode==='abw'&&PV&&mo>rMoS&&S.baseAtRetire>0){
          if((mo-rMoS-1)%12===0){
            const spendable=Math.max(0,Vc+PV.pvInc[mo]-PV.pvBeq[mo]);
            abwWant=PV.annFac[mo]>0?spendable/PV.annFac[mo]:0;
          }
          want=abwWant;
        }
        else if(want>0&&flexWithdraw&&Vret>0&&S.baseAtRetire>0){
          const baseA=want*12;                        // 當月的年化基準(有現金流時會隨時間變)
          const tgtA=(S.baseAtRetire/Vret)*Vc;        // 提領率鎖在退休當下,之後隨資產浮動
          want=clamp(tgtA,baseA*0.7,baseA*1.2)/12;
        }
        // 支出上下限(選填)。地板刻意套在「買不起就只好少花」之前 ——
        // 撐不起的地板必須記成必要支出缺口,不能靜默當成成功。
        if(wantRaw>0){
          if(floorM>0)want=Math.max(want,floorM);
          if(ceilM>0) want=Math.min(want,ceilM);
        }
        const pool=fIn+Math.max(0,Vc);                // 這個月付得出來的上限 = 現金流收入 + 資產
        const paid=Math.max(0,Math.min(want,pool));
        if(wantRaw>0){
          // 「退休生活水準」只看退休後的月份(C12)。退休前的支出事件由 essOK 負責。
          if(mo>rMoS){wantSum+=wantRaw;gotSum+=paid;}
          // 必要支出優先:先看必要的部分有沒有被蓋住,剩下的才算彈性花到多少。
          const essPaid=Math.min(essW,paid);
          // 判準是「錢在不在」(收入+資產蓋不蓋得住必要支出),不是「這個月實際花了多少」。
          //
          // 試過用「實際花掉 < 必要支出」當判準,結果彈性提領的覆蓋率掉到 3% —— 因為 collar
          // 讓支出在基準上下持續微幅浮動,有一半的月份會低於 100%,而一個「曾經低於就算失敗」
          // 的二元判準對這種連續浮動的規則太脆弱:中位生活水準還有 97% 卻報「幾乎必然失敗」,
          // 那是誤導,不是誠實。
          // 「實際花到多少」這個問題已經由生活水準達成率(lifeRat)完整回答了,兩個指標各司其職:
          //   essOK  = 錢夠不夠(能力)      lifeRat = 實際過到什麼生活(結果)
          // ABW 末期會刻意把資產花到只剩遺產目標,所以最後一年不列入判定(同 ruinCut)。
          if(mo<=ruinCut&&pool<essW-1e-9)essShort++;
          if(discW>0){discWantSum+=discW;discGotSum+=Math.max(0,Math.min(discW,paid-essPaid));}
        }
        const net=fIn-paid;
        if(net>0){for(let i=0;i<active.length;i++)h[active[i]]+=net*(wT[active[i]]||0);}
        else if(net<0&&Vc>0){
          const f=Math.min(1,(-net)/Vc);
          for(let i=0;i<active.length;i++)h[active[i]]-=h[active[i]]*f;pend-=pend*f;
        }
      }
      while(trIdx<totT&&trM[trIdx]===mo){deploy();trIdx++;}
      const dcaDone=mo>=dcaMonths;
      mkt*=(1+idxRet);
      let V=0;active.forEach(k=>V+=h[k]);V+=pend;
      if(dcaDone){
        // 偏離帶再平衡(rebal/both):任一標的相對目標偏離 >50% 就拉回(賣高買低)
        if(mech==='rebal'||mech==='both'){
          let dev=0;active.forEach(k=>{const tw=wT[k]||0;if(tw>0.02){const d=Math.abs(h[k]/V-tw)/tw;if(d>dev)dev=d;}});
          if(dev>0.5)active.forEach(k=>h[k]=(wT[k]||0)*V);
        }
        /* 準備金加碼 + 創新高補回(reserve/orig/deep3/both)
           deep3 走 reserve 那一支(不做偏離帶再平衡、創新高時強制拉回目標權重)——
           這對應 /timing/ 的「創新高就把準備金補回來」:賣掉一部分正二換回現金,
           把 70/30 的比例回復。both 是唯一不強制拉回的(它另有偏離帶再平衡在做這件事)。 */
        if(mechHasReserve(mech)){
          if(mkt>=peak){peak=mkt;fired=[false,false,false,false];if(mech!=='both')active.forEach(k=>h[k]=(wT[k]||0)*V);reserveBase=h['CASH']||0;}
          else if(hasMech){const dd=mkt/peak-1;for(let j=0;j<THR.length;j++)if(dd<=THR[j]&&!fired[j]){const amt=Math.min(POR[j]*reserveBase,h['CASH']);if(amt>0){h['CASH']-=amt;leverKeys.forEach(k=>h[k]+=amt*(wn[k]/leverW));}fired[j]=true;}}
        }else{if(mkt>peak)peak=mkt;}
      }else{if(mkt>peak)peak=mkt;}
      V=0;active.forEach(k=>V+=h[k]);V+=pend;if(V<0)V=0;
      if(Vret===0&&ageNow>=retire)Vret=Math.max(1,V);
      // ABW 依設計會在 maxAge 把資產花到只剩遺產目標,所以「最後一年趨近 0」是計畫完成,
      // 不是破產。不排除的話,一個數學上不可能提早花光的策略反而會report 出最高的破產率。
      if(ageNow>retire&&V<=0.01&&mo<=ruinCut)ruined=true;
      if(mo%12===0)cols[mo/12][p]=V;
      if(V>peakV)peakV=V;const dd2=peakV>0?(peakV-V)/peakV:0;if(dd2>maxdd)maxdd=dd2;
      if(mo<=36&&dd2>edd)edd=dd2;
      if(mo<=ddAccCut&&dd2>ddAcc)ddAcc=dd2;
    }
    Vfinal[p]=cols[nYears][p];VatRetire[p]=cols[rIdx][p];maxDDarr[p]=maxdd;early3[p]=edd;ddAccumArr[p]=ddAcc;survive[p]=ruined?0:1;
    essOK[p]=essShort===0?1:0;
    lifeRat[p]=wantSum>0?gotSum/wantSum:1;
    discRat[p]=discWantSum>0?discGotSum/discWantSum:NaN;
  }
  const p10=[],p50=[],p90=[];
  const buf=new Float64Array(paths);
  for(let y=0;y<=nYears;y++){
    buf.set(cols[y]);const a=Array.from(buf).sort((x,z)=>x-z);
    p10.push(a[Math.floor(0.10*paths)]);
    p50.push(a[Math.floor(0.50*paths)]);
    p90.push(a[Math.floor(0.90*paths)]);
  }
  return {p10,p50,p90,Vfinal,VatRetire,maxDDarr,ddAccum:ddAccumArr,early3,survive,essOK,lifeRat,discRat,nYears,age0,hasMech,wMode,abwRate,rMo:rMoS};
}

function percentile(arr,q){const a=Array.from(arr).sort((x,z)=>x-z);return a[clamp(Math.floor(q*a.length),0,a.length-1)];}
function fracGE(arr,th){let c=0;for(let i=0;i<arr.length;i++)if(arr[i]>=th)c++;return c/arr.length;}
const fracGEdd=fracGE;
/* 解出「資金加權報酬(IRR)」:期初 V0、**每月**投入 contrib/12、共 years 年,
   長成 Vend 所需的年化 r。

   ── 差異 C8(S5 落地)────────────────────────────────────────────────
   改版前用的是**期末年金**(每年底投入一整筆 contrib):
       V0(1+r)^n + C((1+r)^n − 1)/r = Vend
   但引擎是每個月投入 contrib/12,而且是**當月報酬結算之後**才加進去
   (simulate 的月內順序:① 市場報酬 → ③ 定期定額),所以正確的對應是
   **月期末年金**:
       V0(1+r)^n + (C/12)((1+rm)^(12n) − 1)/rm = Vend,   rm=(1+r)^(1/12)−1
   每月投入比每年底投入早進場,同樣的終值反推出來的 r 因此會系統性偏低 ——
   偏低的幅度隨 contrib 佔比放大,「中位路徑隱含年化」與「混合假設」會對不齊,
   而畫面上明明寫著兩者會貼齊。 */
function impliedCAGR(V0,contrib,years,Vend){
  if(years<=0)return 0;
  const nM=Math.round(years*12), cM=contrib/12;
  const f=r=>{
    let v;
    if(Math.abs(r)<1e-9)v=V0+cM*nM;
    else{
      const rm=Math.pow(1+r,1/12)-1;
      v=V0*Math.pow(1+r,years)+(Math.abs(rm)<1e-12?cM*nM:cM*(Math.pow(1+rm,nM)-1)/rm);
    }
    return v-Vend;
  };
  let lo=-0.95,hi=3.0;if(f(lo)>0)return lo;if(f(hi)<0)return hi;
  for(let i=0;i<200;i++){const mid=(lo+hi)/2;if(f(mid)>0)hi=mid;else lo=mid;if(hi-lo<1e-7)break;}
  return (lo+hi)/2;
}

// ---------- Coast / FIRE 計算 ----------
function milestones(sim,opts,fireNum){
  const {age0,retire,infl}=opts;
  const realR=opts.blendedReal;
  // Coast need at age a (today's money)
  const coastLine=[];
  for(let y=0;y<=sim.nYears;y++){
    const a=age0+y;
    let need;
    if(a>=retire)need=fireNum;
    else if(realR<=0)need=Infinity;
    else need=fireNum/Math.pow(1+realR,retire-a);
    coastLine.push(need);
  }
  // find crossover on median path
  let coastAge=null,fireAge=null,baristaAge=null;
  for(let y=0;y<=sim.nYears;y++){
    const a=age0+y,v=sim.p50[y];
    if(coastAge===null && v>=coastLine[y])coastAge=a;
    if(fireAge===null && v>=fireNum)fireAge=a;
    if(baristaAge===null && v>=fireNum*0.5)baristaAge=a;
  }
  // 一致性守則:Coast 用「確定性 blendedReal 投影」、Full 用「中位 MC 路徑」,兩者成長模型不同。
  // 若中位路徑到退休時都到不了 FIRE,就談不上「滑行到 FIRE」→ Coast 不算達成(消除 Coast早/Full永遠 的矛盾)。
  const rIdx=Math.max(0,Math.min(sim.nYears,retire-age0));
  const medAtRetire=sim.p50[rIdx];
  const coastConsistent=(medAtRetire>=fireNum); // 中位在退休時已達 FIRE → coast 才有意義
  if(coastAge!==null && !coastConsistent) coastAge=null;
  return {coastLine,coastAge,fireAge,baristaAge,medAtRetire,coastConsistent};
}

/* ═══════════ deriveOpts —— 輸入物件 → 模擬參數(純函式)═══════════

   原本這段是 gatherInputs() 的後半。前半(逐個 $('age').value 讀 DOM)留在 /plan/ 叫 readForm(),
   這裡只吃「已經正規化好的數字」,所以 /plan-result/ 不需要任何表單就能算。

   input 的欄位與單位(= ap_state_v2.input,見 assets/state.js):
     age retire            整數歲
     net mon exp pension   萬元
     infl swr              小數(0.02 = 2%)
     carry voldrag ssofin  小數
     abwHair abwTilt       小數
     floorA ceilA bequest  萬元
     dcaMonths glideStart  整數月 / 歲
     glide                 0|1
     mech engine dispmode  字串
     flexW                 0 固定 / 1 彈性 / 2 攤銷
     flows                 DSL 字串
     w                     {key: 小數} —— 0.30 代表 30%

   回傳的形狀刻意與舊的 gatherInputs() 完全一致,呼叫端(computeCore / saveReport /
   buildCompare …)一行都不用改。 */
function deriveOpts(input, over){
  over=over||{};
  const num=(v,d)=>{const n=+v;return isFinite(n)?n:d;};
  const carryDrag=num(input.carry,DEFAULTS.carryDrag);
  const volDrag=num(input.voldrag,DEFAULTS.volDrag);
  const ssoFin=num(input.ssofin,DEFAULTS.ssoFin);
  const defs=assetDefs(carryDrag,volDrag,ssoFin);
  const w={};ORDER.forEach(k=>w[k]=num(input.w&&input.w[k],0));
  /* ── 年齡正規化(docs/SPEC.md 差異 C5,S5 落地)────────────────────────
     simulate() 的 nYears = maxAge − age0 直接拿去當 cols[] 的長度,所以
     **非整數年齡會讓 cols[nYears] 變成 undefined 並丟 TypeError**
     (實測 age0=35.5 或 retire=64.5 都會炸)。舊版 computeCore() 的 setTimeout
     內沒有 try/catch,炸掉之後 busy 永遠停在 true、按鈕永久 disabled,
     畫面看起來就像當掉。修法是在**進引擎的唯一入口**把年齡取整並夾住範圍。

     刻意保留 retire <= age0(已屆退休)這種輸入:引擎本來就處理得了它
     (不會有定期定額、第一個月就開始提領),而 /plan-result/ ❺ 與 /report/ §7
     都有對應的標籤分支。SPEC 寫的「要求 retire > age0」在這裡改成
     **保證 maxAge > age0**(那才是真正會炸的條件)—— 強制把 retire 推到
     age0+1 反而會給已退休的人憑空多一年定期定額,那是更糟的謊。 */
  const age0=clamp(Math.round(num(input.age,35)),0,120);
  const retire=clamp(Math.round(num(input.retire,65)),0,120);
  const net0=num(input.net,0), mon=num(input.mon,0), exp=num(input.exp,0);
  /* spendNow = **現在**的年支出。**完全不進模擬** —— 純粹讓 /report/ 的
     緊急預備金建議(半年份)有正確的依據。改版前它借用 exp(退休後年支出),
     於是「把退休預算調低」會連帶調低緊急預備金建議,那是錯的。
     沒填時退回 exp,數字與改版前完全相同。 */
  const spendNow=(()=>{const v=num(input.spendNow,0);return v>0?v:exp;})();
  const pension=num(input.pension,0);
  const infl=num(input.infl,0.02), swr=num(input.swr,0.035);
  const maxAge=Math.max(retire+25,90,age0+1);
  const annualContrib=mon*12;
  const blendedReal=blendedMuNom(w,defs)-infl;
  const dcaMonths=Math.max(0,num(input.dcaMonths,0)), dcaTranches=dcaMonths>0?dcaMonths:1; // 每月一筆
  const glide=num(input.glide,0), glideStart=num(input.glideStart,45);
  const mech=input.mech||'both';
  const withdraw=Math.max(0,exp-pension); // 退休後每年提領(實質)
  const wSel=num(input.flexW,0);
  const wMode=wSel===2?'abw':(wSel===1?'collar':'fixed');
  const flexWithdraw=(wMode==='collar');
  const abwHair=Math.max(0,num(input.abwHair,0.01));
  const abwTilt=num(input.abwTilt,0);
  const bequest=Math.max(0,num(input.bequest,0));
  const engine=input.engine||'param';
  // 額外的時間軸現金流(1.5,選填)。1.1 的年支出與年金是永遠存在的兩筆合成列,
  // 由 buildFlowSchedule 自己補上 —— 所以沒填 1.5 的人,結果與改版前一致。
  const flows=parseFlows(input.flows||'');
  const sched=buildFlowSchedule(flows,{age0,retire,maxAge,infl,exp,pension});
  const floorA=Math.max(0,num(input.floorA,0));
  const ceilA=Math.max(0,num(input.ceilA,0));
  const opts={age0,maxAge,retire,annualContrib,infl,paths:over.paths||1500,net0,blendedReal,dcaMonths,dcaTranches,glide,glideStart,mech,withdraw,flexWithdraw,engine,volDrag,carryDrag,ssoFin,sched,floorA,ceilA,wMode,abwHair,abwTilt,bequest};
  const flowsRaw=String(input.flows||'');   // 原字串照留 —— 存進 result 才能原樣還原分享連結
  // FIRE 數字刻意只看 1.1 的基本收支:它是「4% 法則」式的粗估目標,
  // 不該被「房貸繳到 60 歲」這種暫時性支出永久推高。現金流的完整影響會反映在
  // 退休提領模擬(2.1 的成功率)裡 —— 那才是真正回答「夠不夠」的地方。
  const fireNum=Math.max(0,(exp-pension))/swr; // 私人本金需求(扣年金)
  const fireNumFull=exp/swr;
  return {carryDrag,volDrag,ssoFin,defs,w,age0,retire,net0,mon,exp,spendNow,pension,infl,swr,maxAge,annualContrib,dcaMonths,glide,glideStart,opts,fireNum,fireNumFull,mech,withdraw,flexWithdraw,flows,flowsRaw,sched,floorA,ceilA,wMode,abwHair,abwTilt,bequest};
}

/* ═══════════ buildResult —— 模擬輸出 → ap_state_v2.result(純函式)═══════════

   欄位涵蓋舊的 ap_report_v1 全部內容(docs/SPEC.md §8.2),外加決議 D1 的
   ddAccumMed / ddAccumP90。

   為什麼在引擎裡:S4 起有兩個地方會產生結果 —— /plan/ 按「▶ 開始計算」、
   /plan-result/ 發現結果過期時自己重算。**兩邊必須產出逐欄相同的物件**,
   否則「同一份計畫在兩頁上數字不一樣」會是最難查的一種 bug。
   呼叫端只負責 APState.setResult(E.buildResult(ci,sim,ms)) —— 那一步會補上
   computedAt 與 inputHash。

   band 只存數字,不存任何圖片 dataURL —— 一張 base64 圖就能把 localStorage 撐爆。 */
function buildResult(ci, sim, ms){
  const mean=a=>{let s=0;for(let i=0;i<a.length;i++)s+=a[i];return s/a.length;};
  const yrs=ci.retire-ci.age0;
  const medRetire=percentile(sim.VatRetire,0.5);
  const cagr=yrs>0?impliedCAGR(ci.net0,ci.annualContrib,yrs,medRetire):null;
  const ddMed=percentile(sim.maxDDarr,0.5);
  // Calmar 的分母改用**累積期**回撤中位(決議 D1 / 差異 C1,S5 落地)。
  // 用全期的話分母被「退休後照計畫花掉」撐大(固定提領中位就 −59%、ABW 是 −100%),
  // Calmar 被系統性壓低,而讀者會以為那是「這個配置的風險調整後報酬很差」。
  const ddAccMed=sim.ddAccum?percentile(sim.ddAccum,0.5):null;
  const calmarDD=(ddAccMed!=null)?ddAccMed:ddMed;
  const dArr=sim.discRat?Array.from(sim.discRat).filter(v=>isFinite(v)):[];
  const w=ci.w;
  let tot=0;ORDER.forEach(k=>tot+=(w[k]||0));
  const wn={};ORDER.forEach(k=>{if((w[k]||0)>0&&tot>0)wn[k]=+((w[k]/tot).toFixed(4));});
  const band={ages:[],p10:[],p50:[],p90:[]};
  for(let y=0;y<=sim.nYears;y++){
    band.ages.push(ci.age0+y);
    band.p10.push(Math.round(sim.p10[y]));band.p50.push(Math.round(sim.p50[y]));band.p90.push(Math.round(sim.p90[y]));
  }
  return {
    v:1, updated:new Date().toISOString().slice(0,10),
    in:{age0:ci.age0,retire:ci.retire,maxAge:ci.maxAge,net0:ci.net0,mon:ci.mon,exp:ci.exp,
      spendNow:ci.spendNow,pension:ci.pension,
      infl:ci.infl,swr:ci.swr,dcaMonths:ci.dcaMonths,mech:ci.mech,flexW:ci.flexWithdraw?1:0,
      wMode:ci.wMode,abwRate:sim.abwRate||0,bequest:ci.bequest||0,
      engine:ci.opts.engine,glide:ci.glide,glideStart:ci.glideStart,
      floorA:ci.floorA||0,ceilA:ci.ceilA||0,flows:ci.flowsRaw||'',
      carry:ci.carryDrag,volDrag:ci.volDrag,ssoFin:ci.ssoFin},
    w:wn, netExp:netExposure(w), muNom:blendedMuNom(w,ci.defs),
    fireNum:ci.fireNum, fireNumFull:ci.fireNumFull,
    ms:{coastAge:ms.coastAge,fireAge:ms.fireAge,baristaAge:ms.baristaAge},
    ret:{spend:ci.sched?ci.sched.baseAtRetire:ci.withdraw, inc:ci.sched?ci.sched.incAtRetire:0},
    risk:{
      pFire:fracGE(sim.VatRetire,ci.fireNum),
      survive:mean(sim.survive), essOK:sim.essOK?mean(sim.essOK):null,
      lifeP50:sim.lifeRat?percentile(sim.lifeRat,0.5):1, lifeP10:sim.lifeRat?percentile(sim.lifeRat,0.10):1,
      discP50:dArr.length?percentile(dArr,0.5):null, discP10:dArr.length?percentile(dArr,0.10):null,
      // ddAll(全期,含退休後照計畫花掉的部分)。**不要拿它給使用者看**,見 D1/D4。
      ddMed, ddP90:percentile(sim.maxDDarr,0.9),
      // ddAccum(累積期,退休前)—— 這才是「市場會讓你痛多深」,一頁式結果與計劃書都用它。
      ddAccumMed:ddAccMed,
      ddAccumP90:sim.ddAccum?percentile(sim.ddAccum,0.9):null,
      e3Med:percentile(sim.early3,0.5), e3P90:percentile(sim.early3,0.9),
      cagrReal:cagr, calmar:(cagr!=null&&calmarDD>1e-6)?cagr/calmarDD:null,
      legacyMed:percentile(sim.Vfinal,0.5), medRetire, p10Retire:percentile(sim.VatRetire,0.10)},
    band
  };
}

/* ═══════════ 解讀層 —— 讓三頁用同一套定義講同一個數字(S10)═══════════

   ❻「退休以後夠不夠」的五個數字,改版前的狀況是:
     · /plan-result/ 只有 essOK 有一行括號說明,其餘四個**一個字都沒有**;
     · /report/ 五個全部裸奔 —— 而它是列印用的,連名詞氣泡都點不開;
     · /plan/ 的並排比較表反而寫了 hint,但那三行是硬編在那張表裡的。
   同一個指標在三頁各講各的(或不講),是 C10 / C17 / C21 的同一種病。
   這裡收成單一真相:label + hint(一行白話定義)。頁面專屬的長篇解說留在各頁。

   口徑全部對照 buildResult() 的 risk:{},不是憑印象寫的:
     essOK   engine.js 的 essShort 迴圈從 mo=1 起算 → **全期**,不是只有退休後
     pFire   fracGE(VatRetire, fireNum) → 退休那一年、提領之前的單一時點
     survive ageNow>retire 才判定,且 ABW 末 12 個月豁免
     lifeP50 分子分母都只累計 mo>rMoS(差異 C12)→ 只看退休後
     legacy  Vfinal = cols[nYears] → 計畫終點(maxAge)那一年 */
const RISK_META={
  essOK:  {label:'必要支出全程撐得住',
           hint:'從現在到計畫終點,每個月的「當月收入 ＋ 手上資產」都付得出當月必要支出'},
  pFire:  {label:'達標把握',
           hint:'退休那一年、還沒開始提領時,資產 ≥ 目標金額'},
  survive:{label:'資產未歸零',
           hint:'退休後一路到計畫終點,資產一次都沒被花到 0'},
  lifeP50:{label:'退休生活水準達成率(中位)',
           hint:'退休後實際花掉 ÷ 原本想花,排在正中間的那條路徑'},
  // hint 必須**自己站得住** —— /report/ 沒有印 lifeP50 那一列,寫「同上」會沒有上文。
  // 單一真相的字串不能依賴某一頁的排版順序。
  lifeP10:{label:'退休生活水準達成率(P10)',
           hint:'退休後實際花掉 ÷ 原本想花,只看最差的十分之一那條路徑 —— 壞年份會被砍掉多少生活費'},
  legacy: {label:'中位剩餘遺產',
           hint:'計畫終點那一年還剩多少(今天的購買力);它同時是「存太多」的溫度計'},
};

/* 攤銷式提領的隱含提領率 —— 把本金在 n 年內剛好花完(不留遺產)時,第一年能領走的比例。
   標準年金攤還:pmt / PV = r / (1 − (1+r)^−n);r → 0 時退化成 1/n。

   **它只做一件事**:讓使用者看見「SWR 假設永遠不動本金、攤銷假設剛好花完」差多少 ——
   也就是「在餘命內把錢花完,目標會不會變低」這個問題的答案。
   不進任何模擬、不影響 fireNum,也**不是** ABW 引擎內部的數字:
   那個是月頻、含支出傾斜(abwTilt)與遺產目標(bequest),見 buildPVTables()。 */
function amortRate(rReal,years){
  const n=Math.max(1,+years||0), r=Math.max(0,+rReal||0);
  return r<1e-9?1/n:r/(1-Math.pow(1+r,-n));
}

return {
  // 數值工具
  clamp, randn, studentT, percentile, fracGE, fracGEdd, impliedCAGR,
  mulberry32, seedRand, amortRate,
  // 指標的白話定義(單一真相,/plan-result/ ❻ 與 /report/ §6 共用)
  RISK_META,
  // 標的與權重
  ORDER, LEV, LEV_KEYS, DEFAULT_W, DEFAULTS, isLev, levMult,
  l2muNom, ssoMuNom, assetDefs, blendedMuNom, netExposure,
  ASSET_META, ASSET_COLOR, SHORT, DNAME, CATS,
  // 統一風險階梯(S8);取代原本的 PRESETS
  LADDER, LADDER_BY_RUNG, LEV_RUNG_MIN, MAX_AUTO_RUNG, ladderRungs, ladderWeights,
  // 加碼水位(單一真相)
  MECH_BANDS, mechBands, mechHasReserve,
  // 歷史重抽
  HIST_Y0, HIST_SR, HIST_BR, HIST_N, sampleBlockYears, histAnnualReal,
  // 現金流
  FLOW_MAX, FLOW_VER, flowClean, parseFlows, serializeFlows, flowMonths, buildFlowSchedule,
  // 模擬
  buildPVTables, simulate, milestones, deriveOpts, buildResult,
};
});
