/**
 * @file Orchestration: drills + config + team input → a validated weekly plan.
 *
 * Pipeline (all deterministic):
 *   1. gap.js        → finalWeights / mainFocus / ftOnlyCategories
 *   2. filter.js     → per-day pool (court / grades / zone / sets)
 *   3. loadModel.js  → one weekly high-intensity budget shared across days
 *   4. allocate.js   → fill each day's FIXED 6-block session from its pool under the budget
 *   5. gates.js      → re-assert every invariant; throw on any violation
 *
 * 上から目標分解（作り直し方針1）: 週の焦点（year→phase→month headline→week）は外から渡す。
 * 呼び出し側（CLI/UI）は annualPlan.resolveWeekFocus で週の焦点を解決し、weekFocus として渡す。
 * weekFocus が無い呼び出しでは config から最小の既定（段階バイアスなし・全面日のみ5on5可）を組む。
 * 週目標は「組んだ結果の後付け要約」ではなく、降ろした weekFocus.headline を真実源にする。
 *
 * @typedef {import('./types.js').Drill} Drill
 * @typedef {import('./types.js').Config} Config
 * @typedef {import('./types.js').TeamInput} TeamInput
 * @typedef {import('./types.js').Plan} Plan
 * @typedef {import('./types.js').WeekFocus} WeekFocus
 */

import { computeFinalWeights } from './gap.js';
import { filterPoolForDay } from './filter.js';
import { createLoadBudget } from './loadModel.js';
import { allocateDay } from './allocate.js';
import { runAllGates } from './gates.js';
import { buildSaturdayLecture, pickLectureDay } from './lecture.js';

/**
 * A minimal default week focus when the caller does not supply one (standalone CLI / tests).
 * No mastery bias (no acquisition/repetition tilt) and scrimmage allowed — so a full-court day
 * can still end with a 5-on-5 the way the coach expects when no week layer is wired up.
 * @returns {WeekFocus}
 */
function defaultWeekFocus(config) {
  return {
    headline: config?.phase ? `${config.phase}の重点を反復で固める` : '今週の重点を反復で固める',
    mastery_bias: [],
    allow_scrimmage: true,
  };
}

/**
 * Generate a validated weekly practice plan.
 *
 * @param {Drill[]} drills      Normalized drills (call normalizeDrills first).
 * @param {Config} config
 * @param {TeamInput} teamInput
 * @param {WeekFocus} [weekFocus]  The week's focus, resolved top-down (resolveWeekFocus).
 *   When omitted, a minimal default derived from config is used.
 * @returns {Plan}
 * @throws if any hard gate fails (indicates an allocate/budget bug).
 */
export function planWeek(drills, config, teamInput, weekFocus) {
  const { finalWeights, ftOnlyCategories, mainFocus } = computeFinalWeights(config, teamInput);
  const focus = weekFocus ?? defaultWeekFocus(config);

  // One budget for the whole week so per-week caps and the consecutive-day rule
  // span days (allocateDay calls budget.endDay() at each day boundary).
  const budget = createLoadBudget(config.load_caps ?? {});

  // Week-scope used ids: a drill is not repeated across 火水木金土 (variety).
  /** @type {Set<string>} */
  const usedIds = new Set();

  // Time-series gate: NEW lecture-mode drills (not yet taught) are withheld from weekday
  // (火水木金) practice and only surface on the Saturday lecture host so they can be
  // introduced. Identify that host day up front so the per-day filter knows which day is
  // allowed to carry not-yet-introduced lecture drills.
  const introducedSet = new Set(config.introduced ?? []);
  const schedule = config.schedule ?? [];
  const lectureHost = pickLectureDay(
    schedule.map((s) => ({ day: s.day, minutes: s.minutes, coach_present: s.coach_present })),
  );
  const lectureHostDay = lectureHost?.day ?? null;

  const days = schedule.map((scheduleDay) => {
    const isLectureHost = scheduleDay.day === lectureHostDay;
    const dayPool = filterPoolForDay(drills, config, scheduleDay.court, {
      excludeNewLecture: !isLectureHost,
      introduced: introducedSet,
      day: scheduleDay.day, // F6: enforce 曜日限定（only_days）for this weekday
    });
    return allocateDay({
      scheduleDay,
      dayPool,
      finalWeights,
      ftOnlyCategories,
      budget,
      usedIds,
      config,
      weekFocus: focus,
    });
  });

  /** @type {Plan} */
  const plan = {
    team_id: config.team_id,
    month: config.current_month,
    phase: config.phase,
    days,
    // 週目標は上から降ろした週の焦点（後付け要約を撤去）。
    focus_summary: `今週の焦点: ${focus.headline}`,
    week_focus: focus,
    notes: `守備方針: ${config.philosophy?.df ?? '—'} / ショットクロック ${config.philosophy?.shot_clock_sec ?? '—'}秒`,
    saturday_lecture: null,
    introduced: [...(config.introduced ?? [])],
    warnings: [],
  };

  // Final defense line: re-check every invariant on the produced plan.
  const drillIndex = new Map(drills.map((d) => [d.id, d]));
  runAllGates({ plan, config, drillIndex, mainFocus, weekFocus: focus });

  // Post-pass: stage this week's NEW lecture-mode drills as one mixed-gender Saturday lecture
  // and return the updated introduced roster. Pure derivation over the produced plan.
  const { saturdayLecture, introduced } = buildSaturdayLecture({
    plan,
    drillIndex,
    introduced: config.introduced ?? [],
  });
  plan.saturday_lecture = saturdayLecture;
  plan.introduced = introduced;

  return plan;
}
