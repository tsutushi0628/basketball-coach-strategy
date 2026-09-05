/**
 * @file 紅白戦チーム分け API（POST /api/scrimmage/split・/decide・POST /api/roster/sync）の業務意図テスト。
 *
 * 検証する業務意図（spec-20260905-scrimmage-split.md 5章・7章・10章B）:
 *   split:  owner でない → 403 ／ gender・teamCount・attendees の形式不正 → 400 ／
 *           attendees が名簿（gender一致・active）の部分集合でない → 400（越境・出席していない選手混入の防止）。
 *   decide: owner でない → 403 ／ teams が attendees のちょうど1回ずつの分割でない → 400 ／
 *           同日2回確定すると n が連番（-1・-2）で採番される。
 *   sync:   isAdmin でない → 403 ／ sheetId が書式（20文字以上の英数・-・_）を満たさない → 400 ／
 *           Sheets 取得失敗（fetchSheetValues の throw）→ 502 かつ roster に一切書き込まない。
 *
 * engine/src/scrimmage.js・engine/src/roster.js（並行実装の A 分担）はこのテスト実行時点で未着地のため、
 * それらへ到達する前に確定する認可・入力検証・越境チェックの分岐だけを実HTTPで検証する
 * （spec 10章「統合テストは存在確認後に行う」）。純判定関数は plain object で直接検証する。
 *
 * テスト基盤: node --test。tenant-theme-api.test.mjs と同じ ALLOW_UNAUTH 経路
 * （FIRESTORE_EMULATOR_HOST 設定時の local-dev コンテキスト）で owner・isAdmin ゲートを駆動する。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.LOCAL_DEFAULT_TENANT = 'tenant-local';

const express = (await import('express')).default;
const {
  mountWriteApi,
  scrimmageSplitDecision,
  scrimmageDecideDecision,
  rosterSyncDecision,
} = await import('./index.mjs');

// ── 純判定: scrimmageSplitDecision ────────────────────────────────────────────────
test('scrimmageSplitDecision: owner でないと 403', () => {
  const d = scrimmageSplitDecision({ role: 'viewer' }, { gender: 'M', teamCount: 2, attendees: ['M01', 'M02'] });
  assert.equal(d.ok, false);
  assert.equal(d.status, 403);
});

test('scrimmageSplitDecision: gender が M/F 以外は 400', () => {
  const d = scrimmageSplitDecision({ role: 'owner' }, { gender: 'X', teamCount: 2, attendees: ['M01', 'M02'] });
  assert.equal(d.status, 400);
});

test('scrimmageSplitDecision: teamCount が 2/3 以外は 400', () => {
  const d = scrimmageSplitDecision({ role: 'owner' }, { gender: 'M', teamCount: 4, attendees: ['M01', 'M02'] });
  assert.equal(d.status, 400);
});

test('scrimmageSplitDecision: attendees の重複は 400', () => {
  const d = scrimmageSplitDecision({ role: 'owner' }, { gender: 'M', teamCount: 2, attendees: ['M01', 'M01'] });
  assert.equal(d.status, 400);
});

test('scrimmageSplitDecision: attendees が teamCount 未満は 400', () => {
  const d = scrimmageSplitDecision({ role: 'owner' }, { gender: 'M', teamCount: 3, attendees: ['M01', 'M02'] });
  assert.equal(d.status, 400);
});

test('scrimmageSplitDecision: seed 非数値は 400', () => {
  const d = scrimmageSplitDecision({ role: 'owner' }, { gender: 'M', teamCount: 2, attendees: ['M01', 'M02'], seed: 'x' });
  assert.equal(d.status, 400);
});

test('scrimmageSplitDecision: 正当な入力は ok', () => {
  const d = scrimmageSplitDecision({ role: 'owner' }, { gender: 'M', teamCount: 2, attendees: ['M01', 'M02', 'M03'] });
  assert.equal(d.ok, true);
  assert.equal(d.gender, 'M');
  assert.equal(d.teamCount, 2);
  assert.deepEqual(d.attendees, ['M01', 'M02', 'M03']);
});

// ── 純判定: scrimmageDecideDecision ───────────────────────────────────────────────
const validDecideBody = {
  date: '2026-09-05', gender: 'M', teamCount: 2,
  attendees: ['M01', 'M02', 'M03', 'M04'],
  teams: [['M01', 'M02'], ['M03', 'M04']],
  seed: 42,
};

test('scrimmageDecideDecision: owner でないと 403', () => {
  const d = scrimmageDecideDecision({ role: 'viewer' }, validDecideBody);
  assert.equal(d.status, 403);
});

test('scrimmageDecideDecision: date が YYYY-MM-DD でないと 400', () => {
  const d = scrimmageDecideDecision({ role: 'owner' }, { ...validDecideBody, date: '2026/09/05' });
  assert.equal(d.status, 400);
});

test('scrimmageDecideDecision: teams の要素数が teamCount と不一致なら 400', () => {
  const d = scrimmageDecideDecision({ role: 'owner' }, { ...validDecideBody, teams: [['M01', 'M02', 'M03', 'M04']] });
  assert.equal(d.status, 400);
});

test('scrimmageDecideDecision: teams が attendees の分割でない（人数不一致）と 400', () => {
  const d = scrimmageDecideDecision({ role: 'owner' }, { ...validDecideBody, teams: [['M01', 'M02'], ['M03']] });
  assert.equal(d.status, 400);
});

test('scrimmageDecideDecision: teams に attendees 外の選手が混じると 400', () => {
  const d = scrimmageDecideDecision({ role: 'owner' }, { ...validDecideBody, teams: [['M01', 'M02'], ['M03', 'M99']] });
  assert.equal(d.status, 400);
});

test('scrimmageDecideDecision: teams に同じ選手が2回現れると 400（ちょうど1回の分割ではない）', () => {
  const d = scrimmageDecideDecision({ role: 'owner' }, { ...validDecideBody, teams: [['M01', 'M01'], ['M03', 'M04']] });
  assert.equal(d.status, 400);
});

test('scrimmageDecideDecision: seed 非数値は 400', () => {
  const d = scrimmageDecideDecision({ role: 'owner' }, { ...validDecideBody, seed: 'x' });
  assert.equal(d.status, 400);
});

test('scrimmageDecideDecision: 正当な入力は ok', () => {
  const d = scrimmageDecideDecision({ role: 'owner' }, validDecideBody);
  assert.equal(d.ok, true);
  assert.equal(d.date, '2026-09-05');
  assert.deepEqual(d.teams, validDecideBody.teams);
});

// ── 純判定: rosterSyncDecision ────────────────────────────────────────────────────
test('rosterSyncDecision: isAdmin でないと 403', () => {
  const d = rosterSyncDecision({ isAdmin: false }, {});
  assert.equal(d.status, 403);
});

test('rosterSyncDecision: sheetId 未指定は ok（保存済みを使う指示）', () => {
  const d = rosterSyncDecision({ isAdmin: true }, {});
  assert.equal(d.ok, true);
  assert.equal(d.sheetId, null);
});

test('rosterSyncDecision: sheetId が20文字未満は 400', () => {
  const d = rosterSyncDecision({ isAdmin: true }, { sheetId: 'short-id' });
  assert.equal(d.status, 400);
});

test('rosterSyncDecision: sheetId が書式（英数・-・_・20文字以上）を満たせば ok', () => {
  const d = rosterSyncDecision({ isAdmin: true }, { sheetId: 'a'.repeat(20) });
  assert.equal(d.ok, true);
  assert.equal(d.sheetId, 'a'.repeat(20));
});

// ── 実HTTP: モック db ──────────────────────────────────────────────────────────────
/**
 * パス文字列（'tenants/tid' 'tenants/tid/roster/M01' 等）をキーにした in-memory Firestore モック。
 * where(A).where(B).get() の複合等値フィルタ、orderBy(...).limit(n)、batch()、runTransaction
 * （txn.get(query) 込み）を invitations.test.mjs のモック作法を踏襲して備える。
 */
function makeMockDb(seed = {}) {
  const store = new Map(Object.entries(seed).map(([k, v]) => [k, { ...v }]));
  let autoId = 0;
  const writes = []; // batch.commit 前に呼ばれた set/delete の記録（roster不変の検証用）。

  function collectionRef(path, filters = [], order = null, lim = null) {
    return {
      doc(id) { return docRef(`${path}/${id ?? `auto-${++autoId}`}`); },
      where(field, _op, value) { return collectionRef(path, [...filters, { field, value }], order, lim); },
      orderBy(field, dir = 'asc') { return collectionRef(path, filters, { field, dir }, lim); },
      limit(n) { return collectionRef(path, filters, order, n); },
      async get() {
        const prefix = `${path}/`;
        let docs = [];
        for (const [p, data] of store) {
          if (!p.startsWith(prefix)) continue;
          const rest = p.slice(prefix.length);
          if (rest.includes('/')) continue; // 直下ドキュメントのみ（子サブコレクションを跨がない）
          if (filters.every((f) => data[f.field] === f.value)) {
            docs.push({ id: rest, ref: docRef(p), data: () => ({ ...data }) });
          }
        }
        if (order) {
          docs.sort((a, b) => {
            const av = orderKey(a.data()[order.field]);
            const bv = orderKey(b.data()[order.field]);
            const cmp = av < bv ? -1 : av > bv ? 1 : 0;
            return order.dir === 'desc' ? -cmp : cmp;
          });
        }
        if (lim != null) docs = docs.slice(0, lim);
        return { empty: docs.length === 0, docs, size: docs.length };
      },
    };
  }
  function orderKey(v) {
    if (v instanceof Date) return v.getTime();
    if (v && typeof v.toMillis === 'function') return v.toMillis();
    return 0;
  }
  function docRef(path) {
    const id = path.split('/').pop();
    return {
      id,
      collection(name) { return collectionRef(`${path}/${name}`); },
      async get() {
        const exists = store.has(path);
        return { exists, id, data: () => (exists ? { ...store.get(path) } : undefined) };
      },
      async set(data, opts) {
        if (opts?.merge && store.has(path)) store.set(path, { ...store.get(path), ...data });
        else store.set(path, { ...data });
      },
      async delete() { store.delete(path); },
    };
  }
  const txn = {
    async get(q) { return q.get(); },
    set(ref, data) { writes.push({ op: 'set', path: null, ref, data }); return ref.set(data); },
  };
  return {
    store,
    writes,
    collection: (name) => collectionRef(name),
    async runTransaction(fn) { return fn(txn); },
    batch() {
      const ops = [];
      return {
        set(ref, data) { ops.push({ op: 'set', ref, data }); },
        delete(ref) { ops.push({ op: 'delete', ref }); },
        async commit() {
          for (const o of ops) {
            writes.push(o);
            if (o.op === 'set') await o.ref.set(o.data, { merge: false });
            else await o.ref.delete();
          }
        },
      };
    },
  };
}

async function startApp(db) {
  const app = express();
  mountWriteApi(app, db);
  const server = createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) };
}
async function post(base, path, body) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

const rosterSeed = {
  'tenants/tenant-local/roster/M01': { playerId: 'M01', name: 'アオキ', gender: 'M', active: true, grade: 3, tier: 4, heightCm: 170, roles: ['handler'] },
  'tenants/tenant-local/roster/M02': { playerId: 'M02', name: 'イシダ', gender: 'M', active: true, grade: 2, tier: 3, heightCm: 178, roles: ['slasher'] },
  'tenants/tenant-local/roster/M03': { playerId: 'M03', name: 'ウエダ', gender: 'M', active: true, grade: 1, tier: 2, heightCm: 182, roles: ['rimProtector'] },
  'tenants/tenant-local/roster/M04': { playerId: 'M04', name: 'カトウ', gender: 'M', active: false, grade: 2, tier: 3, heightCm: 175, roles: ['shooter'] }, // 退部（active:false）
};

// ── POST /api/scrimmage/split ─────────────────────────────────────────────────────
test('POST /api/scrimmage/split: owner でない local ロールなら実質 owner なので、body 不正で 400 を確認', async () => {
  // ALLOW_UNAUTH の local-dev コンテキストは role:'owner' 固定のため、owner 403 分岐は
  // scrimmageSplitDecision の直接テストで検証済み。ここでは HTTP 経路で 400 分岐を確認する。
  const db = makeMockDb(rosterSeed);
  const app = await startApp(db);
  try {
    const r = await post(app.base, '/api/scrimmage/split', { gender: 'X', teamCount: 2, attendees: ['M01', 'M02'] });
    assert.equal(r.status, 400);
    assert.equal(r.json.ok, false);
  } finally { await app.close(); }
});

test('POST /api/scrimmage/split: attendees に非在籍（active:false）選手が混じると 400（名簿越境防止）', async () => {
  const db = makeMockDb(rosterSeed);
  const app = await startApp(db);
  try {
    const r = await post(app.base, '/api/scrimmage/split', { gender: 'M', teamCount: 2, attendees: ['M01', 'M02', 'M04'] });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /attendees/);
  } finally { await app.close(); }
});

test('POST /api/scrimmage/split: attendees に名簿に存在しない選手IDが混じると 400', async () => {
  const db = makeMockDb(rosterSeed);
  const app = await startApp(db);
  try {
    const r = await post(app.base, '/api/scrimmage/split', { gender: 'M', teamCount: 2, attendees: ['M01', 'M99'] });
    assert.equal(r.status, 400);
  } finally { await app.close(); }
});

// ── POST /api/scrimmage/decide ────────────────────────────────────────────────────
test('POST /api/scrimmage/decide: teams の分割検証に失敗すると 400（db に書かない）', async () => {
  const db = makeMockDb(rosterSeed);
  const app = await startApp(db);
  try {
    const r = await post(app.base, '/api/scrimmage/decide', {
      date: '2026-09-05', gender: 'M', teamCount: 2,
      attendees: ['M01', 'M02', 'M03'], teams: [['M01'], ['M02']], seed: 1,
    });
    assert.equal(r.status, 400);
    assert.equal(db.writes.length, 0, '検証失敗時は書き込みが起きない');
  } finally { await app.close(); }
});

test('POST /api/scrimmage/decide: teams に非在籍選手が混じると 400', async () => {
  const db = makeMockDb(rosterSeed);
  const app = await startApp(db);
  try {
    const r = await post(app.base, '/api/scrimmage/decide', {
      date: '2026-09-05', gender: 'M', teamCount: 2,
      attendees: ['M01', 'M02', 'M04'], teams: [['M01', 'M02'], ['M04']], seed: 1,
    });
    assert.equal(r.status, 400);
  } finally { await app.close(); }
});

test('POST /api/scrimmage/decide: 同日2回確定すると n が -1・-2 で連番採番される', async () => {
  const db = makeMockDb(rosterSeed);
  const app = await startApp(db);
  try {
    const body = {
      date: '2026-09-05', gender: 'M', teamCount: 2,
      attendees: ['M01', 'M02', 'M03'], teams: [['M01', 'M02'], ['M03']], seed: 7,
    };
    const r1 = await post(app.base, '/api/scrimmage/decide', body);
    assert.equal(r1.status, 200);
    assert.equal(r1.json.id, '2026-09-05-1');

    const r2 = await post(app.base, '/api/scrimmage/decide', { ...body, seed: 8 });
    assert.equal(r2.status, 200);
    assert.equal(r2.json.id, '2026-09-05-2', '同日2件目は連番 -2');

    const saved1 = db.store.get('tenants/tenant-local/scrimmages/2026-09-05-1');
    assert.deepEqual(saved1.attendees, body.attendees, '選手IDのみ保存（名前は含めない）');
    assert.equal(saved1.seed, 7);
  } finally { await app.close(); }
});

// ── POST /api/roster/sync ─────────────────────────────────────────────────────────
test('POST /api/roster/sync: sheetId 未指定・保存済みも無いと 400（roster 不変）', async () => {
  const db = makeMockDb(rosterSeed);
  const app = await startApp(db);
  try {
    const r = await post(app.base, '/api/roster/sync', {});
    assert.equal(r.status, 400);
    assert.equal(db.store.has('tenants/tenant-local/roster/M01'), true, 'roster は元のまま');
  } finally { await app.close(); }
});

test('POST /api/roster/sync: sheetId 書式不正は 400', async () => {
  const db = makeMockDb(rosterSeed);
  const app = await startApp(db);
  try {
    const r = await post(app.base, '/api/roster/sync', { sheetId: 'too-short' });
    assert.equal(r.status, 400);
  } finally { await app.close(); }
});

test('POST /api/roster/sync: sheetId 指定時に tenants/{tid}.rosterSheetId を merge 保存し、他フィールドを壊さない', async () => {
  // オーナーが Firestore コンソールを触らずに初回の sheetId を設定できる経路（body の sheetId）。
  // 既存の name/themeKey 等を消さないことを merge:true の実効果として確認する。
  const db = makeMockDb({
    ...rosterSeed,
    'tenants/tenant-local': { id: 'tenant-local', name: '現行校', themeKey: 'navy' },
  });
  const app = await startApp(db);
  const prevPath = process.env.ROSTER_FIXTURE_PATH;
  // Sheets 取得自体は失敗させて roster 書き込みまで到達させない（本テストの関心は sheetId の
  // merge 保存だけなので、502 になっても sheetId の保存は取得より先に起きる＝spec 5章の順序）。
  process.env.ROSTER_FIXTURE_PATH = 'C:/nonexistent-roster-fixture-for-test.json';
  try {
    const sheetId = 'z'.repeat(24);
    const r = await post(app.base, '/api/roster/sync', { sheetId });
    assert.equal(r.status, 502);
    const tenant = db.store.get('tenants/tenant-local');
    assert.equal(tenant.rosterSheetId, sheetId, 'sheetId が保存される');
    assert.equal(tenant.name, '現行校', '既存 name が消えない（merge）');
    assert.equal(tenant.themeKey, 'navy', '既存 themeKey が消えない（merge）');
  } finally {
    if (prevPath === undefined) delete process.env.ROSTER_FIXTURE_PATH;
    else process.env.ROSTER_FIXTURE_PATH = prevPath;
    await app.close();
  }
});

test('POST /api/roster/sync: Sheets 取得失敗（fetchSheetValues throw）は 502 で roster 不変', async () => {
  const db = makeMockDb(rosterSeed);
  const app = await startApp(db);
  // roster-sheet.mjs は自作モジュールなので実際に throw させる: ROSTER_FIXTURE_PATH を
  // 存在しないパスへ向け、エミュレータ経路の fixture 読み込みを失敗させる（本番の Sheets 4xx/5xx と同型の失敗）。
  const prevPath = process.env.ROSTER_FIXTURE_PATH;
  process.env.ROSTER_FIXTURE_PATH = 'C:/nonexistent-roster-fixture-for-test.json';
  try {
    const r = await post(app.base, '/api/roster/sync', { sheetId: 'a'.repeat(20) });
    assert.equal(r.status, 502);
    assert.equal(db.store.has('tenants/tenant-local/roster/M01'), true, 'roster は元のまま');
    assert.equal(db.writes.length, 0, 'roster/tenant への書き込みは一切起きない');
    // sheetId 自体は「保存」してから取得を試みる設計（spec 5章）なので、これだけは merge 済みで良い。
    assert.equal(db.store.get('tenants/tenant-local').rosterSheetId, 'a'.repeat(20));
  } finally {
    if (prevPath === undefined) delete process.env.ROSTER_FIXTURE_PATH;
    else process.env.ROSTER_FIXTURE_PATH = prevPath;
    await app.close();
  }
});
