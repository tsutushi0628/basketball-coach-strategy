/**
 * @file 学校名変更API（POST /api/tenant/name）・目標編集API（POST /api/tenant/goal）の業務意図テスト。
 *
 * 検証する業務意図:
 *   学校名（/api/tenant/name・isAdmin ゲート）:
 *     - 認可: 管理者でない（isAdmin !== true）→ 403。
 *     - 入力検証: 空・61文字 → 400（空表示・壊れデータを作らせない）。
 *     - 正当: 管理者＋1〜60文字 → tenants/{ctx.tenantId} 配下へ {name} を merge 書き込み。
 *   目標（/api/tenant/goal・owner ゲート）:
 *     - 認可: owner でない → 403。
 *     - 入力検証: scope 外 / week×不正key / month×"13" / 201文字 → 400。
 *     - 正当(週): tenants/{tid}/goalOverrides/current の weeks マップへ merge 書き込み。
 *     - 正当(月): 同 arcMonths マップへ merge 書き込み。
 *     - 削除: 空 text → 該当キーを FieldValue.delete() で merge（叩き台へ戻す）。
 *   越境担保: 書き込み先は必ず解決済み tenantId（/api/override と同じくパスで担保）。
 *
 * 認可と検証の純ロジックは nameWriteDecision / goalWriteDecision を直接テストし、書き込み先と merge は
 * mountWriteApi をモック db でマウントして実HTTPで叩いて確認する（tenant-theme-api.test.mjs の作法を流用）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

// テナント解決の無認証フォールバック（ALLOW_UNAUTH）を有効化＝local-dev コンテキスト（isAdmin:true・role:owner）で解決させる。
// import より前に設定する（index.mjs が module-load 時に IS_EMULATOR を確定するため）。
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.LOCAL_DEFAULT_TENANT = 'tenant-local';

const express = (await import('express')).default;
const { mountWriteApi, nameWriteDecision, goalWriteDecision } = await import('./index.mjs');

// ── 純判定: nameWriteDecision ─────────────────────────────────────────────────
test('nameWriteDecision: 非管理者は 403', () => {
  const d = nameWriteDecision({ isAdmin: false, tenantId: 'tenant-a' }, { name: '中野中' });
  assert.equal(d.ok, false);
  assert.equal(d.status, 403);
});

test('nameWriteDecision: isAdmin 未設定（undefined）も 403', () => {
  assert.equal(nameWriteDecision({ tenantId: 'tenant-a' }, { name: '中野中' }).status, 403);
  assert.equal(nameWriteDecision(null, { name: '中野中' }).status, 403);
});

test('nameWriteDecision: 空名は 400（空表示を作らせない）', () => {
  assert.equal(nameWriteDecision({ isAdmin: true }, { name: '' }).status, 400);
  assert.equal(nameWriteDecision({ isAdmin: true }, { name: '   ' }).status, 400, '空白だけも空名扱い');
  assert.equal(nameWriteDecision({ isAdmin: true }, {}).status, 400);
});

test('nameWriteDecision: 61文字は 400（上限超）', () => {
  const d = nameWriteDecision({ isAdmin: true }, { name: 'あ'.repeat(61) });
  assert.equal(d.ok, false);
  assert.equal(d.status, 400);
});

test('nameWriteDecision: 管理者＋1〜60文字は ok（前後空白は trim）', () => {
  const d = nameWriteDecision({ isAdmin: true, tenantId: 'tenant-a' }, { name: '  港北中  ' });
  assert.equal(d.ok, true);
  assert.equal(d.name, '港北中', 'trim 済みの名前を返す');
  assert.equal(nameWriteDecision({ isAdmin: true }, { name: 'あ'.repeat(60) }).ok, true, '60文字ちょうどは ok');
});

// ── 純判定: goalWriteDecision ─────────────────────────────────────────────────
test('goalWriteDecision: 非 owner は 403', () => {
  const d = goalWriteDecision({ role: 'member' }, { scope: 'week', key: '2026-06-23', text: 'x' });
  assert.equal(d.ok, false);
  assert.equal(d.status, 403);
  assert.equal(goalWriteDecision(null, { scope: 'week', key: '2026-06-23', text: 'x' }).status, 403);
});

test('goalWriteDecision: scope 外は 400', () => {
  const d = goalWriteDecision({ role: 'owner' }, { scope: 'year', key: '1', text: 'x' });
  assert.equal(d.ok, false);
  assert.equal(d.status, 400);
  assert.equal(goalWriteDecision({ role: 'owner' }, { key: '1', text: 'x' }).status, 400, 'scope 欠落も 400');
});

test('goalWriteDecision: week×不正 key は 400', () => {
  assert.equal(goalWriteDecision({ role: 'owner' }, { scope: 'week', key: '2026-6-3', text: 'x' }).status, 400);
  assert.equal(goalWriteDecision({ role: 'owner' }, { scope: 'week', key: '6', text: 'x' }).status, 400);
  assert.equal(goalWriteDecision({ role: 'owner' }, { scope: 'week', key: '', text: 'x' }).status, 400);
});

test('goalWriteDecision: month×"13" は 400／"0" も 400', () => {
  assert.equal(goalWriteDecision({ role: 'owner' }, { scope: 'month', key: '13', text: 'x' }).status, 400);
  assert.equal(goalWriteDecision({ role: 'owner' }, { scope: 'month', key: '0', text: 'x' }).status, 400);
  assert.equal(goalWriteDecision({ role: 'owner' }, { scope: 'month', key: '2026-06-23', text: 'x' }).status, 400);
});

test('goalWriteDecision: 201文字は 400（上限超）', () => {
  const d = goalWriteDecision({ role: 'owner' }, { scope: 'week', key: '2026-06-23', text: 'あ'.repeat(201) });
  assert.equal(d.ok, false);
  assert.equal(d.status, 400);
});

test('goalWriteDecision: 正常 week は ok（key=YYYY-MM-DD）', () => {
  const d = goalWriteDecision({ role: 'owner' }, { scope: 'week', key: '2026-06-23', text: '  走り込み  ' });
  assert.equal(d.ok, true);
  assert.equal(d.scope, 'week');
  assert.equal(d.key, '2026-06-23');
  assert.equal(d.text, '走り込み', 'text は trim 済み');
});

test('goalWriteDecision: 正常 month は ok（key="1".."12"・空 text 許可）', () => {
  assert.equal(goalWriteDecision({ role: 'owner' }, { scope: 'month', key: '1', text: 'x' }).ok, true);
  assert.equal(goalWriteDecision({ role: 'owner' }, { scope: 'month', key: '12', text: 'x' }).ok, true);
  const empty = goalWriteDecision({ role: 'owner' }, { scope: 'month', key: '4', text: '' });
  assert.equal(empty.ok, true, '空 text は許可（該当キー削除の意図）');
  assert.equal(empty.text, '');
});

// ── 実HTTP（mountWriteApi）: 書き込み先と merge の確認 ──────────────────────────────
/** tenants/{tid}.set / tenants/{tid}/goalOverrides/current.set の呼び出しを記録するモック db。 */
function makeMockDb() {
  const writes = [];
  const tenantDoc = (tenantId) => ({
    async set(data, opts) {
      writes.push({ path: `tenants/${tenantId}`, data, opts });
    },
    collection(sub) {
      assert.equal(sub, 'goalOverrides', 'goal 保存は goalOverrides サブコレクションだけに触れる');
      return {
        doc(docId) {
          return {
            async set(data, opts) {
              writes.push({ path: `tenants/${tenantId}/goalOverrides/${docId}`, data, opts });
            },
          };
        },
      };
    },
  });
  return {
    writes,
    collection(name) {
      assert.equal(name, 'tenants', 'name/goal 保存は tenants コレクションだけに触れる');
      return { doc: tenantDoc };
    },
    async runTransaction() { throw new Error('not used'); },
  };
}

async function startApp(db) {
  const app = express();
  mountWriteApi(app, db);
  const server = createServer(app);
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const { port } = server.address();
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) };
}

function postJson(base, path, body) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('POST /api/tenant/name: 正当な名前は tenants/{ctx.tenantId} 配下へ merge 書き込みする', async () => {
  const db = makeMockDb();
  const app = await startApp(db);
  try {
    const res = await postJson(app.base, '/api/tenant/name', { name: '港北中' });
    const j = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(j, { ok: true, name: '港北中' });
    assert.equal(db.writes.length, 1);
    assert.equal(db.writes[0].path, 'tenants/tenant-local', '解決済み tenantId 配下へ書く（越境しない）');
    assert.deepEqual(db.writes[0].data, { name: '港北中' }, 'name だけを書く');
    assert.deepEqual(db.writes[0].opts, { merge: true }, 'merge で書く（既存フィールドを壊さない）');
  } finally {
    await app.close();
  }
});

test('POST /api/tenant/name: 空名は 400 で db へ一切書かない', async () => {
  const db = makeMockDb();
  const app = await startApp(db);
  try {
    const res = await postJson(app.base, '/api/tenant/name', { name: '   ' });
    assert.equal(res.status, 400);
    assert.equal(db.writes.length, 0, '不正名は書き込まない');
  } finally {
    await app.close();
  }
});

test('POST /api/tenant/goal: 週の目標は goalOverrides/current の weeks マップへ merge 書き込みする', async () => {
  const db = makeMockDb();
  const app = await startApp(db);
  try {
    const res = await postJson(app.base, '/api/tenant/goal', { scope: 'week', key: '2026-06-23', text: '走り込み' });
    const j = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(j, { ok: true, scope: 'week', key: '2026-06-23', text: '走り込み' });
    assert.equal(db.writes.length, 1);
    assert.equal(db.writes[0].path, 'tenants/tenant-local/goalOverrides/current', '解決済み tenantId 配下へ書く');
    assert.deepEqual(db.writes[0].data, { weeks: { '2026-06-23': '走り込み' } }, 'weeks マップの該当キーへ書く');
    assert.deepEqual(db.writes[0].opts, { merge: true }, 'merge で書く（他の週を壊さない）');
  } finally {
    await app.close();
  }
});

test('POST /api/tenant/goal: 月の目標は arcMonths マップへ merge 書き込みする', async () => {
  const db = makeMockDb();
  const app = await startApp(db);
  try {
    const res = await postJson(app.base, '/api/tenant/goal', { scope: 'month', key: '7', text: '基礎固め' });
    const j = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(j, { ok: true, scope: 'month', key: '7', text: '基礎固め' });
    assert.equal(db.writes.length, 1);
    assert.deepEqual(db.writes[0].data, { arcMonths: { '7': '基礎固め' } }, 'arcMonths マップの該当キーへ書く');
  } finally {
    await app.close();
  }
});

test('POST /api/tenant/goal: 空 text は該当キーを削除する（merge＋FieldValue.delete）', async () => {
  const db = makeMockDb();
  const app = await startApp(db);
  try {
    const res = await postJson(app.base, '/api/tenant/goal', { scope: 'week', key: '2026-06-23', text: '' });
    const j = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(j, { ok: true, scope: 'week', key: '2026-06-23', text: '' });
    assert.equal(db.writes.length, 1);
    assert.deepEqual(db.writes[0].opts, { merge: true });
    // 書き込みデータは weeks.<key> に削除センチネルを含む（merge なので他キーは残る）。
    const written = db.writes[0].data;
    assert.ok(written.weeks && Object.prototype.hasOwnProperty.call(written.weeks, '2026-06-23'),
      '該当キーを含む（削除センチネルを set）');
  } finally {
    await app.close();
  }
});

test('POST /api/tenant/goal: scope 外は 400 で db へ一切書かない', async () => {
  const db = makeMockDb();
  const app = await startApp(db);
  try {
    const res = await postJson(app.base, '/api/tenant/goal', { scope: 'year', key: '1', text: 'x' });
    assert.equal(res.status, 400);
    assert.equal(db.writes.length, 0, '不正 scope は書き込まない');
  } finally {
    await app.close();
  }
});
