/**
 * @file 週グリッドへのコーチ編集日の反映（pattern-timeline.mjs dayBlocks）の業務意図テスト。
 *
 * 検証する業務意図（fix: コーチが日を編集しても週ビューに反映されず空欄「—」になる不具合）:
 *   - コーチ上書き日（twoCol）でも、from/to を持つ各行から時間ブロックを合成して週グリッドに出す。
 *   - from/to のどちらかが空の行は除外する（週グリッドの 0:00 起点への潰れを防ぐ）。
 *   - 旧スキーマ（単一blocks）のコーチ日も、from/to を持つ blocks をそのまま返す。
 *   - 非coach日は従来どおり items 非空の blocks を返す。
 *   - buildWeekAxis はコーチ上書き日の合成ブロックを軸算出に取り込む（空欄にしない）。
 *
 * テスト基盤: node --test。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dayBlocks, buildWeekAxis } from './pattern-timeline.mjs';

/** コーチ上書き日（twoCol）の合成元。from/to を持つ行＋時刻空の行を混ぜる。 */
function coachTwoColDay() {
  return {
    day: '火',
    source: 'coach',
    twoCol: true,
    rows: [
      {
        from: '16:00', to: '17:00', minutes: 60,
        both: { block: 'ラン', label: 'ラントレ', items: [{ name: '走り込み・アジリティ', note: '屋外' }] },
        boys: null, girls: null,
      },
      {
        from: '17:00', to: '17:25', minutes: 25, both: null,
        boys: { block: '対人', label: 'アップ', items: [{ name: 'アップ（ゲーム準備）' }] },
        girls: { block: 'シュート', label: 'アラウンドシュート', items: [{ name: 'カールからゴール下', note: '全体10本' }] },
      },
      {
        // 時刻が空の行（週グリッドに置けない＝除外対象）
        from: '', to: '', minutes: null, both: null,
        boys: { block: 'ゲーム', label: 'ゲーム', items: [{ name: '5on5' }] }, girls: null,
      },
    ],
  };
}

/** 旧スキーマ（単一blocks）のコーチ日。blocks は from/to を持つ。 */
function coachLegacyDay() {
  return {
    day: '木',
    source: 'coach',
    twoCol: false,
    blocks: [
      { block: 'シュート', label: 'シュート', from: '16:05', to: '16:30', minutes: 25, isBundle: false, items: [{ name: 'レイアップ', mode: 'self' }] },
      // items 空の block は除外
      { block: '対人', label: '対人', from: '16:30', to: '16:50', minutes: 20, isBundle: false, items: [] },
    ],
  };
}

/** 非coach日（自動生成）。 */
function autoDay() {
  return {
    day: '金',
    blocks: [
      { block: 'シュート', label: 'シュート', from: '16:05', to: '16:25', minutes: 20, isBundle: false, items: [{ name: 'S1', mode: 'self' }] },
      { block: '対人', label: '対人', from: '16:25', to: '16:45', minutes: 20, isBundle: false, items: [] },
    ],
  };
}

test('コーチtwoCol日: from/to を持つ行が時間ブロックに合成され非null（週グリッドに出る）', () => {
  const blocks = dayBlocks(coachTwoColDay());
  assert.ok(Array.isArray(blocks), 'コーチtwoCol日でも null でなく配列を返す');
  assert.equal(blocks.length, 2, '時刻のある2行ぶんのブロック（時刻空の3行目は除外）');
});

test('コーチtwoCol日: 合成ブロックの from/to/minutes が行の時刻から正しく出る', () => {
  const blocks = dayBlocks(coachTwoColDay());
  assert.equal(blocks[0].from, '16:00');
  assert.equal(blocks[0].to, '17:00');
  assert.equal(blocks[0].minutes, 60, '17:00-16:00=60分');
  assert.equal(blocks[1].from, '17:00');
  assert.equal(blocks[1].to, '17:25');
  assert.equal(blocks[1].minutes, 25, '17:25-17:00=25分');
});

test('コーチtwoCol日: both/男子/女子の items が集約され、ブロック種別とラベルが拾われる', () => {
  const blocks = dayBlocks(coachTwoColDay());
  // 先頭=both 行: both.block/label を採用、items は both のもの。
  assert.equal(blocks[0].block, 'ラン');
  assert.equal(blocks[0].label, 'ラントレ');
  assert.deepEqual(blocks[0].items.map((it) => it.name), ['走り込み・アジリティ']);
  assert.ok(blocks[0].items.every((it) => it.mode === 'self'), '各itemは mode:self に集約');
  // 2行目=男女別: both無し→boys.block を採用、items は boys+girls 集約。
  assert.equal(blocks[1].block, '対人', 'both無しは boys.block を拾う');
  assert.deepEqual(blocks[1].items.map((it) => it.name), ['アップ（ゲーム準備）', 'カールからゴール下']);
});

test('コーチtwoCol日: from/to が空の行は除外される（0:00潰れ防止）', () => {
  const blocks = dayBlocks(coachTwoColDay());
  const names = blocks.flatMap((b) => b.items.map((it) => it.name));
  assert.ok(!names.includes('5on5'), '時刻空の行（5on5）はブロック化されない');
});

test('コーチtwoCol日: 全行の時刻が空なら null（週グリッドに出さない）', () => {
  const d = { day: '火', source: 'coach', twoCol: true, rows: [{ from: '', to: '', both: { block: '対人', label: 'x', items: [{ name: 'a' }] }, boys: null, girls: null }] };
  assert.equal(dayBlocks(d), null, '時刻のある行が無ければ null');
});

test('旧スキーマのコーチ日: from/to を持つ items 非空 blocks をそのまま返し、items空は除外', () => {
  const blocks = dayBlocks(coachLegacyDay());
  assert.ok(Array.isArray(blocks));
  assert.equal(blocks.length, 1, 'items空の対人ブロックは除外され、シュート1件');
  assert.equal(blocks[0].label, 'シュート');
});

test('非coach日: items 非空の blocks を返す（従来挙動・items空は除外）', () => {
  const blocks = dayBlocks(autoDay());
  assert.equal(blocks.length, 1, 'items空の対人は除外され、シュート1件');
  assert.equal(blocks[0].block, 'シュート');
});

test('buildWeekAxis: コーチ上書き日の合成ブロックを軸に取り込む（空欄にしない）', () => {
  // コーチtwoCol日だけの週でも軸が立つ（present が空でない＝週グリッドに描ける）。
  const axis = buildWeekAxis([coachTwoColDay()]);
  assert.ok(axis, 'コーチ上書き日だけでも軸が null にならない');
  assert.ok(axis.axisEnd > axis.axisStart, '稼働帯から軸範囲が出る');
});

test('コーチtwoCol日: 終了<開始（打ち間違い）の行は除外（負の高さ・軸破壊を防ぐ）', () => {
  const d = { day: '火', source: 'coach', twoCol: true, rows: [
    { from: '17:00', to: '16:00', both: { block: '対人', label: 'x', items: [{ name: 'a' }] }, boys: null, girls: null },
    { from: '16:00', to: '17:00', both: { block: 'ラン', label: 'y', items: [{ name: 'b' }] }, boys: null, girls: null },
  ] };
  const blocks = dayBlocks(d);
  assert.equal(blocks.length, 1, '逆転行は除外され、正順の1行だけ残る');
  assert.equal(blocks[0].to, '17:00');
  assert.ok(blocks.every((b) => b.minutes > 0), '負・0分のブロックは出さない');
});

test('コーチtwoCol日: HH:MM 不正な時刻の行は除外（25:00 / 非数）', () => {
  const d = { day: '火', source: 'coach', twoCol: true, rows: [
    { from: '25:00', to: '26:00', both: { block: '対人', label: 'x', items: [{ name: 'a' }] }, boys: null, girls: null },
    { from: 'ab', to: 'cd', both: { block: '対人', label: 'x', items: [{ name: 'a' }] }, boys: null, girls: null },
  ] };
  assert.equal(dayBlocks(d), null, '不正時刻のみなら null');
});

test('コーチtwoCol日: 時刻はあるが中身ゼロの行は除外（旧スキーマ経路＝items非空要求と対称）', () => {
  const d = { day: '火', source: 'coach', twoCol: true, rows: [
    { from: '16:00', to: '17:00', both: null, boys: { block: '対人', label: '', items: [] }, girls: null },
  ] };
  assert.equal(dayBlocks(d), null, 'items空のみなら null');
});
