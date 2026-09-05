/**
 * @file 名簿シートID設定スクリプト（Admin SDK・オーナーがFirestoreコンソールを触らずに済む経路）。
 *
 * `POST /api/roster/sync` は body の sheetId が省略されると tenants/{tid}.rosterSheetId の
 * 保存済み値を使う（未設定なら400）。初回はその保存済み値が無いので、最初の1回だけ本スクリプトで
 * tenants/{tid}.rosterSheetId を設定する（以後は面3の「名簿を同期」から sheetId 省略で回る）。
 *
 * 安全弁（migrate-to-multitenant.mjs・seed-firestore.mjs と同じ作法）:
 *   - 既定はエミュレータ想定（demo-basketball-strategy）。本番プロジェクト（ai-bb-coach）へ
 *     書くのは `--prod` を明示したときだけ（誤って本番へ書かないための fail-fast）。
 *   - `--prod` を付けないのに FIRESTORE_EMULATOR_HOST も無い実行は拒否する（宛先不明な書き込み
 *     を許さない）。
 *   - 実スプシIDはこのファイルに書かない。呼び出し時に `--sheet` 引数で渡す。
 *
 * このPCでの本番実行前提: `GOOGLE_APPLICATION_CREDENTIALS` にリポ外の ADC（個人アカウントの
 * authorized_user 資格）、`GOOGLE_CLOUD_QUOTA_PROJECT=ai-bb-coach` を環境変数で与えれば、
 * firebase-admin 標準経路（ADC）で対話ログイン無しに本番へ書き込める（.spec-workflow/specs/
 * scrimmage-split/tasks.md の運用節参照）。
 *
 * 使い方:
 *   node scripts/set-roster-sheet.mjs --tenant tenant-genchi --sheet <20文字以上の英数・-・_>
 *   node scripts/set-roster-sheet.mjs --tenant tenant-genchi --sheet <sheetId> --prod
 */

import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const DATABASE_NAME = 'basketball-strategy-db';
const EMULATOR_PROJECT_ID = 'demo-basketball-strategy';
const PROD_PROJECT_ID = 'ai-bb-coach';
// functions/index.mjs の SHEET_ID_RE と同一（sync 判定と設定経路で書式基準を1つに保つ）。
const SHEET_ID_RE = /^[A-Za-z0-9_-]{20,}$/;
const TENANT_ID_RE = /^[A-Za-z0-9_-]+$/;

/** `--key value` 形式の argv をオブジェクトへパースする（依存追加なしの最小実装）。 */
function parseArgs(argv) {
  const out = { prod: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--prod') { out.prod = true; continue; }
    if (a === '--tenant') { out.tenant = argv[++i]; continue; }
    if (a === '--sheet') { out.sheet = argv[++i]; continue; }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.tenant || !TENANT_ID_RE.test(args.tenant)) {
    console.error('USAGE: node scripts/set-roster-sheet.mjs --tenant <tenantId> --sheet <sheetId> [--prod]');
    console.error('SET-ROSTER-SHEET FAIL: --tenant が不正です');
    process.exit(1);
  }
  if (!args.sheet || !SHEET_ID_RE.test(args.sheet)) {
    console.error('SET-ROSTER-SHEET FAIL: --sheet は英数・-・_ の20文字以上である必要があります');
    process.exit(1);
  }
  if (!args.prod && !process.env.FIRESTORE_EMULATOR_HOST) {
    console.error('SET-ROSTER-SHEET FAIL: --prod 未指定かつ FIRESTORE_EMULATOR_HOST も無い（宛先不明な書き込みを拒否）');
    console.error('  本番へ書くなら --prod を明示してください（demo プロジェクトではなく ai-bb-coach へ書きます）');
    process.exit(1);
  }

  const projectId = args.prod ? PROD_PROJECT_ID : EMULATOR_PROJECT_ID;

  const app = getApps().length ? getApps()[0] : initializeApp({ projectId });
  const db = getFirestore(app, DATABASE_NAME);

  const tenantRef = db.collection('tenants').doc(args.tenant);
  const snap = await tenantRef.get();
  if (!snap.exists) {
    console.log(`SET-ROSTER-SHEET WARN: tenants/${args.tenant} がまだ存在しません（先に招待承諾が必要な可能性）`);
  }

  await tenantRef.set({ rosterSheetId: args.sheet }, { merge: true });

  // 読み戻しで実際に保存された値を確認する（書き込み成功のログだけで済ませない）。
  const verifySnap = await tenantRef.get();
  const saved = verifySnap.data()?.rosterSheetId;
  if (saved !== args.sheet) {
    console.error('SET-ROSTER-SHEET FAIL: 書き込み後の読み戻しで値が一致しません');
    process.exit(1);
  }
  console.log(`SET-ROSTER-SHEET OK: tenants/${args.tenant}.rosterSheetId を設定・読み戻しで確認しました（project=${projectId}）`);
}

main().catch((e) => {
  console.error('SET-ROSTER-SHEET FAIL:', e && e.stack ? e.stack : e);
  process.exit(1);
});
