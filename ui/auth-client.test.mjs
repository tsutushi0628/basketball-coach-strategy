/**
 * @file テーマ保存失敗時の挙動の業務意図テスト（auth-client）。
 *
 * 検証する業務意図（code-review 指摘 1・2 対応）:
 *   - 失敗文言の出し分け（themeSaveErrorText）:
 *       サーバ error 文言あり→それ／401→再ログイン促し／403→権限喪失／他→汎用。
 *       いずれも「色は元のまま」を明示（楽観適用しない＝失敗時に色が暴れない）。
 *   - 生成クライアントの配線（ドリフト防止・実害無しの構造検査）:
 *       失敗経路で markSelected(current) を呼びチェック/太縁を実テーマへ戻す（巻き戻し）。
 *       文言はテスト済み themeSaveErrorText を埋め込んで使う（node の規則と実行時を一致）。
 *
 * テスト基盤: node --test。クライアント IIFE はブラウザ専用なので、ここでは出し分け純関数を直接
 * テストし、巻き戻し配線は生成HTML文字列の構造で担保する（jsdom を新規依存に足さない方針）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { authClientHtml, themeSaveErrorText } from './auth-client.mjs';

const cfg = { apiKey: 'k', authDomain: 'd', projectId: 'p' };

test('themeSaveErrorText: サーバ error 文言があれば最優先で使う', () => {
  assert.equal(themeSaveErrorText(400, 'themeKey が不正です'), 'themeKey が不正です');
  // status が 401/403 でもサーバ文言が勝つ（出し分けの真実源をサーバへ寄せる）。
  assert.equal(themeSaveErrorText(403, '設定の変更権限がありません'), '設定の変更権限がありません');
});

test('themeSaveErrorText: 401 は再ログインを促す', () => {
  const t = themeSaveErrorText(401);
  assert.match(t, /サインイン/);
  assert.match(t, /色は元のまま/, '色が元のままであることを明示');
});

test('themeSaveErrorText: 403 は権限喪失を伝える', () => {
  const t = themeSaveErrorText(403);
  assert.match(t, /権限/);
  assert.match(t, /色は元のまま/);
});

test('themeSaveErrorText: status 不明・その他は汎用文言（色は元のまま）', () => {
  assert.match(themeSaveErrorText(), /保存できませんでした/);
  assert.match(themeSaveErrorText(500), /保存できませんでした/);
  assert.match(themeSaveErrorText(undefined), /色は元のまま/);
  // 401/403/汎用は互いに異なる文言（全部汎用に畳んでいない＝指摘2の回帰防止）。
  assert.notEqual(themeSaveErrorText(401), themeSaveErrorText());
  assert.notEqual(themeSaveErrorText(403), themeSaveErrorText());
  assert.notEqual(themeSaveErrorText(401), themeSaveErrorText(403));
});

test('生成クライアント: 失敗経路でチェックを実テーマ（current）へ巻き戻す配線がある', () => {
  const html = authClientHtml(cfg, { isAdmin: true, themeKey: 'blue' });
  // 失敗の共通後処理 showError が markSelected(current) を呼ぶ（指摘1の巻き戻し）。
  assert.match(html, /function showError\(key,status,serverError\)\{[\s\S]*markSelected\(current\)/);
  // ネットワーク断（status 不明）も showError へ流す。
  assert.match(html, /\.catch\(function\(\)\{ showError\(key\); \}\)/);
  // res.ok でない分岐は status とサーバ error を showError へ渡して出し分ける。
  assert.match(html, /showError\(key,status,res&&res\.error\)/);
});

test('生成クライアント: 失敗文言はテスト済み themeSaveErrorText を埋め込んで使う（ドリフト防止）', () => {
  const html = authClientHtml(cfg, { isAdmin: true, themeKey: 'blue' });
  // 埋め込み本体に出し分けの3文言が含まれる（node テストの規則と実行時が一致）。
  assert.match(html, /var errorText=function/);
  assert.ok(html.includes('サインインし直してください'), '401 文言が埋め込まれている');
  assert.ok(html.includes('変更する権限がありません'), '403 文言が埋め込まれている');
  assert.ok(html.includes('保存できませんでした。色は元のままです。'), '汎用文言が埋め込まれている');
});
