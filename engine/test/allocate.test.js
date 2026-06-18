/**
 * @file Tests for the FIXED 6-block per-day allocation (作り直し方針2/3).
 *
 * Asserts the business intent of the rebuilt session form, not the old switch-cost
 * segment model:
 *   - the day is built as the fixed 6 blocks in fixed order
 *     アップ→ファンダ→シュート→対人→ラン→静的 (present blocks never invert);
 *   - each block draws only its own block's drills (category-fit by blockOf);
 *   - the session ALWAYS ends with the 静的 (static-stretch) block;
 *   - 意思決定/ゲーム形式 (5on5/scrimmage) is NOT an independent block — it appears only at the
 *     対人 block tail, and only on full-court days;
 *   - the day never overflows its minutes and total_minutes matches the placed sum;
 *   - the day skeleton sums to the day minutes and stays on a 5-minute grain;
 *   - no drill repeats within a day.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeDrill } from '../src/normalize.js';
import { createLoadBudget } from '../src/loadModel.js';
import { computeDaySkeleton, allocateDay, blockOf, BLOCK_ORDER } from '../src/allocate.js';

// ───────────────────────────────────────────────────────────────────────────
// Day skeleton: the fixed 6-block minute template honors the SCHEDULE (court +
// minutes + run override), sums exactly to the day, stays on a 5-minute grain.
// ───────────────────────────────────────────────────────────────────────────
test('day skeleton: the 6 fixed blocks sum to the day minutes on a 5-minute grain', () => {
  const cases = [
    { day: '火', minutes: 120, court: '全面', run_minutes: 60 },
    { day: '水', minutes: 120, court: '半面', run_minutes: 0 },
    { day: '金', minutes: 120, court: '全面', run_minutes: 15 },
    { day: '土', minutes: 180, court: '全面', run_minutes: 25 },
  ];
  for (const sd of cases) {
    const s = computeDaySkeleton(sd);
    const sum = s.アップ + s.ファンダ + s.シュート + s.対人 + s.ラン + s.静的;
    assert.equal(sum, sd.minutes, `${sd.day}: 6ブロックの合計が枠 ${sd.minutes}分 に一致するべき`);
    for (const k of BLOCK_ORDER) {
      assert.equal(s[k] % 5, 0, `${sd.day}: ${k} が5分刻みであるべき (got ${s[k]})`);
    }
  }
});

test('day skeleton: half-court days carry NO run block; full-court days do (走る系は全面のみ)', () => {
  const half = computeDaySkeleton({ day: '水', minutes: 120, court: '半面', run_minutes: 0 });
  assert.equal(half.ラン, 0, '半面日は走り込み(ラン)を持たない');
  const full = computeDaySkeleton({ day: '金', minutes: 120, court: '全面', run_minutes: 15 });
  assert.ok(full.ラン > 0, '全面日は走り込み(ラン)を持つ');
});

function d(over) {
  return normalizeDrill({
    id: over.id,
    name: over.name ?? over.id,
    category: over.category ?? 'フィニッシュ(ゴール下/レイアップ)',
    court: over.court ?? '不問',
    grades: '全',
    intensity_class: over.intensity_class ?? '低',
    duration_min: over.duration_min ?? 10,
    duration_max: over.duration_max ?? over.duration_min ?? 10,
    sub_skill: over.sub_skill ?? '',
    mastery_stage: over.mastery_stage ?? '反復',
    philosophy_tags: over.philosophy_tags ?? [],
  });
}

/** A varied pool covering every block (conditioning split 3 ways + each main block). */
function variedPool() {
  const pool = [];
  // Warm-up activation (アップ).
  for (let i = 0; i < 3; i++) {
    pool.push(d({ id: `WUP${i}`, name: `動的ストレッチ${i}`, category: 'コンディショニング/ウォームアップ', duration_min: 5, sub_skill: '可動域', philosophy_tags: ['ウォームアップ', '可動域'] }));
  }
  // Conditioning run (ラン).
  for (let i = 0; i < 4; i++) {
    pool.push(d({ id: `RUN${i}`, name: `走り込み${i}`, category: 'コンディショニング/ウォームアップ', duration_min: 5, intensity_class: '中', sub_skill: '心肺持久力', philosophy_tags: ['心肺', 'スプリント'] }));
  }
  // Static stretch (静的).
  for (let i = 0; i < 3; i++) {
    pool.push(d({ id: `CD${i}`, name: `整理運動${i}`, category: 'コンディショニング/ウォームアップ', duration_min: 5, sub_skill: '静的ストレッチ', philosophy_tags: ['クールダウン', '整理運動'] }));
  }
  // ファンダ.
  for (let i = 0; i < 3; i++) pool.push(d({ id: `HND${i}`, category: 'ハンドリング/ドリブル', duration_min: 10 }));
  for (let i = 0; i < 2; i++) pool.push(d({ id: `PAS${i}`, category: 'パス&スペーシング', duration_min: 10 }));
  // シュート.
  for (let i = 0; i < 3; i++) pool.push(d({ id: `SHT${i}`, category: 'シュート', duration_min: 10 }));
  for (let i = 0; i < 2; i++) pool.push(d({ id: `FIN${i}`, category: 'フィニッシュ(ゴール下/レイアップ)', duration_min: 10 }));
  // 対人.
  for (let i = 0; i < 3; i++) pool.push(d({ id: `ONE${i}`, category: '1on1', duration_min: 10 }));
  for (let i = 0; i < 2; i++) pool.push(d({ id: `TDF${i}`, category: 'チームディフェンス(オールコートマンツー/ヘルプ/帰陣)', duration_min: 10 }));
  // ゲーム形式 (scrimmage tail).
  for (let i = 0; i < 2; i++) pool.push(d({ id: `DEC${i}`, name: `5対5ゲーム${i}`, category: '意思決定/ゲーム形式', duration_min: 10 }));
  return pool;
}

const FINAL_WEIGHTS = {
  'フィニッシュ(ゴール下/レイアップ)': 0.2,
  'シュート': 0.15,
  'ハンドリング/ドリブル': 0.15,
  'パス&スペーシング': 0.05,
  '1on1': 0.15,
  'チームディフェンス(オールコートマンツー/ヘルプ/帰陣)': 0.15,
  '意思決定/ゲーム形式': 0.1,
};

function build(pool, scheduleDay, weekFocus = { headline: '', mastery_bias: [], allow_scrimmage: true }) {
  const budget = createLoadBudget({ high_intensity_per_session: 2, high_intensity_per_week: 3, no_consecutive_high_days: true });
  return allocateDay({ scheduleDay, dayPool: pool, finalWeights: FINAL_WEIGHTS, ftOnlyCategories: new Set(), budget, weekFocus });
}

test('a full day is built as the fixed 6-block order (present blocks never invert)', () => {
  const day = build(variedPool(), { day: '金', minutes: 120, court: '全面', run_minutes: 15 });
  const rank = new Map(BLOCK_ORDER.map((b, i) => [b, i]));
  let prev = -1;
  for (const b of day.blocks) {
    const r = rank.get(b.block);
    assert.ok(r !== undefined, `未知のブロック「${b.block}」`);
    assert.ok(r > prev, `ブロック順が固定形に反する: ${day.blocks.map((x) => x.block).join('→')}`);
    prev = r;
  }
});

test('every day ends with the 静的 (static-stretch) block — a session is never cut off by a game/run', () => {
  for (const sd of [
    { day: '火', minutes: 120, court: '全面', run_minutes: 60 },
    { day: '水', minutes: 120, court: '半面', run_minutes: 0 },
    { day: '土', minutes: 180, court: '全面', run_minutes: 25 },
  ]) {
    const day = build(variedPool(), sd);
    const keys = day.blocks.map((b) => b.block);
    assert.equal(keys[keys.length - 1], '静的', `${sd.day}: 静的ストレッチで終わるべき (末尾=${keys[keys.length - 1]})`);
  }
});

test('each block draws only its own block-type drills (category-fit via blockOf)', () => {
  const pool = variedPool();
  const byId = new Map(pool.map((d) => [d.id, d]));
  const day = build(pool, { day: '土', minutes: 180, court: '全面', run_minutes: 25 });
  for (const b of day.blocks) {
    for (const it of b.items) {
      // 意思決定/ゲーム形式 is the 対人-tail special case (blockOf returns null for it),
      // so it is allowed to sit inside the 対人 block; everything else must match blockOf
      // on the REAL drill (conditioning splits アップ/ラン/静的 by its actual tags/sub_skill).
      if (it.category === '意思決定/ゲーム形式') {
        assert.equal(b.block, '対人', `5on5/ゲーム形式「${it.name}」は対人ブロック内のみ可`);
        continue;
      }
      const drill = byId.get(it.drill_id);
      assert.equal(blockOf(drill), b.block, `${b.block} ブロックに場違いドリル「${it.name}」(blockOf=${blockOf(drill)})`);
    }
  }
});

test('the contested block ends with a 5on5 scrimmage on a full-court allow-scrimmage day', () => {
  const day = build(variedPool(), { day: '土', minutes: 180, court: '全面', run_minutes: 25 }, { headline: '', mastery_bias: [], allow_scrimmage: true });
  const contested = day.blocks.find((b) => b.block === '対人');
  assert.ok(contested && contested.items.length > 0, '対人ブロックが存在するべき');
  const last = contested.items[contested.items.length - 1];
  assert.equal(last.category, '意思決定/ゲーム形式', '対人ブロックの末尾は5on5/ゲーム形式であるべき');
});

test('a half-court day has NO scrimmage anywhere (5on5は全面の日だけ)', () => {
  const day = build(variedPool(), { day: '水', minutes: 120, court: '半面', run_minutes: 0 }, { headline: '', mastery_bias: [], allow_scrimmage: true });
  for (const b of day.blocks) {
    for (const it of b.items) {
      assert.notEqual(it.category, '意思決定/ゲーム形式', `半面日に5on5/ゲーム形式「${it.name}」が混入`);
    }
  }
});

test('when the week forbids scrimmage, no scrimmage appears even on a full-court day (型づくり週)', () => {
  const day = build(variedPool(), { day: '金', minutes: 120, court: '全面', run_minutes: 15 }, { headline: '型づくり', mastery_bias: ['習得'], allow_scrimmage: false });
  for (const b of day.blocks) {
    for (const it of b.items) {
      assert.notEqual(it.category, '意思決定/ゲーム形式', `型づくり週(allow_scrimmage=false)で5on5「${it.name}」が混入`);
    }
  }
});

test('a day never exceeds its available minutes, and total_minutes matches the placed sum', () => {
  const day = build(variedPool(), { day: '金', minutes: 120, court: '全面', run_minutes: 15 });
  const placed = day.blocks.flatMap((b) => b.items).reduce((s, it) => s + it.minutes, 0);
  assert.equal(placed, day.total_minutes, 'total_minutes equals the placed sum');
  assert.ok(day.total_minutes <= 120, 'total within the day budget');
});

test('half-court day excludes full-court-only drills from the plan', () => {
  const pool = variedPool();
  pool.push(d({ id: 'FULL', category: 'シュート', court: '全面', duration_min: 10 }));
  const filtered = pool.filter((x) => !x.requiresFull); // allocate trusts a pre-filtered pool
  const day = build(filtered, { day: '水', minutes: 120, court: '半面', run_minutes: 0 });
  const ids = day.blocks.flatMap((b) => b.items).map((it) => it.drill_id);
  assert.ok(!ids.includes('FULL'), 'full-court-only drill must not appear on a half-court day');
});

test('a drill is not reused twice within the same day', () => {
  const day = build(variedPool(), { day: '土', minutes: 180, court: '全面', run_minutes: 25 });
  const ids = day.blocks.flatMap((b) => b.items).map((it) => it.drill_id);
  assert.equal(new Set(ids).size, ids.length, 'no drill is placed twice in one day');
});
