/**
 * @file Tests for the hard gates. Each gate must THROW on a violating plan and
 * pass on a clean one — these are the engine's last line of defense.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeDrill } from '../src/normalize.js';
import {
  assertTimeFits,
  assertNoZone,
  assertNoSetsInYear,
  assertLoadCap,
  assertMainFocusPresent,
} from '../src/gates.js';

const CONFIG = {
  category: '中学',
  current_month: 8,
  philosophy: { zone_forbidden: true, sets_forbidden_in_year: true },
  load_caps: { high_intensity_per_session: 2, high_intensity_per_week: 3, no_consecutive_high_days: true },
};

function day(items, minutes = 100, label = '火') {
  return {
    day: label,
    minutes,
    court: '全面',
    blocks: [{ block: '技術', items }],
    total_minutes: items.reduce((s, it) => s + it.minutes, 0),
    high_intensity_count: items.filter((it) => it.intensity_class === '高').length,
  };
}

function item(over) {
  return {
    drill_id: over.drill_id ?? 'X',
    name: over.name ?? 'd',
    minutes: over.minutes ?? 10,
    category: over.category ?? 'シュート',
    intensity_class: over.intensity_class ?? '中',
  };
}

test('assertTimeFits throws when a day overflows its minutes', () => {
  const plan = { days: [day([item({ minutes: 120 })], 100)] };
  assert.throws(() => assertTimeFits(plan), /assertTimeFits/);
});

test('assertTimeFits passes when within budget', () => {
  const plan = { days: [day([item({ minutes: 80 })], 100)] };
  assert.doesNotThrow(() => assertTimeFits(plan));
});

test('assertNoZone throws when a zone drill slipped into a middle-school plan', () => {
  const zone = normalizeDrill({ id: 'Z', name: 'ゾーン守備', category: 'チームディフェンス', court: '全面', grades: '全', intensity_class: '中' });
  const idx = new Map([['Z', zone]]);
  const plan = { days: [day([item({ drill_id: 'Z', name: 'ゾーン守備' })])] };
  assert.throws(() => assertNoZone(plan, CONFIG, idx), /assertNoZone/);
});

test('assertNoSetsInYear throws when an in-year set play is present', () => {
  const sets = normalizeDrill({ id: 'S', name: 'セットオフェンス', category: 'チームオフェンス', court: '全面', grades: '全', intensity_class: '中' });
  const idx = new Map([['S', sets]]);
  const plan = { days: [day([item({ drill_id: 'S', name: 'セットオフェンス' })])] };
  assert.throws(() => assertNoSetsInYear(plan, CONFIG, idx), /assertNoSetsInYear/);
});

test('assertLoadCap throws on too many high drills in one session', () => {
  const items = [item({ intensity_class: '高' }), item({ intensity_class: '高' }), item({ intensity_class: '高' })];
  const plan = { days: [day(items)] };
  assert.throws(() => assertLoadCap(plan, CONFIG), /assertLoadCap/);
});

test('assertLoadCap throws on consecutive heavy days', () => {
  const plan = {
    days: [
      day([item({ intensity_class: '高' })], 100, '火'),
      day([item({ intensity_class: '高' })], 100, '水'),
    ],
  };
  assert.throws(() => assertLoadCap(plan, CONFIG), /連続日/);
});

test('assertLoadCap throws when weekly total exceeds the cap', () => {
  // 2 high on day1 (ok per-session), rest day, 2 high on day3 → week=4 > 3.
  const plan = {
    days: [
      day([item({ intensity_class: '高' }), item({ intensity_class: '高' })], 100, '火'),
      day([item({ intensity_class: '低' })], 100, '水'),
      day([item({ intensity_class: '高' }), item({ intensity_class: '高' })], 100, '木'),
    ],
  };
  assert.throws(() => assertLoadCap(plan, CONFIG), /週上限/);
});

test('assertMainFocusPresent throws when the main focus is absent all week', () => {
  const plan = { days: [day([item({ category: 'シュート' })])] };
  assert.throws(
    () => assertMainFocusPresent(plan, '1on1'),
    /assertMainFocusPresent/,
  );
});

test('assertMainFocusPresent passes when the focus appears at least once', () => {
  const plan = { days: [day([item({ category: '1on1' })])] };
  assert.doesNotThrow(() =>
    assertMainFocusPresent(plan, '1on1'),
  );
});
