/**
 * @file 全パターン共通の描画基盤（トンマナ固定・Hallmark準拠）。
 *
 * 練習メニューは男女共通（1本）。組違い＝そのメニューのコーチ付き段だけを男女でずらし、
 * コーチ1人が前半・後半で男女を入れ替えて見る（同時刻にコーチ付きは必ず片方）。各パターンは
 * 「日」の見せ方で差別化し、組違いパネル・目標・年/月は共通部品を使う。
 *
 * Hallmark NG（border帯のカード強調・emoji・汎用書体 Inter/Roboto・紫ピンクgradient・
 * gradient見出し・全幅centered hero・定型AIナビ）は基盤から排除している。
 */

/** ST-labo デザイントークン（warmブランド: クリーム地＋オレンジ）。
 * T5: --shadow/--shadow-soft/--inset を削除し、border+面の濃淡2値で区切りを表現する。
 * 残すのは: 強い区切り=--line-2（セクション外周）、弱い区切り=--hair（カード・行間）。
 */
export const TOKENS = `
  --bg:#fbf5ec; --surface:#fffaf2; --ink:#2a201a; --mute:#7a6a5c;
  --orange:#ef7a32; --orange-ink:#fffaf2; --orange-soft:#ffd7b9; --orange-deep:#c4521b;
  --terra:#b8623b; --gold:#cf9a3e; --sage:#7c8a5a;
  --boys:#ef7a32; --girls:#b8623b;
  --line:rgba(168,110,64,.13); --line-2:rgba(168,110,64,.22); --hair:rgba(42,32,26,.09);
  --scrim:rgba(42,32,26,.32);
  --sat:#3f7da3; --sun:#b5524b; --sat-soft:rgba(63,125,163,.10); --sun-soft:rgba(181,82,75,.10);
`;

/** 共通ベースCSS。T5: shadow廃止→border+面の濃淡2値で区切りを表現。
 * T6 タイポ5段（27/22/17/14/12・約1.25比率）: H1=27 / H2=22 / H3=17 / 本文=14 / 補助=12。
 * 見出しは必ず本文(14px)よりサイズ上位に置く（10px見出しラベル禁止）。
 * 枠線は「押せるもの（ボタン・タブ）」と「カード面」のみ。静的メタ情報はピル化しない。 */
export const BASE_CSS = `
:root{${TOKENS}}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:var(--bg);color:var(--ink)}
body{font-family:"Hiragino Sans",system-ui,sans-serif;line-height:1.7;-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums}
.wrap{max-width:840px;margin:0 auto;padding:32px 18px 80px}
a{color:var(--orange-deep)}

/* レベル切替＆配布ツールバー */
.toolbar{display:flex;gap:9px;flex-wrap:wrap;align-items:center;margin:14px 0 18px}
/* T5: btn は surface+hair（shadow廃止）・14px（本文段） */
.btn{appearance:none;border:1px solid var(--hair);cursor:pointer;background:var(--surface);color:var(--ink);border-radius:999px;padding:10px 18px;font:inherit;font-size:14px;letter-spacing:.02em;white-space:nowrap;transition:transform .16s ease,color .16s ease}
.btn:hover{transform:translateY(-2px);color:var(--orange)}
.btn:focus-visible{outline:2px solid var(--orange);outline-offset:3px}
.btn-primary{background:var(--orange);color:var(--orange-ink);border-color:var(--orange)}
.btn-primary:hover{color:var(--orange-ink)}
.levels{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;max-width:320px;margin-bottom:16px}
/* T5: lvtab は surface+hair・17px（H2段）。選択中は orange塗り（罫線不要）。タブは4等分の等幅。 */
.lvtab{appearance:none;border:1px solid var(--hair);cursor:pointer;background:var(--surface);color:var(--mute);border-radius:14px;padding:8px 0;font:inherit;font-size:17px;font-weight:600;text-align:center;transition:transform .16s ease}
.lvtab:hover{transform:translateY(-2px)}
.lvtab.on{background:var(--orange);color:var(--orange-ink);border-color:var(--orange)}
.lvtab:focus-visible{outline:2px solid var(--orange);outline-offset:3px}
.daytabs{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:18px}
/* T5: daytab は surface+hair・15px（H3段相当） */
.daytab{appearance:none;border:1px solid var(--hair);cursor:pointer;background:var(--surface);color:var(--mute);border-radius:999px;padding:8px 14px;font:inherit;font-size:14px;font-weight:600;display:flex;flex-direction:column;align-items:center;gap:1px;min-width:52px;transition:transform .16s ease}
/* T6: small は 12px（補助段） */
.daytab small{font-weight:400;font-size:12px;opacity:.82}
.daytab:hover{transform:translateY(-2px)}
.daytab.on{background:var(--orange);color:var(--orange-ink);border-color:var(--orange)}

/* T5: modetoggle は bg+hair（inset廃止） */
.modetoggle{display:inline-flex;gap:6px;background:var(--bg);border:1px solid var(--hair);border-radius:999px;padding:4px}
.modetoggle .mt{appearance:none;border:none;cursor:pointer;background:transparent;color:var(--mute);border-radius:999px;padding:7px 15px;font:inherit;font-size:14px;font-weight:600;white-space:nowrap;transition:color .16s ease}
/* T5: mt.on は surface+hair */
.modetoggle .mt.on{background:var(--surface);color:var(--orange-deep);border:1px solid var(--hair)}
.modetoggle .mt:focus-visible{outline:2px solid var(--orange);outline-offset:2px}

/* 男女チップ */
.gchip{display:inline-flex;align-items:center;gap:6px;font-weight:700}
.gchip::before{content:"";width:12px;height:12px;border-radius:4px;flex:0 0 auto}
.gchip.boys::before{background:var(--boys)}
.gchip.girls::before{background:var(--girls)}

/* T6: 日ヘッダ は surface+line-2。dh-t は 22px（H2段） */
.dayhead{background:var(--surface);border-radius:14px;border:1px solid var(--line-2);padding:16px 20px;margin-bottom:14px}
.dayhead .dh-t{font-size:22px;font-weight:700;letter-spacing:-.01em}
/* T6: dh-court は素テキスト12px（静的メタはピル化しない） */
.dayhead .dh-court{font-size:12px;color:var(--mute);font-weight:600;margin-left:10px;vertical-align:middle}
/* T6: dh-aim は 14px（本文段）・面の濃淡のみ */
.dayhead .dh-aim{margin-top:11px;font-size:14px;font-weight:600;line-height:1.5;background:var(--bg);border-radius:10px;padding:11px 15px}
/* T6: dh-aiml は 17px/700（H3段・見出しは本文より大きく） */
.dayhead .dh-aiml{display:block;font-size:17px;color:var(--orange-deep);font-weight:700;margin-bottom:4px}
/* 印刷専用の右側目標（月/週）。画面では非表示（画面は day レベルの目標バーで見せる） */
.dayhead .dh-goals{display:none}
.inote{font-size:14px;line-height:1.6}
.inote b{color:var(--orange-deep);font-weight:700}

/* 区画（2部構成の日＝火）の部ヘッダ。日ヘッダの下に各部の見出しとして並べる。 */
.parthead{display:flex;align-items:baseline;flex-wrap:wrap;gap:10px;margin:18px 0 10px;padding-bottom:8px;border-bottom:1px solid var(--line-2)}
/* T6: ph-no は 12px/700（補助段・アイブロウ） */
.parthead .ph-no{font-size:12px;font-weight:700;color:var(--orange-ink);background:var(--orange);border-radius:999px;padding:2px 10px;letter-spacing:.04em}
/* T6: ph-label は 17px/700（H3段・部見出し） */
.parthead .ph-label{font-size:17px;font-weight:700;letter-spacing:-.01em}
/* T6: ph-meta は 12px（補助段） */
.parthead .ph-meta{font-size:12px;color:var(--mute);font-variant-numeric:tabular-nums}

/* 2列グリッド（board/handout用・timeline は中央スパイン版を使用） */
.twocol{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:14px}
.twocol-header{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:6px}
.tcrow{display:contents}
/* T5: tccell は border（shadow廃止） */
.tccell{background:var(--bg);border-radius:10px;border:1px solid var(--hair);padding:9px 12px;font-size:14px}
.tccell.tc-coach{background:var(--surface);border:1px solid var(--line-2)}
.tccell.tc-self{background:var(--bg);border:1px solid var(--hair)}
.tc-shared{grid-column:1/-1;background:var(--bg);border-radius:10px;border:1px solid var(--hair);padding:8px 13px;font-size:14px;color:var(--mute)}
/* T6: tc-from は 12px/700（補助段） */
.tc-from{font-size:12px;color:var(--orange-deep);font-weight:700;margin-bottom:3px}
.tc-name{font-size:14px;font-weight:700;line-height:1.4}
/* T6: tc-half は 12px（補助段） */
.tc-half{font-size:12px;letter-spacing:.04em;color:var(--mute);margin-bottom:3px}
.tc-comp{display:block;font-size:12px;color:var(--mute);margin-top:3px;line-height:1.5}
@media (max-width:580px){
  .twocol,.twocol-header{grid-template-columns:1fr}
  .tc-shared{grid-column:1}
}
@media print{
  .twocol,.twocol-header{grid-template-columns:1fr 1fr}
  .tc-shared{grid-column:1/-1}
}

/* 目標（共通の今月/今週/定性 ＋ 男女別KPI） */
/* T5: goals は surface+hair（shadow廃止） */
.goals{background:var(--surface);border-radius:14px;border:1px solid var(--hair);padding:18px 20px}
/* T6: goals h3 は 22px/700（H2段・セクション見出し） */
.goals h3{font-size:22px;margin-bottom:12px;color:var(--orange-deep);letter-spacing:-.01em;font-weight:700}
.gline{display:flex;gap:13px;align-items:baseline;padding:8px 0;border-bottom:1px solid var(--line)}
.gline:last-child{border-bottom:none}
/* T6: .lab は 17px/700（H3段・行見出しは本文より大きく） */
.gline .lab{flex:0 0 64px;font-size:17px;color:var(--orange-deep);font-weight:700}
/* T5: .txt は 14px（本文段） */
.gline .txt{font-size:14px;line-height:1.55}
.kgrid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}
/* T5: kteam は bg+hair（inset廃止） */
.kteam{background:var(--bg);border-radius:10px;border:1px solid var(--hair);padding:13px 15px}
/* T5: kth は 17px（H2段） */
.kteam .kth{font-size:17px;font-weight:700;margin-bottom:9px}
.kpis{display:grid;grid-template-columns:1fr;gap:8px}
/* T5: kpi.name は 12px（補助段） */
.kpi .name{font-size:12px;color:var(--mute);margin-bottom:5px}
/* T6: kpi.val は 17px/700（データ強調） */
.kpi .val{font-size:17px;font-weight:700}
.kpi .val .arrow{color:var(--mute);font-weight:400;font-size:12px;margin:0 4px}
.kpi .val .tgt{color:var(--orange-deep)}
.kpi .bar{height:6px;border-radius:999px;background:var(--orange-soft);margin-top:6px;overflow:hidden}
.kpi .bar>span{display:block;height:100%;border-radius:999px;background:var(--orange)}

/* §3.3: タグは文字ラベルのみ（ピル廃止・自走は空文字で非表示）。12px/700（補助段） */
.tag{flex:0 0 auto;font-size:12px;font-weight:700;white-space:nowrap;letter-spacing:.04em}
.tag-coach{color:var(--orange-deep)}
.tag-lec{color:var(--terra)}
/* §3.3: mode-mark は dot + テキストの横並び。dot は 6px 丸●（コーチ付き=orange） */
.mode-mark{display:inline-flex;align-items:center;gap:3px;flex:0 0 auto}
.mode-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
.coach-dot{background:var(--orange)}
.alt{color:var(--mute);font-size:12px;margin-top:3px}
.alt b{color:var(--orange-deep);font-weight:700;font-style:normal}
/* drill-trig: ドリル名タップ要素（ハッシュ駆動詳細を開く）。インライン・border なし */
.drill-trig{background:none;border:none;padding:0;cursor:pointer;font:inherit;color:var(--ink);text-decoration:none;text-align:left}
.drill-trig:hover{color:var(--orange-deep);text-decoration:underline}
/* T5: vid は bg+hair（inset廃止）・12px */
.vid{display:inline-flex;align-items:center;gap:3px;color:var(--orange-deep);text-decoration:none;font-size:12px;background:var(--bg);padding:2px 9px;border-radius:999px;border:1px solid var(--hair)}
.vid:hover{text-decoration:underline}

/* 年の流れ（男子行・女子行の2段） */
.arcrows{display:flex;flex-direction:column;gap:10px}
.arcrow-label{font-size:12px;font-weight:700;margin-bottom:-4px}
.arcwrap{display:flex;gap:5px;align-items:stretch;flex-wrap:nowrap;overflow-x:auto}
/* T5: arccell は surface+hair（shadow廃止）・10px */
.arccell{flex:1 1 0;min-width:58px;background:var(--surface);border-radius:10px;border:1px solid var(--hair);padding:9px;display:flex;flex-direction:column;gap:4px}
.arccell.peak2{background:var(--orange-soft);border-color:var(--orange-soft)}
/* T5: peak1 は bg+hair（inset廃止） */
.arccell.peak1{background:var(--bg);border:1px solid var(--hair)}
.arccell.arccell-now{outline:2px solid var(--orange);outline-offset:1px}
/* T5: arccell .am は 12px（補助段） */
.arccell .am{font-size:12px;font-weight:700}
/* T6: arccell .ap は 12px（補助段） */
.arccell .ap{font-size:12px;color:var(--mute);line-height:1.4;min-height:34px}
.peakchip{font-size:12px;background:var(--orange-deep);color:var(--orange-ink);border-radius:999px;padding:2px 8px;font-weight:700;align-self:flex-start}
.nowchip{font-size:12px;border-radius:999px;padding:2px 8px;font-weight:700;white-space:nowrap}
.nowchip.boys{background:var(--boys);color:var(--orange-ink)}
.nowchip.girls{background:var(--girls);color:var(--orange-ink)}
.arclegend{display:flex;flex-wrap:wrap;gap:14px;margin-top:12px;font-size:12px;color:var(--mute)}
.arclegend .lk{display:inline-flex;align-items:center;gap:6px}
.arclegend .sw{width:14px;height:14px;border-radius:4px;display:inline-block}
@media (max-width:680px){.arcwrap{flex-wrap:wrap}.arccell{flex-basis:30%;min-width:58px}}

/* 月（原典フェーズ＋主眼＋KPI・共通） */
/* T5: monthcard は surface+hair（shadow廃止） */
.monthcard{background:var(--surface);border-radius:14px;border:1px solid var(--hair);padding:18px 20px}
.monthcard .mc-h{display:flex;align-items:center;gap:10px;margin-bottom:10px;padding-bottom:9px;border-bottom:1px solid var(--line)}
/* T6: mc-phase は素テキスト12px/700（静的メタはピル化しない） */
.monthcard .mc-phase{font-size:12px;color:var(--orange-deep);font-weight:700;letter-spacing:.04em}
/* T6: mc-mon は 17px/700（H3段） */
.monthcard .mc-mon{font-size:17px;font-weight:700}
/* T5: mc-aim は 14px（本文段） */
.monthcard .mc-aim{font-size:14px;line-height:1.6}
.monthcard .mc-peak{font-size:12px;color:var(--orange-deep);font-weight:700;margin-top:10px}
.monthcard .mc-kpi{margin-top:11px}
/* T6: .kk は 17px/700（H3段・見出しは本文より大きく） */
.monthcard .mc-kpi .kk{font-size:17px;color:var(--orange-deep);font-weight:700;margin-bottom:5px}
/* T5: .kv は 12px（補助段） */
.monthcard .mc-kpi .kv{font-size:12px;color:var(--mute);line-height:1.6}

/* T6: lvh は 22px/700（H2段） */
.lvh{font-size:22px;color:var(--orange-deep);font-weight:700;letter-spacing:-.01em;margin:6px 2px 14px}
/* T5: note は surface+hair（shadow廃止）・12px */
.note{font-size:12px;color:var(--mute);background:var(--surface);border:1px solid var(--hair);border-radius:10px;padding:11px 15px;margin:14px 0;line-height:1.6}
.assume{font-size:12px;color:var(--mute);line-height:1.7;margin-top:6px}
.assume li{margin-left:18px}
/* フッター: タイトルを小さく置くだけ（主役は計画本体） */
.foot{margin-top:26px;color:var(--mute);font-size:11px;text-align:center;letter-spacing:.04em}
/* 月/週の目標バー（この日の狙いの上・横2分割） */
.goalbar{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px}
.gb-cell{background:var(--surface);border:1px solid var(--line-2);border-radius:12px;padding:11px 14px}
.gb-lab{display:block;font-size:12px;font-weight:700;color:var(--orange-deep);letter-spacing:.04em;margin-bottom:3px}
.gb-val{font-size:14px;font-weight:600;line-height:1.5}
.gpr b{color:var(--orange-deep);font-weight:700;margin-right:5px}
@media (max-width:580px){.goalbar{grid-template-columns:1fr}}

@media (max-width:680px){
  .kgrid{grid-template-columns:1fr}
  .arccell{flex-basis:30%}
}
/* T5: print規則 — 画面と印刷が同一構造（罫線ベース）。いま選んでいるタブ（日/週/月/年）と
 * その中で表示中の日だけを印刷する（hidden は印刷でも非表示のまま）。操作系は非表示・背景は #fff に。 */
@media print{
  @page{margin:8mm}
  body{background:#fff}
  .toolbar,.levels,.daytabs,.modetoggle{display:none}
  [data-print-hide]{display:none!important}
  .interact[hidden]{display:none!important}
  /* 1日=1ページに収めるため印刷時のみ全体を微縮小。画面用の目標バーは隠し、目標は日ヘッダ右に横並びで出す */
  .wrap{max-width:none;padding:0;zoom:.92}
  .goalbar{display:none}
  /* 印刷時: 日ヘッダを「左=日付＋この日の狙い／右=月週の目標」の横2分割にして縦の行を稼ぐ。日付↔狙いの間も詰める */
  .dayhead{display:flex;align-items:flex-start;gap:16px;padding:10px 14px;margin-bottom:8px}
  .dayhead .dh-main{flex:1 1 auto;min-width:0}
  .dayhead .dh-aim{margin-top:5px;padding:7px 11px}
  .dayhead .dh-goals{display:flex;flex-direction:column;gap:14px;flex:0 0 34%;max-width:34%}
  .dayhead .dh-goals .dhg-item{font-size:10px;line-height:1.35;color:var(--ink)}
  .dayhead .dh-goals .dhg-item b{color:var(--orange-deep);font-weight:700;margin-right:4px}
  .drill-overlay{display:none!important}
}
`;

/**
 * ブロック種別の色（warm系で統一・虹色にしない）。固定6ブロック骨格に対応。
 * キーはブロックキー（plan-data の block）と表示ラベル（together行の row.label）の両方を含める。
 */
export const BLOCK_TINT = {
  // block キー
  アップ: 'var(--sage)',
  ファンダ: 'var(--orange)',
  シュート: 'var(--gold)',
  対人: 'var(--terra)',
  ラン: 'var(--sage)',
  静的: 'var(--mute)',
  ゲーム: 'var(--orange)',
  // 表示ラベル（together行 row.label 経由の参照用）
  ファンダメンタル: 'var(--orange)',
  走り込み: 'var(--sage)',
  静的ストレッチ: 'var(--mute)',
};

/** HTMLエスケープ。 */
export const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 再生アイコン（SVG・emoji不使用）。 */
export const VIDEO_SVG =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M10 9l5 3-5 3z"/></svg>';

/**
 * §3.3: モードマーク（dot + 文字ラベル）。自走は空文字（多数派の自走全行にマークを置くと
 * コーチ付きの希少性が消えるため、コーチ付き・レクチャのみ表示）。
 * dot: 6pxの行頭●（コーチ付き=--orange）。自走は dot も非表示。
 */
export const modeMark = (mode) => {
  if (mode === 'practice') return `<span class="mode-mark"><span class="mode-dot coach-dot"></span><span class="tag tag-coach">コーチ</span></span>`;
  if (mode === 'lecture')  return `<span class="mode-mark"><span class="tag tag-lec">レクチャ</span></span>`;
  return ''; // 自走はマーク非表示
};

/** T4互換エイリアス（既存呼び出し側が modeTag を参照しているため残す）。 */
export const modeTag = modeMark;

/** 動画リンク（あれば）。 */
export const videoLink = (url) =>
  url ? ` <a class="vid" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${VIDEO_SVG}<span>動画</span></a>` : '';

/**
 * 「いずれか」候補行。registry があれば候補名を data-drill タップ要素にする（ハッシュ駆動詳細）。
 * @param {string[]} alts 候補名配列
 * @param {Map} [registry] 名前→詳細（省略可）
 */
export const altLine = (alts, registry) => {
  if (!alts || !alts.length) return '';
  const items = alts.map((name) => {
    const detail = registry && registry.get(name);
    if (detail) return `<button type="button" class="drill-trig" data-drill="${esc(detail.id)}">${esc(name)}</button>`;
    return esc(name);
  }).join(' ／ ');
  return `<div class="alt"><b>いずれか</b>　${items}</div>`;
};

/** 男女チップ。 */
export const genderChip = (gender) =>
  `<span class="gchip ${gender === '男子' ? 'boys' : 'girls'}">${esc(gender)}</span>`;

/** 組違いON/OFFトグル。 */
export function modeToggle() {
  return `<div class="modetoggle" data-print-hide role="group" aria-label="組違いの切り替え">
    <button class="mt on" type="button" data-mode-go="on">組違いON（体育館共有）</button>
    <button class="mt" type="button" data-mode-go="off">組違いOFF（別時間）</button>
  </div>`;
}

/** 日ヘッダ（曜日・コート・時間・本日の狙い）。印刷時は右側に月/週の目標を横並びにして行を稼ぐ。 */
export function dayHeader(pd, month, goals) {
  // 見出しの日付表記: 実日付があれば「6/23（火）」、無ければ従来の「N月 火曜」。
  const dateHead = pd.dateLabel ? `${esc(pd.dateLabel)}（${esc(pd.day)}）` : `${month}月 ${esc(pd.dayLabel)}`;
  // 印刷専用: 月/週の目標（画面では day レベルの目標バーで見せ、ここは display:none）。
  const goalsPr = goals
    ? `<div class="dh-goals" aria-hidden="true"><span class="dhg-item"><b>月</b>${esc(goals.monthMain || '—')}</span><span class="dhg-item"><b>週</b>${esc(goals.week || '—')}</span></div>`
    : '';
  // コーチ指定の上書き日: 対象性別チップと手書きの狙いだけ出す。
  // 「コーチ指定」等の内部ラベルは配布物に出さない（コーチが見て無意味なため）。
  // 男女2列日（twoCol）は男女両方が対象なので男子・女子チップを並べ、単一性別表記はしない。
  if (pd.source === 'coach') {
    // twoCol 日は男女2列が下に並ぶのでヘッダの男女チップは常に両方＝選択肢ゼロ（出さない）。単一性別日だけ対象を出す。
    const teamChip = pd.twoCol ? '' : (pd.team ? ` ${genderChip(pd.team)}` : '');
    const aimScope = pd.twoCol ? '' : (pd.team ? `（${esc(pd.team)}）` : '');
    return `<div class="dayhead">
      <div class="dh-main">
        <div class="dh-t">${dateHead}${teamChip}
          <span class="dh-court">${esc(pd.court)}</span>
        </div>
        <div class="dh-aim"><span class="dh-aiml">この日のねらい${aimScope}</span>${esc(pd.aim)}</div>
      </div>
      ${goalsPr}
    </div>`;
  }
  // 2部構成の日（火）は日全体の時間帯と「2部構成」である旨を示す（各部の詳細は部ヘッダで）。
  const partsNote = Array.isArray(pd.parts) && pd.parts.length > 1
    ? `・${pd.parts.length}部構成（${pd.parts.map((p) => `${esc(p.label)}${p.totalMinutes}分`).join(' ＋ ')}）`
    : `・${esc(pd.court)}`;
  const meta = `${partsNote}・${esc(pd.start)}〜${esc(pd.end)}・計${pd.totalMinutes}分${pd.coachPresent ? '' : '・コーチ不在'}`;
  return `<div class="dayhead">
    <div class="dh-main">
      <div class="dh-t">${dateHead}<span class="dh-court">${meta}</span></div>
      <div class="dh-aim"><span class="dh-aiml">本日の狙い</span>${esc(pd.aim)}</div>
    </div>
    ${goalsPr}
  </div>`;
}

/**
 * 区画（session part）ヘッダ（火の外トレ／全面など）。日ヘッダの下に各部の見出しとして置く。
 * 区画ラベル・コート・時間帯・組違い種別を1行で示す。
 * @param {object} part buildDays の day.parts の1要素
 * @param {number} idx 0始まりの区画番号
 */
export function partHeader(part, idx) {
  const SHARE = { rotation: '組違いローテ', together: '男女合同', independent: 'コーチ不在（各自）' };
  const kindLabel = SHARE[part.sharedKind] || '';
  const courtTxt = part.partCourt && part.partCourt !== '不問' ? esc(part.partCourt) : '屋外/コート外';
  const meta = `${courtTxt}・${esc(part.start)}〜${esc(part.end)}・${part.totalMinutes}分${kindLabel ? `・${kindLabel}` : ''}`;
  return `<div class="parthead">
    <span class="ph-no">第${idx + 1}部</span>
    <span class="ph-label">${esc(part.label)}</span>
    <span class="ph-meta">${meta}</span>
  </div>`;
}

/**
 * 2列グリッド描画（組違い ON 時の日ビジュアル本体）。
 * 行ループのみを担い、各セルの描画は renderCell コールバックで各パターンが注入する。
 *
 * @param {object} pd buildDays の day（pd.rotation.rows を持つ）
 * @param {function(row:{type,boys?,girls?,drill?,label?,from,minutes,half?,coachSide?}, side:'boys'|'girls'|'shared'):string} renderCell
 *   各セルのHTML文字列を返すコールバック。side='shared' のとき colspan セル1つ。
 * @returns {string} HTML
 */
export function genderTwoColumn(pd, renderCell) {
  const rot = pd.rotation;
  if (!rot || !rot.rows || rot.rows.length === 0) return '';

  const header = `<div class="twocol-header">
    <div>${genderChip('男子')}</div>
    <div>${genderChip('女子')}</div>
  </div>`;

  const rowsHtml = rot.rows
    .map((row) => {
      if (row.type === 'together') {
        // WU・主自走・CD・both_self: 全幅の合同行
        return `<div class="tc-shared">${renderCell(row, 'shared')}</div>`;
      }
      if (row.type === 'rotation') {
        // コーチ段: boys / girls の2セル
        return `<div class="twocol">
        <div class="tccell ${row.boys.mode === 'practice' ? 'tc-coach' : 'tc-self'}">${renderCell(row, 'boys')}</div>
        <div class="tccell ${row.girls.mode === 'practice' ? 'tc-coach' : 'tc-self'}">${renderCell(row, 'girls')}</div>
      </div>`;
      }
      return '';
    })
    .join('');

  return `${header}<div class="twocol-wrap">${rowsHtml}</div>`;
}

/** KPIメーター（1チーム分）。 */
function kpiCard(label, gender, g) {
  const meters = g.kpi
    .map((k) => {
      const span = Math.abs(k.target - k.baseline) || 1;
      const done = Math.max(0, Math.min(100, Math.round(((span - k.remain) / span) * 100)));
      return `<div class="kpi"><div class="name">${esc(k.label)}</div>
        <div class="val">${esc(String(k.latest))}${esc(k.unit)}<span class="arrow">→</span><span class="tgt">${esc(String(k.target))}${esc(k.unit)}</span></div>
        <div class="bar"><span style="width:${done}%"></span></div></div>`;
    })
    .join('');
  return `<div class="kteam"><div class="kth">${genderChip(gender)}の指標</div><div class="kpis">${meters}</div></div>`;
}

/** 月/週の目標バー（この日の狙いの上に置く横2分割ボックス）。値はエンジン出力（session.goals）。 */
export function goalsBar(data) {
  const g = data.session.goals;
  return `<div class="goalbar">
    <div class="gb-cell"><span class="gb-lab">月の目標</span><span class="gb-val">${esc(g.monthMain || '—')}</span></div>
    <div class="gb-cell"><span class="gb-lab">週の目標</span><span class="gb-val">${esc(g.week || '—')}</span></div>
  </div>`;
}

/** 目標セクション（今月/今週/定性は共通、チェックする数字は男女別）。 */
export function goalsSection(data) {
  const g = data.session.goals;
  const qual = g.qualitative.map((q) => `・${esc(q)}`).join('<br>');
  return `<section class="goals">
    <h3>目標（チェックする数字は各チーム別）</h3>
    <div class="gline"><span class="lab">今月</span><span class="txt">${esc(g.monthMain)}</span></div>
    <div class="gline"><span class="lab">今週</span><span class="txt">${esc(g.week)}</span></div>
    <div class="gline"><span class="lab">質</span><span class="txt">${qual || '—'}</span></div>
    <div class="kgrid">
      ${kpiCard('男子', '男子', data.boysGoals)}
      ${kpiCard('女子', '女子', data.girlsGoals)}
    </div>
  </section>`;
}

/**
 * 年の流れ（男子行・女子行の2段で表示）。
 * 今は男女とも同じ暦月に「いま」が立つ（大会の男女差はコーチ確認で確定後に反映）。
 */
export function yearSection(data) {
  const y = data.year;

  /** 1行分のセル列を作る（gender='boys'|'girls'、currentMonth=その性別の現在月）。 */
  function buildRow(gender, currentMonth) {
    return y.arc
      .map((a) => {
        const peakCls = a.peakLevel === 2 ? ' peak2' : a.peakLevel === 1 ? ' peak1' : '';
        const peakChip = a.peakLevel === 2 ? '<span class="peakchip">目標の大会</span>' : '';
        const isNow = a.month === currentMonth;
        const nowChip = isNow ? `<span class="nowchip ${gender}">${gender === 'boys' ? '男子' : '女子'}いま</span>` : '';
        const shortPhase = esc(a.phase.replace(/（.*$/, '').replace(/\(.*$/, ''));
        return `<div class="arccell${peakCls}${isNow ? ' arccell-now' : ''}" title="${esc(a.headline)}">
          <span class="am">${a.month}月</span>
          <span class="ap">${shortPhase}</span>
          ${peakChip}
          ${nowChip}
        </div>`;
      })
      .join('');
  }

  const boysRow = buildRow('boys', y.currentBoys);
  const girlsRow = buildRow('girls', y.currentGirls);
  const peakLabels = y.peaks.map((p) => `${esc(p.label)}（${p.months.join('・')}月）`).join(' ／ ');

  return `<h3 class="lvh">1年の流れ（夏に新チーム発足 → 冬の新人大会 → 翌夏の中体連）</h3>
    <p class="note">男子・女子それぞれの「今月の位置」と「目標の大会の時期」を2行で並べています。今は男女とも同じ流れです（大会の男女差はコーチ確認で確定）。</p>
    <div class="arcrows">
      <div class="arcrow-label"><span class="gchip boys">男子</span></div>
      <div class="arcwrap">${boysRow}</div>
      <div class="arcrow-label"><span class="gchip girls">女子</span></div>
      <div class="arcwrap">${girlsRow}</div>
    </div>
    <div class="arclegend">
      <span class="lk"><span class="sw" style="background:var(--orange-soft)"></span>目標の大会：${peakLabels}</span>
      <span class="lk"><span class="sw" style="background:var(--boys)"></span>いま（${y.currentBoys}月・男女共通）</span>
    </div>`;
}

/** 月セクション（今月やること・フェーズ・チェックする数字・共通）。m/displayMonth を渡せば任意の月を描ける（複数月の実切替用）。 */
export function monthSection(data, m = data.session.month, displayMonth = data.month) {
  const peak = m.peak
    ? `<div class="mc-peak">大会に向けて仕上げる時期（${esc(peakName(data, m.peak))}）</div>`
    : '';
  const kpi =
    m.kpiHints && m.kpiHints.length
      ? `<div class="mc-kpi"><div class="kk">チェックする数字</div><div class="kv">${m.kpiHints.map(esc).join('・')}</div></div>`
      : '';
  return `<h3 class="lvh">${displayMonth}月にやること（年間予定より）</h3>
    <div class="monthcard">
      <div class="mc-h"><span class="mc-mon">${displayMonth}月</span><span class="mc-phase">${esc(m.phase)}</span></div>
      <div class="mc-aim">${esc(m.headline)}</div>
      ${peak}
      ${kpi}
    </div>
    <p class="note">今月のテーマ・フェーズ・確認したい数字は年間予定どおり。</p>`;
}

/** ピークkeyから表示名を引く。 */
function peakName(data, key) {
  const p = (data.year.peaks || []).find((x) => x.key === key);
  return p ? p.label : key;
}

/** 暫定前提の注記。 */
export function assumptionsNote(data) {
  if (!data.assumptions || !data.assumptions.length) return '';
  const items = data.assumptions.map((a) => `<li>${esc(a)}</li>`).join('');
  return `<div class="note"><b style="color:var(--orange-deep)">前提（コーチ確認で確定）</b><ul class="assume">${items}</ul></div>`;
}

/** タブ切替＋印刷＋テキストコピー＋組違いON/OFF の共通スクリプト。 */
export function clientScript() {
  return `(function(){
  function tabs(group,target){
    document.querySelectorAll('[data-'+group+']').forEach(function(p){p.hidden=p.getAttribute('data-'+group)!==target;});
  }
  document.querySelectorAll('.lvtab').forEach(function(b){b.addEventListener('click',function(){
    document.querySelectorAll('.lvtab').forEach(function(x){x.classList.toggle('on',x===b);});
    tabs('level',b.getAttribute('data-go'));
  });});
  var dts=document.querySelectorAll('.cal-go');
  function showDay(t){document.querySelectorAll('[data-day]').forEach(function(p){if(p.classList.contains('day'))p.hidden=p.getAttribute('data-day')!==t;});
    dts.forEach(function(b){b.classList.toggle('on',b.getAttribute('data-go')===t);});window.__curDay=t;}
  dts.forEach(function(b){b.addEventListener('click',function(){showDay(b.getAttribute('data-go'));});});
  // 既定表示日=今日: ブラウザのローカル日付に一致する日があればそれを選ぶ（無ければ先頭のまま）。
  (function(){
    var n=new Date();
    var iso=n.getFullYear()+'-'+('0'+(n.getMonth()+1)).slice(-2)+'-'+('0'+n.getDate()).slice(-2);
    var td=document.querySelector('.day[data-date="'+iso+'"]');
    if(td){var wd=td.getAttribute('data-day'); if(wd)showDay(wd);}
  })();
  // 週ピッカー実切替: 押下した週の wkpanel だけ出す（日切替と同型）。
  var wts=document.querySelectorAll('.cal-go-week');
  function showWeek(t){document.querySelectorAll('.wkpanel[data-week]').forEach(function(p){p.hidden=p.getAttribute('data-week')!==t;});
    wts.forEach(function(b){b.classList.toggle('on',b.getAttribute('data-go')===t);});window.__curWeek=t;}
  wts.forEach(function(b){b.addEventListener('click',function(){showWeek(b.getAttribute('data-go'));});});
  // 月ピッカー実切替: 押下した月の mopanel だけ出す。
  var mts=document.querySelectorAll('.cal-go-month');
  function showMonth(t){document.querySelectorAll('.mopanel[data-month]').forEach(function(p){p.hidden=p.getAttribute('data-month')!==t;});
    mts.forEach(function(b){b.classList.toggle('on',b.getAttribute('data-go')===t);});window.__curMonth=t;}
  mts.forEach(function(b){b.addEventListener('click',function(){showMonth(b.getAttribute('data-go'));});});
  function setMode(m){
    document.querySelectorAll('[data-interact]').forEach(function(el){el.hidden=el.getAttribute('data-interact')!==m;});
    document.querySelectorAll('.modetoggle .mt').forEach(function(b){b.classList.toggle('on',b.getAttribute('data-mode-go')===m);});
    window.__shareMode=m;
  }
  document.querySelectorAll('.modetoggle .mt').forEach(function(b){b.addEventListener('click',function(){setMode(b.getAttribute('data-mode-go'));});});
  setMode('on');
  var p=document.getElementById('printBtn'); if(p)p.addEventListener('click',function(){window.print();});
  var c=document.getElementById('copyBtn'); if(c)c.addEventListener('click',function(){
    var el=document.querySelector('.day[data-day="'+(window.__curDay||'')+'"] .plain')||document.querySelector('.plain');
    navigator.clipboard.writeText(el?el.textContent:'').then(function(){c.textContent='コピーしました';setTimeout(function(){c.textContent='テキストでコピー';},1500);});
  });
  // ── ハッシュ駆動ドリル詳細オーバーレイ（§2.2）──
  var overlay=document.getElementById('drill-overlay');
  function openDrill(id){
    if(!overlay)return;
    overlay.querySelectorAll('.drill-panel').forEach(function(p){p.hidden=p.getAttribute('data-id')!==id;});
    overlay.hidden=false;
    overlay.setAttribute('aria-hidden','false');
    document.body.style.overflow='hidden';
  }
  function closeDrill(){
    if(!overlay)return;
    overlay.hidden=true;
    overlay.setAttribute('aria-hidden','true');
    document.body.style.overflow='';
    if(location.hash){try{history.pushState('',document.title,location.pathname+location.search);}catch(_){location.hash='';}}
  }
  function syncHash(){
    var h=location.hash.replace('#drill-','');
    if(location.hash.indexOf('#drill-')===0&&h){openDrill(h);}
    else if(overlay&&!overlay.hidden){closeDrill();}
  }
  window.addEventListener('hashchange',syncHash);
  document.addEventListener('click',function(e){
    var t=e.target.closest('[data-drill]');
    if(t){e.preventDefault();var id=t.getAttribute('data-drill');location.hash='drill-'+id;}
  });
  if(overlay){
    // 戻る・暗幕は委譲で拾う（パネルは214枚あるため個別バインドだと先頭以外に効かない）
    overlay.addEventListener('click',function(e){
      if(e.target.closest('.drill-close')){location.hash='';return;}
      if(e.target===overlay||e.target.classList.contains('drill-scrim'))location.hash='';
    });
  }
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&overlay&&!overlay.hidden)location.hash='';});
  syncHash();
})();`;
}

/**
 * 1パターン分の HTML 文書を組み立てる純関数（外殻＋CSS＋body＋client script）。
 * 静的ビルド(build.mjs)・Cloud Function 双方から再利用する（描画ロジックは触らない）。
 * ※ build.mjs には静的ビルド専用の総なめ import があり、Cloud Function 側がそれを束ねると
 *   非JS資産まで巻き込んで失敗するため、この純関数だけは glob を持たない本モジュールに置く。
 * @param {{title:string, css?:string, body:string, script?:string}} arg
 * @returns {string} 完全な HTML 文書
 */
export function renderPage({ title, css, body, script }) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)}</title>
<style>${BASE_CSS}${css || ''}</style>
</head>
<body>
<main class="wrap">
${body}
</main>
<script>${script || clientScript()}</script>
</body>
</html>`;
}

/**
 * 1区画（または単一日）のブロック明細を配布テキスト行に変換する。
 * @param {string[]} L 追記先の行配列
 * @param {Array} blocks 区画/日のブロック配列
 */
function plainBlocks(L, blocks) {
  for (const b of blocks) {
    L.push(`${b.from}〜${b.to}　${b.label}（${b.minutes}分）`);
    for (const it of b.items) {
      const tag = it.mode === 'practice' ? '（コーチ付き）' : it.mode === 'lecture' ? '（レクチャ）' : '';
      const mins = b.isBundle ? '' : `（${it.minutes}分）`;
      L.push(`　・${it.name}${tag}${mins}${it.alternatives.length ? `／いずれか：${it.alternatives.join('・')}` : ''}`);
    }
    if (!b.isBundle) L.push('　・給水');
  }
}

/** 貼り付け用プレーンテキスト（男女2列スワップの段取り＋共通メニュー）。 */
export function plainText(data, pd) {
  const L = [];

  // コーチ指定の上書き日: 手書き内容をそのまま箇条書きにする（rotation/共通メニュー段取りは出さない）。
  if (pd.source === 'coach') {
    // 男女2列日（twoCol）: 時間スロットごとに男女2列で出す。both は男女共通の1本。
    if (pd.twoCol) {
      L.push(`【${data.school}】${data.month}月 ${pd.dayLabel}（${pd.court}・男女2列）${pd.title || '練習メニュー'}`);
      L.push('');
      L.push(`■ この日のねらい：${pd.aim}`);
      const cellText = (cell) =>
        (cell.items || []).map((it) => `${it.name}${it.note ? `（${it.note}）` : ''}`).join('／');
      for (const r of pd.rows) {
        L.push('');
        L.push(`■ ${r.from}〜${r.to}`);
        if (r.both) {
          L.push(`　[男女共通] ${r.both.label}：${cellText(r.both)}`);
        } else {
          L.push(`　男子｜${r.boys ? `${r.boys.label}：${cellText(r.boys)}` : '—'}`);
          L.push(`　女子｜${r.girls ? `${r.girls.label}：${cellText(r.girls)}` : '—'}`);
        }
      }
      L.push('　・終了');
      return L.join('\n');
    }
    const teamTxt = pd.team ? `・対象：${pd.team}` : '・男女共通';
    L.push(`【${data.school}】${data.month}月 ${pd.dayLabel}（${pd.court}${teamTxt}）${pd.title || '練習メニュー'}`);
    L.push('');
    L.push(`■ この日のねらい：${pd.aim}`);
    for (const b of pd.blocks) {
      L.push('');
      L.push(`■ ${b.label}`);
      for (const it of b.items) {
        const mins = it.minutes != null && it.minutes > 0 ? `（${it.minutes}分）` : '';
        const note = it.note ? `　${it.note}` : '';
        L.push(`　・${it.name}${mins}${note}`);
      }
    }
    L.push('　・終了');
    return L.join('\n');
  }

  const headCourt = Array.isArray(pd.parts) && pd.parts.length > 1
    ? pd.parts.map((p) => `${p.label}${p.totalMinutes}分`).join('＋')
    : pd.court;
  L.push(`【${data.school}】${data.month}月 ${pd.dayLabel}（${headCourt}・${pd.start}〜${pd.end}）練習メニュー`);
  L.push('');
  L.push(`■ 本日の狙い：${pd.aim}`);

  // 2部構成の日（火）: 区画ごとに見出し＋メニューを分けて出す。
  if (Array.isArray(pd.parts) && pd.parts.length > 0) {
    pd.parts.forEach((part, idx) => {
      L.push('');
      const courtTxt = part.partCourt && part.partCourt !== '不問' ? part.partCourt : '屋外/コート外';
      L.push(`━━ 第${idx + 1}部 ${part.label}（${courtTxt}・${part.start}〜${part.end}・${part.totalMinutes}分）━━`);
      if (part.sharedKind === 'together') {
        L.push('■ 男女合同（コーチが両方を同時に）。');
      } else if (part.sharedKind === 'rotation') {
        L.push('■ 組違い（コーチ1人）：要監督ドリルを男女左右2列でずらす（前後半で入れ替え）。');
      } else {
        L.push('■ コーチ不在：男女とも各自で自走。');
      }
      plainBlocks(L, part.blocks);
    });
    L.push('　・終了');
    return L.join('\n');
  }

  if (pd.sharedKind === 'rotation' && pd.rotation) {
    L.push('■ 組違い（コーチ1人）：要監督ドリルを男女左右2列でずらす。');
    L.push('  前半：コーチ付き側が要監督ドリル、もう片方は別の自走ドリル');
    L.push('  後半：左右入れ替え（入れ替え後にコーチ付き側が変わる）');
    L.push('  ─ 前後半を合わせて両グループが同じカリキュラムを全部こなす ─');
    L.push('');
    L.push('■ 組違いスケジュール（男子左列 / 女子右列）');
    for (const row of pd.rotation.rows) {
      if (row.type === 'together') {
        // drill.name が集約主見出し（例: ダイナミックストレッチ）を使う
        const togetherName = row.drill?.name || row.label || '';
        const compNote = row.drill?.components?.length
          ? `（内訳：${row.drill.components.join('／')}）`
          : '';
        L.push(`  ${row.from}  [両] ${togetherName}（${row.minutes}分）${compNote}`);
      } else if (row.type === 'rotation') {
        const bTag = row.boys.mode === 'practice' ? '●' : '自走';
        const gTag = row.girls.mode === 'practice' ? '●' : '自走';
        L.push(`  ${row.from}（${row.half}）`);
        L.push(`    男子(${bTag}) ${row.boys.name}  ／  女子(${gTag}) ${row.girls.name}`);
      }
    }
  } else if (pd.sharedKind === 'together') {
    L.push('■ 土曜は男女合同（コーチが両方を同時に）。');
  } else {
    L.push('■ コーチ不在日：男女とも各自で自走。');
  }

  L.push('');
  L.push('■ 共通メニュー（男女同一の内容）');
  for (const b of pd.blocks) {
    L.push(`${b.from}〜${b.to}　${b.label}（${b.minutes}分）`);
    for (const it of b.items) {
      const tag = it.mode === 'practice' ? '（コーチ付き）' : it.mode === 'lecture' ? '（レクチャ）' : '';
      // 束ね（WU/CD）の内訳はルーティンの順序情報のみ。時間はブロック単位（5分刻み）に一本化し、
      // 端数の内訳分数（1分・2分等）は配布テキストに出さない。
      const mins = b.isBundle ? '' : `（${it.minutes}分）`;
      L.push(`　・${it.name}${tag}${mins}${it.alternatives.length ? `／いずれか：${it.alternatives.join('・')}` : ''}`);
    }
    if (!b.isBundle) L.push('　・給水');
  }
  L.push('　・終了');
  return L.join('\n');
}
