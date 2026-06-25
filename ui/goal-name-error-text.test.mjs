/**
 * @file 目標保存・学校名保存の失敗文言の出し分け（goalSaveErrorText / nameSaveErrorText）の業務意図テスト。
 *
 * themeSaveErrorText と同型の出し分け規則を検証する:
 *   - サーバ error 文言があれば最優先で使う（出し分けの真実源をサーバへ寄せる）。
 *   - 401 → 再ログイン促し／403 → 権限喪失／他（status不明含む）→ 汎用文言。
 *   - いずれも「元のまま」を明示する（楽観適用しない＝失敗時に値が消えない）。
 *   - 401/403/汎用は互いに異なる文言（全部汎用に畳んでいない＝回帰防止）。
 *
 * クライアント IIFE はこの純関数の本体を埋め込んで使う（node の規則と実行時を一致＝ドリフト防止）。
 * テスト基盤: node --test。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { goalSaveErrorText } from './goal-editor.mjs';
import { nameSaveErrorText, authClientHtml } from './auth-client.mjs';

// ── goalSaveErrorText ────────────────────────────────────────────────────────
test('goalSaveErrorText: サーバ error 文言があれば最優先', () => {
  assert.equal(goalSaveErrorText(400, 'key が不正です'), 'key が不正です');
  assert.equal(goalSaveErrorText(403, '編集権限がありません'), '編集権限がありません');
});

test('goalSaveErrorText: 401 は再ログイン促し・「目標は元のまま」を明示', () => {
  const t = goalSaveErrorText(401);
  assert.match(t, /サインイン/);
  assert.match(t, /目標は元のまま/);
});

test('goalSaveErrorText: 403 は権限喪失・他は汎用、互いに異なる文言', () => {
  assert.match(goalSaveErrorText(403), /権限/);
  assert.match(goalSaveErrorText(403), /目標は元のまま/);
  assert.match(goalSaveErrorText(), /保存できませんでした/);
  assert.match(goalSaveErrorText(500), /目標は元のまま/);
  assert.notEqual(goalSaveErrorText(401), goalSaveErrorText());
  assert.notEqual(goalSaveErrorText(403), goalSaveErrorText());
  assert.notEqual(goalSaveErrorText(401), goalSaveErrorText(403));
});

// ── nameSaveErrorText ────────────────────────────────────────────────────────
test('nameSaveErrorText: サーバ error 文言があれば最優先', () => {
  assert.equal(nameSaveErrorText(400, '学校名が不正です'), '学校名が不正です');
});

test('nameSaveErrorText: 401/403/汎用の出し分けと「名前は元のまま」明示', () => {
  assert.match(nameSaveErrorText(401), /サインイン/);
  assert.match(nameSaveErrorText(401), /名前は元のまま/);
  assert.match(nameSaveErrorText(403), /権限/);
  assert.match(nameSaveErrorText(), /保存できませんでした/);
  assert.match(nameSaveErrorText(undefined), /名前は元のまま/);
  assert.notEqual(nameSaveErrorText(401), nameSaveErrorText());
  assert.notEqual(nameSaveErrorText(403), nameSaveErrorText());
  assert.notEqual(nameSaveErrorText(401), nameSaveErrorText(403));
});

// ── 学校名フィールドの配線（生成HTMLの構造検査・jsdom非依存） ──────────────────────
const cfg = { apiKey: 'k', authDomain: 'd', projectId: 'p' };

/**
 * パネルHTMLは window.__edThemePanelHtml に JSON文字列として埋め込まれる（属性の " は \" にエスケープ）。
 * このヘルパで JSON部分を取り出して実HTMLへ復元し、レンダリングされた DOM 文字列として検査する。
 */
function panelMarkup(html) {
  const m = html.match(/window\.__edThemePanelHtml = (".*?");<\/script>/s);
  if (!m) return '';
  return JSON.parse(m[1]);
}

test('authClientHtml: 管理者パネルに学校名フィールド（初期値・保存先・文言埋め込み）が出る', () => {
  const html = authClientHtml(cfg, { isAdmin: true, themeKey: 'blue', schoolName: '港北中' });
  const panel = panelMarkup(html);
  assert.match(panel, /チーム設定/, 'パネル見出しは「チーム設定」');
  assert.match(panel, /id="ed-name-input"[^>]*value="港北中"/, '学校名 input に初期値が入る');
  assert.match(panel, /maxlength="60"/, 'maxlength 60');
  assert.match(panel, /id="ed-name-save"/, '保存ボタンがある');
  // 保存先（/api/tenant/name）と契約 body のフィールド名（name）。配線は IIFE（生 html 側）。
  assert.match(html, /fetch\(withTenantQ\('\/api\/tenant\/name'\)/, '保存先は /api/tenant/name');
  assert.match(html, /body:JSON\.stringify\(\{name:name\}\)/, 'body は { name } 契約どおり');
  // 失敗文言はテスト済み nameSaveErrorText を埋め込んで使う（ドリフト防止）。
  assert.match(html, /var nameErrorText=function/);
  assert.ok(html.includes('サインインし直してください。名前は元のままです。'), '401文言が埋め込まれている');
});

test('authClientHtml: schoolName 未指定でも空 value で壊れず出る', () => {
  const html = authClientHtml(cfg, { isAdmin: true });
  const panel = panelMarkup(html);
  assert.match(panel, /id="ed-name-input"[^>]*value=""/, 'schoolName 未指定は空 value');
});

test('authClientHtml: 非管理者には学校名フィールドを出さない（パネル自体が管理者限定）', () => {
  const html = authClientHtml(cfg, { isAdmin: false, schoolName: '港北中' });
  // 非管理者はパネル自体を描かない（__edThemePanelHtml は空文字）＝学校名フィールドの DOM が無い。
  assert.equal(panelMarkup(html), '', '非管理者はパネルHTMLが空');
});
