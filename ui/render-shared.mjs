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
  --line:rgba(168,110,64,.13); --line-2:rgba(168,110,64,.22);
  --shadow:14px 18px 46px rgba(168,110,64,.15), -6px -8px 18px rgba(255,255,255,.9);
  --shadow-soft:0 8px 20px rgba(168,110,64,.09);
  --inset:inset 3px 3px 8px rgba(168,110,64,.10), inset -3px -3px 8px rgba(255,255,255,.85);
`;

/** 共通ベースCSS。 */
export const BASE_CSS = `
:root{${TOKENS}}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:var(--bg);color:var(--ink)}
body{font-family:"Hiragino Sans","Helvetica Neue",system-ui,sans-serif;line-height:1.7;-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums}
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

/* 日ヘッダ＋組違いパネル */
.interact{background:var(--surface);border-radius:18px;box-shadow:var(--shadow);padding:15px 18px;margin-bottom:14px}
.interact h4{font-size:14px;color:var(--orange-deep);font-weight:700;margin-bottom:4px}
.interact .ides{font-size:12px;color:var(--mute);line-height:1.6;margin-bottom:10px}
.dayhead{background:var(--surface);border-radius:18px;box-shadow:var(--shadow);padding:16px 20px;margin-bottom:14px}
.dayhead .dh-t{font-size:clamp(17px,3vw,21px);font-weight:700;letter-spacing:-.01em}
.dayhead .dh-court{font-size:12px;color:var(--mute);font-weight:600;margin-left:10px;background:var(--bg);box-shadow:var(--inset);border-radius:999px;padding:3px 11px;vertical-align:middle}
.dayhead .dh-aim{margin-top:11px;font-size:15px;font-weight:700;line-height:1.5;background:var(--bg);box-shadow:var(--inset);border-radius:14px;padding:11px 15px}
.dayhead .dh-aiml{display:block;font-size:11px;letter-spacing:.08em;color:var(--orange-deep);font-weight:700;margin-bottom:4px}
.rotphase{background:var(--bg);box-shadow:var(--inset);border-radius:14px;padding:11px 14px;margin-bottom:9px}
.rotphase:last-of-type{margin-bottom:0}
.rotphase .rp-h{font-size:13px;font-weight:700;margin-bottom:7px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.rp-tag{font-size:11px;border-radius:999px;padding:2px 10px;font-weight:600;white-space:nowrap}
.rp-coach{background:var(--orange);color:var(--orange-ink)}
.rp-self{background:var(--surface);color:var(--mute);box-shadow:var(--inset)}
.rotline{display:flex;gap:9px;align-items:baseline;font-size:13px;padding:4px 0}
.rotline .rl-who{flex:0 0 48px;font-size:12px;color:var(--orange-deep);font-weight:700}
.rotline .rl-list{flex:1;min-width:0;line-height:1.5}
.rotswap{font-size:12px;color:var(--orange-deep);font-weight:700;margin-top:9px;line-height:1.5}
.inote{font-size:13px;line-height:1.6}
.inote b{color:var(--orange-deep);font-weight:700}

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

/* 年アーク */
.arcwrap{display:flex;gap:7px;align-items:stretch;flex-wrap:wrap}
.arccell{flex:1 1 0;min-width:64px;background:var(--surface);border-radius:14px;box-shadow:var(--shadow-soft);padding:11px 11px;display:flex;flex-direction:column;gap:5px}
.arccell.peak2{background:var(--orange-soft)}
.arccell.peak1{background:var(--bg);box-shadow:var(--inset)}
.arccell .am{font-size:13px;font-weight:700}
.arccell .ap{font-size:11px;color:var(--mute);line-height:1.4;min-height:30px}
.arccell .amk{display:flex;flex-wrap:wrap;gap:4px}
.peakchip{font-size:10px;background:var(--orange-deep);color:var(--orange-ink);border-radius:999px;padding:2px 7px;font-weight:700;align-self:flex-start}
.nowchip{font-size:10px;border-radius:999px;padding:2px 7px;font-weight:700;white-space:nowrap}
.nowchip.boys{background:var(--boys);color:var(--orange-ink)}
.nowchip.girls{background:var(--girls);color:var(--orange-ink)}
.arclegend{display:flex;flex-wrap:wrap;gap:14px;margin-top:12px;font-size:12px;color:var(--mute)}
.arclegend .lk{display:inline-flex;align-items:center;gap:6px}
.arclegend .sw{width:14px;height:14px;border-radius:4px;display:inline-block}

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

/** 組違いON時のコーチ付き段ずらしローテ。 */
function coachSplitBody(pd) {
  const cs = pd.coachSplit;
  const rounds = (cs?.coachRounds ?? [])
    .map(
      (r) => `<div class="rotphase">
      <div class="rp-h"><span class="rp-tag rp-coach">コーチ付き</span>${esc(r.from)}〜　${esc(r.name)}（${r.minutes}分）</div>
      <div class="rotline"><span class="rl-who">前半</span><span class="rl-list">${genderChip(r.first)}にコーチが付く（${esc(r.second)}は同じ段を自走）</span></div>
      <div class="rotline"><span class="rl-who">後半</span><span class="rl-list">入れ替え：${genderChip(r.second)}にコーチ（${esc(r.first)}は自走）</span></div>
    </div>`,
    )
    .join('');
  const self = (cs?.selfSegs ?? []).map((s) => esc(s.name)).join(' ／ ');
  return `<h4>組違い：同じメニューを、コーチ付き段だけ男女でずらす</h4>
    <p class="ides">練習メニューは男女共通（下のとおり）。体育館を半面ずつ分けて男女が同時に進める。コーチは1人なので「コーチ付き」の段だけ前半・後半で男女を入れ替えて見る——同時刻にコーチが見るのは必ず片方、もう片方はその段を自走で進める。コート割り（左/右）は暫定。</p>
    ${rounds || '<p class="inote">この日はコーチ付き段がなく、男女とも自走で同時に進められる。</p>'}
    ${self ? `<p class="rotswap">自走の段（${self}）は男女が同時に実施（コーチ不要）。</p>` : ''}`;
}

/**
 * 組違い相互作用パネル（ON/OFF両方を出力。トグルで切替）。1日分。
 */
export function interactionPanel(pd) {
  const offNote = `<div class="interact" data-interact="off" hidden>
    <h4>組違いOFF：男女が別時間に同じメニューを各自フル</h4>
    <p class="inote">体育館を共有しない日は、<b>男女が別々の時間</b>に同じメニューをそれぞれフルで実施する（コーチが全部の段に付ける）。メニューの中身は下のとおりで男女共通。</p>
  </div>`;

  let onBody;
  if (pd.sharedKind === 'rotation') {
    onBody = `<div class="interact" data-interact="on">${coachSplitBody(pd)}</div>`;
  } else if (pd.sharedKind === 'together') {
    onBody = `<div class="interact" data-interact="on">
      <h4>男女合同（コーチが両方を同時に見る）</h4>
      <p class="inote">最長日の土曜は<b>男女合同</b>。コーチが両チームを同時に見て、合同のウォーム・ゲーム形式で進める。メニューは下のとおり。</p>
    </div>`;
  } else {
    onBody = `<div class="interact" data-interact="on">
      <h4>コーチ不在日（男女とも各自で自走）</h4>
      <p class="inote">コーチ不在日は組分け不要。<b>男女とも</b>下のメニューを自走で進める（要監督ドリルはこの日には入れていない）。</p>
    </div>`;
  }
  return onBody + offNote;
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

/** 目標セクション（今月/今週/定性は共通、KPIは男女別）。 */
export function goalsSection(data) {
  const g = data.session.goals;
  const qual = g.qualitative.map((q) => `・${esc(q)}`).join('<br>');
  return `<section class="goals">
    <h3>目標（練習は男女共通／指標は各チーム別）</h3>
    <div class="gline"><span class="lab">今月</span><span class="txt">${esc(g.monthMain)}</span></div>
    <div class="gline"><span class="lab">今週</span><span class="txt">${esc(g.week)}</span></div>
    <div class="gline"><span class="lab">質</span><span class="txt">${qual || '—'}</span></div>
    <div class="kgrid">
      ${kpiCard('男子', '男子', data.boysGoals)}
      ${kpiCard('女子', '女子', data.girlsGoals)}
    </div>
  </section>`;
}

/** 年セクション（新チーム12ヶ月アーク・2山・男女の「いま」が1ヶ月ズレる）。 */
export function yearSection(data) {
  const y = data.year;
  const cells = y.arc
    .map((a) => {
      const peakCls = a.peakLevel === 2 ? ' peak2' : a.peakLevel === 1 ? ' peak1' : '';
      const peakChip = a.peakLevel === 2 ? '<span class="peakchip">山</span>' : '';
      const marks = [];
      if (a.month === y.currentBoys) marks.push('<span class="nowchip boys">男子いま</span>');
      if (a.month === y.currentGirls) marks.push('<span class="nowchip girls">女子いま</span>');
      const shortPhase = esc(a.phase.replace(/（.*$/, '').replace(/\(.*$/, ''));
      return `<div class="arccell${peakCls}" title="${esc(a.headline)}">
        <span class="am">${a.month}月</span>
        <span class="ap">${shortPhase}</span>
        ${peakChip}
        <span class="amk">${marks.join('')}</span>
      </div>`;
    })
    .join('');
  const peakLabels = y.peaks.map((p) => `${esc(p.label)}（${p.months.join('・')}月）`).join(' ／ ');
  return `<h3 class="lvh">年間アーク（夏に発足 → 冬の新人大会 → 翌夏の中体連で集大成）</h3>
    <div class="arcwrap">${cells}</div>
    <div class="arclegend">
      <span class="lk"><span class="sw" style="background:var(--orange-soft)"></span>山（ピーク）：${peakLabels}</span>
      <span class="lk"><span class="sw" style="background:var(--boys)"></span>男子いま（${y.currentBoys}月）</span>
      <span class="lk"><span class="sw" style="background:var(--girls)"></span>女子いま（${y.currentGirls}月）</span>
    </div>
    <p class="note">夏の大会（6〜7月の中野区→都選手権）は前の代＝現3年の集大成で、新チームには出発点で山ではありません。新チームの山は2つ：冬の新人大会と翌夏の中体連。練習メニューは男女共通ですが、大会の山は時期が男女で約1ヶ月ずれます（女子先行）。</p>`;
}

/** 月セクション（原典フェーズ＋主眼＋追う指標・共通）。 */
export function monthSection(data) {
  const m = data.session.month;
  const peak = m.peak
    ? `<div class="mc-peak">この月は山に向かう期（${esc(peakName(data, m.peak))}）</div>`
    : '';
  const kpi =
    m.kpiHints && m.kpiHints.length
      ? `<div class="mc-kpi"><div class="kk">追う指標（計測台帳）</div><div class="kv">${m.kpiHints.map(esc).join('・')}</div></div>`
      : '';
  return `<h3 class="lvh">${data.month}月の主眼（原典の年間計画より・男女共通）</h3>
    <div class="monthcard">
      <div class="mc-h"><span class="mc-mon">${data.month}月</span><span class="mc-phase">${esc(m.phase)}</span></div>
      <div class="mc-aim">${esc(m.headline)}</div>
      ${peak}
      ${kpi}
    </div>
    <p class="note">月の主眼・フェーズ・追う指標は原典「年間計画」に忠実。練習メニューは男女共通で、大会の山の時期だけ男女でずれます（女子先行）。</p>`;
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

/** 貼り付け用プレーンテキスト（男女共通メニュー＋組違いの回し方）。 */
export function plainText(data, pd) {
  const L = [];
  L.push(`【${data.school}】${data.month}月 ${pd.dayLabel}（${pd.court}・${pd.start}〜${pd.end}）練習メニュー（男女共通）`);
  L.push('');
  L.push(`■ 本日の狙い：${pd.aim}`);
  if (pd.sharedKind === 'rotation' && pd.coachSplit) {
    L.push('■ 組違い（コーチ1人）：コーチ付きの段だけ男女でずらす。前半は片方にコーチ、その間もう片方は同じ段を自走→後半で入れ替え。');
  } else if (pd.sharedKind === 'together') {
    L.push('■ 土曜は男女合同（コーチが両方を同時に）。');
  } else {
    L.push('■ コーチ不在日：男女とも各自で自走。');
  }
  L.push('');
  L.push('■ メニュー');
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
