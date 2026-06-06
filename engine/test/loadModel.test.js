/**
 * @file Tests for the high-intensity load budget state machine. Asserts the
 * youth-safety policy: per-session cap, weekly cap, and no consecutive heavy days.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createLoadBudget } from '../src/loadModel.js';

test('per-session cap blocks a 3rd high drill in one day', () => {
  const b = createLoadBudget({
    high_intensity_per_session: 2,
    high_intensity_per_week: 99,
    no_consecutive_high_days: false,
  });
  assert.equal(b.canPlaceHigh(), true);
  b.recordHigh();
  b.recordHigh();
  assert.equal(b.canPlaceHigh(), false, 'session cap (2) reached');
});

test('weekly cap blocks placement once total reached, across days', () => {
  const b = createLoadBudget({
    high_intensity_per_session: 5,
    high_intensity_per_week: 3,
    no_consecutive_high_days: false,
  });
  b.recordHigh();
  b.recordHigh();
  b.endDay();
  b.recordHigh();
  assert.equal(b.weekHighCount(), 3);
  assert.equal(b.canPlaceHigh(), false, 'weekly cap (3) reached');
});

test('no-consecutive-day rule blocks a high drill the day after a heavy day', () => {
  const b = createLoadBudget({
    high_intensity_per_session: 5,
    high_intensity_per_week: 99,
    no_consecutive_high_days: true,
  });
  b.recordHigh(); // heavy day 1
  b.endDay();
  assert.equal(b.canPlaceHigh(), false, 'day immediately after a heavy day is blocked');
  b.endDay(); // a rest day (no high placed)
  assert.equal(b.canPlaceHigh(), true, 'after a non-heavy day, high is allowed again');
});

test('session counter resets at each day boundary', () => {
  const b = createLoadBudget({
    high_intensity_per_session: 1,
    high_intensity_per_week: 99,
    no_consecutive_high_days: false,
  });
  b.recordHigh();
  assert.equal(b.canPlaceHigh(), false);
  b.endDay();
  assert.equal(b.sessionHighCount(), 0, 'session count resets');
  assert.equal(b.canPlaceHigh(), true);
});
