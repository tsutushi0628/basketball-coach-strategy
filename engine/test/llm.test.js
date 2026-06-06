/**
 * @file Tests for the LLM stub. MVP behavior is a deterministic keyword map:
 * known coach phrasings resolve to a category; unknown input returns null.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mapCoachCommentToCategory, KNOWN_CATEGORIES } from '../src/llm.js';

test('maps free-text coach comments to a known category', () => {
  assert.equal(mapCoachCommentToCategory('今週はゴール下の決定力を上げたい'),
    'フィニッシュ(ゴール下/レイアップ)');
  assert.equal(mapCoachCommentToCategory('フリースローを練習したい'), 'シュート');
  assert.equal(mapCoachCommentToCategory('ターンオーバーを減らす判断力'),
    '意思決定/ゲーム形式');
});

test('every mapped result is one of the known categories', () => {
  for (const c of ['ドリブル', 'パス', 'リバウンド', 'ディフェンス', 'ウォームアップ']) {
    const r = mapCoachCommentToCategory(c);
    assert.ok(KNOWN_CATEGORIES.includes(r), `${c} → ${r} must be a known category`);
  }
});

test('returns null for empty / unrecognized input (advisory, never load-bearing)', () => {
  assert.equal(mapCoachCommentToCategory(''), null);
  assert.equal(mapCoachCommentToCategory('   '), null);
  assert.equal(mapCoachCommentToCategory(null), null);
  assert.equal(mapCoachCommentToCategory('天気の話'), null);
});
