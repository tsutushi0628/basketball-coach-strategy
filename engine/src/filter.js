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
 * Categories that are inherently contact / tactical: each rep is a live read
 * against a teammate (or a team system being installed), so a coach's eye is
 * needed to coach the decision, spacing, and matchup in real time. These four
 * catalog categories are coach-required regardless of mastery stage.
 *
 * Kept as the *exact* catalog category strings so the test is a simple set
 * membership, not a fuzzy substring guess.
 */
const NEEDS_COACH_CATEGORIES = new Set([
  '1on1',
  'チームディフェンス(オールコートマンツー/ヘルプ/帰陣)',
  'チームオフェンス(アーリー/トランジション)',
  '意思決定/ゲーム形式',
]);

/**
 * New-acquisition mastery stage. A drill the team is still *acquiring* needs a
 * coach to correct form and build the rep correctly; once it settles into
 * 反復/実戦化 players can run it themselves. Any stage whose first segment is
 * "習得" (incl. compound transitions "習得→反復" / "習得→実戦化") counts.
 */
const ACQUISITION_STAGE = '習得';

/**
 * Name / sub_skill keywords that mark a drill as contact, defensive, live, or
 * matchup work even when its *category* is a fundamentals/finishing bucket
 * (e.g. a layup done against a live defender, a closeout, a 2on2 read). When any
 * of these appear, a coach is needed to coach the contact/decision. Matched
 * against name + sub_skill only (not the broad searchText) to avoid over-firing.
 */
const NEEDS_COACH_KEYWORD_RE =
  /対人|守備|ディフェンス|人付き|ライブ|クローズアウト|マッチアップ|1対1|2対2|3対3|2on2|3on3|2on1|3on2|ゲーム/i;

/**
 * Does a drill require a coach's eye (要コーチ) vs. being player-self-runnable
 * in isolation (自走)?
 *
 * Deterministic rule (DESIGN.md coach-context, spec):
 *   needs_coach = true when ANY of:
 *     (a) category is a contact/tactical category (NEEDS_COACH_CATEGORIES), or
 *     (b) mastery_stage is new acquisition (starts with "習得"), or
 *     (c) name/sub_skill carries a contact/defensive/live/matchup keyword.
 *   Otherwise false — isolated repetition work (マイカン, スポット/Tポイント
 *   shooting, form shooting, handling, footwork, conditioning, stretch) is 自走.
 *
 * Override: a drill record may carry an explicit `needs_coach` boolean to
 * hand-correct a borderline case; when present it wins over the derived rule.
 * The catalog stays derivation-as-single-source-of-truth — overrides are the
 * rare exception, never a bulk write.
 *
 * This is intentionally distinct from `isCoachAbsentEligible`. That predicate
 * answers "can players self-run this on a coach-absent *day*?" and is gated by
 * the team's `coach_absent_allow` policy list. `needsCoach` answers the
 * per-drill property "does this drill need a coach at all?", independent of any
 * day or team policy — a brand-new 習得 shooting drill is needs_coach=true (new
 * acquisition) even though シュート sits in the self-run allow list.
 *
 * @param {Drill} drill
 * @returns {boolean}
 */
export function needsCoach(drill) {
  // Override wins when explicitly set on the record (boolean only).
  if (typeof drill.needs_coach === 'boolean') return drill.needs_coach;

  // (a) contact / tactical category.
  if (NEEDS_COACH_CATEGORIES.has(drill.category)) return true;

  // (b) new acquisition — any stage beginning with 習得 (incl. 習得→…).
  if (String(drill.mastery_stage).startsWith(ACQUISITION_STAGE)) return true;

  // (c) contact / defensive / live / matchup keyword in name or sub_skill.
  const hay = `${drill.name ?? ''} ${drill.sub_skill ?? ''}`;
  if (NEEDS_COACH_KEYWORD_RE.test(hay)) return true;

  return false;
}

/**
 * Explain *why* `needsCoach` returned the value it did (for the classify audit
 * report). Returns the first matching rule in the same precedence order
 * needsCoach evaluates, so the reason always matches the verdict.
 *
 * @param {Drill} drill
 * @returns {{ needs_coach: boolean, reason: string }}
 */
export function needsCoachReason(drill) {
  if (typeof drill.needs_coach === 'boolean') {
    return { needs_coach: drill.needs_coach, reason: 'override(レコード指定)' };
  }
  if (NEEDS_COACH_CATEGORIES.has(drill.category)) {
    return { needs_coach: true, reason: `対人・戦術カテゴリ(${drill.category})` };
  }
  if (String(drill.mastery_stage).startsWith(ACQUISITION_STAGE)) {
    return { needs_coach: true, reason: `新規習得(習熟:${drill.mastery_stage})` };
  }
  const hay = `${drill.name ?? ''} ${drill.sub_skill ?? ''}`;
  const m = NEEDS_COACH_KEYWORD_RE.exec(hay);
  if (m) {
    return { needs_coach: true, reason: `対人/守備キーワード「${m[0]}」` };
  }
  return { needs_coach: false, reason: '孤立反復(該当ルールなし)' };
}

/**
 * Categories that are inherently *live / contact* practice: each rep is a read
 * against a teammate or a team system. A needs_coach drill in one of these is
 * "実践" (practice) — the coach watches a group rather than teaching a new skill.
 * These are the four contact/tactical categories (same set as NEEDS_COACH_
 * CATEGORIES) used here as the practice-vs-lecture discriminator.
 */
const PRACTICE_CATEGORIES = NEEDS_COACH_CATEGORIES;

/**
 * Name / sub_skill keywords that mark a drill as *live / contact* even when its
 * category is a fundamentals/finishing bucket (a layup vs. a live defender, a
 * closeout, a 2on2 read). When a needs_coach drill carries one of these it is
 * "実践" (a contact rep to supervise), not "レクチャ" (a brand-new skill to teach).
 * Matched against name + sub_skill only, mirroring the needsCoach keyword gate.
 */
const PRACTICE_KEYWORD_RE = NEEDS_COACH_KEYWORD_RE;

/**
 * Three-way coaching mode for a drill (DESIGN.md coach-context, spec):
 *   - "self"     (自走): the drill does not need a coach at all (needsCoach=false).
 *                マイカン / フォーム反復 / ハンドリング / 整理運動 …
 *   - "practice" (実践): needs a coach AND is live/contact work — a tactical
 *                category, or a contact/defensive/live/matchup keyword in
 *                name/sub_skill. The coach supervises a group's reps.
 *                1on1 / チームDF / 人付きレイアップ / クローズアウト …
 *   - "lecture"  (レクチャ): needs a coach but is NOT live/contact — i.e. a new
 *                non-contact skill being acquired (フォームシューティング / パワー
 *                レイアップ / ユーロステップ …). These are taught, so their intro
 *                can be batched into a single mixed-gender Saturday lecture.
 *
 * Mode is layered on `needsCoach` (single source of truth for 自走 vs 要コーチ),
 * so a per-record `needs_coach` override flows through automatically: a record
 * forced needs_coach=true is classified practice/lecture by the live/contact
 * test; forced needs_coach=false is always self. A record may also carry an
 * explicit `coaching_mode` (self/practice/lecture) to hand-correct a borderline
 * case — when present (and valid) it wins over the derivation.
 *
 * @param {Drill} drill
 * @returns {"self"|"practice"|"lecture"}
 */
export function coachingMode(drill) {
  // Explicit per-record mode override wins (rare hand-fix, never a bulk write).
  if (drill.coaching_mode === 'self' || drill.coaching_mode === 'practice' || drill.coaching_mode === 'lecture') {
    return drill.coaching_mode;
  }
  // 自走: a drill that needs no coach is self, full stop.
  if (!needsCoach(drill)) return 'self';
  // 実践 vs レクチャ: live/contact (category or keyword) ⇒ practice, else lecture.
  if (PRACTICE_CATEGORIES.has(drill.category)) return 'practice';
  const hay = `${drill.name ?? ''} ${drill.sub_skill ?? ''}`;
  if (PRACTICE_KEYWORD_RE.test(hay)) return 'practice';
  return 'lecture';
}

/**
 * Explain *why* `coachingMode` returned what it did (for the classify audit).
 * Returns the first matching rule in the same precedence order coachingMode
 * evaluates, so the reason always matches the verdict.
 *
 * @param {Drill} drill
 * @returns {{ mode: "self"|"practice"|"lecture", reason: string }}
 */
export function coachingModeReason(drill) {
  if (drill.coaching_mode === 'self' || drill.coaching_mode === 'practice' || drill.coaching_mode === 'lecture') {
    return { mode: drill.coaching_mode, reason: 'override(coaching_mode指定)' };
  }
  if (!needsCoach(drill)) {
    return { mode: 'self', reason: `自走(${needsCoachReason(drill).reason})` };
  }
  if (PRACTICE_CATEGORIES.has(drill.category)) {
    return { mode: 'practice', reason: `実践・対人/戦術カテゴリ(${drill.category})` };
  }
  const hay = `${drill.name ?? ''} ${drill.sub_skill ?? ''}`;
  const m = PRACTICE_KEYWORD_RE.exec(hay);
  if (m) {
    return { mode: 'practice', reason: `実践・対人/守備キーワード「${m[0]}」` };
  }
  return { mode: 'lecture', reason: `レクチャ・新規習得の非対人スキル(${needsCoachReason(drill).reason})` };
}

/**
 * Time-series gate for lecture-mode drills (spec ①). A lecture-mode drill is a
 * NEW non-contact skill that has to be *taught* before players can rep it. The
 * correct chronology is: introduce it once in the mixed-gender Saturday lecture,
 * THEN let players repeat it on the following weeks' weekdays. So a lecture-mode
 * drill that is NOT yet in `introduced` must not be placed in the weekday
 * (火水木金) practice this week — it hasn't been taught. Once it lands in the
 * Saturday lecture it is added to `introduced`, and from the next week on it is
 * a settled skill players self-run on weekdays.
 *
 * This predicate answers "is this a brand-new lecture drill we may not yet drop
 * into weekday practice?" — true only for lecture-mode drills absent from the
 * introduced roster. practice-mode and self-mode drills are never gated here
 * (practice = live contact done on weekdays under the coach; self = self-run);
 * an already-introduced lecture drill is also free (it is now repetition).
 *
 * @param {Drill} drill
 * @param {Set<string>|string[]} [introduced]  Drill ids already taught (prior weeks).
 * @returns {boolean}
 */
export function isNewLecture(drill, introduced) {
  if (coachingMode(drill) !== 'lecture') return false;
  const known = introduced instanceof Set ? introduced : new Set(introduced ?? []);
  return !known.has(drill.id);
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
 * zone (F3), sets (F4) and — on weekday practice — the lecture time-series gate
 * (spec ①): a NEW lecture-mode drill (not yet in `introduced`) is withheld from
 * weekday practice this week because it has not been taught yet; it is introduced
 * in the Saturday mixed-gender lecture and only repeated on weekdays afterwards.
 * The Saturday host day passes `excludeNewLecture=false` so the lecture can still
 * surface those drills to introduce. Load-budget (F5) is applied later at
 * selection time.
 *
 * @param {Drill[]} drills
 * @param {Config} config
 * @param {string} dayCourt
 * @param {Object} [opts]
 * @param {boolean} [opts.excludeNewLecture]  Withhold not-yet-introduced lecture
 *   drills (weekday practice). Default false (no time-series gate).
 * @param {Set<string>|string[]} [opts.introduced]  Ids already taught (prior weeks).
 * @returns {Drill[]}
 */
export function filterPoolForDay(drills, config, dayCourt, opts = {}) {
  const grades = config.grades ?? [];
  const { excludeNewLecture = false, introduced } = opts;
  const known = introduced instanceof Set ? introduced : new Set(introduced ?? []);
  return drills.filter(
    (d) =>
      courtFits(d, dayCourt) &&
      gradesFit(d, grades) &&
      !isGloballyForbidden(d, config) &&
      !(excludeNewLecture && isNewLecture(d, known)),
  );
}
