/**
 * @file resolveTenantContext の業務意図テスト（テナントゲート＝memberships 照合）。
 *
 * 検証する業務意図:
 *   - 在籍0件 → 'none'（オンボーディングへ）。
 *   - 在籍1件 → 'ok'（そのテナントを採用・role/isAdmin/isSuperAdmin を解決）。
 *   - 在籍複数 ＋ ?t 一致 → 'ok'（指定テナントを採用）。
 *   - 在籍複数 ＋ ?t 不一致/未指定 → 'choose'（選択画面・在籍一覧を返す）。
 *   - 越境拒否: 在籍していないテナントを ?t で指定しても採用しない（クライアント値を信用しない）。
 *   - 退籍（leftAt あり）は在籍に数えない。
 *   - isSuperAdmin は users.isSuperAdmin から直交解決（membership とは別系統）。
 *
 * テスト基盤: node --test。Firestore は where(userId==)・doc(uid).get の最小モックで代替。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveTenantContext } from './tenant-resolve.mjs';

/**
 * memberships（where(userId==uid) で引く）と users（doc(uid).get）を返す最小モック db。
 * @param {Object} opts
 * @param {Array<Object>} opts.memberships  全 membership 行
 * @param {Object<string,Object>} [opts.users]  uid -> users doc
 */
function makeMockDb({ memberships = [], users = {} } = {}) {
  return {
    collection(name) {
      if (name === 'memberships') {
        return {
          where(field, _op, value) {
            return {
              async get() {
                const docs = memberships
                  .filter((m) => m[field] === value)
                  .map((m) => ({ data: () => m }));
                return { docs };
              },
            };
          },
        };
      }
      if (name === 'users') {
        return {
          doc(uid) {
            return {
              async get() {
                const data = users[uid];
                return { exists: data !== undefined, data: () => data };
              },
            };
          },
        };
      }
      throw new Error(`unexpected collection: ${name}`);
    },
  };
}

test('在籍0件 → none（オンボーディングへ誘導）', async () => {
  const db = makeMockDb({ memberships: [] });
  const r = await resolveTenantContext(db, 'uid-1');
  assert.equal(r.status, 'none');
});

test('在籍1件 → ok（そのテナントを採用・role/isAdmin を解決）', async () => {
  const db = makeMockDb({
    memberships: [{ tenantId: 'tenant-a', userId: 'uid-1', role: 'owner', isAdmin: true }],
  });
  const r = await resolveTenantContext(db, 'uid-1');
  assert.equal(r.status, 'ok');
  assert.equal(r.context.tenantId, 'tenant-a');
  assert.equal(r.context.role, 'owner');
  assert.equal(r.context.isAdmin, true);
  assert.equal(r.context.isSuperAdmin, false, 'users doc 無しなら superadmin は false');
});

test('isSuperAdmin は users から直交解決（membership とは別系統）', async () => {
  const db = makeMockDb({
    memberships: [{ tenantId: 'tenant-a', userId: 'uid-1', role: 'owner', isAdmin: true }],
    users: { 'uid-1': { isSuperAdmin: true } },
  });
  const r = await resolveTenantContext(db, 'uid-1');
  assert.equal(r.context.isSuperAdmin, true, 'users.isSuperAdmin=true を反映');
});

test('在籍複数 ＋ ?t 一致 → ok（指定テナントを採用）', async () => {
  const db = makeMockDb({
    memberships: [
      { tenantId: 'tenant-a', userId: 'uid-1', role: 'owner', isAdmin: true },
      { tenantId: 'tenant-b', userId: 'uid-1', role: 'owner', isAdmin: true },
    ],
  });
  const r = await resolveTenantContext(db, 'uid-1', 'tenant-b');
  assert.equal(r.status, 'ok');
  assert.equal(r.context.tenantId, 'tenant-b', '?t で指定した在籍テナントを採用');
});

test('在籍複数 ＋ ?t 未指定 → choose（選択画面・在籍一覧を返す）', async () => {
  const db = makeMockDb({
    memberships: [
      { tenantId: 'tenant-a', userId: 'uid-1', role: 'owner', isAdmin: true },
      { tenantId: 'tenant-b', userId: 'uid-1', role: 'owner', isAdmin: true },
    ],
  });
  const r = await resolveTenantContext(db, 'uid-1');
  assert.equal(r.status, 'choose');
  assert.equal(r.memberships.length, 2, '在籍2件を選択肢として返す');
});

test('越境拒否: 在籍していないテナントを ?t 指定しても採用しない', async () => {
  const db = makeMockDb({
    memberships: [
      { tenantId: 'tenant-a', userId: 'uid-1', role: 'owner', isAdmin: true },
      { tenantId: 'tenant-b', userId: 'uid-1', role: 'owner', isAdmin: true },
    ],
  });
  // tenant-x には在籍していない。クライアント送信 ?t を信用しないので採用されない。
  const r = await resolveTenantContext(db, 'uid-1', 'tenant-x');
  assert.equal(r.status, 'choose', '未在籍テナント指定は採用せず選択画面に倒す');
  assert.ok(!r.memberships.some((m) => m.tenantId === 'tenant-x'), 'tenant-x は選択肢に出ない');
});

test('越境拒否（単一在籍）: 別テナントを ?t 指定しても自テナントを採用する', async () => {
  const db = makeMockDb({
    memberships: [{ tenantId: 'tenant-a', userId: 'uid-1', role: 'owner', isAdmin: true }],
  });
  // 在籍1件のときは ?t を無視して在籍テナントを採用（未在籍テナントへ越境しない）。
  const r = await resolveTenantContext(db, 'uid-1', 'tenant-evil');
  assert.equal(r.status, 'ok');
  assert.equal(r.context.tenantId, 'tenant-a', '在籍テナント以外は採用しない');
});

test('退籍（leftAt あり）は在籍に数えない', async () => {
  const db = makeMockDb({
    memberships: [
      { tenantId: 'tenant-a', userId: 'uid-1', role: 'owner', isAdmin: true, leftAt: 12345 },
    ],
  });
  const r = await resolveTenantContext(db, 'uid-1');
  assert.equal(r.status, 'none', '退籍済みは在籍0件扱い');
});

test('uid 無しは throw（呼び出し側がセッション検証済みのはず）', async () => {
  const db = makeMockDb({});
  await assert.rejects(() => resolveTenantContext(db, ''), /uid/);
});
