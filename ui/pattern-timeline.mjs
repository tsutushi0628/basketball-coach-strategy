/**
 * @file パターン「タイムライン」— 縦の比例タイムライン（採用案）。練習メニューは男女共通（1本）。
 *
 * 主役は「日」: 上に組違いの回し方（コーチ付き段を男女でずらす）、下に共通メニューを左クロック
 * レール＋分数比例の高さで積む。練習の流れ・リズムが一目で分かる。週＝5日のガント、月＝原典の
 * 主眼、年＝12ヶ月アーク（2山）。
 */

import {
  esc, modeTag, altLine, videoLink, plainText, BLOCK_TINT,
  modeToggle, interactionPanel, dayHeader,
  goalsSection, monthSection, yearSection, assumptionsNote,
} from './render-shared.mjs';

/** 分→比例高さ(px)。 */
const segH = (minutes) => Math.max(34, Math.round(minutes * 3.6));

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

/** 共通メニューの縦比例タイムライン。 */
function menuTimeline(pd) {
  const rows = pd.blocks
    .map((b) => {
      const h = b.isBundle ? 'auto' : segH(b.minutes) + 'px';
      return `<div class="tlrow" style="--rh:${h}">
        <div class="tlclock"><span class="tk">${esc(b.from)}</span></div>
        <div class="tlseg">${trackSeg(b)}</div>
      </div>`;
    })
    .join('');
  const endRow = `<div class="tlrow tlrow-end">
      <div class="tlclock"><span class="tk">${esc(pd.end)}</span></div>
      <div class="tlseg"><div class="tlend"><span class="tbl">ダウン／ミーティング</span><span class="tbn">今日の振り返りと、次に向けてのひとこと。</span></div></div>
    </div>`;
  return `<div class="timeline">${rows}${endRow}</div>`;
}

function dayTimeline(data, pd, idx) {
  return `<article class="day pageb" data-day="${esc(pd.day)}"${idx === 0 ? '' : ' hidden'}>
    ${dayHeader(pd, data.month)}
    ${interactionPanel(pd)}
    ${menuTimeline(pd)}
    <pre class="plain" hidden>${esc(plainText(data, pd))}</pre>
  </article>`;
}

/** 週レベル: 5日のガント（共通メニュー）。 */
function weekLevel(data) {
  const maxTotal = Math.max(...data.days.map((d) => d.totalMinutes), 1);
  const cols = data.days
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
      const colH = Math.round((d.totalMinutes / maxTotal) * 280) + 50;
      const share = d.sharedKind === 'rotation' ? '組違いローテ' : d.sharedKind === 'together' ? '男女合同' : 'コーチ不在';
      return `<div class="wcol">
        <div class="wcolh"><span class="wcd">${esc(d.day)}</span><span class="wcm">${esc(share)}</span></div>
        <div class="wstack" style="height:${colH}px">${stack}</div>
      </div>`;
    })
    .join('');
  return `<h3 class="lvh">週の練習リズム（高さ＝時間・男女共通メニュー）</h3>
    <div class="weekcols">${cols}</div>
    <p class="note">列頭はその日の男女の回し方（組違いローテ／合同／コーチ不在）。詳細と組違いの段取りは「日」タブで。</p>`;
}

const PATTERN_CSS = `
.timeline{position:relative;padding-left:54px}
.timeline::before{content:"";position:absolute;left:44px;top:6px;bottom:16px;width:2px;background:var(--line-2);border-radius:2px}
.tlrow{position:relative;display:flex;min-height:var(--rh,auto);margin-bottom:9px}
.tlclock{position:absolute;left:-54px;top:0;width:54px;display:flex;align-items:flex-start}
.tk{font-size:12px;font-weight:700;color:var(--ink);background:var(--bg);box-shadow:var(--inset);border-radius:999px;padding:3px 8px}
.tlclock::after{content:"";position:absolute;left:41px;top:8px;width:9px;height:9px;border-radius:50%;background:var(--t,var(--orange));box-shadow:var(--shadow-soft)}
.tlseg{flex:1;min-width:0;display:flex}
.tlcard{flex:1;background:var(--surface);border-radius:14px;box-shadow:var(--shadow-soft);padding:11px 15px;display:flex;flex-direction:column;justify-content:center}
.tlh{display:flex;align-items:baseline;gap:8px;margin-bottom:6px}
.tll{font-size:12px;font-weight:700;color:var(--t);letter-spacing:.02em}
.tlm{margin-left:auto;font-size:11px;color:var(--mute)}
.tlbody{display:flex;flex-direction:column;gap:7px}
.tdrill{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.tdn{font-size:15px;font-weight:600;line-height:1.45;min-width:0}
.tdrill .alt{flex-basis:100%;margin-top:0}
.tlband{flex:1;display:flex;align-items:center;gap:9px;background:var(--bg);box-shadow:var(--inset);border-radius:11px;padding:7px 13px}
.tlband .tbl{font-size:12px;font-weight:700;color:var(--t);flex:0 0 auto}
.tlband .tbn{font-size:12px;color:var(--mute);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tlband .tbm{font-size:11px;color:var(--mute);flex:0 0 auto}
.tlrow-end .tlend{flex:1;background:var(--bg);box-shadow:var(--inset);border-radius:11px;padding:9px 13px}
.tlrow-end .tbl{font-size:12px;font-weight:700;color:var(--mute);margin-right:8px}
.tlrow-end .tbn{font-size:12px;color:var(--mute)}
.tlrow-end .tlclock::after{background:var(--mute)}

.weekcols{display:grid;grid-template-columns:repeat(5,1fr);gap:9px;align-items:start}
.wcol{background:var(--surface);border-radius:16px;box-shadow:var(--shadow-soft);padding:12px 11px;display:flex;flex-direction:column;gap:8px}
.wcolh{text-align:center}
.wcd{display:block;font-size:15px;font-weight:700}
.wcm{display:block;font-size:10px;color:var(--orange-deep);font-weight:700;margin-top:2px}
.wstack{display:flex;flex-direction:column;gap:5px}
.wseg{flex:1;background:var(--bg);box-shadow:var(--inset);border-radius:10px;padding:7px 9px;display:flex;flex-direction:column;gap:2px;min-height:0;overflow:hidden}
.wsl{font-size:10px;font-weight:700;color:var(--t);letter-spacing:.02em}
.wsn{font-size:11px;line-height:1.3;overflow:hidden}
.wsm{font-size:10px;color:var(--mute);margin-top:auto}
.wseg-bd{flex:0 0 auto}
.wseg-bd .wsn{display:none}

@media (max-width:680px){
  .weekcols{grid-template-columns:1fr;gap:7px}
  .wstack{height:auto!important}
  .wseg{flex:0 0 auto!important;flex-direction:row;align-items:center;gap:9px}
  .wseg .wsm{margin-top:0}
}
`;

export const meta = { id: 'timeline', name: 'タイムライン', tagline: '練習の流れを縦の比例タイムラインで・男女共通メニュー' };

export function render(data) {
  const dayTabs = data.days
    .map(
      (d, i) => `<button class="daytab${i === 0 ? ' on' : ''}" data-go="${esc(d.day)}" type="button">${esc(d.day)}<small>${d.coachPresent ? '在席' : '不在'}</small></button>`,
    )
    .join('');
  const dayTimelines = data.days.map((d, i) => dayTimeline(data, d, i)).join('\n');

  return {
    css: PATTERN_CSS,
    body: `
    <h1 style="font-size:clamp(20px,3.4vw,26px);font-weight:700;letter-spacing:-.01em;margin:0 0 4px">${esc(data.school)}　練習タイムライン</h1>
    <p style="color:var(--mute);font-size:13px;margin-bottom:14px">${data.month}月　／　練習メニューは男女共通。組違い＝コーチ1人で男女を回す段取りを切り替えられます。</p>
    <div class="levels" role="tablist">
      <button class="lvtab on" data-go="day" type="button">日</button>
      <button class="lvtab" data-go="week" type="button">週</button>
      <button class="lvtab" data-go="month" type="button">月</button>
      <button class="lvtab" data-go="year" type="button">年</button>
    </div>

    <div class="level" data-level="day">
      <div class="toolbar" data-print-hide>
        ${modeToggle()}
        <button class="btn btn-primary" id="printBtn" type="button">印刷 / PDFで保存</button>
        <button class="btn" id="copyBtn" type="button">テキストでコピー</button>
      </div>
      <div class="daytabs" data-print-hide>${dayTabs}</div>
      ${dayTimelines}
    </div>

    <div class="level" data-level="week" hidden>${weekLevel(data)}</div>
    <div class="level" data-level="month" hidden>${monthSection(data)}${goalsSection(data)}</div>
    <div class="level" data-level="year" hidden>${yearSection(data)}${assumptionsNote(data)}</div>
    `,
  };
}
