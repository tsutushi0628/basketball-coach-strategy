/**
 * @file コーチ編集UI（クライアント側のみ・LLM不使用・決定論）。
 *
 * タイムライン画面の「今表示している上書き日」をブラウザ上で編集し、ブラウザ内
 * (localStorage) に保存して即時に再描画する。保存は overrides.json と同じスキーマで
 * 書き出せるので、コーチは手書きせずに上書き日を入力→コピー→overrides.json へ貼る、で
 * 完結する。バックエンド未デプロイのためサーバ書き込みはせず、書き出しはクリップボード。
 *
 * Hallmark NG（border帯のカード強調・emoji・汎用書体・紫ピンクgradient・gradient見出し）は
 * 持ち込まない。色は既存デザイントークン（var(--orange) 等）だけで当てる。
 *
 * 再描画は pattern-timeline.mjs の twoColTimeline / render-shared.mjs の dayHeader（コーチ分岐）と
 * 同一のCSSクラス・同一のDOM構造を移植して出す（スパイン3列・spine-band・tc2系・dayhead系）。
 */

import { BLOCK_TINT } from './render-shared.mjs';

/** 編集に出すブロック種別（BLOCK_TINT のブロックキー側）。 */
const BLOCK_KEYS = ['アップ', 'ファンダ', 'シュート', '対人', 'ラン', '静的', 'ゲーム'];

/** localStorage キー。{ "YYYY-MM-DD": override } の辞書を1キーに格納する。 */
const STORE_KEY = 'bcs-overrides-v1';

/** データアイランドの id（editorDataIsland と editorScript で共有）。 */
const ISLAND_ID = 'bcs-ed';

/* ───────────────────────── 1) 編集フォーム・ボタンのCSS ───────────────────────── */

/**
 * 編集フォーム・3ボタンのCSS。既存トークンのみ・新規クラスは ed-* に限定。
 * border帯（side-stripe）・gradient・絵文字・汎用書体は使わない。フォーム要素は
 * 角丸・1px hair罫線・surface背景の既存トーンに揃える。
 */
export const EDITOR_CSS = `
/* 編集パネル外殻: surface面 + line-2 で囲う（border帯ではなく全周罫線） */
.ed-panel{background:var(--surface);border:1px solid var(--line-2);border-radius:14px;padding:18px 20px;margin-bottom:14px}
.ed-panel[hidden]{display:none}
/* パネル見出し: H3段(17px) */
.ed-h{font-size:17px;font-weight:700;color:var(--orange-deep);letter-spacing:-.01em;margin-bottom:12px}
/* フィールド行 */
.ed-field{display:flex;flex-direction:column;gap:4px;margin-bottom:12px}
.ed-lab{font-size:12px;font-weight:700;color:var(--orange-deep);letter-spacing:.04em}
/* 入力部品: 角丸・1px hair・surface背景の既存トーン */
.ed-in,.ed-sel,.ed-time{appearance:none;font:inherit;font-size:14px;color:var(--ink);background:var(--surface);border:1px solid var(--hair);border-radius:10px;padding:9px 12px;width:100%;line-height:1.4}
.ed-in:focus,.ed-sel:focus,.ed-time:focus{outline:2px solid var(--orange);outline-offset:1px;border-color:var(--orange)}
.ed-time{width:auto;min-width:108px;font-variant-numeric:tabular-nums}
/* 時間行カード: bg面 + hair で囲う（全周罫線・帯にしない） */
.ed-row{background:var(--bg);border:1px solid var(--hair);border-radius:12px;padding:13px 15px;margin-bottom:12px}
.ed-row-top{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-bottom:10px}
.ed-times{display:inline-flex;align-items:center;gap:6px}
.ed-times .ed-sep{color:var(--mute);font-size:14px}
.ed-rownum{font-size:12px;font-weight:700;color:var(--orange-deep);letter-spacing:.04em}
.ed-check{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--ink);cursor:pointer;user-select:none}
.ed-check input{width:16px;height:16px;accent-color:var(--orange);cursor:pointer}
/* セル束（男女2列 or 共通1列） */
.ed-cells{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.ed-cells.ed-cells-both{grid-template-columns:1fr}
@media (max-width:580px){.ed-cells{grid-template-columns:1fr}}
.ed-cell{background:var(--surface);border:1px solid var(--hair);border-radius:10px;padding:11px 13px}
.ed-cell-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.ed-cell-team{font-size:12px;font-weight:700;letter-spacing:.04em;color:var(--mute);white-space:nowrap}
.ed-item{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:6px}
.ed-item .ed-name{flex:1 1 140px;min-width:0}
.ed-item .ed-note{flex:1 1 140px;min-width:0}
/* 小ボタン群（追加・削除）: btn と同じ surface+hair トーン（pill）。色帯にしない */
.ed-mini{appearance:none;cursor:pointer;font:inherit;font-size:12px;font-weight:600;background:var(--surface);color:var(--mute);border:1px solid var(--hair);border-radius:999px;padding:5px 11px;white-space:nowrap;transition:transform .14s ease,color .14s ease}
.ed-mini:hover{transform:translateY(-1px);color:var(--orange)}
.ed-mini:focus-visible{outline:2px solid var(--orange);outline-offset:2px}
.ed-del{color:var(--terra)}
.ed-del:hover{color:var(--orange-deep)}
.ed-cell-actions{margin-top:4px}
/* パネル操作（保存・キャンセル・行追加） */
.ed-actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:6px;padding-top:14px;border-top:1px solid var(--line)}
/* 確認の小テキスト（書き出しコピー後など） */
.ed-msg{font-size:12px;color:var(--orange-deep);font-weight:700;margin-left:4px;align-self:center}
.ed-msg:empty{display:none}
/* 書き出しフォールバック用 textarea（クリップボード不可時のみ表示） */
.ed-export-area{width:100%;min-height:160px;font:inherit;font-size:12px;line-height:1.5;color:var(--ink);background:var(--surface);border:1px solid var(--hair);border-radius:10px;padding:11px 13px;margin-top:10px;font-variant-numeric:tabular-nums;white-space:pre}
.ed-export-area[hidden]{display:none}
`;

/* ───────────────────────── 2) ツールバー3ボタン ───────────────────────── */

/**
 * 日ビューのツールバーに足す3ボタン（編集・自動に戻す・書き出し）。
 * data-print-hide で印刷時は非表示。クラスは既存 .btn を流用。
 * @returns {string} HTML
 */
export function editorToolbar() {
  return `<button class="btn" id="ed-edit" type="button" data-print-hide>この日を編集</button>` +
    `<button class="btn" id="ed-auto" type="button" data-print-hide>自動に戻す</button>` +
    `<button class="btn" id="ed-export" type="button" data-print-hide>入力を書き出し</button>` +
    `<span class="ed-msg" id="ed-msg" data-print-hide></span>`;
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
    }
    return row;
  });
  return { court: d.court || '', aim: d.aim || '', title: d.title || '', rows };
}

/**
 * 編集UIの初期データ（カタログ・色・ブロック・既存上書き日の prefill）を JSON で埋める。
 * data.days（または data.weeks[0].days）のうち source==='coach' && twoCol の日から prefill を作る。
 * @param {object} data buildPlanData の戻り値
 * @returns {string} <script type="application/json" id="bcs-ed">…</script>
 */
export function editorDataIsland(data) {
  const days = (data.days && data.days.length)
    ? data.days
    : (data.weeks && data.weeks[0] ? data.weeks[0].days : []);

  const prefill = {};
  for (const d of (days || [])) {
    if (d.source === 'coach' && d.twoCol && d.date) {
      prefill[d.date] = dayToPrefill(d);
    }
  }

  const island = {
    catalog: catalogNames(data.drillIndex),
    tints: tintsObject(),
    blocks: BLOCK_KEYS,
    prefill,
  };

  // application/json なので esc 不要。</script> 混入だけ無害化する。
  const json = JSON.stringify(island).replace(/<\/script/gi, '<\\/script');
  return `<script type="application/json" id="${ISLAND_ID}">${json}</script>`;
}

/* ───────────────────────── 4) クライアントJS（IIFE文字列） ───────────────────────── */

/**
 * 編集UIのクライアントJS（IIFE文字列）。build 側で <script> に差し込む。
 * - データアイランドを読み、localStorage の上書きを起動時に各 .day[data-date] へ適用
 * - 「この日を編集」でフォームを開き、保存で override を構築→保存→再描画
 * - 「自動に戻す」でスナップショット復元、「入力を書き出し」で overrides.json 配列形をコピー
 * 再描画は twoColTimeline / dayHeader(コーチ分岐) を同一クラス・同一構造で移植する。
 * @returns {string} IIFE
 */
export function editorScript() {
  return `(function(){
  var island=document.getElementById('${ISLAND_ID}');
  if(!island)return;
  var ED=JSON.parse(island.textContent||'{}');
  var CATALOG=ED.catalog||[];
  var TINTS=ED.tints||{};
  var BLOCKS=ED.blocks||[];
  var PREFILL=ED.prefill||{};
  var STORE='${STORE_KEY}';

  // ── 共通ユーティリティ ──
  function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  function tintOf(block){return TINTS[block]||'var(--mute)';}
  function loadStore(){
    var raw=localStorage.getItem(STORE);
    if(!raw)return {};
    try{var o=JSON.parse(raw);return (o&&typeof o==='object')?o:{};}catch(e){return {};}
  }
  function saveStore(obj){localStorage.setItem(STORE,JSON.stringify(obj));}
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
  function dayHeaderHtml(ov){
    var dateHead=dateLabelISO(ov.date,ov.weekday);
    return '<div class="dayhead">'+
      '<div class="dh-t">'+esc(dateHead)+
        '<span class="dh-court">'+esc(ov.court)+'</span>'+
      '</div>'+
      '<div class="dh-aim"><span class="dh-aiml">この日のねらい</span>'+esc(ov.aim)+'</div>'+
    '</div>';
  }
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
  function rowHtml(row){
    if(row.both){
      var tintB=tintOf(row.both.block);
      var bandInner='<span class="tll tll-lg" style="--t:'+tintB+'">'+esc(row.both.label)+'</span>'+
        (row.both.items||[]).map(function(it){
          return '<span class="tc2-bn">'+esc(it.name)+(it.note?'（'+esc(it.note)+'）':'')+'</span>';
        }).join('');
      return '<div class="spine-row spine-together tc2-together" style="--t:'+tintB+'">'+
        '<div class="spine-band left">'+bandInner+'</div>'+
        '<div class="spine-clk"><span class="tk">'+esc(row.from)+'</span>'+
          '<span class="spine-dot" style="background:var(--t)"></span></div>'+
        '<div class="spine-band right">'+bandInner+'</div>'+
      '</div>';
    }
    return '<div class="spine-row spine-rotation tc2-split">'+
      '<div class="spine-side spine-self tc2-cell">'+cellInnerHtml(row['男子'])+'</div>'+
      '<div class="spine-clk"><span class="tk">'+esc(row.from)+'</span>'+
        '<span class="spine-dot" style="background:var(--orange)"></span></div>'+
      '<div class="spine-side spine-self tc2-cell">'+cellInnerHtml(row['女子'])+'</div>'+
    '</div>';
  }
  function timelineHtml(ov){
    var rows=ov.rows||[];
    var genderHeader='<div class="spine-header">'+
      '<div class="spine-col-label">'+genderChipHtml('男子')+'</div>'+
      '<div class="spine-clock-header"></div>'+
      '<div class="spine-col-label">'+genderChipHtml('女子')+'</div>'+
    '</div>';
    var rowsHtml=rows.map(rowHtml).join('');
    var endTo=rows.length?(rows[rows.length-1].to||''):'';
    var endRow='<div class="spine-row spine-together spine-end">'+
      '<div class="spine-band left spine-band-end"><span class="tbl">終了</span><span class="tbm">今日の振り返りひとことで解散。</span></div>'+
      '<div class="spine-clk"><span class="tk">'+esc(endTo)+'</span>'+
        '<span class="spine-dot" style="background:var(--mute)"></span></div>'+
      '<div class="spine-band right spine-band-end"><span class="tbl">終了</span><span class="tbm">今日の振り返りひとことで解散。</span></div>'+
    '</div>';
    return genderHeader+'<div class="spine">'+rowsHtml+endRow+'</div>';
  }
  // article 本体の中身（dayHeader + timeline）を ov から作る。plain プレーンは保持しない。
  function renderDay(article,ov){
    article.innerHTML=dayHeaderHtml(ov)+timelineHtml(ov);
  }

  // ── 起動時スナップショット（自動に戻す用）と localStorage 適用 ──
  var SNAP={}; // date -> 元 innerHTML
  function eachDay(fn){document.querySelectorAll('.day[data-date]').forEach(fn);}
  function bootstrap(){
    eachDay(function(a){SNAP[a.getAttribute('data-date')]=a.innerHTML;});
    var store=loadStore();
    eachDay(function(a){
      var date=a.getAttribute('data-date');
      if(store[date])renderDay(a,store[date]);
    });
  }

  // ── 編集対象の初期値解決: localStorage > prefill > 空テンプレ ──
  function blankCell(){return {block:BLOCKS[0]||'',label:'',items:[]};}
  function blankRow(){return {from:'',to:'',both:null,'男子':blankCell(),'女子':blankCell()};}
  function deepClone(o){return JSON.parse(JSON.stringify(o));}
  function initModel(date,weekday){
    var store=loadStore();
    if(store[date])return normalizeModel(deepClone(store[date]),date,weekday);
    if(PREFILL[date])return normalizeModel(deepClone(PREFILL[date]),date,weekday);
    return {date:date,weekday:weekday,court:'',aim:'',title:'',rows:[blankRow()]};
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
    return {date:date,weekday:weekday,court:src.court||'',aim:src.aim||'',title:src.title||'',rows:rows};
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
  function catalogDatalist(){
    return '<datalist id="ed-catalog">'+CATALOG.map(function(n){return '<option value="'+esc(n)+'"></option>';}).join('')+'</datalist>';
  }
  function itemHtml(ri,side,ii,it){
    return '<div class="ed-item" data-ri="'+ri+'" data-side="'+esc(side)+'" data-ii="'+ii+'">'+
      '<input class="ed-in ed-name" list="ed-catalog" placeholder="ドリル名（選択 or 自由入力）" value="'+esc(it.name)+'" data-k="name">'+
      '<input class="ed-in ed-note" placeholder="メモ（任意）" value="'+esc(it.note)+'" data-k="note">'+
      '<button type="button" class="ed-mini ed-del" data-act="del-item">項目を削除</button>'+
    '</div>';
  }
  function cellHtml(ri,side,teamLabel,cell){
    var items=(cell.items||[]).map(function(it,ii){return itemHtml(ri,side,ii,it);}).join('');
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
    var cells;
    if(isBoth){
      cells='<div class="ed-cells ed-cells-both">'+cellHtml(ri,'both','男女共通',row.both)+'</div>';
    }else{
      cells='<div class="ed-cells">'+cellHtml(ri,'男子','男子',row['男子'])+cellHtml(ri,'女子','女子',row['女子'])+'</div>';
    }
    return '<div class="ed-row" data-ri="'+ri+'">'+
      '<div class="ed-row-top">'+
        '<span class="ed-rownum">時間'+(ri+1)+'</span>'+
        '<span class="ed-times">'+
          '<input type="time" class="ed-time" data-k="from" value="'+esc(row.from)+'">'+
          '<span class="ed-sep">〜</span>'+
          '<input type="time" class="ed-time" data-k="to" value="'+esc(row.to)+'">'+
        '</span>'+
        '<label class="ed-check"><input type="checkbox" data-act="toggle-both"'+(isBoth?' checked':'')+'>男女共通</label>'+
        '<button type="button" class="ed-mini ed-del" data-act="del-row" style="margin-left:auto">この時間を削除</button>'+
      '</div>'+
      cells+
    '</div>';
  }
  function panelHtml(){
    var rows=model.rows.map(function(r,ri){return rowHtmlForm(r,ri);}).join('');
    return '<div class="ed-h">この日を編集（'+esc(dateLabelISO(model.date,model.weekday))+'）</div>'+
      catalogDatalist()+
      '<div class="ed-field"><span class="ed-lab">この日のねらい</span>'+
        '<input class="ed-in" id="ed-aim" placeholder="この日のねらい" value="'+esc(model.aim)+'"></div>'+
      '<div class="ed-field"><span class="ed-lab">コート</span>'+
        '<input class="ed-in" id="ed-court" placeholder="例：半面 / 全面 / 屋外" value="'+esc(model.court)+'"></div>'+
      '<div class="ed-rows">'+rows+'</div>'+
      '<div class="ed-cell-actions"><button type="button" class="ed-mini" data-act="add-row">＋ 時間を追加</button></div>'+
      '<div class="ed-actions">'+
        '<button type="button" class="btn btn-primary" data-act="save">保存</button>'+
        '<button type="button" class="btn" data-act="cancel">キャンセル</button>'+
      '</div>';
  }
  function renderPanel(){panel.innerHTML=panelHtml();}

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

  // ── フォーム操作（委譲）──
  function onPanelClick(e){
    var btn=e.target.closest('[data-act]');if(!btn)return;
    var act=btn.getAttribute('data-act');
    if(act==='save'){doSave();return;}
    if(act==='cancel'){closePanel();return;}
    collectInputs(); // 構造変更の前に現在値を取り込む
    if(act==='add-row'){model.rows.push(blankRow());renderPanel();return;}
    var rowEl=btn.closest('.ed-row');
    var ri=rowEl?Number(rowEl.getAttribute('data-ri')):-1;
    if(act==='del-row'){if(ri>=0)model.rows.splice(ri,1);if(model.rows.length===0)model.rows.push(blankRow());renderPanel();return;}
    if(act==='add-item'){
      var cellEl=btn.closest('.ed-cell');var side=cellEl.getAttribute('data-side');
      var cell=cellOf(model.rows[ri],side);if(cell)cell.items.push({name:'',note:''});renderPanel();return;
    }
    if(act==='del-item'){
      var itEl=btn.closest('.ed-item');var sideD=itEl.getAttribute('data-side');var ii=Number(itEl.getAttribute('data-ii'));
      var cellD=cellOf(model.rows[ri],sideD);if(cellD)cellD.items.splice(ii,1);renderPanel();return;
    }
  }
  function onPanelChange(e){
    var box=e.target.closest('[data-act="toggle-both"]');if(!box)return;
    collectInputs();
    var rowEl=box.closest('.ed-row');var ri=Number(rowEl.getAttribute('data-ri'));
    var row=model.rows[ri];if(!row)return;
    if(box.checked){
      // 共通ON: both を1セルに（既存の男子セルを土台に）
      row.both=row.both||deepClone(row['男子'])||blankCell();
    }else{
      row.both=null;
      if(!row['男子'])row['男子']=blankCell();
      if(!row['女子'])row['女子']=blankCell();
    }
    renderPanel();
  }

  // ── 保存: model→override（保存スキーマ）。空名item・空行は捨てる。minutes は from/to 算出 ──
  function cleanCell(cell){
    if(!cell)return null;
    var items=(cell.items||[]).filter(function(it){return it.name&&it.name.trim();})
      .map(function(it){var o={name:it.name.trim()};if(it.note&&it.note.trim())o.note=it.note.trim();return o;});
    if(items.length===0)return null;
    return {block:cell.block||'',label:(cell.label||'').trim()||cell.block||'',items:items};
  }
  function buildOverride(){
    var rows=[];
    model.rows.forEach(function(r){
      var from=r.from||'';var to=r.to||'';
      var fm=toMin(from),tm=toMin(to);
      var minutes=(fm!=null&&tm!=null)?(tm-fm):null;
      var out={from:from,to:to,minutes:minutes};
      if(r.both){
        var both=cleanCell(r.both);
        if(!both)return; // 共通セルが空なら行ごと捨てる
        out.both=both;
      }else{
        var boys=cleanCell(r['男子']);var girls=cleanCell(r['女子']);
        if(!boys&&!girls)return; // 男女とも空なら行を捨てる
        if(boys)out['男子']=boys;
        if(girls)out['女子']=girls;
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
    var title=(model.title||'').trim();
    if(title)ov.title=title;
    return ov;
  }
  function doSave(){
    collectInputs();
    var ov=buildOverride();
    var store=loadStore();
    store[ov.date]=ov;
    saveStore(store);
    renderDay(editingArticle,ov); // その日を再描画
    closePanel();
    flash('保存しました（ブラウザに記憶）');
  }

  // ── パネル開閉（記事本体をフォームに差し替え・キャンセルで復帰）──
  function openPanel(){
    var article=curDay();
    if(!article){flash('編集できる日が表示されていません');return;}
    if(!article.getAttribute('data-date')){flash('この日は上書き編集の対象外です');return;}
    editingArticle=article;
    var date=article.getAttribute('data-date');
    var weekday=article.getAttribute('data-day')||'';
    model=initModel(date,weekday);
    panel=document.createElement('section');
    panel.className='ed-panel';
    panel.setAttribute('data-print-hide','');
    article.parentNode.insertBefore(panel,article.nextSibling);
    article.hidden=true; // 記事本体を隠してフォームを見せる
    renderPanel();
    panel.addEventListener('click',onPanelClick);
    panel.addEventListener('change',onPanelChange);
    panel.scrollIntoView({behavior:'smooth',block:'start'});
  }
  function closePanel(){
    if(panel&&panel.parentNode)panel.parentNode.removeChild(panel);
    if(editingArticle)editingArticle.hidden=false;
    panel=null;model=null;editingArticle=null;
  }

  // ── 自動に戻す: 今表示中の日の localStorage 上書きを削除→スナップショット復元 ──
  function revertAuto(){
    var article=curDay();
    if(!article){flash('対象の日が表示されていません');return;}
    var date=article.getAttribute('data-date');
    var store=loadStore();
    if(store[date]){delete store[date];saveStore(store);}
    if(SNAP[date]!=null)article.innerHTML=SNAP[date];
    flash('自動の内容に戻しました');
  }

  // ── 書き出し: localStorage の全上書きを overrides.json 配列形でコピー ──
  function exportJson(){
    var store=loadStore();
    var arr=Object.keys(store).sort().map(function(k){return store[k];});
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
    var msg=document.getElementById('ed-msg');
    var host=msg&&msg.parentNode?msg.parentNode:document.body;
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

  // ── ボタン結線 ──
  var editBtn=document.getElementById('ed-edit');if(editBtn)editBtn.addEventListener('click',openPanel);
  var autoBtn=document.getElementById('ed-auto');if(autoBtn)autoBtn.addEventListener('click',revertAuto);
  var exportBtn=document.getElementById('ed-export');if(exportBtn)exportBtn.addEventListener('click',exportJson);

  bootstrap();
  window.__bcsEditor={loadStore:loadStore,saveStore:saveStore,renderDay:renderDay,exportJson:exportJson,openPanel:openPanel,model:function(){return model;}};
})();`;
}
