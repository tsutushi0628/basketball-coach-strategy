/**
 * @file Firestore シードスクリプト（エミュレータ向け・マルチテナント）。
 *
 * 現行の gitリポJSON を Firestore（名前付きDB basketball-strategy-db）へテナント別に投入する。
 * FIRESTORE_EMULATOR_HOST が立っているときだけ書く（本番DB誤書き込みを fail-fast で防ぐ）。
 * `firebase emulators:exec` 配下で実行すると同変数は firebase-tools が自動注入する。
 *
 * コレクション構成（design §1）:
 *   drills/{drillId}                                  素カタログ216件（グローバル共有・テナント非依存）
 *   tenants/{tid}                                     テナント doc（name/initialized/createdBy）
 *   tenants/{tid}/teams/{boys|girls}                  config（男子/女子）
 *   tenants/{tid}/teams/{teamId}/input/latest         team-input（指標）
 *   tenants/{tid}/annualPlan/current                  年間計画
 *   tenants/{tid}/overrides/{date}                    コーチ上書き（doc ID = date）
 *   users/{uid}                                       グローバルアカウント（doc ID = uid）
 *   memberships/{id}                                  所属（userId・tenantId・role・isAdmin）
 *
 * 最低2テナント投入し分離を E2E で検証できるようにする（design §6）:
 *   - tenant-genchi  : 現行校データ（既存 JSON を移送・所有者は合成 uid）
 *   - tenant-test    : 分離検証用テスト校（同じ JSON を別テナントとして投入）
 * ※エミュレータ専用の合成 uid を使う（実 uid・実校名はシードに書かない）。
 *
 * 成否判定: 末尾に "SEED OK" と件数を stdout に出す。emulators:exec は exit code を握りうるので
 *           呼び出し側（検証コマンド）は出力本文で PASS/FAIL を判定すること。
 */

import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const r = (...p) => resolve(repoRoot, ...p);

const PROJECT_ID = process.env.GCLOUD_PROJECT || 'demo-basketball-strategy';
const DATABASE_NAME = 'basketball-strategy-db';

const DRILL_ID = /^[A-Z]{3}-\d{3}$/;
const DATE_DOC_ID = /^\d{4}-\d{2}-\d{2}$/;

// テナント別シード定義（最低2テナント＝分離検証用）。所有者 uid は合成値（エミュレータ専用）。
const TENANT_SEEDS = [
  { tenantId: 'tenant-genchi', name: '現行校', ownerUid: 'seed-owner-genchi', isSuperAdmin: true },
  { tenantId: 'tenant-test', name: 'テスト校', ownerUid: 'seed-owner-test', isSuperAdmin: false },
];
// テナント配下に投入する男女2チーム（teamId 固定＝boys/girls・design §1）。
const TEAM_SEEDS = [
  { teamId: 'boys', config: 'engine/data/config.sample.json', input: 'engine/data/team-input.sample.json' },
  { teamId: 'girls', config: 'engine/data/config.girls.sample.json', input: 'engine/data/team-input.girls.sample.json' },
];

async function readJson(rel) {
  return JSON.parse(await readFile(r(rel), 'utf8'));
}

async function main() {
  if (!process.env.FIRESTORE_EMULATOR_HOST && process.env.PROD_SEED !== '1') {
    console.error('SEED ABORT: FIRESTORE_EMULATOR_HOST 未設定かつ PROD_SEED!=1（本番DB誤書き込み防止）');
    process.exit(1);
  }

  const app = getApps().length ? getApps()[0] : initializeApp({ projectId: PROJECT_ID });
  const db = getFirestore(app, DATABASE_NAME);

  // ── drills（グローバル共有・素カタログ216件）─────────────────────────────────
  const drills = await readJson('docs/practice-knowledge/data/drills.json');
  if (!Array.isArray(drills)) throw new Error('drills.json は配列であること');
  let drillsWritten = 0;
  for (let i = 0; i < drills.length; i += 400) {
    const batch = db.batch();
    for (const d of drills.slice(i, i + 400)) {
      const id = String(d.id);
      if (!DRILL_ID.test(id)) throw new Error(`drill id 形式不正: "${id}"`);
      batch.set(db.collection('drills').doc(id), d);
      drillsWritten++;
    }
    await batch.commit();
  }

  // ── 共通の業務データ（全テナントへ同一 JSON を投入）──────────────────────────
  const annual = await readJson('engine/data/annual-plan.json');
  const overrides = await readJson('engine/data/overrides.json');
  if (!Array.isArray(overrides)) throw new Error('overrides.json は配列であること');
  // 不正 date（doc ID 文字種違反）はテナント非依存で1回だけ数える（テナント数倍に膨らませない）。
  const validOverrides = overrides.filter((ov) => ov && typeof ov.date === 'string' && DATE_DOC_ID.test(ov.date));
  const teamData = {};
  for (const t of TEAM_SEEDS) {
    teamData[t.teamId] = { config: await readJson(t.config), input: await readJson(t.input) };
  }

  let tenantsWritten = 0;
  let teamsWritten = 0;
  let ovWritten = 0;
  let ovSkipped = overrides.length - validOverrides.length;
  let usersWritten = 0;
  let membershipsWritten = 0;

  for (const ts of TENANT_SEEDS) {
    const tenantRef = db.collection('tenants').doc(ts.tenantId);
    // 既に initialized 済みのテナントは合成テンプレで上書きしない（本番 PROD_SEED 誤実行で
    // 移行済み実データ＝teams/annualPlan/overrides を合成値で静かに潰さないための安全弁）。
    const existingTenant = await tenantRef.get();
    if (existingTenant.exists && existingTenant.data() && existingTenant.data().initialized === true) {
      console.log(`SEED SKIP tenants/${ts.tenantId}: initialized 済みのため合成テンプレ投入をスキップ`);
      continue;
    }
    // テナント doc（叩き台投入済み＝initialized:true）。
    await tenantRef.set({
      id: ts.tenantId,
      name: ts.name,
      status: 'active',
      initialized: true,
      createdBy: ts.ownerUid,
    });
    tenantsWritten++;

    // 男女2チーム config ＋ input/latest。
    for (const t of TEAM_SEEDS) {
      await tenantRef.collection('teams').doc(t.teamId).set(teamData[t.teamId].config);
      await tenantRef.collection('teams').doc(t.teamId).collection('input').doc('latest').set(teamData[t.teamId].input);
      teamsWritten++;
    }

    // 年間計画。
    await tenantRef.collection('annualPlan').doc('current').set(annual);

    // overrides（date を doc ID）。不正 date は事前に除外済み（ovSkipped はテナント非依存で1回計上済み）。
    for (const ov of validOverrides) {
      await tenantRef.collection('overrides').doc(ov.date).set(ov);
      ovWritten++;
    }

    // users（doc ID = uid）＋ memberships（owner/isAdmin）。
    await db.collection('users').doc(ts.ownerUid).set({
      authUid: ts.ownerUid,
      email: `${ts.ownerUid}@example.test`,
      isSuperAdmin: ts.isSuperAdmin === true,
    });
    usersWritten++;
    await db.collection('memberships').doc(`${ts.tenantId}__${ts.ownerUid}`).set({
      id: `${ts.tenantId}__${ts.ownerUid}`,
      tenantId: ts.tenantId,
      userId: ts.ownerUid,
      role: 'owner',
      isAdmin: true,
    });
    membershipsWritten++;
  }

  // ── ローカル永続ファイルからの復元オーバーレイ（テナント別）──────────────────────
  // エミュレータの名前付きDBは再起動で消えるため、保存APIが書き写すテナント別ファイル
  // (.emulator-data/overrides-local-{tenantId}.json) を git種データの上に載せ直す。
  let ovRestored = 0;
  for (const ts of TENANT_SEEDS) {
    const localRaw = await readFile(r(`.emulator-data/overrides-local-${ts.tenantId}.json`), 'utf8').catch(() => null);
    if (!localRaw) continue;
    let localArr = [];
    try { localArr = JSON.parse(localRaw); } catch { localArr = []; }
    for (const ov of (Array.isArray(localArr) ? localArr : [])) {
      if (!ov || typeof ov.date !== 'string' || !DATE_DOC_ID.test(ov.date)) continue;
      await db.collection('tenants').doc(ts.tenantId).collection('overrides').doc(ov.date).set(ov);
      ovRestored++;
    }
  }

  console.log(
    `SEED OK drills=${drillsWritten} tenants=${tenantsWritten} teams=${teamsWritten} ` +
    `overrides=${ovWritten} overridesSkipped=${ovSkipped} overridesRestored=${ovRestored} ` +
    `users=${usersWritten} memberships=${membershipsWritten} (overridesSource=${overrides.length}/tenant)`,
  );
  if (ovSkipped > 0) {
    console.log(`注意: overrides ${ovSkipped}件が doc ID 文字種(^\\d{4}-\\d{2}-\\d{2}$)違反でスキップされた`);
  }
}

main().catch((e) => {
  console.error('SEED FAIL:', e && e.stack ? e.stack : e);
  process.exit(1);
});
