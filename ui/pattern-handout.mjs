/**
 * @file パターン「配布プリント」— 紙で配れる文書型。練習メニューは男女共通（1本）。
 *
 * 4レベル（日/週/月/年）。主役は「日」: 上に組違いの回し方（コーチ付き段を男女でずらす）、
 * 下に男女共通メニューを時間ブロックの文書で積む。月＝原典の主眼、年＝12ヶ月アーク（2山）。
 */

import {
  esc, modeTag, altLine, videoLink, plainText,
  modeToggle, genderTwoColumn, dayHeader,
  goalsSection, monthSection, yearSection, assumptionsNote,
} from './render-shared.mjs';

/** 1ブロックの文書描画（時間範囲見出し＋ドリル行）。 */
function blockSection(b) {
  const items = b.items
    .map(
      (it) => `<li class="drow">
        <span class="dn">${esc(it.name)}${videoLink(it.video)}${altLine(it.alternatives)}</span>
        <span class="dm">${it.minutes}分</span>
        ${b.isBundle ? '' : modeTag(it.mode)}
      </li>`,
    )
    .join('');
  const water = b.isBundle ? '' : '<li class="drow water"><span class="dn">給水</span></li>';
  return `<section class="hblock">
    <h4 class="hbh"><span class="hbr">${esc(b.from)}〜${esc(b.to)}</span><span class="hbn">${esc(b.label)}</span><span class="hbm">${b.minutes}分</span></h4>
    <ul class="drows">${items}${water}</ul>
  </section>`;
}

/** 共通メニュー（文書ブロック群＋ダウン）。 */
function menuDoc(pd) {
  return `<div class="hmenu">${pd.blocks.map(blockSection).join('')}
    <section class="hblock hend"><h4 class="hbh"><span class="hbr">${esc(pd.end)}〜</span><span class="hbn">ダウン／ミーティング</span></h4><p class="endn">今日の振り返りと、次に向けてのひとこと。</p></section>
  </div>`;
}

/**
 * 左右2列の文書（rotation 日の日ビジュアル本体）。
 * 行＝時刻見出し＋左右2カラム（左=男子・右=女子のドリル行）。
 * @media print で2列grid を維持。
 */
function rotationDoc(pd) {
  const renderCell = (row, side) => {
    if (side === 'shared') {
      const compHtml = row.drill?.components?.length
        ? `<div class="hdc-comp">${row.drill.components.map(esc).join(' / ')}</div>`
        : '';
      const drillName = row.drill?.name || row.label || '';
      const blockLabel = row.drill?.name && row.label && row.drill.name !== row.label ? row.label : '';
      return `<div class="hdoc-shared">
        <span class="hbr">${esc(row.from)}</span>
        ${blockLabel ? `<span class="hbn hbn-block">${esc(blockLabel)}</span>` : ''}
        <span class="hbn">${esc(drillName)}</span>
        <span class="hbm">${row.minutes}分</span>
        ${compHtml}
      </div>`;
    }
    const cell = row[side];
    return `<div class="hdoc-cell${cell.mode === 'practice' ? ' hdc-coach' : ' hdc-self'}">
      <div class="hdc-from">${esc(row.from)}（${esc(row.half)}）</div>
      ${modeTag(cell.mode)}
      <div class="hdc-name">${esc(cell.name)}${videoLink(cell.video)}</div>
      ${altLine(cell.alternatives)}
    </div>`;
  };

  const onContent = genderTwoColumn(pd, renderCell);
  const offNote = `<div data-interact="off" hidden>
    <div class="inote"><b>組違いOFF</b>：男女が別時間に同じ内容を各自フル実施。</div>
    ${menuDoc(pd)}
  </div>`;

  return `<div data-interact="on">${onContent}</div>${offNote}`;
}

/** 1日ぶんの配布物。 */
function dayDoc(data, pd, idx) {
  const isRotation = pd.sharedKind === 'rotation' && pd.rotation;
  return `<article class="day pageb" data-day="${esc(pd.day)}"${idx === 0 ? '' : ' hidden'}>
    ${dayHeader(pd, data.month)}
    ${isRotation ? rotationDoc(pd) : menuDoc(pd)}
    <pre class="plain" hidden>${esc(plainText(data, pd))}</pre>
  </article>`;
}

/** 週レベル: 5日をカード一覧（男女共通メニュー）。 */
function weekLevel(data) {
  const cards = data.days
    .map((d) => {
      const chips = d.blocks
        .filter((b) => !b.isBundle)
        .map((b) => `<span class="wchip">${esc(b.label)} ${b.minutes}分</span>`)
        .join('');
      const share =
        d.sharedKind === 'rotation'
          ? '組違いローテ'
          : d.sharedKind === 'together'
            ? '男女合同'
            : 'コーチ不在・各自自走';
      return `<div class="wcard">
        <div class="wch"><span class="wd">${esc(d.dayLabel)}</span><span class="wmeta">${esc(d.court)}・${d.coachPresent ? '在席' : '不在'}</span></div>
        <div class="wchips">${chips || '<span class="wmeta">—</span>'}</div>
        <div class="wshare">${esc(share)}</div>
        <div class="waim">${esc(d.aim)}</div>
      </div>`;
    })
    .join('');
  return `<p class="note">練習メニューは男女共通。曜日ごとの内容と、その日の男女の回し方（組違いローテ／合同／各自自走）です。</p>
    <div class="weekgrid">${cards}</div>`;
}

const PATTERN_CSS = `
/* 2列文書（rotation 日） */
.hdoc-shared{display:flex;align-items:baseline;flex-wrap:wrap;gap:9px;background:var(--bg);box-shadow:var(--inset);border-radius:11px;padding:8px 13px;font-size:13px;color:var(--mute)}
.hdoc-cell{border-radius:12px;padding:9px 13px;display:flex;flex-direction:column;gap:4px}
.hdoc-cell.hdc-coach{background:var(--surface);box-shadow:var(--shadow-soft)}
.hdoc-cell.hdc-self{background:var(--bg);box-shadow:var(--inset)}
.hdc-from{font-size:11px;color:var(--orange-deep);font-weight:700}
.hdc-name{font-size:14px;font-weight:600;line-height:1.4;margin-top:3px}
.hbn-block{font-size:10px;color:var(--mute);letter-spacing:.04em}
.hdc-comp{flex-basis:100%;font-size:11px;color:var(--mute);opacity:.8;line-height:1.5;margin-top:2px}
@media print{
  .twocol{grid-template-columns:1fr 1fr}
  .tc-shared{grid-column:1/-1}
  .hdoc-cell{break-inside:avoid}
}

.hmenu{margin-top:2px}
.hblock{background:var(--bg);border-radius:14px;box-shadow:var(--inset);padding:11px 14px;margin-bottom:9px}
.hbh{display:flex;align-items:baseline;gap:10px;margin-bottom:4px}
.hbr{font-size:14px;font-weight:700;color:var(--ink)}
.hbn{font-size:12px;color:var(--mute)}
.hbm{margin-left:auto;font-size:11px;color:var(--mute)}
.drows{list-style:none}
.drow{display:flex;align-items:flex-start;gap:9px;padding:6px 0;border-bottom:1px solid var(--line)}
.drows>li:last-child{border-bottom:none}
.dn{flex:1;font-size:14px;min-width:0}
.dm{flex:0 0 auto;font-size:12px;color:var(--mute);padding-top:2px}
.water .dn{color:var(--mute);font-size:13px}
.hend .endn{font-size:13px;color:var(--mute);padding-top:2px}

.weekgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:11px}
.wcard{background:var(--surface);border-radius:16px;box-shadow:var(--shadow-soft);padding:14px 16px}
.wch{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:9px}
.wd{font-size:16px;font-weight:700}
.wmeta{font-size:11px;color:var(--mute)}
.wchips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}
.wchip{font-size:12px;border-radius:999px;padding:4px 11px;background:var(--bg);color:var(--ink);box-shadow:var(--inset)}
.wshare{font-size:12px;color:var(--orange-deep);font-weight:700;margin-bottom:5px}
.waim{font-size:12px;color:var(--mute);line-height:1.55}
`;

export const meta = { id: 'handout', name: '配布プリント', tagline: '紙で配れる文書型・男女共通メニュー' };

export function render(data) {
  const dayTabs = data.days
    .map(
      (d, i) => `<button class="daytab${i === 0 ? ' on' : ''}" data-go="${esc(d.day)}" type="button">${esc(d.day)}<small>${d.coachPresent ? '在席' : '不在'}</small></button>`,
    )
    .join('');
  const dayDocs = data.days.map((d, i) => dayDoc(data, d, i)).join('\n');

  return {
    css: PATTERN_CSS,
    body: `
    <h1 style="font-size:clamp(20px,3.4vw,26px);font-weight:700;letter-spacing:-.01em;margin:0 0 4px">${esc(data.school)}　練習計画</h1>
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
      ${dayDocs}
    </div>

    <div class="level" data-level="week" hidden>${weekLevel(data)}</div>
    <div class="level" data-level="month" hidden>${monthSection(data)}${goalsSection(data)}</div>
    <div class="level" data-level="year" hidden>${yearSection(data)}${assumptionsNote(data)}</div>
    `,
  };
}
