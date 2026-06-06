/**
 * @file Orchestration: drills + config + team input → a validated weekly plan.
 *
 * Pipeline (all deterministic):
 *   1. gap.js        → finalWeights / mainFocus / ftOnlyCategories
 *   2. filter.js     → per-day pool (court / grades / zone / sets)
 *   3. loadModel.js  → one weekly high-intensity budget shared across days
 *   4. allocate.js   → fill each day's blocks from its pool under the budget
 *   5. gates.js      → re-assert every invariant; throw on any violation
 *
 * The plan is only returned after every hard gate passes, so callers can trust
 * a returned plan is constraint-clean.
 *
 * @typedef {import('./types.js').Drill} Drill
 * @typedef {import('./types.js').Config} Config
 * @typedef {import('./types.js').TeamInput} TeamInput
 * @typedef {import('./types.js').Plan} Plan
 */

import { computeFinalWeights } from './gap.js';
import { filterPoolForDay } from './filter.js';
import { createLoadBudget } from './loadModel.js';
import { allocateDay } from './allocate.js';
import { runAllGates } from './gates.js';

/**
 * Build the weekly philosophy-floor tracker from config.philosophy_floors:
 * category → minimum minutes still owed this week. Empty when no floors set.
 * @param {Config} config
 * @returns {Map<string, number>}
 */
function buildFloorTracker(config) {
  /** @type {Map<string, number>} */
  const tracker = new Map();
  const floors = config.philosophy_floors ?? {};
  for (const [cat, spec] of Object.entries(floors)) {
    const min = Number(spec?.min_minutes_per_week ?? 0);
    if (min > 0) tracker.set(cat, min);
  }
  return tracker;
}

/**
 * Build a focus summary line from the top categories of finalWeights.
 * @param {Object<string, number>} finalWeights
 * @returns {string}
 */
function buildFocusSummary(finalWeights) {
  const top = Object.entries(finalWeights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([c, w]) => `${c}(${Math.round(w * 100)}%)`);
  return `今週の重点: ${top.join(' / ')}`;
}

/**
 * Generate a validated weekly practice plan.
 *
 * @param {Drill[]} drills      Normalized drills (call normalizeDrills first).
 * @param {Config} config
 * @param {TeamInput} teamInput
 * @returns {Plan}
 * @throws if any hard gate fails (indicates an allocate/budget bug).
 */
export function planWeek(drills, config, teamInput) {
  const { finalWeights, ftOnlyCategories, mainFocus } = computeFinalWeights(config, teamInput);

  // One budget for the whole week so per-week caps and the consecutive-day rule
  // span days (allocateDay calls budget.endDay() at each day boundary).
  const budget = createLoadBudget(config.load_caps ?? {});

  // Week-scope used ids: a drill is not repeated across 火水木金土 (spec #3).
  /** @type {Set<string>} */
  const usedIds = new Set();

  // Philosophy floors (spec #2): track each floor category's still-owed weekly
  // minutes; allocateDay decrements it as it places floors on coach-present days.
  const floorTracker = buildFloorTracker(config);

  const days = (config.schedule ?? []).map((scheduleDay) => {
    const dayPool = filterPoolForDay(drills, config, scheduleDay.court);
    return allocateDay({
      scheduleDay,
      dayPool,
      finalWeights,
      ftOnlyCategories,
      budget,
      usedIds,
      config,
      floorTracker,
    });
  });

  /** @type {Plan} */
  const plan = {
    team_id: config.team_id,
    month: config.current_month,
    phase: config.phase,
    days,
    focus_summary: buildFocusSummary(finalWeights),
    notes: `守備方針: ${config.philosophy?.df ?? '—'} / ショットクロック ${config.philosophy?.shot_clock_sec ?? '—'}秒`,
    // Spec #4: best-effort gates (philosophy floor / underfill) push non-fatal
    // notices here. Initialized so consumers can always read an array.
    warnings: [],
  };

  // Final defense line: re-check every invariant on the produced plan.
  const drillIndex = new Map(drills.map((d) => [d.id, d]));
  runAllGates({ plan, config, drillIndex, mainFocus });

  return plan;
}
