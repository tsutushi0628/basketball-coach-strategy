/**
 * @file セッション Cookie ユーティリティの業務意図テスト。
 *
 * 検証する業務意図（getAuth に依存しない決定論部分）:
 *   - Cookie 属性: 発行 Cookie は HttpOnly / Secure / SameSite=Lax / Path=/ を必ず備える
 *     （HttpOnly でJS窃取を防ぎ、SameSite=Lax でクロスサイト POST に乗らず CSRF を緩和・design §8）。
 *   - TTL: Max-Age が約1日（共有端末の取り違え対策・design §7-b）。
 *   - クリア: ログアウト Cookie は Max-Age=0（即時失効）。
 *   - parseCookies: 複数 Cookie を分解し __session を取り出せる・URL エンコード値を復号する。
 *   - 短絡: セッション Cookie が無いリクエストは getAuth を呼ばず null を返す（未ログイン判定）。
 *
 * getAuth に依存する検証（実トークンの署名検証・失効確認）はエミュレータ E2E（別担当）で担保する。
 *
 * テスト基盤: node --test。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SESSION_COOKIE_NAME,
  parseCookies,
  serializeCookie,
  clearSession,
  verifySession,
} from './session-auth.mjs';

test('Cookie 属性: 発行 Cookie は HttpOnly/Secure/SameSite=Lax/Path=/ を備える', () => {
  const c = serializeCookie(SESSION_COOKIE_NAME, 'abc');
  assert.match(c, /^__session=abc/, '名前と値');
  assert.match(c, /HttpOnly/, 'HttpOnly（JS からの窃取を防ぐ）');
  assert.match(c, /Secure/, 'Secure（HTTPS のみ）');
  assert.match(c, /SameSite=Lax/, 'SameSite=Lax（クロスサイト POST に乗らず CSRF 緩和）');
  assert.match(c, /Path=\//, 'Path=/');
});

test('TTL: Max-Age が約1日（24h=86400s）', () => {
  const c = serializeCookie(SESSION_COOKIE_NAME, 'abc');
  const m = /Max-Age=(\d+)/.exec(c);
  assert.ok(m, 'Max-Age を持つ');
  assert.equal(Number(m[1]), 24 * 60 * 60, '約1日（共有端末の取り違え対策）');
});

test('クリア: ログアウト Cookie は Max-Age=0（即時失効）', () => {
  const c = clearSession();
  assert.match(c, /^__session=/, 'セッション Cookie を対象');
  assert.match(c, /Max-Age=0/, '即時失効');
});

test('parseCookies: 複数 Cookie を分解し __session を取り出す', () => {
  const cookies = parseCookies('foo=1; __session=tokenval; bar=2');
  assert.equal(cookies.__session, 'tokenval');
  assert.equal(cookies.foo, '1');
  assert.equal(cookies.bar, '2');
});

test('parseCookies: URL エンコード値を復号する（serializeCookie と対称）', () => {
  const c = serializeCookie('__session', 'a+b/c=d');
  const value = c.split(';')[0].split('=').slice(1).join('=');
  const cookies = parseCookies(`__session=${value}`);
  assert.equal(cookies.__session, 'a+b/c=d', 'encode→parse で元値に戻る');
});

test('parseCookies: 空・null は空オブジェクト', () => {
  assert.deepEqual(parseCookies(''), {});
  assert.deepEqual(parseCookies(null), {});
  assert.deepEqual(parseCookies(undefined), {});
});

test('短絡: セッション Cookie が無いと getAuth を呼ばず null を返す', async () => {
  // Cookie に __session が無ければ verifySessionCookie へ進まず null（未ログイン）。
  // getAuth を呼ばないので firebase-admin 初期化なしでも安全に通る。
  assert.equal(await verifySession('foo=1; bar=2'), null);
  assert.equal(await verifySession(''), null);
  assert.equal(await verifySession(undefined), null);
});
