/**
 * @file 行の明示フラグ row.split===true が isTogetherRow の判定を上書きする、という業務意図の
 * 退行テスト（不具合4）。
 *
 * 背景の事故（原因確定済み）: 行を「共通ON→入力→共通OFF」で男女別にすると editor.mjs:1006-1008
 * splitFromBoth が両側へ同一内容を複製する。two-col-together.mjs:32-36 isTogetherRow は
 * row.both が無ければ「男女の内容が一致するか」だけで共通行と判定するため、複製された同一内容の
 * 行が誤って1本（共通行）に畳まれる。
 *
 * 対応後に固定する業務意図:
 *   - split:true を明示された行は、男女セルの内容が一致していても isTogetherRow=false（畳まない）。
 *   - split フラグが無い行（旧データ）は、従来どおり内容一致で isTogetherRow=true（後方互換・非回帰）。
 *   - row.both を持つ行は split フラグの有無に関わらず isTogetherRow=true（both が最優先）。
 *
 * 対応前の現状（本ファイル作成時点で実走確認済み）: split:true かつ男女同一内容のケースが
 * isTogetherRow=true になり（フラグを見ていないため）期待の false と食い違って失敗する。
 *
 * テスト基盤: node --test（純関数・ブラウザ不要）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isTogetherRow } from './two-col-together.mjs';

const cell = (name) => ({ block: 'ファンダ', label: name + '見出し', items: [{ name }] });

test('split:true かつ男女同一内容 → isTogetherRow は false（畳まない）', () => {
  // 原因行由来の失敗確認ポイント: two-col-together.mjs:32-36 は row.split を見ていないため、
  // 男女内容が一致していれば split:true でも true を返す（現状は true になり失敗する）。
  const row = { split: true, 男子: cell('X'), 女子: cell('X') };
  assert.equal(isTogetherRow(row), false, 'split:true は男女同一内容でも共通行に畳ませない');
});

test('split フラグ無し（旧データ）かつ男女同一内容 → isTogetherRow は true（後方互換）', () => {
  const row = { 男子: cell('X'), 女子: cell('X') };
  assert.equal(isTogetherRow(row), true, 'フラグ無し旧データは従来どおり内容一致で共通行に畳む');
});

test('row.both を持つ行 → isTogetherRow は true（both が split フラグより優先）', () => {
  const row = { both: cell('Y') };
  assert.equal(isTogetherRow(row), true, 'both を持つ行は常に共通行');
});

test('split:true かつ both も持つ行 → both 優先で isTogetherRow は true', () => {
  const row = { split: true, both: cell('Y') };
  assert.equal(isTogetherRow(row), true, 'both がある行は split フラグに関わらず共通行（both 最優先）');
});

test('split:true かつ男女で内容が異なる行 → isTogetherRow は false（従来どおり）', () => {
  const row = { split: true, 男子: cell('A'), 女子: cell('B') };
  assert.equal(isTogetherRow(row), false, '内容が異なる行は split の有無に関わらず共通行にならない');
});
