/**
 * @file Tests for roster-sheet normalization（男女別タブ・選手ID自動付与）。
 * spec: docs/findings/spec-20260905-scrimmage-split.md §2.1。合成名・合成IDのみ（実在の選手データは使わない）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeRoster, parseTier } from '../src/roster.js';

const HEADER = [
  '選手ID', '表示名', '学年', 'ポジション', '利き手', '在籍状態', '身長cm', 'Tier',
  '役割1', '役割2', '役割3', '本人の目標', 'メモ',
];

function row({
  id = '',
  name = 'アオキ',
  grade = '1',
  position = 'PG',
  hand = '右',
  active = '在籍',
  heightCm = '170',
  tier = 'B',
  role1 = 'ハンドラー',
  role2 = '',
  role3 = '',
  goal = '',
  memo = '',
} = {}) {
  return [id, name, grade, position, hand, active, heightCm, tier, role1, role2, role3, goal, memo];
}

test('normalizeRoster: 役割1〜3 を集めて roles にする（重複除去・不明語は黙って捨てる）', () => {
  const values = [
    HEADER,
    row({ name: 'アオキ', role1: 'ハンドラー', role2: 'シューター', role3: 'ハンドラー' }),
    row({ name: 'イシダ', role1: '謎ワード', role2: 'パサー', role3: '' }),
  ];
  const { players } = normalizeRoster(values, 'M');
  assert.deepEqual(players[0].roles, ['handler', 'shooter']);
  assert.deepEqual(players[1].roles, ['passer']);
  assert.deepEqual(players[0].missing, []);
});

test('normalizeRoster: 1つの役割セルに区切り文字で複数書いても従来どおり解決する', () => {
  const values = [
    HEADER,
    row({ role1: 'ハンドラー,シューター，パサー、リムアタッカー\nスラッシャー ハンドラー　謎ワード' }),
  ];
  const { players } = normalizeRoster(values, 'M');
  assert.deepEqual(
    [...players[0].roles].sort(),
    ['handler', 'passer', 'rimAttacker', 'shooter', 'slasher'].sort(),
  );
});

test('normalizeRoster: 性別は引数（タブ由来）で決まり、シートに性別の列は無い', () => {
  const { players: men } = normalizeRoster([HEADER, row({ name: 'アオキ' })], 'M');
  const { players: women } = normalizeRoster([HEADER, row({ name: 'エガワ' })], 'F');
  assert.equal(men[0].gender, 'M');
  assert.equal(women[0].gender, 'F');
  assert.equal(men[0].playerId, 'M001');
  assert.equal(women[0].playerId, 'F001');
});

test('normalizeRoster: 性別引数が M/F 以外なら throw する', () => {
  assert.throws(() => normalizeRoster([HEADER, row({})], 'X'), /gender/);
});

test('normalizeRoster: 選手ID空欄の行に性別プレフィクス＋3桁連番を出現順で振る', () => {
  const values = [
    HEADER,
    row({ name: 'アオキ' }),
    row({ name: 'イシダ' }),
    row({ name: 'ウエダ' }),
  ];
  const { players, assignedIds } = normalizeRoster(values, 'M');
  assert.deepEqual(players.map((p) => p.playerId), ['M001', 'M002', 'M003']);
  // 1始まりのシート行番号（ヘッダが1行目）で返る＝書き戻し対象行。
  assert.deepEqual(assignedIds, [
    { row: 2, playerId: 'M001' },
    { row: 3, playerId: 'M002' },
    { row: 4, playerId: 'M003' },
  ]);
});

test('normalizeRoster: 既存IDは変えず、未使用の最小番号だけを空欄行に振る（衝突回避）', () => {
  const values = [
    HEADER,
    row({ name: 'アオキ', id: 'M001' }),
    row({ name: 'イシダ', id: '' }),   // M002 が既存なので M003 ではなく M002 は使えない → 002 は下の行が持つ
    row({ name: 'ウエダ', id: 'M002' }),
    row({ name: 'エノキ', id: '' }),
  ];
  const { players, assignedIds } = normalizeRoster(values, 'M');
  assert.deepEqual(players.map((p) => p.playerId), ['M001', 'M003', 'M002', 'M004']);
  assert.deepEqual(assignedIds, [
    { row: 3, playerId: 'M003' },
    { row: 5, playerId: 'M004' },
  ]);
});

test('normalizeRoster: 既存IDが連番の途中に穴を残していれば、その穴を先に埋める', () => {
  const values = [
    HEADER,
    row({ name: 'アオキ', id: 'F003' }),
    row({ name: 'イシダ', id: '' }),
    row({ name: 'ウエダ', id: '' }),
    row({ name: 'エガワ', id: '' }),
  ];
  const { players, assignedIds } = normalizeRoster(values, 'F');
  assert.deepEqual(players.map((p) => p.playerId), ['F003', 'F001', 'F002', 'F004']);
  assert.deepEqual(assignedIds.map((a) => a.playerId), ['F001', 'F002', 'F004']);
});

test('normalizeRoster: 他のIDの綴り（旧2桁・別プレフィクス）は変えずそのまま使う', () => {
  const values = [HEADER, row({ name: 'アオキ', id: 'M01' }), row({ name: 'イシダ', id: '' })];
  const { players, assignedIds } = normalizeRoster(values, 'M');
  assert.equal(players[0].playerId, 'M01', '既存IDは絶対に変えない');
  // 'M01' は M+数字として番号1を占めるので、空欄行は M002 になる。
  assert.equal(players[1].playerId, 'M002');
  assert.deepEqual(assignedIds, [{ row: 3, playerId: 'M002' }]);
});

test('normalizeRoster: 表示名が空の行はスキップ扱いで、IDも振らない（行番号も進まない）', () => {
  const values = [
    HEADER,
    row({ name: '   ' }),
    row({ name: 'イシダ' }),
    row({ name: '' }),
    row({ name: 'ウエダ' }),
  ];
  const { players, skipped, assignedIds } = normalizeRoster(values, 'M');
  assert.equal(skipped, 2);
  assert.deepEqual(players.map((p) => p.name), ['イシダ', 'ウエダ']);
  assert.deepEqual(assignedIds, [
    { row: 3, playerId: 'M001' },
    { row: 5, playerId: 'M002' },
  ]);
});

test('normalizeRoster: ドキュメントIDに使えない選手IDの行はスキップする', () => {
  const values = [HEADER, row({ name: 'アオキ', id: 'M/01' }), row({ name: 'イシダ', id: 'M002' })];
  const { players, skipped } = normalizeRoster(values, 'M');
  assert.equal(skipped, 1);
  assert.deepEqual(players.map((p) => p.playerId), ['M002']);
});

test('parseTier: S/A/B/C/D の5段が 5/4/3/2/1 に写る（S が最強）', () => {
  assert.equal(parseTier('S'), 5);
  assert.equal(parseTier('A'), 4);
  assert.equal(parseTier('B'), 3);
  assert.equal(parseTier('C'), 2);
  assert.equal(parseTier('D'), 1);
});

test('parseTier: 小文字・全角英字・前後空白も受ける', () => {
  assert.equal(parseTier('s'), 5);
  assert.equal(parseTier('d'), 1);
  assert.equal(parseTier('Ｓ'), 5);
  assert.equal(parseTier('ｂ'), 3);
  assert.equal(parseTier('  A  '), 4);
  assert.equal(parseTier('　C　'), 2);
});

test('parseTier: 旧表記の 1〜5 の数字入力も従来どおり受ける（全角数字も）', () => {
  assert.equal(parseTier('1'), 1);
  assert.equal(parseTier('5'), 5);
  assert.equal(parseTier(3), 3);
  assert.equal(parseTier(' 4 '), 4);
  assert.equal(parseTier('２'), 2);
});

test('parseTier: 不正値・空欄は null（呼び出し側が既定値を入れる）', () => {
  for (const bad of ['', '   ', 'E', 'SS', 'AB', '0', '6', '9', 'abc', '3.5', null, undefined]) {
    assert.equal(parseTier(bad), null, `parseTier(${JSON.stringify(bad)})`);
  }
});

test('normalizeRoster: Tier の S/A/B/C/D が内部 tier 5/4/3/2/1 になる', () => {
  const values = [
    HEADER,
    row({ name: 'アオキ', tier: 'S' }),
    row({ name: 'イシダ', tier: 'a' }),
    row({ name: 'ウエダ', tier: 'Ｂ' }),
    row({ name: 'エノキ', tier: ' C ' }),
    row({ name: 'オオタ', tier: 'D' }),
  ];
  const { players } = normalizeRoster(values, 'M');
  assert.deepEqual(players.map((p) => p.tier), [5, 4, 3, 2, 1]);
  for (const p of players) assert.equal(p.missing.includes('tier'), false);
});

test('normalizeRoster: 旧表記の数字 Tier も従来どおり取り込む（後方互換）', () => {
  const values = [HEADER, row({ name: 'アオキ', tier: '5' }), row({ name: 'イシダ', tier: '1' })];
  const { players } = normalizeRoster(values, 'M');
  assert.deepEqual(players.map((p) => p.tier), [5, 1]);
  for (const p of players) assert.equal(p.missing.includes('tier'), false);
});

test('normalizeRoster: Tier が不正値・空欄なら 3 を入れて missing に載せる（現状の向きのまま）', () => {
  const values = [
    HEADER,
    row({ name: 'アオキ', tier: '9' }),
    row({ name: 'イシダ', tier: 'abc' }),
    row({ name: 'ウエダ', tier: 'E' }),
    row({ name: 'エノキ', tier: '' }),
  ];
  const { players } = normalizeRoster(values, 'M');
  for (const p of players) {
    assert.equal(p.tier, 3);
    assert.ok(p.missing.includes('tier'));
  }
});

test('normalizeRoster: missing/invalid heightCm is filled with the tab median (lower of the two middles)', () => {
  const values = [
    HEADER,
    row({ name: 'アオキ', heightCm: '160' }),
    row({ name: 'イシダ', heightCm: '170' }),
    row({ name: 'ウエダ', heightCm: '180' }),
    row({ name: 'エノキ', heightCm: '190' }),
    row({ name: 'オオタ', heightCm: 'unknown' }),
  ];
  const { players } = normalizeRoster(values, 'M');
  const p5 = players.find((p) => p.name === 'オオタ');
  // even count → lower of the two middles: sorted [160,170,180,190] → 170.
  assert.equal(p5.heightCm, 170);
  assert.ok(p5.missing.includes('heightCm'));
});

test('normalizeRoster: no valid height at all falls back to 160', () => {
  const values = [HEADER, row({ name: 'エガワ', heightCm: 'bad' })];
  const { players } = normalizeRoster(values, 'F');
  assert.equal(players[0].heightCm, 160);
  assert.ok(players[0].missing.includes('heightCm'));
});

test('normalizeRoster: missing 学年 defaults to 1 and is flagged; 在籍状態 without 在籍 is false', () => {
  const values = [HEADER, row({ name: 'アオキ', grade: '', active: '退部' })];
  const { players } = normalizeRoster(values, 'M');
  assert.equal(players[0].grade, 1);
  assert.ok(players[0].missing.includes('grade'));
  assert.equal(players[0].active, false);
});

test('normalizeRoster: 役割1〜3 が全部空なら roles は空配列で missing に載る', () => {
  const values = [HEADER, row({ name: 'アオキ', role1: '', role2: '', role3: '' })];
  const { players } = normalizeRoster(values, 'M');
  assert.deepEqual(players[0].roles, []);
  assert.ok(players[0].missing.includes('roles'));
});

test('normalizeRoster: ポジション・利き手・本人の目標・メモは正規化結果に残らない', () => {
  const values = [HEADER, row({ name: 'アオキ', position: 'PG', hand: '左', goal: '優勝', memo: '要フォロー' })];
  const { players } = normalizeRoster(values, 'M');
  assert.deepEqual(
    Object.keys(players[0]).sort(),
    ['active', 'gender', 'grade', 'heightCm', 'missing', 'name', 'playerId', 'roles', 'tier'].sort(),
  );
});

test('normalizeRoster: 空の values は空の結果を返す', () => {
  assert.deepEqual(normalizeRoster([], 'M'), { players: [], skipped: 0, assignedIds: [] });
});
