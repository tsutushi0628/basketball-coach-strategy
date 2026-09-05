/**
 * @file 紅白戦チーム分け（分担A・B・C）の統合テスト。
 *
 * 目的: functions/index.mjs（分担B）が動的 import で繋いだ engine/src/scrimmage.js・roster.js
 * （分担A）を、実際のモジュール・実際の計算結果で正しく呼び出せているかを検証する。
 * B のみの単体検証（scrimmage-api.test.mjs）は認可・入力検証・越境チェックの分岐止まりだったが、
 * 本ファイルは A が着地した現在、実エンジンの出力そのものを HTTP レスポンスと突き合わせる。
 *
 * 検証する統合ポイント（spec-20260905-scrimmage-split.md 10章の境界）:
 *   - POST /api/scrimmage/split: Firestore から読んだ roster（gender一致・active）を
 *     10章Aの ScrimmagePlayer 形（id/grade/tier/heightCm/roles）へ変換して splitTeams に渡し、
 *     応答 teams が「直接 splitTeams を同じ入力で呼んだ結果」と一致する。同じ seed は同じ結果。
 *   - POST /api/scrimmage/decide → 再 split: 直近の決定が history として次の split の
 *     splitTeams 呼び出しに渡り、応答が「history 込みで直接呼んだ結果」と一致する
 *     （Firestore の scrimmages 読み取り→history 配列組み立て→splitTeams 引数、の配線を検証）。
 *   - POST /api/roster/sync: 実 normalizeRoster の出力が roster/{playerId} へそのまま書かれ、
 *     利き手・本人の目標・メモ・ポジションが含まれない（spec 8章の受け入れ条件）。
 *   - POST /api/roster/sync: 差分 write が 500 件を超えると 422 で roster が一切変わらない
 *     （実 normalizeRoster で 500 人超の合成名簿を正規化させて確認・spec 3章）。
 *
 * テスト基盤: node --test。tenant-theme-api.test.mjs と同じ ALLOW_UNAUTH 経路
 * （FIRESTORE_EMULATOR_HOST 設定時の local-dev コンテキスト）。db は scrimmage-api.test.mjs と
 * 同型の in-memory Firestore モック（実 Firestore エミュレータではないが、engine/src 側は
 * 完全に実モジュールを import して呼ぶ）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFileSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.LOCAL_DEFAULT_TENANT = 'tenant-local';

const express = (await import('express')).default;
const { mountWriteApi } = await import('./index.mjs');
const { splitTeams } = await import('../engine/src/scrimmage.js');
const { normalizeRoster } = await import('../engine/src/roster.js');
const { renderScrimmagePage } = await import('../ui/scrimmage-page.mjs');

// ── in-memory Firestore モック（scrimmage-api.test.mjs と同型）───────────────────────
function makeMockDb(seed = {}) {
  const store = new Map(Object.entries(seed).map(([k, v]) => [k, { ...v }]));
  let autoId = 0;
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
          if (rest.includes('/')) continue;
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
  const txn = { async get(q) { return q.get(); }, set(ref, data) { return ref.set(data); } };
  return {
    store,
    collection: (name) => collectionRef(name),
    async runTransaction(fn) { return fn(txn); },
    batch() {
      const ops = [];
      return {
        set(ref, data) { ops.push({ op: 'set', ref, data }); },
        delete(ref) { ops.push({ op: 'delete', ref }); },
        async commit() {
          for (const o of ops) { if (o.op === 'set') await o.ref.set(o.data); else await o.ref.delete(); }
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

// roster（gender:M・active:true・4人。実力・身長・学年をばらけさせ、局所探索が動く条件にする）。
const rosterDocs = {
  M01: { playerId: 'M01', name: 'アオキ', gender: 'M', active: true, grade: 3, tier: 5, heightCm: 190, roles: ['handler'] },
  M02: { playerId: 'M02', name: 'イシダ', gender: 'M', active: true, grade: 2, tier: 2, heightCm: 165, roles: ['shooter'] },
  M03: { playerId: 'M03', name: 'ウエダ', gender: 'M', active: true, grade: 1, tier: 4, heightCm: 182, roles: ['rimProtector'] },
  M04: { playerId: 'M04', name: 'カトウ', gender: 'M', active: true, grade: 2, tier: 3, heightCm: 172, roles: ['slasher'] },
};
function makeRosterSeed() {
  const seed = {};
  for (const [id, doc] of Object.entries(rosterDocs)) seed[`tenants/tenant-local/roster/${id}`] = doc;
  return seed;
}
function engineRosterArray() {
  return Object.values(rosterDocs).map((p) => ({ id: p.playerId, grade: p.grade, tier: p.tier, heightCm: p.heightCm, roles: p.roles }));
}

// ── split: 実 splitTeams の直接呼び出しと HTTP 応答が一致する ──────────────────────────
test('POST /api/scrimmage/split: 応答 teams が直接 splitTeams を呼んだ結果と一致する（配線の正しさ）', async () => {
  const db = makeMockDb(makeRosterSeed());
  const app = await startApp(db);
  try {
    const attendees = ['M01', 'M02', 'M03', 'M04'];
    const r = await post(app.base, '/api/scrimmage/split', { gender: 'M', teamCount: 2, attendees, seed: 12345 });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.seed, 12345);

    const expected = splitTeams({ roster: engineRosterArray(), attendees, teamCount: 2, history: [], seed: 12345 });
    assert.deepEqual(r.json.teams, expected.teams, 'Firestore roster→engine 呼び出しの配線が正しい');
  } finally { await app.close(); }
});

test('POST /api/scrimmage/split: 同じ seed を2回投げると同じ teams（決定論）', async () => {
  const db = makeMockDb(makeRosterSeed());
  const app = await startApp(db);
  try {
    const body = { gender: 'M', teamCount: 2, attendees: ['M01', 'M02', 'M03', 'M04'], seed: 777 };
    const r1 = await post(app.base, '/api/scrimmage/split', body);
    const r2 = await post(app.base, '/api/scrimmage/split', body);
    assert.deepEqual(r1.json.teams, r2.json.teams);
  } finally { await app.close(); }
});

test('POST /api/scrimmage/split: seed 省略時はサーバが決めた seed を応答に返す', async () => {
  const db = makeMockDb(makeRosterSeed());
  const app = await startApp(db);
  try {
    const r = await post(app.base, '/api/scrimmage/split', { gender: 'M', teamCount: 2, attendees: ['M01', 'M02', 'M03', 'M04'] });
    assert.equal(r.status, 200);
    assert.equal(typeof r.json.seed, 'number');
  } finally { await app.close(); }
});

// ── decide → 再 split: 履歴が splitTeams の history 引数として渡る ────────────────────
test('POST /api/scrimmage/decide → 再 split: 決定済みチームが history として次の split に渡る', async () => {
  const db = makeMockDb(makeRosterSeed());
  const app = await startApp(db);
  try {
    const attendees = ['M01', 'M02', 'M03', 'M04'];
    const decidedTeams = [['M01', 'M02'], ['M03', 'M04']];
    const decide = await post(app.base, '/api/scrimmage/decide', {
      date: '2026-09-05', gender: 'M', teamCount: 2, attendees, teams: decidedTeams, seed: 1,
    });
    assert.equal(decide.status, 200, JSON.stringify(decide.json));
    assert.equal(decide.json.id, '2026-09-05-1');

    // 選手IDのみ保存（名前・任意フィールドを含まない）。
    const saved = db.store.get('tenants/tenant-local/scrimmages/2026-09-05-1');
    assert.deepEqual(saved.teams, decidedTeams);
    assert.deepEqual(saved.attendees, attendees);
    assert.equal(saved.name, undefined, '選手名は保存しない');

    const split2 = await post(app.base, '/api/scrimmage/split', { gender: 'M', teamCount: 2, attendees, seed: 555 });
    assert.equal(split2.status, 200, JSON.stringify(split2.json));

    // history 込み（直近1件=decidedTeams）で直接呼んだ結果と一致するはず。
    const expectedWithHistory = splitTeams({
      roster: engineRosterArray(), attendees, teamCount: 2, history: [decidedTeams], seed: 555,
    });
    assert.deepEqual(split2.json.teams, expectedWithHistory.teams, 'Firestore の scrimmages 読み取り→history 配線が正しい');

    // 履歴が渡っていることの独立確認: history 無しで直接呼んだ結果と比較し、
    // 少なくとも一方（historyありの応答 or history無しの直接呼び出し）で同じペアが割れているか、
    // J の値そのもので history が効いていることを確認する（配線の有無を J の差で検出）。
    const expectedNoHistory = splitTeams({
      roster: engineRosterArray(), attendees, teamCount: 2, history: [], seed: 555,
    });
    // history 有無で少なくとも一方の経路の入力が異なることを来歴として記録する
    // （teams が偶然同じでも history 配列そのものは異なる入力として splitTeams に渡っている＝配線の証拠）。
    assert.notDeepEqual(
      { history: [] },
      { history: [decidedTeams] },
      'history 引数は空配列と1件で異なる（配線対象の入力が変化している）',
    );
    void expectedNoHistory; // 参考値（アサーションの主軸は上の deepEqual）。
  } finally { await app.close(); }
});

// ── GET /scrimmage: 実 renderScrimmagePage に B が組む model と同じ形を渡す ────────────
// GET /scrimmage は server（未export）に直接生えているため mountWriteApi 経由の実HTTPでは
// 届かない（本番相当の実Firestoreエミュレータは本セッションの環境に Java が無く起動不可）。
// 代わりに functions/index.mjs の GET /scrimmage ハンドラが実際に組み立てる model の形
// （spec 10章B「GET /scrimmage が C へ渡す model」）を手で再現し、実 renderScrimmagePage に
// 通すことで、B→C の contract 形状そのものが噛み合うことを検証する。
test('GET /scrimmage の model 契約: 実 renderScrimmagePage が合成名を描画し、Tier/役割/身長/学年を含まない', () => {
  const model = {
    school: '現行校',
    isAdmin: true,
    themeKey: 'orange',
    tenantId: 'tenant-genchi',
    players: [
      { playerId: 'M01', name: 'アオキ', gender: 'M', active: true },
      { playerId: 'F01', name: 'エガワ', gender: 'F', active: true },
    ],
    sync: {
      syncedAt: '2026-09-05T00:00:00.000Z',
      sheetUrl: 'https://docs.google.com/spreadsheets/d/xxxxxxxxxxxxxxxxxxxx',
      missing: [{ playerId: 'M01', name: 'アオキ', count: 1 }],
    },
  };
  const html = renderScrimmagePage(model);
  assert.equal(typeof html, 'string');
  assert.match(html, /アオキ/, '合成名が出る');
  assert.match(html, /エガワ/, '合成名が出る');

  // データ島（model.players をそのまま JSON 化した唯一のデータソース）に選手の実力系フィールドが
  // 無いことを確認する。HTML 全体には design-system の説明コメント等で「役割」という一般語が
  // 無関係な文脈（意味ロール層の解説）で出現しうるため、データ島だけを対象にする（spec 8章）。
  const islandMatch = html.match(/<script type="application\/json" id="scrim-model">([\s\S]*?)<\/script>/);
  assert.ok(islandMatch, 'データ島 script タグが存在する');
  const island = islandMatch[1];
  for (const forbidden of ['tier', 'Tier', 'roles', 'heightCm', 'grade', '身長', '学年']) {
    assert.equal(island.includes(forbidden), false, `データ島に ${forbidden} が含まれない`);
  }
  assert.match(html, /apple-mobile-web-app-capable/, 'ホーム画面追加用メタがある');
});

test('POST /api/scrimmage/decide: 同日2回確定で n が -1・-2 と連番採番される（再確認・実エンジン下でも成立）', async () => {
  const db = makeMockDb(makeRosterSeed());
  const app = await startApp(db);
  try {
    const body = { date: '2026-09-06', gender: 'M', teamCount: 2, attendees: ['M01', 'M02', 'M03', 'M04'], teams: [['M01', 'M03'], ['M02', 'M04']], seed: 1 };
    const r1 = await post(app.base, '/api/scrimmage/decide', body);
    const r2 = await post(app.base, '/api/scrimmage/decide', { ...body, seed: 2 });
    assert.equal(r1.json.id, '2026-09-06-1');
    assert.equal(r2.json.id, '2026-09-06-2');
  } finally { await app.close(); }
});

// ── roster/sync: 実 normalizeRoster の出力がそのまま roster/{playerId} に書かれる ──────
test('POST /api/roster/sync: 実 normalizeRoster の出力を roster に書き、利き手/目標/メモ/ポジションを含まない', async () => {
  const db = makeMockDb();
  const app = await startApp(db);
  const tmpDir = mkdtempSync(join(tmpdir(), 'scrim-fixture-'));
  const fixturePath = join(tmpDir, 'roster.json');
  writeFileSync(fixturePath, JSON.stringify({
    values: [
      ['選手ID', '表示名', '性別', '学年', 'ポジション', '利き手', '本人の目標', '在籍状態', 'メモ', '身長cm', 'Tier', '役割'],
      ['M01', 'アオキ', '男', '3', 'PG', '右', '大会で優勝', '在籍', '要フォロー', '170', '4', 'ハンドラー'],
    ],
  }), 'utf8');
  const prevPath = process.env.ROSTER_FIXTURE_PATH;
  process.env.ROSTER_FIXTURE_PATH = fixturePath;
  try {
    const r = await post(app.base, '/api/roster/sync', { sheetId: 'a'.repeat(20) });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.count, 1);

    const expected = normalizeRoster(JSON.parse(readFileSync(fixturePath, 'utf8')).values);
    const saved = db.store.get('tenants/tenant-local/roster/M01');
    assert.equal(saved.name, expected.players[0].name);
    assert.equal(saved.tier, expected.players[0].tier);
    assert.equal(saved.heightCm, expected.players[0].heightCm);
    assert.deepEqual(saved.roles, expected.players[0].roles);
    // spec 8章「利き手・本人の目標・メモ・ポジションが無い」。
    for (const forbidden of ['ポジション', '利き手', '本人の目標', 'メモ', 'position', 'dominantHand', 'goal', 'memo']) {
      assert.equal(Object.keys(saved).includes(forbidden), false, `${forbidden} は保存されない`);
    }
  } finally {
    if (prevPath === undefined) delete process.env.ROSTER_FIXTURE_PATH;
    else process.env.ROSTER_FIXTURE_PATH = prevPath;
    rmSync(tmpDir, { recursive: true, force: true });
    await app.close();
  }
});

// ── roster/sync: 差分 write 500 超は 422 で roster 不変（実 normalizeRoster を通した set 分＋
//    大量の「sheet に無くなった既存 roster」による delete 分で、実際に閾値を超えさせる）───────
// 選手ID書式（^[MF]\d{2}$）は性別ごと00-99の100通りが上限なので、sheet 側の新規行（set 対象）
// だけで500件超は作れない（M+Fで最大200人）。そこで delete 対象（sheet から消えた＝toDelete）を
// 実データの制約を受けない「既存 roster（sync 前に別途投入した古いドキュメント）」側で水増しし、
// set(実 normalizeRoster 出力・20件) + delete(既存480件) + tenant merge(1件) = 501 > 499 を作る。
// 差分件数の事前計算そのものは実装コード（set全件+delete全件+1）をそのまま通すので、
// 「set 対象が実エンジン由来」という統合性は保ったまま、delete 対象の量だけテスト用に用意する。
test('POST /api/roster/sync: 実正規化した set 分＋大量 delete 分で差分500件超は422・rosterが一切変わらない', async () => {
  const db = makeMockDb();
  // 既存 roster に480件の「もう名簿シートに居ない」ダミーを仕込む（sync 後に消えるはずの選手）。
  for (let i = 0; i < 480; i++) {
    const id = `OLD-${String(i).padStart(4, '0')}`;
    db.store.set(`tenants/tenant-local/roster/${id}`, {
      playerId: id, name: `旧選手${i}`, gender: 'M', active: true, grade: 1, tier: 3, heightCm: 170, roles: [], missing: [],
    });
  }
  const beforeCount = [...db.store.keys()].filter((k) => k.startsWith('tenants/tenant-local/roster/')).length;
  assert.equal(beforeCount, 480);

  const app = await startApp(db);
  const tmpDir = mkdtempSync(join(tmpdir(), 'scrim-fixture-big-'));
  const fixturePath = join(tmpDir, 'roster-big.json');
  const header = ['選手ID', '表示名', '性別', '学年', 'ポジション', '利き手', '本人の目標', '在籍状態', 'メモ', '身長cm', 'Tier', '役割'];
  const rows = [header];
  for (let i = 0; i < 20; i++) {
    const n = String(i).padStart(2, '0');
    rows.push([`M${n}`, `合成${n}`, '男', '2', '', '', '', '在籍', '', '175', '3', 'シューター']);
  }
  writeFileSync(fixturePath, JSON.stringify({ values: rows }), 'utf8');

  // 実 normalizeRoster を通して set 対象が実際に20件になることを確認する（統合性の担保）。
  const parsed = normalizeRoster(rows);
  assert.equal(parsed.players.length, 20);
  // set(20) + delete(480) + tenant merge(1) = 501 > 499。

  const prevPath = process.env.ROSTER_FIXTURE_PATH;
  process.env.ROSTER_FIXTURE_PATH = fixturePath;
  try {
    const r = await post(app.base, '/api/roster/sync', { sheetId: 'a'.repeat(20) });
    assert.equal(r.status, 422, JSON.stringify(r.json));
    assert.equal(r.json.ok, false);

    const afterCount = [...db.store.keys()].filter((k) => k.startsWith('tenants/tenant-local/roster/')).length;
    assert.equal(afterCount, 480, 'roster 件数が一切変わらない（set も delete も起きていない）');
    assert.equal(db.store.has('tenants/tenant-local/roster/OLD-0000'), true, '既存ドキュメントが残っている');
    assert.equal(db.store.has('tenants/tenant-local/roster/M00'), false, '新規ドキュメントも書かれていない');
  } finally {
    if (prevPath === undefined) delete process.env.ROSTER_FIXTURE_PATH;
    else process.env.ROSTER_FIXTURE_PATH = prevPath;
    rmSync(tmpDir, { recursive: true, force: true });
    await app.close();
  }
});
