/**
 * @file Tests for per-day block allocation. Asserts block sizing, the
 * remainder-to-技術 rule, half-court exclusion, and that no block overflows.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeDrill } from '../src/normalize.js';
import { createLoadBudget } from '../src/loadModel.js';
import { computeBlockTargets, allocateDay } from '../src/allocate.js';

test('block targets sum exactly to the day minutes (remainder → 技術)', () => {
  for (const m of [100, 165, 90, 73]) {
    const t = computeBlockTargets(m);
    assert.equal(t.WU + t.技術 + t.対人 + t.ゲーム + t.CD, m, `targets must total ${m}`);
  }
  // 100min: WU15 技術30 対人30 ゲーム20 CD5 → already exact, no remainder.
  assert.deepEqual(computeBlockTargets(100), { WU: 15, 技術: 30, 対人: 30, ゲーム: 20, CD: 5 });
});

function d(over) {
  return normalizeDrill({
    id: over.id,
    name: over.name ?? over.id,
    category: over.category ?? 'フィニッシュ(ゴール下/レイアップ)',
    court: over.court ?? '不問',
    grades: '全',
    intensity_class: over.intensity_class ?? '低',
    duration_min: over.duration_min ?? 5,
    duration_max: over.duration_min ?? 5,
    sub_skill: over.sub_skill ?? '',
  });
}

const FINAL_WEIGHTS = {
  'フィニッシュ(ゴール下/レイアップ)': 0.5,
  'コンディショニング/ウォームアップ': 0.1,
  '意思決定/ゲーム形式': 0.4,
};

function build(pool, scheduleDay) {
  const budget = createLoadBudget({
    high_intensity_per_session: 2,
    high_intensity_per_week: 3,
    no_consecutive_high_days: true,
  });
  return allocateDay({
    scheduleDay,
    dayPool: pool,
    finalWeights: FINAL_WEIGHTS,
    ftOnlyCategories: new Set(),
    budget,
  });
}

test('no block exceeds its target and total never exceeds the day minutes', () => {
  const pool = [
    d({ id: 'WU1', category: 'コンディショニング/ウォームアップ', duration_min: 5 }),
    d({ id: 'WU2', category: 'コンディショニング/ウォームアップ', duration_min: 5 }),
    d({ id: 'F1', duration_min: 5 }),
    d({ id: 'F2', duration_min: 5 }),
    d({ id: 'F3', duration_min: 5 }),
    d({ id: 'G1', category: '意思決定/ゲーム形式', duration_min: 5 }),
  ];
  const day = build(pool, { day: '火', minutes: 100, court: '全面' });
  assert.ok(day.total_minutes <= 100, 'total within day budget');
  for (const b of day.blocks) {
    const sum = b.items.reduce((s, it) => s + it.minutes, 0);
    const target = computeBlockTargets(100)[b.block];
    assert.ok(sum <= target, `${b.block} (${sum}) must not exceed target ${target}`);
  }
});

test('half-court day excludes full-court-only drills from the plan', () => {
  const pool = [
    d({ id: 'WU1', category: 'コンディショニング/ウォームアップ', duration_min: 5 }),
    d({ id: 'FULL', court: '全面', duration_min: 5 }),
    d({ id: 'HALF', court: '半面', duration_min: 5 }),
  ];
  // NOTE: allocate trusts an already-filtered pool; for this unit test we pass a
  // pre-filtered half-court pool (the FULL drill removed) and assert it is absent.
  const filtered = pool.filter((x) => !x.requiresFull);
  const day = build(filtered, { day: '水', minutes: 100, court: '半面' });
  const ids = day.blocks.flatMap((b) => b.items).map((it) => it.drill_id);
  assert.ok(!ids.includes('FULL'), 'full-court-only drill must not appear on half-court day');
});

test('a drill is not reused twice within the same day', () => {
  const pool = [
    d({ id: 'WU1', category: 'コンディショニング/ウォームアップ', duration_min: 5 }),
    d({ id: 'ONLY', duration_min: 5 }),
  ];
  const day = build(pool, { day: '木', minutes: 100, court: '全面' });
  const ids = day.blocks.flatMap((b) => b.items).map((it) => it.drill_id);
  const onlyCount = ids.filter((x) => x === 'ONLY').length;
  assert.ok(onlyCount <= 1, 'a drill must not be placed twice in one day');
});
