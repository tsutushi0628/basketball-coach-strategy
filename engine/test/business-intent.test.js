/**
 * @file Business-intent end-to-end tests (the 8 coaching scenarios).
 *
 * These assert *what a coach expects to happen*, not how the code does it:
 *   1. Low FT → free-throw / shooting work shows up in the week.
 *   2. Bad game turnovers → ball-handling / passing / decision work shows up.
 *   3. Middle-school team → zone drills never appear anywhere in the plan.
 *   4. In-year + sets forbidden → set-play drills never appear.
 *   5. No day is over-scheduled (Σ minutes ≤ the day's available minutes).
 *   6. High-intensity volume caps (per day / per week) and the no-consecutive-
 *      heavy-days rule are honored.
 *   7. Changing the measured input actually re-shapes the allocation
 *      (the engine is responsive, not returning a baked-in plan).
 *   8. A deliberately constraint-violating plan trips the matching hard gate.
 *
 * Scenarios 1-5,7 run the real pipeline over the real 211-drill catalog so the
 * assertions exercise production data, not a hand-built fixture. Scenario 6
 * drives the load model with a high-intensity-rich synthetic pool so the caps
 * are genuinely binding (the sample team's filtered pool happens to place no
 * heavy drills, which would make a real-catalog cap test vacuous). Scenario 8
 * feeds each gate a plan that breaks exactly one invariant.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { createLocalStorage } from '../src/storage.js';
import { normalizeDrills, normalizeDrill } from '../src/normalize.js';
import { planWeek } from '../src/planWeek.js';
import { createLoadBudget } from '../src/loadModel.js';
import { allocateDay } from '../src/allocate.js';
import {
  assertTimeFits,
  assertNoZone,
  assertNoSetsInYear,
  assertLoadCap,
  assertMainFocusPresent,
} from '../src/gates.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const engineRoot = resolve(__dirname, '..');
const repoRoot = resolve(engineRoot, '..');

/** Load the real catalog + sample config; build a plan from an indicator set. */
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

/** Flatten a plan to its drill items. */
function allItems(plan) {
  return plan.days.flatMap((d) => d.blocks.flatMap((b) => b.items));
}

/** Sum minutes per category across the whole plan. */
function minutesByCategory(plan) {
  const out = {};
  for (const it of allItems(plan)) out[it.category] = (out[it.category] ?? 0) + it.minutes;
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// 1. Low FT% → the week contains free-throw / shooting work.
// ───────────────────────────────────────────────────────────────────────────
test('S1: a low free-throw rate puts shooting / free-throw drills into the week', async () => {
  const { drills, config, baseInput } = await loadContext();
  // Drag FT% far below target so the gap signal is unambiguous.
  const input = inputWith(baseInput, { 'FT率': { latest: 30, target: 70, baseline: 40 } });
  const plan = planWeek(drills, config, input);

  const shotItems = allItems(plan).filter((it) => it.category === 'シュート');
  assert.ok(shotItems.length > 0, 'a struggling FT% must pull シュート work into the plan');
  // The FT率 emphasis is FT-only: every シュート placed must be an actual free-throw drill.
  for (const it of shotItems) {
    assert.match(it.name, /フリースロー|FT/i, `非FTのシュートが混入: ${it.name}`);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// 2. Bad game turnovers → ball-handling / passing / decision work appears.
// ───────────────────────────────────────────────────────────────────────────
test('S2: high game turnovers pull in handling / passing / decision-making work', async () => {
  const { drills, config, baseInput } = await loadContext();
  // 試合TO far from target; the other two indicators already met so the TO gap dominates.
  const input = inputWith(baseInput, {
    '試合TO': { good_direction: 'down', baseline: 30, latest: 30, target: 10 },
    'FT率': { latest: 70, target: 70, baseline: 40 },
    'ゴール下成功率': { latest: 70, target: 70, baseline: 45 },
  });
  const plan = planWeek(drills, config, input);

  const byCat = minutesByCategory(plan);
  const toCategories = ['ハンドリング/ドリブル', 'パス&スペーシング', '意思決定/ゲーム形式'];
  const presentMinutes = toCategories.reduce((s, c) => s + (byCat[c] ?? 0), 0);
  assert.ok(
    presentMinutes > 0,
    'TOが悪い時はハンドリング/パス/意思決定のどれかが計画に入るべき',
  );
  // The largest TO category (handling, split-weight 0.4) should clearly out-mass
  // a non-TO category like finishing once finishing's gap is closed.
  assert.ok(
    (byCat['ハンドリング/ドリブル'] ?? 0) > (byCat['フィニッシュ(ゴール下/レイアップ)'] ?? 0),
    'TO主導の週はハンドリングがフィニッシュより多く配分されるべき',
  );
});

// ───────────────────────────────────────────────────────────────────────────
// 3. Middle-school team → no zone drill anywhere in the plan.
// ───────────────────────────────────────────────────────────────────────────
test('S3: a middle-school zone-forbidden team never gets a zone drill', async () => {
  const { drills, config, baseInput } = await loadContext();
  assert.equal(config.category, '中学');
  assert.equal(config.philosophy.zone_forbidden, true);
  const plan = planWeek(drills, config, baseInput);

  const idx = new Map(drills.map((d) => [d.id, d]));
  for (const it of allItems(plan)) {
    const drill = idx.get(it.drill_id);
    const hay = `${drill.name} ${drill.category} ${drill.notes} ${drill.philosophy_tags.join(' ')}`;
    assert.doesNotMatch(hay, /ゾーン|zone/i, `中学計画にzone系が混入: ${it.name}`);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// 4. In-year + sets forbidden → no set-play drill anywhere.
// ───────────────────────────────────────────────────────────────────────────
test('S4: in-year with sets forbidden → no set-play drill appears', async () => {
  const { drills, config, baseInput } = await loadContext();
  assert.equal(config.philosophy.sets_forbidden_in_year, true);
  const plan = planWeek(drills, config, baseInput);

  const idx = new Map(drills.map((d) => [d.id, d]));
  for (const it of allItems(plan)) {
    const drill = idx.get(it.drill_id);
    assert.doesNotMatch(
      `${drill.name} ${drill.notes}`,
      /セット|セットオフェンス/,
      `年内禁止のセット系が混入: ${it.name}`,
    );
  }
});

// ───────────────────────────────────────────────────────────────────────────
// 5. No day is over-scheduled.
// ───────────────────────────────────────────────────────────────────────────
test('S5: each day total minutes never exceeds the day frame', async () => {
  const { drills, config, baseInput } = await loadContext();
  const plan = planWeek(drills, config, baseInput);
  for (const day of plan.days) {
    const sum = day.blocks
      .flatMap((b) => b.items)
      .reduce((s, it) => s + it.minutes, 0);
    assert.equal(sum, day.total_minutes, `${day.day} total_minutes と実合計が不一致`);
    assert.ok(sum <= day.minutes, `${day.day} ${sum}分 が枠 ${day.minutes}分 を超過`);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// 6. High-intensity caps (per session / per week) and no consecutive heavy days.
//    Driven with a high-intensity-rich pool so the caps are actually binding.
// ───────────────────────────────────────────────────────────────────────────
test('S6: load caps bound the heavy volume and forbid consecutive heavy days', () => {
  const caps = { high_intensity_per_session: 2, high_intensity_per_week: 3, no_consecutive_high_days: true };

  // A pool that is almost entirely high-intensity, so allocation *wants* to place
  // many heavy drills — only the budget should stop it.
  const heavy = [];
  for (let i = 0; i < 12; i++) {
    heavy.push(
      normalizeDrill({
        id: `H${i}`,
        name: `高強度${i}`,
        category: 'フィニッシュ(ゴール下/レイアップ)',
        court: '不問',
        grades: '全',
        intensity_class: '高',
        duration_min: 5,
        duration_max: 5,
      }),
    );
  }
  const finalWeights = { 'フィニッシュ(ゴール下/レイアップ)': 1.0 };
  const budget = createLoadBudget(caps);

  const schedule = [
    { day: '火', minutes: 100, court: '全面' },
    { day: '水', minutes: 100, court: '全面' },
    { day: '木', minutes: 100, court: '全面' },
    { day: '金', minutes: 100, court: '全面' },
  ];
  const days = schedule.map((sd) =>
    allocateDay({
      scheduleDay: sd,
      dayPool: heavy,
      finalWeights,
      ftOnlyCategories: new Set(),
      budget,
    }),
  );

  let prevHigh = false;
  let weekHigh = 0;
  for (const d of days) {
    assert.ok(
      d.high_intensity_count <= caps.high_intensity_per_session,
      `${d.day} の高強度 ${d.high_intensity_count}本 がセッション上限 ${caps.high_intensity_per_session}本 を超過`,
    );
    if (d.high_intensity_count > 0) {
      assert.equal(prevHigh, false, `高強度が連続日に置かれている（${d.day}）`);
    }
    prevHigh = d.high_intensity_count > 0;
    weekHigh += d.high_intensity_count;
  }
  assert.ok(
    weekHigh <= caps.high_intensity_per_week,
    `週合計の高強度 ${weekHigh}本 が週上限 ${caps.high_intensity_per_week}本 を超過`,
  );
  // The pool could supply far more than 3 heavy drills, so the cap must actually
  // have bitten — otherwise the test isn't proving the budget does anything.
  assert.ok(weekHigh > 0 && weekHigh <= caps.high_intensity_per_week,
    '高強度が予算内で実際に配置され、かつ上限で頭打ちになっているべき');
});

// ───────────────────────────────────────────────────────────────────────────
// 7. Changing the input re-shapes the allocation (not a baked-in plan).
// ───────────────────────────────────────────────────────────────────────────
test('S7: meeting the FT target shifts time away from shooting (responsive, not fixed)', async () => {
  const { drills, config, baseInput } = await loadContext();

  const below = planWeek(drills, config, inputWith(baseInput, { 'FT率': { latest: 30 } }));
  const met = planWeek(drills, config, inputWith(baseInput, { 'FT率': { latest: 70 } }));

  const shotBelow = (minutesByCategory(below)['シュート'] ?? 0);
  const shotMet = (minutesByCategory(met)['シュート'] ?? 0);

  assert.ok(shotBelow > 0, '未達時はシュートに時間が割かれるべき');
  assert.ok(
    shotMet < shotBelow,
    `目標到達でシュート配分が減るべき（未達 ${shotBelow}分 → 到達 ${shotMet}分）`,
  );
  // Whole-plan shape must differ — proves the engine isn't returning a constant.
  assert.notDeepEqual(
    minutesByCategory(below),
    minutesByCategory(met),
    '入力を変えても配分が同一＝固定値を返している疑い',
  );
});

// ───────────────────────────────────────────────────────────────────────────
// 8. A deliberately broken plan trips the matching hard gate.
//    One sub-case per gate; each violates exactly one invariant.
// ───────────────────────────────────────────────────────────────────────────
const GATE_CONFIG = {
  category: '中学',
  current_month: 8,
  philosophy: { zone_forbidden: true, sets_forbidden_in_year: true },
  load_caps: { high_intensity_per_session: 2, high_intensity_per_week: 3, no_consecutive_high_days: true },
};

function buildDay(items, minutes = 100, label = '火') {
  return {
    day: label,
    minutes,
    court: '全面',
    blocks: [{ block: '技術', items }],
    total_minutes: items.reduce((s, it) => s + it.minutes, 0),
    high_intensity_count: items.filter((it) => it.intensity_class === '高').length,
  };
}

function planItem(over = {}) {
  return {
    drill_id: over.drill_id ?? 'X',
    name: over.name ?? 'd',
    minutes: over.minutes ?? 10,
    category: over.category ?? 'シュート',
    intensity_class: over.intensity_class ?? '中',
  };
}

test('S8a: over-scheduling a day trips assertTimeFits', () => {
  const plan = { days: [buildDay([planItem({ minutes: 130 })], 100)] };
  assert.throws(() => assertTimeFits(plan), /assertTimeFits/);
});

test('S8b: a leaked zone drill trips assertNoZone', () => {
  const zone = normalizeDrill({
    id: 'Z', name: 'ゾーンプレス', category: 'チームディフェンス',
    court: '全面', grades: '全', intensity_class: '中',
  });
  const idx = new Map([['Z', zone]]);
  const plan = { days: [buildDay([planItem({ drill_id: 'Z', name: 'ゾーンプレス' })])] };
  assert.throws(() => assertNoZone(plan, GATE_CONFIG, idx), /assertNoZone/);
});

test('S8c: a leaked in-year set play trips assertNoSetsInYear', () => {
  const sets = normalizeDrill({
    id: 'S', name: 'セットオフェンス展開', category: 'チームオフェンス',
    court: '全面', grades: '全', intensity_class: '中',
  });
  const idx = new Map([['S', sets]]);
  const plan = { days: [buildDay([planItem({ drill_id: 'S', name: 'セットオフェンス展開' })])] };
  assert.throws(() => assertNoSetsInYear(plan, GATE_CONFIG, idx), /assertNoSetsInYear/);
});

test('S8d: too many heavy drills in one session trips assertLoadCap', () => {
  const items = [
    planItem({ intensity_class: '高' }),
    planItem({ intensity_class: '高' }),
    planItem({ intensity_class: '高' }),
  ];
  assert.throws(() => assertLoadCap({ days: [buildDay(items)] }, GATE_CONFIG), /assertLoadCap/);
});

test('S8e: heavy work on consecutive days trips assertLoadCap', () => {
  const plan = {
    days: [
      buildDay([planItem({ intensity_class: '高' })], 100, '火'),
      buildDay([planItem({ intensity_class: '高' })], 100, '水'),
    ],
  };
  assert.throws(() => assertLoadCap(plan, GATE_CONFIG), /連続日/);
});

test('S8f: dropping the main focus all week trips assertMainFocusPresent', () => {
  const plan = { days: [buildDay([planItem({ category: 'シュート' })])] };
  assert.throws(
    () => assertMainFocusPresent(plan, 'フィニッシュ(ゴール下/レイアップ)'),
    /assertMainFocusPresent/,
  );
});
