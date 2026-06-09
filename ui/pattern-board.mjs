/**
 * @file パターン「週間ボード」— カレンダー・グリッド型。練習メニューは男女共通（1本）。
 *
 * 主役は「週」: 火〜土の5列ボードで各列に段チップを縦スタック（小さな正方ドットで種別・分数）、
 * 列頭にその日の男女の回し方（組違いローテ／合同／各自自走）。日レベルは横の積み上げ比率バー＋
 * 段リスト＋組違いパネル。月＝原典の主眼、年＝12ヶ月アーク（2山）。色帯（border-left/::before
 * stripe）は使わない。
 */

import {
  esc, modeTag, altLine, videoLink, plainText, BLOCK_TINT,
  modeToggle, genderTwoColumn, dayHeader,
  goalsSection, monthSection, yearSection, assumptionsNote,
} from './render-shared.mjs';

const tint = (block) => BLOCK_TINT[block] || 'var(--mute)';
const shareLabel = (k) => (k === 'rotation' ? '組違いローテ' : k === 'together' ? '男女合同' : 'コーチ不在・各自自走');

// ── 日レベル: 比率バー＋段リスト ─────────────────────────────────────────────
function ratioBar(pd) {
  const segs = pd.blocks
    .map(
      (b) => `<div class="rseg" style="flex:${b.minutes}" title="${esc(b.label)} ${b.minutes}分">
        <span class="rsdot" style="background:${tint(b.block)}"></span>
        <span class="rsl">${esc(b.label)}</span>
        <span class="rsm">${b.minutes}分</span>
      </div>`,
    )
    .join('');
  return `<div class="ratiobar">${segs}</div>`;
}

function detailBlock(b) {
  const rows = b.items
    .map(
      (it) => `<li class="ditem">
        <span class="din">${esc(it.name)}${videoLink(it.video)}${altLine(it.alternatives)}</span>
        <span class="dim">${it.minutes}分</span>
        ${b.isBundle ? '' : modeTag(it.mode)}
      </li>`,
    )
    .join('');
  return `<section class="dblock">
    <div class="dbh">
      <span class="dbdot" style="background:${tint(b.block)}"></span>
      <span class="dbn">${esc(b.label)}</span>
      <span class="dbr">${esc(b.from)}〜${esc(b.to)}</span>
      <span class="dbm">${b.minutes}分</span>
    </div>
    <ul class="ditems">${rows}</ul>
  </section>`;
}

/**
 * 2列の段リスト（rotation 日の日ビジュアル本体）。
 * 各 rotation 行を左右2チップ（左=男子・右=女子、coach 側にコーチタグ）。
 * shared 行は全幅チップ。
 */
function rotationBoardBody(pd) {
  const renderCell = (row, side) => {
    if (side === 'shared') {
      const compHtml = row.drill?.components?.length
        ? `<span class="brot-comp">${row.drill.components.map(esc).join(' / ')}</span>`
        : '';
      const drillName = row.drill?.name || row.label || '';
      const blockLabel = row.drill?.name && row.label && row.drill.name !== row.label ? row.label : '';
      return `<div class="brot-shared">
        ${blockLabel ? `<span class="brot-block">${esc(blockLabel)}</span>` : ''}
        <span class="brn">${esc(drillName)}</span>
        <span class="brm">${row.minutes}分</span>
        ${compHtml}
      </div>`;
    }
    const cell = row[side];
    return `<div class="brot-cell${cell.mode === 'practice' ? ' brc-coach' : ' brc-self'}">
      ${modeTag(cell.mode)}
      <span class="brn">${esc(cell.name)}${videoLink(cell.video)}</span>
      <span class="brm">${row.minutes}分</span>
      ${altLine(cell.alternatives)}
    </div>`;
  };

  const onContent = genderTwoColumn(pd, renderCell);
  const offNote = `<div data-interact="off" hidden>
    <div class="inote"><b>組違いOFF</b>：男女が別時間に同じ内容を各自フル実施。</div>
    ${ratioBar(pd)}
    <div class="dlist">${pd.blocks.map(detailBlock).join('')}</div>
  </div>`;

  return `<div data-interact="on">${onContent}</div>${offNote}`;
}

function dayPanel(data, pd, idx) {
  const isRotation = pd.sharedKind === 'rotation' && pd.rotation;
  return `<article class="day" data-day="${esc(pd.day)}"${idx === 0 ? '' : ' hidden'}>
    ${dayHeader(pd, data.month)}
    ${isRotation ? rotationBoardBody(pd) : (ratioBar(pd) + `<div class="dlist">${pd.blocks.map(detailBlock).join('')}</div>`)}
    <pre class="plain" hidden>${esc(plainText(data, pd))}</pre>
  </article>`;
}

// ── 週レベル: 5列ボード ──────────────────────────────────────────────────────
function boardColumn(d) {
  const chips = d.blocks
    .map(
      (b) => `<div class="bchip">
        <span class="bcdot" style="background:${tint(b.block)}"></span>
        <span class="bcl">${esc(b.label)}</span>
        <span class="bcm">${b.minutes}分</span>
      </div>`,
    )
    .join('');
  return `<div class="bcol">
    <div class="bch"><span class="bcd">${esc(d.day)}</span><span class="bcs ${d.coachPresent ? 'on' : 'off'}">${d.coachPresent ? '在席' : '不在'}</span></div>
    <div class="bct">${esc(d.court)}・${esc(d.start)}〜${esc(d.end)}</div>
    <div class="bshare">${esc(shareLabel(d.sharedKind))}</div>
    <div class="bstack">${chips || '<div class="bempty">—</div>'}</div>
    <div class="bcf">計 ${d.totalMinutes}分</div>
  </div>`;
}

function weekLevel(data) {
  const cols = data.days.map(boardColumn).join('');
  return `<h3 class="lvh">${data.month}月 今週のボード（男女共通メニュー）</h3>
    <div class="board">${cols}</div>
    <p class="note">列＝曜日、チップ＝段（色は種別）。列頭はその日の男女の回し方。詳細と組違いの段取りは「日」タブで。</p>`;
}

const PATTERN_CSS = `
.ratiobar{display:flex;gap:5px;height:60px;margin-bottom:14px}
.rseg{background:var(--bg);border-radius:12px;box-shadow:var(--inset);padding:8px 10px;display:flex;flex-direction:column;justify-content:center;gap:2px;min-width:0;overflow:hidden}
.rsdot{width:9px;height:9px;border-radius:3px;display:block;margin-bottom:2px}
.rsl{font-size:12px;font-weight:600;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rsm{font-size:11px;color:var(--mute)}
.dlist{display:flex;flex-direction:column;gap:9px}
.dblock{background:var(--bg);border-radius:14px;box-shadow:var(--inset);padding:11px 14px}
.dbh{display:flex;align-items:center;gap:9px;margin-bottom:6px}
.dbdot{flex:0 0 auto;width:9px;height:9px;border-radius:3px}
.dbn{font-size:14px;font-weight:700}
.dbr{font-size:12px;color:var(--mute)}
.dbm{margin-left:auto;font-size:12px;color:var(--mute)}
.ditems{list-style:none}
.ditem{display:flex;align-items:flex-start;gap:10px;padding:6px 0;border-bottom:1px solid var(--line)}
.ditems>li:last-child{border-bottom:none}
.din{flex:1;font-size:14px;min-width:0}
.dim{flex:0 0 auto;font-size:12px;color:var(--mute);padding-top:2px}

.board{display:grid;grid-template-columns:repeat(5,1fr);gap:9px;align-items:start}
.bcol{background:var(--surface);border-radius:16px;box-shadow:var(--shadow-soft);padding:12px 11px}
.bch{display:flex;align-items:center;justify-content:space-between;margin-bottom:3px}
.bcd{font-size:16px;font-weight:700}
.bcs{font-size:10px;border-radius:999px;padding:2px 8px;white-space:nowrap}
.bcs.on{background:var(--orange);color:var(--orange-ink)}
.bcs.off{background:var(--bg);color:var(--mute);box-shadow:var(--inset)}
.bct{font-size:10px;color:var(--mute);margin-bottom:2px}
.bshare{font-size:11px;color:var(--orange-deep);font-weight:700;margin-bottom:9px}
.bstack{display:flex;flex-direction:column;gap:6px}
.bchip{background:var(--bg);border-radius:11px;padding:7px 10px;box-shadow:var(--inset);display:flex;align-items:center;gap:7px}
.bcdot{flex:0 0 auto;width:8px;height:8px;border-radius:3px}
.bcl{flex:1;font-size:12px;line-height:1.3;min-width:0}
.bcm{flex:0 0 auto;font-size:11px;color:var(--mute)}
.bempty{font-size:12px;color:var(--mute);text-align:center;padding:8px 0}
.bcf{margin-top:10px;font-size:12px;color:var(--orange-deep);font-weight:700;text-align:right}

@media (max-width:680px){.board{grid-template-columns:repeat(2,1fr)}}
@media (max-width:460px){.board{grid-template-columns:1fr}.ratiobar{height:auto;flex-direction:column}.rseg{flex:none}}

/* rotation 2列ボード */
.brot-shared{display:flex;align-items:center;flex-wrap:wrap;gap:9px;background:var(--bg);box-shadow:var(--inset);border-radius:11px;padding:8px 12px;font-size:13px;color:var(--mute)}
.brot-block{font-size:10px;color:var(--mute);letter-spacing:.04em;flex:0 0 auto}
.brot-cell{border-radius:12px;padding:9px 12px;display:flex;flex-wrap:wrap;align-items:flex-start;gap:7px}
.brot-cell.brc-coach{background:var(--surface);box-shadow:var(--shadow-soft)}
.brot-cell.brc-self{background:var(--bg);box-shadow:var(--inset)}
.brn{flex:1;font-size:14px;font-weight:600;line-height:1.35;min-width:0}
.brm{flex:0 0 auto;font-size:12px;color:var(--mute);padding-top:2px}
.brot-cell .alt{flex-basis:100%}
.brot-comp{flex-basis:100%;font-size:11px;color:var(--mute);opacity:.8;line-height:1.5}
`;

export const meta = { id: 'board', name: '週間ボード', tagline: '週を5列ボードで俯瞰・男女共通メニュー' };

export function render(data) {
  const dayTabs = data.days
    .map(
      (d, i) => `<button class="daytab${i === 0 ? ' on' : ''}" data-go="${esc(d.day)}" type="button">${esc(d.day)}<small>${d.coachPresent ? '在席' : '不在'}</small></button>`,
    )
    .join('');
  const dayPanels = data.days.map((d, i) => dayPanel(data, d, i)).join('\n');

  return {
    css: PATTERN_CSS,
    body: `
    <h1 style="font-size:clamp(20px,3.4vw,26px);font-weight:700;letter-spacing:-.01em;margin:0 0 4px">${esc(data.school)}　練習ボード</h1>
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
      ${dayPanels}
    </div>

    <div class="level" data-level="week" hidden>${weekLevel(data)}</div>
    <div class="level" data-level="month" hidden>${monthSection(data)}${goalsSection(data)}</div>
    <div class="level" data-level="year" hidden>${yearSection(data)}${assumptionsNote(data)}</div>
    `,
  };
}
