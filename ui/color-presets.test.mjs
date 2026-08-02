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
 * 意味ロール層（ui/styles/tokens.css）を守る検査3本（migration計画 §8.2、component-spec.md「アクセント塗りの意味」節）:
 *   - 形: ロール層の全宣言は var() 参照か、面を持たない役割の transparent のどちらかである（リテラル色値・宙ぶらりん参照・循環参照はゼロ）。
 *   - 追従性: 16プリセットでチームカラーに連動して動く意味ロールは、状態・確定・識別・焦点リングの4群だけで、
 *     破壊・中立操作・移動の3群は一切動かない（押せる部品の5役割のうち色で連動するのは状態と確定だけ、という設計の固定）。
 *   - 押せる文字は色でなく下線で示す: 文字だけの導線（--on-link）と押せない見出しラベル（--on-label-accent）は
 *     チームカラーに追従しない。押せることは常時下線が担うので色に仕事が残らない、という裁定
 *     （docs/specs/button-color-system-20260802-ruling-v5.md 3.4節）の固定。この2本がアクセントを引き直すと落ちる。
 *   - 面と前景の対: 押せる部品の面ロールが追従するなら、その面に乗る前景ロールも同じプリセット群で追従する
 *     （面だけ動いて文字色が既定に固定される＝特定配色で文字が読めなくなる故障を検出する）。
 *
 * 押せない状態の色（component-spec.md「押せない（全系統共通）」節）:
 *   - 押せないことは部品の種類ではなく状態が1つなので、色ロールは役割を問わず共通の3本
 *     （--action-disabled-fill / --action-disabled-line / --on-action-disabled）だけで、役割別の専用色を持たない。
 *   - この3本はどの16配色でも値が変わらない（押せない状態はチームカラーの明暗に一切依存しない）。
 *
 * テスト基盤: node --test。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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

const TOKENS_PATH = new URL('./styles/tokens.css', import.meta.url);
const ROLE_MARKER = '/* === 意味ロール層 ===';
// tokens.css の「面を持たない役割」コメントで明示されている、transparent を許す2ロール。
const TRANSPARENT_ROLE_VARS = new Set([
  '--action-move-fill',
  '--action-move-line',
]);
const EXPECTED_THEME_FOLLOWING_ROLES = [
  '--action-commit-fill',
  '--action-commit-line',
  '--focus-ring',
  '--on-action-commit',
  '--on-state-selected',
  '--state-selected-fill',
  '--state-selected-ring',
  '--team-boys-fill',
  '--team-girls-fill',
].sort();
// 押せる文字と押せない見出しラベルの色。押せることは常時下線が担うので、色はテーマに追従させない。
const TEXT_ROLES_THAT_MUST_NOT_FOLLOW = ['--on-link', '--on-label-accent'];
// 押せない状態の色は役割を問わず全系統共通のこの3本だけ（component-spec.md「押せない（全系統共通）」節）。
const DISABLED_ROLES = ['--action-disabled-fill', '--action-disabled-line', '--on-action-disabled'].sort();

function parseDeclarations(css) {
  return new Map([...css.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)].map(([, name, value]) => [name, value.trim()]));
}

function resolveVariable(name, declarations, trail = []) {
  if (trail.includes(name)) throw new Error(`循環参照: ${[...trail, name].join(' -> ')}`);
  const value = declarations.get(name);
  if (value === undefined) throw new Error(`宙ぶらりんの参照: ${[...trail, name].join(' -> ')}`);
  const reference = value.match(/^var\((--[\w-]+)\)$/);
  return reference ? resolveVariable(reference[1], declarations, [...trail, name]) : value;
}

function presetOverrides(themeKey) {
  return parseDeclarations(`${themeOverrideCss(themeKey).replace(/}$/, '')};`);
}

async function readTokenRoles() {
  const css = await readFile(TOKENS_PATH, 'utf8');
  const roleStart = css.indexOf(ROLE_MARKER);
  assert.notEqual(roleStart, -1, 'tokens.css に意味ロール層の開始コメントがある');
  return {
    css,
    primitives: parseDeclarations(css.slice(0, roleStart)),
    roles: parseDeclarations(css.slice(roleStart)),
  };
}

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

test('意味ロール層は参照だけで構成され、transparent は面を持たない役割だけに限る', async (t) => {
  const { primitives, roles } = await readTokenRoles();
  const values = [...roles.values()];

  await t.test('リテラル色値を含まない', () => {
    assert.equal(values.filter((value) => /#(?:[\da-f]{3,8})\b|\b(?:rgb|hsl|oklch)\s*\(/i.test(value)).length, 0);
  });
  await t.test('宙ぶらりんの参照がない', () => {
    const allDeclarations = new Map([...primitives, ...roles]);
    const dangling = [];
    for (const name of roles.keys()) {
      try { resolveVariable(name, allDeclarations); } catch (error) {
        if (error.message.startsWith('宙ぶらりん')) dangling.push(error.message);
      }
    }
    assert.deepEqual(dangling, []);
  });
  await t.test('transparent は面を持たない役割だけに使う', () => {
    assert.deepEqual([...roles].filter(([, value]) => value === 'transparent').map(([name]) => name).sort(), [...TRANSPARENT_ROLE_VARS].sort());
  });
  await t.test('循環参照がない', () => {
    const allDeclarations = new Map([...primitives, ...roles]);
    const cycles = [];
    for (const name of roles.keys()) {
      try { resolveVariable(name, allDeclarations); } catch (error) {
        if (error.message.startsWith('循環参照')) cycles.push(error.message);
      }
    }
    assert.deepEqual(cycles, []);
  });
  await t.test('各ロールは var() 参照または許可された transparent である', () => {
    for (const [name, value] of roles) {
      assert.ok(/^var\(--[\w-]+\)$/.test(value) || TRANSPARENT_ROLE_VARS.has(name) && value === 'transparent', `${name} は参照または許可された transparent`);
    }
  });
});

test('16プリセットで追従する意味ロールは状態・確定・識別・焦点リングだけ', async () => {
  const { primitives, roles } = await readTokenRoles();
  const defaults = new Map([...primitives, ...roles]);
  const baseline = new Map([...roles.keys()].map((name) => [name, resolveVariable(name, defaults)]));
  const followedByAnyPreset = new Set();

  for (const key of THEME_KEYS) {
    const declarations = new Map([...defaults, ...presetOverrides(key)]);
    const changed = [...roles.keys()].filter((name) => resolveVariable(name, declarations) !== baseline.get(name)).sort();
    assert.deepEqual(changed, key === DEFAULT_THEME_KEY ? [] : EXPECTED_THEME_FOLLOWING_ROLES, `${key} の追従ロール集合`);
    changed.forEach((name) => followedByAnyPreset.add(name));
  }

  const groups = {
    状態: /^--state-|^--on-state-/,
    '確定': /^--action-commit-|^--on-action-commit$/,
    識別: /^--team-|^--on-team-label$/,
    焦点リング: /^--focus-ring$/,
  };
  for (const [group, pattern] of Object.entries(groups)) {
    assert.ok([...followedByAnyPreset].some((name) => pattern.test(name)), `${group} のロールが少なくとも1つ追従する`);
  }
});

test('押せる文字の色はチームカラーに追従しない（押せることは色でなく常時下線が示す）', async () => {
  // 裁定 3.4節: 押せる文字からアクセントを落とし、押せることは常時下線に一本化した。
  // 色に仕事が残っていない以上、配色を変えても押せる文字の色は動いてはいけない。
  // この2本をアクセント（--orange 系）へ引き直すと、下線と色の二重の手掛かりが復活して落ちる。
  const { primitives, roles } = await readTokenRoles();
  const defaults = new Map([...primitives, ...roles]);

  for (const name of TEXT_ROLES_THAT_MUST_NOT_FOLLOW) {
    assert.ok(roles.has(name), `${name} がロール層に存在する`);
    const moved = THEME_KEYS.filter((key) => {
      const declarations = new Map([...defaults, ...presetOverrides(key)]);
      return resolveVariable(name, declarations) !== resolveVariable(name, defaults);
    });
    assert.deepEqual(moved, [], `${name} はチームカラーのどのプリセットでも値が変わらない`);
  }
});

// 文字だけの導線を出す5セレクタ（裁定 3.4節「常時下線を実際に付ける」の表）。
// 押せる文字からアクセントを落としたので、常時下線がこの5つの押せることを示す唯一の手掛かりになる。
const UNDERLINE_SELECTORS = [
  ['styles/base.css', '.drill-trig'],
  ['styles/base.css', '.vid'],
  ['styles/pattern-timeline.css', '.drill-anchor'],
  ['styles/pattern-timeline.css', '.drill-close'],
  ['styles/pattern-timeline.css', '.dp-link'],
];

test('文字だけの導線は常時下線を持つ（押せることを示す唯一の手掛かり）', {
  skip:
    '対象の5セレクタは、いずれも部品CSSのロール参照への付け替え（裁定 4.7節）と同じフェーズで下線を付ける。'
    + 'いまは text-decoration:none のままなので、この検査を動かすと落ちる。'
    + '色を落としたあとに下線まで外れると押せることを示すものが1つも無くなるため、'
    + '歯止めとして先に置いておく。付け替えが済んだらこの skip を外して緑にする'
    + '（裁定 6章の実装フェーズの完了条件に項目として入れてある）。',
}, async () => {
  for (const [file, selector] of UNDERLINE_SELECTORS) {
    const css = await readFile(new URL(`./${file}`, import.meta.url), 'utf8');
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rule = css.match(new RegExp(`(?:^|[},])\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'));
    assert.ok(rule, `${file} に ${selector} の規則がある`);
    assert.match(rule[1], /text-decoration\s*:\s*underline/, `${selector} は常時下線を持つ`);
  }
});

test('押せる部品の面と前景は同じプリセット群で追従する', async () => {
  const { primitives, roles } = await readTokenRoles();
  const defaults = new Map([...primitives, ...roles]);
  const pairs = [
    ['--state-selected-fill', '--on-state-selected'],
    ['--state-idle-fill', '--on-state-idle'],
    ['--action-commit-fill', '--on-action-commit'],
    ['--action-disabled-fill', '--on-action-disabled'],
    ['--action-destructive-fill', '--on-action-destructive'],
    ['--action-neutral-fill', '--on-action-neutral'],
    ['--action-move-fill', '--on-action-move'],
  ];
  for (const [fill, foreground] of pairs) {
    const moved = (name) => THEME_KEYS.filter((key) => {
      const declarations = new Map([...defaults, ...presetOverrides(key)]);
      return resolveVariable(name, declarations) !== resolveVariable(name, defaults);
    });
    assert.deepEqual(moved(fill), moved(foreground), `${fill} と ${foreground} は同じプリセット群で追従する`);
  }
});

test('押せない状態の色は全系統共通の3本だけで、役割ごとに増えず、チームカラーにも追従しない', async (t) => {
  const { primitives, roles } = await readTokenRoles();
  const defaults = new Map([...primitives, ...roles]);

  await t.test('押せない用の色ロールは共通3本だけで、役割別の専用色が増えていない', () => {
    // 役割ごとに専用の押せない色（例: 中立操作だけの disabled 色）を新設すると、
    // 「押せないことは部品の種類ではなく状態が1つ」という裁定（component-spec.md）が崩れる。
    // 命名でなく実在するロール名を数えるので、将来 disabled 系のロールが増減しても自動的に検出できる。
    const disabledNamed = [...roles.keys()].filter((name) => name.includes('disabled')).sort();
    assert.deepEqual(disabledNamed, DISABLED_ROLES, '押せない状態の色ロールは全系統共通の3本のみ存在する');
  });

  await t.test('押せない用3本はどの16配色でも値が変わらない（全系統・全配色で同じ死に方をする）', () => {
    for (const name of DISABLED_ROLES) {
      const moved = THEME_KEYS.filter((key) => {
        const declarations = new Map([...defaults, ...presetOverrides(key)]);
        return resolveVariable(name, declarations) !== resolveVariable(name, defaults);
      });
      assert.deepEqual(moved, [], `${name} はチームカラーのどのプリセットでも値が変わらない`);
    }
  });
});
