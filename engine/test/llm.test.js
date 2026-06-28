/**
 * @file Tests for the LLM stub. MVP behavior is a deterministic keyword map:
 * known coach phrasings resolve to a category; unknown input returns null.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { readFile } from 'node:fs/promises';

import { mapCoachCommentToCategory, KNOWN_CATEGORIES } from '../src/llm.js';
import { normalizeDrills } from '../src/normalize.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const engineRoot = resolve(__dirname, '..');
const repoRoot = resolve(engineRoot, '..');

test('maps free-text coach comments to a known category', () => {
  // 得点動作（ゴール下/レイアップ/決定力）は撤去済みの専用カテゴリではなくシュート枠へ写像される。
  assert.equal(mapCoachCommentToCategory('今週はゴール下の決定力を上げたい'), 'シュート');
  assert.equal(mapCoachCommentToCategory('フリースローを練習したい'), 'シュート');
  assert.equal(mapCoachCommentToCategory('ターンオーバーを減らす判断力'),
    '意思決定/ゲーム形式');
});

test('the finishing-category was retired — no comment may resolve to it', () => {
  // 撤去された死にカテゴリは語彙から消えていること（候補語彙のどこにも残らない）。
  assert.ok(!KNOWN_CATEGORIES.includes('フィニッシュ(ゴール下/レイアップ)'),
    '死にカテゴリ「フィニッシュ(ゴール下/レイアップ)」が KNOWN_CATEGORIES に残存している');
  // ゴール下/レイアップ/フィニッシュ/決定力 はどれもシュートに当たり、死にカテゴリには当たらない。
  for (const phrase of ['ゴール下を決めたい', 'レイアップの精度', 'フィニッシュ力', 'ゴール下の決定力']) {
    const r = mapCoachCommentToCategory(phrase);
    assert.notEqual(r, 'フィニッシュ(ゴール下/レイアップ)', `${phrase} が死にカテゴリへ写像された`);
    assert.equal(r, 'シュート', `${phrase} はシュート枠へ写像されるべき`);
  }
});

test('a mapped category always owns drills in the real catalog (never empty candidates)', async () => {
  // 業務意図: コーチ自由文が当たるカテゴリは実カタログにドリルを持ち、候補0件にならない。
  // 旧挙動（死にカテゴリ写像）なら『ゴール下の決定力』の候補が0件になり致命だった。
  const raw = JSON.parse(await readFile(resolve(repoRoot, 'docs/practice-knowledge/data/drills.json'), 'utf8'));
  const drills = normalizeDrills(raw);
  const phrases = ['今週はゴール下の決定力を上げたい', 'フリースローを練習したい', 'ドリブルを強化', 'リバウンドを取りたい'];
  for (const phrase of phrases) {
    const cat = mapCoachCommentToCategory(phrase);
    assert.ok(cat, `${phrase} は何らかのカテゴリに写像されるべき`);
    const candidates = drills.filter((d) => d.category === cat);
    assert.ok(candidates.length > 0, `${phrase} → ${cat} の候補が実カタログで0件（死にカテゴリ写像の疑い）`);
  }
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
