/**
 * @file Deterministic per-day block allocation (DESIGN.md §4).
 *
 * Splits a day's minutes into the five blocks (WU / 技術 / 対人 / ゲーム / CD)
 * by fixed ratios, then fills each block with drills drawn from the day's
 * already-filtered pool. Category priority comes from finalWeights; the load
 * budget (high-intensity caps) is consulted at the moment of selection.
 *
 * Selection is greedy and stable: within a block the minutes are split across
 * the top finalWeight categories proportionally (no single-category monopoly),
 * and within each category drills are taken (by duration_min) until that
 * category's share is met. No randomness — same inputs ⇒ same plan.
 *
 * Week-scope: `usedIds` is owned by the week (planWeek) and shared across days,
 * so the same drill does not repeat across 火水木金土. A category's pool is only
 * allowed to reuse a drill once every fresh-drill option is exhausted.
 *
 * Coach context (DESIGN.md §1 / config.coach_present): on coach-absent days the
 * pool is pre-restricted to player-self-runnable content before allocation.
 *
 * @typedef {import('./types.js').Drill} Drill
 * @typedef {import('./types.js').Config} Config
 * @typedef {import('./types.js').PlanBlock} PlanBlock
 * @typedef {import('./types.js').PlanDay} PlanDay
 */

import { isHighIntensity } from './loadModel.js';
import { isCoachAbsentEligible } from './filter.js';

/** Block ratios over the day's total minutes (DESIGN.md §4). */
export const BLOCK_RATIOS = { WU: 0.15, 技術: 0.30, 対人: 0.30, ゲーム: 0.20, CD: 0.05 };

const WUCD_CATEGORY = 'コンディショニング/ウォームアップ';
/** Categories that count as "live game form" for the ゲーム block. */
const GAME_CATEGORIES = ['意思決定/ゲーム形式', '1on1'];

/**
 * How many top categories a single skill block (技術/対人/ゲーム) spreads its
 * minutes across, so one category cannot monopolize the block. Minimal sensible
 * default: 3 — enough variety without fragmenting a block into 1-drill slivers.
 */
const BLOCK_SPREAD_CATEGORIES = 3;

/** Jump-drill names that must never appear in a cooldown (DESIGN.md §4 / spec #4). */
const JUMP_NAME_RE =
  /ポゴ|バウンディング|ジャンプキック|スクワットジャンプ|ジャンプ|跳び|バウンド|ホップ|プライオ/;

/**
 * Conditioning "push" names that must never appear in a cooldown even when their
 * intensity_class is "低" (HIIT-style / sprint / shuttle / burpee / interval).
 * CD is settle-down only, so these are excluded by name (spec #4).
 */
const PUSH_NAME_RE = /HIIT|ボディビルダー|ダッシュ|シャトル|バーピー|インターバル/i;
/** Conditioning sub-skills that mark a drill as a "push" (anaerobic / cardio / muscular-endurance). */
const PUSH_SUBSKILL_RE = /無酸素|心肺|筋持久/;

/**
 * Sub-skills that mark a low-intensity conditioning drill as NOT a settle-down
 * stretch, even though its name carries no jump/push keyword (spec #4). The CD
 * block is for range-of-motion / mobility / stretch work only; drills whose
 * trained quality is plyometric elasticity (弾性/ばね/跳躍), power output (パワー),
 * sprint / cardio (スプリント/有酸素/無酸素/心肺/筋持久), or rhythmic locomotor
 * activation (リズム/協調 — warm-up skips such as Aスキップ / エルボーtoニー skip)
 * are warm-up activation, not warm-down. The name-based JUMP regex misses these
 * (e.g. CND-018 Aスキップ「リズム・弾性協調」, CND-008 スキップ(エルボー to ニー)
 * 「体幹連動・協調」, CND-017 縄跳び「下肢弾性・有酸素基礎」), so the trained-quality
 * sub_skill is the reliable discriminator. Pure mobility sub_skills (可動/伸ばし/
 * 伸長/温め/旋/捻転) are kept.
 */
const NON_STRETCH_SUBSKILL_RE = /弾性|ばね|パワー|スプリント|有酸素|無酸素|心肺|筋持久|跳躍|協調|リズム/;

/**
 * Compute integer block targets that sum exactly to the day's minutes.
 * Remainders are pushed onto the 技術 block (per spec "端数は技術へ寄せる").
 *
 * @param {number} dayMinutes
 * @returns {Record<'WU'|'技術'|'対人'|'ゲーム'|'CD', number>}
 */
export function computeBlockTargets(dayMinutes) {
  const wu = Math.floor(dayMinutes * BLOCK_RATIOS.WU);
  const tech = Math.floor(dayMinutes * BLOCK_RATIOS.技術);
  const vs = Math.floor(dayMinutes * BLOCK_RATIOS.対人);
  const game = Math.floor(dayMinutes * BLOCK_RATIOS.ゲーム);
  const cd = Math.floor(dayMinutes * BLOCK_RATIOS.CD);
  const remainder = dayMinutes - (wu + tech + vs + game + cd);
  return { WU: wu, 技術: tech + remainder, 対人: vs, ゲーム: game, CD: cd };
}

/**
 * Order categories by descending finalWeight. Categories absent from
 * finalWeights are appended (weight 0) so the pool is never artificially
 * starved when weights don't cover everything.
 *
 * @param {Object<string, number>} finalWeights
 * @param {Drill[]} pool
 * @returns {string[]}
 */
function categoriesByWeight(finalWeights, pool) {
  const poolCats = new Set(pool.map((d) => d.category));
  const ranked = Object.keys(finalWeights)
    .filter((c) => poolCats.has(c))
    .sort((a, b) => finalWeights[b] - finalWeights[a]);
  for (const c of poolCats) if (!ranked.includes(c)) ranked.push(c);
  return ranked;
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

/**
 * Is a drill eligible for the cooldown block? CD is reserved for low-intensity
 * stretch / settle-down work (DESIGN.md §4, spec #4): intensity_class must be
 * "低" AND the name must not contain any jump keyword (so 低-intensity jump
 * drills like ポゴジャンプ / スクワットジャンプ are still excluded) AND the drill
 * must not be a conditioning "push" (HIIT / sprint / shuttle / burpee / interval
 * by name, or anaerobic / cardio / muscular-endurance by sub_skill) AND the
 * trained quality (sub_skill) must not be plyometric / power / cardio / rhythmic
 * locomotor activation (弾性/ばね/パワー/スプリント/有酸素/無酸素/心肺/筋持久/跳躍/
 * 協調/リズム) — this catches low-intensity warm-up activation drills the name-
 * based jump regex misses (Aスキップ, 縄跳び, エルボーtoニー skip). What remains is
 * range-of-motion / mobility / stretch / warm-down work only.
 *
 * @param {Drill} drill
 * @returns {boolean}
 */
export function isCoolDownEligible(drill) {
  if (drill.intensity_class !== '低') return false;
  if (JUMP_NAME_RE.test(drill.name)) return false;
  if (PUSH_NAME_RE.test(drill.name)) return false;
  if (PUSH_SUBSKILL_RE.test(drill.sub_skill ?? '')) return false;
  if (NON_STRETCH_SUBSKILL_RE.test(drill.sub_skill ?? '')) return false;
  return true;
}

/**
 * Build the per-category ordered candidate map for a block. Each category maps
 * to its drills in selection order (shorter first). FT-only categories are
 * narrowed to FT drills when any exist.
 *
 * @param {Object} args
 * @param {Drill[]} args.pool         Day-filtered pool (court/grades/zone/sets ok).
 * @param {string[]} args.categories  Allowed categories for this block (ranked).
 * @param {Set<string>} args.ftOnlyCategories  Categories restricted to FT drills.
 * @returns {Map<string, Drill[]>}
 */
function candidatesByCategory({ pool, categories, ftOnlyCategories }) {
  /** @type {Map<string, Drill[]>} */
  const map = new Map();
  for (const cat of categories) {
    let inCat = pool.filter((d) => d.category === cat);
    if (ftOnlyCategories.has(cat)) {
      const ftSubset = inCat.filter(isFtDrill);
      // Honor FT emphasis when such drills exist; otherwise keep the category usable.
      if (ftSubset.length > 0) inCat = ftSubset;
    }
    // Stable secondary order: shorter drills first so we can pack tightly.
    inCat = inCat.slice().sort((a, b) => a.duration_min - b.duration_min);
    if (inCat.length > 0) map.set(cat, inCat);
  }
  return map;
}

/**
 * Compute per-category minute shares for a block, distributing the block target
 * across the top categories proportionally to finalWeight (spec #3 — stop the
 * single-category monopoly). Shares are advisory soft-caps; the packer falls
 * back to any remaining category to fill leftover time.
 *
 * @param {Object} args
 * @param {number} args.target
 * @param {string[]} args.categories  Ranked, with candidates available.
 * @param {Object<string, number>} args.finalWeights
 * @returns {Map<string, number>}  category → soft-cap minutes.
 */
function categoryShares({ target, categories, finalWeights }) {
  const top = categories.slice(0, BLOCK_SPREAD_CATEGORIES);
  /** @type {Map<string, number>} */
  const shares = new Map();
  if (top.length === 0) return shares;

  // Use finalWeight as the proportion; if all weights are 0 (e.g. fallback
  // categories), split the block evenly so it is still spread, not monopolized.
  const weights = top.map((c) => Math.max(0, finalWeights[c] ?? 0));
  const sum = weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < top.length; i++) {
    const frac = sum > 0 ? weights[i] / sum : 1 / top.length;
    shares.set(top[i], Math.max(1, Math.round(target * frac)));
  }
  return shares;
}

/**
 * Fill one skill block (技術/対人/ゲーム) up to its target, spreading minutes
 * across the top categories by their soft-cap share, then topping up from any
 * remaining candidates so the block is packed as fully as possible without
 * overflowing.
 *
 * @param {Object} args
 * @param {string} args.block
 * @param {number} args.target
 * @param {string[]} args.categories          Ranked categories with candidates.
 * @param {Map<string, Drill[]>} args.candMap  category → ordered drills.
 * @param {Object<string, number>} args.finalWeights
 * @param {Set<string>} args.usedIds           Week-scope used drill ids (mutated).
 * @param {ReturnType<import('./loadModel.js').createLoadBudget>} args.budget
 * @returns {PlanBlock}
 */
function fillSkillBlock({
  block,
  target,
  categories,
  candMap,
  finalWeights,
  usedIds,
  budget,
  planBlock = { block, items: [] },
  usedSoFar = 0,
  daySeenIds = new Set(),
}) {
  let used = usedSoFar;

  const shares = categoryShares({ target, categories, finalWeights });

  /**
   * Try to place one drill; returns minutes added (0 if none placed).
   * @param {Drill} d
   * @param {number} blockUsed
   * @param {boolean} [allowReuse]  When true, a drill already used in a PRIOR
   *   week-day may be reused (fallback only — used once fresh drills are
   *   exhausted, per spec "あるカテゴリのプールが尽きた時のみ再利用許可").
   *   A drill already placed earlier TODAY is never reused, even in fallback.
   */
  const tryPlace = (d, blockUsed, allowReuse = false) => {
    if (daySeenIds.has(d.id)) return 0; // never repeat a drill within the same day
    if (!allowReuse && usedIds.has(d.id)) return 0;
    const dur = d.duration_min;
    if (blockUsed + dur > target) return 0; // never overflow the block
    if (isHighIntensity(d)) {
      if (!budget.canPlaceHigh()) return 0; // load cap / consecutive-day guard
      budget.recordHigh();
    }
    planBlock.items.push({
      drill_id: d.id,
      name: d.name,
      minutes: dur,
      category: d.category,
      intensity_class: d.intensity_class,
    });
    usedIds.add(d.id);
    daySeenIds.add(d.id);
    return dur;
  };

  // Pass 1: honor each category's proportional share (spread across categories).
  for (const cat of shares.keys()) {
    const cap = shares.get(cat);
    let inCat = 0;
    for (const d of candMap.get(cat) ?? []) {
      if (used >= target) break;
      if (inCat >= cap) break;
      const added = tryPlace(d, used);
      if (added > 0) {
        used += added;
        inCat += added;
      }
    }
  }

  // Pass 2: top up any remaining block minutes from all categories in priority
  // order (so a small leftover never wastes the block) without overflowing.
  for (const cat of categories) {
    if (used >= target) break;
    for (const d of candMap.get(cat) ?? []) {
      if (used >= target) break;
      const added = tryPlace(d, used);
      if (added > 0) used += added;
    }
  }

  // Pass 3 (reuse fallback): only when fresh drills are exhausted and the block
  // is still short, reuse already-placed-this-week drills so the block is not
  // left under-filled. Spec #3: reuse permitted only once a category's fresh
  // pool is exhausted. Avoids the same drill appearing twice within this block.
  if (used < target) {
    for (const cat of categories) {
      if (used >= target) break;
      for (const d of candMap.get(cat) ?? []) {
        if (used >= target) break;
        const added = tryPlace(d, used, true);
        if (added > 0) used += added;
      }
    }
  }

  return planBlock;
}

/**
 * Place philosophy-floor drills (team defense / fast-break) into a block on a
 * coach-present day (spec #2). Draws from the floor categories up to the lesser
 * of the block's remaining minutes and the category's still-owed weekly minutes,
 * decrementing the shared weekly `floorTracker` as it places. These categories
 * (the team's identity: all-court man / early offense) otherwise never surface
 * from the attack-only gap signal, so they are injected explicitly here.
 *
 * @param {Object} args
 * @param {PlanBlock} args.planBlock          Block being filled (mutated).
 * @param {number} args.target                Block target minutes.
 * @param {number} args.usedSoFar             Minutes already placed in the block.
 * @param {Drill[]} args.pool                 Day pool to draw from.
 * @param {Map<string, number>} args.floorTracker  category → remaining weekly minutes (mutated).
 * @param {Set<string>} args.usedIds          Week-scope used ids (mutated).
 * @param {Set<string>} args.daySeenIds       Ids already placed today (mutated).
 * @param {ReturnType<import('./loadModel.js').createLoadBudget>} args.budget
 * @returns {number}  minutes added to the block.
 */
function fillFloorIntoBlock({ planBlock, target, usedSoFar, pool, floorTracker, usedIds, daySeenIds, budget }) {
  let used = usedSoFar;
  for (const [cat, owed] of floorTracker) {
    if (owed <= 0) continue;
    if (used >= target) break;
    const candidates = pool
      .filter((d) => d.category === cat)
      .slice()
      .sort((a, b) => a.duration_min - b.duration_min);
    let placedForCat = 0;
    for (const d of candidates) {
      if (used >= target) break;
      if (placedForCat >= owed) break;
      if (usedIds.has(d.id) || daySeenIds.has(d.id)) continue;
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
      });
      usedIds.add(d.id);
      daySeenIds.add(d.id);
      used += dur;
      placedForCat += dur;
    }
    floorTracker.set(cat, owed - placedForCat);
  }
  return used - usedSoFar;
}

/**
 * Fill a conditioning block (WU/CD) from an ordered candidate list.
 *
 * Conditioning blocks are exempt from the week-scope `usedIds` dedup: warm-up
 * and cool-down are meant to be reused every day (the same stretch/settle-down
 * work is fine daily), so they neither read nor write `usedIds`. Only the
 * same-day guard (`daySeenIds`) applies — no drill repeats within one day. Week-
 * scope variety is reserved for the 技術/対人/ゲーム main blocks. This prevents
 * the CD block from going empty on later days once an early day "used up" the
 * shared conditioning drills.
 *
 * @param {Object} args
 * @param {string} args.block
 * @param {number} args.target
 * @param {Drill[]} args.candidates
 * @param {Set<string>} args.daySeenIds
 * @param {ReturnType<import('./loadModel.js').createLoadBudget>} args.budget
 * @returns {PlanBlock}
 */
function fillCondBlock({ block, target, candidates, daySeenIds = new Set(), budget }) {
  /** @type {PlanBlock} */
  const planBlock = { block, items: [] };
  let used = 0;
  for (const d of candidates) {
    if (used >= target) break;
    if (daySeenIds.has(d.id)) continue; // same-day only; WU/CD reuse across days is allowed
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
    });
    daySeenIds.add(d.id);
    used += dur;
  }
  return planBlock;
}

/**
 * Allocate a single day's plan: split into blocks and fill each from the pool.
 *
 * @param {Object} args
 * @param {import('./types.js').ScheduleDay} args.scheduleDay
 * @param {Drill[]} args.dayPool          Pool already filtered for this day (court/grades/zone/sets).
 * @param {Object<string, number>} args.finalWeights
 * @param {Set<string>} args.ftOnlyCategories
 * @param {ReturnType<import('./loadModel.js').createLoadBudget>} args.budget
 * @param {Set<string>} [args.usedIds]    Week-scope used ids (shared across days). A
 *                                        fresh per-day set is used when omitted.
 * @param {Config} [args.config]          For coach-context pool restriction.
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
  const targets = computeBlockTargets(minutes);

  // Day-scope guard: a drill never appears twice in the same day, even when the
  // week-scope reuse fallback (exhausted fresh pool) kicks in.
  /** @type {Set<string>} */
  const daySeenIds = new Set();

  // Coach-absent days: narrow the pool to player-self-runnable content
  // (coach_absent_allow categories, mastery 反復/実戦化, no team-intro / 習得).
  const effectivePool = coachPresent
    ? dayPool
    : dayPool.filter((d) => isCoachAbsentEligible(d, config));

  // WU / CD draw from the conditioning/warm-up category.
  // Warm-up and cool-down are run every day regardless of whether a coach is
  // present, so they draw from the unrestricted day pool (NOT effectivePool):
  // the coach-absent restriction is for the technical/対人/ゲーム main blocks only
  // (spec #2). WU keeps the existing behavior (low→中→高). CD is restricted to
  // low-intensity non-jump non-push settle-down work only (spec #4).
  const wuPool = dayPool
    .filter((d) => d.category === WUCD_CATEGORY)
    .slice()
    .sort((a, b) => intensityRank(a) - intensityRank(b)); // 低→中→高
  const cdPool = dayPool
    .filter((d) => d.category === WUCD_CATEGORY && isCoolDownEligible(d))
    .slice()
    .sort((a, b) => a.duration_min - b.duration_min);

  // 技術 / 対人 / ゲーム draw from the rest, by finalWeight priority.
  const skillCategories = categoriesByWeight(finalWeights, effectivePool).filter(
    (c) => c !== WUCD_CATEGORY,
  );

  // WU/CD use their own per-block same-day sets (not the shared daySeenIds) so a
  // warm-up drill doesn't starve the cool-down: the conditioning category never
  // overlaps the skill blocks, and WU/CD are reused daily, so each only needs to
  // avoid repeating a drill within its own block.
  const wuBlock = fillCondBlock({
    block: 'WU',
    target: targets.WU,
    candidates: wuPool,
    daySeenIds: new Set(),
    budget,
  });

  const techCandMap = candidatesByCategory({
    pool: effectivePool,
    categories: skillCategories,
    ftOnlyCategories,
  });
  const techCats = skillCategories.filter((c) => techCandMap.has(c));
  const techBlock = fillSkillBlock({
    block: '技術',
    target: targets.技術,
    categories: techCats,
    candMap: techCandMap,
    finalWeights,
    usedIds,
    daySeenIds,
    budget,
  });

  // 対人 rebuilds candidates against the same pool; week-scope usedIds already
  // prevents reusing the drills the 技術 block just consumed.
  // On coach-present days we first reserve philosophy-floor minutes (team
  // defense / fast-break) in this block (spec #2), then fill the remainder by
  // the normal weighted spread.
  /** @type {PlanBlock} */
  const vsBlock = { block: '対人', items: [] };
  let vsUsed = 0;
  if (coachPresent && floorTracker) {
    vsUsed += fillFloorIntoBlock({
      planBlock: vsBlock,
      target: targets.対人,
      usedSoFar: vsUsed,
      pool: dayPool, // floors draw from the unrestricted day pool
      floorTracker,
      usedIds,
      daySeenIds,
      budget,
    });
  }
  const vsCandMap = candidatesByCategory({
    pool: effectivePool,
    categories: skillCategories,
    ftOnlyCategories,
  });
  const vsCats = skillCategories.filter((c) => vsCandMap.has(c));
  fillSkillBlock({
    block: '対人',
    target: targets.対人,
    categories: vsCats,
    candMap: vsCandMap,
    finalWeights,
    usedIds,
    daySeenIds,
    budget,
    planBlock: vsBlock,
    usedSoFar: vsUsed,
  });

  // ゲーム prefers live-game-form categories, then falls back to weighted rest.
  const gameRanked = [
    ...GAME_CATEGORIES.filter((c) => skillCategories.includes(c)),
    ...skillCategories.filter((c) => !GAME_CATEGORIES.includes(c)),
  ];
  const gameCandMap = candidatesByCategory({
    pool: effectivePool,
    categories: gameRanked,
    ftOnlyCategories,
  });
  const gameCats = gameRanked.filter((c) => gameCandMap.has(c));
  const gameBlock = fillSkillBlock({
    block: 'ゲーム',
    target: targets.ゲーム,
    categories: gameCats,
    candMap: gameCandMap,
    finalWeights,
    usedIds,
    daySeenIds,
    budget,
  });

  const cdBlock = fillCondBlock({
    block: 'CD',
    target: targets.CD,
    candidates: cdPool,
    daySeenIds: new Set(),
    budget,
  });

  const blocks = [wuBlock, techBlock, vsBlock, gameBlock, cdBlock];
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

/** Intensity ordering helper for WU (低=0, 中=1, 高=2). */
function intensityRank(drill) {
  return drill.intensity_class === '低' ? 0 : drill.intensity_class === '中' ? 1 : 2;
}
