/**
 * @file Tests for gap → weight math. Verifies the known-good values from
 * DESIGN.md §3 (the team is at the sample input distances from target).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { gapRatio, computeFinalWeights, normalizeWeights } from '../src/gap.js';

const SAMPLE_CONFIG = {
  phase_category_weights: {
    'ハンドリング/ドリブル': 0.2,
    'フィニッシュ(ゴール下/レイアップ)': 0.2,
    'シュート': 0.15,
    '1on1': 0.15,
    'チームディフェンス(オールコートマンツー/ヘルプ/帰陣)': 0.15,
    '意思決定/ゲーム形式': 0.15,
  },
};

const SAMPLE_INPUT = {
  indicators: [
    { id: 'FT率', good_direction: 'up', baseline: 40, latest: 52, target: 70 },
    { id: '試合TO', good_direction: 'down', baseline: 20, latest: 16, target: 10 },
    { id: 'ゴール下成功率', good_direction: 'up', baseline: 45, latest: 55, target: 70 },
  ],
};

test('gapRatio: up direction = remaining fraction toward target', () => {
  assert.equal(gapRatio(SAMPLE_INPUT.indicators[0]), (70 - 52) / (70 - 40)); // 0.6
});

test('gapRatio: down direction = remaining fraction toward (lower) target', () => {
  assert.equal(gapRatio(SAMPLE_INPUT.indicators[1]), (16 - 10) / (20 - 10)); // 0.6
});

test('gapRatio: clamps to [0,1] when already past target', () => {
  assert.equal(gapRatio({ good_direction: 'up', baseline: 40, latest: 80, target: 70 }), 0);
  assert.equal(gapRatio({ good_direction: 'up', baseline: 40, latest: 30, target: 70 }), 1);
});

test('gapRatio: zero distance (target == baseline) yields no signal', () => {
  assert.equal(gapRatio({ good_direction: 'up', baseline: 50, latest: 50, target: 50 }), 0);
});

test('finalWeights: main focus is フィニッシュ and weights sum to 1', () => {
  const { finalWeights, mainFocus } = computeFinalWeights(SAMPLE_CONFIG, SAMPLE_INPUT);
  const sum = Object.values(finalWeights).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `weights must sum to 1, got ${sum}`);
  assert.equal(mainFocus, 'フィニッシュ(ゴール下/レイアップ)');
});

test('finalWeights: known-good values from DESIGN §3', () => {
  const { finalWeights } = computeFinalWeights(SAMPLE_CONFIG, SAMPLE_INPUT);
  // combined (pre-normalize): フィニッシュ 0.8, シュート 0.75, ハンドリング 0.44,
  // 意思決定 0.33, 1on1 0.15, チームDF 0.15, パス&スペーシング 0.18; total 2.8.
  assert.ok(Math.abs(finalWeights['フィニッシュ(ゴール下/レイアップ)'] - 0.8 / 2.8) < 1e-6);
  assert.ok(Math.abs(finalWeights['シュート'] - 0.75 / 2.8) < 1e-6);
  // gap-only category (absent from phase weights) must survive.
  assert.ok(finalWeights['パス&スペーシング'] > 0, 'gap-only category must be retained');
});

test('normalizeWeights: empty / all-zero input returns empty object', () => {
  assert.deepEqual(normalizeWeights({}), {});
  assert.deepEqual(normalizeWeights({ a: 0, b: 0 }), {});
});
