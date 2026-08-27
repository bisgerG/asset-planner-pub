/* ═══════════════════════════════════════════════════════════════════════
   assets/shell.js — 共用導覽殼(S2)

   提供 docs/IA.md §4.2 的六個元件裡屬於行為的四個:
     ① 頂部導覽(五頁一致、含目前頁高亮)
     ② 進度指示(你走到哪一步)
     ③ 進階展開器(收合狀態記進 ap_state_v2.ui)
     ④ 名詞小氣泡 + **單一份辭典**
   另外兩個(設計 token、風險橫幅)是純樣式,在 assets/ui.css。

   用法:
     <link rel="stylesheet" href="../assets/ui.css">
     <script src="../assets/state.js"></script>
     <script src="../assets/shell.js"></script>
     …頁面內容…
     <script>APShell.init({page:'plan', glossary:{roots:['#tab0','#tab1']}});</script>

   ═══ 辭典的合併(docs/IA.md §4.4)═══════════════════════════════════
   改版前 /plan/ 有 32 條、/timing/ 有 60 條,**14 個鍵完全重複而且內容不一致**。
   合併規則:
     · 兩邊都有的 14 個鍵以 /timing/ 的版本為準(比較新、比較白話)
       leverage / leverage_2x / net_exposure / reserve / drawdown / rebalance /
       cagr / calmar / monte_carlo / backwardation / internal_fee / sso /
       tqqq_qld / volatility_decay
     · 同概念不同鍵名的三對合併,不留兩份:
       block_bootstrap(plan) ＝ bootstrap_block(timing)
       drawdown ＝ mdd          (timing 兩個都有;mdd 講的是「最大」回撤)
       percentile_band(plan) ≈ percentile(timing)
     · /plan/ 獨有的 16 條全部併入。
   32 + 60 − 14 − 3 = **75 條**;之後陸續補到 **84 條**
   (S12 的兩條退休金 + 2026-08 稽核補的七條:標的／前瞻假設／多頭／緊急預備金／匯率風險／累積期／對數刻度,
    另把「大盤」與「曝險」掛成既有條目的別名 —— 它們是全站出現最多、卻從來沒被標過的兩個詞)。

   合併時另外做了一件事:原本 /timing/ 的文案大量使用「這頁」。辭典變成全站共用之後,
   /plan/ 的讀者點開「準備金」會看到「這頁固定佔每個市場資金的 30%」—— 那是挑時機的規則,
   不是他正在看的東西。所以凡是指向特定頁面規則的地方,一律改寫成明確的指涉
   (「② 挑時機」/「① 配資金」),不留下會說謊的代名詞。
   ═══════════════════════════════════════════════════════════════════════ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.APShell = factory();
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this), function () {
'use strict';

const $ = id => document.getElementById(id);
const S = (typeof APState !== 'undefined') ? APState : null;

/* ═══════════════════════════════════════════════════════════════════════
   1. 名詞辭典(84 條,全站唯一一份)
   ═══════════════════════════════════════════════════════════════════════ */
const GLOSSARY = [

/* ── 市場與商品 ───────────────────────────────────────────────── */
{key:'index',term:'指數／加權指數',short:'把一整個市場的股票合起來算成一個數字，用來看整體漲跌。',long:'指數是把市場上一大堆股票按公司規模加權平均，濃縮成一個數字，例如台灣加權指數、美國 S&P500。它代表「整個市場的平均」而不是某一家公司，所以指數漲 1%，意思是市場整體平均漲 1%。本站講的下跌、創新高，全部是看指數，不是看個股。'},
{key:'etf',term:'ETF',short:'一檔就買進一籃子股票的基金，可以像股票一樣在盤中買賣。',long:'ETF 是一種「一次買一整籃股票」的基金，掛在交易所，開盤時間隨時能買賣，價格跟著它追蹤的那一籃子股票走。買一張追蹤台灣前 50 大公司的 ETF，等於同時當這 50 家公司的小股東，不必自己挑股票。本站提到的 0050、VT、00685L、SSO 都是 ETF。'},
{key:'sp500',term:'S&P500',short:'美國最具代表性的 500 家大公司指數，常被當成美股大盤。',long:'S&P500 收錄美國最具代表性的 500 家上市公司，依公司規模加權，一般直接當成美國股市的代表。你日常會用到的蘋果、微軟、可口可樂都在裡面。「② 挑時機」美股那一份錢追蹤的就是它，所有「跌 25% 就投一批」的判斷也是看這個指數。'},
{key:'nasdaq',term:'那斯達克',short:'美國以科技股為主的市場與指數，漲跌通常比較劇烈。',long:'那斯達克是美國的一個交易所，也是同名指數，成分以科技公司為主（那斯達克 100 就是其中最大的 100 家）。因為產業集中，它漲得比 S&P500 多、跌得也更兇，2000 年網路泡沫時最深跌掉約八成。本站測過把它加進來，結論是最好的配置比重是 0。'},
{key:'00631l',term:'00631L',short:'元大台灣50正2，台灣規模最大的 2 倍槓桿 ETF，但追的不是大盤。',long:'00631L 全名「元大台灣50正2」，2014 年掛牌，是台灣同類商品中規模最大的（約 2,224 億）。⚠ 它追的是<b>台灣50</b>，不是本站訊號在看的大盤。過去它純用臺股期貨建倉，交付的實質上就是 2 倍大盤，所以剛好對得上；但<b>2026-05-19 起元大加進台積電現貨</b>去強化追台灣50，官方明講要和 2 倍大盤「做出區隔」。<b>本站因此改用 00685L</b>，買 00631L 而照本站訊號操作，你看的和你買的不是同一個指數 —— 詳見「② 挑時機」的風險第 ④ 條。'},
{key:'00685l',term:'00685L',short:'群益臺灣加權正2，本站台股那一份槓桿錢用的標的。',long:'00685L 全名「群益臺灣加權正2」，2017 年掛牌，追蹤「臺指日報酬兩倍指數」—— 也就是<b>大盤（加權指數）的每日兩倍</b>，正是本站所有加碼訊號在看的東西。四檔台股正二裡它的內扣費用最低（0.48%），掛牌至今 9.3 年扣完所有費用的實際落後只有 0.15%/年，也是四檔最小。⚠ 兩件要注意：它的成交量約是 00631L 的四分之一，大跌那幾天想立刻買到想要的量、價差可能難看；而且 2026-07-07 剛做過「1 拆 24」，查歷史股價圖時那天會看起來像暴跌。'},
{key:'sso',term:'SSO',short:'在美股掛牌、每天做到 S&P500 兩倍漲跌的 ETF。',long:'SSO 是在美國掛牌的 2 倍槓桿 ETF，目標是每天賺賠 S&P500 指數的兩倍，2006 年成立，完整走過 2008 年金融海嘯：從高點最深跌掉約 85%，花了 6 年才回到前高 —— 這就是它的真實風險刻度。它是本站美股那一份錢的槓桿主角。要買它得開美股帳戶或透過國內券商複委託，也要一併考慮美國遺產稅。'},
{key:'tqqq_qld',term:'TQQQ／QLD',short:'追蹤那斯達克 100 的 3 倍與 2 倍槓桿 ETF，波動更兇。',long:'QLD 是那斯達克 100 的每日 2 倍、TQQQ 是每日 3 倍槓桿 ETF。本站實測後刻意不採用：那斯達克約七成的漲跌可以直接被 S&P500 解釋，換上它們等於把美股部位再壓一次科技股 —— 那叫加碼，不叫分散。而且 3 倍的那斯達克部位持有 20 年，仍有 41% 的時間區間是虧錢的（不開槓桿是零個），2000 年 3 月網路泡沫頂點進場的 TQQQ 式部位，26 年後到今天仍然是負的。<br>⚠ <b>但反過來也要講，不然你會被一句真話打臉：</b>真實的 TQQQ 是 <b>2010 年 2 月才掛牌的</b>，它根本沒有經歷過 2000 與 2008。從掛牌到今天這 16.5 年，TQQQ 漲了 <b>343 倍</b>、QQQ 只有 19 倍 —— 它<b>大勝原型 18 倍</b>。<br>兩件事都是真的，差別只在<b>起點</b>：從 2000 年起算它 26 年還沒回本，從 2010 年起算它是全市場最猛的東西之一。<b>任何只給你一個起點的槓桿回測，都該當廣告看</b>（包含上面那個 2000 年的版本）。'},
{key:'futures',term:'期貨',short:'約好未來某天用某個價格買賣，能用小錢操作大部位。',long:'期貨是現在就約好「未來某天、用某個價格」交易，只要付一成左右的保證金，就能操作十倍大的部位。2 倍 ETF 內部用期貨做出兩倍漲跌的效果，但<b>操作的是基金公司</b> —— 買 ETF 的你不會自己簽期貨合約，也不會被要求補保證金。'},
{key:'nav',term:'淨值',short:'一單位 ETF 或基金實際值多少錢。',long:'淨值是把 ETF 持有的所有資產換算成錢、除以發行單位數，算出一單位實際值多少。管理費這類內扣費用<b>每天直接從淨值裡扣掉</b>，你不會收到帳單，但長期會反映在淨值成長變慢上 —— 台股正二每年約 0.48%~1.16%（四檔各不相同）就是這樣扣的。'},
{key:'time_deposit',term:'定存',short:'把錢存進銀行約定一段時間，領固定利息，本金不會虧。',long:'定存是把一筆錢存在銀行、約定一段時間（例如 1 年），銀行照約定利率給利息，到期領回本金加利息。中途解約利息會變少，但本金一直都不會虧，是那筆「先放著不動的現金」最保守的一種放法。'},
{key:'short_term_bond',term:'短期債',short:'借錢給政府或大公司、1~3 年到期的債券，風險低。',long:'短期債是政府或信用好的大公司為了借錢發行的憑證，買下它等於借錢給對方，1~3 年後對方還你本金加利息。風險比股票低很多，利息通常比定存略高。一般人多半透過債券 ETF 買進，不是直接買單一張債券。'},
{key:'sub_brokerage',term:'複委託',short:'透過台灣券商下單買國外股票，不用自己開海外戶頭。',long:'複委託是台灣的證券公司幫你把買賣單轉去國外市場下單，在台灣的帳戶裡就能買到 VT、SSO 這種美股 ETF，不用自己跑到國外開戶。代價是手續費比直接開美股帳戶貴不少。'},
{key:'us_estate_tax',term:'美國遺產稅',short:'非美國人持有美股，超過 6 萬美元的部分可能被課到 40%。',long:'美國對非美國稅務居民留下的美國資產課遺產稅，免稅額只有 6 萬美元，超過的部分最高稅率 40%。而且繼承人通常得先完稅才領得出來。這是本站回測完全沒有計入、卻真實存在的成本，美股部位越大越該先跟會計師確認持有方式。'},
{key:'daily_price_limit',term:'單日漲跌幅限制',short:'台股一天有漲跌上限，讓 2 倍 ETF 不可能一天就歸零。',long:'台股個股一天最多漲跌 10%，而槓桿型 ETF 的上限是它的兩倍，也就是 ±20%（規模最大的 00631L 實測最差的一天剛好就是 −20.00%）。跌 20% 是剩下 80%，再跌 20% 剩 64%，一直乘下去只會越來越小、永遠除不到 0。這是台股槓桿 ETF 不會被單日崩盤一次清空的原因 —— 但長期被磨光的風險依然存在。'},

/* ── 2026-08 補的六條：稽核發現這幾個詞在新手入口（首頁、九題精靈）出現頻率很高，
   卻一條都不在辭典裡，於是那幾段只能在正文裡自己解釋一次，正文就變成文字牆。 */
{key:'holding',term:'標的',short:'你實際買的那個東西 —— 某一檔 ETF 或某一支股票。',long:'「標的」就是你下單時真正買到的那個東西：0050 是一個標的，00685L 是另一個標的，放在銀行的現金也算一個。本站所有表格裡的「標的」欄位，寫的就是「這筆錢要買什麼」。它跟「市場」不同：市場是台股、美股這種大分類，標的是你在那個市場裡買的具體那一檔。'},
{key:'forward_assumption',term:'前瞻假設',short:'對未來的一組假設數字，不是預測，更不是保證。',long:'本站所有的報酬數字都是<b>前瞻假設</b>：我們先講明「假設台股長期每年 7%、波動 21%」，再用這組假設去算你會遇到什麼。它跟「預測」的差別很重要 —— 預測是說「我認為未來會這樣」，假設是說「如果是這樣，結果會長這樣，而你可以自己把假設改掉」。所有假設值旁邊都有灰色的「假設值」小標籤，你在「⚙ 配資金」可以逐一調整。'},
{key:'bull_market',term:'多頭',short:'市場長時間往上走的那段期間。',long:'多頭是指市場整體長時間往上走的階段（反過來一路向下的叫空頭）。這個詞在本站很重要，因為<b>所有回測用的歷史剛好都落在人類史上最好的一段多頭裡</b>：1928 年以來的美股、1990 年代以來的台股。用這段歷史算出來的報酬，天生就偏樂觀 —— 這是本站最大也最無法排除的一個偏差。'},
{key:'emergency_fund',term:'緊急預備金',short:'放在投資之外、隨時能動用的現金，通常抓 6 個月生活費。',long:'緊急預備金是專門用來應付失業、生病、家裡臨時要用錢的一筆現金，放在銀行或活存，<b>不能算進投資</b>。抓 6 個月的生活費是常見的抓法。它的用途不是賺錢，是讓你在市場最低點的時候<b>不必賣股票</b> —— 沒有這筆錢的人，一遇到意外就會被迫在最糟的時間點賣出，那是把帳面虧損變成真虧損最常見的路徑。這也是本站把它排在投資之前的原因。'},
{key:'fx_risk',term:'匯率風險',short:'買美股是用美元計價，美元漲跌會直接影響你換回台幣拿到多少。',long:'買 VT、VOO、SSO 這種美股 ETF，你的錢會先換成美元。就算它在美國漲了 10%，如果同一段時間美元對台幣貶值 10%，換回台幣就等於白忙一場（反過來也成立）。這是台股標的沒有的一層風險。長期來看美元兌台幣大致打平（2004 年以來年化約 +0.05%），所以它不太影響長期報酬，但短期會讓帳面多晃一層。'},
{key:'accumulation',term:'累積期',short:'退休之前、還在存錢的那幾十年。',long:'本站把人生分成兩段：<b>累積期</b>（退休之前，一邊工作一邊投入，資產往上長）與<b>提領期</b>（退休之後，開始把錢領出來花）。分開講很重要，因為「最壞會有多壞」只算累積期 —— 提領期的資產本來就會一路往下（那是你在花錢，不是市場在跌），把它算進去會得到 −100%，那個數字沒有意義。'},
{key:'log_scale',term:'對數刻度',short:'縱軸每一格代表「乘幾倍」，不是「加多少」。',long:'一般的圖，縱軸每一格是固定金額（100 萬、200 萬、300 萬）；對數刻度的每一格是固定倍數（100 萬、1000 萬、1 億）。投資的圖幾乎都用它，因為三十年的成長差距太大，用一般刻度會讓前十年被壓成一條貼著底的線、什麼都看不出來。<b>副作用：對數刻度畫不出 0</b>，所以歸零的路徑會貼著圖的下緣走，不要拿那張圖目測破產率。'},

/* ── 槓桿與它的三層成本 ───────────────────────────────────────── */
{key:'leverage',term:'槓桿',short:'用比自己本金更大的部位去投資，賺賠都會同步放大。',long:'槓桿是讓你的資金去承擔比它本身更大的市場變動：100 元本金承擔 200 元的漲跌，就是 2 倍槓桿。好處與代價完全對稱 —— 市場漲 10% 你賺 20%，跌 10% 你賠 20%，而且賠掉 50% 之後要漲 100% 才回得來。這個不對稱是槓桿最容易被低估的地方。'},
{key:'leverage_2x',term:'2 倍槓桿（正二）',short:'每天讓你的漲跌等於指數的兩倍，不是長期報酬的兩倍。',long:'「正 2」是指這檔 ETF 每一個交易日的漲跌，都設計成當天指數的兩倍：指數漲 1%，它漲約 2%；指數跌 1%，它跌約 2%。關鍵在「每天」重新計算，所以長期下來不會剛好等於指數報酬的兩倍（見波動耗損）。00631L、00685L 和 SSO 都屬於這一類。'},
{key:'net_exposure',term:'淨曝險',short:'你的錢實際跟著市場波動的倍數，最該盯的單一風險刻度。',long:'淨曝險回答「市場動 1%，你的錢會動幾 %」：把每個標的的權重乘上倍率再加總 —— 正二/SSO 算 2 倍、現金與債券算 0、其他 1 倍。（債券在本工具的模型裡對市場的 beta 約 −0.04，四捨五入為 0；它自己的利率風險不在這個數字裡，由「回撤」負責。）100% ≈ 全押大盤；120~140% 是溫和槓桿；超過 150% 偏積極。它比「我買了幾 % 槓桿」誠實，因為把現金的緩衝也算進去了。'},
{key:'volatility_decay',term:'波動耗損',short:'上下震盪會慢慢磨掉 2 倍 ETF 的價值，就算指數回到原點。',long:'因為 2 倍 ETF 每天重新計算，一來一回就會虧。指數今天跌 10%、明天漲 11.1% 剛好回到原點，2 倍 ETF 卻是先跌 20% 剩 0.80，再漲 22.2% 只回到 0.978，憑空少了 2%。橫盤震盪拖越久磨得越兇，這是槓桿真實而且無法避免的長期成本，也是「大盤回原點、正二回不來」的原因。'},
{key:'backwardation',term:'逆價差',short:'未來月份的期貨比現在便宜，長期持有的人反而佔便宜。',long:'台股的 2 倍 ETF 用期貨來放大部位，而期貨有到期日，每個月得換到下一個月的合約。當下個月的報價比較便宜（這就叫逆價差），換約等於打折續約。<br><b>為什麼會比較便宜？兩層原因，要分開看：</b><br>① <b>除息</b>（結構性、幾乎一定有）：股票會除息、期貨不會，所以期貨天生就要比現貨便宜一個股息。台股每年 3~4% 的現金殖利率，就是靠這條進到正二的淨值裡 —— <b>這也是為什麼正二追得上「含息」指數而不只是股價指數</b>。<br>② <b>情緒</b>（會反覆、可能變號）：想做空避險的人多，期貨就更便宜；想開槓桿做多的人多，期貨就變貴（正價差）。<br><b>2022 年之後反轉的是第 ② 層，不是第 ①</b>。<br>實際結果：00685L 掛牌至今 9.3 年，扣完所有費用的落後只有 <b>0.11%/年</b>，等於免費開了 9 年槓桿。⚠ 但<b>近三年不是</b>：2023 年起落後 <b>7.6%/年</b>，第 ① 層那 3~4% 也被吃光了。「① 配資金」把它固定抓 3%/年（介於兩者之間），旁邊會顯示實測值給你對照。'},
{key:'financing_cost',term:'融資成本',short:'SSO 借錢開槓桿要付的利息，大約等於美元短期利率。',long:'美股 2x 用 SWAP 合約借錢，借的那一倍要付利息。零利率年代（2010~21）幾乎免費；現在短率 4% 上下，就是每年約 4% 的拖累。利率降它就便宜回來 —— SSO 的成本是「週期性」的，跟正二逆價差的「結構性」不同。'},
{key:'internal_fee',term:'內扣費用',short:'每天直接從 ETF 淨值裡扣掉的管理成本，你不會收到帳單。',long:'內扣費用是經理費、保管費和其他運作成本的總和，<b>每天從淨值裡扣</b>，所以你的對帳單上永遠看不到這一筆，它只會讓淨值長得比指數慢一點。台股四檔正二從 0.48% 到 1.16% 都有，差一倍以上；市值型 ETF 通常低於 0.2%。聽起來都很小，但這是每年扣、而且會複利的 —— 差 0.68% 持有十五年，終值大約差兩成。'},
{key:'total_return',term:'含息',short:'把配息也算進去的報酬，才是你真正拿到的。',long:'「含息」是指把公司發的股利也計入報酬。台股大盤指數本身不含股利，但股利每年大約貢獻 3~4%，長期累積差距非常大。本站所有回測一律用含息的版本，否則會低估長期報酬；看到別人報「大盤 30 年只漲幾倍」時，也要先確認對方含不含息。'},
{key:'margin_trading',term:'融資',short:'只出一部分錢，剩下跟券商借來買股票。',long:'融資是你只出一部分錢（例如四成），剩下跟券商借，去買比自己資金更大金額的股票，要付利息、會被追繳。本站用的 2 倍 ETF 已經用期貨做出兩倍效果，<b>規則明確禁止再融資買它</b> —— 兩層槓桿疊在一起，才是真正會讓你歸零的做法。'},
{key:'pledge',term:'質押',short:'把手上的股票押給銀行或券商，換一筆現金。',long:'質押是拿手上的股票當抵押品，跟銀行或券商借出現金，股票不用賣掉，但股價跌太多一樣會被要求補錢、甚至被強制處分。本站<b>明確禁止</b>拿 2 倍 ETF 去質押借錢 —— 它本身已是槓桿，再借一次等於疊第二層風險。'},
{key:'margin_call',term:'追繳',short:'跟券商借錢買股票，虧到一定程度被要求補錢進去。',long:'追繳是你跟券商借錢買股票之後，股價跌到一定門檻，券商要求你在期限內把現金補進帳戶，不補就會被強制賣出。<b>本站的做法全部用自己的錢，沒有跟任何人借錢，不會遇到追繳。</b>'},
{key:'forced_liquidation',term:'斷頭',short:'追繳補不出錢時，券商把你的部位強制賣光。',long:'斷頭是追繳之後你沒有在期限內補錢，券商直接把你的股票或期貨強制賣掉還款，不會等你同意 —— 而且往往發生在最低點。<b>本站的做法沒有借錢，不會被斷頭</b>，最慘也只是帳面虧損，部位仍在你自己手上。'},

/* ── 風險與報酬的刻度 ─────────────────────────────────────────── */
{key:'drawdown',term:'回撤／最大回撤（MDD）',short:'從最近的最高帳面金額算起，現在跌了多少；最大回撤是史上最慘的那一次。',long:'回撤是「從你曾經看過的最高帳面金額，跌到現在少了幾成」。100 萬漲到 120 萬後掉回 90 萬，回撤是從 120 萬算起的 −25%，不是從本金 100 萬算。<b>最大回撤（MDD）</b>則是整段期間最深的那一次 —— 它決定你會不會在半夜恐慌、砍在最低點。舉個真的發生過的數字：「② 挑時機」那套 70/30 做法在 <b>2000-07 起算的那 26 年裡</b>最大回撤是 <b>−77.1%</b>，100 萬會一度只剩約 23 萬，之後要漲超過 4 倍才回得到原點。這不是理論假設，是決定要不要照著做之前最該先想清楚的一件事。<br>⚠ <b>「最大」是相對那一段期間說的，不是台股史上最壞。</b>那個回測的起點 2000-07-03，收盤本身就已經在 2000-02-17 的高點下方 <b>18.7%</b> —— 回測的高水位從你進場那天重新起算，所以它量的是「2000 年 7 月才進場的新投資人」。把起點拉回 1999 年、讓真正的頭部進到樣本裡，同一套固定 2 倍的最大回撤是 <b>−90.1%</b>。'},
{key:'all_time_high',term:'歷史高點',short:'這個指數到目前為止收過的最高點位，當作比較的基準。',long:'歷史高點是指數從過去到現在收盤過的最高數字。所有「跌了幾 %」都是拿現在的點位跟這條線比，例如高點 20000 點、現在 15000 點，就是跌 25%。指數重新創新高，也就是這條線被往上推、準備金可以回補的時候。'},
{key:'longest_underwater',term:'最長水下',short:'從跌破前一次高點到重新站回去，最久花了多久。',long:'「水下」是指帳面還沒回到前一次高點的那段日子，最長水下就是歷史上最久的一次。這段期間你每天打開帳戶看到的都是虧損。⚠ 這個數字很吃起點：2000 年起算是 3.6 年，起點拉回 1995 年就變成 7.4 年，1997 那種進場點要 4.7~6.7 年，成本轉差的情境是 10 年。它衡量的是「要忍多久」，不是「會賠多少」。<br>⚠ <b>而台股自己最慘的那一次，根本不在本站的回測樣本裡。</b>加權指數 1990-02-10 收在 <b>12,495 點</b>，要到 <b>2020-07-27</b> 才第一次收回它之上 —— 中間隔了 <b>30.5 年</b>（不含股息的價格口徑；把股息算進去會短很多，但 1990 年代沒有官方的含息日資料可以精算）。本站的日線資料從 1995 年開始，那一段整段不在裡面。<b>「台股會不會像日本那樣幾十年不回來」不是假設題 —— 台股自己就發生過一次。</b>'},
{key:'annualized_volatility',term:'年化波動',short:'帳面上下跳動的劇烈程度，換算成一年的幅度。',long:'年化波動用一個百分比描述資產平常晃得多兇。年化波動 30%，大致代表多數年份的報酬會落在平均值上下 30% 的範圍內，換成日常感受就是三天兩頭看到帳戶跳動 2% 以上。2 倍 ETF 的波動大約是它追蹤的指數的兩倍。'},
{key:'cagr',term:'年化報酬（CAGR）',short:'把整段期間的總報酬，換算成平均每年賺幾 %。',long:'年化報酬是把好幾年的總成績攤平成每年的固定成長率。10 年從 100 萬變成 200 萬，總共漲 100%，年化大約 7.2%，因為每年賺到的都會滾進下一年（見複利）。它是幾何平均、已含複利，跟「平均漲幅」不同 —— 大賠一年會把年化拖低很多，這正是它誠實的地方。'},
{key:'calmar',term:'報酬÷回撤（Calmar）',short:'每承受 1 元的最深虧損，換到多少年化報酬。',long:'Calmar ＝ 年化報酬 ÷ 最大回撤，用一個數字回答「每承受一分帳面重挫，換到多少報酬」，越大越好。0.15 大約是：一度看著帳面掉四成，換來每年約 6% 的成長。它逼你把「賺多少」和「痛多深」放在同一個天平上，比只看報酬誠實。⚠ 回測算出來的 Calmar 是歷史，不是承諾 —— 換一個起點或換一段期間，分子分母都會變。'},
{key:'compounding',term:'複利',short:'賺到的錢再滾進去繼續賺，時間拉長差距會很誇張。',long:'複利是把賺到的錢留在裡面繼續產生報酬。每年 10%，100 萬 20 年後會變成約 673 萬，而不是單純多 200 萬。不領出來、持續持有，靠的就是這股力量；但要注意虧損也會用同樣的方式往下滾，所以避免大賠和追求高報酬一樣重要。'},
{key:'drift',term:'漂移',short:'拉長時間看，平均往某個方向移動的趨勢。',long:'漂移是把短期上下震盪濾掉之後，拉長時間看下來的平均移動方向與幅度。「台股歷史漂移 +9.8%/年」的意思是：雖然每天漲跌不定，過去長期平均下來每年大約往上移動這個幅度 —— <b>不保證未來也一樣</b>。'},
{key:'median',term:'中位數',short:'把所有結果由小排到大，最中間那一個。',long:'中位數是把所有結果從小到大排好隊，站在正中間那一個的數字。它比「平均」更能代表典型情況，因為平均容易被少數極端值拉走。本站講長期結果時多半用中位數，代表<b>多數人會遇到的情況</b>，不是最好或最差的少數案例。'},
{key:'sequence_risk',term:'序列風險',short:'同樣的平均報酬，先跌後漲和先漲後跌，結局差很多。',long:'累積期剛開始遇到大跌影響不大（本金還小、還有薪水）；退休前夕遇到傷害最大 —— 沒時間等它回來，還得一邊提領。這就是接近退休要降槓、加債的原因。'},
{key:'book_value',term:'帳面',short:'帳戶上顯示的數字，還沒賣掉就不是真的賺賠。',long:'帳面是你打開證券帳戶，看到這筆投資現在值多少錢的那個數字。「帳面虧損 20 萬」是現在看起來少了 20 萬，沒賣掉就有機會漲回來；<b>真正變成虧損，是你按下賣出那一刻</b> —— 這正是本站反覆提醒「不要中途賣掉」的原因。'},
{key:'consolidation',term:'盤整',short:'價格上上下下，卡在一個區間裡沒有明確方向。',long:'盤整是指數在一段時間內反覆漲跌，沒有站穩創新高、也沒有一路破底，像卡在一個區間裡打轉。這種行情對 2 倍 ETF 特別不利：來回震盪會不斷磨損價值，<b>就算指數最後打平，你的部位也可能是虧的</b>（見波動耗損）。'},

/* ── 策略機制 ─────────────────────────────────────────────────── */
{key:'core',term:'核心',short:'長期一直抱著不動的那一份部位。',long:'核心是這套規則裡「買了就放著」的那一份：拿大部分資金買進配置好的標的，平常不管漲跌都不加碼也不減碼。它像房子的地基，不會天天翻修；真正會動的是另外那一份現金準備金。'},
{key:'reserve',term:'現金準備金',short:'平常放著不投資的現金，專門等大跌時才拿出來買。',long:'準備金是刻意留在旁邊的現金，不是「還沒想好買什麼」，它是策略本身：①平常壓低整體波動，讓你抱得住、不被洗出場；②大盤從高點重挫時，手上真的有錢可以分批投進去抄底。像家裡的急難預備金，平常看起來閒置，需要的那天才知道它的價值。<b>準備金比例是本站最重要的一個旋鈕。</b>'},
{key:'rebalance',term:'再平衡',short:'定期把跑掉的比例，調回原本設定的樣子。',long:'再平衡是把偏離的比例調回目標：漲多了就賣掉一點、跌多了就補一點，讓配置維持你原本設定的樣子，等於自動高賣低買。像行李箱用久了會亂，隔一陣子重新整理一次。「① 配資金」用的是「偏離帶」版本：任一標的相對目標漂移超過 50% 才動手，兼顧紀律與交易成本。'},
{key:'refill',term:'回補',short:'指數創新高之後，把用掉的現金補回原本的比例。',long:'回補是把大跌時投出去的準備金換回現金、放回原本的比例。「② 挑時機」的條件是指數重新創新高，而且距離上次動作至少 63 個交易日（約 3 個月），避免在高點附近反覆進出。等於雨天用掉的傘，天晴了再放回門口。'},
{key:'staged_entry',term:'分批加碼',short:'大跌時不一次買光，跌得越深買得越多。',long:'分批加碼是把準備金拆成幾份，在指數從歷史高點跌到約定的水位時分次投入，跌越深買越重。這樣做是因為沒有人知道底部在哪裡；如果在第一個水位就一次全押，後面再跌就沒有子彈了。'},
{key:'dca',term:'分批進場',short:'一大筆錢分幾個月慢慢投，買「不在最高點歐印」的保險。',long:'歷史上一次全投平均略勝分批（市場長期向上），但槓桿部位在頂部歐印的代價太大。錢越大、估值越貴、你越怕買高，就分越多期；小額月投的人本來就在分批，設 0 即可。注意這與「分批加碼」不同：分批進場是把既有的一筆錢慢慢投完，分批加碼是崩盤時才動用準備金。'},
{key:'position',term:'部位',short:'你此刻手上實際持有的投資金額或數量。',long:'部位是此刻你帳戶裡真正持有的東西，例如「持有 70 萬元的 00685L」。本站算出你今天該持有多少 ETF、多少現金，拿來跟你實際持有的比對，才知道該不該加碼或減碼。'},
{key:'position_building',term:'建倉',short:'從零開始，把錢分批慢慢買進去建立部位。',long:'建倉是還沒有部位的人，第一次把資金照計畫買進去的過程。「② 挑時機」把它拉長到 18~24 個月分批買，而不是一天全部買完。例如手上 100 萬元，改成每個月固定買一部分，分兩年慢慢買完。'},
{key:'add_position',term:'加碼',short:'在原本的部位上，再多買進一些。',long:'加碼是把手上的現金再拿一部分出來多買一些 ETF，讓部位變大。本站的加碼<b>只在</b>指數從歷史高點跌到指定水位時才發生，跌得越深買得越多，不是隨時想買就能買。'},
{key:'reduce_position',term:'減碼',short:'賣掉手上部位的一部分，換回現金。',long:'減碼是把原本持有的 ETF 賣掉一部分，讓部位變小、現金變多。本站的減碼只在指數創新高時發生，目的是把加碼用掉的現金補回原本的比例，跟「看壞後市所以賣掉」的減碼不是同一回事。'},
{key:'full_position',term:'滿倉',short:'能買的都買滿了，手上沒有現金可以再投。',long:'滿倉是能買的都已經買滿、手上沒有現金可以再投進去的狀態。把最後一批準備金投完就會滿倉、只剩 2 倍 ETF。滿倉不代表沒風險 —— 之後再跌只能看著帳面縮水，得等指數創新高才能把現金補回來。'},
{key:'water_level',term:'水位',short:'某個數字現在落在歷史區間的哪個高度，像水庫水位。',long:'水位是把現在的數字放進一段歷史範圍裡，看它站在多高的位置。「加碼水位」指跌到 −25%／−35%／−45% 那幾條線，「估值水位」指現在比過去多少時間更貴。就像看水庫還剩幾成滿，數字要放進脈絡才有意義。'},
{key:'sleeve',term:'sleeve（分艙）',short:'把總資金切成獨立管理的幾份，例如台股一份、美股一份。',long:'分艙是把總資金切成互不干擾的幾份，每一份各自照同一套規則跑。「② 挑時機」預設台股那一份佔 40%、美股那一份佔 60%，各自有自己的核心/準備金比例、自己的高點與加碼進度；台股大跌只動用台股的準備金。像船艙隔開，一邊進水不會拖垮整艘船。'},
{key:'glide_path',term:'隨齡降槓',short:'年紀越大，自動把槓桿部位逐步換成債券。',long:'年輕時腰斬，有薪水和時間可以救；60 歲腰斬就沒有了。開啟後從你設的年齡起每年自動賣一點正二/SSO 換債券，到退休前把槓桿降掉約七成。代價是一點期望報酬，買到的是「退休前夕不被崩盤毀掉」。'},
{key:'flex_withdrawal',term:'彈性提領',short:'退休後壞年份少花一點，成功率立刻高一截。',long:'固定提領不管市場好壞都拿同一筆，崩盤年等於「跌最深時賣最多」。彈性提領改成按資產比例拿（下限 70%／上限 120%），壞年自動縮衣節食。它是最便宜的退休保險 —— 不用多存錢，只要願意彈性過日子。風險沒有消失，只是從「錢花光」換成「花得少」。'},
{key:'cppi',term:'CPPI',short:'「跌了減碼、漲了加碼」的順勢保本策略，與本站的逆勢加碼相反。',long:'CPPI 隨資產縮水自動降風險，守得住底線，但容易跌時砍在低點、漲時追在高點。本站的準備金機制剛好相反：跌深了才加碼。兩者沒有絕對誰對，但邏輯不能混用。'},
{key:'merton',term:'Merton 比例',short:'學術上的最適曝險公式：報酬與波動決定你該開幾倍。',long:'Merton／凱利式的思路是「超額報酬 ÷ 波動平方」給出理論最適槓桿。它對輸入超級敏感 —— 報酬猜錯 1%，答案差很多，所以本站只拿它當參考座標，不拿它下單。'},

/* ── 估值 ─────────────────────────────────────────────────────── */
{key:'pe_ratio',term:'本益比（P/E）',short:'股價是每年獲利的幾倍，用來看現在買貴還是買便宜。',long:'本益比是「價格 ÷ 每年賺到的錢」。一家公司每年幫你賺 1 元、股價 20 元，本益比就是 20，粗略代表 20 年回本。整個市場也能算出一個本益比，「② 挑時機」用它判斷現在進場貴不貴 —— 但<b>只用來決定「買多慢」，不用來決定「買多少」</b>，因為回測顯示它對未來一年幾乎沒有預測力。'},
{key:'ttm',term:'TTM',short:'「最近 12 個月」的意思，用最新四季的實際數字算。',long:'TTM 是「過去 12 個月」的簡寫，把最近四季已經公布的數字加起來，而不是用預估值或去年整年的舊資料。例如現在是 7 月，TTM 獲利就是去年 7 月到今年 6 月的實際獲利。用實績而非預估，避免摻進對未來的猜測。'},
{key:'percentile',term:'百分位／機率帶（P10/P50/P90）',short:'把所有結果排好隊，看某個數字站在多高的位置。',long:'百分位是把數據從小排到大，看某個值落在哪個位置。「第 96 百分位」意思是歷史上有 96% 的時間比現在便宜，也就是現在很貴 —— 因為「本益比 26 倍」本身沒有意義，要看它在自己的歷史裡站在哪。同一套想法用在模擬上就是<b>機率帶</b>：上千條路徑排隊後取第 10／50／90 名。P50（中位）是「一半比它好、一半比它差」，P10 是每十條裡最差那條的水準，P90 是最順的那批。看圖時盯 P10：如果最差的十分之一你也活得下去，這個計畫才算穩。'},

/* ── 統計方法與它的限制 ───────────────────────────────────────── */
{key:'monte_carlo',term:'蒙地卡羅',short:'用電腦模擬幾千種可能的未來，看結果分布長什麼樣。',long:'蒙地卡羅是讓電腦隨機跑幾千、幾萬次「可能的未來」，再看這些結果的分布。歷史只真實發生過一次，用它才能回答「如果重來一萬次，最糟的那幾 % 有多慘」。它給的是分布（P10/P50/P90），不是單一答案 —— 這比任何「預估報酬率」都誠實。像氣象預報說降雨機率 70%，也是同一套思路。'},
{key:'bootstrap_block',term:'歷史重抽／區塊自助法',short:'把歷史行情剪成連續的小段重新洗牌，造出更多種可能的歷史。',long:'自助法是把過去的走勢當素材、重新抽樣組合；區塊重抽樣則是整段整段地剪貼，好保留「大跌之後常常連著跌」的連續性。「① 配資金」的歷史重抽引擎一次抽 4~12 年<b>連續</b>的真實美股歷史（1928~2024）串起來 —— 參數化抽樣每個月獨立，抽不出 1929 或 2000 那種一跌跌好幾年的序列，失落十年在這裡抽得出來，同一組配置的回撤會明顯變深，那個落差就是它的價值。「② 挑時機」則用 63 個交易日為一段，檢查結論是不是只在真實發生過的那一條歷史上剛好成立。'},
{key:'student_t',term:'肥尾（Student-t）',short:'極端行情比鐘形曲線預測的更常發生，模擬時刻意加重尾巴。',long:'真實市場的暴跌頻率遠高於常態分布的想像。參數化引擎用 Student-t 分布抽樣，讓「很慘的月份」出現得更頻繁，避免把風險模擬得太溫柔。'},
{key:'spearman_ic',term:'Spearman IC',short:'檢查某個指標的排名，跟後來報酬的排名有沒有關聯。',long:'Spearman IC 衡量「指標排得高的時候，後來的報酬是不是也排得高」，介於 −1 到 1，0 代表毫無關聯。本站用它回答一個很實際的問題：現在貴不貴，能預測未來報酬嗎？結果是對未來 1 年幾乎無效（−0.026），要拉到 3~5 年才勉強看得出差別。'},
{key:'r_squared',term:'R²',short:'某個因素能解釋結果的幾成，其餘來自其他原因。',long:'R² 介於 0 到 1，代表「結果的變化有幾成能被這個因素說明」，0.9 是幾乎完全對得上，0.1 是幾乎無關。本站用它做兩件事：檢查回測用的合成走勢像不像真的（對 00631L 是 0.94，很可靠），以及判斷那斯達克算不算「另一個市場」（對美股是 0.69，太像了，所以不算）。'},
{key:'alpha_beta',term:'alpha／beta',short:'beta 是跟著大盤動的部分，alpha 是額外多出來的部分。',long:'beta 說明你的資產跟大盤連動的倍數，beta＝1.4 就是大盤動 1%、你動 1.4%；alpha 則是扣掉連動之後，額外多賺或少賺的部分。實測 00631L 的 beta＝2.06（確實交付兩倍）、alpha 約每年 −0.42%。報酬幾乎全來自放大 beta，所以大盤跌時無處可躲。'},
{key:'kelly',term:'凱利（Kelly）',short:'理論上長期成長最快的下注比例，實務上一定要打折用。',long:'凱利公式算的是「長期資產成長最快的下注比例」，但它假設你完全知道未來的報酬與波動，一旦估錯就會下注過重，照全額凱利做帳面砍半是常態。本站算出：只押台股，滿倉就用掉七成多的額度；台股美股分開配置才降到約三分之一 —— 同樣的曝險，容錯空間多一倍。'},
{key:'backtest',term:'回測',short:'拿歷史資料假裝當年就照這套規則做，回頭看結果會怎樣。',long:'回測是拿過去幾十年的真實股價，假裝當年就照這套規則買賣，算出結果會怎樣。本站標了「回測值」的數字都是這樣算出來的，<b>不是保證</b>。歷史不會重演，回測好看不代表未來一定賺，而且本站的回測沒有計入稅和手續費。'},
{key:'survivorship_bias',term:'倖存者偏差',short:'我們拿來回測的美股史，剛好是活得最好的那個市場。',long:'過去百年美股是全球表現最好的市場之一；日本 1989 年後盤整三十年的劇本同樣「真實」。用美股歷史推未來，天生偏樂觀 —— 所以本站的最壞情境要當參考，不是保證的下限。'},
{key:'regime_bet',term:'regime bet',short:'整套計畫押在「市場長期向上」這個大前提上。',long:'所有指數化＋槓桿的策略都隱含同一個賭注：資本市場長期會成長。如果未來三十年像日本失落三十年，這套規則會輸。它不是壞策略，但你要知道自己押了什麼。'},
{key:'mental_accounting',term:'心理帳戶',short:'把同一筆錢貼上不同標籤，行為就會不一樣。',long:'「準備金」和「核心」其實都是你的錢，但分開命名後，你比較不會在恐慌時把核心賣掉，也比較捨得在暴跌時把準備金投出去。這是行為財務學裡少數站在散戶這邊的工具。'},

/* ── FIRE 與退休 ──────────────────────────────────────────────── */
{key:'fire',term:'FIRE（財務自由）',short:'存到一筆夠大的錢，之後靠提領它過活，不必再為錢工作。',long:'FIRE 是 Financial Independence, Retire Early：先存出一筆本金，之後每年只從裡面拿一小部分出來生活（見安全提領率）。門檻算法很單純：年支出 ÷ 提領率。一年花 35 萬、提領率 3.5%，就是 1,000 萬。「① 配資金」所有計算都繞著這個數字轉。'},
{key:'coast_fire',term:'Coast FIRE',short:'本金已夠大，之後就算不再存錢，光靠複利也能在退休時達標。',long:'Coast 是「滑行」—— 你不必已經存到全部的錢，只要現在這筆本金放著滾複利，到退休那天會自己長到目標，就算達成 Coast FIRE。之後賺的錢付生活費就好，不必再為退休加碼。結果頁的「Coast 年齡」就是你最早可以開始滑行的歲數。'},
{key:'barista_fire',term:'Barista FIRE',short:'資產付得起一半生活費，剩下靠輕鬆的兼職補齊。',long:'介於「全職上班」與「完全退休」之間：資產的提領大約付得起一半年支出，另一半用壓力較小的工作補上。適合想提早換一種活法、又不想把安全邊際壓到極限的人。'},
{key:'swr',term:'安全提領率（SWR）',short:'退休後每年從資產拿多少比例出來花，常用 3.5%~4%。',long:'經典「4% 法則」來自美國歷史回測：退休第一年提領 4%、之後隨通膨調整，30 年內把錢花光的機率很低。本站預設 3.5% 比它保守 —— 提早退休的人可能要撐 40 年以上，而未來報酬不保證跟歷史一樣好。年支出 ÷ 提領率 = 你需要的總資產。'},
{key:'real_vs_nominal',term:'實質 vs 名目',short:'實質＝已扣通膨的購買力；名目＝帳面數字。',long:'30 年後的 1,000 萬，若通膨 2%，購買力只剩今天的約 553 萬。本站預設用「實質」顯示 —— 所有目標和結果都是今天的購買力，你不必自己心算通膨。切到「名目」只是換顯示口徑，不影響計算。'},
{key:'labor_insurance_pension',term:'勞保年金（老年年金）',short:'勞工保險的老年給付：年資滿 15 年、到法定年齡（多數人 65 歲）後月領、活多久領多久。金額約＝平均月投保薪資×年資×1.55%，自己的數字用勞保局 e 化服務系統查最準。',long:'勞保老年年金與勞退是<b>兩筆不同的錢，都可以領</b>。條件：勞保年資滿 15 年才能月領（不滿只能一次領）；法定請領年齡 65 歲（民國 50 年次以後，年次較早的人略低），可提前最多 5 年、每提早 1 年減 4%。金額＝平均月投保薪資（取最高 60 個月平均，目前上限 45,800）×年資×1.55%。到<b>勞保局 e 化服務系統</b>或勞動保障卡 ATM 可查個人年資與試算。制度可能修法，以勞保局公告為準。'},
{key:'labor_pension_account',term:'勞退月退（新制個人專戶）',short:'雇主每月至少提你工資 6% 存進你名下的個人專戶，60 歲可領；提繳年資滿 15 年可月領，否則一次領。領多少＝專戶餘額，勞保局 e 化服務系統查得到。',long:'勞退新制：雇主每月提繳工資的 6% 以上進<b>你的個人專戶</b>（換工作跟著走、公司倒了也在），自己可再自願提繳最多 6%（免稅）。年滿 60 歲請領；提繳年資滿 15 年可選月領。收益有兩年定存利率的保證下限。與勞保年金是兩筆錢，<b>都可以領</b>。餘額與試算：勞保局 e 化服務系統／勞動保障卡 ATM。'},
];

const GMAP = {}; GLOSSARY.forEach(g => GMAP[g.key] = g);

/* SURFACE = 文章裡真正會寫出來的樣子(與辭典標題刻意分開:標題含括號全名)。
   每個詞給長短兩種寫法;長詞優先排序保證「波動耗損」不會被「波動」吃掉。 */
const SURFACE = {
  // 市場與商品
  // 「大盤」是全站出現頻率最高的詞之一，卻一直沒有進 SURFACE —— 於是每一頁都得在正文裡
  // 自己解釋一次「大盤 = 整個市場的平均」。掛到 index 這一條（同一個概念）。
  index:['加權指數','大盤'], etf:['ETF'], sp500:['S&P500'], nasdaq:['那斯達克'],
  '00631l':['00631L'], '00685l':['00685L'], sso:['SSO'], tqqq_qld:['TQQQ','QLD'],
  futures:['期貨'], nav:['淨值'], time_deposit:['定存'], short_term_bond:['短期債'],
  sub_brokerage:['複委託'], us_estate_tax:['遺產稅'], daily_price_limit:['漲跌幅限制'],
  // 槓桿與成本
  // '2 倍 ETF' 是 S6 補的:改版前 /timing/ 的開場白手工標了「2 倍槓桿 ETF」,
  // 那段開場白在兩層改版中被壓掉,而基礎層的行動面板寫的是「買 2 倍 ETF」——
  // 三種寫法裡偏偏只有這一種沒進 SURFACE,結果最顯眼的那一處反而沒有氣泡。
  leverage:['槓桿'], leverage_2x:['2 倍槓桿','2 倍 ETF','槓桿 ETF','正二'],
  // 「曝險」單獨出現的次數其實比「淨曝險」多（「低曝險」「有效曝險」「同曝險」）。
  net_exposure:['淨曝險','放大倍數','曝險'],
  volatility_decay:['波動耗損'], backwardation:['逆價差'], financing_cost:['融資成本'],
  internal_fee:['內扣費用','內扣'], total_return:['含息'],
  margin_trading:['融資'], pledge:['質押'], margin_call:['追繳'], forced_liquidation:['斷頭'],
  // 風險與報酬
  drawdown:['最大回撤','回撤'], all_time_high:['歷史最高點','歷史高點'],
  longest_underwater:['最長水下'], annualized_volatility:['年化波動','波動'],
  cagr:['年化報酬','CAGR'], calmar:['Calmar'], compounding:['複利'], drift:['漂移'],
  median:['中位數','中位'], sequence_risk:['序列風險','順序風險'],
  book_value:['帳面'], consolidation:['盤整'],
  // 策略機制
  core:['核心'], reserve:['現金準備金','準備金'], rebalance:['再平衡'], refill:['回補'],
  staged_entry:['分批加碼'], dca:['分批進場','分批'],
  position:['部位'], position_building:['建倉'], add_position:['加碼'], reduce_position:['減碼'],
  full_position:['滿倉'], water_level:['水位'], sleeve:['分艙'],
  glide_path:['隨齡降槓','生命週期降槓'], flex_withdrawal:['彈性提領'],
  cppi:['CPPI'], merton:['Merton'],
  // 估值
  pe_ratio:['本益比'], ttm:['TTM'], percentile:['機率帶','百分位'],
  // 2026-08 新增的六條
  holding:['標的'], forward_assumption:['前瞻假設'], bull_market:['多頭'],
  emergency_fund:['緊急預備金'], fx_risk:['匯率風險','匯差'],
  accumulation:['累積期'], log_scale:['對數刻度'],
  // 統計方法
  monte_carlo:['蒙地卡羅','Monte Carlo'],
  bootstrap_block:['歷史重抽','自助法','區塊重抽','block-bootstrap'],
  student_t:['肥尾','Student-t'], spearman_ic:['Spearman'], r_squared:['R²'],
  alpha_beta:['alpha'], kelly:['凱利'], backtest:['回測'],
  survivorship_bias:['倖存者偏差'], regime_bet:['regime bet'], mental_accounting:['心理帳戶'],
  // FIRE 與退休
  fire:['FIRE','財務自由'], coast_fire:['Coast FIRE','Coast'], barista_fire:['Barista FIRE','Barista'],
  swr:['安全提領率','4% 法則','SWR','提領率'],
  real_vs_nominal:['實質購買力','實質'],
  // 別名刻意保守(只收全稱):「勞退」兩個字會誤標 1.1 的「年金/勞退」合成列這類複合詞
  labor_insurance_pension:['勞保年金','勞保老年年金'],
  labor_pension_account:['勞退月退','勞退新制'],
};

/* 這些容器的 innerHTML 會被反覆重繪 —— 自動註解一律跳過,註解只落在靜態說明文字上。
   ⚠ 漏掉一個的後果是:annotateTerms() 在裡面插入 .term 按鈕,下次重繪就留下損壞的標記。
   新增「會被 innerHTML 整段重寫」的容器時,務必回來補一行。 */
const DYN_IDS = {
  // /plan/
  netExpBox:1, pieLegend:1, rawBar:1, wnote:1, wsum:1, carryInfo:1, l2formula:1, ssoformula:1,
  cagrReadout:1, adviceBox:1, cmpResult:1, coreStatus:1, status:1,
  snapList:1, snapCount:1, cmpStatus:1, stress:1, cmp:1, mcmp:1, scen:1, sceninfo:1,
  flowList:1, flowTimeline:1, flowSummary:1, spendReadout:1, shareBox:1, migNote:1,
  // /plan/ S5 新增的兩個「會被整段重寫」的容器:常駐摘要列與全期回撤卡。
  sumText:1, ddAllBox:1,
  // /plan-result/(S4):整頁由 JS 一次寫進 #resultRoot,之後 ❹ 的今日水位與 ❷ 的範本卡
  // 還會各自重繪。掃描在 #resultRoot 填完之後才做,這幾個容器要跳過。
  // S11:bandProbe 是機率帶圖的讀數列,pointermove 會反覆改寫。
  resultRoot:1, todayBox:1, tierCards:1, foundMsg:1, bandProbe:1,
  /* /timing/(S6):本頁的 annotateTerms 在 render() 末尾才跑,但這幾個容器之後**還會**
     被 paintAllocation() 重寫 —— 使用者一改總資金、換風格、切「只做台股」就重來一次。
     改版前這份清單完全沒有 /timing/ 的項目:註解落在裡面,換一次風格就整批消失,
     而那個詞在全頁的「第一次出現」已經用掉了,等於那一條辭典再也叫不出來。
     (S6 新增的 qCheck2 / worst* 也在其中:三題自我檢核與「最壞會有多壞」都吃使用者的金額。) */
  qCheck2:1, worstLine:1, worstGrid:1, worstNote:1, hProfileWarn:1,
  hHeadline:1, bSteps:1, aExpoPlain:1, aProfileName:1,
  capFlowLine:1, capFlowHint:1, bScopeNote:1,
  aLadder:1, aLadderNote:1, vAccelDef:1, tA1997:1,
  stageSeg:1, capScope:1, segProfiles:1,
  // 共用
  glossList:1, gpop:1, banner:1, apNav:1, apSteps:1,
};

/* ═══════════════════════════════════════════════════════════════════════
   2. 頂部導覽
   ═══════════════════════════════════════════════════════════════════════ */
/* 改版前四頁各有一份幾乎相同的 .sitenav,註解互相要求「改動請同步另外三頁」。
   S4 新增 /plan-result/ 時,只要在這個陣列插一行。 */
const NAV = [
  {key:'home',   href:'',            label:'🏠 資產規劃'},
  {key:'start',  href:'start/',      label:'🚀 快速開始'},
  {key:'result', href:'plan-result/',label:'★ 我的計畫'},
  {key:'plan',   href:'plan/',       label:'⚙ 配資金',  adv:true},
  {key:'timing', href:'timing/',     label:'📈 挑時機',  adv:true},
  {key:'report', href:'report/',     label:'📄 計劃書'},
];
// 主線(首頁→精靈→我的計畫)與進階(配資金／挑時機／計劃書)之間插一個分隔符。
// 位置跟著 NAV 走,不要再寫死索引 —— S4 插一行就踩到過一次。
const NAV_SPLIT = NAV.findIndex(n => n.adv);

function renderNav(page){
  let host = $('apNav');
  if (!host){
    host = document.querySelector('nav.sitenav');
    if (!host){
      const wrap = document.querySelector('.wrap');
      if (!wrap) return;
      host = document.createElement('nav');
      wrap.insertBefore(host, wrap.firstChild);
    }
  }
  host.id = 'apNav';
  host.className = 'sitenav' + (host.classList.contains('noprint') ? ' noprint' : '');
  host.setAttribute('aria-label', '站台導覽');
  // 首頁在網站根目錄,其餘五頁都在一層子目錄裡。
  const base = (page === 'home') ? './' : '../';
  host.innerHTML = NAV.map((n, i) => {
    const url = n.href ? base + n.href : base;
    const here = (n.key === page);
    const sep = (i === NAV_SPLIT) ? '<span class="sep">›</span>' : '';
    return sep + '<a href="' + url + '"' +
      (here ? ' class="here" aria-current="page"' : (n.adv ? ' class="adv-link"' : '')) +
      '>' + n.label + '</a>';
  }).join('');
}

/* ═══════════════════════════════════════════════════════════════════════
   3. 進度指示 —— 取代首頁的 #journey 明細
   ═══════════════════════════════════════════════════════════════════════ */
function renderSteps(page){
  const host = $('apSteps');
  if (!host || !S) return;
  const st = S.load();
  // 「填過資料」不能只看 st.input.net —— defaults() 的 net 預設就是 50,第一次造訪的人
  // 也會 >0,結果第一步立刻顯示成 ✓ 完成。要先確認 localStorage 裡真的有東西。
  let stored = false;
  try { stored = !!(localStorage.getItem(S.KEY) || localStorage.getItem(S.LEGACY_KEYS.plan)); } catch(e){}
  const hasInput  = stored && !!(st.input && Number(st.input.net) > 0);
  const hasResult = !!st.result;
  const founded   = st.founding && ['chk1','chk2','chk3','chk4'].every(k => st.founding[k]);
  const steps = [
    {k:'回答問題', done:hasInput,  now:!hasInput},
    {k:'看你的計畫', done:hasResult, now:hasInput && !hasResult},
    {k:'確認地基', done:!!founded,  now:hasResult && !founded},
  ];
  host.className = 'ap-steps';
  host.innerHTML = steps.map((s, i) =>
    (i ? '<span class="arrow">›</span>' : '') +
    '<span class="s' + (s.done ? ' done' : (s.now ? ' now' : '')) + '">' +
    (s.done ? '✓ ' : '') + s.k + '</span>').join('');
}

/* ═══════════════════════════════════════════════════════════════════════
   4. 進階展開器 —— 收合狀態記進 ap_state_v2.ui.adv
   ═══════════════════════════════════════════════════════════════════════ */
/* 天天回來看的人,不該每天再展開一次同一段教學。
   只記有 id 的展開器 —— 沒有 id 就沒有穩定的鍵,記了下次也對不上。 */
function initAdv(){
  const list = document.querySelectorAll('details.adv[id], details.x[id][data-remember]');
  Array.prototype.forEach.call(list, el => {
    if (S){
      const saved = S.getAdv(el.id);
      if (saved !== undefined) el.open = saved;
    }
    el.addEventListener('toggle', () => { if (S) S.setAdv(el.id, el.open); });
  });
  // 深連結:/plan-result/ 的「看細節」跳進 /plan/#leverage 時,那一段要自己展開。
  // 不展開的話,點過去只看到一行收合的標題 —— 那正是「不像同一個網站」的感覺來源。
  const openHash = () => {
    const h = location.hash.slice(1);
    if (!h) return;
    const el = document.getElementById(h);
    if (!el) return;
    let d = el.closest ? el.closest('details') : null;
    if (el.tagName === 'DETAILS') d = el;
    while (d){ d.open = true; d = d.parentElement && d.parentElement.closest ? d.parentElement.closest('details') : null; }
    if (el.scrollIntoView) el.scrollIntoView({block:'start'});
  };
  window.addEventListener('hashchange', openHash);
  openHash();
}

/* ═══════════════════════════════════════════════════════════════════════
   5. 名詞小氣泡 + 頁尾辭典
   ═══════════════════════════════════════════════════════════════════════ */
/* 氣泡用 position:fixed 由 JS 定位,不用 absolute:
   術語會出現在 overflow-x:auto 的表格裡,absolute 版本會被裁掉。
   滑鼠移入、鍵盤聚焦、觸控點擊三種都要能開。 */
function initGlossary(){
  let pop = $('gpop');
  if (!pop){
    pop = document.createElement('div');
    pop.id = 'gpop'; pop.setAttribute('role','tooltip'); pop.setAttribute('aria-live','polite');
    document.body.appendChild(pop);
  }
  let openFor = null;
  /* 兩種來源共用同一顆氣泡:
       .term[data-g]  查全站辭典(75 個名詞,單一真相)
       [data-tip]     就地一句白話 —— 給**數字**用(「達標把握 62%」「−52%」)
     S12 加 data-tip 的理由:辭典只認名詞,可是新手真正卡住的是數字旁邊那句定義。
     以前那句話只能寫在正文裡,於是每個數字都拖一條尾巴,正文就變成文字牆。
     用 textContent 而不是 innerHTML —— 這裡只要一句話,不需要標記。 */
  function place(el){
    const tip = el.getAttribute('data-tip');
    if (tip){ pop.textContent = tip; }
    else {
      const g = GMAP[el.getAttribute('data-g')];
      if (!g) return;
      pop.innerHTML = '<b>' + g.term + '</b>' + g.short;
    }
    pop.classList.add('show');
    const r = el.getBoundingClientRect(), p = pop.getBoundingClientRect();
    let left = r.left + r.width / 2 - p.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - p.width - 8));   // 夾在視窗內
    let top = r.bottom + 8;
    if (top + p.height > window.innerHeight - 8) top = Math.max(8, r.top - p.height - 8);
    pop.style.left = left + 'px'; pop.style.top = top + 'px';
    openFor = el;
  }
  function hide(){ pop.classList.remove('show'); openFor = null; }
  const near = ev => (ev.target.closest && ev.target.closest('.term,[data-tip]')) || null;
  document.addEventListener('mouseover', ev => { const t = near(ev); if (t) place(t); });
  document.addEventListener('mouseout',  ev => { const t = near(ev); if (t && t === openFor) hide(); });
  document.addEventListener('focusin',   ev => { const t = near(ev); if (t) place(t); else if (openFor) hide(); });
  document.addEventListener('click',     ev => { const t = near(ev);
    if (t){ ev.preventDefault(); if (t === openFor) hide(); else place(t); } else if (openFor) hide(); });
  document.addEventListener('keydown',   ev => { if (ev.key === 'Escape') hide(); });
  window.addEventListener('scroll', () => { if (openFor) hide(); }, {passive:true});

  // 頁尾完整辭典 + 篩選
  const list = $('glossList');
  if (list){
    const paint = q => {
      const k = (q || '').trim().toLowerCase();
      const rows = GLOSSARY.filter(g => !k || (g.term + g.short + g.long).toLowerCase().indexOf(k) >= 0);
      list.innerHTML = rows.length
        ? rows.map(g => '<div><div class="gt">' + g.term + '</div><div class="gd">' + g.long + '</div></div>').join('')
        : '<div class="gd">找不到相符的名詞。</div>';
    };
    paint('');
    const f = $('glossFilter');
    if (f) f.addEventListener('input', () => paint(f.value));
  }
}

/* 自動註解:每個名詞在指定範圍內的「第一次出現」包成可查詢的小氣泡。
   手工標記做不完,漏掉的那些正是新手會卡住的地方;同一個詞標二十次是雜訊,標一次就好。 */
function annotateTerms(root, opt){
  opt = opt || {};
  const keys = opt.surface || Object.keys(SURFACE);
  const dyn = Object.assign({}, DYN_IDS, opt.dynIds || {});
  const pending = [];
  keys.forEach(k => { if (!GMAP[k] || !SURFACE[k]) return; SURFACE[k].forEach(s => pending.push({s, k})); });
  pending.sort((a, b) => b.s.length - a.s.length);   // 長詞優先,否則「回撤」會吃掉「最大回撤」
  const done = {};
  Array.prototype.forEach.call(root.querySelectorAll('.term[data-g]'), el => { done[el.getAttribute('data-g')] = true; });
  // H1~H4:標題是導航不是教學點。SUMMARY:它的本職是「點一下展開」,塞按鈕會搶走那一下。
  // LABEL:裡面塞按鈕會搶走勾選的那一下。TH:表頭太擠。
  // 跳過之後,名詞會自動落在下一次出現處 —— 通常正是真正在解釋它的段落。
  // A:連結裡塞 <button> 是無效巢狀 —— 點名詞會跟著跳頁,而且鍵盤 Tab 順序會亂。
  //   只跳過連結**本身的文字**,連結所在的整段照掃,所以幾乎不會少標到什麼。
  const SKIP = {SCRIPT:1, STYLE:1, INPUT:1, TEXTAREA:1, OPTION:1, SELECT:1, CODE:1, CANVAS:1,
    H1:1, H2:1, H3:1, H4:1, SUMMARY:1, LABEL:1, TH:1, BUTTON:1, A:1};
  // 頁首是深藍底,灰虛線和灰問號在上面幾乎看不見 —— 標在那裡等於整本辭典是關著的。
  const skipEls = (opt.skip || []).map(sel => root.querySelector(sel)).filter(Boolean);
  function walk(node){
    if (skipEls.indexOf(node) >= 0) return;
    for (let ch = node.firstChild; ch; ch = ch.nextSibling){
      if (ch.nodeType === 1){
        // data-tip 自己就是一顆氣泡的觸發點 —— 在裡面再長一顆 .term,
        // 會變成兩層虛線疊在同一段字上,而且滑過去只開得到內層那顆。
        // .src 是出處小徽章(「回測值」「假設值」),它裡面的字被標成名詞會有兩個問題:
        // ① 徽章上長出虛線＋上標問號,視覺很髒;② 那個詞的「第一次出現」被徽章吃掉,
        //    正文裡真正在解釋它的那一段反而標不到。
        if (SKIP[ch.tagName] || ch.classList.contains('term') || ch.classList.contains('dyn')
          || ch.classList.contains('banner') || ch.classList.contains('src')
          || ch.hasAttribute('data-tip') || dyn[ch.id]) continue;
        walk(ch);
      } else if (ch.nodeType === 3 && ch.nodeValue.trim()){
        for (let i = 0; i < pending.length; i++){
          const p = pending[i];
          if (done[p.k]) continue;
          const at = ch.nodeValue.indexOf(p.s);
          if (at < 0) continue;
          const after = ch.splitText(at);
          after.nodeValue = after.nodeValue.slice(p.s.length);
          const btn = document.createElement('button');
          btn.type = 'button'; btn.className = 'term';
          btn.setAttribute('data-g', p.k); btn.textContent = p.s;
          after.parentNode.insertBefore(btn, after);
          done[p.k] = true;
          ch = btn;   // 從新節點之後繼續,避免重掃同一段
          break;
        }
      }
    }
  }
  walk(root);
  return Object.keys(done).length;
}

/* ═══════════════════════════════════════════════════════════════════════
   6. 進入點
   ═══════════════════════════════════════════════════════════════════════ */
function init(opt){
  opt = opt || {};
  try { if (opt.nav !== false) renderNav(opt.page); } catch(e){ if (window.console) console.warn(e); }
  try { renderSteps(opt.page); } catch(e){ if (window.console) console.warn(e); }
  try { initGlossary(); } catch(e){ if (window.console) console.warn(e); }
  try { initAdv(); } catch(e){ if (window.console) console.warn(e); }
  const g = opt.glossary;
  if (g !== false){
    // roots 沒指定就掃整個 .wrap。分頁式 UI(/plan/)要逐個分頁掃 ——
    // 「首次出現」以分頁為單位,display:none 不影響(掃描只動文字節點,不讀版面)。
    const roots = (g && g.roots) || ['.wrap'];
    try {
      roots.forEach(sel => {
        const el = (typeof sel === 'string') ? document.querySelector(sel) : sel;
        if (el) annotateTerms(el, g || {});
      });
    } catch(e){ if (window.console) console.warn(e); }
  }
}

return {init, renderNav, renderSteps, initGlossary, initAdv, annotateTerms,
        GLOSSARY, GMAP, SURFACE, DYN_IDS, NAV};
});
