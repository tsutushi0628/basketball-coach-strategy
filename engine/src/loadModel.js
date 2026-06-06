/**
 * @file Training-load budget tracker (DESIGN.md §5 F5, §6 assertLoadCap).
 *
 * High-intensity work is the scarce resource in youth basketball: too much, or
 * too many consecutive heavy days, raises injury risk in adolescents. This is a
 * tiny deterministic state machine that decides, drill-by-drill across the week,
 * whether one more high-intensity drill may be placed.
 *
 * Default-value rationale (encoded in config.load_caps, surfaced here as the
 * knobs this model honors):
 *   - high_intensity_per_session / per_week caps — concurrent + weekly volume
 *     ceilings. Source kind: NSCA youth resistance/plyometric training position
 *     guidance (limit weekly high-intensity exposure for skeletally immature
 *     athletes). Treated here as config-supplied team policy, not hardcoded.
 *   - no_consecutive_high_days — 48h spacing heuristic between heavy lower-body
 *     / plyometric loads. Source kind: youth plyometric programming convention
 *     (allow recovery between high-impact days). Config-supplied.
 * The model itself hardcodes none of these numbers; it only enforces whatever
 * the team's config provides, so resale teams set their own policy.
 *
 * @typedef {import('./types.js').Drill} Drill
 * @typedef {import('./types.js').LoadCaps} LoadCaps
 */

/**
 * Create a stateful weekly load budget. Call `canPlaceHigh` before selecting a
 * high-intensity drill, `recordHigh` after placing one, and `endDay` between
 * days so the consecutive-day rule and per-session counter reset correctly.
 *
 * @param {LoadCaps} caps
 * @returns {{
 *   canPlaceHigh: () => boolean,
 *   recordHigh: () => void,
 *   endDay: () => void,
 *   weekHighCount: () => number,
 *   sessionHighCount: () => number,
 * }}
 */
export function createLoadBudget(caps) {
  const perSession = caps?.high_intensity_per_session ?? Infinity;
  const perWeek = caps?.high_intensity_per_week ?? Infinity;
  const noConsecutive = caps?.no_consecutive_high_days ?? false;

  let weekHigh = 0; // high-intensity drills placed this week
  let sessionHigh = 0; // high-intensity drills placed in the current day
  let prevDayHadHigh = false; // did the previous (closed) day place any high drill?

  return {
    /** Can one more high-intensity drill be placed in the current day? */
    canPlaceHigh() {
      if (sessionHigh >= perSession) return false;
      if (weekHigh >= perWeek) return false;
      if (noConsecutive && prevDayHadHigh) return false;
      return true;
    },
    /** Record that a high-intensity drill was placed in the current day. */
    recordHigh() {
      sessionHigh += 1;
      weekHigh += 1;
    },
    /** Close the current day: roll the consecutive-day flag, reset session counter. */
    endDay() {
      prevDayHadHigh = sessionHigh > 0;
      sessionHigh = 0;
    },
    weekHighCount() {
      return weekHigh;
    },
    sessionHighCount() {
      return sessionHigh;
    },
  };
}

/**
 * Convenience predicate: is this drill high-intensity (and therefore subject to
 * the budget)? Mirrors the normalized `isHigh` flag.
 * @param {Drill} drill
 * @returns {boolean}
 */
export function isHighIntensity(drill) {
  return drill.isHigh === true || drill.intensity_class === '高';
}
