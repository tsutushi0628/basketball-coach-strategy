/**
 * @file パターン1「配布プリント」— しんたろうさんのGoogle Doc練習メニューに忠実な縦型配布物。
 *
 * 4レベル（日/週/月/年）をタブで切替。主役は「日」: 目標3段（今月/今週/本日）→ 時間ブロック
 * （HH:MM〜の範囲見出し＋ドリル＋いずれか＋給水）→ ダウン/ミーティング。印刷=紙の配布物。
 * 月レベルに KGI/KPI/定性 のフル目標＋月内4週、年レベルにフェーズ帯（依存線なしの期間帯）。
 */

import { esc, modeTag, altLine, videoLink, goalsCard, rotationTable, plainText } from './render-shared.mjs';

/** 日次配布物の目標3段（今月/今週/本日）。 */
function dayGoalHeader(data, d) {
  const g = data.goals;
  return `<div class="hgoals">
    <div class="hg"><span class="hl">今月の目標</span><span class="ht">${esc(g.monthMain)}${g.monthKpi ? `<span class="hk">（${esc(g.monthKpi)}）</span>` : ''}</span></div>
    <div class="hg"><span class="hl">今週の目標</span><span class="ht">${esc(g.week)}</span></div>
    <div class="hg hg-aim"><span class="hl">本日の狙い</span><span class="ht">${esc(d.aim)}</span></div>
  </div>`;
}

/** 1ブロック（時間範囲見出し＋ドリル）。 */
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
    <h3 class="hbh"><span class="hbr">${esc(b.from)}〜${esc(b.to)}</span><span class="hbn">${esc(b.label)}</span><span class="hbm">${b.minutes}分</span></h3>
    <ul class="drows">${items}${water}</ul>
  </section>`;
}

/** 1日ぶんの配布物（印刷で1ページ）。 */
function dayDoc(data, d, idx) {
  const t = data.team;
  return `<article class="day pageb" data-day="${esc(d.day)}"${idx === 0 ? '' : ' hidden'}>
    <h2 class="htitle">${esc(t.label)}　${t.month}月 ${esc(d.dayLabel)}（${esc(d.court)}）<span class="htime">${esc(d.start)}〜${esc(d.end)}</span></h2>
    <p class="hsub">練習メニュー　／　計 ${d.totalMinutes}分${d.coachPresent ? '' : '　・コーチ不在日（各自で自走）'}</p>
    ${dayGoalHeader(data, d)}
    <div class="hmenu">${d.blocks.map(blockSection).join('')}
      <section class="hblock hend"><h3 class="hbh"><span class="hbr">${esc(d.end)}〜</span><span class="hbn">ダウン／ミーティング</span></h3><p class="endn">今日の振り返りと、次に向けてのひとこと。</p></section>
    </div>
    <pre class="plain" hidden>${esc(plainText(data, d))}</pre>
  </article>`;
}

/** 週レベル: 全日をコンパクトに並べ、ローテ表を添える。 */
function weekLevel(data) {
  const cards = data.week
    .map((d) => {
      const chips = d.blocks
        .filter((b) => !b.isBundle)
        .map((b) => `<span class="wchip" style="--t:${tint(b.block)}">${esc(b.label)} ${b.minutes}分</span>`)
        .join('');
      return `<div class="wcard">
        <div class="wch"><span class="wd">${esc(d.dayLabel)}</span><span class="wmeta">${esc(d.court)}・${esc(d.start)}〜${esc(d.end)}・${d.coachPresent ? '在席' : '不在'}</span></div>
        <div class="wchips">${chips || '<span class="wmeta">—</span>'}</div>
        <div class="waim">${esc(d.aim)}</div>
      </div>`;
    })
    .join('');
  return `<div class="weekgrid">${cards}</div>${rotationTable(data.rotationTable, data.team.groups)}`;
}

const TINTS = { 技術: 'var(--orange)', 対人: 'var(--terra)', ゲーム: 'var(--gold)' };
const tint = (b) => TINTS[b] || 'var(--mute)';

/** 月レベル: フル目標（KGI/KPI/定性）＋ 月内4週の足場。 */
function monthLevel(data) {
  const weeks = data.monthWeeks
    .map(
      (w) => `<div class="mweek${w.current ? ' on' : ''}">
        <div class="mwk">${esc(w.label)}${w.current ? '<span class="now">今週</span>' : ''}</div>
        <div class="mwt">${esc(w.theme)}</div>
        <div class="mwn">${esc(w.note)}</div>
      </div>`,
    )
    .join('');
  return `${goalsCard(data.goals)}
    <h3 class="lvh">${data.team.month}月の流れ（週ごとの重点）</h3>
    <div class="mweeks">${weeks}</div>
    <p class="note">月内の週配分は仮置き（当週のみエンジンの実データ）。大会日程が決まり次第、ピーキングに合わせて差し替えます。</p>`;
}

/** 年レベル: フェーズ帯（依存線なしの期間帯）。 */
function yearLevel(data) {
  const bands = data.year
    .map((b) => {
      const span = b.months.length;
      return `<div class="yband${b.current ? ' on' : ''}${b.peak ? ' peak' : ''}" style="flex:${span}">
        <div class="ym">${b.months[0]}〜${b.months[b.months.length - 1]}月</div>
        <div class="yp">${esc(b.phase)}${b.peak ? '<span class="pk">ピーク</span>' : ''}${b.current ? '<span class="now">今</span>' : ''}</div>
        <div class="yf">${esc(b.focus)}</div>
      </div>`;
    })
    .join('');
  return `<h3 class="lvh">年間フェーズ（2つのピーク：夏の大会／新人大会）</h3>
    <div class="ybands">${bands}</div>
    <p class="note">年間は「夏の大会（現チーム）」と「新人大会（新チーム）」の2つの山で設計。帯は期間の重み付けで、タスク依存の線は引かない（計画は毎週流動するため）。</p>`;
}

const PATTERN_CSS = `
.htitle{font-size:clamp(19px,3.4vw,23px);font-weight:700;letter-spacing:-.01em;line-height:1.45}
.htime{color:var(--orange-deep);font-weight:700;margin-left:6px}
.hsub{font-size:13px;color:var(--mute);margin:4px 0 16px}
.hgoals{background:var(--surface);border-radius:22px;box-shadow:var(--shadow);padding:18px 22px;margin-bottom:16px}
.hg{display:flex;gap:14px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--line)}
.hg:last-child{border-bottom:none}
.hl{flex:0 0 84px;font-size:11px;letter-spacing:.08em;color:var(--orange-deep);font-weight:700;padding-top:3px}
.ht{font-size:16px;line-height:1.55}
.hk{color:var(--mute);font-size:13px}
.hg-aim .ht{font-weight:700;font-size:17px}
.hmenu{margin-top:4px}
.hblock{background:var(--surface);border-radius:18px;box-shadow:var(--shadow-soft);padding:13px 18px;margin-bottom:11px}
.hbh{display:flex;align-items:baseline;gap:12px;margin-bottom:5px}
.hbr{font-size:15px;font-weight:700;color:var(--ink)}
.hbn{font-size:13px;color:var(--mute)}
.hbm{margin-left:auto;font-size:12px;color:var(--mute)}
.drows{list-style:none}
.drow{display:flex;align-items:flex-start;gap:11px;padding:7px 0;border-bottom:1px solid var(--line)}
.drows>li:last-child{border-bottom:none}
.dn{flex:1;font-size:15px;min-width:0}
.dm{flex:0 0 auto;font-size:12px;color:var(--mute);padding-top:2px}
.water .dn{color:var(--mute);font-size:14px}
.hend .endn{font-size:14px;color:var(--mute);padding-top:3px}
.lvh{font-size:14px;color:var(--orange-deep);font-weight:700;margin:18px 2px 12px}

.weekgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
.wcard{background:var(--surface);border-radius:18px;box-shadow:var(--shadow-soft);padding:15px 17px}
.wch{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:9px}
.wd{font-size:17px;font-weight:700}
.wmeta{font-size:11px;color:var(--mute)}
.wchips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:9px}
.wchip{font-size:12px;border-radius:999px;padding:4px 11px;background:var(--bg);color:var(--ink);box-shadow:var(--inset)}
.wchip::before{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--t);margin-right:6px;vertical-align:middle}
.waim{font-size:13px;color:var(--mute);line-height:1.55}

.mweeks{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:11px}
.mweek{background:var(--surface);border-radius:16px;box-shadow:var(--shadow-soft);padding:14px 16px}
.mweek.on{box-shadow:var(--shadow)}
.mwk{font-size:13px;font-weight:700;display:flex;align-items:center;gap:8px;margin-bottom:6px}
.now{font-size:10px;background:var(--orange);color:var(--orange-ink);border-radius:999px;padding:2px 8px}
.mwt{font-size:14px;line-height:1.5;margin-bottom:4px}
.mwn{font-size:12px;color:var(--mute)}

.ybands{display:flex;gap:8px;align-items:stretch}
.yband{background:var(--surface);border-radius:16px;box-shadow:var(--shadow-soft);padding:14px 14px;min-width:0;display:flex;flex-direction:column;gap:4px}
.yband.on{box-shadow:var(--shadow)}
.yband.peak{background:var(--orange-soft)}
.ym{font-size:11px;color:var(--mute)}
.yp{font-size:14px;font-weight:700;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.pk{font-size:10px;background:var(--orange-deep);color:var(--orange-ink);border-radius:999px;padding:2px 7px}
.yf{font-size:12px;color:var(--mute);line-height:1.5}
@media (max-width:640px){.ybands{flex-wrap:wrap}.yband{flex-basis:46%!important}}
`;

export const meta = { id: 'handout', name: '配布プリント', tagline: 'しんたろうさんのDocに忠実な縦型・印刷向き' };

export function render(data) {
  const dayTabs = data.week
    .map(
      (d, i) => `<button class="daytab${i === 0 ? ' on' : ''}" data-go="${esc(d.day)}" type="button">${esc(d.day)}<small>${d.coachPresent ? '在席' : '不在'}</small></button>`,
    )
    .join('');
  const dayDocs = data.week.map((d, i) => dayDoc(data, d, i)).join('\n');

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
      ${dayDocs}
    </div>

    <div class="level" data-level="week" hidden>${weekLevel(data)}</div>
    <div class="level" data-level="month" hidden>${monthLevel(data)}</div>
    <div class="level" data-level="year" hidden>${yearLevel(data)}</div>
    `,
  };
}
