/**
 * @file チームカラー保存API（POST /api/tenant/theme）の業務意図テスト。
 *
 * 検証する業務意図（design §3.3 / §3.5）:
 *   - 認可: 管理者でない（isAdmin !== true）→ 403（テナント設定は isAdmin ゲート）。
 *   - 入力検証: プリセット集合（THEME_KEYS）外の themeKey → 400（壊れデータを書かせない）。
 *   - 正当: 集合内 themeKey ＋ 管理者 → tenants/{ctx.tenantId} 配下へ {themeKey} を merge 書き込み。
 *   - 越境担保: 書き込み先は必ず解決済み tenantId（/api/override と同じくパスで担保）。
 *
 * 認可と集合判定の純ロジックは themeWriteDecision を直接テストし、書き込み先と merge は
 * mountWriteApi をモック db でマウントして実HTTPで叩いて確認する。
 *
 * テスト基盤: node --test。テナント解決は ALLOW_UNAUTH（FIRESTORE_EMULATOR_HOST 設定時）に乗せて
 * local-dev コンテキスト（isAdmin:true・固定tenantId）で正当系・集合外系を駆動する。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

// テナント解決の無認証フォールバック（ALLOW_UNAUTH）を有効化＝local-dev 管理者コンテキストで解決させる。
// import より前に設定する（index.mjs が module-load 時に IS_EMULATOR を確定するため）。
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.LOCAL_DEFAULT_TENANT = 'tenant-local';

const express = (await import('express')).default;
const { mountWriteApi, themeWriteDecision } = await import('./index.mjs');

// ── 純判定（themeWriteDecision）: 3分岐を plain object で ───────────────────────────
test('themeWriteDecision: 非管理者は 403', () => {
  const d = themeWriteDecision({ isAdmin: false, tenantId: 'tenant-a' }, { themeKey: 'blue' });
  assert.equal(d.ok, false);
  assert.equal(d.status, 403);
});

test('themeWriteDecision: isAdmin 未設定（undefined）も 403', () => {
  const d = themeWriteDecision({ tenantId: 'tenant-a' }, { themeKey: 'blue' });
  assert.equal(d.ok, false);
  assert.equal(d.status, 403);
});

test('themeWriteDecision: 集合外 themeKey は 400', () => {
  const d = themeWriteDecision({ isAdmin: true, tenantId: 'tenant-a' }, { themeKey: 'rainbow' });
  assert.equal(d.ok, false);
  assert.equal(d.status, 400);
});

test('themeWriteDecision: themeKey 非文字列も 400', () => {
  assert.equal(themeWriteDecision({ isAdmin: true }, { themeKey: 123 }).status, 400);
  assert.equal(themeWriteDecision({ isAdmin: true }, {}).status, 400);
  assert.equal(themeWriteDecision({ isAdmin: true }, null).status, 400);
});

test('themeWriteDecision: 管理者＋集合内 themeKey は ok', () => {
  const d = themeWriteDecision({ isAdmin: true, tenantId: 'tenant-a' }, { themeKey: 'navy' });
  assert.equal(d.ok, true);
  assert.equal(d.themeKey, 'navy');
});

// ── 実HTTP（mountWriteApi）: 書き込み先と merge の確認 ──────────────────────────────
/**
 * tenants/{tid}.set({themeKey},{merge}) の呼び出しを記録するモック db。
 * theme 保存以外（resolveRequestTenant の local 分岐）は db に触れないので tenants だけ用意する。
 */
function makeMockDb() {
  const writes = [];
  return {
    writes,
    collection(name) {
      assert.equal(name, 'tenants', 'theme 保存は tenants コレクションだけに触れる');
      return {
        doc(tenantId) {
          return {
            async set(data, opts) {
              writes.push({ tenantId, data, opts });
            },
          };
        },
      };
    },
    // resolveRequestTenant は ALLOW_UNAUTH 経路で db に触れないが、念のため runTransaction を持たせる。
    async runTransaction() { throw new Error('not used'); },
  };
}

/** mountWriteApi を載せた express を ephemeral ポートで起動し、base URL を返す。 */
async function startApp(db) {
  const app = express();
  mountWriteApi(app, db);
  const server = createServer(app);
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const { port } = server.address();
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) };
}

test('正当な themeKey は tenants/{ctx.tenantId} 配下へ merge 書き込みする', async () => {
  const db = makeMockDb();
  const app = await startApp(db);
  try {
    const res = await fetch(`${app.base}/api/tenant/theme`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ themeKey: 'blue' }),
    });
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(json, { ok: true, themeKey: 'blue' });
    assert.equal(db.writes.length, 1, '1回だけ書く');
    assert.equal(db.writes[0].tenantId, 'tenant-local', '解決済み tenantId 配下へ書く（越境しない）');
    assert.deepEqual(db.writes[0].data, { themeKey: 'blue' }, 'themeKey だけを書く');
    assert.deepEqual(db.writes[0].opts, { merge: true }, 'merge で書く（既存フィールドを壊さない）');
  } finally {
    await app.close();
  }
});

test('集合外 themeKey は 400 で、db へ一切書かない（壊れデータを作らせない）', async () => {
  const db = makeMockDb();
  const app = await startApp(db);
  try {
    const res = await fetch(`${app.base}/api/tenant/theme`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ themeKey: 'rainbow' }),
    });
    assert.equal(res.status, 400);
    assert.equal(db.writes.length, 0, '不正キーは書き込まない');
  } finally {
    await app.close();
  }
});
