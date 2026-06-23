/**
 * @file 年間計画（原典 docs/practice-knowledge/sessions/年間計画.md）の月別構造を
 * エンジン入力へ解決する純関数群。年/月/フェーズ・カテゴリ重みを「でっち上げ」ではなく
 * 原典 (engine/data/annual-plan.json) から決定論的に引く。
 *
 * モデル: 新チームの12ヶ月アーク（夏発足→冬の新人大会→翌夏の中体連）。山は2つ。
 * 男女ズレ: 男子＝基準（8月始動）、女子＝約1ヶ月先行（7月始動）＝同じ暦月で1ヶ月進む。
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 新チームの年間サイクルの月並び（夏発足＝8月始まり）。リボン描画の順序。 */
export const ARC_ORDER = [8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7];

/** 男女の先行ぶん（月）。女子は約1ヶ月先行＝アークを1つ進めて引く。 */
export const GENDER_OFFSET_MONTHS = { 男子: 0, 女子: 1 };

/**
 * annual-plan.json を読む。
 * @param {string} [path]
 * @returns {Promise<object>}
 */
export async function loadAnnualPlan(path) {
  const p = path || resolve(__dirname, '../data/annual-plan.json');
  return JSON.parse(await readFile(p, 'utf8'));
}

/** 1始まりの月を 1..12 に正規化（13→1 等）。 */
export function wrapMonth(m) {
  return ((((m - 1) % 12) + 12) % 12) + 1;
}

/**
 * 暦月をアーク月へ写す。
 *
 * 新チーム始動運用（annual.new_team_start_month が設定されているとき・確定運用）:
 *   男女とも new_team_start_month（=7）を準備始動アーク（ARC_ORDER の先頭=8）に合わせる。
 *   女子の1ヶ月先行offsetは新チーム計画では使わない（始動プラン.md と整合）。
 *   例 start=7: 暦7月→アーク8（準備始動）, 暦8月→アーク9（積み上げ）, …。
 *
 * 旧運用（new_team_start_month 未設定）:
 *   男子＝暦月そのまま、女子＝1ヶ月先行（GENDER_OFFSET_MONTHS）。
 *
 * @param {object} annual
 * @param {string} gender
 * @param {number} calendarMonth 1-12
 * @returns {number} アーク月 1-12
 */
function arcMonthOf(annual, gender, calendarMonth) {
  const start = annual?.new_team_start_month;
  if (Number.isFinite(start)) {
    // 男女とも始動月を ARC_ORDER の先頭に合わせる（offset不使用）。
    const arcStart = ARC_ORDER[0]; // 8 = 準備始動
    return wrapMonth(calendarMonth - start + arcStart);
  }
  const offset = GENDER_OFFSET_MONTHS[gender] ?? 0;
  return wrapMonth(calendarMonth + offset);
}

/**
 * 性別＋暦月から、その日に出すべき月別エントリ（フェーズ・重み・主眼・KPI・山）を解決する。
 * 新チーム始動運用では男女とも始動月（7月）を準備始動アークに合わせて引く（表示の暦月は calendarMonth のまま）。
 *
 * @param {object} annual  loadAnnualPlan() の結果
 * @param {string} gender  "男子" | "女子"
 * @param {number} calendarMonth 1-12（実際の暦月）
 * @returns {{ displayMonth:number, arcMonth:number, phase:string, headline:string,
 *   focus_weights:Object<string,number>, kpi_hints:string[], peak:(string|null), peak_level:number }}
 */
export function resolveMonth(annual, gender, calendarMonth) {
  const arcMonth = arcMonthOf(annual, gender, calendarMonth);
  const entry = annual.months[String(arcMonth)];
  if (!entry) throw new Error(`annual-plan: month ${arcMonth} 未定義`);
  return {
    displayMonth: wrapMonth(calendarMonth),
    arcMonth,
    phase: entry.phase,
    headline: entry.headline,
    focus_weights: entry.focus_weights,
    kpi_hints: entry.kpi_hints || [],
    peak: entry.peak ?? null,
    peak_level: entry.peak_level ?? 0,
  };
}

/**
 * 月の主眼を週に割った「週の焦点」を決定論で解決する（新方針1・上から降ろす層）。
 *
 * 当月（アーク）entry の weekly_focus 配列から weekOfMonth に該当する焦点を1本引く。
 * weekly_focus の week は数値（その週ぴったり）か "2-4"（範囲・両端含む）。
 * 準備期(7〜9月＝アーク8〜9)だけ weekly_focus を定義し、未定義の月は『月の主眼＝週の焦点（週割りなし）』を
 * フォールバックで返す（headline をそのまま週の焦点に使い、mastery_bias なし・allow_scrimmage は試合期/積み上げで真）。
 *
 * 返り値は allocate へ降ろす週の焦点:
 *   - headline: 今週の焦点文（goals.week・focus_summary の真実源）
 *   - mastery_bias: 今週に優先する習熟段階（教育的フィット選定の並べ替え軸）。空配列なら段階バイアスなし。
 *   - allow_scrimmage: 対人ブロック末尾に5on5（スクリメージ）を解禁するか。
 *
 * @param {object} annual
 * @param {string} gender "男子" | "女子"
 * @param {number} calendarMonth 1-12
 * @param {number} weekOfMonth 月内の第何週か（1始まり・既定1）
 * @returns {{ headline:string, mastery_bias:string[], allow_scrimmage:boolean, week:number, arcMonth:number }}
 */
export function resolveWeekFocus(annual, gender, calendarMonth, weekOfMonth = 1) {
  const arcMonth = arcMonthOf(annual, gender, calendarMonth);
  const entry = annual.months[String(arcMonth)];
  if (!entry) throw new Error(`annual-plan: month ${arcMonth} 未定義`);
  const week = Number.isFinite(weekOfMonth) && weekOfMonth >= 1 ? Math.floor(weekOfMonth) : 1;

  const wf = Array.isArray(entry.weekly_focus) ? entry.weekly_focus : [];
  const matched = wf.find((f) => weekInSpec(week, f.week));
  if (matched) {
    return {
      headline: matched.headline,
      mastery_bias: Array.isArray(matched.mastery_bias) ? matched.mastery_bias : [],
      allow_scrimmage: matched.allow_scrimmage === true,
      week,
      arcMonth,
    };
  }

  // フォールバック: 月の主眼＝週の焦点（週割りなし）。試合期/積み上げ系は5on5解禁、
  // 準備立ち上げ系（始動）はフォールバックに来ないが安全側で解禁しない。
  const installPhase = /始動|再編成|移行/.test(entry.phase || '');
  return {
    headline: entry.headline,
    mastery_bias: [],
    allow_scrimmage: !installPhase,
    week,
    arcMonth,
  };
}

/**
 * 週番号が weekly_focus の week 指定に該当するか。
 * 指定は数値（その週）か "a-b"（範囲・両端含む）。
 * @param {number} week
 * @param {number|string} spec
 * @returns {boolean}
 */
function weekInSpec(week, spec) {
  if (typeof spec === 'number') return week === spec;
  const s = String(spec);
  const m = /^(\d+)\s*-\s*(\d+)$/.exec(s);
  if (m) return week >= Number(m[1]) && week <= Number(m[2]);
  const n = Number(s);
  return Number.isFinite(n) && week === n;
}

/**
 * 年リボン用の新チーム12ヶ月アーク。各月の暦・フェーズ・山・「今」マークを返す。
 * 「今」は性別ごとに解決した arcMonth に立てる（男女で1ヶ月ズレるのが原典どおり）。
 *
 * @param {object} annual
 * @param {string} gender
 * @param {number} calendarMonth 現在の暦月
 * @returns {Array<{ month:number, phase:string, headline:string, peak:(string|null),
 *   peak_level:number, current:boolean }>}
 */
export function yearArc(annual, gender, calendarMonth) {
  const now = resolveMonth(annual, gender, calendarMonth).arcMonth;
  return ARC_ORDER.map((m) => {
    const e = annual.months[String(m)];
    return {
      month: m,
      phase: e.phase,
      headline: e.headline,
      peak: e.peak ?? null,
      peak_level: e.peak_level ?? 0,
      current: m === now,
    };
  });
}

/**
 * 山（ピーク）の定義をそのまま返す（リボン凡例用）。
 * @param {object} annual
 * @returns {Array<{key:string,label:string,months:number[]}>}
 */
export function peaks(annual) {
  return annual.peaks || [];
}
