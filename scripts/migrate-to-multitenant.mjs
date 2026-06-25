/**
 * @file 本番移行スクリプト（既存トップレベル → 最初のテナント配下・一度きり・冪等）。
 *
 * 単一テナント時代のトップレベル（teams/annualPlan/overrides）を、最初のテナント
 * （tenants/{firstTenantId}）配下へ移送する（design §5）。drills はグローバル共有なので触らない。
 *
 * 冪等性: 移送先 doc が既に存在すればスキップ（再実行で二重移送しない）。最後に旧トップレベルを
 * 削除するが、削除も「移送済みを確認してから」行うので途中再実行で安全。
 *
 * 安全弁:
 *   - FIRESTORE_EMULATOR_HOST が無い本番実行は PROD_MIGRATE=1 を要求（誤実行防止・fail-fast）。
 *   - 所有者 uid は実値をスクリプトに書かない。OWNER_UID（直接 uid）または OWNER_EMAILS
 *     （Auth で uid 解決・カンマ区切りの先頭）を環境変数で渡す（design §5・機密）。
 *   - 学校表示名は SCHOOL_NAME 環境変数（無指定ならプレースホルダ）。実校名はコミット物に残さない。
 *
 * このスクリプトはオーナー Go まで実行しない（spec：本番移行は保留）。本回はコードのみ。
 */

import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const PROJECT_ID = process.env.GCLOUD_PROJECT || 'demo-basketball-strategy';
const DATABASE_NAME = 'basketball-strategy-db';

// 旧トップレベルの男女チーム doc ID（単一テナント時代の固定 ID）。
const LEGACY_TEAMS = ['minami-nakano-boys', 'minami-nakano-girls'];
// 移送先テナント内の固定 teamId（boys/girls）への対応。
const TEAM_ID_MAP = { 'minami-nakano-boys': 'boys', 'minami-nakano-girls': 'girls' };

const FIRST_TENANT_ID = process.env.FIRST_TENANT_ID || 'tenant-genchi';
const SCHOOL_NAME = process.env.SCHOOL_NAME || '現行校';

/**
 * 所有者 uid を環境変数から解決する。OWNER_UID 優先、無ければ OWNER_EMAILS の先頭を Auth で解決。
 * @param {import('firebase-admin/auth').Auth} auth
 * @returns {Promise<string>}
 */
async function resolveOwnerUid(auth) {
  if (process.env.OWNER_UID) return process.env.OWNER_UID;
  const emails = (process.env.OWNER_EMAILS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (emails.length === 0) {
    throw new Error('OWNER_UID も OWNER_EMAILS も未設定（所有者 uid を解決できない）');
  }
  const email = emails[0];
  try {
    const user = await auth.getUserByEmail(email);
    return user.uid;
  } catch (e) {
    if (e && e.code === 'auth/user-not-found') {
      // 所有者がまだ一度も sign-in していない＝Auth 利用者が無い。安定 uid を確定するため作成する。
      // emailVerified:true ＋同一メールの Google sign-in は既定設定（1メール1アカウント）で同 uid に紐づく。
      const created = await auth.createUser({ email, emailVerified: true });
      console.log(`NOTE: 所有者 Auth 利用者を新規作成（uid 確定のため）: ${created.uid}`);
      return created.uid;
    }
    throw e;
  }
}

/**
 * source doc を target ref へコピーする（target が既存ならスキップ＝冪等）。
 * @returns {Promise<'copied'|'skipped'|'absent'>}
 */
async function copyDoc(sourceRef, targetRef) {
  const target = await targetRef.get();
  if (target.exists) return 'skipped';
  const source = await sourceRef.get();
  if (!source.exists) return 'absent';
  await targetRef.set(source.data());
  return 'copied';
}

async function main() {
  const isEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
  if (!isEmulator && process.env.PROD_MIGRATE !== '1') {
    console.error('MIGRATE ABORT: 本番実行には PROD_MIGRATE=1 が必要（誤実行防止）');
    process.exit(1);
  }

  const app = getApps().length ? getApps()[0] : initializeApp({ projectId: PROJECT_ID });
  const db = getFirestore(app, DATABASE_NAME);
  const auth = getAuth(app);

  const ownerUid = await resolveOwnerUid(auth);
  const tenantRef = db.collection('tenants').doc(FIRST_TENANT_ID);

  const counts = { tenant: 'skipped', teams: 0, inputs: 0, annualPlan: 'absent', overrides: 0, deletedLegacy: 0 };

  // 1. テナント doc 作成（冪等）。
  const tenantSnap = await tenantRef.get();
  if (!tenantSnap.exists) {
    await tenantRef.set({
      id: FIRST_TENANT_ID,
      name: SCHOOL_NAME,
      status: 'active',
      initialized: true,
      createdBy: ownerUid,
    });
    counts.tenant = 'created';
  }

  // 2. teams（config）＋ input/latest を移送。
  for (const legacyTeamId of LEGACY_TEAMS) {
    const targetTeamId = TEAM_ID_MAP[legacyTeamId];
    const teamResult = await copyDoc(
      db.collection('teams').doc(legacyTeamId),
      tenantRef.collection('teams').doc(targetTeamId),
    );
    if (teamResult === 'copied') counts.teams++;
    const inputResult = await copyDoc(
      db.collection('teams').doc(legacyTeamId).collection('input').doc('latest'),
      tenantRef.collection('teams').doc(targetTeamId).collection('input').doc('latest'),
    );
    if (inputResult === 'copied') counts.inputs++;
  }

  // 3. annualPlan/current を移送。
  const annualResult = await copyDoc(
    db.collection('annualPlan').doc('current'),
    tenantRef.collection('annualPlan').doc('current'),
  );
  counts.annualPlan = annualResult;

  // 4. overrides 全件を移送（doc ID = date を保ったまま）。
  const legacyOverrides = await db.collection('overrides').get();
  for (const doc of legacyOverrides.docs) {
    const result = await copyDoc(
      db.collection('overrides').doc(doc.id),
      tenantRef.collection('overrides').doc(doc.id),
    );
    if (result === 'copied') counts.overrides++;
  }

  // 5. users/{ownerUid} を isSuperAdmin:true で upsert ＋ memberships（owner/isAdmin）。
  await db.collection('users').doc(ownerUid).set(
    { authUid: ownerUid, isSuperAdmin: true },
    { merge: true },
  );
  const membershipId = `${FIRST_TENANT_ID}__${ownerUid}`;
  const membershipRef = db.collection('memberships').doc(membershipId);
  if (!(await membershipRef.get()).exists) {
    await membershipRef.set({
      id: membershipId,
      tenantId: FIRST_TENANT_ID,
      userId: ownerUid,
      role: 'owner',
      isAdmin: true,
    });
  }

  // 6. 旧トップレベル削除（移送済みを確認してから＝冪等）。
  //    移送先 doc が存在することを確認した上で旧 doc を消す（移送漏れ時は消さない）。
  if (process.env.MIGRATE_DELETE_LEGACY === '1') {
    for (const legacyTeamId of LEGACY_TEAMS) {
      const targetTeamId = TEAM_ID_MAP[legacyTeamId];
      // config と input/latest は別 doc なので、それぞれ「自分の移送先が存在する」ことを確認してから消す
      // （config だけ移送済みで input 未移送の中断状態で旧 input を消すと指標データを恒久喪失するため）。
      const migratedConfig = await tenantRef.collection('teams').doc(targetTeamId).get();
      const migratedInput = await tenantRef.collection('teams').doc(targetTeamId).collection('input').doc('latest').get();
      if (migratedInput.exists) {
        await db.collection('teams').doc(legacyTeamId).collection('input').doc('latest').delete().catch(() => {});
      }
      if (migratedConfig.exists) {
        await db.collection('teams').doc(legacyTeamId).delete().catch(() => {});
        counts.deletedLegacy++;
      }
    }
    if ((await tenantRef.collection('annualPlan').doc('current').get()).exists) {
      await db.collection('annualPlan').doc('current').delete().catch(() => {});
    }
    for (const doc of legacyOverrides.docs) {
      if ((await tenantRef.collection('overrides').doc(doc.id).get()).exists) {
        await db.collection('overrides').doc(doc.id).delete().catch(() => {});
      }
    }
  }

  console.log(
    `MIGRATE OK tenant=${counts.tenant} teams=${counts.teams} inputs=${counts.inputs} ` +
    `annualPlan=${counts.annualPlan} overrides=${counts.overrides} ` +
    `deletedLegacyTeams=${counts.deletedLegacy} deleteLegacy=${process.env.MIGRATE_DELETE_LEGACY === '1'}`,
  );
}

main().catch((e) => {
  console.error('MIGRATE FAIL:', e && e.stack ? e.stack : e);
  process.exit(1);
});
