/**
 * @file 招待登録（register 一本）の業務意図テスト。
 *
 * 検証する業務意図:
 *   - token: generateToken は毎回異なる base64url・hashToken は同入力同出力（決定論）。
 *   - mint: スーパー管理者のみ発行できる（非 superadmin は 403）・生トークンは joinUrl にだけ載り
 *     DB は tokenHash のみ保存（生値を残さない）。
 *   - lookup: pending/未期限は valid:true、accepted/revoked/expired/未存在は valid:false（公開なので個人情報を返さない）。
 *   - accept: pending を承諾すると「新テナント作成（initialized:false）＋ owner membership ＋ users upsert
 *     ＋ 招待消費（accepted）」が起きる。
 *   - 再承諾拒否: 一度 accepted の招待は再度 accept できない（二重払い出し防止＝消費）。
 *
 * テスト基盤: node --test。Firestore は in-memory モック（runTransaction・where().get()・doc().set/update）で代替。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';

import {
  generateToken,
  hashToken,
  mintInvitation,
  lookupInvitation,
  acceptInvitation,
  InvitationError,
} from './invitations.mjs';

/**
 * in-memory Firestore モック。コレクション→(docId→data) の二層 Map。
 * where(field==value).get() と doc(id).set/update/get、自動 ID 採番、runTransaction を備える。
 * txn は同一ストアに対して即時反映する単純モデル（衝突なしの単体検証には十分）。
 */
function makeMockDb() {
  const cols = new Map(); // name -> Map(id -> data)
  let autoId = 0;
  const col = (name) => {
    if (!cols.has(name)) cols.set(name, new Map());
    return cols.get(name);
  };
  const queryOps = (name, filters) => ({
    async get() {
      const m = col(name);
      const docs = [];
      for (const [id, data] of m) {
        if (filters.every((f) => data[f.field] === f.value)) {
          docs.push({ id, ref: docRef(name, id), data: () => data });
        }
      }
      return { empty: docs.length === 0, docs };
    },
  });
  const collectionRef = (name) => ({
    doc(id) { return docRef(name, id ?? `auto-${++autoId}`); },
    where(field, _op, value) { return queryOps(name, [{ field, value }]); },
  });
  const docRef = (name, id) => ({
    id,
    async set(data, opts) {
      const m = col(name);
      if (opts && opts.merge && m.has(id)) m.set(id, { ...m.get(id), ...data });
      else m.set(id, { ...data });
    },
    async update(patch) {
      const m = col(name);
      if (!m.has(id)) throw new Error(`update on missing ${name}/${id}`);
      m.set(id, { ...m.get(id), ...patch });
    },
    async get() {
      const m = col(name);
      return { exists: m.has(id), id, data: () => m.get(id) };
    },
  });
  const txn = {
    async get(q) { return q.get(); },
    set(ref, data, opts) { return ref.set(data, opts); },
    update(ref, patch) { return ref.update(patch); },
  };
  return {
    _cols: cols,
    collection: collectionRef,
    async runTransaction(fn) { return fn(txn); },
  };
}

const BASE_URL = 'https://example.test';

test('token: generateToken は毎回異なり hashToken は決定論', () => {
  const a = generateToken();
  const b = generateToken();
  assert.notEqual(a, b, '毎回異なるトークン');
  assert.match(a, /^[A-Za-z0-9_-]+$/, 'base64url 文字種');
  assert.equal(hashToken(a), hashToken(a), '同入力同出力');
  assert.notEqual(hashToken(a), hashToken(b), '別入力別出力');
  assert.equal(hashToken(a).length, 64, 'SHA-256 hex は64文字');
});

test('mint: 非スーパー管理者は発行できない（403）', async () => {
  const db = makeMockDb();
  await assert.rejects(
    () => mintInvitation(db, { uid: 'u1', isSuperAdmin: false }, { baseUrl: BASE_URL }),
    (e) => e instanceof InvitationError && e.status === 403,
  );
});

test('mint: 生トークンは joinUrl にだけ載り DB は tokenHash のみ保存（生値を残さない）', async () => {
  const db = makeMockDb();
  const { invitationId, joinUrl } = await mintInvitation(
    db, { uid: 'admin', isSuperAdmin: true }, { baseUrl: BASE_URL },
  );
  const rawToken = new URL(joinUrl).searchParams.get('token');
  assert.ok(rawToken, 'joinUrl に生トークンが載る');

  const stored = db._cols.get('invitations').get(invitationId);
  assert.equal(stored.status, 'pending');
  assert.equal(stored.kind, 'register');
  assert.equal(stored.tokenHash, hashToken(rawToken), 'DB は SHA-256 ハッシュを保存');
  // DB に生トークンが残っていないこと（どのフィールドにも raw が出ない）。
  const serialized = JSON.stringify(stored);
  assert.ok(!serialized.includes(rawToken), 'DB に生トークンが残らない');
});

test('lookup: pending/未期限は valid:true・個人情報を返さない', async () => {
  const db = makeMockDb();
  const { joinUrl } = await mintInvitation(db, { uid: 'admin', isSuperAdmin: true }, { baseUrl: BASE_URL });
  const rawToken = new URL(joinUrl).searchParams.get('token');

  const r = await lookupInvitation(db, rawToken);
  assert.equal(r.valid, true);
  assert.equal(r.kind, 'register');
  assert.equal(r.expired, false);
  // 公開エンドポイントなので createdBy 等の個人情報は返さない。
  assert.ok(!('createdBy' in r) && !('email' in r), 'lookup は個人情報を返さない');
});

test('lookup: 未存在トークンは valid:false', async () => {
  const db = makeMockDb();
  const r = await lookupInvitation(db, 'no-such-token');
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'notfound');
});

test('lookup: 期限切れは valid:false（expired）', async () => {
  const db = makeMockDb();
  const ref = db.collection('invitations').doc();
  const rawToken = generateToken();
  await ref.set({
    id: ref.id, tokenHash: hashToken(rawToken), kind: 'register', role: 'owner',
    grantAdmin: true, status: 'pending', expiresAt: Timestamp.fromDate(new Date(Date.now() - 1000)),
  });
  const r = await lookupInvitation(db, rawToken);
  assert.equal(r.valid, false);
  assert.equal(r.expired, true);
});

test('accept: 新テナント作成＋owner membership＋users upsert＋招待消費が原子的に起きる', async () => {
  const db = makeMockDb();
  const { invitationId, joinUrl } = await mintInvitation(
    db, { uid: 'admin', isSuperAdmin: true }, { baseUrl: BASE_URL },
  );
  const rawToken = new URL(joinUrl).searchParams.get('token');

  const { tenantId } = await acceptInvitation(db, { uid: 'newcoach', email: 'c@example.test' }, rawToken);

  // 1. 新テナント（initialized:false＝叩き台は txn 外で投入する設計）。
  const tenant = db._cols.get('tenants').get(tenantId);
  assert.ok(tenant, '新テナントが作られる');
  assert.equal(tenant.initialized, false, 'initialized:false（テンプレ投入は txn 外）');
  assert.equal(tenant.createdBy, 'newcoach');

  // 2. owner membership（tenantId/userId はサーバ強制）。
  const memberships = [...db._cols.get('memberships').values()];
  assert.equal(memberships.length, 1, 'membership が1件作られる');
  assert.equal(memberships[0].tenantId, tenantId);
  assert.equal(memberships[0].userId, 'newcoach');
  assert.equal(memberships[0].role, 'owner');
  assert.equal(memberships[0].isAdmin, true);

  // 3. users upsert（doc ID = uid）。
  const user = db._cols.get('users').get('newcoach');
  assert.ok(user, 'users/{uid} が upsert される');
  assert.equal(user.email, 'c@example.test');

  // 4. 招待消費（accepted）。
  const inv = db._cols.get('invitations').get(invitationId);
  assert.equal(inv.status, 'accepted', '招待が accepted に消費される');
  assert.equal(inv.acceptedBy, 'newcoach');
});

test('再承諾拒否: 一度 accepted の招待は再度 accept できない（二重払い出し防止）', async () => {
  const db = makeMockDb();
  const { joinUrl } = await mintInvitation(db, { uid: 'admin', isSuperAdmin: true }, { baseUrl: BASE_URL });
  const rawToken = new URL(joinUrl).searchParams.get('token');

  await acceptInvitation(db, { uid: 'coach1', email: 'a@example.test' }, rawToken);
  const tenantsAfterFirst = db._cols.get('tenants').size;

  await assert.rejects(
    () => acceptInvitation(db, { uid: 'coach2', email: 'b@example.test' }, rawToken),
    (e) => e instanceof InvitationError && e.status === 400,
  );
  // 2人目には新テナントが払い出されない（消費済み）。
  assert.equal(db._cols.get('tenants').size, tenantsAfterFirst, '消費済み招待で新テナントは増えない');
});

test('accept: 認証情報が無いと 401・token 無しは 400', async () => {
  const db = makeMockDb();
  await assert.rejects(
    () => acceptInvitation(db, { uid: '' }, 'tok'),
    (e) => e instanceof InvitationError && e.status === 401,
  );
  await assert.rejects(
    () => acceptInvitation(db, { uid: 'u1', email: 'x@example.test' }, ''),
    (e) => e instanceof InvitationError && e.status === 400,
  );
});
