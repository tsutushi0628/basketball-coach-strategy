/**
 * @file Tests for roster-sheet normalization.
 * spec: docs/findings/spec-20260905-scrimmage-split.md §2.1. Synthetic
 * names/ids only (no real player data).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeRoster } from '../src/roster.js';

const HEADER = ['選手ID', '表示名', '性別', '学年', '在籍状態', '身長cm', 'Tier', '役割'];

function row({
  id = 'M01',
  name = 'アオキ',
  gender = '男性',
  grade = '1',
  active = '在籍',
  heightCm = '170',
  tier = '3',
  roles = 'ハンドラー',
} = {}) {
  return [id, name, gender, grade, active, heightCm, tier, roles];
}

test('normalizeRoster: splits the 役割 cell on all 6 delimiter kinds, drops unknown words, dedups', () => {
  const values = [
    HEADER,
    row({ id: 'M01', roles: 'ハンドラー,シューター，パサー、リムアタッカー\nスラッシャー ハンドラー　謎ワード' }),
  ];
  const { players } = normalizeRoster(values);
  assert.equal(players.length, 1);
  assert.deepEqual(
    [...players[0].roles].sort(),
    ['handler', 'passer', 'rimAttacker', 'shooter', 'slasher'].sort(),
  );
  assert.deepEqual(players[0].missing, []);
});

test('normalizeRoster: Tier out of range (or non-numeric) defaults to 3 and is flagged missing', () => {
  const values = [HEADER, row({ id: 'M01', tier: '9' }), row({ id: 'M02', tier: 'abc' })];
  const { players } = normalizeRoster(values);
  for (const p of players) {
    assert.equal(p.tier, 3);
    assert.ok(p.missing.includes('tier'));
  }
});

test('normalizeRoster: missing/invalid heightCm is filled with the same-gender median (lower of the two middles)', () => {
  const values = [
    HEADER,
    row({ id: 'M01', gender: '男', heightCm: '160' }),
    row({ id: 'M02', gender: '男', heightCm: '170' }),
    row({ id: 'M03', gender: '男', heightCm: '180' }),
    row({ id: 'M04', gender: '男', heightCm: '190' }),
    row({ id: 'M05', gender: '男', heightCm: 'unknown' }), // missing → median of [160,170,180,190]
  ];
  const { players } = normalizeRoster(values);
  const p5 = players.find((p) => p.playerId === 'M05');
  // even count → lower of the two middles: sorted [160,170,180,190] → 170.
  assert.equal(p5.heightCm, 170);
  assert.ok(p5.missing.includes('heightCm'));
});

test('normalizeRoster: no valid same-gender height at all falls back to 160', () => {
  const values = [HEADER, row({ id: 'F01', gender: '女', heightCm: 'bad' })];
  const { players } = normalizeRoster(values);
  assert.equal(players[0].heightCm, 160);
  assert.ok(players[0].missing.includes('heightCm'));
});

test('normalizeRoster: missing/unrecognized gender skips the row (not取り込む)', () => {
  const values = [
    HEADER,
    row({ id: 'M01', gender: '' }),
    row({ id: 'M02', gender: '不明' }),
    row({ id: 'M03', gender: '男性' }),
  ];
  const { players, skipped } = normalizeRoster(values);
  assert.equal(players.length, 1);
  assert.equal(players[0].playerId, 'M03');
  assert.equal(skipped, 2);
});

test('normalizeRoster: invalid 選手ID and empty 表示名 also skip the row', () => {
  const values = [
    HEADER,
    row({ id: 'X01' }), // bad id pattern
    row({ id: 'M02', name: '   ' }), // empty after trim
    row({ id: 'M03' }),
  ];
  const { players, skipped } = normalizeRoster(values);
  assert.equal(players.length, 1);
  assert.equal(players[0].playerId, 'M03');
  assert.equal(skipped, 2);
});

test('normalizeRoster: missing 学年 defaults to 1 and is flagged; 在籍状態 without 在籍 is false', () => {
  const values = [HEADER, row({ id: 'M01', grade: '', active: '退部' })];
  const { players } = normalizeRoster(values);
  assert.equal(players[0].grade, 1);
  assert.ok(players[0].missing.includes('grade'));
  assert.equal(players[0].active, false);
});

test('normalizeRoster: empty 役割 cell is flagged missing with an empty roles array', () => {
  const values = [HEADER, row({ id: 'M01', roles: '' })];
  const { players } = normalizeRoster(values);
  assert.deepEqual(players[0].roles, []);
  assert.ok(players[0].missing.includes('roles'));
});
