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

/** ST-labo デザイントークン（warmブランド: クリーム地＋オレンジ）。 */
export const TOKENS = `
  --bg:#fbf5ec; --surface:#fffaf2; --ink:#2a201a; --mute:#7a6a5c;
  --orange:#ef7a32; --orange-ink:#fffaf2; --orange-soft:#ffd7b9; --orange-deep:#c4521b;
  --terra:#b8623b; --gold:#cf9a3e; --sage:#7c8a5a;
  --boys:#ef7a32; --girls:#b8623b;
  --line:rgba(168,110,64,.13); --line-2:rgba(168,110,64,.22); --hair:rgba(42,32,26,.09);
  --shadow:14px 18px 46px rgba(168,110,64,.15), -6px -8px 18px rgba(255,255,255,.9);
  --shadow-soft:0 8px 20px rgba(168,110,64,.09);
  --inset:inset 3px 3px 8px rgba(168,110,64,.10), inset -3px -3px 8px rgba(255,255,255,.85);
`;

/** 共通ベースCSS。 */
export const BASE_CSS = `
:root{${TOKENS}}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:var(--bg);color:var(--ink)}
body{font-family:"Hiragino Sans",system-ui,sans-serif;line-height:1.7;-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums}
.wrap{max-width:840px;margin:0 auto;padding:32px 18px 80px}
a{color:var(--orange-deep)}

/* レベル切替＆配布ツールバー */
.toolbar{display:flex;gap:9px;flex-wrap:wrap;align-items:center;margin:14px 0 18px}
.btn{appearance:none;border:none;cursor:pointer;background:var(--surface);color:var(--ink);box-shadow:var(--shadow-soft);border-radius:999px;padding:10px 18px;font:inherit;font-size:13px;letter-spacing:.02em;white-space:nowrap;transition:transform .16s ease,color .16s ease}
.btn:hover{transform:translateY(-2px);color:var(--orange)}
.btn:focus-visible{outline:2px solid var(--orange);outline-offset:3px}
.btn-primary{background:var(--orange);color:var(--orange-ink)}
.btn-primary:hover{color:var(--orange-ink)}
.levels{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:16px}
.lvtab{appearance:none;border:none;cursor:pointer;background:var(--surface);color:var(--mute);box-shadow:var(--shadow-soft);border-radius:14px;padding:8px 16px;font:inherit;font-size:14px;font-weight:600;transition:transform .16s ease}
.lvtab:hover{transform:translateY(-2px)}
.lvtab.on{background:var(--orange);color:var(--orange-ink);box-shadow:var(--shadow)}
.lvtab:focus-visible{outline:2px solid var(--orange);outline-offset:3px}
.daytabs{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:18px}
.daytab{appearance:none;border:none;cursor:pointer;background:var(--surface);color:var(--mute);box-shadow:var(--shadow-soft);border-radius:16px;padding:8px 14px;font:inherit;font-size:15px;font-weight:600;display:flex;flex-direction:column;align-items:center;gap:1px;min-width:52px;transition:transform .16s ease}
.daytab small{font-weight:400;font-size:10px;opacity:.82}
.daytab:hover{transform:translateY(-2px)}
.daytab.on{background:var(--orange);color:var(--orange-ink);box-shadow:var(--shadow)}

/* 組違いON/OFFトグル */
.modetoggle{display:inline-flex;gap:6px;background:var(--bg);box-shadow:var(--inset);border-radius:999px;padding:4px}
.modetoggle .mt{appearance:none;border:none;cursor:pointer;background:transparent;color:var(--mute);border-radius:999px;padding:7px 15px;font:inherit;font-size:13px;font-weight:600;white-space:nowrap;transition:color .16s ease}
.modetoggle .mt.on{background:var(--surface);color:var(--orange-deep);box-shadow:var(--shadow-soft)}
.modetoggle .mt:focus-visible{outline:2px solid var(--orange);outline-offset:2px}

/* 男女チップ（見出し横の小さな実体ブロック・色帯ではない） */
.gchip{display:inline-flex;align-items:center;gap:6px;font-weight:700}
.gchip::before{content:"";width:12px;height:12px;border-radius:4px;flex:0 0 auto}
.gchip.boys::before{background:var(--boys)}
.gchip.girls::before{background:var(--girls)}

/* 日ヘッダ */
.dayhead{background:var(--surface);border-radius:18px;box-shadow:var(--shadow);padding:16px 20px;margin-bottom:14px}
.dayhead .dh-t{font-size:clamp(17px,3vw,21px);font-weight:700;letter-spacing:-.01em}
.dayhead .dh-court{font-size:12px;color:var(--mute);font-weight:600;margin-left:10px;background:var(--bg);box-shadow:var(--inset);border-radius:999px;padding:3px 11px;vertical-align:middle}
.dayhead .dh-aim{margin-top:11px;font-size:15px;font-weight:700;line-height:1.5;background:var(--bg);box-shadow:var(--inset);border-radius:14px;padding:11px 15px}
.dayhead .dh-aiml{display:block;font-size:11px;letter-spacing:.08em;color:var(--orange-deep);font-weight:700;margin-bottom:4px}
.inote{font-size:13px;line-height:1.6}
.inote b{color:var(--orange-deep);font-weight:700}

/* 2列グリッド（組違い2列表示）*/
.twocol{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:14px}
.twocol-header{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:6px}
.tcrow{display:contents}
.tccell{background:var(--bg);border-radius:12px;box-shadow:var(--shadow-soft);padding:9px 12px;font-size:13px}
.tccell.tc-coach{background:var(--surface);box-shadow:var(--shadow-soft)}
.tccell.tc-self{box-shadow:var(--inset)}
.tc-shared{grid-column:1/-1;background:var(--bg);border-radius:11px;box-shadow:var(--inset);padding:8px 13px;font-size:13px;color:var(--mute)}
.tc-from{font-size:11px;color:var(--orange-deep);font-weight:700;margin-bottom:3px}
.tc-name{font-size:14px;font-weight:600;line-height:1.4}
.tc-half{font-size:10px;letter-spacing:.06em;color:var(--mute);margin-bottom:3px}
.tc-comp{display:block;font-size:11px;color:var(--mute);margin-top:3px;line-height:1.5}
@media (max-width:580px){
  .twocol,.twocol-header{grid-template-columns:1fr}
  .tc-shared{grid-column:1}
}
@media print{
  .twocol,.twocol-header{grid-template-columns:1fr 1fr}
  .tc-shared{grid-column:1/-1}
}

/* 目標（共通の今月/今週/定性 ＋ 男女別KPI） */
.goals{background:var(--surface);border-radius:22px;box-shadow:var(--shadow-soft);padding:18px 20px}
.goals h3{font-size:13px;margin-bottom:12px;color:var(--orange-deep);letter-spacing:.06em;font-weight:700}
.gline{display:flex;gap:13px;align-items:baseline;padding:8px 0;border-bottom:1px solid var(--line)}
.gline:last-child{border-bottom:none}
.gline .lab{flex:0 0 56px;font-size:11px;letter-spacing:.06em;color:var(--orange-deep);font-weight:700}
.gline .txt{font-size:14px;line-height:1.55}
.kgrid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}
.kteam{background:var(--bg);border-radius:16px;padding:13px 15px;box-shadow:var(--inset)}
.kteam .kth{font-size:13px;margin-bottom:9px}
.kpis{display:grid;grid-template-columns:1fr;gap:8px}
.kpi .name{font-size:12px;color:var(--mute);margin-bottom:5px}
.kpi .val{font-size:15px;font-weight:700}
.kpi .val .arrow{color:var(--mute);font-weight:400;font-size:12px;margin:0 4px}
.kpi .val .tgt{color:var(--orange-deep)}
.kpi .bar{height:6px;border-radius:999px;background:var(--orange-soft);margin-top:6px;overflow:hidden}
.kpi .bar>span{display:block;height:100%;border-radius:999px;background:var(--orange)}

/* タグ（自走/コーチ付き/レクチャ） */
.tag{flex:0 0 auto;font-size:11px;border-radius:999px;padding:3px 10px;white-space:nowrap;font-weight:600}
.tag-coach{background:var(--orange);color:var(--orange-ink)}
.tag-self{background:var(--bg);color:var(--mute);box-shadow:var(--inset)}
.tag-lec{background:var(--orange-soft);color:var(--orange-deep)}
.alt{color:var(--mute);font-size:13px;margin-top:3px}
.alt b{color:var(--orange-deep);font-weight:700;font-style:normal}
.vid{display:inline-flex;align-items:center;gap:3px;color:var(--orange-deep);text-decoration:none;font-size:12px;background:var(--bg);padding:2px 9px;border-radius:999px;box-shadow:var(--inset)}
.vid:hover{text-decoration:underline}

/* 年の流れ（男子行・女子行の2段） */
.arcrows{display:flex;flex-direction:column;gap:10px}
.arcrow-label{font-size:12px;font-weight:700;margin-bottom:-4px}
.arcwrap{display:flex;gap:5px;align-items:stretch;flex-wrap:nowrap;overflow-x:auto}
.arccell{flex:1 1 0;min-width:58px;background:var(--surface);border-radius:14px;box-shadow:var(--shadow-soft);padding:9px 9px;display:flex;flex-direction:column;gap:4px}
.arccell.peak2{background:var(--orange-soft)}
.arccell.peak1{background:var(--bg);box-shadow:var(--inset)}
.arccell.arccell-now{outline:2px solid var(--orange);outline-offset:1px}
.arccell .am{font-size:13px;font-weight:700}
.arccell .ap{font-size:10px;color:var(--mute);line-height:1.4;min-height:28px}
.peakchip{font-size:10px;background:var(--orange-deep);color:var(--orange-ink);border-radius:999px;padding:2px 7px;font-weight:700;align-self:flex-start}
.nowchip{font-size:10px;border-radius:999px;padding:2px 7px;font-weight:700;white-space:nowrap}
.nowchip.boys{background:var(--boys);color:var(--orange-ink)}
.nowchip.girls{background:var(--girls);color:var(--orange-ink)}
.arclegend{display:flex;flex-wrap:wrap;gap:14px;margin-top:12px;font-size:12px;color:var(--mute)}
.arclegend .lk{display:inline-flex;align-items:center;gap:6px}
.arclegend .sw{width:14px;height:14px;border-radius:4px;display:inline-block}
@media (max-width:680px){.arcwrap{flex-wrap:wrap}.arccell{flex-basis:30%;min-width:58px}}

/* 月（原典フェーズ＋主眼＋KPI・共通） */
.monthcard{background:var(--surface);border-radius:20px;box-shadow:var(--shadow-soft);padding:18px 20px}
.monthcard .mc-h{display:flex;align-items:center;gap:10px;margin-bottom:10px;padding-bottom:9px;border-bottom:1px solid var(--line)}
.monthcard .mc-phase{font-size:12px;color:var(--orange-deep);font-weight:700;background:var(--bg);box-shadow:var(--inset);border-radius:999px;padding:3px 11px}
.monthcard .mc-mon{font-size:15px;font-weight:700}
.monthcard .mc-aim{font-size:14px;line-height:1.6}
.monthcard .mc-peak{font-size:12px;color:var(--orange-deep);font-weight:700;margin-top:10px}
.monthcard .mc-kpi{margin-top:11px}
.monthcard .mc-kpi .kk{font-size:11px;letter-spacing:.06em;color:var(--orange-deep);font-weight:700;margin-bottom:5px}
.monthcard .mc-kpi .kv{font-size:13px;color:var(--mute);line-height:1.6}

.lvh{font-size:14px;color:var(--orange-deep);font-weight:700;margin:6px 2px 14px}
.note{font-size:12px;color:var(--mute);background:var(--surface);box-shadow:var(--shadow-soft);border-radius:14px;padding:11px 15px;margin:14px 0;line-height:1.6}
.assume{font-size:12px;color:var(--mute);line-height:1.7;margin-top:6px}
.assume li{margin-left:18px}
.foot{margin-top:34px;color:var(--mute);font-size:11px;text-align:center;letter-spacing:.03em;line-height:1.7}

@media (max-width:680px){
  .kgrid{grid-template-columns:1fr}
  .arccell{flex-basis:30%}
}
@media print{
  body{background:#fff}
  .toolbar,.levels,.daytabs,.modetoggle,.foot{display:none}
  [data-print-hide]{display:none!important}
  .day[hidden],.level[hidden]{display:block!important}
  .interact[hidden]{display:none!important}
  .dayhead,.goals,.interact,.monthcard,.arccell,.note,.kteam{box-shadow:none;border:1px solid var(--line-2)}
  .wrap{max-width:none;padding:0}
  .pageb{page-break-after:always}
}
`;

/** ブロック種別の色（warm系で統一・虹色にしない）。 */
export const BLOCK_TINT = {
  WU: 'var(--sage)',
  技術: 'var(--orange)',
  対人: 'var(--terra)',
  ゲーム: 'var(--gold)',
  CD: 'var(--mute)',
};

/** HTMLエスケープ。 */
export const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 再生アイコン（SVG・emoji不使用）。 */
export const VIDEO_SVG =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M10 9l5 3-5 3z"/></svg>';

const MODE_LABEL = { self: '自走', practice: 'コーチ付き', lecture: 'レクチャ' };
/** 自走/コーチ付き/レクチャのタグHTML。 */
export const modeTag = (mode) => {
  const cls = mode === 'practice' ? 'tag tag-coach' : mode === 'lecture' ? 'tag tag-lec' : 'tag tag-self';
  return `<span class="${cls}">${MODE_LABEL[mode] || mode}</span>`;
};

/** 動画リンク（あれば）。 */
export const videoLink = (url) =>
  url ? ` <a class="vid" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${VIDEO_SVG}<span>動画</span></a>` : '';

/** 「いずれか」候補行。 */
export const altLine = (alts) =>
  alts && alts.length ? `<div class="alt"><b>いずれか</b>　${alts.map(esc).join(' ／ ')}</div>` : '';

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

/** 日ヘッダ（曜日・コート・時間・本日の狙い）。 */
export function dayHeader(pd, month) {
  const meta = `${esc(pd.court)}・${esc(pd.start)}〜${esc(pd.end)}・計${pd.totalMinutes}分${pd.coachPresent ? '' : '・コーチ不在'}`;
  return `<div class="dayhead">
    <div class="dh-t">${month}月 ${esc(pd.dayLabel)}<span class="dh-court">${meta}</span></div>
    <div class="dh-aim"><span class="dh-aiml">本日の狙い（男女共通）</span>${esc(pd.aim)}</div>
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

/** 目標セクション（今月/今週/定性は共通、チェックする数字は男女別）。 */
export function goalsSection(data) {
  const g = data.session.goals;
  const qual = g.qualitative.map((q) => `・${esc(q)}`).join('<br>');
  return `<section class="goals">
    <h3>目標（練習は男女共通／チェックする数字は各チーム別）</h3>
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

/** 月セクション（今月やること・フェーズ・チェックする数字・共通）。 */
export function monthSection(data) {
  const m = data.session.month;
  const peak = m.peak
    ? `<div class="mc-peak">大会に向けて仕上げる時期（${esc(peakName(data, m.peak))}）</div>`
    : '';
  const kpi =
    m.kpiHints && m.kpiHints.length
      ? `<div class="mc-kpi"><div class="kk">チェックする数字</div><div class="kv">${m.kpiHints.map(esc).join('・')}</div></div>`
      : '';
  return `<h3 class="lvh">${data.month}月にやること（年間予定より・男女共通）</h3>
    <div class="monthcard">
      <div class="mc-h"><span class="mc-mon">${data.month}月</span><span class="mc-phase">${esc(m.phase)}</span></div>
      <div class="mc-aim">${esc(m.headline)}</div>
      ${peak}
      ${kpi}
    </div>
    <p class="note">今月のテーマ・フェーズ・確認したい数字は年間予定どおり。練習メニューは男女共通です。</p>`;
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
  var dts=document.querySelectorAll('.daytab');
  function showDay(t){document.querySelectorAll('[data-day]').forEach(function(p){if(p.classList.contains('day'))p.hidden=p.getAttribute('data-day')!==t;});
    dts.forEach(function(b){b.classList.toggle('on',b.getAttribute('data-go')===t);});window.__curDay=t;}
  dts.forEach(function(b){b.addEventListener('click',function(){showDay(b.getAttribute('data-go'));});});
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
})();`;
}

/** 貼り付け用プレーンテキスト（男女2列スワップの段取り＋共通メニュー）。 */
export function plainText(data, pd) {
  const L = [];
  L.push(`【${data.school}】${data.month}月 ${pd.dayLabel}（${pd.court}・${pd.start}〜${pd.end}）練習メニュー（男女共通）`);
  L.push('');
  L.push(`■ 本日の狙い：${pd.aim}`);

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
      L.push(`　・${it.name}${tag}（${it.minutes}分）${it.alternatives.length ? `／いずれか：${it.alternatives.join('・')}` : ''}`);
    }
    if (!b.isBundle) L.push('　・給水');
  }
  L.push('　・ダウン／ミーティング（振り返り）');
  return L.join('\n');
}
