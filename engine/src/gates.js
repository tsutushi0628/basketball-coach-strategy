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
 * Gate 5 — the week's focus is honored: the macrocycle's main-focus category
 * (highest finalWeight) appears at least once. When the week's focus prescribes a
 * mastery bias, this still asserts the focus *category* shows up — the bias is a
 * selection preference, not a hard presence requirement.
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
 * Gate — the fixed 6-block session form is honored (作り直し方針2/3):
 *   ① every day ends with the static-stretch (静的) block — a session is never cut off
 *      by a scrimmage / run (作り直し方針: 固定ブロック順の末尾＝静的ストレッチ).
 *   ② the present blocks appear only in the fixed order アップ→ファンダ→シュート→対人→ラン→静的
 *      (empty blocks may be skipped — half-court days carry no ラン — but order never inverts).
 *   ③ no independent game block exists: 意思決定/ゲーム形式 (5on5/scrimmage) only ever appears
 *      inside the 対人 block, and only on full-court days. Half-court days carry no scrimmage.
 *
 * @param {Plan} plan
 */
export function assertSessionForm(plan) {
  const order = ['アップ', 'ファンダ', 'シュート', '対人', 'ラン', '静的'];
  const rank = new Map(order.map((b, i) => [b, i]));
  const GAME = '意思決定/ゲーム形式';

  for (const day of plan.days) {
    // A multi-part day (火 = 外トレ60 ＋ 全面60) is several mini-sessions concatenated; the fixed
    // order resets at each part boundary. Group blocks by their `part` index (single-session days
    // are one group), assert fixed order WITHIN each part, and require the WHOLE day to close with
    // the 静的 block (the last part is a court session that ends with the static stretch).
    /** @type {Map<number, import('./types.js').PlanBlock[]>} */
    const byPart = new Map();
    for (const b of day.blocks) {
      const p = Number.isInteger(b.part) ? b.part : 0;
      if (!byPart.has(p)) byPart.set(p, []);
      byPart.get(p).push(b);
    }

    for (const [partIdx, partBlocks] of byPart) {
      const keys = partBlocks.map((b) => b.block);
      const where = byPart.size > 1 ? `${day.day}[区画${partIdx}]` : day.day;

      // ② fixed order within the part (present blocks strictly increasing in the fixed rank).
      let prev = -1;
      for (const k of keys) {
        const r = rank.get(k);
        if (r === undefined) {
          throw new Error(`assertSessionForm: ${where} に未知のブロック「${k}」`);
        }
        if (r <= prev) {
          throw new Error(`assertSessionForm: ${where} のブロック順が固定形に反する（${keys.join('→')}）`);
        }
        prev = r;
      }
    }

    // ① the WHOLE day ends with the static stretch (the last part's closing block).
    const dayKeys = day.blocks.map((b) => b.block);
    if (dayKeys.length > 0 && dayKeys[dayKeys.length - 1] !== '静的') {
      throw new Error(
        `assertSessionForm: ${day.day} が静的ストレッチで終わっていない（末尾=${dayKeys[dayKeys.length - 1]}）`,
      );
    }

    // ③ scrimmage only inside 対人, and only on a full-court session. The day's court is 全面 on
    // every day that carries a 全面 session (including the 火 全面60 part), so the day-court check is
    // sufficient: half-court days (水木) have no 全面 part and must carry no scrimmage anywhere.
    const dayFull = String(day.court ?? '').includes('全面');
    for (const block of day.blocks) {
      for (const it of block.items) {
        if (it.category !== GAME) continue;
        if (block.block !== '対人') {
          throw new Error(
            `assertSessionForm: ${day.day} の「${block.block}」ブロックに5on5/ゲーム形式「${it.name}」が独立配置（対人ブロック末尾のみ可）`,
          );
        }
        if (!dayFull) {
          throw new Error(
            `assertSessionForm: 半面日 ${day.day} に5on5/ゲーム形式「${it.name}」が混入（5on5は全面の日だけ）`,
          );
        }
      }
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
  // Bundle blocks (warm-up / conditioning run / static stretch) run every day regardless of
  // coach presence — preparation, running, and warm-down are not coached skill installs — so
  // they are exempt. Only the curriculum blocks (ファンダ/シュート/対人) are constrained.
  const BUNDLE = new Set(['アップ', 'ラン', '静的', 'WU', 'CD']); // legacy WU/CD kept for old fixtures
  for (const day of plan.days) {
    if (day.coach_present !== false) continue; // only constrain coach-absent days
    for (const block of day.blocks) {
      if (BUNDLE.has(block.block)) continue; // bundle blocks run daily, coach or not
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
  // The fixed 6-block model only emits non-empty blocks (half-court days legitimately
  // carry no ラン block; non-scrimmage days carry no game segment), so an "empty block"
  // is now an intentional skip rather than a shortfall — the per-block empty warning is
  // dropped. The day-level underfill check stays: if the placed minutes fall well under
  // the available frame, the gym time wasn't fully programmed and a coach should know.
  for (const day of plan.days) {
    const filled = dayItems(day).reduce((s, it) => s + it.minutes, 0);
    if (day.minutes > 0 && filled < day.minutes * minFillRatio) {
      addPlanWarning(
        plan,
        `${day.day}: 配置 ${filled}分 が枠 ${day.minutes}分 に対して著しく不足`,
      );
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
 * @param {import('./types.js').WeekFocus} [args.weekFocus]
 */
export function runAllGates({ plan, config, drillIndex, mainFocus }) {
  assertTimeFits(plan);
  assertNoZone(plan, config, drillIndex);
  assertNoSetsInYear(plan, config, drillIndex);
  assertLoadCap(plan, config);
  assertMainFocusPresent(plan, mainFocus);
  assertSessionForm(plan); // 固定6ブロック順・末尾静的・5on5は対人末尾かつ全面のみ
  assertCoachContext(plan, config, drillIndex);
  checkUnderfill(plan); // best-effort: warns on under-filled days
}
