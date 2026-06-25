/**
 * @file コーチ上書き保存の時刻ガード（sanitizeOverride）の業務意図テスト。
 *
 * 検証する業務意図（push前レビュー指摘の根治・保存ゲート側の二重化）:
 *   - 終了<開始の打ち間違い時刻ペアは保存段階で弾く（週グリッド/タイムラインの負値・軸破壊を防ぐ）。
 *   - 終了=開始（0分・編集UIが未完成行で作りうる）は許容する（正当な保存を400にしない）。
 *   - HH:MM として不正な時刻は弾く。
 *   - 片方/両方が空の時刻（時間割なし行）は許容する。
 *
 * テスト基盤: node --test。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeOverride } from './index.mjs';

/** date/layout を固定し rows だけ差し替える上書きボディ。 */
const body = (rows) => ({ date: '2026-06-23', layout: 'two-col', rows });
const cell = { block: '対人', label: 'x', items: [{ name: 'a' }] };

test('正常な時刻ペア（終了>開始）は通り、from/to を保つ', () => {
  const ov = sanitizeOverride(body([{ from: '16:00', to: '17:00', 男子: cell }]));
  assert.equal(ov.rows[0].from, '16:00');
  assert.equal(ov.rows[0].to, '17:00');
});

test('終了<開始の打ち間違いは throw（保存段階で弾く）', () => {
  assert.throws(() => sanitizeOverride(body([{ from: '17:00', to: '16:00', 男子: cell }])), /time range invalid/);
});

test('終了=開始（0分）は許容（未完成行の保存を400にしない）', () => {
  const ov = sanitizeOverride(body([{ from: '16:00', to: '16:00', 男子: cell }]));
  assert.equal(ov.rows[0].to, '16:00');
});

test('HH:MM として不正な時刻は throw（25:00・非数）', () => {
  assert.throws(() => sanitizeOverride(body([{ from: '25:00', to: '26:00', 男子: cell }])), /time range invalid/);
  assert.throws(() => sanitizeOverride(body([{ from: 'ab', to: 'cd', 男子: cell }])), /time range invalid/);
});

test('片方/両方が空の時刻（時間割なし行）は許容', () => {
  const ov = sanitizeOverride(body([{ from: '', to: '', 男子: cell }]));
  assert.equal(ov.rows[0].from, '');
  assert.equal(ov.rows[0].to, '');
});
