/**
 * @file Rotation-model weekday schedule for one coach running two groups (spec ②).
 *
 * Context: a single coach runs two groups (e.g. 男子 / 女子) in a shared gym
 * (config.shared_gym). Both groups follow the SAME weekly menu; the lone coach
 * cannot simultaneously supervise live/contact (practice-mode) work for two groups.
 *
 * Correct rotation model:
 *   One group does a practice drill WITH the coach watching, while the OTHER
 *   group fills that time with a DIFFERENT self-runnable drill ("self_fill").
 *   Then they swap. Both groups ultimately complete the full menu of practice
 *   AND self drills. Coach-required drills are NEVER done unsupervised.
 *
 * This module is a PURE derivation over each produced weekday plan. It does not
 * re-run allocation or alter the day blocks the gates validated. Each plan day is
 * rendered by exactly one of three shapes:
 *   - together (Saturday host): co-ed session, the coach sees both groups.
 *   - self_parallel (coach-absent day, e.g. 水木): there is NO coach, so both
 *     groups simply run the SAME daily menu on their own — no rotation, no live
 *     supervision. Coach-absent days are already filtered to self-runnable drills
 *     upstream, so every item runs as 自走.
 *   - rotation (coach-present weekday, e.g. 火金): the lone coach is split across
 *     two groups. One group does a practice drill WITH the coach watching while the
 *     OTHER group fills that time with DIFFERENT self drills; then they swap. The
 *     swap means both groups complete the full practice AND self menu, and a
 *     coach-required drill is never run unsupervised.
 *       - "rotation" round: one practice drill paired with a self-fill bundle.
 *       - "both_self" round: any remaining self drills run by both groups together.
 *
 * Rotation invariants (proven structurally by the algorithm):
 *   1. Each rotation round has exactly ONE practice drill — both groups in
 *      practice simultaneously is structurally impossible.
 *   2. Practice drills appear ONLY in the rotation.practice field — they never
 *      appear in self_fill or both_self. Coach-required drills are never
 *      unsupervised.
 *   3. self_fill drills are DIFFERENT drills from the paired practice drill
 *      (drill_id mismatch guaranteed by construction).
 *   4. Both groups cover the full menu (rotation.practice + all self_fills +
 *      both_self) via the swap.
 *   5. shortfall_minutes = max(0, T_practice - T_self): the real minutes the self
 *      menu cannot cover. A warning is emitted only when this real shortfall is > 0.
 *      As long as self items outnumber practice drills, every rotation round gets a
 *      non-empty self_fill (each bundle is seeded with one self item before the
 *      remainder is balance-allocated to the neediest bundle).
 *
 * @typedef {import('./types.js').Drill} Drill
 * @typedef {import('./types.js').Plan} Plan
 * @typedef {import('./types.js').PlanDay} PlanDay
 * @typedef {import('./types.js').PlanItem} PlanItem
 */

import { coachingMode } from './filter.js';

/** Default two groups when config omits them. */
export const DEFAULT_GROUPS = ['男子', '女子'];

/** The Saturday together-session marker: a co-ed (men+women) shared day. */
export const TOGETHER = 'together';

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

/**
 * One drill's summary inside a round.
 * @typedef {Object} RoundDrill
 * @property {string} drill_id
 * @property {string} name
 * @property {number} minutes
 * @property {string} category
 * @property {import('./types.js').IntensityClass} intensity_class
 * @property {"self"|"practice"|"lecture"} mode  How this drill is run in this round.
 */

/**
 * A rotation round: the coach supervises one group on a practice drill while
 * the other group fills the time with self drills. Then they swap.
 * @typedef {Object} RotationRound
 * @property {"rotation"} kind
 * @property {RoundDrill} practice      The one practice drill (coach-supervised).
 * @property {RoundDrill[]} self_fill   Self drills for the other group during this time.
 */

/**
 * A both-self round: remaining self drills after the practice list is exhausted.
 * Both groups run these together; the coach floats.
 * @typedef {Object} BothSelfRound
 * @property {"both_self"} kind
 * @property {RoundDrill[]} drills  All self drills in this round (all mode 'self').
 */

/**
 * A weekday plan using the rotation model (coach-present days only).
 * @typedef {Object} WeekdayRotationPlan
 * @property {string} day
 * @property {"weekday"} kind
 * @property {Array<RotationRound|BothSelfRound>} rounds
 * @property {number} shortfall_minutes  Real shortfall = max(0, T_practice - T_self):
 *   the minutes of practice time the self menu cannot cover (0 when self >= practice).
 */

/**
 * A coach-absent day: there is no coach, so both groups simply run the SAME daily
 * menu on their own — no rotation, no live supervision. (Coach-absent days are
 * already filtered to self-runnable drills upstream, so all items run as 自走.)
 * @typedef {Object} SelfParallelDay
 * @property {string} day
 * @property {"self_parallel"} kind
 * @property {RoundDrill[]} drills  The full daily menu (all mode 'self').
 */

/**
 * A together (Saturday) day: both groups share the same session, the coach sees
 * both. No rotation — it is a single co-ed column.
 * @typedef {Object} TogetherGroupPlan
 * @property {string} day
 * @property {"together"} kind
 * @property {string[]} groups          The groups merged into this session.
 * @property {Array<{drill_id:string,name:string,minutes:number,category:string,intensity_class:string,block:string,engagement:string,coached:boolean}>} shared  The shared slots.
 */

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Flatten a day's blocks into ordered (block, item) pairs.
 * @param {PlanDay} day
 * @returns {Array<{ block: string, item: PlanItem }>}
 */
function orderedSlots(day) {
  /** @type {Array<{ block: string, item: PlanItem }>} */
  const slots = [];
  for (const block of day.blocks) {
    for (const item of block.items) slots.push({ block: block.block, item });
  }
  return slots;
}

/**
 * Resolve a slot item's coaching mode. The allocator stamps `coaching_mode` on
 * every placed item as the single source of truth; fall back to re-deriving from
 * the catalog record (then to needs_coach) only for pre-stamp items.
 * @param {PlanItem} item
 * @param {Map<string, Drill>} drillIndex
 * @returns {"self"|"practice"|"lecture"}
 */
function modeOf(item, drillIndex) {
  if (item.coaching_mode === 'self' || item.coaching_mode === 'practice' || item.coaching_mode === 'lecture') {
    return item.coaching_mode;
  }
  const drill = drillIndex.get(item.drill_id);
  if (drill) return coachingMode(drill);
  return item.needs_coach ? 'practice' : 'self';
}

/**
 * Convert a PlanItem to a RoundDrill with the given mode stamp.
 * @param {PlanItem} item
 * @param {"self"|"practice"|"lecture"} mode
 * @returns {RoundDrill}
 */
function toRoundDrill(item, mode) {
  return {
    drill_id: item.drill_id,
    name: item.name,
    minutes: item.minutes,
    category: item.category,
    intensity_class: item.intensity_class,
    mode,
  };
}

// ---------------------------------------------------------------------------
// Core: rotation plan builder
// ---------------------------------------------------------------------------

/**
 * Build the rotation-model weekday schedule for ONE coach-present day.
 *
 * Algorithm:
 *   1. Flatten day.blocks into ordered items.
 *   2. For each item compute weekdayMode: practice → 'practice', anything else
 *      (self or lecture-repetition) → 'self'.
 *   3. practiceList = weekdayMode==='practice' items (in order).
 *      selfList     = weekdayMode==='self'     items (in order).
 *   4. Allocate self items across practice bundles in two passes: (A) seed each
 *      bundle with one self item (menu order) so no round is left with an empty
 *      self_fill while self items remain, then (B) assign each remaining self item
 *      to the bundle whose remaining need is the largest (>0; ties → lowest index),
 *      decrementing that bundle's need (overshoot allowed). When all needs are <= 0
 *      the rest of selfList spills to a single both_self round. The seeding pass
 *      stops the max-need pass from spending every self item on the larger bundles
 *      and starving a small one to empty even when self time is in surplus.
 *   5. shortfall_minutes = max(0, T_practice - T_self): the real, day-global
 *      minutes the self menu cannot cover.
 *
 * @param {PlanDay} day
 * @param {Map<string, Drill>} drillIndex
 * @param {string[]} groups  Exactly the group labels (used for metadata only).
 * @returns {WeekdayRotationPlan}
 */
export function buildWeekdayRotation(day, drillIndex, groups) {
  const slots = orderedSlots(day);

  /** @type {PlanItem[]} */
  const practiceList = [];
  /** @type {PlanItem[]} */
  const selfList = [];

  for (const { item } of slots) {
    const rawMode = modeOf(item, drillIndex);
    // On weekdays, lecture-repetition is treated as self (already-introduced drill).
    const weekdayMode = rawMode === 'practice' ? 'practice' : 'self';
    if (weekdayMode === 'practice') {
      practiceList.push(item);
    } else {
      selfList.push(item);
    }
  }

  // Real day-global shortfall: minutes of practice the self menu cannot cover.
  const totalPractice = practiceList.reduce((s, p) => s + p.minutes, 0);
  const totalSelf = selfList.reduce((s, d) => s + d.minutes, 0);
  const shortfall = Math.max(0, totalPractice - totalSelf);

  // Per-bundle remaining need, and the self items balance-allocated into each.
  const need = practiceList.map((p) => p.minutes);
  /** @type {PlanItem[][]} */
  const bundles = practiceList.map(() => []);

  /** @type {PlanItem[]} */
  const leftover = [];

  let si = 0;
  // Pass A (no-empty seeding): give each bundle one self item, in menu order, so
  // no rotation round is left with an empty self_fill while self drills still
  // remain. Without this, the max-need pass below can spend every self item topping
  // up the larger bundles (overshoot) and starve a small one to empty even on a day
  // with surplus self time. If practice drills outnumber self items (true scarcity
  // → shortfall_minutes > 0), the unseeded bundles legitimately stay empty.
  for (let i = 0; i < bundles.length && si < selfList.length; i++) {
    const s = selfList[si];
    bundles[i].push(s);
    need[i] -= s.minutes; // overshoot allowed (may go negative)
    si += 1;
  }

  // Pass B (balance): assign each remaining self item to the neediest bundle
  // (largest remaining need > 0; ties → lowest index). When all needs are <= 0 the
  // rest spill to a single both_self round.
  for (; si < selfList.length; si++) {
    const selfItem = selfList[si];
    let targetIdx = -1;
    let maxNeed = 0;
    for (let i = 0; i < need.length; i++) {
      if (need[i] > maxNeed) {
        maxNeed = need[i];
        targetIdx = i;
      }
    }
    if (targetIdx === -1) {
      // No bundle still needs time → both groups run this together later.
      leftover.push(selfItem);
      continue;
    }
    bundles[targetIdx].push(selfItem);
    need[targetIdx] -= selfItem.minutes; // overshoot allowed (may go negative)
  }

  /** @type {Array<RotationRound|BothSelfRound>} */
  const rounds = [];
  practiceList.forEach((p, i) => {
    rounds.push({
      kind: 'rotation',
      practice: toRoundDrill(p, 'practice'),
      self_fill: bundles[i].map((d) => toRoundDrill(d, 'self')),
    });
  });

  if (leftover.length > 0) {
    rounds.push({
      kind: 'both_self',
      drills: leftover.map((d) => toRoundDrill(d, 'self')),
    });
  }

  return { day: day.day, kind: 'weekday', rounds, shortfall_minutes: shortfall };
}

/**
 * Build the coach-absent day view for ONE day. With no coach present there is no
 * rotation and no live supervision: both groups simply run the SAME daily menu on
 * their own. Coach-absent days are already filtered to self-runnable drills
 * upstream (filter.js F6), so every item runs as 自走.
 *
 * @param {PlanDay} day
 * @param {Map<string, Drill>} drillIndex
 * @param {string[]} groups  Group labels (metadata only).
 * @returns {SelfParallelDay}
 */
export function buildSelfParallel(day, drillIndex, groups) {
  const drills = orderedSlots(day).map(({ item }) => toRoundDrill(item, 'self'));
  return { day: day.day, kind: 'self_parallel', drills };
}

// ---------------------------------------------------------------------------
// Verification helpers (exported for tests and gates)
// ---------------------------------------------------------------------------

/**
 * Verify the rotation invariants on a built weekday rotation plan. Returns an
 * array of violation descriptors (empty = all invariants hold).
 *
 * Checked violations:
 *   - rotation.practice.mode !== 'practice'
 *   - any self_fill item with mode === 'practice'
 *   - any self_fill item whose drill_id equals practice.drill_id
 *   - any both_self item with mode === 'practice'
 *
 * @param {WeekdayRotationPlan} weekdayPlan
 * @returns {Array<{round: number, violation: string}>}
 */
export function findRotationViolations(weekdayPlan) {
  /** @type {Array<{round: number, violation: string}>} */
  const violations = [];
  // Only rotation (coach-present weekday) plans carry rounds. A self_parallel or
  // together day has no rotation to violate, so the invariant trivially holds —
  // guard the kind so a caller iterating mixed weekday_groups can't crash here.
  if (weekdayPlan?.kind !== 'weekday' || !Array.isArray(weekdayPlan.rounds)) return violations;

  weekdayPlan.rounds.forEach((round, idx) => {
    if (round.kind === 'rotation') {
      if (round.practice.mode !== 'practice') {
        violations.push({ round: idx, violation: `rotation.practice.mode is '${round.practice.mode}', expected 'practice'` });
      }
      for (const sf of round.self_fill) {
        if (sf.mode === 'practice') {
          violations.push({ round: idx, violation: `self_fill contains practice-mode drill: ${sf.drill_id}` });
        }
        if (sf.drill_id === round.practice.drill_id) {
          violations.push({ round: idx, violation: `self_fill drill_id '${sf.drill_id}' matches practice drill_id (same drill in both roles)` });
        }
      }
    } else if (round.kind === 'both_self') {
      for (const d of round.drills) {
        if (d.mode === 'practice') {
          violations.push({ round: idx, violation: `both_self contains practice-mode drill: ${d.drill_id}` });
        }
      }
    }
  });

  return violations;
}

/**
 * Return the sorted array of all drill_ids covered by a weekday rotation plan.
 * Both groups cover this same set (the swap guarantees it).
 *
 * @param {WeekdayRotationPlan} weekdayPlan
 * @returns {string[]}
 */
export function coveredDrillIds(weekdayPlan) {
  const ids = new Set();
  // Coverage is defined over rotation rounds; non-weekday day shapes (self_parallel
  // / together) have no rounds, so guard the kind to avoid a crash on misuse.
  if (weekdayPlan?.kind !== 'weekday' || !Array.isArray(weekdayPlan.rounds)) return [];
  for (const round of weekdayPlan.rounds) {
    if (round.kind === 'rotation') {
      ids.add(round.practice.drill_id);
      for (const sf of round.self_fill) ids.add(sf.drill_id);
    } else if (round.kind === 'both_self') {
      for (const d of round.drills) ids.add(d.drill_id);
    }
  }
  return [...ids].sort();
}

// ---------------------------------------------------------------------------
// Together (Saturday) builder — unchanged from original
// ---------------------------------------------------------------------------

/**
 * Build the together (Saturday) co-ed view for ONE day plan. Both groups share
 * the session; the coach sees both, so engagement is just the drill's own mode
 * (実践 stays 実践, self stays 自走). New-skill lecture slots render as レクチャ.
 * No rotation.
 *
 * @param {PlanDay} day
 * @param {Map<string, Drill>} drillIndex
 * @param {string[]} groups
 * @returns {TogetherGroupPlan}
 */
export function buildTogether(day, drillIndex, groups) {
  const shared = [];
  for (const { block, item } of orderedSlots(day)) {
    const mode = modeOf(item, drillIndex);
    shared.push({
      drill_id: item.drill_id,
      name: item.name,
      minutes: item.minutes,
      category: item.category,
      intensity_class: item.intensity_class,
      block,
      engagement: mode,
      coached: mode !== 'self',
    });
  }
  return { day: day.day, kind: 'together', groups: [...groups], shared };
}

// ---------------------------------------------------------------------------
// Top-level builder (entry point from planWeek)
// ---------------------------------------------------------------------------

/**
 * Build the two-group weekday schedule for a whole produced plan (spec ②).
 *
 * Only meaningful when the team shares one coach across groups (config.shared_gym
 * — default true). Each plan day is rendered by one of three shapes:
 *   - The Saturday host (coach-present longest day) → co-ed "together" session.
 *   - A coach-absent day (day.coach_present === false, e.g. 水木) → "self_parallel":
 *     no coach, so both groups run the same menu on their own (no rotation,
 *     no live supervision).
 *   - A coach-present weekday (e.g. 火金) → "rotation": the lone coach is split
 *     across the two groups, alternating practice supervision while the other
 *     group does self drills.
 * When shared_gym is false there is no cross-pairing to do, so an empty list is
 * returned and callers fall back to the single-column day view.
 *
 * Emits a warning into plan.warnings only for a rotation day whose REAL shortfall
 * (max(0, T_practice - T_self)) is > 0 (self menu cannot cover the practice time).
 *
 * @param {Object} args
 * @param {Plan} args.plan
 * @param {Map<string, Drill>} args.drillIndex
 * @param {import('./types.js').Config} args.config
 * @returns {Array<WeekdayRotationPlan|SelfParallelDay|TogetherGroupPlan>}
 */
export function buildWeekdayGroups({ plan, drillIndex, config }) {
  const sharedGym = config.shared_gym !== false; // default: one coach, two groups
  if (!sharedGym) return [];

  const groups =
    Array.isArray(config.groups) && config.groups.length >= 2
      ? config.groups
      : DEFAULT_GROUPS;

  // The Saturday together day = the coach-present longest day (same host the
  // mixed-gender lecture lands on).
  const host = plan.saturday_lecture?.day ?? null;

  /** @type {Array<WeekdayRotationPlan|SelfParallelDay|TogetherGroupPlan>} */
  const out = [];
  for (const day of plan.days) {
    if (day.day === host) {
      out.push(buildTogether(day, drillIndex, groups));
      continue;
    }
    if (day.coach_present === false) {
      // Coach-absent day: no rotation, both groups self-run the same menu.
      out.push(buildSelfParallel(day, drillIndex, groups));
      continue;
    }
    // Coach-present weekday: split the lone coach across the two groups.
    const weekdayPlan = buildWeekdayRotation(day, drillIndex, groups);
    out.push(weekdayPlan);
    if (weekdayPlan.shortfall_minutes > 0 && Array.isArray(plan.warnings)) {
      plan.warnings.push(
        `${day.day}: 自走ドリルが実践ドリルより約${weekdayPlan.shortfall_minutes}分少なく、組違いの空き時間を埋めきれない（反復/コンディショニングで調整）`,
      );
    }
  }
  return out;
}
