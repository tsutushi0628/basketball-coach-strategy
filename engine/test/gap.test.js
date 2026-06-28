/**
 * @file Tests for gap → weight math. Verifies the known-good values from
 * DESIGN.md §3 (the team is at the sample input distances from target).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { gapRatio, computeFinalWeights, normalizeWeights } from '../src/gap.js';

// 方針反映後: 得点動作（ゴール下/レイアップ/マイカン）はシュートに集約。旧フィニッシュ重み(0.2)は
// シュート(0.15)へ合算して 0.35。指標 ゴール下成功率 も シュート へ写像される。
const SAMPLE_CONFIG = {
  phase_category_weights: {
    'ハンドリング/ドリブル': 0.2,
    'シュート': 0.35,
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

test('finalWeights: main focus is シュート（得点動作の集約）and weights sum to 1', () => {
  const { finalWeights, mainFocus } = computeFinalWeights(SAMPLE_CONFIG, SAMPLE_INPUT);
  const sum = Object.values(finalWeights).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `weights must sum to 1, got ${sum}`);
  // FT率(0.6)＋ゴール下成功率(0.6) が共に シュート へ乗るので、シュートが最重要主眼になる。
  assert.equal(mainFocus, 'シュート');
});

test('finalWeights: known-good values（得点動作集約後の再計算）', () => {
  const { finalWeights } = computeFinalWeights(SAMPLE_CONFIG, SAMPLE_INPUT);
  // combined (pre-normalize): シュート = phase 0.35 + gap(FT率0.6 + ゴール下0.6=1.2) = 1.55,
  // ハンドリング 0.2+0.24=0.44, 意思決定 0.15+0.18=0.33, 1on1 0.15, チームDF 0.15,
  // パス&スペーシング 0.18（gap のみ）; total 2.8.
  assert.ok(Math.abs(finalWeights['シュート'] - 1.55 / 2.8) < 1e-6);
  assert.ok(Math.abs(finalWeights['ハンドリング/ドリブル'] - 0.44 / 2.8) < 1e-6);
  // gap-only category (absent from phase weights) must survive.
  assert.ok(finalWeights['パス&スペーシング'] > 0, 'gap-only category must be retained');
  // 旧フィニッシュカテゴリは廃止＝finalWeights に現れない。
  assert.equal(finalWeights['フィニッシュ(ゴール下/レイアップ)'], undefined, '廃止カテゴリは重みに現れない');
});

test('normalizeWeights: empty / all-zero input returns empty object', () => {
  assert.deepEqual(normalizeWeights({}), {});
  assert.deepEqual(normalizeWeights({ a: 0, b: 0 }), {});
});
