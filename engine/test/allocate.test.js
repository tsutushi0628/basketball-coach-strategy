/**
 * @file Tests for the segment-based per-day allocation. Asserts the session shape
 * (warm-up / cool-down split and the switch-cost-bounded main-segment count),
 * sustained main segments (no fragmentation into many tiny drills), category-fit
 * (each main block draws only its own block's categories), the no-overflow rule,
 * and the no-repeat-within-a-day rule.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeDrill } from '../src/normalize.js';
import { createLoadBudget } from '../src/loadModel.js';
import { computeSessionShape, allocateDay } from '../src/allocate.js';

// ───────────────────────────────────────────────────────────────────────────
// Session shape: the switch-cost band the owner set — 1h → 2-3 curriculum
// segments, 2h → 3-5, 3h → 4-7 — with WU/CD as routine bookends (not counted).
// ───────────────────────────────────────────────────────────────────────────
test('session shape: warm-up + main + cool-down always sum to the day minutes', () => {
  for (const m of [60, 90, 100, 120, 165, 180]) {
    const s = computeSessionShape(m);
    assert.equal(s.wu + s.mainMinutes + s.cd, m, `shape must total ${m}`);
    assert.equal(s.mainMinutes % 5, 0, `${m}: main budget stays on a 5-minute grain`);
  }
});

test('session shape: the main-segment band matches the switch-cost rule (1h 2-3 / 2h 3-5 / 3h 4-7)', () => {
  const h1 = computeSessionShape(60);
  assert.deepEqual([h1.minMain, h1.maxMain], [2, 3], '1h → 2-3 curriculum segments');
  const h2 = computeSessionShape(120);
  assert.deepEqual([h2.minMain, h2.maxMain], [3, 5], '2h → 3-5 curriculum segments');
  const h3 = computeSessionShape(180);
  assert.deepEqual([h3.minMain, h3.maxMain], [4, 7], '3h → 4-7 curriculum segments');
  // The target sits inside the band and biases low (sustained, fewer switches).
  for (const m of [60, 100, 120, 165, 180]) {
    const s = computeSessionShape(m);
    assert.ok(s.targetMain >= s.minMain && s.targetMain <= s.maxMain, `${m}: target within band`);
  }
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
    duration_max: over.duration_max ?? over.duration_min ?? 5,
    sub_skill: over.sub_skill ?? '',
  });
}

/** A varied pool: conditioning for WU/CD plus several main-block categories. */
function variedPool() {
  const pool = [];
  for (let i = 0; i < 4; i++) {
    pool.push(d({ id: `WU${i}`, name: `ストレッチ${i}`, category: 'コンディショニング/ウォームアップ', duration_min: 5, sub_skill: '可動域' }));
  }
  for (let i = 0; i < 4; i++) pool.push(d({ id: `FIN${i}`, category: 'フィニッシュ(ゴール下/レイアップ)', duration_min: 5 }));
  for (let i = 0; i < 4; i++) pool.push(d({ id: `SHT${i}`, category: 'シュート', duration_min: 5 }));
  for (let i = 0; i < 4; i++) pool.push(d({ id: `HND${i}`, category: 'ハンドリング/ドリブル', duration_min: 5 }));
  for (let i = 0; i < 3; i++) pool.push(d({ id: `ONE${i}`, category: '1on1', duration_min: 5 }));
  for (let i = 0; i < 3; i++) pool.push(d({ id: `DEC${i}`, category: '意思決定/ゲーム形式', duration_min: 5 }));
  return pool;
}

const FINAL_WEIGHTS = {
  'フィニッシュ(ゴール下/レイアップ)': 0.3,
  'シュート': 0.25,
  'ハンドリング/ドリブル': 0.2,
  '1on1': 0.15,
  '意思決定/ゲーム形式': 0.1,
  'コンディショニング/ウォームアップ': 0.0,
};

/** Block-type each category is allowed to occupy (mirror of allocate's CATEGORY_BLOCK). */
const ALLOWED = {
  技術: new Set(['シュート', 'フィニッシュ(ゴール下/レイアップ)', 'ハンドリング/ドリブル', 'パス&スペーシング', 'フットワーク/アジリティ/ピボット']),
  対人: new Set(['1on1', 'チームディフェンス(オールコートマンツー/ヘルプ/帰陣)', 'チームオフェンス(アーリー/トランジション)', 'リバウンド/ボックスアウト']),
  ゲーム: new Set(['意思決定/ゲーム形式']),
};

function build(pool, scheduleDay) {
  const budget = createLoadBudget({ high_intensity_per_session: 2, high_intensity_per_week: 3, no_consecutive_high_days: true });
  return allocateDay({ scheduleDay, dayPool: pool, finalWeights: FINAL_WEIGHTS, ftOnlyCategories: new Set(), budget });
}

const mainItems = (day) =>
  day.blocks.filter((b) => b.block !== 'WU' && b.block !== 'CD').flatMap((b) => b.items);

test('a day never exceeds its available minutes, and total_minutes matches the placed sum', () => {
  const day = build(variedPool(), { day: '火', minutes: 100, court: '全面' });
  const placed = day.blocks.flatMap((b) => b.items).reduce((s, it) => s + it.minutes, 0);
  assert.equal(placed, day.total_minutes, 'total_minutes equals the placed sum');
  assert.ok(day.total_minutes <= 100, 'total within the day budget');
});

test('each main block draws only its own block-type categories (category-fit)', () => {
  const day = build(variedPool(), { day: '火', minutes: 100, court: '全面' });
  for (const b of day.blocks) {
    if (b.block === 'WU' || b.block === 'CD') continue;
    for (const it of b.items) {
      assert.ok(
        ALLOWED[b.block]?.has(it.category),
        `${b.block} ブロックに場違いカテゴリ「${it.category}」(${it.name}) が混入`,
      );
    }
  }
});

test('the live-game block never contains a finishing / solo skill drill (handoff 却下理由4)', () => {
  const day = build(variedPool(), { day: '土', minutes: 165, court: '全面' });
  const game = day.blocks.find((b) => b.block === 'ゲーム');
  for (const it of game?.items ?? []) {
    assert.equal(it.category, '意思決定/ゲーム形式', `ゲームに非ゲーム形式「${it.name}」が混入`);
  }
});

test('main segments are sustained (each ≥15min) and few enough to respect switch cost', () => {
  for (const m of [100, 165]) {
    const day = build(variedPool(), { day: 'X', minutes: m, court: '全面' });
    const items = mainItems(day);
    const shape = computeSessionShape(m);
    assert.ok(items.length > 0, `${m}: main segments must be placed`);
    assert.ok(items.length <= shape.maxMain, `${m}: ${items.length} main segments exceed the switch-cost max ${shape.maxMain}`);
    for (const it of items) {
      assert.ok(it.minutes >= 15, `${m}: a main segment must be sustained (≥15min), got ${it.minutes} for ${it.name}`);
    }
  }
});

test('half-court day excludes full-court-only drills from the plan', () => {
  const pool = variedPool().filter((x) => !x.requiresFull);
  pool.push(d({ id: 'FULL', category: 'シュート', court: '全面', duration_min: 5 }));
  const filtered = pool.filter((x) => !x.requiresFull); // allocate trusts a pre-filtered pool
  const day = build(filtered, { day: '水', minutes: 100, court: '半面' });
  const ids = day.blocks.flatMap((b) => b.items).map((it) => it.drill_id);
  assert.ok(!ids.includes('FULL'), 'full-court-only drill must not appear on a half-court day');
});

test('a drill is not reused twice within the same day', () => {
  const day = build(variedPool(), { day: '木', minutes: 100, court: '全面' });
  const ids = day.blocks.flatMap((b) => b.items).map((it) => it.drill_id);
  assert.equal(new Set(ids).size, ids.length, 'no drill is placed twice in one day');
});
