/**
 * @file チームカラー・プリセット定義の業務意図テスト。
 *
 * 検証する業務意図（design §1.4 / §3.2 / §3.5）:
 *   - THEME_KEYS は16キーで、既定 orange を必ず含む（API 検証の許可集合）。
 *   - 全16プリセットがアクセント6変数を漏れなく定義する（描画の上書きが欠け変数で壊れない）。
 *   - themeOverrideCss: orange（既定）・未知キー・未設定 → 空文字（BASE_CSS の既定を使う＝上書き不要）。
 *   - themeOverrideCss: 既知の非orangeキー → :root にアクセント6変数だけを出す。
 *     ニュートラル（--bg/--ink/--surface 等）・曜日色（--sat/--sun）・ブロック種別色（--terra/--gold/--sage）は
 *     一切出さない（構造色は据え置く設計）。
 *   - PRESET_SWATCHES は16件で、各件の主色/第2色が PRESET_THEMES と一致する（パネルとCSS変数の真実源一致）。
 *
 * テスト基盤: node --test。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PRESET_THEMES,
  THEME_KEYS,
  DEFAULT_THEME_KEY,
  PRESET_SWATCHES,
  themeOverrideCss,
} from './color-presets.mjs';

const ACCENT_VARS = ['--orange', '--orange-ink', '--orange-soft', '--orange-deep', '--boys', '--girls'];
// 上書きで絶対に出してはいけない構造色（据え置き対象）。
const STRUCTURAL_VARS = ['--bg', '--surface', '--ink', '--mute', '--terra', '--gold', '--sage', '--sat', '--sun', '--line', '--hair'];

test('THEME_KEYS は16キーで orange を含む', () => {
  assert.equal(THEME_KEYS.length, 16);
  assert.ok(THEME_KEYS.includes('orange'), 'orange は既定として集合に含まれる');
  assert.equal(DEFAULT_THEME_KEY, 'orange');
  assert.equal(new Set(THEME_KEYS).size, 16, 'キーに重複がない');
});

test('全16プリセットがアクセント6変数を漏れなく定義する', () => {
  for (const key of THEME_KEYS) {
    const theme = PRESET_THEMES[key];
    assert.ok(theme, `${key} のプリセットが存在する`);
    for (const v of ACCENT_VARS) {
      assert.match(theme[v], /^#[0-9a-f]{6}$/i, `${key}.${v} は6桁hex`);
    }
    assert.equal(Object.keys(theme).length, 6, `${key} はアクセント6変数だけを持つ（構造色を持たない）`);
  }
});

test('themeOverrideCss: 既定orange は空文字（BASE_CSS の既定を使う）', () => {
  assert.equal(themeOverrideCss('orange'), '');
});

test('themeOverrideCss: 未知キー・未設定は空文字（既定オレンジに解決＝生エラーにしない）', () => {
  assert.equal(themeOverrideCss('rainbow'), '');
  assert.equal(themeOverrideCss(''), '');
  assert.equal(themeOverrideCss(undefined), '');
  assert.equal(themeOverrideCss(null), '');
});

test('themeOverrideCss: プロトタイプ継承プロパティ名は空文字（壊れCSSを出さない・自己防御）', () => {
  // PRESET_THEMES[key] の truthy 判定だけだと '__proto__'/'constructor' で Object.prototype を拾い
  // `:root{--orange:undefined…}` の壊れCSSを返す。許可集合(THEME_KEYS)の所属判定で継承を弾く。
  for (const key of ['__proto__', 'constructor', 'prototype', 'hasOwnProperty', 'toString']) {
    assert.equal(themeOverrideCss(key), '', `${key} は :root を出さない（既定オレンジに解決）`);
  }
});

test('themeOverrideCss: 既知の非orangeキーは :root にアクセント6変数だけを出す', () => {
  const css = themeOverrideCss('blue');
  assert.ok(css.startsWith(':root{') && css.endsWith('}'), ':root ブロックで出力する');
  for (const v of ACCENT_VARS) {
    assert.ok(css.includes(`${v}:${PRESET_THEMES.blue[v]}`), `${v} を blue の値で出力する`);
  }
  // 構造色（ニュートラル・曜日・ブロック種別）は一切出さない。
  for (const v of STRUCTURAL_VARS) {
    assert.ok(!css.includes(`${v}:`), `${v} は出力しない（構造色は据え置く）`);
  }
  // 宣言は厳密に6個（セミコロン区切り）。
  const decls = css.slice(':root{'.length, -1).split(';');
  assert.equal(decls.length, 6, 'アクセント6変数ちょうど');
});

test('themeOverrideCss: 明色テーマは暗インクを出す（インク反転が CSS に反映される）', () => {
  // sky は --orange-ink が暗インク（design §1.2）。上書きCSSにその暗インクが乗ることを確認。
  const css = themeOverrideCss('sky');
  assert.ok(css.includes('--orange-ink:#123040'), 'sky は暗インク #123040 を出す');
});

test('PRESET_SWATCHES は16件で、主色/第2色が PRESET_THEMES と一致する', () => {
  assert.equal(PRESET_SWATCHES.length, 16);
  for (const s of PRESET_SWATCHES) {
    assert.ok(THEME_KEYS.includes(s.key), `${s.key} は許可集合内`);
    assert.ok(typeof s.label === 'string' && s.label.length > 0, `${s.key} に表示名がある`);
    assert.equal(s.main, PRESET_THEMES[s.key]['--orange'], `${s.key} の主色がプリセットと一致`);
    assert.equal(s.second, PRESET_THEMES[s.key]['--girls'], `${s.key} の第2色（girls）がプリセットと一致`);
  }
  // スウォッチ並びは THEME_KEYS と同順（パネル表示とAPI集合のズレを消す）。
  assert.deepEqual(PRESET_SWATCHES.map((s) => s.key), THEME_KEYS);
});
