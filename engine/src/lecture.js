/**
 * @file Mixed-gender Saturday new-drill lecture (deterministic, spec).
 *
 * Context: a single coach runs a co-ed (男女合同) session. New non-contact
 * skills (lecture-mode drills — フォームシューティング / パワーレイアップ /
 * ユーロステップ …) are best introduced once, together, with the whole group
 * watching — rather than re-explained per gender / per small group. This module
 * gathers the week's *new* lecture-mode drills and stages them as one
 * mixed-gender lecture block on Saturday (the coach-present, longest day), then
 * reports the updated "already introduced" roster so next week's plan knows not
 * to re-introduce them.
 *
 * Design (no LLM, pure derivation over the produced plan):
 *   1. The week's plan is generated first (火→…→土) by the existing pipeline.
 *   2. We scan the produced plan for lecture-mode drills (coachingMode==="lecture").
 *   3. Those NOT already in `introduced` are this week's new intros.
 *   4. They are listed in a SaturdayLecture (placed on the coach-present longest
 *      day = Saturday) and added to the returned `introduced` roster.
 * Practice-mode and self-mode drills are never lectured. A lecture-mode drill
 * already in `introduced` is repetition this week, so it is not re-listed.
 *
 * Keeping this as a post-pass over the final plan (rather than threading lecture
 * state through allocate.js) keeps the allocation/gate pipeline untouched and
 * makes the introduced-roster update a pure function of (plan, prior introduced).
 *
 * @typedef {import('./types.js').Drill} Drill
 * @typedef {import('./types.js').Plan} Plan
 * @typedef {import('./types.js').PlanDay} PlanDay
 * @typedef {import('./types.js').SaturdayLecture} SaturdayLecture
 */

import { coachingMode } from './filter.js';

/**
 * Pick the day that hosts the mixed-gender lecture: the coach-present day with
 * the most available minutes (the spec's "土曜・最長枠"). Coach presence is
 * required because a lecture is taught — it cannot land on a coach-absent day.
 * Ties resolve to the later day in schedule order (Saturday sits last), which is
 * the intended host. Returns null when no coach-present day exists.
 *
 * @param {PlanDay[]} days
 * @returns {PlanDay|null}
 */
export function pickLectureDay(days) {
  /** @type {PlanDay|null} */
  let best = null;
  for (const day of days) {
    if (day.coach_present === false) continue; // lecture needs a coach present
    if (best === null || day.minutes >= best.minutes) best = day;
  }
  return best;
}

/**
 * Collect, in first-appearance order across the week, the lecture-mode drills
 * that appear in the produced plan. De-duplicated by drill id. Uses the drill
 * index to re-derive coachingMode on the real normalized record (the plan items
 * only carry needs_coach, not the three-way mode).
 *
 * @param {Plan} plan
 * @param {Map<string, Drill>} drillIndex
 * @returns {Array<{drill_id: string, name: string, category: string}>}
 */
export function collectLectureDrills(plan, drillIndex) {
  /** @type {Array<{drill_id: string, name: string, category: string}>} */
  const found = [];
  const seen = new Set();
  for (const day of plan.days) {
    for (const block of day.blocks) {
      for (const it of block.items) {
        if (seen.has(it.drill_id)) continue;
        const drill = drillIndex.get(it.drill_id);
        if (!drill) continue;
        if (coachingMode(drill) !== 'lecture') continue;
        seen.add(it.drill_id);
        found.push({ drill_id: it.drill_id, name: it.name, category: it.category });
      }
    }
  }
  return found;
}

/**
 * Build the Saturday mixed-gender new-drill lecture and the updated introduced
 * roster for a produced plan.
 *
 * @param {Object} args
 * @param {Plan} args.plan                 The produced weekly plan.
 * @param {Map<string, Drill>} args.drillIndex
 * @param {string[]} [args.introduced]     Drill ids already introduced (prior weeks). Default [].
 * @returns {{ saturdayLecture: SaturdayLecture|null, introduced: string[] }}
 */
export function buildSaturdayLecture({ plan, drillIndex, introduced = [] }) {
  const known = new Set(introduced);
  const lectureDrills = collectLectureDrills(plan, drillIndex);

  // This week's *new* intros = lecture-mode drills not yet introduced.
  const newIntros = lectureDrills.filter((d) => !known.has(d.drill_id));

  const lectureDay = pickLectureDay(plan.days);

  // No coach-present day to host a lecture → cannot introduce anything this week;
  // the roster is unchanged (those drills stay "not yet introduced" for a future
  // week that has a coach-present day).
  if (!lectureDay) {
    return { saturdayLecture: null, introduced: [...introduced] };
  }

  /** @type {SaturdayLecture} */
  const saturdayLecture = { day: lectureDay.day, items: newIntros };

  // Updated roster = prior introduced ∪ the ids introduced this Saturday,
  // preserving prior order then appending the new ids in appearance order.
  const updatedIntroduced = [...introduced];
  for (const d of newIntros) {
    if (!known.has(d.drill_id)) {
      updatedIntroduced.push(d.drill_id);
      known.add(d.drill_id);
    }
  }

  return { saturdayLecture, introduced: updatedIntroduced };
}
