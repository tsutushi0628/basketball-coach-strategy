/**
 * @file Firestore シードスクリプト（エミュレータ向け）。
 *
 * 現行の gitリポJSON を Firestore（名前付きDB basketball-strategy-db）へ投入する。
 * FIRESTORE_EMULATOR_HOST が立っているときだけ書く（本番DB誤書き込みを fail-fast で防ぐ）。
 * `firebase emulators:exec` 配下で実行すると同変数は firebase-tools が自動注入する。
 *
 * コレクション構成:
 *   drills/{drillId}              素カタログ216件（doc ID = drill.id、形式 ^[A-Z]{3}-\d{3}$ を assert）
 *   teams/{teamId}                config（男子/女子）
 *   teams/{teamId}/input/latest   team-input（指標）
 *   annualPlan/current            年間計画
 *   overrides/{date}              コーチ上書き（doc ID = date、^\d{4}-\d{2}-\d{2}$ を検証）
 *                                 ※トップレベル単一コレクション＝ローカル単一ファイルと同義。
 *                                   getOverrides() が全件返し、applyOverrides が body の team で当てる。
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
const TEAM_ID = /^[a-z0-9-]+$/;
const DATE_DOC_ID = /^\d{4}-\d{2}-\d{2}$/;

async function readJson(rel) {
  return JSON.parse(await readFile(r(rel), 'utf8'));
}

async function main() {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    console.error('SEED ABORT: FIRESTORE_EMULATOR_HOST が未設定（本番DB誤書き込み防止）');
    process.exit(1);
  }

  const app = getApps().length ? getApps()[0] : initializeApp({ projectId: PROJECT_ID });
  const db = getFirestore(app, DATABASE_NAME);

  // ── drills（素カタログ216件）──────────────────────────────────────────────
  const drills = await readJson('docs/practice-knowledge/data/drills.json');
  if (!Array.isArray(drills)) throw new Error('drills.json は配列であること');
  let drillsWritten = 0;
  // Firestore batch は500件上限。216件は1バッチで収まるが、将来増分に備えチャンク化。
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

  // ── teams（config 男子/女子）＋ input/latest ─────────────────────────────────
  const teamSeeds = [
    { team: 'minami-nakano-boys', config: 'engine/data/config.sample.json', input: 'engine/data/team-input.sample.json' },
    { team: 'minami-nakano-girls', config: 'engine/data/config.girls.sample.json', input: 'engine/data/team-input.girls.sample.json' },
  ];
  for (const t of teamSeeds) {
    if (!TEAM_ID.test(t.team)) throw new Error(`team id 形式不正: "${t.team}"`);
    const config = await readJson(t.config);
    const input = await readJson(t.input);
    await db.collection('teams').doc(t.team).set(config);
    await db.collection('teams').doc(t.team).collection('input').doc('latest').set(input);
  }

  // ── annualPlan/current ──────────────────────────────────────────────────────
  const annual = await readJson('engine/data/annual-plan.json');
  await db.collection('annualPlan').doc('current').set(annual);

  // ── overrides（date を doc ID。文字種検証で不正 date はスキップ＝可視化）───────────
  const overrides = await readJson('engine/data/overrides.json');
  if (!Array.isArray(overrides)) throw new Error('overrides.json は配列であること');
  let ovWritten = 0;
  let ovSkipped = 0;
  for (const ov of overrides) {
    if (!ov || typeof ov.date !== 'string' || !DATE_DOC_ID.test(ov.date)) {
      ovSkipped++;
      continue; // doc ID 文字種検証（kit ルール）。不正 date は黙って落ちるので件数で可視化する。
    }
    await db.collection('overrides').doc(ov.date).set(ov);
    ovWritten++;
  }

  console.log(
    `SEED OK drills=${drillsWritten} teams=${teamSeeds.length} annualPlan=1 ` +
    `overrides=${ovWritten} overridesSkipped=${ovSkipped} (source=${overrides.length})`,
  );
  if (ovSkipped > 0) {
    console.log(`注意: overrides ${ovSkipped}件が doc ID 文字種(^\\d{4}-\\d{2}-\\d{2}$)違反でスキップされた`);
  }
}

main().catch((e) => {
  console.error('SEED FAIL:', e && e.stack ? e.stack : e);
  process.exit(1);
});
