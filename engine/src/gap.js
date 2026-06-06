/**
 * @file Deterministic gap → weight computation.
 *
 * Turns measured indicators (TeamInput) into per-category emphasis (finalWeights)
 * by combining the phase's base category weights with a "how far from target"
 * gap signal. Categories where the team is furthest from target get more time.
 *
 * This is pure arithmetic — no LLM, no I/O. The indicator→category mapping is a
 * fixed table held here as the single source of truth (DESIGN.md §2).
 *
 * @typedef {import('./types.js').Config} Config
 * @typedef {import('./types.js').TeamInput} TeamInput
 * @typedef {import('./types.js').Indicator} Indicator
 */

/** Weight given to the gap signal relative to the phase base weights. */
export const GAP_ALPHA = 1.0;

/**
 * Spec #1 fallback main-focus category, used only when both the gap signal and
 * the phase base weights are empty/degenerate. ファンダメンタル基礎 is present in
 * every team's catalog, so the main-focus gate still has a real target to assert.
 */
export const DEFAULT_MAIN_FOCUS = 'ファンダメンタル基礎';

/**
 * Indicator id → mapped categories (with per-category split weights).
 * `ft_only: true` means the emphasis should be honored by selecting only
 * free-throw drills (name/sub_skill match) when filling the シュート category.
 *
 * @type {Object<string, Array<{category: string, w: number, ft_only?: boolean}>>}
 */
export const METRIC_TO_CATEGORY = {
  'FT率': [{ category: 'シュート', ft_only: true, w: 1.0 }],
  '試合TO': [
    { category: 'ハンドリング/ドリブル', w: 0.4 },
    { category: 'パス&スペーシング', w: 0.3 },
    { category: '意思決定/ゲーム形式', w: 0.3 },
  ],
  'ゴール下成功率': [{ category: 'フィニッシュ(ゴール下/レイアップ)', w: 1.0 }],
};

/** clamp(x, 0, 1) */
function clamp01(x) {
  return Math.min(1, Math.max(0, x));
}

/**
 * Fraction of remaining distance still to cover (1 = no progress, 0 = at/past target).
 * Direction-aware. Zero-distance baseline→target collapses to 0 (no signal).
 *
 * @param {Indicator} ind
 * @returns {number} in [0,1]
 */
export function gapRatio(ind) {
  const { good_direction, baseline, latest, target } = ind;
  // NaN-resilience (spec #1): if any of baseline/latest/target is non-finite
  // (undefined/null/NaN/Infinity), this indicator carries no usable signal.
  // Return 0 so it contributes nothing instead of poisoning gapWeights with NaN.
  if (!Number.isFinite(baseline) || !Number.isFinite(latest) || !Number.isFinite(target)) {
    return 0;
  }
  if (good_direction === 'up') {
    const denom = target - baseline;
    if (denom === 0) return 0;
    return clamp01((target - latest) / denom);
  }
  // good_direction === 'down'
  const denom = baseline - target;
  if (denom === 0) return 0;
  return clamp01((latest - target) / denom);
}

/**
 * Accumulate per-category gap weight = Σ gapRatio(indicator) × split-weight.
 * Categories whose mapping carries ft_only are flagged so downstream selection
 * can prefer free-throw drills.
 *
 * @param {TeamInput} teamInput
 * @returns {{ gapWeights: Object<string, number>, ftOnlyCategories: Set<string> }}
 */
export function computeGapWeights(teamInput) {
  /** @type {Object<string, number>} */
  const gapWeights = {};
  /** @type {Set<string>} */
  const ftOnlyCategories = new Set();

  for (const ind of teamInput.indicators ?? []) {
    const mapping = METRIC_TO_CATEGORY[ind.id];
    if (!mapping) continue; // unknown indicator → no contribution (forward-compatible)
    // Spec #1: an indicator whose baseline/latest/target are not all finite is a
    // no-signal indicator — skip it entirely so it neither contributes weight nor
    // flags an ft_only category, and never lets a NaN reach gapWeights downstream.
    if (
      !Number.isFinite(ind.baseline) ||
      !Number.isFinite(ind.latest) ||
      !Number.isFinite(ind.target)
    ) {
      continue;
    }
    const ratio = gapRatio(ind);
    if (!Number.isFinite(ratio)) continue; // defensive: never propagate NaN
    for (const { category, w, ft_only } of mapping) {
      gapWeights[category] = (gapWeights[category] ?? 0) + ratio * w;
      if (ft_only) ftOnlyCategories.add(category);
    }
  }
  return { gapWeights, ftOnlyCategories };
}

/**
 * Normalize a category→number map so its values sum to 1. Empty / all-zero
 * input returns an empty object (caller decides fallback).
 *
 * @param {Object<string, number>} weights
 * @returns {Object<string, number>}
 */
export function normalizeWeights(weights) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  // Spec #1: fall back to empty only on a usable-sum failure. `total <= 0` alone
  // misses NaN (NaN<=0 is false), which would divide every entry into NaN. Require
  // the sum to be finite AND positive; otherwise return {} and let the caller
  // (computeFinalWeights) apply its phase-weight fallback.
  if (!Number.isFinite(total) || total <= 0) return {};
  /** @type {Object<string, number>} */
  const out = {};
  for (const [k, v] of Object.entries(weights)) out[k] = v / total;
  return out;
}

/**
 * Combine phase base weights with the gap signal and normalize to sum 1.
 * Category set = union of phase keys and gap keys (so gap-only categories like
 * パス&スペーシング survive). Missing phase entries are 0-filled.
 *
 * @param {Config} config
 * @param {TeamInput} teamInput
 * @returns {{
 *   finalWeights: Object<string, number>,
 *   gapWeights: Object<string, number>,
 *   ftOnlyCategories: Set<string>,
 *   mainFocus: string
 * }}
 */
export function computeFinalWeights(config, teamInput) {
  const phase = config.phase_category_weights ?? {};
  const { gapWeights, ftOnlyCategories } = computeGapWeights(teamInput);

  const categories = new Set([...Object.keys(phase), ...Object.keys(gapWeights)]);
  /** @type {Object<string, number>} */
  const combined = {};
  for (const c of categories) {
    combined[c] = (phase[c] ?? 0) + GAP_ALPHA * (gapWeights[c] ?? 0);
  }
  const finalWeights = normalizeWeights(combined);

  // Highest-weight category = the macrocycle's main focus (gate target).
  let mainFocus = '';
  let max = -Infinity;
  for (const [c, w] of Object.entries(finalWeights)) {
    if (w > max) {
      max = w;
      mainFocus = c;
    }
  }

  // Spec #1: when finalWeights is empty (all inputs were no-signal / NaN, so
  // normalizeWeights returned {}), mainFocus would be "" and assertMainFocusPresent
  // would silently no-op — disabling the "main focus appears each week" guarantee.
  // Fall back to the phase's heaviest base category so the gate stays meaningful;
  // if even the phase map is empty, fall back to a safe default category.
  if (!mainFocus) {
    let phaseMax = -Infinity;
    for (const [c, w] of Object.entries(phase)) {
      if (Number.isFinite(w) && w > phaseMax) {
        phaseMax = w;
        mainFocus = c;
      }
    }
    if (!mainFocus) mainFocus = DEFAULT_MAIN_FOCUS;
  }

  return { finalWeights, gapWeights, ftOnlyCategories, mainFocus };
}
