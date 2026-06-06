/**
 * @file Deterministic drill-pool filtering (DESIGN.md §5).
 *
 * Removes drills that cannot legally appear in a given day's plan:
 *  - F1 court: full-court-only drills cannot go on half-court days
 *  - F2 grades: drill grades must intersect the team's target grades
 *  - F3 zone:   middle-school teams exclude zone-system drills
 *  - F4 sets:   in-year set-play exclusion when sets_forbidden_in_year
 *
 * Load-budget exclusion (F5: high-intensity per session/week, no-consecutive-day)
 * is stateful and lives in loadModel.js — it is applied at selection time in
 * allocate.js, not here, because it depends on the day's running budget.
 *
 * All matching is plain keyword/regex on normalized fields — no LLM.
 *
 * @typedef {import('./types.js').Drill} Drill
 * @typedef {import('./types.js').Config} Config
 */

/** Zone keyword (F3). Matched against name/category/notes/tags. */
const ZONE_RE = /ゾーン|zone/i;
/** Set-play keyword (F4). Matched against name/notes only (per spec). */
const SETS_RE = /セット|セットオフェンス/;

/**
 * Mastery stages that are self-runnable on a coach-absent day. New acquisition
 * ("習得") needs a coach, so it (and any compound transition still involving
 * acquisition, e.g. "習得→反復") is NOT self-runnable. Minimal spec-faithful
 * reading: allow only the settled stages "反復" / "実戦化" exactly.
 */
const COACH_ABSENT_MASTERY = new Set(['反復', '実戦化']);

/**
 * Default categories that are safe for players to run on their own when no coach
 * is present, used only as a fallback when config.coach_absent_allow is absent.
 * Team-system categories (チームディフェンス系 / チームオフェンス系) are
 * deliberately excluded — new team installs need a coach.
 */
const DEFAULT_COACH_ABSENT_ALLOW = [
  'ファンダメンタル基礎',
  'シュート',
  'ハンドリング/ドリブル',
  'フィニッシュ(ゴール下/レイアップ)',
  '意思決定/ゲーム形式',
  'コンディショニング/ウォームアップ',
];

/**
 * Conditioning / warm-up category: warm-up and cool-down stretch / mobility work
 * is space-agnostic (done on the sideline / baseline in whatever space is free),
 * so the full-court footprint restriction does not apply to it. Many catalog
 * stretch drills list `court: 全面` only because the team does them together in
 * the gym, not because they need a full court — applying F1 to them would empty
 * the WU/CD blocks on half-court days. F2 grades / F3 zone / F4 sets still apply.
 */
const CONDITIONING_CATEGORY = 'コンディショニング/ウォームアップ';

/**
 * F1: does a drill fit on a day with the given available court?
 * Only `requiresFull` (minimum footprint = full court) drills are excluded on
 * non-full days. ¼ / 半面 / 不問 always fit on any day. Conditioning / warm-up
 * stretch & mobility work is exempt (space-agnostic — see CONDITIONING_CATEGORY).
 *
 * @param {Drill} drill
 * @param {string} dayCourt  The court available that day ("全面" | "半面" | ...).
 * @returns {boolean}
 */
export function courtFits(drill, dayCourt) {
  const fullDay = String(dayCourt).includes('全面');
  if (fullDay) return true;
  if (drill.category === CONDITIONING_CATEGORY) return true; // WU/CD fit in any space
  return !drill.requiresFull;
}

/**
 * F2: do the drill's grades intersect the team's target grades?
 * "全" always fits; an array fits when it shares at least one grade.
 *
 * @param {Drill} drill
 * @param {Array<1|2|3>} teamGrades
 * @returns {boolean}
 */
export function gradesFit(drill, teamGrades) {
  if (drill.grades === '全') return true;
  if (!Array.isArray(teamGrades) || teamGrades.length === 0) return true;
  return drill.grades.some((g) => teamGrades.includes(g));
}

/**
 * F3: zone-system drill? Checks name/category/notes/philosophy_tags/sub_skill for
 * the zone keyword. Spec #2: sub_skill is now included so a zone drill whose only
 * "ゾーン/zone" marker lives in sub_skill (or in a philosophy_tag) cannot slip past
 * the middle-school zone ban. Keeps the exact vocabulary (ゾーン/zone) to avoid
 * over-matching; deliberately not the broad searchText.
 *
 * @param {Drill} drill
 * @returns {boolean}
 */
export function isZoneDrill(drill) {
  const hay = [
    drill.name,
    drill.category,
    drill.notes,
    drill.sub_skill,
    drill.philosophy_tags.join(' '),
  ]
    .filter(Boolean)
    .join(' ');
  return ZONE_RE.test(hay);
}

/**
 * F4: set-play drill? Checks name/notes/philosophy_tags/sub_skill for the set
 * keyword. Spec #2: philosophy_tags and sub_skill are now included so an in-year-
 * forbidden set play tagged/sub-skilled (not named) "セット" cannot slip past the
 * filter. Keeps the exact vocabulary (セット) to avoid over-matching; deliberately
 * not the broad searchText.
 *
 * @param {Drill} drill
 * @returns {boolean}
 */
export function isSetsDrill(drill) {
  const hay = [drill.name, drill.notes, drill.sub_skill, drill.philosophy_tags.join(' ')]
    .filter(Boolean)
    .join(' ');
  return SETS_RE.test(hay);
}

/**
 * Year-window predicate for the in-year set-play filter.
 * Spec treats current_month>=8 || current_month<=12 as in-year (i.e. months
 * 1-12 — effectively always in-year, but kept explicit so the contract is
 * auditable and a future "off-season" carve-out has an obvious home).
 *
 * @param {number} month
 * @returns {boolean}
 */
export function isInYear(month) {
  return month >= 8 || month <= 12;
}

/**
 * Whether a drill is forbidden by the team's philosophy/calendar regardless of
 * the day (zone for middle school, in-year set plays). Court/grade fit are
 * day-dependent and handled separately.
 *
 * @param {Drill} drill
 * @param {Config} config
 * @returns {boolean}
 */
export function isGloballyForbidden(drill, config) {
  // F3 zone — only when this is a middle-school team and zone is forbidden.
  if (config.category === '中学' && config.philosophy?.zone_forbidden && isZoneDrill(drill)) {
    return true;
  }
  // F4 sets — in-year, when forbidden.
  if (
    config.philosophy?.sets_forbidden_in_year &&
    isInYear(config.current_month) &&
    isSetsDrill(drill)
  ) {
    return true;
  }
  return false;
}

/**
 * Coach-absent eligibility (spec #1). On a day the coach is not present, a drill
 * may only be placed if it is player-self-runnable:
 *  - its category is in `coach_absent_allow` (falls back to a sensible default
 *    list when the config omits it). Team-system categories are excluded here.
 *  - its mastery_stage is a settled stage ("反復" / "実戦化") — new acquisition
 *    ("習得", and compound transitions involving it) needs a coach.
 *
 * Game-form drills (意思決定/ゲーム形式) are allowed by the category list; the
 * settled-mastery requirement keeps them to established forms (3-on-3 etc.),
 * which players can run themselves. We do not parse player counts from free
 * text — minimal, deterministic reading per spec.
 *
 * @param {Drill} drill
 * @param {Config} [config]
 * @returns {boolean}
 */
export function isCoachAbsentEligible(drill, config) {
  const allow = config?.coach_absent_allow ?? DEFAULT_COACH_ABSENT_ALLOW;
  if (!allow.includes(drill.category)) return false;
  if (!COACH_ABSENT_MASTERY.has(drill.mastery_stage)) return false;
  return true;
}

/**
 * Filter the full drill pool for a single day: applies court (F1), grades (F2),
 * zone (F3) and sets (F4). Load-budget (F5) is applied later at selection time.
 *
 * @param {Drill[]} drills
 * @param {Config} config
 * @param {string} dayCourt
 * @returns {Drill[]}
 */
export function filterPoolForDay(drills, config, dayCourt) {
  const grades = config.grades ?? [];
  return drills.filter(
    (d) =>
      courtFits(d, dayCourt) &&
      gradesFit(d, grades) &&
      !isGloballyForbidden(d, config),
  );
}
