/**
 * @file コーチ編集UI（クライアント側のみ・LLM不使用・決定論）。
 *
 * タイムライン画面の「今表示している上書き日」をブラウザ上で編集し、Cloud Function の
 * 保存API（/api/override）へ送ってバックエンド（Firestore・Admin SDK経由）に保存する。
 * クライアントからの Firestore 直書きは rules で全 deny のまま。保存後はその日を即時再描画し、
 * 次回読込ではサーバが Firestore から読んで同じ内容を描画する（サーバが単一の真実源）。
 *
 * Hallmark NG（border帯のカード強調・emoji・汎用書体・紫ピンクgradient・gradient見出し）は
 * 持ち込まない。色は既存デザイントークン（var(--orange) 等）だけで当てる。
 *
 * 再描画は pattern-timeline.mjs の twoColTimeline / render-shared.mjs の dayHeader（コーチ分岐）と
 * 同一のCSSクラス・同一のDOM構造を移植して出す（スパイン3列・spine-band・tc2系・dayhead系）。
 */

import { BLOCK_TINT, EDIT_SVG } from './render-shared.mjs';
import { GOAL_SAVED_EVENT } from './goal-editor.mjs';
import { loadCss } from './styles/load-css.mjs';
import { isSameGenderCell, isTogetherRow } from './two-col-together.mjs';

/**
 * 編集に出すブロック種別（BLOCK_TINT のブロックキー側）。移動・その他は遠征日等にコーチが
 * 手で選ぶ枠（決定論エンジンの自動生成対象にはしない＝エンジンは移動時間の入力を持たない）。
 */
const BLOCK_KEYS = ['アップ', 'ファンダ', 'シュート', '対人', 'ラン', '静的', 'ゲーム', '移動', 'その他'];

/** データアイランドの id（editorDataIsland と editorScript で共有）。 */
const ISLAND_ID = 'bcs-ed';

/* ───────────────────────── 1) 編集フォーム・ボタンのCSS ───────────────────────── */

/**
 * 編集フォーム・3ボタンのCSS。既存トークンのみ・新規クラスは ed-* に限定。
 * border帯（side-stripe）・gradient・絵文字・汎用書体は使わない。フォーム要素は
 * 角丸・1px hair罫線・surface背景の既存トーンに揃える。
 */
export const EDITOR_CSS = loadCss(import.meta.url, 'styles/editor.css');

/* ───────────────────────── 2) ツールバーの編集ボタン ───────────────────────── */

/**
 * 日ビューのツールバーに足す「編集」アイコンボタン（印刷・コピーと横並びの3操作の1つ）。
 * 「自動で叩き台を入れる」「自動に戻す」「入力を書き出し」は編集画面の中（panelHtml の ed-actions）へ
 * 移設済み（2026-07-29・上部ツールバーの整理）。ここでは「この日を編集」だけを返す。
 * @returns {string} HTML
 */
export function editorToolbar() {
  return `<button class="op-btn op-btn--icon" id="ed-edit" type="button" title="編集"><span class="sr-only">編集</span>${EDIT_SVG}</button>`;
}

/* ───────────────────────── 3) データアイランド ───────────────────────── */

/** ブロック種別→tint を素のオブジェクトに展開する（Map/オブジェクト両対応の単純コピー）。 */
function tintsObject() {
  const out = {};
  for (const key of Object.keys(BLOCK_TINT)) {
    out[key] = BLOCK_TINT[key];
  }
  return out;
}

/** drillIndex（Map か 素オブジェクト）からドリル名配列を取り出す。 */
function catalogNames(drillIndex) {
  if (!drillIndex) return [];
  if (typeof drillIndex.keys === 'function' && typeof drillIndex.get === 'function') {
    return [...drillIndex.keys()]; // Map
  }
  return Object.keys(drillIndex); // 素オブジェクト
}

/** 描画セル（boys/girls/both）を保存スキーマのセル（block/label/items[{name,note}]）に写す。 */
function cellToPrefill(cell) {
  if (!cell) return undefined;
  const items = (cell.items || [])
    .filter((it) => it && it.name)
    .map((it) => {
      const out = { name: it.name };
      if (it.note) out.note = it.note;
      return out;
    });
  return { block: cell.block || '', label: cell.label || '', items };
}

/** 上書き日(twoCol)の1日を prefill 用に整形（英語キー→日本語キー）。 */
function dayToPrefill(d) {
  const rows = (d.rows || []).map((r) => {
    const row = { from: r.from || '', to: r.to || '', minutes: r.minutes != null ? r.minutes : null };
    const both = cellToPrefill(r.both);
    if (both) {
      row.both = both;
    } else {
      const boys = cellToPrefill(r.boys);
      const girls = cellToPrefill(r.girls);
      if (boys) row['男子'] = boys;
      if (girls) row['女子'] = girls;
      if (r.split === true) row.split = true;
    }
    return row;
  });
  const out = { court: d.court || '', aim: d.aim || '', title: d.title || '', rows };
  if (d.onlyGender === '男子' || d.onlyGender === '女子') out.onlyGender = d.onlyGender;
  return out;
}

/**
 * エンジン叩き台日（blocks 形）を編集スキーマ（twoCol・男女共通 both 行）の prefill へ変換する。
 *
 * オプトイン自動入力のソース。叩き台メニューは男女共通（1本）なので各ブロックを both 行にする。
 * 各ブロックの from/to/minutes と items（name＋自走表示等の説明 note）をそのまま編集欄に載せる。
 * コーチが確認・編集して保存すれば通常のコーチ上書き（two-col）として保存される。
 * 2部構成の日（火）も blocks にフラット化済みの from/to を各ブロックが持つので、ブロック単位で
 * 時間行に展開できる（区画の入れ子は編集スキーマに無いため from/to の時間行へ畳む）。
 *
 * @param {object} d buildDays の結果1日（エンジン叩き台・source は coach/empty いずれでもない）
 * @returns {{court:string, aim:string, title:string, rows:Array}} 編集データ島の prefill 形
 */
function engineDayToPrefill(d) {
  // 2部構成の日は parts 配下にブロックがあるので、parts があればそのブロックを順に集める。
  const blocks = (Array.isArray(d.parts) && d.parts.length > 0)
    ? d.parts.flatMap((p) => p.blocks || [])
    : (d.blocks || []);
  const rows = blocks
    .filter((b) => Array.isArray(b.items) && b.items.length > 0)
    .map((b) => ({
      from: b.from || '',
      to: b.to || '',
      minutes: Number.isFinite(b.minutes) ? b.minutes : null,
      both: {
        block: b.block || '',
        label: b.label || b.block || '',
        items: b.items.map((it) => {
          const out = { name: it.name };
          // 叩き台の補助情報（いずれか候補・自走/レクチャ表示）はメモに残す（コーチが消せる）。
          const note = it.note
            || (it.mode === 'practice' ? 'コーチ付き'
              : it.mode === 'lecture' ? 'レクチャ'
                : (Array.isArray(it.alternatives) && it.alternatives.length ? `いずれか：${it.alternatives.join('・')}` : ''));
          if (note) out.note = note;
          return out;
        }),
      },
    }));
  return { court: d.court || '', aim: d.aim || '', title: '', rows };
}

/**
 * 編集UIの初期データ（カタログ・色・ブロック・既存上書き日の prefill）を JSON で埋める。
 * data.days（または data.weeks[0].days）のうち source==='coach' && twoCol の日から prefill を作る。
 * @param {object} data buildPlanData の戻り値
 * @returns {string} <script type="application/json" id="bcs-ed">…</script>
 */
export function editorDataIsland(data) {
  // 編集できる「日」画面は全週ぶん描かれる（pattern-timeline.render の多週化）。だから prefill も
  // 表示中4週間に縛らず、テナント内の全コーチ上書き日（twoCol）から作る（buildPlanData の
  // allCoachDays＝表示範囲外・先月/来月に保存済みの日も「他の日からコピー」で選べるようにする）。
  // 実日付(date)キーなので週をまたいで一意（別週の同曜日と衝突しない）。
  // allCoachDays が無い呼び出し（buildPlanData を経ない手組みフィクスチャ等）には、従来どおり
  // 表示中の週だけから作る経路へ後方互換フォールバックする。
  const coachDaySource = Array.isArray(data.allCoachDays)
    ? data.allCoachDays
    : ((data.weeks && data.weeks.length) ? data.weeks.map((w) => w.days) : [data.days || []]).flat();

  const prefill = {};
  for (const d of coachDaySource) {
    if (d && d.source === 'coach' && d.twoCol && d.date) {
      prefill[d.date] = dayToPrefill(d);
    }
  }

  // ── オプトイン自動入力ソース（エンジン叩き台）──────────────────────────────────
  // 各週の seedDays（表示しない叩き台）を date キーで prefill 形に温存する。コーチが
  // 「自動で叩き台を入れる」を押した日だけ、この叩き台を編集欄に読み込む（既定では使わない）。
  const seedDayLists = (data.weeks && data.weeks.length)
    ? data.weeks.map((w) => w.seedDays || [])
    : [data.seedDays || []];
  const seedPrefill = {};
  for (const days of seedDayLists) {
    for (const d of (days || [])) {
      if (d && d.date) seedPrefill[d.date] = engineDayToPrefill(d);
    }
  }

  const g = data.session && data.session.goals ? data.session.goals : null;
  const island = {
    catalog: catalogNames(data.drillIndex),
    // 枠（ブロック）別ドリル候補。各行のドリル名候補をその行の枠に絞るために使う。
    // 無ければ null（クライアントは従来どおり全 catalog にフォールバック）。
    blockCandidates: data.blockCandidates || null,
    tints: tintsObject(),
    blocks: BLOCK_KEYS,
    prefill,
    seedPrefill, // 「自動で叩き台を入れる」が日付キーで引くエンジン叩き台（表示はしない）
    // 保存直後の再描画でも印刷の「日ヘッダ右＝月/週目標」を保つための値（編集対象は週内同値）。
    goals: g ? { monthMain: g.monthMain || '', week: g.week || '' } : null,
    goalKeys: data.goalKeys || null,
  };

  // application/json なので esc 不要。</script> 混入だけ無害化する。
  const json = JSON.stringify(island).replace(/<\/script/gi, '<\\/script');
  return `<script type="application/json" id="${ISLAND_ID}">${json}</script>`;
}

/* ───────────────────────── 4) クライアントJS（IIFE文字列） ───────────────────────── */

/**
 * 編集UIのクライアントJS（IIFE文字列）。build 側で <script> に差し込む。
 * - 上書き日は起動時にサーバが Firestore から読んで描画済み（クライアントは起動時適用しない）
 * - 「この日を編集」でフォームを開き、保存で override を構築→保存API（POST /api/override）→即時再描画
 * - 「自動に戻す」で削除API（POST /api/override/delete）→対象日を空状態へ局所更新、「入力を書き出し」で overrides.json 配列形をコピー
 * 再描画は twoColTimeline / dayHeader(コーチ分岐) を同一クラス・同一構造で移植する。
 * @returns {string} IIFE
 */
export function editorScript() {
  return `(function(){
  var isSameGenderCell=${isSameGenderCell.toString()};
  var isTogetherRow=${isTogetherRow.toString()};
  var island=document.getElementById('${ISLAND_ID}');
  if(!island)return;
  var ED=JSON.parse(island.textContent||'{}');
  var CATALOG=ED.catalog||[];
  var BLOCKCAND=ED.blockCandidates||null; // 枠別ドリル候補（無ければ null＝全catalogにフォールバック）
  var TINTS=ED.tints||{};
  var BLOCKS=ED.blocks||[];
  var PREFILL=ED.prefill||{};
  var SEEDPREFILL=ED.seedPrefill||{}; // 「自動で叩き台を入れる」用のエンジン叩き台（表示しない）
  var GOALS=ED.goals||null;
  var GOALKEYS=ED.goalKeys||null;

  // ── 枠別 datalist の id 解決 ──
  // 全catalog用の datalist は 'ed-catalog'、各枠は 'ed-cat-<index>'。ある枠の候補が空 or
  // blockCandidates 自体が無ければ全catalogにフォールバック（候補を絞れない＝従来挙動）。
  // datalist は候補の提案だけで自由入力は妨げない（list 属性はハード制限にならない）。
  function blockHasCandidates(block){
    return !!(BLOCKCAND&&Array.isArray(BLOCKCAND[block])&&BLOCKCAND[block].length>0);
  }
  function listIdForBlock(block){
    if(!blockHasCandidates(block))return 'ed-catalog';
    var i=BLOCKS.indexOf(block);
    return i>=0?('ed-cat-'+i):'ed-catalog';
  }

  // ── 共通ユーティリティ ──
  function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  function tintOf(block){return TINTS[block]||'var(--mute)';}
  function curDay(){
    var nodes=document.querySelectorAll('.day[data-date]');
    for(var i=0;i<nodes.length;i++){if(!nodes[i].hidden)return nodes[i];}
    return null;
  }
  // 'HH:MM'→分。空・不正は null。
  function toMin(hm){
    if(!hm)return null;
    var p=String(hm).split(':');
    var h=parseInt(p[0],10),m=parseInt(p[1],10);
    if(isNaN(h)||isNaN(m))return null;
    return h*60+m;
  }
  // ISO 'YYYY-MM-DD'→'YYYY/MM/DD（曜日）'。曜日は対象dayのdata-day（無ければ算出）。
  function dateLabelISO(iso,weekday){
    var p=String(iso).split('-');
    var y=p[0],mo=p[1],d=p[2];
    var wd=weekday;
    if(!wd){
      var dt=new Date(Number(y),Number(mo)-1,Number(d));
      wd=['日','月','火','水','木','金','土'][dt.getDay()];
    }
    return y+'/'+mo+'/'+d+'（'+wd+'）';
  }

  // ── 再描画: twoColTimeline / dayHeader(コーチ分岐) の移植（同一クラス・同一構造）──
  function goalsPrHtml(){
    return (GOALS&&(GOALS.monthMain||GOALS.week))?('<div class="dh-goals" aria-hidden="true">'+(GOALS.monthMain?('<span class="dhg-item"><b>月</b>'+esc(GOALS.monthMain)+'</span>'):'')+(GOALS.week?('<span class="dhg-item"><b>週</b>'+esc(GOALS.week)+'</span>'):'')+'</div>'):'';
  }
  function dayHeaderHtml(ov){
    var dateHead=dateLabelISO(ov.date,ov.weekday);
    // オンリー時は対象性別チップを出す（サーバ描画 dayHeader と一致・C）。
    var onlyG=(ov.onlyGender==='男子'||ov.onlyGender==='女子')?ov.onlyGender:null;
    var teamChip=onlyG?(' '+genderChipHtml(onlyG)):'';
    return '<div class="dayhead">'+
      '<div class="dh-main">'+
        '<div class="dh-t">'+esc(dateHead)+teamChip+
          '<span class="dh-court">'+esc(ov.court)+'</span>'+
        '</div>'+
        '<div class="dh-aim"><span class="dh-aiml">この日のねらい</span>'+esc(ov.aim)+'</div>'+
      '</div>'+
      goalsPrHtml()+
    '</div>';
  }
  document.addEventListener('${GOAL_SAVED_EVENT}',function(e){
    var detail=e.detail||{};
    var matchesMonth=detail.scope==='month'&&GOALKEYS&&detail.key===String(GOALKEYS.monthArcKey);
    var matchesWeek=detail.scope==='week'&&GOALKEYS&&detail.key===GOALKEYS.weekKey;
    if(!matchesMonth&&!matchesWeek)return;
    if(!GOALS)GOALS={monthMain:'',week:''};
    if(matchesMonth)GOALS.monthMain=detail.text;
    if(matchesWeek)GOALS.week=detail.text;
    var goalsHtml=goalsPrHtml();
    document.querySelectorAll('.day .dayhead').forEach(function(dayhead){
      dayhead.querySelectorAll('.dh-goals').forEach(function(goalsNode){goalsNode.remove();});
      if(goalsHtml)dayhead.insertAdjacentHTML('beforeend',goalsHtml);
    });
  });
  function genderChipHtml(g){
    var cls=g==='男子'?'boys':'girls';
    return '<span class="gchip '+cls+'">'+esc(g)+'</span>';
  }
  function cellInnerHtml(cell){
    if(!cell)return '<div class="tc2-empty">—</div>';
    var tint=tintOf(cell.block);
    var items=(cell.items||[]).map(function(it){
      return '<div class="tdrill"><span class="tdn">'+esc(it.name)+'</span>'+
        (it.note?'<div class="alt">'+esc(it.note)+'</div>':'')+'</div>';
    }).join('');
    return '<div class="tc2-head"><span class="tll tll-lg" style="--t:'+tint+'">'+esc(cell.label)+'</span></div>'+
      '<div class="tc2-body">'+items+'</div>';
  }
  // 全幅バンド1本（時計は左レール54px固定・内容は全幅）。男女同一行／オンリー1列行で共用。
  function oneColRowHtml(cell,from){
    var tint=cell?tintOf(cell.block):'var(--mute)';
    var bandInner=cell
      ?('<span class="tll tll-lg" style="--t:'+tint+'">'+esc(cell.label)+'</span>'+
        (cell.items||[]).map(function(it){
          return '<span class="tc2-bn">'+esc(it.name)+(it.note?'（'+esc(it.note)+'）':'')+'</span>';
        }).join(''))
      :'<div class="tc2-empty">—</div>';
    return '<div class="spine-row spine-together tc2-together tc2-only" style="--t:'+tint+'">'+
      '<div class="spine-clk"><span class="tk">'+esc(from)+'</span>'+
        '<span class="spine-dot" style="background:var(--t)"></span></div>'+
      '<div class="spine-band left">'+bandInner+'</div>'+
    '</div>';
  }
  // 男女で内容が異なる行。時計は左レール固定・内容は右側で男子/女子2分割（tc2-pair）。
  function splitRowHtml(row){
    return '<div class="spine-row spine-rotation tc2-only tc2-split">'+
      '<div class="spine-clk"><span class="tk">'+esc(row.from)+'</span>'+
        '<span class="spine-dot" style="background:var(--orange)"></span></div>'+
      '<div class="tc2-pair">'+
        '<div class="spine-side spine-self tc2-cell">'+cellInnerHtml(row['男子'])+'</div>'+
        '<div class="spine-side spine-self tc2-cell">'+cellInnerHtml(row['女子'])+'</div>'+
      '</div>'+
    '</div>';
  }
  // 連続する相違行の区間の先頭にだけ出す男子/女子見出し（左レール分は空スペーサ）。
  function runHeaderHtml(){
    return '<div class="spine-header tc2-only tc2-runhead">'+
      '<div class="spine-clock-header"></div>'+
      '<div class="tc2-pair">'+
        '<div class="spine-col-label">'+genderChipHtml('男子')+'</div>'+
        '<div class="spine-col-label">'+genderChipHtml('女子')+'</div>'+
      '</div>'+
    '</div>';
  }
  function timelineHtml(ov){
    var rows=ov.rows||[];
    var onlyG=(ov.onlyGender==='男子'||ov.onlyGender==='女子')?ov.onlyGender:null;
    var headerHtml='';
    var rowsHtml='';
    if(onlyG){
      // オンリー時は 左=時計列（空ヘッダ）／右=性別チップ の順・左レール時計＋内容フル幅の1列レイアウト（サーバ描画 twoColTimeline と一致・C）。
      headerHtml='<div class="spine-header tc2-only">'+
          '<div class="spine-clock-header"></div>'+
          '<div class="spine-col-label">'+genderChipHtml(onlyG)+'</div>'+
        '</div>';
      // 対象性別セルを優先。対象セルが無く共通(both)があれば both を出す（F: '—'にしない）。
      rowsHtml=rows.map(function(r){
        var cellOnly=cellHasContent(r[onlyG])?r[onlyG]:(r.both||r[onlyG]);
        return oneColRowHtml(cellOnly,r.from);
      }).join('');
    }else{
      // 行単位判定: 共通行は全幅1本、相違行だけ2分割し、連続する相違区間の先頭にだけ見出しを出す。
      var prevSplit=false;
      rows.forEach(function(r){
        var split=!isTogetherRow(r);
        if(split&&!prevSplit)rowsHtml+=runHeaderHtml();
        rowsHtml+= split?splitRowHtml(r):oneColRowHtml(r.both||r['男子'],r.from);
        prevSplit=split;
      });
    }
    var endTo=rows.length?(rows[rows.length-1].to||''):'';
    var endRow='<div class="spine-row spine-together spine-end tc2-only">'+
      '<div class="spine-clk"><span class="tk">'+esc(endTo)+'</span>'+
        '<span class="spine-dot" style="background:var(--mute)"></span></div>'+
      '<div class="spine-band left spine-band-end"><span class="tbl">終了</span></div>'+
    '</div>';
    return headerHtml+'<div id="plan-top" class="spine spine-only">'+rowsHtml+endRow+'</div>';
  }
  // 既存「テキストでコピー」用のプレーンテキスト（編集中 override から組む）。
  // 既存 plainText(twoCol分岐) と同趣旨: 日付（曜日）／狙い／各行 from-to ＋ 男女別 or 男女共通。
  function cellPlain(cell){
    if(!cell)return '';
    var head=cell.label||cell.block||'';
    var names=(cell.items||[]).map(function(it){return it.name+(it.note?'（'+it.note+'）':'');}).join('／');
    return head+(names?'：'+names:'');
  }
  function plainTextOf(ov){
    var L=[];
    var onlyG=(ov.onlyGender==='男子'||ov.onlyGender==='女子')?ov.onlyGender:null;
    L.push(dateLabelISO(ov.date,ov.weekday)+(ov.court?'（'+ov.court+'）':'')+(ov.title?' '+ov.title:''));
    L.push('');
    L.push('■ この日のねらい：'+(ov.aim||''));
    (ov.rows||[]).forEach(function(r){
      L.push('');
      L.push('■ '+(r.from||'')+'〜'+(r.to||''));
      if(onlyG){
        // オンリー時は対象性別の行だけ出す（幽霊の「男子｜—」を出さない・E）。
        // 対象セルが無く共通(both)があれば both を出す（F と整合）。
        var cellO=cellHasContent(r[onlyG])?r[onlyG]:(r.both||r[onlyG]);
        L.push('　'+onlyG+'｜'+(cellO?cellPlain(cellO):'—'));
      }else if(isTogetherRow(r)){
        // 明示のboth、または男女セルの内容一致（行単位）のいずれも共通の1本行として出す。
        var common=r.both||r['男子'];
        L.push('　[男女共通] '+cellPlain(common));
      }else{
        L.push('　男子｜'+(r['男子']?cellPlain(r['男子']):'—'));
        L.push('　女子｜'+(r['女子']?cellPlain(r['女子']):'—'));
      }
    });
    L.push('　・終了');
    return L.join('\\n');
  }
  // article 本体の中身（dayHeader + timeline + plain）を ov から作る。
  // plain は既存「テキストでコピー」が .day ... .plain を読むため必ず含める（無いと別日にフォールバック）。
  function renderDay(article,ov){
    article.innerHTML=dayHeaderHtml(ov)+timelineHtml(ov)+
      '<pre class="plain" hidden>'+esc(plainTextOf(ov))+'</pre>';
  }
  function renderEmptyDay(article,date,weekday){
    var seed=SEEDPREFILL[date];
    var court=seed&&seed.court?('<span class="dh-court">'+esc(seed.court)+'</span>'):'';
    var isPast=!!article.closest('.daywk[data-past]');
    var text=isPast?'この日の記録はありません。':'まだ入力がありません。この日の練習を入力してください。';
    var actions=isPast
      ? '<button type="button" class="btn" data-empty-act="blank" data-print-hide>この日の記録を入力する</button>'
      : '<button type="button" class="btn" data-empty-act="blank" data-print-hide>入力する</button>'+\
        '<button type="button" class="btn" data-empty-act="seed" data-print-hide>自動で叩き台を入れる</button>';
    article.innerHTML='<div class="dayhead"><div class="dh-main"><div class="dh-t">'+esc(dateLabelISO(date,weekday))+court+'</div></div></div>'+\
      '<div class="emptystate"><p class="es-text">'+text+'</p><div class="es-actions">'+actions+'</div></div>'+\
      '<pre class="plain" hidden></pre>';
  }

  // 上書き日は起動時にサーバ（Cloud Function）が Firestore から読んで HTML に描画済み。
  // クライアントは起動時に何も適用しない（サーバが単一の真実源）。

  // ── 編集対象の初期値解決: サーバ由来 prefill > 空テンプレ ──
  function blankCell(){return {block:BLOCKS[0]||'',label:'',items:[]};}
  function blankRow(){return {from:'',to:'',both:null,'男子':blankCell(),'女子':blankCell()};}
  function deepClone(o){return JSON.parse(JSON.stringify(o));}
  function initModel(date,weekday){
    // サーバ由来の現状態（prefill）を初期値に。無ければ空テンプレ。
    if(PREFILL[date])return normalizeModel(deepClone(PREFILL[date]),date,weekday);
    return {date:date,weekday:weekday,court:'',aim:'',title:'',onlyGender:null,rows:[blankRow()]};
  }
  // 自動入力: エンジン叩き台（seedPrefill）を初期値にする。叩き台が無ければ空テンプレ。
  // コーチが確認・編集して保存すれば通常のコーチ上書きとして保存される（既定では呼ばれない）。
  function initModelFromSeed(date,weekday){
    if(SEEDPREFILL[date])return normalizeModel(deepClone(SEEDPREFILL[date]),date,weekday);
    return {date:date,weekday:weekday,court:'',aim:'',title:'',onlyGender:null,rows:[blankRow()]};
  }
  // store/prefill 形（rows に 男子/女子/both）を編集モデルに正規化。
  function normalizeModel(src,date,weekday){
    var rows=(src.rows||[]).map(function(r){
      var hasBoth=!!r.both;
      return {
        from:r.from||'',
        to:r.to||'',
        both:hasBoth?cellModel(r.both):null,
        '男子':cellModel(r['男子'])||blankCell(),
        '女子':cellModel(r['女子'])||blankCell()
      };
    });
    if(rows.length===0)rows=[blankRow()];
    var onlyGender=(src.onlyGender==='男子'||src.onlyGender==='女子')?src.onlyGender:null;
    return {date:date,weekday:weekday,court:src.court||'',aim:src.aim||'',title:src.title||'',onlyGender:onlyGender,rows:rows};
  }
  function cellModel(cell){
    if(!cell)return null;
    return {
      block:cell.block||BLOCKS[0]||'',
      label:cell.label||'',
      items:(cell.items||[]).map(function(it){return {name:it.name||'',note:it.note||''};})
    };
  }

  // ── フォーム描画（編集モデル→DOM）。状態は model に保持、描画は丸ごと差し替え。──
  var panel=null; // 編集パネル要素
  var model=null; // 現在の編集モデル
  var editingArticle=null; // 編集対象 article

  function blockOptions(sel){
    return BLOCKS.map(function(b){
      return '<option value="'+esc(b)+'"'+(b===sel?' selected':'')+'>'+esc(b)+'</option>';
    }).join('');
  }
  function optionsHtml(names){
    return (names||[]).map(function(n){return '<option value="'+esc(n)+'"></option>';}).join('');
  }
  function catalogDatalist(){
    // 全catalog（フォールバック）＋ 枠別 datalist（候補のある枠だけ）。name input の list が指す先。
    var html='<datalist id="ed-catalog">'+optionsHtml(CATALOG)+'</datalist>';
    BLOCKS.forEach(function(b,i){
      if(blockHasCandidates(b))html+='<datalist id="ed-cat-'+i+'">'+optionsHtml(BLOCKCAND[b])+'</datalist>';
    });
    return html;
  }
  // 他の日（既存のコーチ上書き日）からこの日へ内容を丸ごと取り込むセレクタ。
  // PREFILL はテナント内の全コーチ上書き日（表示中の週に限らない）。候補が0件のときの扱い:
  //  - 保存済みの日が本当に1つも無い（テナント全体でPREFILLが空）→ ボタンを消さず案内文を出す。
  //  - 保存済みの日はあるが、それが「今編集中のこの日」だけ→ 選べる他日が無いので何も出さない
  //    （自分自身をコピー元にする意味が無いため。従来どおり沈黙）。
  function copyFromOptions(){
    var allDates=Object.keys(PREFILL);
    var dates=allDates.filter(function(k){return k!==model.date;}).sort();
    if(!dates.length){
      if(!allDates.length){
        return '<div class="ed-field"><span class="ed-lab">他の日からコピー</span>'+
          '<p class="ed-hint">コピーできる保存済みの日がまだありません。他の日を保存すると、ここから選べるようになります。</p></div>';
      }
      return '';
    }
    var opts='<option value="">選んでください…</option>'+dates.map(function(k){
      var p=PREFILL[k]||{};
      var lab=dateLabelISO(k,p.weekday)+(p.title?'：'+p.title:(p.aim?'：'+p.aim:''));
      return '<option value="'+esc(k)+'">'+esc(lab)+'</option>';
    }).join('');
    return '<div class="ed-field"><span class="ed-lab">他の日からコピー</span>'+
      '<div class="ed-copyfrom">'+
        '<select class="ed-sel" id="ed-copyfrom" style="width:auto;min-width:200px">'+opts+'</select>'+
        '<button type="button" class="ed-mini" data-act="copy-from">この日を取り込む</button>'+
      '</div></div>';
  }
  // 「自動で叩き台を入れる」（旧: 上部ツールバーの単独ボタン）を編集画面の中へ移設した導線。
  // その日のエンジン叩き台（seedPrefill）が無ければ導線を出さない（押しても無反応のボタンにしない）。
  function seedLoadOptions(){
    if(!SEEDPREFILL[model.date])return '';
    return '<div class="ed-field"><span class="ed-lab">自動の叩き台</span>'+
      '<div class="ed-copyfrom">'+
        '<button type="button" class="ed-mini" data-act="load-seed">叩き台を読み込む</button>'+
        '<span class="ed-hint">今の入力を自動生成の下書きに置き換えます</span>'+
      '</div></div>';
  }
  // この日の編集モデルに「中身」があるか（見出し or 名前のある項目）。コピー上書きの確認に使う。
  function modelHasContent(){
    if(!model)return false;
    return (model.rows||[]).some(function(r){
      return ['男子','女子','both'].some(function(side){
        var c=cellOf(r,side);
        if(!c)return false;
        if(c.label&&c.label.trim())return true;
        return (c.items||[]).some(function(it){return it.name&&it.name.trim();});
      });
    });
  }
  // 並べ替えグリップ（6点ハンドル）。掴む所を限定し、入力欄の操作と衝突させない。
  function gripSvg(){
    return '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">'+
      '<circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/>'+
      '<circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/>'+
      '<circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';
  }
  // ゴミ箱アイコン（線画SVG・emoji不使用）。項目削除・時間削除で共用。
  function trashSvg(){
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';
  }
  function itemHtml(ri,side,ii,it,listId){
    return '<div class="ed-item" data-ri="'+ri+'" data-side="'+esc(side)+'" data-ii="'+ii+'">'+
      '<button type="button" class="ed-grip ed-grip-item" aria-label="ドリルを並べ替え" title="ドラッグで並べ替え">'+gripSvg()+'</button>'+
      '<input class="ed-in ed-name" list="'+esc(listId||'ed-catalog')+'" placeholder="ドリル名（選択 or 自由入力）" value="'+esc(it.name)+'" data-k="name">'+
      '<input class="ed-in ed-note" placeholder="メモ（任意）" value="'+esc(it.note)+'" data-k="note">'+
      '<button type="button" class="ed-iconbtn ed-del" data-act="del-item" aria-label="項目を削除" title="項目を削除">'+trashSvg()+'</button>'+
    '</div>';
  }
  function cellHtml(ri,side,teamLabel,cell){
    // この行（セル）の現在ブロックに応じた候補 datalist を name input に当てる（自由入力は維持）。
    var listId=listIdForBlock(cell.block);
    var items=(cell.items||[]).map(function(it,ii){return itemHtml(ri,side,ii,it,listId);}).join('');
    return '<div class="ed-cell" data-ri="'+ri+'" data-side="'+esc(side)+'">'+
      '<div class="ed-cell-head">'+
        '<span class="ed-cell-team">'+esc(teamLabel)+'</span>'+
        '<select class="ed-sel" data-k="block" style="width:auto;min-width:108px">'+blockOptions(cell.block)+'</select>'+
      '</div>'+
      '<div class="ed-field"><span class="ed-lab">見出し</span>'+
        '<input class="ed-in" data-k="label" placeholder="例：アラウンドシュート" value="'+esc(cell.label)+'"></div>'+
      '<div class="ed-items">'+items+'</div>'+
      '<div class="ed-cell-actions"><button type="button" class="ed-mini" data-act="add-item">＋ 項目を追加</button></div>'+
    '</div>';
  }
  function rowHtmlForm(row,ri){
    var isBoth=!!row.both;
    var onlyG=(model&&(model.onlyGender==='男子'||model.onlyGender==='女子'))?model.onlyGender:null;
    var isOnly=!!onlyG;
    var cells;
    if(isOnly){
      // オンリー時: 対象性別1列だけ描く（反対列は出さない＝コーチが反対列へ入力できない）。
      // 反対列の中身は _onlyMemo に退避済み。「男女両方」へ戻すと再描画で復元される。
      cells='<div class="ed-cells ed-cells-both">'+cellHtml(ri,onlyG,onlyG,row[onlyG])+'</div>';
    }else if(isBoth){
      cells='<div class="ed-cells ed-cells-both">'+cellHtml(ri,'both','男女共通',row.both)+'</div>';
    }else{
      cells='<div class="ed-cells">'+cellHtml(ri,'男子','男子',row['男子'])+cellHtml(ri,'女子','女子',row['女子'])+'</div>';
    }
    // 反転コピー: 男女2列（共通ではない・オンリーモードでもない）行にだけ出す。both行・オンリー時は概念が衝突するため出さない。
    var flipBtn=(!isBoth&&!isOnly)
      ?'<button type="button" class="ed-mini" data-act="flip-copy" title="この行の男女を入れ替えた後半ブロックを直後に追加">反転コピー</button>'
      :'';
    // tabindex="-1": Tabでは到達しないが、行の余白クリックで script から焦点を受けられる（決定書3.3節）。
    // 行に焦点が入ると :focus-within で行の削除口だけが出る（項目の削除口には波及しない・子結合子で限定）。
    return '<div class="ed-row" data-ri="'+ri+'" tabindex="-1">'+
      '<div class="ed-row-top">'+
        '<button type="button" class="ed-grip ed-grip-row" aria-label="この時間を並べ替え" title="ドラッグで並べ替え">'+gripSvg()+'</button>'+
        '<span class="ed-rownum">時間'+(ri+1)+'</span>'+
        '<span class="ed-times">'+
          '<input type="time" class="ed-time" data-k="from" value="'+esc(row.from)+'">'+
          '<span class="ed-sep">〜</span>'+
          '<input type="time" class="ed-time" data-k="to" value="'+esc(row.to)+'">'+
        '</span>'+
        '<label class="ed-check"><input type="checkbox" data-act="toggle-both"'+(isBoth?' checked':'')+(isOnly?' disabled':'')+'>男女共通</label>'+
        flipBtn+
        '<button type="button" class="ed-iconbtn ed-del" data-act="del-row" aria-label="この時間を削除" title="この時間を削除">'+trashSvg()+'</button>'+
      '</div>'+
      // この行に対する操作（反転コピー等）の結果・中断理由をその場で出す（読み上げにも届くよう status/aria-live）。
      // 画面上部の共有欄(#ed-msg)とは別スコープ。空のときは高さを持たない（editor.css の :empty）。
      '<div class="ed-row-msg" role="status" aria-live="polite"></div>'+
      cells+
    '</div>';
  }
  // 男女オンリーモードの3択トグル（既存 .modetoggle/.mt の見た目クラスを流用。base.css 参照）。
  function onlyGenderToggleHtml(){
    var g=model.onlyGender;
    var opt=function(val,label){
      return '<button class="mt'+(g===val?' on':'')+'" type="button" data-act="only-gender" data-only-gender="'+esc(val==null?'':val)+'">'+esc(label)+'</button>';
    };
    // ed-field（縦積み・下余白12px）と modetoggle（横並びピル）は見た目の役割が異なるため同一要素に
    // 同居させない（同居すると display:flex;flex-direction:column が横並びを潰して縦積みになる）。
    // 外側の ed-field は間隔（margin-bottom）だけを担い、内側の modetoggle 本体を入れ子にすることで、
    // 周りの余白を保ったまま横並びを保つ。
    return '<div class="ed-field">'+
      '<div class="modetoggle" role="group" aria-label="男女オンリーの切り替え">'+
        opt('女子','女子のみ')+opt('男子','男子のみ')+opt(null,'男女両方')+
      '</div>'+
    '</div>';
  }
  function panelHtml(){
    var rows=model.rows.map(function(r,ri){return rowHtmlForm(r,ri);}).join('');
    return '<div class="ed-h">この日を編集（'+esc(dateLabelISO(model.date,model.weekday))+'）</div>'+
      onlyGenderToggleHtml()+
      catalogDatalist()+
      copyFromOptions()+
      seedLoadOptions()+
      '<div class="ed-field"><span class="ed-lab">この日のねらい</span>'+
        '<textarea class="ed-in" id="ed-aim" rows="3" placeholder="この日のねらい（改行できます）">'+esc(model.aim)+'</textarea></div>'+
      '<div class="ed-field"><span class="ed-lab">コート</span>'+
        '<input class="ed-in" id="ed-court" placeholder="例：半面 / 全面 / 屋外" value="'+esc(model.court)+'"></div>'+
      '<div class="ed-rows">'+rows+'</div>'+
      '<div class="ed-cell-actions"><button type="button" class="ed-mini" data-act="add-row">＋ 時間を追加</button></div>'+
      '<div class="ed-actions">'+
        '<button type="button" class="btn btn-primary" data-act="save">保存</button>'+
        '<button type="button" class="btn" data-act="cancel">キャンセル</button>'+
        '<button type="button" class="ed-mini" data-act="export">入力を書き出し</button>'+
        // 破壊的操作（サーバの手直しを削除）。保存・キャンセルと混同しないよう小型＋ed-del（警告色）で
        // 視覚的に分け、クリック時に確認ダイアログも挟む（移設後の誤操作防止・タスク要求）。
        '<button type="button" class="ed-mini ed-del" data-act="revert-auto">自動生成に戻す</button>'+
      '</div>';
  }
  // ── 並べ替え（SortableJS・ハンドルで掴む／着地位置を点線で表示）──
  var sortables=[]; // パネルに張ってある Sortable。再描画・閉じる前に破棄してリークを防ぐ。
  function destroySortables(){sortables.forEach(function(s){try{s.destroy();}catch(e){}});sortables=[];}
  function initSortables(){
    if(typeof Sortable==='undefined'||!panel)return; // ライブラリ未注入でも編集自体は動く（並べ替えのみ無効）
    // forceFallback: ネイティブHTML5 DnDでなくポインタ駆動にする。入力欄が並ぶ行でも掴みが安定し、
    // 着地点プレースホルダ表示・挙動がブラウザ間で一貫する（ネイティブDnDの不安定さを回避）。
    var common={animation:150,forceFallback:true,fallbackTolerance:4,ghostClass:'sortable-ghost',chosenClass:'sortable-chosen',dragClass:'sortable-drag'};
    var rowsEl=panel.querySelector('.ed-rows');
    if(rowsEl){
      sortables.push(Sortable.create(rowsEl,Object.assign({handle:'.ed-grip-row',draggable:'.ed-row',onEnd:function(evt){moveRow(evt.oldIndex,evt.newIndex);}},common)));
    }
    // セル内ドリルは各 .ed-items 単位。group を共有しないのでセルをまたぐ移動は起きない。
    panel.querySelectorAll('.ed-items').forEach(function(itemsEl){
      sortables.push(Sortable.create(itemsEl,Object.assign({handle:'.ed-grip-item',draggable:'.ed-item',onEnd:function(evt){moveItem(evt.from,evt.oldIndex,evt.newIndex);}},common)));
    });
  }
  // 行（時間ブロック）の並べ替えを model に反映してから再描画。
  function moveRow(oldI,newI){
    if(oldI==null||newI==null||oldI===newI)return;
    collectInputs(); // 入力値は data-ri 基準で取り込むので、視覚順が変わっても正しく拾える
    var moved=model.rows.splice(oldI,1)[0];
    model.rows.splice(newI,0,moved);
    renderPanel();
  }
  // セル内ドリルの並べ替えを model に反映してから再描画。
  function moveItem(fromEl,oldI,newI){
    if(oldI==null||newI==null||oldI===newI)return;
    collectInputs();
    var cellEl=fromEl.closest('.ed-cell');if(!cellEl)return;
    var ri=Number(cellEl.getAttribute('data-ri'));var side=cellEl.getAttribute('data-side');
    var cell=cellOf(model.rows[ri],side);if(!cell)return;
    var moved=cell.items.splice(oldI,1)[0];
    cell.items.splice(newI,0,moved);
    renderPanel();
  }
  function renderPanel(){destroySortables();panel.innerHTML=panelHtml();initSortables();}
  // 属性値内のダブルクォートだけ無害化（data-side は日本語可・"both"等）。
  function cssAttr(s){return String(s).replace(/"/g,'\\\\"');}
  // 再構築後に指定セレクタの入力へフォーカス（無ければ無視）。
  function focusIn(sel){
    if(!panel)return;
    var el=panel.querySelector(sel);
    if(el&&typeof el.focus==='function')el.focus();
  }

  // フォーム入力値を model に取り込む（保存・both切替の前に呼ぶ）。
  function collectInputs(){
    var aim=panel.querySelector('#ed-aim');var court=panel.querySelector('#ed-court');
    if(aim)model.aim=aim.value;
    if(court)model.court=court.value;
    panel.querySelectorAll('.ed-row').forEach(function(rowEl){
      var ri=Number(rowEl.getAttribute('data-ri'));
      var row=model.rows[ri];if(!row)return;
      var fromEl=rowEl.querySelector('[data-k="from"]');var toEl=rowEl.querySelector('[data-k="to"]');
      if(fromEl)row.from=fromEl.value;if(toEl)row.to=toEl.value;
      rowEl.querySelectorAll('.ed-cell').forEach(function(cellEl){
        var side=cellEl.getAttribute('data-side');
        var cell=cellOf(row,side);if(!cell)return;
        var blockEl=cellEl.querySelector('[data-k="block"]');var labelEl=cellEl.querySelector('[data-k="label"]');
        if(blockEl)cell.block=blockEl.value;if(labelEl)cell.label=labelEl.value;
        cellEl.querySelectorAll('.ed-item').forEach(function(itEl){
          var ii=Number(itEl.getAttribute('data-ii'));
          var it=cell.items[ii];if(!it)return;
          var nameEl=itEl.querySelector('[data-k="name"]');var noteEl=itEl.querySelector('[data-k="note"]');
          if(nameEl)it.name=nameEl.value;if(noteEl)it.note=noteEl.value;
        });
      });
    });
  }
  function cellOf(row,side){
    if(side==='both')return row.both;
    return row[side];
  }

  // 行の余白・行番号に触れたら、その行へ焦点を入れる（決定書3.3節）。行は tabindex="-1" で
  // Tab では到達しないが、script からは焦点を受けられる。焦点が入ると :focus-within で行の
  // 削除口だけが出る（タッチ環境ではこれが1回目のタップ＝出現。2回目のタップで削除口自体を押す＝実行）。
  // すでに行内の入力欄等に焦点があるとき（:focus-within）は奪わない。
  // [data-act] を持つ押せる部品（削除口・グリップ・チェック・反転コピー等）自身へのクリックは対象外
  // にする。それらは onPanelClick が個別に処理し、独自に焦点を動かすことがある（例: 削除口を押すと
  // 確認カードへ焦点が移る）。ここで無条件に行へ再フォーカスすると、その焦点管理を上書きしてしまう。
  function onPanelRowFocusClick(e){
    if(e.target.closest('[data-act]'))return;
    var row=e.target.closest('.ed-row');
    if(!row)return;
    if(!row.matches(':focus-within'))row.focus();
  }

  // ── フォーム操作（委譲）──
  function onPanelClick(e){
    var btn=e.target.closest('[data-act]');if(!btn)return;
    var act=btn.getAttribute('data-act');
    if(act==='save'){doSave();return;}
    if(act==='cancel'){
      collectInputs(); // DOMの最新入力値を取り込んでから「空」を判定する（change未発火の入力欄も拾う）
      confirmThen({
        isEmpty:!modelHasContent(),
        h:'保存していない入力を捨てて編集を閉じます。',
        b:'最後に保存した状態に戻ります。',
        x:'捨てて閉じる',icon:'undo',
        opener:btn,
        onExec:closePanel
      });
      return;
    }
    if(act==='export'){exportJson();return;}
    if(act==='revert-auto'){collectInputs();revertAuto(btn);return;}
    if(act==='load-seed'){
      collectInputs(); // DOMの最新入力値を取り込んでから「空」を判定する（change未発火の入力欄も拾う）
      var seed=SEEDPREFILL[model.date];
      if(!seed){flash('この日の叩き台はありません');return;}
      if(modelHasContent()&&!window.confirm('いまの内容を、自動生成の叩き台で上書きします。よろしいですか？'))return;
      model=normalizeModel(deepClone(seed),model.date,model.weekday);
      renderPanel();
      flash('叩き台を読み込みました。確認して保存してください');
      return;
    }
    collectInputs(); // 構造変更の前に現在値を取り込む
    if(act==='only-gender'){
      var wantG=btn.getAttribute('data-only-gender')||null;
      var target=(wantG==='男子'||wantG==='女子')?wantG:null;
      if(target===model.onlyGender)return; // 既に選択中なら何もしない
      // オンリーへ切替るとき、畳まれる中身（反対列 or 共通行）があれば確認を挟む（黙って壊さない）。
      // 退避されて「男女両方」に戻せば復元されることを文言でも正しく伝える（実挙動と一致・A/B）。
      if(target&&onlyGenderWouldHideContent(target)){
        if(!window.confirm(target+'のみの表示に切り替えます。いま隠れる内容（反対の性別・男女共通）は退避され、「男女両方」に戻すと復元します。切り替えますか？'))return;
      }
      setOnlyGender(target);
      flash(target?(target+'のみに切り替えました。確認して保存してください'):'男女両方に戻しました。確認して保存してください');
      return;
    }
    if(act==='add-row'){
      var newRi=model.rows.length;
      // 直前の時間帯の終了時刻を、新しい時間帯の開始時刻の既定にする（終了も開始に合わせる＝#3と同じ既定）。
      var prevRow=model.rows[newRi-1];
      var startFrom=(prevRow&&prevRow.to)?prevRow.to:'';
      var nr=blankRow();nr.from=startFrom;nr.to=startFrom;
      model.rows.push(nr);renderPanel();
      // 再構築でフォーカスが外れるので、新規行の最初の時刻 input へ戻す。
      focusIn('.ed-row[data-ri="'+newRi+'"] [data-k="from"]');
      return;
    }
    if(act==='copy-from'){
      var cfSel=panel.querySelector('#ed-copyfrom');
      var srcDate=cfSel?cfSel.value:'';
      if(!srcDate||!PREFILL[srcDate]){flash('コピー元の日を選んでください');return;}
      if(modelHasContent()&&!window.confirm('いまの内容を、選んだ日の内容で上書きします。よろしいですか？'))return;
      // 取り込み元の中身（ねらい・コート・時間帯）をこの日に複製。日付・曜日はこの日のまま保つ。
      model=normalizeModel(deepClone(PREFILL[srcDate]),model.date,model.weekday);
      renderPanel();
      flash(dateLabelISO(srcDate,PREFILL[srcDate].weekday)+'の内容を取り込みました');
      return;
    }
    var rowEl=btn.closest('.ed-row');
    var ri=rowEl?Number(rowEl.getAttribute('data-ri')):-1;
    if(act==='del-row'){
      if(ri<0)return;
      var rowToDel=model.rows[ri];
      var timeLabel=(rowToDel&&rowToDel.from&&rowToDel.to)?('（'+rowToDel.from+'〜'+rowToDel.to+'）'):'';
      confirmThen({
        isEmpty:rowIsEmpty(rowToDel),
        h:'時間'+(ri+1)+timeLabel+'を削除します。',
        b:'この時間に入れた項目もいっしょに消えます。',
        x:'削除する',icon:'trash',
        opener:btn,
        onExec:function(){
          model.rows.splice(ri,1);
          if(model.rows.length===0)model.rows.push(blankRow());
          renderPanel();
        }
      });
      return;
    }
    if(act==='flip-copy'){if(ri>=0)flipCopyRow(ri);return;}
    if(act==='add-item'){
      var cellEl=btn.closest('.ed-cell');var side=cellEl.getAttribute('data-side');
      var cell=cellOf(model.rows[ri],side);
      if(cell){
        var newIi=cell.items.length;
        cell.items.push({name:'',note:''});renderPanel();
        // 追加した項目の名前 input へフォーカス。
        focusIn('.ed-item[data-ri="'+ri+'"][data-side="'+cssAttr(side)+'"][data-ii="'+newIi+'"] [data-k="name"]');
      }
      return;
    }
    if(act==='del-item'){
      var itEl=btn.closest('.ed-item');var sideD=itEl.getAttribute('data-side');var ii=Number(itEl.getAttribute('data-ii'));
      var cellD0=cellOf(model.rows[ri],sideD);
      var itD=cellD0?cellD0.items[ii]:null;
      if(!itD)return;
      var nameLabel=(itD.name&&itD.name.trim())?itD.name.trim():((itD.note&&itD.note.trim())?itD.note.trim():'');
      confirmThen({
        isEmpty:itemIsEmpty(itD),
        h:nameLabel?('この項目（'+nameLabel+'）を削除します。'):'この項目を削除します。',
        b:'補足に書いた内容もいっしょに消えます。',
        x:'削除する',icon:'trash',
        opener:btn,
        onExec:function(){
          var cellD=cellOf(model.rows[ri],sideD);
          if(cellD)cellD.items.splice(ii,1);
          renderPanel();
        }
      });
      return;
    }
  }
  function onPanelChange(e){
    // 枠（ブロック）select が変わったら、そのセルのドリル名候補（datalist）を新しい枠に絞り直す。
    // 全体再描画はしない（入力中の値を失わないため）＝該当セルの name input の list 属性だけ差し替える。
    var blockSel=e.target.closest('[data-k="block"]');
    if(blockSel){
      var bCellEl=blockSel.closest('.ed-cell');
      if(bCellEl){
        var bRi=Number(bCellEl.getAttribute('data-ri'));var bSide=bCellEl.getAttribute('data-side');
        var bCell=cellOf(model.rows[bRi],bSide);
        if(bCell)bCell.block=blockSel.value; // モデルにも反映（保存・再描画前提を崩さない）
        var listId=listIdForBlock(blockSel.value);
        bCellEl.querySelectorAll('.ed-name').forEach(function(nameEl){nameEl.setAttribute('list',listId);});
      }
      return;
    }
    // 開始時刻が入ったら終了時刻を開始に合わせる（終了が空 or 開始より前のときだけ。妥当に手入力済みの終了は壊さない）。
    var fromEl=e.target.closest('[data-k="from"]');
    if(fromEl){
      var fRowEl=fromEl.closest('.ed-row');if(!fRowEl)return;
      var fRi=Number(fRowEl.getAttribute('data-ri'));var fRow=model.rows[fRi];
      var toEl=fRowEl.querySelector('[data-k="to"]');
      if(toEl){
        var fm=toMin(fromEl.value),tm=toMin(toEl.value);
        if(fromEl.value&&(tm==null||(fm!=null&&tm<fm))){
          toEl.value=fromEl.value;
          if(fRow)fRow.to=fromEl.value;
        }
      }
      if(fRow)fRow.from=fromEl.value;
      return;
    }
    var box=e.target.closest('[data-act="toggle-both"]');if(!box)return;
    collectInputs();
    var rowEl=box.closest('.ed-row');var ri=Number(rowEl.getAttribute('data-ri'));
    var row=model.rows[ri];if(!row)return;
    if(box.checked){
      mergeToBoth(row);   // 共通ON: 男女の中身を both へ無損失で集約（片側→そのまま／両側→マージ）
    }else{
      splitFromBoth(row); // 共通OFF: 元の男女別へ復元（未編集なら元内容を完全復元・共通を編集していたら両側へ複製）
    }
    renderPanel();
  }
  // セルが「中身あり」か（見出し or 名前のある項目）。見出しだけ・項目だけでも中身ありとみなす。
  function cellHasContent(cell){
    if(!cell)return false;
    if(cell.label&&cell.label.trim())return true;
    return (cell.items||[]).some(function(it){return it.name&&it.name.trim();});
  }
  // 行が「空」か（時刻も男女いずれの中身も無い）。空なら確認カードを出さず即削除する（決定書3.2節
  // 「対象が空のときは確認を出さず即実行する」）。新規に足しただけでまだ何も入れていない行が対象。
  function rowIsEmpty(row){
    if(!row)return true;
    if(row.from||row.to)return false;
    if(cellHasContent(row.both))return false;
    if(cellHasContent(row['男子']))return false;
    if(cellHasContent(row['女子']))return false;
    return true;
  }
  // 項目が「空」か（名前もメモも無い）。空なら確認カードを出さず即削除する。
  function itemIsEmpty(it){
    if(!it)return true;
    return !(it.name&&it.name.trim())&&!(it.note&&it.note.trim());
  }
  // 2つの時刻区間 [aFrom,aTo) と [bFrom,bTo) が重なるか（分換算・不正時刻は重複扱いにしない）。
  function rangesOverlap(aFrom,aTo,bFrom,bTo){
    var a1=toMin(aFrom),a2=toMin(aTo),b1=toMin(bFrom),b2=toMin(bTo);
    if(a1==null||a2==null||b1==null||b2==null)return false;
    return a1<b2&&b1<a2;
  }
  // 反転コピー: 起点行（前半ブロック・男女とも中身がある想定）を複製し、男女の中身を入れ替えた
  // 「後半ブロック」を直後の時間帯（開始=前半の終了・長さ=前半と同じ）へ1個だけ追加する。
  // 前半ブロック（起点行）は一切変更しない（純粋な追加操作）。既存ブロックと時間重複するなら追加しない。
  function flipCopyRow(unitStartRi){
    var src=model.rows[unitStartRi];
    if(!src){flashRow(unitStartRi,'反転コピーする対象の行が見つかりませんでした。もう一度お試しください。');return;}
    var boys=cellOf(src,'男子'),girls=cellOf(src,'女子');
    if(!cellHasContent(boys)&&!cellHasContent(girls)){
      flashRow(unitStartRi,'反転コピーの元になる中身がありません（男女どちらかにドリルを入れてください）');
      return;
    }
    var fm=toMin(src.from),tm=toMin(src.to);
    if(fm==null||tm==null||!(tm>fm)){
      flashRow(unitStartRi,'反転コピーには前半ブロックの開始・終了時刻が必要です。時刻を入力してから押してください。');
      return;
    }
    var dur=tm-fm;
    var newFrom=src.to;
    var newToMin=tm+dur;
    // 後半の終了が24:00以上に跨ぐと不正時刻（'24:20'等・<input type=time>が弾く）になるため追加しない（D）。
    if(newToMin>=1440){
      flashRow(unitStartRi,'反転コピー先が24:00を跨ぐため追加できません（前半を早い時間帯にしてください）');
      return;
    }
    var newTo=minToHm(newToMin);
    // 追加位置が既存の他ブロックと時間重複しないことを確認する（起点行自身は対象外）。
    var overlap=model.rows.some(function(r,i){
      if(i===unitStartRi)return false;
      return rangesOverlap(newFrom,newTo,r.from,r.to);
    });
    if(overlap){
      flashRow(unitStartRi,'反転コピー先（'+newFrom+'〜'+newTo+'）の時間帯が既存のブロックと重なるため追加できません。前半の時刻をずらしてください。');
      return;
    }
    var added={
      from:newFrom,
      to:newTo,
      both:null,
      '男子':deepClone(girls)||blankCell(),
      '女子':deepClone(boys)||blankCell()
    };
    model.rows.splice(unitStartRi+1,0,added);
    renderPanel();
    flashRow(unitStartRi,'男女を入れ替えた後半ブロック（'+newFrom+'〜'+newTo+'）をこの行の直後に追加しました。内容を確認して保存してください。');
  }
  // 分→'HH:MM'（反転コピーの新しい終了時刻を作るため。toMin の逆）。
  function minToHm(min){
    var h=Math.floor(min/60),m=min%60;
    return (h<10?'0':'')+h+':'+(m<10?'0':'')+m;
  }
  // 名前のある項目だけを取り出す（共通化の集約で空項目を持ち込まない）。
  function nonEmptyItems(cell){
    if(!cell)return [];
    return (cell.items||[]).filter(function(it){return it.name&&it.name.trim();});
  }
  // 2セルのitemsを順序維持で結合し、name+note完全一致の重複だけ畳む（同一ドリルの二重掲載を防ぐ）。
  function mergeItems(a,b){
    var out=[],seen={};
    [].concat(nonEmptyItems(a),nonEmptyItems(b)).forEach(function(it){
      var key=(it.name||'').trim()+'\\u0001'+(it.note||'').trim();
      if(seen[key])return; seen[key]=true;
      out.push({name:it.name||'',note:it.note||''});
    });
    return out;
  }
  // 非空を優先して片方を採る（共通化時の見出し・枠の選択。男子優先・無ければ女子）。
  function pickNonEmpty(a,b){var x=(a||'').trim();return x?a:(b||'');}
  // 共通ON: 男女の中身を both へ集約する。内容は絶対に失わない。
  //  片側のみ内容あり→その内容をそのまま採用 / 両側に内容あり→items結合・見出しと枠は非空優先 /
  //  両側空→空の both（失う内容が無い）。元の男女別は _memo に退避し、OFFで完全復元できるようにする。
  function mergeToBoth(row){
    var boys=row['男子'],girls=row['女子'];
    var hb=cellHasContent(boys),hg=cellHasContent(girls);
    var both;
    if(hb&&hg){
      both={block:pickNonEmpty(boys.block,girls.block)||BLOCKS[0]||'',
        label:pickNonEmpty(boys.label,girls.label),
        items:mergeItems(boys,girls)};
    }else if(hb){
      both=deepClone(boys);
    }else if(hg){
      both=deepClone(girls);
    }else{
      both=blankCell();
    }
    // 元の男女別を退避（OFFで距離をおいた別内容を完全復元するため）と、ON時点の both 基準を控える。
    row._memo={'男子':deepClone(boys)||blankCell(),'女子':deepClone(girls)||blankCell()};
    row._mergeBase=deepClone(both);
    row.both=both;
    delete row.split;
  }
  // 共通OFF: both を男女別へ戻す。
  //  共通セルを編集していなければ（ON時点と同一）元の男女別をそのまま復元（別内容を失わない）。
  //  共通セルを編集していれば、その最新内容を両側へ複製（共通での編集も失わない）。
  function splitFromBoth(row){
    var editedCommon=!row._mergeBase||JSON.stringify(row.both)!==JSON.stringify(row._mergeBase);
    if(row._memo&&!editedCommon){
      row['男子']=row._memo['男子']||blankCell();
      row['女子']=row._memo['女子']||blankCell();
    }else if(row.both){
      row['男子']=deepClone(row.both);
      row['女子']=deepClone(row.both);
    }
    if(!row['男子'])row['男子']=blankCell();
    if(!row['女子'])row['女子']=blankCell();
    row.split=true;
    row._memo=null;row._mergeBase=null;row.both=null;
  }

  // 1行を論理的な「男女両方」状態へ戻す（退避 _onlyMemo からの復元）。オンリー中でなければ何もしない。
  //  退避があり、オンリー中に採用列を編集していなければ元の男女別・共通(both)を完全復元する。
  //  編集していれば（オンリー中に手を入れた）採用列の最新内容を残す（余計な上書きをしない）。
  function restoreRowFromOnly(row){
    if(!row._onlyMemo){row._onlyLastGender=null;return;}
    var lastOnly=row._onlyLastGender; // オンリー中に採用していた性別（editedチェック用）
    var editedSinceOnly=lastOnly&&JSON.stringify(row[lastOnly])!==JSON.stringify(row._onlyMemo[lastOnly]);
    if(editedSinceOnly){
      // 採用列は最新（編集後）を残し、反対列と共通(both)だけ退避から戻す（採用列の編集を消さない）。
      var other=lastOnly==='男子'?'女子':'男子';
      row[other]=deepClone(row._onlyMemo[other])||blankCell();
    }else{
      row['男子']=deepClone(row._onlyMemo['男子'])||blankCell();
      row['女子']=deepClone(row._onlyMemo['女子'])||blankCell();
    }
    row.both=row._onlyMemo.both?deepClone(row._onlyMemo.both):null; // 共通(both)行も復元（B）
    row._onlyMemo=null;
    row._onlyLastGender=null;
  }
  // 男女オンリーモードの切替。g='男子'|'女子' でその性別だけの日にする／g=null で男女両方へ戻す。
  //  常にまず「男女両方」状態へ戻してから新モードを適用する（オンリー中→別オンリーの直接切替も
  //  「両方に戻す→新オンリー」と等価にして、退避の二重化・原本消失を防ぐ＝A）。
  //  オンリーへ入るとき: 反対列＋共通(both)を _onlyMemo に退避（B）してから対象1性別だけにする
  //  （_memo/_mergeBase の退避復元と同型・第3章の安全策＝コーチ手入力を失わない）。
  function setOnlyGender(g){
    if(!model)return;
    var target=(g==='男子'||g==='女子')?g:null;
    // 直接切替・両方復帰いずれも、まず現オンリーを解除して論理「両方」へ戻す（Aの等価化）。
    model.rows.forEach(function(row){restoreRowFromOnly(row);});
    model.onlyGender=null;
    if(target){
      model.rows.forEach(function(row){
        // 反対列だけでなく共通(both)も退避する（Bの root fix＝両方復帰で both が戻る）。
        row._onlyMemo={
          '男子':deepClone(row['男子'])||blankCell(),
          '女子':deepClone(row['女子'])||blankCell(),
          both:row.both?deepClone(row.both):null
        };
        var keep=row[target]; // このタイミングでは復元済みなので採用列は原本を指す
        row.both=null; // オンリー日は共通行を持たない（退避済みなので両方復帰で戻る）
        row['男子']=(target==='男子')?keep:blankCell();
        row['女子']=(target==='女子')?keep:blankCell();
        row._onlyLastGender=target;
      });
      model.onlyGender=target;
    }
    renderPanel();
  }
  // オンリー切替で失われうる中身（反対列 or 共通行）が model 内にあるか。確認ダイアログの要否判定に使う。
  //  target へオンリー化すると「target 以外の列（反対列）」と「共通(both)行」が畳まれるため、
  //  そこに中身があれば確認を出す（B: both行がある日をオンリー化する時も確認を出す）。
  function onlyGenderWouldHideContent(target){
    if(!model)return false;
    var opposite=target==='男子'?'女子':'男子';
    return model.rows.some(function(row){
      if(row.both)return cellHasContent(row.both);
      return cellHasContent(row[opposite]);
    });
  }

  // ── 保存: model→override（保存スキーマ）。空名item・空行は捨てる。minutes は from/to 算出 ──
  function cleanCell(cell){
    if(!cell)return null;
    var items=(cell.items||[]).filter(function(it){return it.name&&it.name.trim();})
      .map(function(it){var o={name:it.name.trim()};if(it.note&&it.note.trim())o.note=it.note.trim();return o;});
    var label=(cell.label||'').trim();
    // 見出しだけ（例「男子に従う」「ゲーム」「アップ＆ラン」）でも有効な指定。
    // 見出し・ドリル項目がともに空のときだけ捨てる（見出しを書いただけの行が消える事故を防ぐ）。
    if(items.length===0&&!label)return null;
    return {block:cell.block||'',label:label||cell.block||'',items:items};
  }
  function buildOverride(){
    var onlyGender=(model.onlyGender==='男子'||model.onlyGender==='女子')?model.onlyGender:null;
    var rows=[];
    model.rows.forEach(function(r){
      var from=r.from||'';var to=r.to||'';
      var fm=toMin(from),tm=toMin(to);
      // to<from や不正時に負値を出さない。空時刻は null のまま。
      var minutes=(fm!=null&&tm!=null)?Math.max(0,tm-fm):null;
      var out={from:from,to:to,minutes:minutes};
      if(onlyGender){
        // オンリー時は対象性別のセルだけを載せる（反対列・both は出さない＝退避キーも保存に含めない）。
        var only=cleanCell(r[onlyGender]);
        if(!only)return; // 対象性別が空なら行ごと捨てる
        out[onlyGender]=only;
      }else if(r.both){
        var both=cleanCell(r.both);
        if(!both)return; // 共通セルが空なら行ごと捨てる
        out.both=both;
      }else{
        var boys=cleanCell(r['男子']);var girls=cleanCell(r['女子']);
        if(!boys&&!girls)return; // 男女とも空なら行を捨てる
        if(boys)out['男子']=boys;
        if(girls)out['女子']=girls;
        out.split=true;
      }
      rows.push(out);
    });
    var ov={
      date:model.date,
      weekday:model.weekday,
      source:'coach',
      layout:'two-col',
      court:(model.court||'').trim(),
      aim:(model.aim||'').trim(),
      rows:rows
    };
    if(onlyGender)ov.onlyGender=onlyGender;
    var title=(model.title||'').trim();
    if(title)ov.title=title;
    return ov;
  }
  // 本番のログイン時だけ Bearer を付ける。ローカル/テストは __getIdToken 未定義＝ヘッダ無し（サーバも素通り）。
  function withAuth(headers){
    var h=headers||{};
    if(typeof window.__getIdToken!=='function')return Promise.resolve(h);
    return window.__getIdToken().then(function(t){if(t)h['Authorization']='Bearer '+t;return h;}).catch(function(){return h;});
  }
  // 複数テナントに所属するコーチが /?t=B を開いて編集したとき、保存先を「いま見ている画面のテナント」に
  // 揃えるため、現在URLの ?t を書き込み先URLへ引き継ぐ。単一所属（?t無し）はサーバが唯一の在籍に解決する。
  // サーバは送られた t を在籍照合してから採用する（在籍外なら拒否＝越境にならない）。
  function withTenantQ(path){
    try{
      var t=new URLSearchParams(location.search).get('t');
      if(!t)return path;
      return path+(path.indexOf('?')<0?'?':'&')+'t='+encodeURIComponent(t);
    }catch(_){return path;}
  }
  function doSave(){
    collectInputs();
    var ov=buildOverride();
    var art=editingArticle;
    var myPanel=panel; // 並行操作（別日編集/キャンセル）でグローバルが差し替わっても誤操作しないため捕捉
    flash('保存中…');
    // バックエンド（Cloud Function）へ保存。Firestore への書き込みは Admin SDK 経由のみ。
    var send=function(){return withAuth({'Content-Type':'application/json'})
      .then(function(headers){return fetch(withTenantQ('/api/override'),{method:'POST',headers:headers,body:JSON.stringify(ov)});});};
    send()
      .then(function(r){
        // セッションCookieが約24hで失効して401なら、クライアント認証が生きていれば張り直して1回だけ再送。
        if(r.status===401&&typeof window.__establishSession==='function'){
          return window.__establishSession().then(send).catch(function(){return r;});
        }
        return r;
      })
      .then(function(r){return r.json().catch(function(){return {ok:r.ok};});})
      .then(function(res){
        if(res&&res.ok){
          var saved=(res.override&&res.override.date)?res.override:ov; // サーバ正規化後（無ければ送信値）
          PREFILL[saved.date]=saved;   // 表示・書き出し・再編集をサーバ保存内容に一致させる
          renderDay(art,saved);        // 捕捉済みのその日を即時再描画（次回読込はサーバが同内容を出す）
          if(panel===myPanel)closePanel(); // 同じ編集セッションのときだけ閉じる
          flash('保存しました（サーバに保存）');
        }else{
          flash('保存に失敗しました（'+((res&&res.error)||'サーバ応答エラー')+'）');
        }
      })
      .catch(function(){
        flash('保存できませんでした（バックエンド未接続。エミュレータ/本番URLで開いてください）');
      });
  }

  // ── パネル開閉（記事本体をフォームに差し替え・キャンセルで復帰）──
  // 編集中に止めたナビボタン（日・週・月・レベル）。解除時はここに入れた分だけ戻す（元から無効な物は触らない）。
  var navLocked=[];
  function setNavDisabled(on){
    if(on){
      navLocked=[];
      document.querySelectorAll('.cal-go,.cal-go-week,.cal-go-dayweek,.cal-go-month,.lvtab').forEach(function(b){
        if(!b.disabled){b.disabled=true;navLocked.push(b);}
      });
    }else{
      navLocked.forEach(function(b){b.disabled=false;});
      navLocked=[];
    }
  }
  // 編集パネルを開く。fromSeed=true なら現状態でなくエンジン叩き台を初期値にする（オプトイン自動入力）。
  function openPanel(fromSeed){
    if(panel){panel.scrollIntoView({behavior:'smooth',block:'start'});return;} // 既に編集中なら二重に開かない
    var article=curDay();
    if(!article){flash('編集できる日が表示されていません');return;}
    var date=(article.getAttribute('data-date')||'').trim();
    // data-date が非空（実ISO）の日のみ編集可（保存APIの doc ID＝日付に使うため）。
    if(!date){flash('この日は上書き編集の対象外です');return;}
    editingArticle=article;
    var weekday=article.getAttribute('data-day')||'';
    model=fromSeed?initModelFromSeed(date,weekday):initModel(date,weekday);
    if(fromSeed)flash('叩き台を読み込みました。確認・編集して保存してください');
    panel=document.createElement('section');
    panel.className='ed-panel';
    panel.setAttribute('data-print-hide','');
    article.parentNode.insertBefore(panel,article.nextSibling);
    article.hidden=true; // 記事本体を隠してフォームを見せる
    renderPanel();
    panel.addEventListener('click',onPanelClick);
    panel.addEventListener('change',onPanelChange);
    panel.addEventListener('click',onPanelRowFocusClick);
    setNavDisabled(true); // 編集中は日・週・月・レベルの移動を止める
    panel.scrollIntoView({behavior:'smooth',block:'start'});
  }
  function closePanel(){
    destroySortables();
    setNavDisabled(false); // 移動の制限を解除
    if(panel&&panel.parentNode)panel.parentNode.removeChild(panel);
    if(editingArticle)editingArticle.hidden=false;
    panel=null;model=null;editingArticle=null;
  }

  // ── 自動に戻す: サーバの上書きを削除→対象日を空状態へ局所更新 ──
  // 上部ツールバーから編集画面の中へ移設済み（2026-07-29）。編集中は対象の article が hidden 化されて
  // curDay()（hidden でない .day を探す）が拾えなくなるため、編集中は editingArticle を優先して使う。
  // opener: 押されたボタン（「やめる」/Escで閉じたときに焦点を返す先。確認カード経由の呼び出し用）。
  function revertAuto(opener){
    var article=editingArticle||curDay();
    if(!article){flash('対象の日が表示されていません');return;}
    var date=(article.getAttribute('data-date')||'').trim();
    if(!date){flash('この日は上書き編集の対象外です');return;}
    var weekday=article.getAttribute('data-day')||'';
    // 破壊的操作（元に戻せない）のため、移設後の誤操作防止として確認カードを挟む（決定書3.2節）。
    // 対象が空（この日に手で入れた内容が無い）なら確認カードを出さず即実行する。
    confirmThen({
      isEmpty:!modelHasContent(),
      h:'手で入れた内容を捨てて自動生成に戻します。',
      b:'この日に手で入れた時間と項目がすべて消えます。',
      x:'捨てて戻す',icon:'undo',
      opener:opener,
      onExec:function(){
        var myPanel=panel;
        flash('自動に戻しています…');
        withAuth({'Content-Type':'application/json'})
          .then(function(headers){return fetch(withTenantQ('/api/override/delete'),{method:'POST',headers:headers,body:JSON.stringify({date:date})});})
          .then(function(r){return r.json().catch(function(){return {ok:r.ok};});})
          .then(function(res){
            if(res&&res.ok){
              delete PREFILL[date];
              renderEmptyDay(article,date,weekday);
              if(panel===myPanel)closePanel();
              article.hidden=false;
              flash('自動生成に戻しました');
            }
            else{ flash('戻せませんでした（'+((res&&res.error)||'サーバ応答エラー')+'）'); }
          })
          .catch(function(){ flash('バックエンド未接続のため戻せません（エミュレータ/本番URLで開いてください）'); });
      }
    });
  }

  // 'YYYY-MM-DD'→曜日。書き出しの weekday 補完用。
  function weekdayOf(iso){
    var p=String(iso).split('-');
    var dt=new Date(Number(p[0]),Number(p[1])-1,Number(p[2]));
    return ['日','月','火','水','木','金','土'][dt.getDay()];
  }
  // ── 書き出し: サーバ状態（prefill）の全上書きを overrides.json 配列形でコピー（リポジトリの種データに反映できる）──
  function exportJson(){
    var arr=Object.keys(PREFILL).sort().map(function(k){
      var p=PREFILL[k]||{};
      var o={date:k,weekday:p.weekday||weekdayOf(k),source:'coach',layout:'two-col'};
      if(p.court)o.court=p.court;
      if(p.title)o.title=p.title;
      if(p.aim)o.aim=p.aim;
      o.rows=p.rows||[];
      return o;
    });
    var text=JSON.stringify(arr,null,2);
    copyText(text);
  }
  function copyText(text){
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(function(){
        flash('コピーしました（overrides.json に貼り付け）');
      },function(){fallbackCopy(text);});
    }else{
      fallbackCopy(text);
    }
  }
  function fallbackCopy(text){
    var area=ensureExportArea();
    area.hidden=false;area.value=text;area.focus();area.select();
    flash('下の枠を選択してコピーしてください');
  }
  function ensureExportArea(){
    var area=document.getElementById('ed-export-area');
    if(area)return area;
    area=document.createElement('textarea');
    area.id='ed-export-area';area.className='ed-export-area';area.readOnly=true;area.setAttribute('data-print-hide','');
    // 「入力を書き出し」ボタンは編集画面（panel）の中にあるので、クリップボード不可時のフォールバック欄も
    // panel の中に出す（panel が無い呼び出し経路は無い想定だが、念のため #ed-msg の親へ退避する）。
    var msg=document.getElementById('ed-msg');
    var host=panel||(msg&&msg.parentNode?msg.parentNode:document.body);
    host.appendChild(area);
    return area;
  }

  // ── 確認表示（一時メッセージ）──
  var msgTimer=null;
  function flash(t){
    var msg=document.getElementById('ed-msg');if(!msg)return;
    msg.textContent=t;
    if(msgTimer)clearTimeout(msgTimer);
    msgTimer=setTimeout(function(){msg.textContent='';},2400);
  }
  // 行の近くに出す確認表示（反転コピー等・押した行の結果／中断理由をその場で見せる）。
  // 対象行のDOMが見つからない防御時は、メッセージを取りこぼさないよう共有欄(flash)へフォールバックする。
  // 表示は5秒（flashの2400msだと中断理由・成功文言のような長い一文を読み切れないため長めに取る）。
  var ROW_MSG_MS=5000;
  function flashRow(ri,t){
    var rowEl=panel&&panel.querySelector('.ed-row[data-ri="'+ri+'"]');
    var el=rowEl&&rowEl.querySelector('.ed-row-msg');
    if(!el){flash(t);return;}
    el.textContent=t;
    if(el._msgTimer)clearTimeout(el._msgTimer);
    el._msgTimer=setTimeout(function(){el.textContent='';},ROW_MSG_MS);
  }

  // ── 確認カード（決定書3.2節・承認済みモック docs/specs/button-roles-20260730.html を実装へ移す）──
  // 破壊は色で警告せず、押した瞬間に失うものの名前を出して止める。行の削除・項目の削除・
  // 自動生成に戻す・キャンセルの4つがここを通る。対象が空のとき（消えるものが無いとき）は
  // 確認カードを出さず即実行する（呼び出し側が isEmpty で判定して渡す）。
  // 実行ボタンは中立（副の操作）ロールを引き、破壊ロールを一切参照しない（3.2節「実行ボタンが
  // 破壊ロールを参照しないこと」＝1問の全選択肢を並べる場では、2つの答えの強さを色で差をつけない）。
  var CD_TRASH='M6 7h12M9 7V5h6v2M8 7l1 13h6l1-13';
  var CD_UNDO='M9 14L4 9l5-5M4 9h11a5.5 5.5 0 0 1 0 11h-5';
  var cdOnExec=null; // 開いている確認カードの「実行」で呼ぶコールバック
  var cdOpener=null; // 「やめる」/Escで閉じたときに焦点を返す先
  // 確認カードのDOM（無ければ1回だけ作って以後使い回す。ensureExportArea と同じ遅延生成の作法）。
  function cdEnsure(){
    var el=document.getElementById('ed-cd');
    if(el)return el;
    el=document.createElement('div');
    el.id='ed-cd';el.className='ed-cd';el.hidden=true;el.setAttribute('data-print-hide','');
    el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');
    el.setAttribute('aria-labelledby','ed-cd-h');el.setAttribute('aria-describedby','ed-cd-b');
    el.innerHTML='<div class="ed-cd-scrim" data-cd-close></div>'+
      '<div class="ed-cd-card" id="ed-cd-card" tabindex="-1">'+
        '<p class="ed-cd-h" id="ed-cd-h"></p>'+
        '<p class="ed-cd-b" id="ed-cd-b"></p>'+
        '<div class="rc-actions">'+
          '<button type="button" class="ed-cd-btn rc-cancel" data-cd-close>やめる</button>'+
          '<button type="button" class="ed-cd-btn rc-exec" id="ed-cd-exec">'+
            '<svg viewBox="0 0 24 24" aria-hidden="true" id="ed-cd-icon"></svg>'+
            '<span id="ed-cd-execlabel"></span>'+
          '</button>'+
        '</div>'+
      '</div>';
    document.body.appendChild(el);
    el.addEventListener('click',function(e){
      if(e.target.closest('[data-cd-close]')){cdClose();return;}
      if(e.target.closest('#ed-cd-exec')){cdExecCurrent();return;}
    });
    document.addEventListener('keydown',cdOnKeydown);
    return el;
  }
  function cdExecCurrent(){
    var run=cdOnExec;
    cdClose();
    if(typeof run==='function')run();
  }
  /**
   * 確認カードを開く（対象が空なら開かず即実行）。
   * @param {{h:string,b:string,x:string,icon:'trash'|'undo',isEmpty:boolean,opener:Element,onExec:Function}} opts
   */
  function confirmThen(opts){
    if(opts.isEmpty){opts.onExec();return;}
    var el=cdEnsure();
    document.getElementById('ed-cd-h').textContent=opts.h;
    document.getElementById('ed-cd-b').textContent=opts.b;
    document.getElementById('ed-cd-execlabel').textContent=opts.x;
    document.getElementById('ed-cd-icon').innerHTML='<path d="'+(opts.icon==='undo'?CD_UNDO:CD_TRASH)+'"/>';
    cdOnExec=opts.onExec;
    cdOpener=opts.opener||document.activeElement;
    el.hidden=false;
    // 焦点はカードの箱に置き、やめるにも実行にも置かない（モックと同じ扱い。誤ってもう1打鍵で
    // 抜けさせない・実行に焦点を置くと破壊色を避けた意図が焦点経由で戻ってしまうため）。
    document.getElementById('ed-cd-card').focus();
  }
  function cdClose(){
    var el=document.getElementById('ed-cd');
    if(!el||el.hidden)return;
    el.hidden=true;
    cdOnExec=null;
    if(cdOpener&&typeof cdOpener.focus==='function')cdOpener.focus();
    cdOpener=null;
  }
  // Escで閉じる／開いている間はTabをカード内に閉じ込める（背後を操作させない）。
  function cdOnKeydown(e){
    var el=document.getElementById('ed-cd');
    if(!el||el.hidden)return;
    if(e.key==='Escape'){e.preventDefault();cdClose();return;}
    if(e.key==='Tab'){
      var focusables=el.querySelectorAll('button:not([tabindex="-1"])');
      if(!focusables.length)return;
      var first=focusables[0],last=focusables[focusables.length-1];
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
    }
  }

  // ── ボタン結線 ──
  // 「自動で叩き台を入れる」「自動に戻す」「入力を書き出し」は編集画面の中へ移設済み（2026-07-29）。
  // それぞれ data-act="load-seed"/"revert-auto"/"export" として onPanelClick の委譲で拾う（上記）。
  var editBtn=document.getElementById('ed-edit');if(editBtn)editBtn.addEventListener('click',function(){openPanel(false);});

  // 空状態日の中の導線（「入力する」「自動で叩き台を入れる」）。表示中の空状態日からそのまま編集に入る。
  document.addEventListener('click',function(e){
    var b=e.target.closest('[data-empty-act]');
    if(!b)return;
    openPanel(b.getAttribute('data-empty-act')==='seed');
  });

  window.__bcsEditor={renderDay:renderDay,exportJson:exportJson,openPanel:openPanel,model:function(){return model;},setOnlyGender:setOnlyGender,buildOverride:buildOverride};
})();`;
}
