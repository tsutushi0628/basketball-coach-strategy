/**
 * @file Business-intent tests for the improved engine (DESIGN.md §1–§6 改修).
 *
 * These assert *what a coach / the team's identity expects to be true of a week*,
 * not how the allocator achieves it. They run the real pipeline over the real
 * 211-drill catalog and the sample team config (the production path), so a
 * regression in coach-context, philosophy floors, intra-week variety, block
 * composition, or the cooldown rule shows up as a business failure — not just a
 * unit drift.
 *
 * Coverage (the 8 観点 of the improvement spec):
 *   V1  守備・速攻 each meet their weekly minute floor (哲学フロア).
 *   V2  守備・速攻 land on coach-present days; no team-install on coach-absent days.
 *   V3  coach-absent days hold only coach_absent_allow categories with settled
 *       mastery (反復/実戦化) — no 習得 / team-install work the players can't run.
 *   V4  火水木金土 differ from one another (週内変化, not the same plan every day).
 *   V5  the 技術 block is composed of several categories (no single-category monopoly).
 *   V6  the cooldown holds no jump work (低強度の整理運動のみ).
 *   V7  the legacy gates still hold (時間収まり / ゾーン除外 / 年内セット除外 / 負荷上限).
 *   V8  changing the measured input changes the allocation (responsive, not fixed).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { createLocalStorage } from '../src/storage.js';
import { normalizeDrills } from '../src/normalize.js';
import { planWeek } from '../src/planWeek.js';
import { isCoachAbsentEligible, isZoneDrill, isSetsDrill } from '../src/filter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const engineRoot = resolve(__dirname, '..');
const repoRoot = resolve(engineRoot, '..');

/** The two team-identity floor categories (config.philosophy_floors keys). */
const DEFENSE_CAT = 'チームディフェンス(オールコートマンツー/ヘルプ/帰陣)';
const OFFENSE_CAT = 'チームオフェンス(アーリー/トランジション)';

/** Jump keywords forbidden in the cooldown (mirrors DESIGN.md §4 / spec #4). */
const JUMP_NAME_RE =
  /ポゴ|バウンディング|ジャンプキック|スクワットジャンプ|ジャンプ|跳び|バウンド|ホップ|プライオ/;

/** Load the real catalog + the sample team config/input (production path). */
async function loadContext() {
  const storage = createLocalStorage({
    drillsPath: resolve(repoRoot, 'docs/practice-knowledge/data/drills.json'),
    configPath: resolve(engineRoot, 'data/config.sample.json'),
    inputPath: resolve(engineRoot, 'data/team-input.sample.json'),
  });
  const drills = normalizeDrills(await storage.getDrills());
  const config = await storage.getConfig();
  const baseInput = await storage.getTeamInput();
  return { drills, config, baseInput };
}

/** Build a TeamInput with the given indicator overrides on top of the sample. */
function inputWith(baseInput, overrides) {
  const next = JSON.parse(JSON.stringify(baseInput));
  for (const [id, patch] of Object.entries(overrides)) {
    const ind = next.indicators.find((i) => i.id === id);
    if (ind) Object.assign(ind, patch);
  }
  return next;
}

/** Items of one day across all blocks. */
function dayItems(day) {
  return day.blocks.flatMap((b) => b.items);
}

/** Minutes of a category placed on one day. */
function dayCatMinutes(day, cat) {
  return dayItems(day)
    .filter((it) => it.category === cat)
    .reduce((s, it) => s + it.minutes, 0);
}

/**
 * Weekly minutes of a category, counting only coach-present days when
 * coachDaysOnly is true (matches `place_on_coach_days`).
 */
function weekCatMinutes(plan, cat, coachDaysOnly) {
  let m = 0;
  for (const day of plan.days) {
    if (coachDaysOnly && day.coach_present === false) continue;
    m += dayCatMinutes(day, cat);
  }
  return m;
}

/** Sum minutes per category across the whole plan. */
function minutesByCategory(plan) {
  const out = {};
  for (const day of plan.days) {
    for (const it of dayItems(day)) out[it.category] = (out[it.category] ?? 0) + it.minutes;
  }
  return out;
}

/** Block by key on a given day (or undefined). */
function block(day, key) {
  return day.blocks.find((b) => b.block === key);
}

// ───────────────────────────────────────────────────────────────────────────
// V1. Defense & fast-break each meet their weekly minute floor (哲学フロア).
//     The team's core (all-court man defense + early offense) must show up every
//     week even though the attack-only gap signal never raises these categories.
// ───────────────────────────────────────────────────────────────────────────
test('V1: 守備・速攻 each meet their weekly min_minutes_per_week floor', async () => {
  const { drills, config, baseInput } = await loadContext();
  const plan = planWeek(drills, config, baseInput);

  const floors = config.philosophy_floors;
  assert.ok(floors?.[DEFENSE_CAT] && floors?.[OFFENSE_CAT], 'config must declare both floors');

  for (const cat of [DEFENSE_CAT, OFFENSE_CAT]) {
    const spec = floors[cat];
    const coachDaysOnly = spec.place_on_coach_days === true;
    const placed = weekCatMinutes(plan, cat, coachDaysOnly);
    assert.ok(
      placed >= spec.min_minutes_per_week,
      `「${cat}」は週内 ${spec.min_minutes_per_week}分 以上必要 (実績 ${placed}分)`,
    );
  }
});

// ───────────────────────────────────────────────────────────────────────────
// V2. The floor work lands on coach-present days, and coach-absent days carry no
//     team-defense / team-offense install (those need a coach).
// ───────────────────────────────────────────────────────────────────────────
test('V2: 守備・速攻 are placed on coach-present days; absent days carry no team-install', async () => {
  const { drills, config, baseInput } = await loadContext();
  const plan = planWeek(drills, config, baseInput);

  // Every minute of either floor category must be on a coach-present day.
  for (const day of plan.days) {
    if (day.coach_present !== false) continue; // only inspect absent days (水/木)
    assert.equal(
      dayCatMinutes(day, DEFENSE_CAT),
      0,
      `不在日 ${day.day} にチームディフェンス系が混入`,
    );
    assert.equal(
      dayCatMinutes(day, OFFENSE_CAT),
      0,
      `不在日 ${day.day} にチームオフェンス系が混入`,
    );
  }

  // And the floors are actually realized on the coach-present days (火/金/土).
  const presentDays = plan.days.filter((d) => d.coach_present !== false);
  assert.ok(presentDays.length > 0, 'スケジュールに在席日が存在するべき');
  const defOnPresent = presentDays.reduce((s, d) => s + dayCatMinutes(d, DEFENSE_CAT), 0);
  const offOnPresent = presentDays.reduce((s, d) => s + dayCatMinutes(d, OFFENSE_CAT), 0);
  assert.ok(defOnPresent > 0, '在席日に守備（チームディフェンス）が配置されるべき');
  assert.ok(offOnPresent > 0, '在席日に速攻（チームオフェンス）が配置されるべき');
});

// ───────────────────────────────────────────────────────────────────────────
// V3. Coach-absent days hold only player-self-runnable content in the main
//     blocks (技術/対人/ゲーム): every placed drill's category is in
//     coach_absent_allow AND its mastery is settled (反復/実戦化). No 習得 (new
//     acquisition) and no team-install slips in. Warm-up/cool-down (WU/CD) run
//     every day regardless of coach presence, so they are exempt from this
//     restriction (準備運動・整理運動は指導者の有無に関係なく毎日やる).
// ───────────────────────────────────────────────────────────────────────────
test('V3: coach-absent days hold only self-runnable drills in main blocks (allow-list + settled mastery)', async () => {
  const { drills, config, baseInput } = await loadContext();
  const plan = planWeek(drills, config, baseInput);
  const idx = new Map(drills.map((d) => [d.id, d]));

  const absentDays = plan.days.filter((d) => d.coach_present === false);
  assert.ok(absentDays.length > 0, 'サンプル週には不在日(水/木)があるべき');

  const allow = config.coach_absent_allow;
  for (const day of absentDays) {
    for (const block of day.blocks) {
      // WU/CD are run daily regardless of coach presence — not constrained here.
      if (block.block === 'WU' || block.block === 'CD') continue;
      for (const it of block.items) {
        const drill = idx.get(it.drill_id);
        assert.ok(drill, `ドリル ${it.drill_id} がカタログに存在するべき`);
        // Category must be on the self-run allow list.
        assert.ok(
          allow.includes(drill.category),
          `不在日 ${day.day} ${block.block}ブロックに許可外カテゴリ「${drill.category}」(${it.name})`,
        );
        // Mastery must be a settled stage — no 習得 (or 習得→… transitions).
        assert.ok(
          drill.mastery_stage === '反復' || drill.mastery_stage === '実戦化',
          `不在日 ${day.day} ${block.block}ブロックに未習得段階「${drill.mastery_stage}」のドリル(${it.name})`,
        );
        assert.doesNotMatch(
          drill.mastery_stage,
          /習得/,
          `不在日 ${day.day} ${block.block}ブロックに新規習得系(${it.name})が混入`,
        );
        // The shared eligibility predicate must agree (single source of truth).
        assert.ok(
          isCoachAbsentEligible(drill, config),
          `不在日 ${day.day} ${block.block}ブロックに自走不可ドリル(${it.name})`,
        );
      }
    }
  }
});

// ───────────────────────────────────────────────────────────────────────────
// V4. The five practice days differ from one another — the week varies, it is
//     not the same plan repeated. (Identity by the set of placed drills per day.)
// ───────────────────────────────────────────────────────────────────────────
test('V4: 火水木金土 are not identical to each other (週内変化)', async () => {
  const { drills, config, baseInput } = await loadContext();
  const plan = planWeek(drills, config, baseInput);

  assert.ok(plan.days.length >= 2, '複数日のスケジュールが前提');

  const signatures = plan.days.map((day) =>
    JSON.stringify([...new Set(dayItems(day).map((it) => it.drill_id))].sort()),
  );
  const distinct = new Set(signatures);
  assert.equal(
    distinct.size,
    signatures.length,
    `各日の内容は互いに異なるべき（同一日が存在: ${signatures.length - distinct.size}件）`,
  );

  // No two adjacent days share their whole content either (a strictly stronger
  // statement than "the week isn't a single constant").
  for (let i = 1; i < plan.days.length; i++) {
    assert.notEqual(
      signatures[i],
      signatures[i - 1],
      `${plan.days[i - 1].day}→${plan.days[i].day} が同一内容`,
    );
  }
});

// ───────────────────────────────────────────────────────────────────────────
// V5. The 技術 block is built from several categories — no single category
//     monopolizes it (spec #3: stop the one-category technical block).
// ───────────────────────────────────────────────────────────────────────────
test('V5: the 技術 block draws from multiple categories (no single-category monopoly)', async () => {
  const { drills, config, baseInput } = await loadContext();
  const plan = planWeek(drills, config, baseInput);

  // Inspect every day that actually has a non-trivial 技術 block.
  let inspected = 0;
  for (const day of plan.days) {
    const tech = block(day, '技術');
    if (!tech || tech.items.length < 2) continue; // single-item block can't spread
    inspected += 1;
    const cats = new Set(tech.items.map((it) => it.category));
    assert.ok(
      cats.size >= 2,
      `${day.day} の技術ブロックが単一カテゴリ独占（${[...cats][0]}）`,
    );
    // Sanity: no one category should eat the entire block's minutes.
    const techMin = tech.items.reduce((s, it) => s + it.minutes, 0);
    for (const c of cats) {
      const catMin = tech.items
        .filter((it) => it.category === c)
        .reduce((s, it) => s + it.minutes, 0);
      assert.ok(
        catMin < techMin,
        `${day.day} の技術が「${c}」単独で全尺を占有`,
      );
    }
  }
  assert.ok(inspected > 0, '検証対象となる技術ブロックが少なくとも1日存在するべき');
});

// ───────────────────────────────────────────────────────────────────────────
// V6. The cooldown holds no jump work — only low-intensity settle-down drills.
// ───────────────────────────────────────────────────────────────────────────
test('V6: the cooldown block never contains jump drills', async () => {
  const { drills, config, baseInput } = await loadContext();
  const plan = planWeek(drills, config, baseInput);

  for (const day of plan.days) {
    const cd = block(day, 'CD');
    if (!cd) continue;
    for (const it of cd.items) {
      assert.equal(
        it.intensity_class,
        '低',
        `${day.day} のCDに非低強度「${it.name}」(強度:${it.intensity_class})`,
      );
      assert.doesNotMatch(
        it.name,
        JUMP_NAME_RE,
        `${day.day} のCDに跳躍系「${it.name}」が混入`,
      );
    }
  }
});

// ───────────────────────────────────────────────────────────────────────────
// V7. The legacy gates still hold on the produced plan: every day fits its time,
//     no zone drill, no in-year set play, and the load caps are respected.
//     (planWeek already throws on a gate violation; here we re-assert the
//     observable invariants directly so a silent regression is caught.)
// ───────────────────────────────────────────────────────────────────────────
test('V7: legacy invariants hold (time fits / no zone / no in-year sets / load caps)', async () => {
  const { drills, config, baseInput } = await loadContext();
  const plan = planWeek(drills, config, baseInput);
  const idx = new Map(drills.map((d) => [d.id, d]));

  // Time fits per day.
  for (const day of plan.days) {
    const sum = dayItems(day).reduce((s, it) => s + it.minutes, 0);
    assert.ok(sum <= day.minutes, `${day.day} ${sum}分 が枠 ${day.minutes}分 を超過`);
    assert.equal(sum, day.total_minutes, `${day.day} total_minutes が実合計と不一致`);
  }

  // Middle-school + zone-forbidden → no zone drill anywhere.
  assert.equal(config.category, '中学');
  assert.equal(config.philosophy.zone_forbidden, true);
  for (const day of plan.days) {
    for (const it of dayItems(day)) {
      assert.ok(!isZoneDrill(idx.get(it.drill_id)), `zone系が混入: ${it.name}`);
    }
  }

  // In-year + sets forbidden → no set-play drill anywhere.
  assert.equal(config.philosophy.sets_forbidden_in_year, true);
  for (const day of plan.days) {
    for (const it of dayItems(day)) {
      assert.ok(!isSetsDrill(idx.get(it.drill_id)), `年内禁止のセット系が混入: ${it.name}`);
    }
  }

  // Load caps: per-session / per-week high totals + no-consecutive-heavy-days.
  const caps = config.load_caps;
  let weekHigh = 0;
  let prevHigh = false;
  for (const day of plan.days) {
    const high = dayItems(day).filter((it) => it.intensity_class === '高').length;
    assert.ok(
      high <= caps.high_intensity_per_session,
      `${day.day} の高強度 ${high}本 がセッション上限 ${caps.high_intensity_per_session}本 を超過`,
    );
    if (caps.no_consecutive_high_days && high > 0) {
      assert.equal(prevHigh, false, `高強度が連続日に配置（${day.day}）`);
    }
    weekHigh += high;
    prevHigh = high > 0;
  }
  assert.ok(
    weekHigh <= caps.high_intensity_per_week,
    `週合計の高強度 ${weekHigh}本 が週上限 ${caps.high_intensity_per_week}本 を超過`,
  );
});

// ───────────────────────────────────────────────────────────────────────────
// V8. Changing the measured input re-shapes the allocation: meeting the FT
//     target pulls time away from shooting, and the whole-week category shape
//     changes (proves the engine is responsive, not returning a baked plan).
// ───────────────────────────────────────────────────────────────────────────
test('V8: changing the input changes the allocation (responsive, not fixed)', async () => {
  const { drills, config, baseInput } = await loadContext();

  const below = planWeek(drills, config, inputWith(baseInput, { 'FT率': { latest: 30 } }));
  const met = planWeek(drills, config, inputWith(baseInput, { 'FT率': { latest: 70 } }));

  const shotBelow = minutesByCategory(below)['シュート'] ?? 0;
  const shotMet = minutesByCategory(met)['シュート'] ?? 0;

  assert.ok(shotBelow > 0, 'FT未達時はシュートに時間が割かれるべき');
  assert.ok(
    shotMet < shotBelow,
    `FT到達でシュート配分が減るべき（未達 ${shotBelow}分 → 到達 ${shotMet}分）`,
  );
  assert.notDeepEqual(
    minutesByCategory(below),
    minutesByCategory(met),
    '入力を変えても配分が同一＝固定値を返している疑い',
  );

  // The team-identity floors are honored regardless of which indicator moved:
  // changing an attack indicator must not starve defense / fast-break below floor.
  for (const plan of [below, met]) {
    for (const cat of [DEFENSE_CAT, OFFENSE_CAT]) {
      const spec = config.philosophy_floors[cat];
      const placed = weekCatMinutes(plan, cat, spec.place_on_coach_days === true);
      assert.ok(
        placed >= spec.min_minutes_per_week,
        `入力変化後も「${cat}」フロア(${spec.min_minutes_per_week}分)を維持すべき (実績 ${placed}分)`,
      );
    }
  }
});
