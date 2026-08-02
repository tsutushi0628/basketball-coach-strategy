/**
 * @file 「週始まりを日曜に変えても、既存のコーチ目標がそのまま引ける」を、実際の画面が使う
 * 読み込み経路（`engine/src/storage.js` の `createFirestoreStorage`・本番と同一の未改変コード）
 * を通して検証する。
 *
 * 背景（QA差し戻し・2026-08-02）: 「実データでの画面確認」として提出した証跡が、実際の画面が
 * 使わないローカルJSON経路（`getGoalOverrides` が常に空マップを返す実装）にテスト用の値を注入
 * したものだった。目標の上書きを読めるのは Firestore 経路（`createFirestoreStorage`）だけなので、
 * ローカル経路での確認は「動いていないものを動いていると判断する」危険がある。
 *
 * 本来はローカルの Firestore エミュレータで実画面（`node scripts/_serve-local.mjs` 経由の
 * Hosting URL）を確認する予定だったが、このサンドボックスに Java が入っておらず
 * （`java -version` が command not found、実際に `firebase emulators:start --only firestore`
 * を実行して "Could not spawn `java -version`" で失敗することを確認済み）、Firestore
 * エミュレータを起動できない。そのため画面のスクリーンショットは作らず、実際の読み込み経路
 * （createFirestoreStorage）を Firestore 形状の最小モック（engine/test/storage.test.js に既に
 * ある手法と同型・新しいテスト基盤の追加ではない）に接続し、そこから buildPlanData（本番と同一の
 * 未改変コード）まで通しで実行して確認する。
 *
 * 検証する業務意図（実装の途中計算は写経しない）:
 *   - createFirestoreStorage.getGoalOverrides() が、月曜キーで保存された週目標・arcMonthキーで
 *     保存された月目標を、そのまま（別解釈を挟まず）返す。
 *   - その戻り値を buildPlanData に通すと、日曜始まりの週（2026-08-02週）の表示に週目標が乗る。
 *   - 同じアーク月の月目標も同様に乗る。
 *   - 週の保存キー・日付連続性（曜日ボタン・週タブ）は、Firestore経路でもローカルJSON経路と
 *     同じ業務意図を満たす（既存の week-start-sunday.test.mjs と同型の確認をここでも行う）。
 *
 * テスト基盤: node --test。db は Firestore Admin SDK と同じ形（collection().doc().get()/.set()相当の
 * 読み取りだけ）を持つ最小モックで代替（実 Firestore・エミュレータ不要）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { createFirestoreStorage } from '../engine/src/storage.js';
import { buildPlanData } from './plan-data.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const r = (...p) => resolve(repoRoot, ...p);
async function readJson(rel) { return JSON.parse(await readFile(r(rel), 'utf8')); }

/**
 * 最小 Firestore モック（engine/test/storage.test.js の makeMockDb と同型の手法）。
 * doc データはパス文字列キーの Map で持つ。createFirestoreStorage が組み立てる
 * collection().doc().get() / collection().doc().collection().doc().get() /
 * collection().get()（コレクション直下の全doc列挙）だけを満たす。
 */
function makeMockDb(seed) {
  const store = new Map(Object.entries(seed));
  const collectionRef = (basePath) => ({
    doc(id) {
      const path = `${basePath}/${id}`;
      return {
        collection(sub) { return collectionRef(`${path}/${sub}`); },
        async get() {
          const data = store.get(path);
          return { exists: data !== undefined, data: () => data };
        },
      };
    },
    async get() {
      const docs = [];
      for (const [k, v] of store) {
        if (k.startsWith(`${basePath}/`) && !k.slice(basePath.length + 1).includes('/')) docs.push({ data: () => v });
      }
      return { docs };
    },
  });
  return { collection(name) { return collectionRef(name); } };
}

const TENANT_ID = 'tenant-verify-realpath';
const WEEK_GOAL_KEY = '2026-08-03'; // 2026-08-02週(日曜始まり)に含まれる月曜キー
const WEEK_GOAL_TEXT = '①リム付近の成功率を上げよう ②外角シュートを含めた駆け引きを覚えよう';
const MONTH_GOAL_TEXT = 'シード権大会で好成績を残そう';

/** サンプルJSON（他の全テストが使うのと同じ種データ）を Firestore ドキュメント形へ詰めた db を作る。
 * goalOverrides だけ、オーナー画面に実際に入っている文言をこのテスト用に注入する（Firestore
 * ドキュメントの形として注入するのであって、UI側のローカル経路は一切迂回しない）。arcMonth は
 * 事前に非上書きで buildPlanData を1回走らせ実測したキー(9)を使う（下のテストで実測値と突き合わせる）。 */
async function makeSeededDb() {
  const [config, teamInput, girlsConfig, girlsInput, annual, drills, overrides] = await Promise.all([
    readJson('engine/data/config.sample.json'),
    readJson('engine/data/team-input.sample.json'),
    readJson('engine/data/config.girls.sample.json'),
    readJson('engine/data/team-input.girls.sample.json'),
    readJson('engine/data/annual-plan.json'),
    readJson('docs/practice-knowledge/data/drills.json'),
    readJson('engine/data/overrides.json'),
  ]);
  const seed = {};
  for (const d of drills) seed[`drills/${d.id}`] = d;
  seed[`tenants/${TENANT_ID}/teams/boys`] = config;
  seed[`tenants/${TENANT_ID}/teams/boys/input/latest`] = teamInput;
  seed[`tenants/${TENANT_ID}/teams/girls`] = girlsConfig;
  seed[`tenants/${TENANT_ID}/teams/girls/input/latest`] = girlsInput;
  seed[`tenants/${TENANT_ID}/annualPlan/current`] = annual;
  for (const ov of overrides) if (ov && typeof ov.date === 'string') seed[`tenants/${TENANT_ID}/overrides/${ov.date}`] = ov;
  return { seed, config };
}

test('createFirestoreStorage.getGoalOverrides(): 月曜キーの週目標・arcMonthキーの月目標をそのまま返す', async () => {
  const { seed } = await makeSeededDb();
  seed[`tenants/${TENANT_ID}/goalOverrides/current`] = {
    weeks: { [WEEK_GOAL_KEY]: WEEK_GOAL_TEXT },
    arcMonths: { '9': MONTH_GOAL_TEXT },
  };
  const db = makeMockDb(seed);
  const storage = createFirestoreStorage({ db, tenantId: TENANT_ID, teamId: 'boys' });
  const goals = await storage.getGoalOverrides();
  assert.deepEqual(goals.weeks, { [WEEK_GOAL_KEY]: WEEK_GOAL_TEXT },
    '実際の読み込み経路(createFirestoreStorage)が月曜キーの週目標をそのまま返す');
  assert.deepEqual(goals.arcMonths, { '9': MONTH_GOAL_TEXT },
    '実際の読み込み経路(createFirestoreStorage)がarcMonthキーの月目標をそのまま返す');
});

test('Firestore経路(createFirestoreStorage)→buildPlanDataで、日曜始まりの週に既存の月曜キー目標が乗る', async () => {
  const { seed } = await makeSeededDb();
  const today = '2026-08-02'; // 実際の不具合報告と同じ日（日曜）

  // まず上書きなしで実行し、今日を含む週のアーク月キー(monthArcKey)を実測する（写経せず実測）。
  const dbNoGoals = makeMockDb(seed);
  const storageNoGoals = createFirestoreStorage({ db: dbNoGoals, tenantId: TENANT_ID, teamId: 'boys' });
  const girlsStorageNoGoals = createFirestoreStorage({ db: dbNoGoals, tenantId: TENANT_ID, teamId: 'girls' });
  const baseline = await buildPlanData({ storage: storageNoGoals, girlsStorage: girlsStorageNoGoals, today });
  const arcMonthKey = baseline.goalKeys.monthArcKey;
  const weekMondayKey = baseline.weeks.find((w) => w.days.some((d) => d.date === today)).weekStartDate;
  assert.equal(weekMondayKey, WEEK_GOAL_KEY, '前提: 今日(2026-08-02)を含む週の保存キーは2026-08-03(月曜)');

  // Firestoreドキュメントとして goalOverrides を投入し、同じ経路(createFirestoreStorage)で読み直す。
  seed[`tenants/${TENANT_ID}/goalOverrides/current`] = {
    weeks: { [weekMondayKey]: WEEK_GOAL_TEXT },
    arcMonths: { [String(arcMonthKey)]: MONTH_GOAL_TEXT },
  };
  const db = makeMockDb(seed);
  const storage = createFirestoreStorage({ db, tenantId: TENANT_ID, teamId: 'boys' });
  const girlsStorage = createFirestoreStorage({ db, tenantId: TENANT_ID, teamId: 'girls' });
  const data = await buildPlanData({ storage, girlsStorage, today });

  const todayWeek = data.weeks.find((w) => w.days.some((d) => d.date === today));
  assert.equal(todayWeek.focus, WEEK_GOAL_TEXT,
    'Firestore経路で保存された週目標が、日曜始まりの週表示にそのまま乗る');
  assert.equal(data.session.goals.monthMain, MONTH_GOAL_TEXT,
    'Firestore経路で保存された月目標がそのまま乗る');

  // 併せて、週始まり是正の業務意図（曜日ボタン連続・週タブ日曜区切り）もFirestore経路で成立することを確認。
  const days = todayWeek.days;
  assert.equal(days.length, 7);
  assert.equal(days[0].date, '2026-08-02', '先頭日は日曜(08/02)であるべき');
  assert.equal(days[6].date, '2026-08-08', '末尾日は土曜(08/08)であるべき');
});
