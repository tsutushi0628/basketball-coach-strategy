/**
 * @file Hard gates (DESIGN.md §6). Run on a finished plan; any violation throws.
 *
 * These re-check, on the produced plan, the same invariants the filter/allocate
 * stages are supposed to guarantee. If filtering and allocation are correct the
 * gates always pass — they exist to catch allocate bugs, remainder mistakes, or
 * budget-tracking drift before a broken plan ever reaches a coach.
 *
 * Each gate throws an Error with a precise message naming the offending day /
 * drill so failures are diagnosable.
 *
 * @typedef {import('./types.js').Plan} Plan
 * @typedef {import('./types.js').PlanDay} PlanDay
 * @typedef {import('./types.js').Config} Config
 */

import { isZoneDrill, isSetsDrill, isInYear, isCoachAbsentEligible } from './filter.js';

/**
 * Flatten a plan day into its drill items.
 * @param {PlanDay} day
 * @returns {import('./types.js').PlanItem[]}
 */
function dayItems(day) {
  return day.blocks.flatMap((b) => b.items);
}

/**
 * Append a non-fatal warning to the plan (spec #3/#4). Lazily creates the
 * `plan.warnings` array so best-effort checks can surface shortfalls without
 * throwing, letting callers (and format) show them while still returning a plan.
 * @param {Plan} plan
 * @param {string} message
 */
function addPlanWarning(plan, message) {
  if (!Array.isArray(plan.warnings)) plan.warnings = [];
  plan.warnings.push(message);
}

/**
 * Gate 1 — each day's scheduled item minutes must not exceed available minutes.
 * @param {Plan} plan
 */
export function assertTimeFits(plan) {
  for (const day of plan.days) {
    const sum = dayItems(day).reduce((s, it) => s + it.minutes, 0);
    if (sum > day.minutes) {
      throw new Error(
        `assertTimeFits: ${day.day} の合計 ${sum}分 が枠 ${day.minutes}分 を超過`,
      );
    }
  }
}

/**
 * Gate 2 — no zone-system drill in the plan when the team is middle-school +
 * zone-forbidden. Looks each drill up by id in the drill index to re-check the
 * zone keyword on the real normalized record.
 *
 * @param {Plan} plan
 * @param {Config} config
 * @param {Map<string, import('./types.js').Drill>} drillIndex
 */
export function assertNoZone(plan, config, drillIndex) {
  if (!(config.category === '中学' && config.philosophy?.zone_forbidden)) return;
  for (const day of plan.days) {
    for (const it of dayItems(day)) {
      const drill = drillIndex.get(it.drill_id);
      if (drill && isZoneDrill(drill)) {
        throw new Error(
          `assertNoZone: ${day.day} に zone系ドリル「${it.name}」(${it.drill_id}) が混入`,
        );
      }
    }
  }
}

/**
 * Gate 3 — no in-year set-play drill when sets are forbidden in-year.
 *
 * @param {Plan} plan
 * @param {Config} config
 * @param {Map<string, import('./types.js').Drill>} drillIndex
 */
export function assertNoSetsInYear(plan, config, drillIndex) {
  if (!(config.philosophy?.sets_forbidden_in_year && isInYear(config.current_month))) return;
  for (const day of plan.days) {
    for (const it of dayItems(day)) {
      const drill = drillIndex.get(it.drill_id);
      if (drill && isSetsDrill(drill)) {
        throw new Error(
          `assertNoSetsInYear: ${day.day} に年内禁止のセット系「${it.name}」(${it.drill_id}) が混入`,
        );
      }
    }
  }
}

/**
 * Gate 4 — load caps: per-session high count, weekly high total, and the
 * no-consecutive-high-days rule.
 *
 * @param {Plan} plan
 * @param {Config} config
 */
export function assertLoadCap(plan, config) {
  const caps = config.load_caps ?? {};
  const perSession = caps.high_intensity_per_session ?? Infinity;
  const perWeek = caps.high_intensity_per_week ?? Infinity;
  const noConsecutive = caps.no_consecutive_high_days ?? false;

  let weekHigh = 0;
  let prevHigh = false;
  for (const day of plan.days) {
    const highCount = dayItems(day).filter((it) => it.intensity_class === '高').length;
    if (highCount > perSession) {
      throw new Error(
        `assertLoadCap: ${day.day} の高強度 ${highCount}本 がセッション上限 ${perSession}本 を超過`,
      );
    }
    weekHigh += highCount;
    if (noConsecutive && prevHigh && highCount > 0) {
      throw new Error(`assertLoadCap: 高強度が連続日に配置されている（${day.day} 含む）`);
    }
    prevHigh = highCount > 0;
  }
  if (weekHigh > perWeek) {
    throw new Error(`assertLoadCap: 週合計の高強度 ${weekHigh}本 が週上限 ${perWeek}本 を超過`);
  }
}

/**
 * Gate 5 — the macrocycle's main-focus category (highest finalWeight) must
 * appear at least once in the week.
 *
 * @param {Plan} plan
 * @param {string} mainFocus  Highest-weight category from computeFinalWeights.
 */
export function assertMainFocusPresent(plan, mainFocus) {
  if (!mainFocus) return; // nothing to assert (degenerate weights)
  const present = plan.days.some((day) =>
    dayItems(day).some((it) => it.category === mainFocus),
  );
  if (!present) {
    throw new Error(
      `assertMainFocusPresent: 最重要カテゴリ「${mainFocus}」が週内に1回も出現していない`,
    );
  }
}

/**
 * Gate 6 — philosophy floors (spec #2). Each configured floor category must
 * accumulate at least its `min_minutes_per_week`, and (when
 * `place_on_coach_days` is true) those minutes must land on coach-present days.
 * This guarantees the team's identity (all-court man defense / early offense)
 * is reflected every week even though the attack-only gap signal never raises it.
 *
 * Spec #3: this floor is best-effort, NOT a hard throw. The drill pool may
 * physically lack enough floor-category minutes to satisfy the configured minimum
 * (e.g. few team-defense drills fit the available courts/grades). Failing the
 * whole week's plan in that case is worse than returning a plan that places as
 * much of the floor as it can — so a shortfall is recorded as a warning on the
 * plan (plan.warnings) instead of throwing. The intent (put the team's core —
 * defense / fast-break — in every week) is still honored as far as the pool allows.
 *
 * @param {Plan} plan
 * @param {Config} config
 */
export function assertPhilosophyFloor(plan, config) {
  const floors = config.philosophy_floors ?? {};
  for (const [cat, spec] of Object.entries(floors)) {
    const min = Number(spec?.min_minutes_per_week ?? 0);
    if (min <= 0) continue;
    const coachOnly = spec?.place_on_coach_days === true;

    let minutes = 0;
    for (const day of plan.days) {
      // Default to coach-present when the flag is absent (matches allocateDay).
      const present = day.coach_present !== false;
      if (coachOnly && !present) continue;
      for (const it of dayItems(day)) {
        if (it.category === cat) minutes += it.minutes;
      }
    }
    if (minutes < min) {
      // Best-effort: warn, do not throw — the plan is still usable.
      addPlanWarning(
        plan,
        `哲学フロア未達: 「${cat}」が週内${minutes}分で最低${min}分に届かず` +
          (coachOnly ? '（在席日配置分のみ計上）' : '') +
          'プール上限のため配置できる分だけ配置しました',
      );
    }
  }
}

/**
 * Gate 7 — coach context (spec #1/#5). On coach-absent days, every placed drill
 * in the technical/対人/ゲーム main blocks must be player-self-runnable: its
 * category must be in coach_absent_allow and its mastery_stage must be a settled
 * stage (反復/実戦化). New acquisition ("習得") and team-system installs are
 * excluded by isCoachAbsentEligible. The warm-up/cool-down blocks (WU/CD) are
 * exempt — preparation and warm-down run every day regardless of coach presence,
 * so they are not constrained here (mirrors allocateDay's pool handling).
 *
 * @param {Plan} plan
 * @param {Config} config
 * @param {Map<string, import('./types.js').Drill>} drillIndex
 */
export function assertCoachContext(plan, config, drillIndex) {
  for (const day of plan.days) {
    if (day.coach_present !== false) continue; // only constrain coach-absent days
    for (const block of day.blocks) {
      if (block.block === 'WU' || block.block === 'CD') continue; // WU/CD run daily, coach or not
      for (const it of block.items) {
        const drill = drillIndex.get(it.drill_id);
        if (!drill) continue;
        if (!isCoachAbsentEligible(drill, config)) {
          throw new Error(
            `assertCoachContext: 指導者不在の${day.day}に自走不可ドリル「${it.name}」` +
              `(${it.drill_id}・分類:${drill.category}・習熟:${drill.mastery_stage}) が混入`,
          );
        }
      }
    }
  }
}

/**
 * Spec #4 — underfill visibility (soft, never throws). Records a plan warning
 * when a day is left well under its available minutes, or when any block ends up
 * empty. Under-filling is legal (it happens when the filtered pool can't supply
 * enough eligible drills), but it is worth surfacing so a coach knows the gym
 * time wasn't fully programmed rather than silently shipping a thin plan.
 *
 * @param {Plan} plan
 * @param {Object} [opts]
 * @param {number} [opts.minFillRatio]  Day is "under-filled" below this fraction
 *                                       of its available minutes (default 0.8).
 */
export function checkUnderfill(plan, { minFillRatio = 0.8 } = {}) {
  for (const day of plan.days) {
    const filled = dayItems(day).reduce((s, it) => s + it.minutes, 0);
    if (day.minutes > 0 && filled < day.minutes * minFillRatio) {
      addPlanWarning(
        plan,
        `${day.day}: 配置 ${filled}分 が枠 ${day.minutes}分 に対して著しく不足`,
      );
    }
    for (const block of day.blocks) {
      if (block.items.length === 0) {
        addPlanWarning(plan, `${day.day}: 「${block.block}」ブロックが空`);
      }
    }
  }
}

/**
 * Run every gate. Hard gates throw on the first violation; the best-effort
 * checks (philosophy floor / underfill) only attach warnings to plan.warnings.
 *
 * @param {Object} args
 * @param {Plan} args.plan
 * @param {Config} args.config
 * @param {Map<string, import('./types.js').Drill>} args.drillIndex
 * @param {string} args.mainFocus
 */
export function runAllGates({ plan, config, drillIndex, mainFocus }) {
  assertTimeFits(plan);
  assertNoZone(plan, config, drillIndex);
  assertNoSetsInYear(plan, config, drillIndex);
  assertLoadCap(plan, config);
  assertMainFocusPresent(plan, mainFocus);
  assertPhilosophyFloor(plan, config); // best-effort: warns, does not throw (spec #3)
  assertCoachContext(plan, config, drillIndex);
  checkUnderfill(plan); // best-effort: warns on under-filled days / empty blocks (spec #4)
}
