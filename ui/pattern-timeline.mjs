/**
 * @file パターン「タイムライン」— 縦の比例タイムライン。
 *
 * パターン1（配布プリント・文書リスト型）とは別マクロ構造。練習の「形・リズム」を高さで見せる。
 *   - 日: 左にクロックレール（各段の開始HH:MM）、右に段カードを分数比例の高さで積む。
 *     WU/CDは細い帯、主段は名前/分/mode/いずれか/動画。練習の流れが一目で分かる。
 *   - 週: 5日を横に並べ、各列に段を比例高さで積む（BLOCK_TINTで色分け）。下にローテ表。
 *   - 月: goalsCard ＋ 月内4週を横ストリップ。
 *   - 年: フェーズ・リボン（月スパンを横帯・peak/current強調）。
 */

import { esc, modeTag, altLine, videoLink, goalsCard, rotationTable, plainText, BLOCK_TINT } from './render-shared.mjs';

/** 分→比例高さ(px)。最小高さを担保しつつ分数に比例させる。 */
const segH = (minutes) => Math.max(34, Math.round(minutes * 4));

/** 日タイムラインの1段（束=細い帯 / 主段=高さ比例カード）。 */
function trackSeg(b) {
  const tint = BLOCK_TINT[b.block] || 'var(--mute)';
  if (b.isBundle) {
    const names = b.items.map((it) => esc(it.name)).join('・');
    return `<div class="tlband" style="--t:${tint}">
      <span class="tbl">${esc(b.label)}</span>
      <span class="tbn">${names}</span>
      <span class="tbm">${b.minutes}分</span>
    </div>`;
  }
  const it = b.items[0] || null;
  const rows = b.items
    .map(
      (x) => `<div class="tdrill">
        <span class="tdn">${esc(x.name)}${videoLink(x.video)}</span>
        ${modeTag(x.mode)}
        ${altLine(x.alternatives)}
      </div>`,
    )
    .join('');
  return `<div class="tlcard" style="--t:${tint};min-height:${segH(b.minutes)}px">
    <div class="tlh"><span class="tll">${esc(b.label)}</span><span class="tlm">${b.minutes}分</span></div>
    <div class="tlbody">${rows}</div>
  </div>`;
}

/** 1日ぶんの縦比例タイムライン（左レール＝開始時刻、右＝段カード）。 */
function dayTimeline(data, d, idx) {
  const t = data.team;
  const rows = d.blocks
    .map((b) => {
      const h = b.isBundle ? 'auto' : segH(b.minutes) + 'px';
      return `<div class="tlrow" style="--rh:${h}">
        <div class="tlclock"><span class="tk">${esc(b.from)}</span></div>
        <div class="tlseg">${trackSeg(b)}</div>
      </div>`;
    })
    .join('');
  const last = d.blocks[d.blocks.length - 1];
  const endRow = `<div class="tlrow tlrow-end">
      <div class="tlclock"><span class="tk">${esc(d.end)}</span></div>
      <div class="tlseg"><div class="tlend"><span class="tbl">ダウン／ミーティング</span><span class="tbn">今日の振り返りと、次に向けてのひとこと。</span></div></div>
    </div>`;

  return `<article class="day pageb" data-day="${esc(d.day)}"${idx === 0 ? '' : ' hidden'}>
    <div class="tlhead">
      <div class="tlt">${esc(t.label)}　${t.month}月 ${esc(d.dayLabel)}<span class="tlcourt">${esc(d.court)}</span></div>
      <div class="tlmeta"><span class="tltime">${esc(d.start)}〜${esc(d.end)}</span>　計 ${d.totalMinutes}分${d.coachPresent ? '' : '　・コーチ不在日（各自で自走）'}</div>
      <div class="tlaim"><span class="tlaiml">本日の狙い</span>${esc(d.aim)}</div>
    </div>
    <div class="timeline">${rows}${last && !last.isBundle ? endRow : endRow}</div>
    <pre class="plain" hidden>${esc(plainText(data, d))}</pre>
  </article>`;
}

/** 週レベル: 5日を横に並べ、各列に段を比例高さで積む（ガント風）。 */
function weekLevel(data) {
  const maxTotal = Math.max(...data.week.map((d) => d.totalMinutes), 1);
  const cols = data.week
    .map((d) => {
      const stack = d.blocks
        .map((b) => {
          const tint = BLOCK_TINT[b.block] || 'var(--mute)';
          const flex = Math.max(b.isBundle ? 6 : 14, b.minutes);
          const main = b.isBundle ? esc(b.label) : esc(b.items[0] ? b.items[0].name : b.label);
          return `<div class="wseg${b.isBundle ? ' wseg-bd' : ''}" style="--t:${tint};flex:${flex}" title="${esc(b.label)} ${b.minutes}分">
            <span class="wsl">${esc(b.label)}</span>
            <span class="wsn">${main}</span>
            <span class="wsm">${b.minutes}分</span>
          </div>`;
        })
        .join('');
      const colH = Math.round((d.totalMinutes / maxTotal) * 320) + 60;
      return `<div class="wcol">
        <div class="wcolh"><span class="wcd">${esc(d.dayLabel)}</span><span class="wcm">${esc(d.start)}〜${esc(d.end)}・${d.coachPresent ? '在席' : '不在'}</span></div>
        <div class="wstack" style="height:${colH}px">${stack}</div>
        <div class="wcaim">${esc(d.aim)}</div>
      </div>`;
    })
    .join('');
  return `<h3 class="lvh">週の練習リズム（高さ＝時間の長さ）</h3>
    <div class="weekcols">${cols}</div>
    ${rotationTable(data.rotationTable, data.team.groups)}`;
}

/** 月レベル: フル目標 ＋ 月内4週を横ストリップで。 */
function monthLevel(data) {
  const strip = data.monthWeeks
    .map(
      (w) => `<div class="mstep${w.current ? ' on' : ''}">
        <div class="msk">${esc(w.label)}${w.current ? '<span class="now">今週</span>' : ''}</div>
        <div class="mst">${esc(w.theme)}</div>
        <div class="msn">${esc(w.note)}</div>
      </div>`,
    )
    .join('');
  return `${goalsCard(data.goals)}
    <h3 class="lvh">${data.team.month}月の流れ（週ごとの重点）</h3>
    <div class="mstrip">${strip}</div>
    <p class="note">月内の週配分は仮置き（当週のみエンジンの実データ）。大会日程が決まり次第、ピーキングに合わせて差し替えます。</p>`;
}

/** 年レベル: フェーズ・リボン（月スパンを横帯・peak/current強調）。 */
function yearLevel(data) {
  const ribbons = data.year
    .map((b) => {
      const span = b.months.length;
      return `<div class="yrib${b.current ? ' on' : ''}${b.peak ? ' peak' : ''}" style="flex:${span}">
        <div class="ym">${b.months[0]}〜${b.months[b.months.length - 1]}月</div>
        <div class="yp">${esc(b.phase)}${b.peak ? '<span class="pk">ピーク</span>' : ''}${b.current ? '<span class="now">今</span>' : ''}</div>
        <div class="yf">${esc(b.focus)}</div>
      </div>`;
    })
    .join('');
  return `<h3 class="lvh">年間フェーズ（2つのピーク：夏の大会／新人大会）</h3>
    <div class="yribbons">${ribbons}</div>
    <p class="note">年間は「夏の大会（現チーム）」と「新人大会（新チーム）」の2つの山で設計。帯は期間の重み付けで、タスク依存の線は引かない（計画は毎週流動するため）。</p>`;
}

const PATTERN_CSS = `
.tlhead{background:var(--surface);border-radius:22px;box-shadow:var(--shadow);padding:18px 22px;margin-bottom:18px}
.tlt{font-size:clamp(18px,3.2vw,22px);font-weight:700;letter-spacing:-.01em;line-height:1.45}
.tlcourt{font-size:12px;color:var(--mute);font-weight:600;margin-left:10px;background:var(--bg);box-shadow:var(--inset);border-radius:999px;padding:3px 11px;vertical-align:middle}
.tlmeta{font-size:13px;color:var(--mute);margin-top:5px}
.tltime{color:var(--orange-deep);font-weight:700}
.tlaim{margin-top:12px;font-size:16px;font-weight:700;line-height:1.5;background:var(--bg);box-shadow:var(--inset);border-radius:14px;padding:11px 15px}
.tlaiml{display:block;font-size:11px;letter-spacing:.08em;color:var(--orange-deep);font-weight:700;margin-bottom:4px}

/* 縦比例タイムライン: 左クロックレール ＋ 右段カード */
.timeline{position:relative;padding-left:64px}
.timeline::before{content:"";position:absolute;left:54px;top:6px;bottom:18px;width:2px;background:var(--line-2);border-radius:2px}
.tlrow{position:relative;display:flex;min-height:var(--rh,auto);margin-bottom:10px}
.tlclock{position:absolute;left:-64px;top:0;width:64px;display:flex;align-items:flex-start;justify-content:flex-start}
.tk{font-size:13px;font-weight:700;color:var(--ink);background:var(--surface);box-shadow:var(--shadow-soft);border-radius:999px;padding:3px 9px}
.tlclock::after{content:"";position:absolute;left:50px;top:9px;width:10px;height:10px;border-radius:50%;background:var(--t,var(--orange));box-shadow:var(--shadow-soft)}
.tlseg{flex:1;min-width:0;display:flex}

.tlcard{flex:1;background:var(--surface);border-radius:16px;box-shadow:var(--shadow-soft);padding:12px 16px;display:flex;flex-direction:column;justify-content:center}
.tlh{display:flex;align-items:baseline;gap:10px;margin-bottom:7px}
.tll{font-size:13px;font-weight:700;color:var(--t);letter-spacing:.02em}
.tlm{margin-left:auto;font-size:12px;color:var(--mute)}
.tlbody{display:flex;flex-direction:column;gap:8px}
.tdrill{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.tdn{font-size:16px;font-weight:600;line-height:1.45;min-width:0}
.tdrill .alt{flex-basis:100%;margin-top:0}

.tlband{flex:1;display:flex;align-items:center;gap:10px;background:var(--bg);box-shadow:var(--inset);border-radius:12px;padding:7px 14px}
.tlband .tbl{font-size:12px;font-weight:700;color:var(--t);flex:0 0 auto}
.tlband .tbn{font-size:12px;color:var(--mute);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tlband .tbm{font-size:11px;color:var(--mute);flex:0 0 auto}
.tlrow-end .tlend{flex:1;background:var(--bg);box-shadow:var(--inset);border-radius:12px;padding:9px 14px}
.tlrow-end .tbl{font-size:13px;font-weight:700;color:var(--mute);margin-right:8px}
.tlrow-end .tbn{font-size:12px;color:var(--mute)}
.tlrow-end .tlclock::after{background:var(--mute)}

.lvh{font-size:14px;color:var(--orange-deep);font-weight:700;margin:6px 2px 14px}

/* 週: 横並びの列・段を比例高さで積む（ガント風） */
.weekcols{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;align-items:start}
.wcol{background:var(--surface);border-radius:18px;box-shadow:var(--shadow-soft);padding:13px 12px;display:flex;flex-direction:column;gap:9px}
.wcolh{text-align:center}
.wcd{display:block;font-size:16px;font-weight:700}
.wcm{display:block;font-size:10px;color:var(--mute);margin-top:2px}
.wstack{display:flex;flex-direction:column;gap:5px}
.wseg{flex:1;background:var(--bg);box-shadow:var(--inset);border-radius:11px;padding:8px 10px;display:flex;flex-direction:column;gap:2px;min-height:0;overflow:hidden}
.wsl{font-size:10px;font-weight:700;color:var(--t);letter-spacing:.02em}
.wsn{font-size:12px;line-height:1.35;overflow:hidden}
.wsm{font-size:10px;color:var(--mute);margin-top:auto}
.wseg-bd{flex:0 0 auto}
.wseg-bd .wsn{display:none}
.wcaim{font-size:11px;color:var(--mute);line-height:1.5;text-align:center}

/* 月: 4週の横ストリップ */
.mstrip{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.mstep{background:var(--surface);border-radius:16px;box-shadow:var(--shadow-soft);padding:14px 15px;display:flex;flex-direction:column;gap:5px}
.mstep.on{box-shadow:var(--shadow)}
.msk{font-size:13px;font-weight:700;display:flex;align-items:center;gap:7px}
.now{font-size:10px;background:var(--orange);color:var(--orange-ink);border-radius:999px;padding:2px 8px}
.mst{font-size:13px;line-height:1.5}
.msn{font-size:11px;color:var(--mute)}

/* 年: フェーズ・リボン */
.yribbons{display:flex;gap:8px;align-items:stretch}
.yrib{background:var(--surface);border-radius:16px;box-shadow:var(--shadow-soft);padding:14px 14px;min-width:0;display:flex;flex-direction:column;gap:4px}
.yrib.on{box-shadow:var(--shadow)}
.yrib.peak{background:var(--orange-soft)}
.ym{font-size:11px;color:var(--mute)}
.yp{font-size:14px;font-weight:700;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.pk{font-size:10px;background:var(--orange-deep);color:var(--orange-ink);border-radius:999px;padding:2px 7px}
.yf{font-size:12px;color:var(--mute);line-height:1.5}

@media (max-width:680px){
  .weekcols{grid-template-columns:1fr;gap:8px}
  .wstack{height:auto!important}
  .wseg{flex:0 0 auto!important;flex-direction:row;align-items:center;gap:10px}
  .wseg .wsm{margin-top:0}
  .mstrip{grid-template-columns:1fr 1fr}
  .yribbons{flex-wrap:wrap}.yrib{flex-basis:46%!important}
}
@media print{
  .timeline::before{background:var(--line-2)}
  .tlcard,.wcol,.mstep,.yrib{box-shadow:none;border:1px solid var(--line-2)}
}
`;

export const meta = { id: 'timeline', name: 'タイムライン', tagline: '練習の形とリズムを縦の比例タイムラインで見せる' };

export function render(data) {
  const dayTabs = data.week
    .map(
      (d, i) => `<button class="daytab${i === 0 ? ' on' : ''}" data-go="${esc(d.day)}" type="button">${esc(d.day)}<small>${d.coachPresent ? '在席' : '不在'}</small></button>`,
    )
    .join('');
  const dayTimelines = data.week.map((d, i) => dayTimeline(data, d, i)).join('\n');

  return {
    css: PATTERN_CSS,
    body: `
    <div class="levels" role="tablist">
      <button class="lvtab on" data-go="day" type="button">日</button>
      <button class="lvtab" data-go="week" type="button">週</button>
      <button class="lvtab" data-go="month" type="button">月</button>
      <button class="lvtab" data-go="year" type="button">年</button>
    </div>

    <div class="level" data-level="day">
      <div class="toolbar" data-print-hide>
        <button class="btn btn-primary" id="printBtn" type="button">印刷 / PDFで保存</button>
        <button class="btn" id="copyBtn" type="button">テキストでコピー</button>
      </div>
      <div class="daytabs" data-print-hide>${dayTabs}</div>
      ${dayTimelines}
    </div>

    <div class="level" data-level="week" hidden>${weekLevel(data)}</div>
    <div class="level" data-level="month" hidden>${monthLevel(data)}</div>
    <div class="level" data-level="year" hidden>${yearLevel(data)}</div>
    `,
  };
}
