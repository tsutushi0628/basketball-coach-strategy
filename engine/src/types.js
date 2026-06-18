/**
 * @file JSDoc type definitions shared across the practice-plan engine.
 * These are documentation-only typedefs (no runtime exports). Import via
 * `/** @type {import('./types.js').Drill} *\/` style annotations.
 */

// ---------------------------------------------------------------------------
// Domain enums (string unions)
// ---------------------------------------------------------------------------

/**
 * Normalized court requirement.
 * - "全面": full-court required (excluded on half-court days)
 * - "半面": half-court is the minimum footprint (fits half-court and full-court days)
 * - "¼":   quarter-court minimum
 * - "不問": no court constraint (off-court, circle, etc.)
 * @typedef {"全面"|"半面"|"¼"|"不問"} CourtEnum
 */

/**
 * Normalized intensity class.
 * @typedef {"低"|"中"|"高"} IntensityClass
 */

/**
 * Three-way coaching mode for a drill (DESIGN.md coach-context).
 * - "self":     self-runnable, needs no coach (自走).
 * - "practice": needs a coach AND is live/contact work to supervise (実践).
 * - "lecture":  needs a coach for a new non-contact skill to teach (レクチャ);
 *               its intro can be batched into the mixed-gender Saturday lecture.
 * @typedef {"self"|"practice"|"lecture"} CoachingMode
 */

/**
 * Grade applicability. Either the literal "全" (all grades) or an ascending
 * array of middle-school year integers (1|2|3).
 * @typedef {"全"|Array<1|2|3>} Grades
 */

// ---------------------------------------------------------------------------
// Drill (after normalization)
// ---------------------------------------------------------------------------

/**
 * A practice drill after `normalizeDrill()` has coerced the raw free-text
 * fields into typed values. Raw provenance fields are preserved verbatim.
 *
 * @typedef {Object} Drill
 * @property {string} id            Stable drill id (e.g. "HND-001").
 * @property {string} name          Display name (Japanese).
 * @property {string} category      Catalog category (matches Config weight keys).
 * @property {string} sub_skill     Sub-skill descriptor (free text, used for FT matching).
 * @property {string} metric_meaning  What the drill is meant to move (free text).
 * @property {CourtEnum} court      Normalized court footprint enum.
 * @property {boolean} requiresFull  True only when the minimum footprint is full court.
 * @property {string} courtRaw      Original free-text court value (audit trail).
 * @property {number} duration_min  Minutes, minimum (default 10 when missing).
 * @property {number} duration_max  Minutes, maximum (default 15 when missing).
 * @property {Grades} grades        Normalized grade applicability.
 * @property {string} gradesRaw     Original free-text grades value (audit trail).
 * @property {IntensityClass} intensity_class  Normalized intensity.
 * @property {boolean} isHigh       Convenience flag: intensity_class === "高".
 * @property {string} load_notes    Load caveats (free text).
 * @property {string} mastery_stage Mastery progression note (free text).
 * @property {string[]} philosophy_tags  Philosophy/skill tags (used in keyword filters).
 * @property {'solo'|'pair'|'small'|'team'|'group'} peopleShape  Coarse group-shape
 *                                  enum derived from free-text `people`; ranks
 *                                  "いずれか" alternatives by drill form.
 * @property {string} peopleRaw     Original free-text people value (audit trail).
 * @property {boolean} needs_helper  Whether the drill needs a helper (pad/feeder/coach);
 *                                  used in alternative-affinity to keep staffing similar.
 * @property {string[]} [only_days]  Weekday labels this drill may appear on (e.g. ["土"] for
 *                                  シャトルラン＝土曜限定). Absent ⇒ no weekday restriction. The
 *                                  per-day filter drops the drill on any other weekday.
 * @property {string} notes         Free-text notes (used in zone/sets keyword filters).
 * @property {string} [source_name] Attribution.
 * @property {string} [source_url]  Attribution URL.
 * @property {string} [video_url]   Demo video URL.
 * @property {string} [provenance]  "手持ち" | "収集".
 * @property {string} [source_kind] "external" | "team_original".
 * @property {boolean} [needs_coach]  Optional manual override for the needsCoach
 *                                  derivation (要コーチ=true / 自走=false). When
 *                                  present it wins over the derived rule; absent
 *                                  for the vast majority (derivation is the SoT).
 * @property {CoachingMode} [coaching_mode]  Optional manual override for the
 *                                  three-way coachingMode derivation
 *                                  (self/practice/lecture). When present it wins
 *                                  over the derived rule; absent for the vast
 *                                  majority (derivation is the SoT).
 * @property {string} searchText    Lowercased concatenation of keyword fields
 *                                  (name+category+notes+sub_skill+tags+gradesRaw)
 *                                  used by deterministic keyword filters.
 */

// ---------------------------------------------------------------------------
// Config (per-team philosophy & constraints)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Philosophy
 * @property {string} df                  Defensive identity statement (free text).
 * @property {boolean} zone_forbidden     When true, zone-system drills are excluded.
 * @property {boolean} sets_forbidden_in_year  When true, set-play drills are excluded in-year.
 * @property {number} shot_clock_sec      Shot-clock seconds used by the team.
 */

/**
 * @typedef {Object} ScheduleDay
 * @property {string} day        Weekday label (e.g. "火").
 * @property {number} minutes    Total available practice minutes that day.
 * @property {CourtEnum|string} court  Court available that day ("全面" | "半面" | ...).
 * @property {boolean} [coach_present]  Whether a coach is present that day. When
 *   false, only player-self-runnable content is placed. Defaults to true (present)
 *   when omitted.
 * @property {number} [run_minutes]  Explicit minutes for the conditioning (ラン/走り込み)
 *   block this day (e.g. an outdoor-training day = large run). When omitted the day's
 *   run share is derived from court + minutes (full-court days get a run block; half-court
 *   days get none). 0 forces no run block.
 * @property {SessionPart[]} [parts]  When present, the day is split into multiple SEPARATE
 *   sessions (区画) — e.g. 火 = 外トレ60(走り込み・アジリティ) ＋ 全面60(コート). Each part is
 *   built as its own fixed-block mini-session against its own court / run / kind, and the
 *   parts are concatenated (the day still ends with the last part's 静的). The UI renders one
 *   header + timeline per part. When omitted the day is a single session (the default).
 */

/**
 * One区画 (session part) of a multi-part day. Lets the owner program a day as two distinct
 * sessions (火 = 外トレ60 ＋ 全面60) with their own court, minutes, and emphasis (outdoor run/
 * agility vs. court). `kind:"outdoor"` builds a 走り込み・アジリティ-only session (no curriculum
 * blocks); `kind:"court"` (default) builds the normal fixed-block court session.
 * @typedef {Object} SessionPart
 * @property {string} label      Display label for this part (e.g. "外トレ" / "全面").
 * @property {number} minutes    Minutes available for this part.
 * @property {CourtEnum|string} court  Court available for this part.
 * @property {'outdoor'|'court'} [kind]  Session shape. "outdoor" = run/agility-only (走り込み・
 *   アジリティ); "court" = normal fixed-block court session. Defaults to "court".
 * @property {number} [run_minutes]  Explicit run minutes for this part (as on ScheduleDay).
 * @property {boolean} [no_funda]  Drop the ファンダ block for this part (火 全面60 = 走ってフィニッシュ
 *   →3on3→5on5, no fundamentals). Defaults to false.
 */

/**
 * The week's focus, resolved top-down (year → phase → month headline → week).
 * Drives drill selection (mastery_bias) and whether the contested block ends with
 * a 5-on-5 scrimmage (allow_scrimmage). Produced by annualPlan.resolveWeekFocus.
 * @typedef {Object} WeekFocus
 * @property {string} headline        This week's focus statement (goals.week / focus_summary SoT).
 * @property {string[]} mastery_bias  Mastery stages to prefer this week (educational-fit ordering).
 * @property {boolean} allow_scrimmage  Whether the 対人 block may end with a 5-on-5 scrimmage.
 * @property {number} [week]          The week-of-month this focus was resolved for.
 * @property {number} [arcMonth]      The arc month it was resolved from.
 */

/**
 * @typedef {Object} LoadCaps
 * @property {number} high_intensity_per_session  Max high-intensity drills per day.
 * @property {number} high_intensity_per_week     Max high-intensity drills per week.
 * @property {boolean} no_consecutive_high_days   Disallow high-intensity on consecutive days.
 */

/**
 * Per-team configuration. Nothing about team philosophy is hardcoded in the
 * engine; everything flows through this object so other teams can drop in
 * their own config for resale.
 *
 * @typedef {Object} Config
 * @property {string} team_id
 * @property {string} team_label
 * @property {string} category               Age band (e.g. "中学"); gates zone filter.
 * @property {Array<1|2|3>} grades           Target grades for this plan.
 * @property {Philosophy} philosophy
 * @property {number} current_month          1-12; drives in-year set-play filter.
 * @property {string} phase                  Macrocycle phase label (e.g. "準備").
 * @property {ScheduleDay[]} schedule        Weekly schedule.
 * @property {boolean} [shared_gym]          When true (default), one coach runs two
 *                                           groups in a shared gym, so the weekday
 *                                           rotation schedule (spec ②) is built.
 *                                           false disables it.
 * @property {string[]} [groups]             Group labels (e.g. ["男子","女子"]).
 *                                           Defaults to ["男子","女子"] when omitted.
 * @property {string[]} [coach_absent_allow]  Categories players may self-run on coach-absent days.
 * @property {string[]} [introduced]         Drill ids whose lecture-type intro has already been
 *                                           delivered (mixed-gender Saturday lecture). A lecture-mode
 *                                           drill already in this list is NOT re-introduced on Saturday
 *                                           (it is now repetition / self-run). Defaults to [] (all new).
 * @property {number} [week_of_month]        Week-of-month (1始まり) used to resolve the week's focus.
 *                                           Defaults to 1 when omitted.
 * @property {Object<string, number>} phase_category_weights  Base category weights for the phase
 *                                           (used now as a per-block category preference, not a hard floor).
 * @property {LoadCaps} load_caps
 */

// ---------------------------------------------------------------------------
// Team input (measured indicators)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Indicator
 * @property {string} id            Indicator name (e.g. "FT率"); keyed into the metric→category map.
 * @property {"up"|"down"} good_direction  Whether higher (up) or lower (down) is better.
 * @property {number} baseline      Season-start value.
 * @property {number} latest        Most recent measured value.
 * @property {number} target        Goal value.
 * @property {string} unit          Display unit (e.g. "%", "本").
 */

/**
 * @typedef {Object} TeamInput
 * @property {string} team_id
 * @property {Array<1|2|3>} grades
 * @property {Indicator[]} indicators
 */

// ---------------------------------------------------------------------------
// Plan (engine output)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} PlanItem
 * @property {string} drill_id
 * @property {string} name
 * @property {number} minutes
 * @property {string} category
 * @property {IntensityClass} intensity_class
 * @property {boolean} needs_coach  Whether this drill needs a coach's eye
 *                                  (要コーチ) vs. is player-self-runnable (自走).
 * @property {CoachingMode} [coaching_mode]  Three-way coaching mode stamped at
 *                                  allocation (self/practice/lecture) so format and
 *                                  the rotation group view can show 自走/実践/
 *                                  レクチャ without re-deriving from the catalog.
 * @property {Array<{drill_id: string, name: string}>} [alternatives]  For a main
 *                                  segment, the "いずれか" menu: same-category drills
 *                                  the coach may swap in for the primary. Display-only
 *                                  (they carry no minutes and do not consume the load
 *                                  budget); absent on warm-up / cool-down items.
 */

/**
 * @typedef {Object} PlanBlock
 * @property {"アップ"|"ファンダ"|"シュート"|"対人"|"ラン"|"静的"} block  Fixed-skeleton block key.
 *   Sessions are built as the fixed 6-block order アップ→ファンダ→シュート→対人→ラン→静的
 *   (warm-up → fundamentals → shooting → contested → conditioning run → static stretch).
 * @property {PlanItem[]} items
 * @property {number} [part]        On a multi-part day, the 0-based index of the session部 (区画)
 *                                  this block belongs to. Absent on single-session days. Blocks
 *                                  carrying the same part index form one mini-session (the fixed
 *                                  6-block order is asserted WITHIN each part).
 * @property {string} [part_label]  Display label of the part (e.g. "外トレ" / "全面"), set when
 *                                  `part` is present so the UI can split headers / timelines.
 * @property {'outdoor'|'court'} [part_kind]  The part's session shape (outdoor run/agility vs.
 *                                  court), set when `part` is present.
 */

/**
 * @typedef {Object} PlanDay
 * @property {string} day
 * @property {number} minutes              Available minutes (from schedule).
 * @property {CourtEnum|string} court      Court available that day.
 * @property {boolean} coach_present       Whether a coach is present that day.
 * @property {PlanBlock[]} blocks
 * @property {number} total_minutes        Σ of item minutes across all blocks.
 * @property {number} high_intensity_count Count of 高-intensity items that day.
 * @property {Array<{label:string, kind:string, minutes:number, court:string}>} [parts]
 *                                          On a multi-part day (火 = 外トレ60 ＋ 全面60), the
 *                                          ordered session部 metadata so the UI can render one
 *                                          header + timeline per part. Absent on single-session days.
 */

/**
 * The mixed-gender Saturday new-drill lecture (spec). Lists the lecture-mode
 * drills whose intro is being delivered together on Saturday this week (i.e.
 * lecture-mode drills that appear in the week's plan and were not yet in
 * `config.introduced`). Empty when nothing new is being introduced.
 * @typedef {Object} SaturdayLecture
 * @property {string} day                   The day the lecture is placed on (Saturday).
 * @property {Array<{drill_id: string, name: string, category: string}>} items
 *                                          The lecture-mode drills introduced this week.
 */

/**
 * @typedef {Object} Plan
 * @property {string} team_id
 * @property {number} month
 * @property {string} phase
 * @property {PlanDay[]} days
 * @property {string} focus_summary        Human-readable focus statement = the week's focus
 *                                         (resolved top-down via resolveWeekFocus, not a
 *                                         post-hoc summary of what was allocated).
 * @property {WeekFocus} [week_focus]      The resolved week focus this plan was built from.
 * @property {string} notes                Free-text planning notes.
 * @property {SaturdayLecture|null} saturday_lecture  The mixed-gender Saturday
 *                                         new-drill lecture for this week (null when
 *                                         there is no coach-present longest day to host it).
 * @property {string[]} introduced         Updated introduced list = prior introduced ∪ the
 *                                         drill ids introduced in this week's Saturday lecture.
 * @property {string[]} [warnings]         Non-fatal notices from best-effort gates
 *                                         (philosophy-floor shortfall / underfill).
 */

export {}; // mark as ES module; types are ambient via JSDoc.
