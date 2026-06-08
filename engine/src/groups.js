/**
 * @file Cross-paired weekday schedule for one coach running two groups (spec ②).
 *
 * Context: a single coach runs two groups (e.g. 男子 / 女子) in a shared gym
 * (config.shared_gym). In the fundamentals phase both groups follow the SAME
 * daily curriculum (the engine already produces one day plan; both groups run
 * it). The one hard constraint is staffing: the lone coach cannot stand over a
 * live/contact rep (practice-mode, 実践) for two groups at the same time. So when
 * one group does a 実践 drill with the coach watching, the OTHER group runs that
 * same slot on its own (自走) — and on the next 実践 slot the coach switches.
 *
 * This module is a PURE derivation over each produced weekday plan. It does not
 * re-run allocation or alter the day blocks the gates validated. For every
 * weekday (coach-present, not the Saturday "together" day), it walks the day's
 * drills in slot order and, per practice-mode slot, alternates which group the
 * coach supervises (男子 first, then 女子, then 男子, …). The non-supervised group
 * runs the identical drill as 自走 that slot. self-mode slots are 自走 for both
 * groups (the coach floats). lecture-mode drills do not reach weekdays after the
 * time-series gate (spec ①); an already-introduced lecture seen on a weekday is
 * repetition, so it is treated as 自走 here too.
 *
 * Result: a two-column weekday view (男子 / 女子) where each time slot shows the
 * drill, each group's engagement (自走/実践/レクチャ), and which group the coach
 * is on — with the guarantee that no time slot has BOTH groups in 実践.
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

/**
 * Three-way engagement label for one group on one slot:
 *  - "practice" (実践): this group does the drill live with the coach watching.
 *  - "self"     (自走): this group runs the drill on its own (no coach).
 *  - "lecture"  (レクチャ): a taught new-skill slot (only on the together day).
 * @typedef {"practice"|"self"|"lecture"} GroupEngagement
 */

/**
 * One slot in a group's weekday column.
 * @typedef {Object} GroupSlot
 * @property {string} drill_id
 * @property {string} name
 * @property {number} minutes
 * @property {string} category
 * @property {import('./types.js').IntensityClass} intensity_class
 * @property {"WU"|"技術"|"対人"|"ゲーム"|"CD"} block  Which block this slot is in.
 * @property {GroupEngagement} engagement  How this group engages this slot.
 * @property {boolean} coached  Whether the coach is on THIS group this slot.
 */

/**
 * A weekday rendered as two cross-paired group columns.
 * @typedef {Object} WeekdayGroupPlan
 * @property {string} day
 * @property {"weekday"} kind          Always "weekday" (cross-paired columns).
 * @property {Object<string, GroupSlot[]>} columns  group label → ordered slots.
 */

/**
 * A together (Saturday) day: both groups share the same session, the coach sees
 * both. No cross-pairing — it is a single co-ed column.
 * @typedef {Object} TogetherGroupPlan
 * @property {string} day
 * @property {"together"} kind
 * @property {string[]} groups          The groups merged into this session.
 * @property {GroupSlot[]} shared       The shared slots (engagement as derived).
 */

/**
 * Flatten a day's blocks into ordered (block, item) slots.
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
 * every placed item, so that is the single source of truth here; we fall back to
 * re-deriving from the catalog record (then to needs_coach) only for items that
 * predate the stamp, so a slot is never undefined.
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
  // No stamp and no catalog record: a coach-needed item is treated as practice
  // (live) to stay on the safe side of the staffing invariant; otherwise self.
  return item.needs_coach ? 'practice' : 'self';
}

/**
 * Build the cross-paired two-group view for ONE weekday plan.
 *
 * Walks the day's slots in order. For each slot:
 *  - practice-mode (実践): the coach supervises one group this slot (alternating
 *    男子 → 女子 → 男子 …); that group's engagement is "practice" (coached=true)
 *    and the other group runs the SAME drill as "self" (coached=false). The
 *    coach-on-group pointer advances only on practice slots, so successive 実践
 *    drills alternate groups and the two groups are never both coached at once.
 *  - self-mode / repetition-lecture: both groups run it as "self" (coach floats).
 *
 * @param {PlanDay} day
 * @param {Map<string, Drill>} drillIndex
 * @param {string[]} groups  Exactly the group labels (e.g. ["男子","女子"]).
 * @returns {WeekdayGroupPlan}
 */
export function buildWeekdayCrossPair(day, drillIndex, groups) {
  /** @type {Object<string, GroupSlot[]>} */
  const columns = {};
  for (const g of groups) columns[g] = [];

  // Which group the coach supervises on the NEXT practice slot. Advances by one
  // (mod group count) each time a practice slot is consumed, giving 男子→女子→…
  let coachTurn = 0;

  for (const { block, item } of orderedSlots(day)) {
    const mode = modeOf(item, drillIndex);
    const isPractice = mode === 'practice';
    // The single coach can attend exactly one group on a practice slot.
    const coachedGroupIdx = isPractice ? coachTurn % groups.length : -1;

    groups.forEach((g, gi) => {
      const coached = gi === coachedGroupIdx;
      /** @type {GroupEngagement} */
      let engagement;
      if (isPractice) {
        // Coached group does it live (実践); the other runs it solo (自走).
        engagement = coached ? 'practice' : 'self';
      } else {
        // self-mode or already-introduced lecture repetition → 自走 for both.
        engagement = 'self';
      }
      columns[g].push({
        drill_id: item.drill_id,
        name: item.name,
        minutes: item.minutes,
        category: item.category,
        intensity_class: item.intensity_class,
        block,
        engagement,
        coached,
      });
    });

    if (isPractice) coachTurn += 1; // advance only on practice slots
  }

  return { day: day.day, kind: 'weekday', columns };
}

/**
 * Build the together (Saturday) co-ed view for ONE day plan. Both groups share
 * the session; the coach sees both, so engagement is just the drill's own mode
 * (実践 stays 実践, self stays 自走). New-skill lecture slots, if any reach the
 * blocks, render as レクチャ. No cross-pairing.
 *
 * @param {PlanDay} day
 * @param {Map<string, Drill>} drillIndex
 * @param {string[]} groups
 * @returns {TogetherGroupPlan}
 */
export function buildTogether(day, drillIndex, groups) {
  /** @type {GroupSlot[]} */
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
      engagement: mode, // self / practice / lecture, as classified
      coached: mode !== 'self', // coach attends practice & lecture on the co-ed day
    });
  }
  return { day: day.day, kind: 'together', groups: [...groups], shared };
}

/**
 * Build the two-group weekday schedule for a whole produced plan (spec ②).
 *
 * Only meaningful when the team shares one coach across groups (config.shared_gym
 * — default true). The Saturday host (coach-present longest day) is rendered as a
 * co-ed "together" session; every other day is cross-paired into 男子/女子 columns
 * with the coach alternating supervision per practice slot. When shared_gym is
 * false there is no cross-pairing to do, so an empty list is returned and callers
 * fall back to the single-column day view.
 *
 * @param {Object} args
 * @param {Plan} args.plan
 * @param {Map<string, Drill>} args.drillIndex
 * @param {import('./types.js').Config} args.config
 * @returns {Array<WeekdayGroupPlan|TogetherGroupPlan>}
 */
export function buildWeekdayGroups({ plan, drillIndex, config }) {
  const sharedGym = config.shared_gym !== false; // default: one coach, two groups
  if (!sharedGym) return [];
  const groups =
    Array.isArray(config.groups) && config.groups.length >= 2
      ? config.groups
      : DEFAULT_GROUPS;

  // The Saturday together day = the coach-present longest day (same host the
  // mixed-gender lecture lands on). It is co-ed; everything else cross-pairs.
  const host = plan.saturday_lecture?.day ?? null;

  /** @type {Array<WeekdayGroupPlan|TogetherGroupPlan>} */
  const out = [];
  for (const day of plan.days) {
    if (day.day === host) {
      out.push(buildTogether(day, drillIndex, groups));
    } else {
      out.push(buildWeekdayCrossPair(day, drillIndex, groups));
    }
  }
  return out;
}

/**
 * Verify the staffing invariant on a built weekday cross-pair: no slot index has
 * MORE THAN ONE group in "practice" (the single coach can supervise only one
 * group's live rep at a time). Returns the offending slot descriptors (empty =
 * invariant holds). Used by the gates and tests to prove ② holds structurally.
 *
 * @param {WeekdayGroupPlan} weekday
 * @returns {Array<{ slot: number, groups: string[] }>}
 */
export function findSimultaneousPractice(weekday) {
  const groupLabels = Object.keys(weekday.columns);
  if (groupLabels.length === 0) return [];
  const slotCount = weekday.columns[groupLabels[0]].length;
  /** @type {Array<{ slot: number, groups: string[] }>} */
  const violations = [];
  for (let i = 0; i < slotCount; i++) {
    const inPractice = groupLabels.filter(
      (g) => weekday.columns[g][i]?.engagement === 'practice',
    );
    if (inPractice.length > 1) violations.push({ slot: i, groups: inPractice });
  }
  return violations;
}
