/**
 * @file createFirestoreStorage のテナントスコープ業務意図テスト。
 *
 * 検証する業務意図:
 *   - 必須引数: tenantId / teamId が無いと throw（空 tenantId でのパス組み立てを構造的に禁止＝
 *     越境事故の最後の砦・design §7-d）。
 *   - スコープ: getConfig/getTeamInput/getAnnualPlan/getOverrides は必ず
 *     tenants/{tenantId}/... 配下を読み、別テナント配下を読まない。
 *   - 分離: テナントAの storage はテナントBの overrides/annualPlan を返さない（越境しない）。
 *   - drills だけはグローバル（tenants 配下に行かない＝共有カタログ）。
 *
 * テスト基盤: node --test。Firestore はパスを記録する最小モックで代替（実 DB 不要）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createFirestoreStorage } from '../src/storage.js';

/**
 * 最小 Firestore モック。doc データはパス文字列キーの Map で持ち、storage が組み立てた
 * パスを記録する。これにより「どのパスを読んだか」を業務意図として検証できる。
 */
function makeMockDb(seed = {}) {
  const store = new Map(Object.entries(seed));
  const reads = [];
  const collectionRef = (basePath) => ({
    doc(id) {
      const path = `${basePath}/${id}`;
      return {
        collection(sub) { return collectionRef(`${path}/${sub}`); },
        async get() {
          reads.push(path);
          const data = store.get(path);
          return { exists: data !== undefined, data: () => data };
        },
      };
    },
    async get() {
      reads.push(`${basePath}[*]`);
      const docs = [];
      for (const [k, v] of store) {
        // 直下の doc だけ拾う（basePath/{id}・さらに深い階層は除外）。
        if (k.startsWith(`${basePath}/`) && !k.slice(basePath.length + 1).includes('/')) {
          docs.push({ data: () => v });
        }
      }
      return { docs };
    },
  });
  return {
    reads,
    collection(name) { return collectionRef(name); },
  };
}

test('fail-fast: tenantId が無いと throw（空テナントでのパス組み立てを構造的に禁止）', () => {
  const db = makeMockDb();
  assert.throws(() => createFirestoreStorage({ db, teamId: 'boys' }), /tenantId is required/);
  assert.throws(() => createFirestoreStorage({ db, tenantId: '', teamId: 'boys' }), /tenantId is required/);
});

test('fail-fast: teamId が無いと throw', () => {
  const db = makeMockDb();
  assert.throws(() => createFirestoreStorage({ db, tenantId: 'tenant-a' }), /teamId is required/);
});

test('スコープ: 業務データは tenants/{tenantId}/... 配下から読む（getConfig/getTeamInput/getAnnualPlan）', async () => {
  const db = makeMockDb({
    'tenants/tenant-a/teams/boys': { team_id: 'boys' },
    'tenants/tenant-a/teams/boys/input/latest': { indicators: [] },
    'tenants/tenant-a/annualPlan/current': { months: {} },
  });
  const storage = createFirestoreStorage({ db, tenantId: 'tenant-a', teamId: 'boys' });

  const config = await storage.getConfig();
  const input = await storage.getTeamInput();
  const annual = await storage.getAnnualPlan();

  assert.equal(config.team_id, 'boys', 'tenant 配下の config を読む');
  assert.deepEqual(input.indicators, [], 'tenant 配下の input/latest を読む');
  assert.deepEqual(annual.months, {}, 'tenant 配下の annualPlan/current を読む');
  // 読んだパスがすべて tenants/tenant-a 配下であること（トップレベル teams/annualPlan を読まない）。
  for (const p of db.reads) {
    assert.ok(p.startsWith('tenants/tenant-a/') || p.startsWith('drills'),
      `読み取りパスはテナント配下 or drills のみ: ${p}`);
  }
});

test('分離: テナントAの storage はテナントBの overrides を返さない（越境しない）', async () => {
  const db = makeMockDb({
    'tenants/tenant-a/overrides/2026-06-23': { date: '2026-06-23', source: 'coach' },
    'tenants/tenant-b/overrides/2026-06-24': { date: '2026-06-24', source: 'coach' },
  });
  const storageA = createFirestoreStorage({ db, tenantId: 'tenant-a', teamId: 'boys' });
  const storageB = createFirestoreStorage({ db, tenantId: 'tenant-b', teamId: 'boys' });

  const overridesA = await storageA.getOverrides();
  const overridesB = await storageB.getOverrides();

  assert.equal(overridesA.length, 1, 'A は自テナントの上書きのみ');
  assert.equal(overridesA[0].date, '2026-06-23');
  assert.equal(overridesB.length, 1, 'B は自テナントの上書きのみ');
  assert.equal(overridesB[0].date, '2026-06-24');
  assert.ok(!overridesA.some((o) => o.date === '2026-06-24'), 'A に B の上書きが混入しない');
});

test('drills はグローバル共有（tenants 配下に行かず drills を読む）', async () => {
  const db = makeMockDb({
    'drills/DRL-001': { id: 'DRL-001' },
    'drills/DRL-002': { id: 'DRL-002' },
  });
  const storage = createFirestoreStorage({ db, tenantId: 'tenant-a', teamId: 'boys' });
  const drills = await storage.getDrills();
  assert.equal(drills.length, 2, 'グローバル drills 全件を読む');
  // drills の読み取りは tenants 配下を経由しない。
  assert.ok(db.reads.some((p) => p === 'drills[*]'), 'グローバル drills コレクションを読む');
  assert.ok(!db.reads.some((p) => p.startsWith('tenants/')), 'drills 読み取りで tenants 配下を触らない');
});

test('未存在ドキュメントはテナントパス付きで throw（取り違え診断のため）', async () => {
  const db = makeMockDb({});
  const storage = createFirestoreStorage({ db, tenantId: 'tenant-a', teamId: 'boys' });
  await assert.rejects(() => storage.getConfig(), /tenants\/tenant-a\/teams\/boys/);
});

// ── getGoalOverrides（週/月の目標テキスト上書き）────────────────────────────────────
test('getGoalOverrides: doc 無しは空マップを返す（コーチ未編集＝正常状態）', async () => {
  const db = makeMockDb({});
  const storage = createFirestoreStorage({ db, tenantId: 'tenant-a', teamId: 'boys' });
  const goals = await storage.getGoalOverrides();
  assert.deepEqual(goals, { weeks: {}, arcMonths: {} });
  // テナント配下の goalOverrides/current を読む（別テナントを読まない）。
  assert.ok(db.reads.includes('tenants/tenant-a/goalOverrides/current'),
    'tenants/{tid}/goalOverrides/current を読む');
});

test('getGoalOverrides: weeks/arcMonths が object でないと各々空マップに正規化する', async () => {
  const db = makeMockDb({
    'tenants/tenant-a/goalOverrides/current': { weeks: 'not-an-object', arcMonths: 42 },
  });
  const storage = createFirestoreStorage({ db, tenantId: 'tenant-a', teamId: 'boys' });
  const goals = await storage.getGoalOverrides();
  assert.deepEqual(goals, { weeks: {}, arcMonths: {} }, '非object フィールドは空マップ');
});

test('getGoalOverrides: 非string 値を除去し string 値だけ採用する（型汚染除去）', async () => {
  const db = makeMockDb({
    'tenants/tenant-a/goalOverrides/current': {
      weeks: { '2026-06-23': '走り込み', '2026-06-30': 123, '2026-07-07': null, '2026-07-14': '通し' },
      arcMonths: { '7': '基礎固め', '8': { nested: true }, '9': '実戦' },
    },
  });
  const storage = createFirestoreStorage({ db, tenantId: 'tenant-a', teamId: 'boys' });
  const goals = await storage.getGoalOverrides();
  assert.deepEqual(goals.weeks, { '2026-06-23': '走り込み', '2026-07-14': '通し' },
    'string 値の週だけ採用（数値・null は除去）');
  assert.deepEqual(goals.arcMonths, { '7': '基礎固め', '9': '実戦' },
    'string 値の月だけ採用（object は除去）');
});

test('getGoalOverrides: 分離＝テナントAは自テナントの goalOverrides だけを読む（越境しない）', async () => {
  const db = makeMockDb({
    'tenants/tenant-a/goalOverrides/current': { weeks: { '2026-06-23': 'A の目標' } },
    'tenants/tenant-b/goalOverrides/current': { weeks: { '2026-06-23': 'B の目標' } },
  });
  const storageA = createFirestoreStorage({ db, tenantId: 'tenant-a', teamId: 'boys' });
  const goals = await storageA.getGoalOverrides();
  assert.deepEqual(goals.weeks, { '2026-06-23': 'A の目標' }, 'A は自テナントの目標のみ');
  assert.ok(!db.reads.some((p) => p.startsWith('tenants/tenant-b/')), 'B 配下を読まない');
});
