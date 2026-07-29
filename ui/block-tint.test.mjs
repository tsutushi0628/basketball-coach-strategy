/**
 * @file 遠征日の追加枠（移動/その他）の色分けの業務意図テスト（render-shared.mjs BLOCK_TINT）。
 *
 * 検証する業務意図:
 *   - 移動・その他はどちらも固有の色トークンを持ち、フォールバック値（--mute。静的ブロックの色と
 *     同じ）に落ちていない（灰色フォールバックのまま放置しない）。
 *   - 移動と その他は互いに異なる色で、画面上で区別できる。
 *   - 割り当てた色は render-shared.mjs / editor.mjs が実際に参照する既存トークン（tokens.css）の
 *     どれかであり、独自hexの新規発行ではない。
 *
 * テスト基盤: node --test。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BLOCK_TINT } from './render-shared.mjs';

/** tokens.css で実際に定義されている既存トークン（新色相追加の禁止を機械検査する対照表）。 */
const KNOWN_TOKENS = new Set([
  '--bg', '--surface', '--ink', '--mute',
  '--orange', '--orange-ink', '--orange-soft', '--orange-deep', '--orange-wash',
  '--terra', '--terra-ink', '--gold', '--sage',
  '--boys', '--girls', '--girls-ink',
  '--line', '--line-2', '--hair', '--scrim',
  '--sat', '--sun', '--sat-soft', '--sun-soft', '--print-bg',
]);

/** BLOCK_TINT の値 'var(--xxx)' からトークン名 '--xxx' を取り出す。 */
function tokenNameOf(value) {
  const m = /^var\((--[a-z0-9-]+)\)$/.exec(value);
  assert.ok(m, `${value} は var(--token) 形式であるべき（インラインhexではない）`);
  return m[1];
}

test('移動・その他はどちらも固有の色トークンを持ち、静的ブロックのフォールバック(--mute)ではない', () => {
  assert.ok(BLOCK_TINT['移動'], '移動ブロックの色が定義されているべき');
  assert.ok(BLOCK_TINT['その他'], 'その他ブロックの色が定義されているべき');
  assert.notEqual(BLOCK_TINT['移動'], 'var(--mute)', '移動が灰色フォールバック(--mute)のまま放置されていない');
  assert.notEqual(BLOCK_TINT['その他'], 'var(--mute)', 'その他が灰色フォールバック(--mute)のまま放置されていない');
  // 静的ブロック自体の色（--mute）と衝突していない＝2枠が静的と見分けられない色になっていない。
  assert.notEqual(BLOCK_TINT['移動'], BLOCK_TINT['静的'], '移動が静的ブロックと同じ色になっていない');
  assert.notEqual(BLOCK_TINT['その他'], BLOCK_TINT['静的'], 'その他が静的ブロックと同じ色になっていない');
});

test('移動とその他は互いに異なる色（画面上で区別できる）', () => {
  assert.notEqual(BLOCK_TINT['移動'], BLOCK_TINT['その他'], '移動とその他が同じ色になっていない');
});

test('移動・その他の色は既存トークン（tokens.css）の参照のみで、新規hexを発行していない', () => {
  const idouToken = tokenNameOf(BLOCK_TINT['移動']);
  const sonotaToken = tokenNameOf(BLOCK_TINT['その他']);
  assert.ok(KNOWN_TOKENS.has(idouToken), `移動の色 ${idouToken} は既存トークンであるべき`);
  assert.ok(KNOWN_TOKENS.has(sonotaToken), `その他の色 ${sonotaToken} は既存トークンであるべき`);
});
