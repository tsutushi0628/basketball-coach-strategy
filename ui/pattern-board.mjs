/**
 * @file パターン2「週間ボード」— カレンダー・グリッド型（週起点）。
 *
 * 配布プリント（縦型文書）とは別マクロ構造。主役は「週」: 火〜土の5列ボードで、各列に段チップを
 * 縦スタック（BLOCK_TINTで色分け＋分数）し、列頭に日合計と在席/不在を出す。下に組違いローテを大きく。
 * 日レベルは段の「横の積み上げ比率バー」（各段の幅＝分数）＋詳細リスト。月は4週カレンダーグリッド、
 * 年は2ピークを明示した横タイムライン・リボン。色・装飾は render-shared のトークンのみ。
 */

import { esc, modeTag, altLine, videoLink, goalsCard, rotationTable, plainText, BLOCK_TINT } from './render-shared.mjs';

const tint = (block) => BLOCK_TINT[block] || 'var(--mute)';

// ── 週レベル（主役）: 5列ボード ────────────────────────────────────────────
/** 1日ぶんのボード列（段チップの縦スタック＋日合計＋在席）。 */
function boardColumn(d) {
  const chips = d.blocks
    .map(
      (b) => `<div class="bchip" style="--t:${tint(b.block)}">
        <span class="bcl">${esc(b.label)}</span>
        <span class="bcm">${b.minutes}分</span>
      </div>`,
    )
    .join('');
  return `<div class="bcol">
    <div class="bch">
      <span class="bcd">${esc(d.day)}</span>
      <span class="bcs ${d.coachPresent ? 'on' : 'off'}">${d.coachPresent ? '在席' : '不在'}</span>
    </div>
    <div class="bct">${esc(d.court)}・${esc(d.start)}〜${esc(d.end)}</div>
    <div class="bstack">${chips || '<div class="bempty">—</div>'}</div>
    <div class="bcf">計 ${d.totalMinutes}分</div>
  </div>`;
}

/** 週レベル: 5列ボード ＋ 大きな組違いローテ。 */
function weekLevel(data) {
  const cols = data.week.map(boardColumn).join('');
  return `<h3 class="lvh">${data.team.month}月 今週のボード（${esc(data.team.label)}）</h3>
    <div class="board">${cols}</div>
    <p class="note">列＝曜日、ブロックの高さは段の分数。色は段の種別（ウォームアップ／技術／対人／ゲーム形式／ダウン）。詳細は「日」タブで。</p>
    ${rotationTable(data.rotationTable, data.team.groups)}`;
}

// ── 日レベル: 横の積み上げ比率バー ＋ 詳細リスト ──────────────────────────
/** その日の段を横幅＝分数の比率バーで示す。 */
function ratioBar(d) {
  const segs = d.blocks
    .map(
      (b) => `<div class="rseg" style="flex:${b.minutes};--t:${tint(b.block)}" title="${esc(b.label)} ${b.minutes}分">
        <span class="rsl">${esc(b.label)}</span>
        <span class="rsm">${b.minutes}分</span>
      </div>`,
    )
    .join('');
  return `<div class="ratiobar">${segs}</div>`;
}

/** 1段ぶんの詳細（種別ドット＋時間範囲＋ドリル）。 */
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
      <span class="dbdot" style="--t:${tint(b.block)}"></span>
      <span class="dbn">${esc(b.label)}</span>
      <span class="dbr">${esc(b.from)}〜${esc(b.to)}</span>
      <span class="dbm">${b.minutes}分</span>
    </div>
    <ul class="ditems">${rows}</ul>
  </section>`;
}

/** 1日ぶんの詳細パネル（本日の狙い→比率バー→段リスト）。 */
function dayPanel(data, d, idx) {
  const t = data.team;
  return `<article class="day" data-day="${esc(d.day)}"${idx === 0 ? '' : ' hidden'}>
    <div class="dtop">
      <h2 class="dtitle">${esc(t.label)}　${t.month}月 ${esc(d.dayLabel)}<span class="dcourt">${esc(d.court)}・${esc(d.start)}〜${esc(d.end)}</span></h2>
      <div class="daim"><span class="dal">本日の狙い</span><span class="dat">${esc(d.aim)}</span></div>
    </div>
    ${ratioBar(d)}
    <div class="dlist">${d.blocks.map(detailBlock).join('')}</div>
    <pre class="plain" hidden>${esc(plainText(data, d))}</pre>
  </article>`;
}

// ── 月レベル: 4週カレンダーグリッド ＋ 目標 ──────────────────────────────
function monthLevel(data) {
  const cells = data.monthWeeks
    .map(
      (w) => `<div class="mcell${w.current ? ' on' : ''}">
        <div class="mch"><span class="mck">${esc(w.label)}</span>${w.current ? '<span class="now">今週</span>' : ''}</div>
        <div class="mct">${esc(w.theme)}</div>
        <div class="mcn">${esc(w.note)}</div>
      </div>`,
    )
    .join('');
  return `<h3 class="lvh">${data.team.month}月のカレンダー（週ごとの重点）</h3>
    <div class="mgrid">${cells}</div>
    <p class="note">月内の週配分は仮置き（当週のみエンジンの実データ）。大会日程が決まり次第、ピーキングに合わせて差し替えます。</p>
    ${goalsCard(data.goals)}`;
}

// ── 年レベル: 横タイムライン・リボン（2ピーク明示）────────────────────────
function yearLevel(data) {
  const bands = data.year
    .map(
      (b) => `<div class="yband${b.current ? ' on' : ''}${b.peak ? ' peak' : ''}" style="flex:${b.months.length}">
        <div class="ym">${b.months[0]}〜${b.months[b.months.length - 1]}月</div>
        <div class="yp">${esc(b.phase)}${b.peak ? '<span class="pk">ピーク</span>' : ''}${b.current ? '<span class="now">今</span>' : ''}</div>
        <div class="yf">${esc(b.focus)}</div>
      </div>`,
    )
    .join('');
  return `<h3 class="lvh">年間タイムライン（2つの山：夏の大会／新人大会）</h3>
    <div class="yribbon">${bands}</div>
    <p class="note">年間は「夏の大会（現チーム）」と「新人大会（新チーム）」の2つの山で設計。リボンの幅は期間の長さ。タスク依存の線は引かない（計画は毎週流動するため）。</p>`;
}

const PATTERN_CSS = `
.lvh{font-size:14px;color:var(--orange-deep);font-weight:700;margin:6px 2px 12px}

/* 週: 5列ボード */
.board{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;align-items:start}
.bcol{background:var(--surface);border-radius:18px;box-shadow:var(--shadow-soft);padding:13px 12px}
.bch{display:flex;align-items:center;justify-content:space-between;margin-bottom:3px}
.bcd{font-size:17px;font-weight:700}
.bcs{font-size:10px;border-radius:999px;padding:2px 8px;white-space:nowrap}
.bcs.on{background:var(--orange);color:var(--orange-ink)}
.bcs.off{background:var(--bg);color:var(--mute);box-shadow:var(--inset)}
.bct{font-size:10px;color:var(--mute);margin-bottom:10px}
.bstack{display:flex;flex-direction:column;gap:6px}
.bchip{background:var(--bg);border-radius:12px;padding:8px 11px;box-shadow:var(--inset);display:flex;align-items:center;gap:7px}
.bchip::before{content:"";flex:0 0 auto;width:8px;height:8px;border-radius:50%;background:var(--t)}
.bcl{flex:1;font-size:12px;line-height:1.3;min-width:0}
.bcm{flex:0 0 auto;font-size:11px;color:var(--mute)}
.bempty{font-size:12px;color:var(--mute);text-align:center;padding:8px 0}
.bcf{margin-top:11px;font-size:12px;color:var(--orange-deep);font-weight:700;text-align:right}

/* 日: 横の積み上げ比率バー */
.dtop{background:var(--surface);border-radius:20px;box-shadow:var(--shadow);padding:17px 21px;margin-bottom:14px}
.dtitle{font-size:clamp(18px,3.2vw,22px);font-weight:700;letter-spacing:-.01em;line-height:1.45}
.dcourt{color:var(--orange-deep);font-weight:700;font-size:14px;margin-left:8px}
.daim{display:flex;gap:13px;align-items:baseline;margin-top:11px;padding-top:11px;border-top-width:1px;border-top-style:solid;border-top-color:var(--line)}
.dal{flex:0 0 64px;font-size:11px;letter-spacing:.08em;color:var(--orange-deep);font-weight:700}
.dat{font-size:16px;font-weight:700;line-height:1.5}
.ratiobar{display:flex;gap:5px;height:62px;margin-bottom:16px}
.rseg{background:var(--surface);border-radius:13px;box-shadow:var(--shadow-soft);padding:9px 11px;display:flex;flex-direction:column;justify-content:center;gap:2px;min-width:0;overflow:hidden}
.rseg::before{content:"";display:block;width:22px;height:4px;border-radius:999px;background:var(--t);margin-bottom:4px}
.rsl{font-size:12px;font-weight:600;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rsm{font-size:11px;color:var(--mute)}
.dlist{display:flex;flex-direction:column;gap:11px}
.dblock{background:var(--surface);border-radius:16px;box-shadow:var(--shadow-soft);padding:13px 18px}
.dbh{display:flex;align-items:center;gap:9px;margin-bottom:6px}
.dbdot{flex:0 0 auto;width:9px;height:9px;border-radius:50%;background:var(--t)}
.dbn{font-size:14px;font-weight:700}
.dbr{font-size:12px;color:var(--mute)}
.dbm{margin-left:auto;font-size:12px;color:var(--mute)}
.ditems{list-style:none}
.ditem{display:flex;align-items:flex-start;gap:11px;padding:7px 0;border-bottom:1px solid var(--line)}
.ditems>li:last-child{border-bottom:none}
.din{flex:1;font-size:15px;min-width:0}
.dim{flex:0 0 auto;font-size:12px;color:var(--mute);padding-top:2px}

/* 月: 4週カレンダーグリッド */
.mgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:11px;margin-bottom:14px}
.mcell{background:var(--surface);border-radius:16px;box-shadow:var(--shadow-soft);padding:14px 16px;min-height:118px}
.mcell.on{box-shadow:var(--shadow)}
.mch{display:flex;align-items:center;gap:8px;margin-bottom:7px}
.mck{font-size:13px;font-weight:700}
.now{font-size:10px;background:var(--orange);color:var(--orange-ink);border-radius:999px;padding:2px 8px}
.mct{font-size:14px;line-height:1.5;margin-bottom:5px}
.mcn{font-size:12px;color:var(--mute)}

/* 年: 横タイムライン・リボン */
.yribbon{display:flex;gap:7px;align-items:stretch;margin-bottom:14px}
.yband{background:var(--surface);border-radius:15px;box-shadow:var(--shadow-soft);padding:13px 13px;min-width:0;display:flex;flex-direction:column;gap:4px}
.yband.on{box-shadow:var(--shadow)}
.yband.peak{background:var(--orange-soft)}
.ym{font-size:11px;color:var(--mute)}
.yp{font-size:13px;font-weight:700;display:flex;align-items:center;gap:6px;flex-wrap:wrap;line-height:1.35}
.pk{font-size:10px;background:var(--orange-deep);color:var(--orange-ink);border-radius:999px;padding:2px 7px}
.yf{font-size:12px;color:var(--mute);line-height:1.5}

@media (max-width:680px){
  .board{grid-template-columns:repeat(2,1fr)}
  .yribbon{flex-wrap:wrap}.yband{flex-basis:46%!important}
}
@media (max-width:460px){.board{grid-template-columns:1fr}.ratiobar{height:auto;flex-direction:column}.rseg{flex:none!important}}
`;

export const meta = { id: 'board', name: '週間ボード', tagline: '週を5列ボードで俯瞰・日は積み上げバー' };

export function render(data) {
  const dayTabs = data.week
    .map(
      (d, i) => `<button class="daytab${i === 0 ? ' on' : ''}" data-go="${esc(d.day)}" type="button">${esc(d.day)}<small>${d.coachPresent ? '在席' : '不在'}</small></button>`,
    )
    .join('');
  const dayPanels = data.week.map((d, i) => dayPanel(data, d, i)).join('\n');

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
      ${dayPanels}
    </div>

    <div class="level" data-level="week" hidden>${weekLevel(data)}</div>
    <div class="level" data-level="month" hidden>${monthLevel(data)}</div>
    <div class="level" data-level="year" hidden>${yearLevel(data)}</div>
    `,
  };
}
