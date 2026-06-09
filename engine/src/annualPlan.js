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
function wrapMonth(m) {
  return ((((m - 1) % 12) + 12) % 12) + 1;
}

/**
 * 性別＋暦月から、その日に出すべき月別エントリ（フェーズ・重み・主眼・KPI・山）を解決する。
 * 女子は先行ぶんアークを進めて引く（表示の暦月は calendarMonth のまま）。
 *
 * @param {object} annual  loadAnnualPlan() の結果
 * @param {string} gender  "男子" | "女子"
 * @param {number} calendarMonth 1-12（実際の暦月）
 * @returns {{ displayMonth:number, arcMonth:number, phase:string, headline:string,
 *   focus_weights:Object<string,number>, kpi_hints:string[], peak:(string|null), peak_level:number }}
 */
export function resolveMonth(annual, gender, calendarMonth) {
  const offset = GENDER_OFFSET_MONTHS[gender] ?? 0;
  const arcMonth = wrapMonth(calendarMonth + offset);
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
