/**
 * @file Deterministic per-day SEGMENT allocation (DESIGN.md §4).
 *
 * A practice day is built as a small number of *sustained themed segments*, not a
 * fixed-ratio block stuffed with many short drills. This mirrors how the coach
 * actually programs a session (real menus: "対人いずれか：15min", "リムアタック
 * いずれか：15min") and respects the switch-cost rule: too many activity switches
 * wear youth players out, so the number of main (curriculum) segments is bounded
 * by the session length — 1h → 2-3, 2h → 3-5, 3h → 4-7 — and biased toward FEWER,
 * longer segments. Warm-up and cool-down are routine bookends (a bundle of short
 * mobility drills) and are NOT counted toward that switch-cost budget.
 *
 * Each main segment:
 *   - belongs to ONE category, drawn only from that category's allowed block
 *     (技術 = individual skill, 対人 = contested/team tactics, ゲーム = game-form),
 *     so a finishing/solo drill can never land in the live-game block — the
 *     category-fit fix.
 *   - runs for a *sustained* duration (≥15min for a main theme, 5-minute grain),
 *     decoupled from a single drill's natural length: one primary drill is run as
 *     the segment with a small "いずれか" menu of alternatives from the same
 *     category, exactly like the coach's real menu.
 *
 * Time budget: each day's main-segment minutes sum to (day minutes − WU − CD), and
 * no day ever exceeds its available minutes. Category emphasis (finalWeights) sizes
 * the segments; the team-identity philosophy floors (defense / fast-break) are
 * reserved on coach-present days before the gap-driven emphasis is laid out.
 *
 * Week-scope: `usedIds` is owned by the week (planWeek) and shared across days, so a
 * segment's primary drill does not repeat across 火水木金土 (variety). Warm-up /
 * cool-down are exempt from that dedup (the same stretch is fine daily).
 *
 * Coach context (DESIGN.md §1 / config.coach_present): on coach-absent days the
 * main pool is pre-restricted to player-self-runnable content before allocation.
 *
 * Selection is greedy and stable — no randomness: same inputs ⇒ same plan.
 *
 * @typedef {import('./types.js').Drill} Drill
 * @typedef {import('./types.js').Config} Config
 * @typedef {import('./types.js').PlanBlock} PlanBlock
 * @typedef {import('./types.js').PlanItem} PlanItem
 * @typedef {import('./types.js').PlanDay} PlanDay
 */

import { isHighIntensity } from './loadModel.js';
import { isCoachAbsentEligible, needsCoach, coachingMode } from './filter.js';

/** Warm-up / cool-down category. WU and CD draw only from here. */
const WUCD_CATEGORY = 'コンディショニング/ウォームアップ';

/**
 * Category → main block-type. The three court blocks each accept ONLY the
 * categories mapped to them here, which is the category-fit fix (handoff 却下理由4):
 *   - 技術: individual skill (shoot / finish / handle / pass / footwork)
 *   - 対人: contested / live-vs-opponent / team tactics (1on1 / teamD / teamO / rebound)
 *   - ゲーム: game-form decision play (意思決定/ゲーム形式)
 * Conditioning / 傷害予防 are not main-segment categories (WU/CD bookends only),
 * so they are deliberately absent from this map.
 */
const CATEGORY_BLOCK = {
  'シュート': '技術',
  'フィニッシュ(ゴール下/レイアップ)': '技術',
  'ハンドリング/ドリブル': '技術',
  'パス&スペーシング': '技術',
  'フットワーク/アジリティ/ピボット': '技術',
  '1on1': '対人',
  'チームディフェンス(オールコートマンツー/ヘルプ/帰陣)': '対人',
  'チームオフェンス(アーリー/トランジション)': '対人',
  'リバウンド/ボックスアウト': '対人',
  '意思決定/ゲーム形式': 'ゲーム',
};

/** Presentation order of the three main blocks (coach's 定石: skill → contested → game). */
export const MAIN_BLOCK_ORDER = ['技術', '対人', 'ゲーム'];

/** The game-form category — a session culminates in a game (3on3 / 5on5). */
const GAME_CATEGORY = '意思決定/ゲーム形式';

/** A main (curriculum) segment is sustained — never shorter than this. */
const MIN_MAIN_SEGMENT = 15;
/** ...nor longer than this (one theme past ~40min loses focus; use two segments). */
const MAX_MAIN_SEGMENT = 40;
/** Target average minutes per main segment. Longer ⇒ fewer switches (switch-cost rule). */
const PER_SEGMENT_TARGET = 27;
/** Minutes a single coach-day philosophy-floor top-up segment aims for. */
const FLOOR_SEGMENT = 20;
/** Max "いずれか" alternative drills offered alongside a segment's primary. */
const MAX_ALTERNATIVES = 2;

/** Round to the nearest 5 minutes (the coach's display / planning grain). */
function round5(x) {
  return Math.round(x / 5) * 5;
}
/** clamp(x, lo, hi). */
function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

/** Jump-drill names that must never appear in a cooldown (DESIGN.md §4 / spec #4). */
const JUMP_NAME_RE =
  /ポゴ|バウンディング|ジャンプキック|スクワットジャンプ|ジャンプ|跳び|バウンド|ホップ|プライオ/;

/**
 * Sub-skills that positively mark a drill as cool-down / settle-down work
 * (static stretch / breathing / recovery / fascia). The CD block is filled ONLY by
 * drills that carry a cool-down marker — a POSITIVE test, not elimination. Warm-up
 * mobility (キャリオカ=横移動, フロントキック=動的伸長) carries no cool-down marker
 * and is therefore never placed in the cooldown (the old elimination test let those
 * through because their sub_skill matched none of the exclusion keywords).
 */
const COOLDOWN_SUBSKILL_RE = /静的|整理|鎮静|呼吸|クールダウン|筋温|リカバリ|筋膜/;

/**
 * Is a drill eligible for the cooldown block? CD is settle-down only (static
 * stretch / breathing / recovery). A drill qualifies ONLY when it carries a
 * POSITIVE cool-down marker — a philosophy tag (クールダウン / 整理運動) or a
 * static-recovery sub_skill — and is not high-intensity or a jump drill. Warm-up
 * activation drills (dynamic mobility, lateral shuffles, leg swings) carry no such
 * marker, so they are excluded structurally and can never land in the cooldown.
 *
 * @param {Drill} drill
 * @returns {boolean}
 */
export function isCoolDownEligible(drill) {
  if (drill.intensity_class === '高') return false; // CD は低〜中強度の整理運動のみ
  if (JUMP_NAME_RE.test(drill.name)) return false; // 跳躍は整理運動ではない（安全網）
  const tags = Array.isArray(drill.philosophy_tags) ? drill.philosophy_tags : [];
  if (tags.includes('クールダウン') || tags.includes('整理運動')) return true;
  return COOLDOWN_SUBSKILL_RE.test(drill.sub_skill ?? '');
}

/**
 * Does a drill belong to the FT-only subset? Per DESIGN.md §2, FT matching is
 * limited to `name` and `sub_skill` (NOT the broad searchText).
 * @param {Drill} drill
 * @returns {boolean}
 */
function isFtDrill(drill) {
  return /フリースロー|FT/i.test(`${drill.name} ${drill.sub_skill}`);
}

/** Intensity ordering helper for WU (低=0, 中=1, 高=2). */
function intensityRank(drill) {
  return drill.intensity_class === '低' ? 0 : drill.intensity_class === '中' ? 1 : 2;
}

// ---------------------------------------------------------------------------
// Session shape: how a day's minutes split, and how many main segments fit.
// ---------------------------------------------------------------------------

/**
 * Compute the day's shape: warm-up minutes, cool-down minutes, the main-segment
 * minute budget, and the switch-cost-bounded count of main (curriculum) segments.
 *
 * Switch-cost rule (owner): a 1h session carries 2-3 curriculum segments, 2h 3-5,
 * 3h 4-7 — warm-up / cool-down are routine bookends and excluded from that count.
 * The band is `[round(min/60)+1, round(min/30)+1]` (exactly 2-3 / 3-5 / 4-7 at 60 /
 * 120 / 180), and the target is biased LOW (≈one segment per `PER_SEGMENT_TARGET`
 * minutes) so segments stay long and sustained rather than many and choppy.
 *
 * All of WU / CD / mainMinutes are multiples of 5 (minutes is a multiple of 5 and
 * both bookends round to 5), so segment sizing stays on a clean 5-minute grain.
 *
 * @param {number} minutes
 * @returns {{wu:number, cd:number, mainMinutes:number, minMain:number, maxMain:number, targetMain:number}}
 */
export function computeSessionShape(minutes) {
  const wu = clamp(round5(minutes * 0.15), 10, 30);
  const cd = clamp(round5(minutes * 0.06), 5, 10);
  const mainMinutes = Math.max(0, minutes - wu - cd);
  const minMain = Math.round(minutes / 60) + 1;
  const maxMain = Math.round(minutes / 30) + 1;
  // Can't have more segments than there are 15-minute slots in the main budget.
  const capByMinutes = Math.floor(mainMinutes / MIN_MAIN_SEGMENT);
  const lo = Math.min(minMain, capByMinutes);
  const hi = Math.min(maxMain, capByMinutes);
  const target = clamp(Math.round(mainMinutes / PER_SEGMENT_TARGET), lo, hi);
  return { wu, cd, mainMinutes, minMain, maxMain, targetMain: Math.max(0, target) };
}

/**
 * Order the main-segment-eligible categories present in a pool by descending
 * finalWeight. Only categories mapped to a main block (技術/対人/ゲーム) are
 * considered — conditioning / injury-prevention are excluded. Categories with no
 * finalWeight entry sort last (weight 0) but are still available.
 *
 * @param {Object<string, number>} finalWeights
 * @param {Drill[]} pool
 * @returns {string[]}
 */
function mainCategoriesByWeight(finalWeights, pool) {
  const poolCats = new Set(
    pool.map((d) => d.category).filter((c) => CATEGORY_BLOCK[c]),
  );
  return [...poolCats].sort(
    (a, b) => (finalWeights[b] ?? 0) - (finalWeights[a] ?? 0) || (a < b ? -1 : a > b ? 1 : 0),
  );
}

/**
 * Build the ordered candidate list for one category: drills of that category in
 * the pool, narrowed to FT drills when the category is FT-only (and any exist),
 * sorted so the segment's primary is a substantial, stable choice (longer natural
 * length first, then id) — deterministic and varied across the week via usedIds.
 *
 * @param {Object} args
 * @param {Drill[]} args.pool
 * @param {string} args.category
 * @param {Set<string>} args.ftOnlyCategories
 * @returns {Drill[]}
 */
function categoryCandidates({ pool, category, ftOnlyCategories }) {
  let inCat = pool.filter((d) => d.category === category);
  if (ftOnlyCategories.has(category)) {
    const ft = inCat.filter(isFtDrill);
    if (ft.length > 0) inCat = ft; // honor FT emphasis when such drills exist
  }
  return inCat
    .slice()
    .sort((a, b) => b.duration_max - a.duration_max || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Drill-form affinity between a segment's primary and a candidate "いずれか"
 * alternative, so swap-ins share the primary's shape — a pair/running drill
 * (e.g. ツーメン: peopleShape=pair) is never offered a solo/stationary drill
 * (e.g. マイカン: peopleShape=solo) as an alternative just because they share a
 * category. Pure integer scoring, deterministic (no randomness):
 *   peopleShape 一致 +3（人数形態が最重要）/ court 一致 +2 /
 *   sub_skill の主眼トークン共有 +1 / 同じスタッフィング(needs_helper) +1。
 *
 * @param {Drill} primary
 * @param {Drill} cand
 * @returns {number}
 */
function alternativeAffinity(primary, cand) {
  let score = 0;
  if (primary.peopleShape && cand.peopleShape && primary.peopleShape === cand.peopleShape) score += 3;
  if (primary.court && cand.court && primary.court === cand.court) score += 2;
  const tokens = (s) => new Set(String(s ?? '').split(/[・/、，,\s（）()]+/).filter((t) => t.length >= 2));
  const pt = tokens(primary.sub_skill);
  for (const t of tokens(cand.sub_skill)) {
    if (pt.has(t)) {
      score += 1;
      break;
    }
  }
  if (!!primary.needs_helper === !!cand.needs_helper) score += 1;
  return score;
}

/**
 * Pick a segment's primary drill (plus its "いずれか" alternatives) from a
 * category's candidates. The primary is the first candidate that is fresh
 * (not used this week, not seen today) and placeable under the load budget;
 * already-used drills are a reuse fallback only when fresh ones are exhausted.
 * A high-intensity primary is only taken when the budget allows it (so the
 * load caps and no-consecutive-day rule bind). Alternatives are up to
 * MAX_ALTERNATIVES other candidates from the same category (display-only menu
 * options; they do not consume the budget or the week-scope used set).
 *
 * @param {Object} args
 * @param {Drill[]} args.candidates       Ordered candidate drills for the category.
 * @param {Set<string>} args.usedIds      Week-scope used ids (read; primary mutates via caller).
 * @param {Set<string>} args.daySeenIds   Ids already placed today.
 * @param {ReturnType<import('./loadModel.js').createLoadBudget>} args.budget
 * @returns {{primary: Drill, alternatives: Drill[]}|null}
 */
function pickSegmentDrill({ candidates, usedIds, daySeenIds, budget }) {
  const placeable = (d) => {
    if (daySeenIds.has(d.id)) return false; // never repeat within a day
    if (isHighIntensity(d) && !budget.canPlaceHigh()) return false; // honor load cap
    return true;
  };
  // Prefer fresh (unused this week) candidates; fall back to reuse only if needed.
  const fresh = candidates.filter((d) => !usedIds.has(d.id) && placeable(d));
  const reusable = candidates.filter((d) => usedIds.has(d.id) && placeable(d));
  const ordered = fresh.length > 0 ? fresh : reusable;
  if (ordered.length === 0) return null;

  const primary = ordered[0];
  // Alternatives: other category drills (fresh-first), excluding the primary and
  // anything already placed today. Pure menu suggestions — no budget / used-set use.
  const altPool = [...fresh, ...reusable].filter(
    (d) => d.id !== primary.id && !daySeenIds.has(d.id),
  );
  // Rank by drill-form affinity to the primary so swap-ins share its shape
  // (peopleShape / court / sub_skill / staffing). Ties keep the original stable
  // order (duration_max desc → id, the altPool order). Deterministic — no randomness.
  const ranked = altPool
    .map((d, i) => ({ d, i, aff: alternativeAffinity(primary, d) }))
    .sort((a, b) => b.aff - a.aff || a.i - b.i);
  const alternatives = [];
  const altSeen = new Set([primary.id]);
  for (const { d } of ranked) {
    if (alternatives.length >= MAX_ALTERNATIVES) break;
    if (altSeen.has(d.id)) continue;
    altSeen.add(d.id);
    alternatives.push(d);
  }
  return { primary, alternatives };
}

/**
 * Turn a chosen drill into a sustained PlanItem of the given segment minutes
 * (decoupled from the drill's natural duration — the segment is run for its full
 * allotted time), recording the primary in the budget / used sets and attaching
 * the "いずれか" alternatives as display-only menu options.
 *
 * @param {Object} args
 * @param {Drill} args.primary
 * @param {Drill[]} args.alternatives
 * @param {number} args.minutes
 * @param {Set<string>} args.usedIds
 * @param {Set<string>} args.daySeenIds
 * @param {ReturnType<import('./loadModel.js').createLoadBudget>} args.budget
 * @param {boolean} args.dedup           When true the primary joins usedIds (main blocks);
 *                                       WU/CD pass false (reused daily).
 * @returns {PlanItem}
 */
function toPlanItem({ primary, alternatives, minutes, usedIds, daySeenIds, budget, dedup }) {
  if (isHighIntensity(primary)) budget.recordHigh();
  daySeenIds.add(primary.id);
  if (dedup) usedIds.add(primary.id);
  return {
    drill_id: primary.id,
    name: primary.name,
    minutes,
    category: primary.category,
    intensity_class: primary.intensity_class,
    needs_coach: needsCoach(primary),
    coaching_mode: coachingMode(primary),
    alternatives: alternatives.map((d) => ({ drill_id: d.id, name: d.name })),
  };
}

// ---------------------------------------------------------------------------
// Main-segment selection and sizing.
// ---------------------------------------------------------------------------

/**
 * Choose the day's main segments: which categories, in what block, at how many
 * minutes. Philosophy-floor categories (team defense / fast-break) are reserved
 * first on coach-present days (each a `FLOOR_SEGMENT`-minute top-up that drains the
 * weekly `floorTracker`), leaving room for at least the gap-driven emphasis; the
 * remaining slots go to the heaviest-weighted categories that have a placeable
 * drill. Every returned segment is guaranteed to have at least one candidate.
 *
 * @param {Object} args
 * @param {Drill[]} args.pool             Day pool already filtered (court/grade/coach).
 * @param {Object<string, number>} args.finalWeights
 * @param {Set<string>} args.ftOnlyCategories
 * @param {{wu:number,cd:number,mainMinutes:number,minMain:number,maxMain:number,targetMain:number}} args.shape
 * @param {boolean} args.coachPresent
 * @param {Map<string, number>} [args.floorTracker]  category → remaining weekly minutes (read here).
 * @param {Set<string>} args.usedIds
 * @param {Set<string>} args.daySeenIds
 * @returns {Array<{category:string, block:string, minutes:number, floor:boolean}>}
 */
function chooseMainSegments({
  pool,
  finalWeights,
  ftOnlyCategories,
  shape,
  coachPresent,
  floorTracker,
  usedIds,
  daySeenIds,
}) {
  const { mainMinutes, targetMain } = shape;
  if (targetMain <= 0 || mainMinutes < MIN_MAIN_SEGMENT) return [];

  // A category is usable as a segment only if it has at least one candidate drill.
  const hasCandidate = (cat) =>
    categoryCandidates({ pool, category: cat, ftOnlyCategories }).length > 0;

  /** @type {Array<{category:string, block:string, floorMinutes?:number}>} */
  const chosen = [];
  const used = new Set();

  // 1) Philosophy floors first (coach-present days only): reserve up to
  //    (targetMain − 2) floor slots so at least two slots remain for the gap focus.
  if (coachPresent && floorTracker instanceof Map) {
    const owed = [...floorTracker.entries()]
      .filter(([cat, m]) => m > 0 && CATEGORY_BLOCK[cat] && hasCandidate(cat))
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    const floorSlots = clamp(targetMain - 2, 0, owed.length);
    for (let i = 0; i < floorSlots; i++) {
      const [cat, owedMin] = owed[i];
      const floorMinutes = clamp(round5(Math.min(owedMin, FLOOR_SEGMENT)), 5, owedMin);
      chosen.push({ category: cat, block: CATEGORY_BLOCK[cat], floorMinutes });
      used.add(cat);
    }
  }

  // 2) Reserve one game-form segment — the coach's 定石 is that a session
  //    culminates in a game (3on3 / 5on5). Its weight alone rarely floats it into
  //    the top picks, so reserve a slot when one remains beyond the floors and at
  //    least one gap slot would still survive. Sized by weight like a gap segment.
  if (
    !used.has(GAME_CATEGORY) &&
    hasCandidate(GAME_CATEGORY) &&
    targetMain - chosen.length >= 2
  ) {
    chosen.push({ category: GAME_CATEGORY, block: CATEGORY_BLOCK[GAME_CATEGORY] });
    used.add(GAME_CATEGORY);
  }

  // 3) Fill remaining slots with the heaviest-weighted available categories.
  for (const cat of mainCategoriesByWeight(finalWeights, pool)) {
    if (chosen.length >= targetMain) break;
    if (used.has(cat)) continue;
    if (!hasCandidate(cat)) continue;
    chosen.push({ category: cat, block: CATEGORY_BLOCK[cat] });
    used.add(cat);
  }

  if (chosen.length === 0) return [];

  // 4) Size the segments. Floor segments keep their reserved minutes; the rest of
  //    the main budget is split across the gap segments proportional to weight,
  //    each clamped to [MIN_MAIN_SEGMENT, MAX_MAIN_SEGMENT] on a 5-minute grain.
  const floorTotal = chosen.reduce((s, c) => s + (c.floorMinutes ?? 0), 0);
  const gaps = chosen.filter((c) => c.floorMinutes == null);
  const gapBudget = Math.max(0, mainMinutes - floorTotal);
  const gapMinutes = distributeGapMinutes(gaps, finalWeights, gapBudget);

  /** @type {Array<{category:string, block:string, minutes:number, floor:boolean}>} */
  const segments = [];
  let gi = 0;
  for (const c of chosen) {
    if (c.floorMinutes != null) {
      segments.push({ category: c.category, block: c.block, minutes: c.floorMinutes, floor: true });
    } else {
      segments.push({ category: c.category, block: c.block, minutes: gapMinutes[gi++], floor: false });
    }
  }
  // Drop any zero-minute gap segment (when the budget couldn't seat them all).
  return segments.filter((s) => s.minutes >= MIN_MAIN_SEGMENT || s.floor);
}

/**
 * Split `budget` minutes across the gap segments proportional to finalWeight, each
 * at least MIN_MAIN_SEGMENT and at most MAX_MAIN_SEGMENT, on a 5-minute grain, so
 * the parts sum to `budget` exactly (largest-remainder, capped). If the budget
 * can't seat every segment at the minimum, the lowest-weighted ones get 0 (dropped
 * by the caller). Heavier-weighted categories get more time (gap-driven emphasis).
 *
 * @param {Array<{category:string}>} gaps
 * @param {Object<string, number>} finalWeights
 * @param {number} budget
 * @returns {number[]}  minutes per gap segment (parallel to `gaps`).
 */
function distributeGapMinutes(gaps, finalWeights, budget) {
  const n = gaps.length;
  if (n === 0) return [];
  // How many segments can we afford at the minimum? Keep the heaviest.
  let keep = Math.min(n, Math.floor(budget / MIN_MAIN_SEGMENT));
  const out = new Array(n).fill(0);
  if (keep <= 0) return out;

  const order = gaps
    .map((g, i) => ({ i, w: Math.max(0, finalWeights[g.category] ?? 0) }))
    .sort((a, b) => b.w - a.w || a.i - b.i);
  const kept = order.slice(0, keep).map((o) => o.i);
  const wsum = kept.reduce((s, i) => s + Math.max(0, finalWeights[gaps[i].category] ?? 0), 0);

  // Base everyone at the minimum, then distribute the remainder by weight in
  // 5-minute steps via largest remainder, capping each at MAX_MAIN_SEGMENT.
  let remaining = budget - MIN_MAIN_SEGMENT * keep;
  for (const i of kept) out[i] = MIN_MAIN_SEGMENT;
  const steps = Math.max(0, Math.round(remaining / 5));
  const raw = kept.map((i) => {
    const w = wsum > 0 ? Math.max(0, finalWeights[gaps[i].category] ?? 0) / wsum : 1 / keep;
    return { i, exact: w * steps };
  });
  const floored = raw.map((r) => ({ i: r.i, n: Math.floor(r.exact), frac: r.exact - Math.floor(r.exact) }));
  let assigned = floored.reduce((s, f) => s + f.n, 0);
  let leftover = steps - assigned;
  floored.sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; k < floored.length && leftover > 0; k++) {
    floored[k].n += 1;
    leftover -= 1;
  }
  // Apply, respecting the per-segment max; push any overflow back to the pool.
  let overflow = 0;
  for (const f of floored) {
    let add = f.n * 5;
    const room = MAX_MAIN_SEGMENT - out[f.i];
    if (add > room) {
      overflow += add - room;
      add = room;
    }
    out[f.i] += add;
  }
  // Re-seat overflow on segments that still have room (heaviest first).
  for (const i of kept) {
    if (overflow <= 0) break;
    const room = MAX_MAIN_SEGMENT - out[i];
    if (room <= 0) continue;
    const add = Math.min(room, overflow);
    out[i] += add;
    overflow -= add;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Conditioning blocks (WU / CD): a bundle of short routine drills (unchanged
// switch-cost-exempt behavior — warm-up / cool-down are routine, not curriculum).
// ---------------------------------------------------------------------------

/**
 * Fill a conditioning block (WU/CD) from an ordered candidate list up to its
 * target minutes. These blocks are exempt from the week-scope `usedIds` dedup
 * (the same stretch / settle-down work is fine every day) and from the switch-cost
 * segment budget (warm-up is a routine bundle of short mobility drills, not a
 * curriculum switch). Only the same-day guard applies.
 *
 * @param {Object} args
 * @param {string} args.block
 * @param {number} args.target
 * @param {Drill[]} args.candidates
 * @param {ReturnType<import('./loadModel.js').createLoadBudget>} args.budget
 * @param {Set<string>} [args.daySeenIds]  Shared day-scope seen set so warm-up and
 *   cool-down don't list the same stretch twice in one session. A fresh set is used
 *   when omitted.
 * @returns {PlanBlock}
 */
function fillCondBlock({ block, target, candidates, budget, daySeenIds = new Set() }) {
  /** @type {PlanBlock} */
  const planBlock = { block, items: [] };
  let used = 0;
  for (const d of candidates) {
    if (used >= target) break;
    if (daySeenIds.has(d.id)) continue;
    const dur = d.duration_min;
    if (used + dur > target) continue;
    if (isHighIntensity(d)) {
      if (!budget.canPlaceHigh()) continue;
      budget.recordHigh();
    }
    planBlock.items.push({
      drill_id: d.id,
      name: d.name,
      minutes: dur,
      category: d.category,
      intensity_class: d.intensity_class,
      needs_coach: needsCoach(d),
      coaching_mode: coachingMode(d),
    });
    daySeenIds.add(d.id);
    used += dur;
  }
  return planBlock;
}

// ---------------------------------------------------------------------------
// Day allocation.
// ---------------------------------------------------------------------------

/**
 * Allocate a single day's plan as warm-up + sustained main segments + cool-down.
 *
 * @param {Object} args
 * @param {import('./types.js').ScheduleDay} args.scheduleDay
 * @param {Drill[]} args.dayPool          Pool already filtered for this day (court/grades/zone/sets).
 * @param {Object<string, number>} args.finalWeights
 * @param {Set<string>} args.ftOnlyCategories
 * @param {ReturnType<import('./loadModel.js').createLoadBudget>} args.budget
 * @param {Set<string>} [args.usedIds]    Week-scope used ids (shared across days).
 * @param {Config} [args.config]          For coach-context pool restriction.
 * @param {Map<string, number>} [args.floorTracker]  Weekly philosophy-floor remaining minutes (mutated).
 * @returns {PlanDay}
 */
export function allocateDay({
  scheduleDay,
  dayPool,
  finalWeights,
  ftOnlyCategories,
  budget,
  usedIds = new Set(),
  config,
  floorTracker,
}) {
  const { day, minutes, court } = scheduleDay;
  const coachPresent = scheduleDay.coach_present !== false; // default present when unset
  const shape = computeSessionShape(minutes);

  // Day-scope guard: a drill never appears twice in one day.
  /** @type {Set<string>} */
  const daySeenIds = new Set();

  // Coach-absent days: narrow the MAIN pool to player-self-runnable content.
  const mainPool = coachPresent
    ? dayPool
    : dayPool.filter((d) => isCoachAbsentEligible(d, config));

  // Warm-up / cool-down draw from the unrestricted day pool (they run every day
  // regardless of coach presence). WU is low→中→高 ordered; CD is settle-down only.
  const wuPool = dayPool
    .filter((d) => d.category === WUCD_CATEGORY && !isCoolDownEligible(d))
    .slice()
    .sort((a, b) => intensityRank(a) - intensityRank(b));
  const cdPool = dayPool
    .filter((d) => d.category === WUCD_CATEGORY && isCoolDownEligible(d))
    .slice()
    .sort((a, b) => a.duration_min - b.duration_min);

  const wuBlock = fillCondBlock({ block: 'WU', target: shape.wu, candidates: wuPool, budget, daySeenIds });

  // Choose and size the main segments, then fill each with one sustained primary
  // drill (+ いずれか alternatives) grouped into its 技術/対人/ゲーム block.
  const segments = chooseMainSegments({
    pool: mainPool,
    finalWeights,
    ftOnlyCategories,
    shape,
    coachPresent,
    floorTracker,
    usedIds,
    daySeenIds,
  });

  /** @type {Map<string, PlanBlock>} */
  const mainBlocks = new Map(MAIN_BLOCK_ORDER.map((b) => [b, { block: b, items: [] }]));
  for (const seg of segments) {
    const candidates = categoryCandidates({ pool: mainPool, category: seg.category, ftOnlyCategories });
    const pick = pickSegmentDrill({ candidates, usedIds, daySeenIds, budget });
    if (!pick) continue; // no placeable primary (e.g. all blocked by the load cap)
    const item = toPlanItem({
      primary: pick.primary,
      alternatives: pick.alternatives,
      minutes: seg.minutes,
      usedIds,
      daySeenIds,
      budget,
      dedup: true,
    });
    mainBlocks.get(seg.block).items.push(item);
    // A satisfied floor decrements the weekly tracker by the minutes actually placed.
    if (seg.floor && floorTracker instanceof Map) {
      floorTracker.set(seg.category, Math.max(0, (floorTracker.get(seg.category) ?? 0) - seg.minutes));
    }
  }

  // Cool-down avoids the warm-up's stretches (shared daySeenIds). If that empties
  // it (a tiny pool where warm-up consumed every settle-down drill), refill with a
  // fresh set so every practice day still ends with a non-empty cool-down.
  let cdBlock = fillCondBlock({ block: 'CD', target: shape.cd, candidates: cdPool, budget, daySeenIds });
  if (cdBlock.items.length === 0 && cdPool.length > 0) {
    cdBlock = fillCondBlock({ block: 'CD', target: shape.cd, candidates: cdPool, budget });
  }

  const blocks = [wuBlock, ...MAIN_BLOCK_ORDER.map((b) => mainBlocks.get(b)), cdBlock];
  const total_minutes = blocks.reduce(
    (sum, b) => sum + b.items.reduce((s, it) => s + it.minutes, 0),
    0,
  );
  const high_intensity_count = blocks.reduce(
    (sum, b) => sum + b.items.filter((it) => it.intensity_class === '高').length,
    0,
  );

  // Day boundary: roll the load budget's consecutive-day state.
  budget.endDay();

  return {
    day,
    minutes,
    court,
    coach_present: coachPresent,
    blocks,
    total_minutes,
    high_intensity_count,
  };
}
