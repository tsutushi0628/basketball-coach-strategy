/**
 * @file 招待登録（register 一本・新規テナント払い出し）。
 *
 * 新規払い出しと既存参加を1スキーマで混ぜると権限昇格の温床になるため、MVP は register
 * （新規払い出し）だけを実装する。参加型は将来別コレクションで物理分離する（design §4・§7-c）。
 *
 * トークン作法（兄弟 ai-basketball-coach に合わせる・design §8）:
 *   - 生トークン: randomBytes(32) を base64url 化（256bit・推測不可能）。
 *   - DB には SHA-256 hex の tokenHash のみ保存（生値は応答と joinUrl にだけ載る）。
 *
 * 承諾 txn は最小（払い出し＋membership＋users upsert＋招待消費）。テンプレ初期化は txn 外で
 * initializeTenant が行い initialized フラグで制御する（txn 肥大化回避・design §7-e）。
 *
 * この層は firebase-admin の crypto と FieldValue/Timestamp 以外に環境依存を持たない。
 * db は Firestore 互換、runTransaction は db.runTransaction を使う（Admin SDK）。
 */

import { randomBytes, createHash } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

/** 招待 doc ID 文字種（base64url ではなく Firestore 自動 ID を使うので英数のみ想定）。 */
const INVITATION_TTL_DAYS = 7;

/**
 * 暗号的に安全な招待トークン（256bit）を base64url 文字列で生成する。
 * @returns {string}
 */
export function generateToken() {
  return randomBytes(32).toString('base64url');
}

/**
 * 生トークンの SHA-256 ハッシュ（hex 64文字）を返す。DB 保管・照合に使う。
 * @param {string} token
 * @returns {string}
 */
export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * expiresAt（Firestore Timestamp 互換）を「今 < 期限」で判定する。
 * Timestamp / Date / number(ms) のいずれでも比較できるよう正規化する。
 * @param {{toMillis?:Function}|Date|number} expiresAt
 * @returns {boolean} 期限切れなら true
 */
function isExpired(expiresAt) {
  let ms;
  if (expiresAt && typeof expiresAt.toMillis === 'function') {
    ms = expiresAt.toMillis();
  } else if (expiresAt instanceof Date) {
    ms = expiresAt.getTime();
  } else if (typeof expiresAt === 'number') {
    ms = expiresAt;
  } else {
    ms = new Date(expiresAt).getTime();
  }
  return ms < Date.now();
}

/** N 日後の Firestore Timestamp。 */
function daysFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return Timestamp.fromDate(d);
}

/** accept/mint 内で使う status 付きエラー。 */
class InvitationError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/**
 * 招待を発行する（スーパー管理者のみ）。tokenHash だけ保存し、生トークンを含む joinUrl を返す。
 * register 一本なので email 等の個人情報は保存しない（受け取った Google ユーザーに新テナントを払い出す）。
 *
 * @param {{collection:Function}} db
 * @param {Object} ctx                解決済みテナントコンテキスト（{uid, isSuperAdmin}）。
 * @param {Object} opts
 * @param {string} [opts.role]        払い出すロール（既定 'owner'）。
 * @param {boolean} [opts.grantAdmin] テナント管理者フラグ（既定 true：テナント所有コーチ）。
 * @param {string} opts.baseUrl       joinUrl の基点（`<baseUrl>/join?token=<raw>`）。
 * @returns {Promise<{invitationId:string, joinUrl:string, expiresAt:Timestamp}>}
 */
export async function mintInvitation(db, ctx, { role = 'owner', grantAdmin = true, baseUrl } = {}) {
  if (!ctx || ctx.isSuperAdmin !== true) {
    throw new InvitationError('招待発行の権限がありません', 403);
  }
  if (!baseUrl) throw new InvitationError('baseUrl が必要です', 400);

  const rawToken = generateToken();
  const tokenHash = hashToken(rawToken);
  const ref = db.collection('invitations').doc();
  const expiresAt = daysFromNow(INVITATION_TTL_DAYS);
  await ref.set({
    id: ref.id,
    tokenHash,
    kind: 'register',
    role,
    grantAdmin: grantAdmin === true,
    status: 'pending',
    expiresAt,
    createdBy: ctx.uid,
    createdAt: FieldValue.serverTimestamp(),
  });
  // 生トークンは応答とリンクにだけ載る（DB には残さない・design §8）。
  return { invitationId: ref.id, joinUrl: `${baseUrl}/join?token=${rawToken}`, expiresAt };
}

/**
 * 招待を照合する（公開・未認証）。register なので個人情報は返さず {valid, kind, expired} のみ。
 * 見つからない・revoked・accepted は valid:false（理由を最小限で返す）。
 *
 * @param {{collection:Function}} db
 * @param {string} token  生トークン（クライアントから受領）
 * @returns {Promise<{valid:boolean, kind?:string, expired?:boolean, reason?:string}>}
 */
export async function lookupInvitation(db, token) {
  if (!token || typeof token !== 'string') {
    return { valid: false, reason: 'missing' };
  }
  const tokenHash = hashToken(token);
  const snap = await db.collection('invitations').where('tokenHash', '==', tokenHash).get();
  if (snap.empty) return { valid: false, reason: 'notfound' };
  const inv = snap.docs[0].data();
  if (inv.status === 'revoked') return { valid: false, kind: inv.kind, reason: 'revoked' };
  if (inv.status === 'accepted') return { valid: false, kind: inv.kind, reason: 'accepted' };
  if (inv.status === 'expired' || isExpired(inv.expiresAt)) {
    return { valid: false, kind: inv.kind, expired: true, reason: 'expired' };
  }
  return { valid: true, kind: inv.kind, expired: false };
}

/**
 * 招待を承諾し、新テナントを払い出す（register・最小トランザクション）。
 *
 * txn 内で原子的に行うのは払い出し＋membership＋users upsert＋招待消費だけ（design §7-e）:
 *   1. tokenHash で invitations を txn.get（トランザクション読み取り）。
 *   2. status==='pending' かつ未期限を検証（期限切れなら status='expired' に倒して throw）。
 *   3. 新 tenant doc 作成（initialized:false・name は仮＝コーチが後で変更）。
 *   4. 作成者を owner / isAdmin:true で membership 作成。
 *   5. users/{uid} を upsert（doc ID = uid）。
 *   6. invitation を accepted に更新（再利用防止＝消費）。
 * テンプレ投入（initializeTenant）は呼び出し側が txn 成功後に txn 外で行う。
 *
 * @param {{collection:Function, runTransaction:Function}} db
 * @param {{uid:string, email:string|null}} authUser  認証済みユーザー（セッションから）
 * @param {string} token  生トークン
 * @returns {Promise<{tenantId:string}>}
 */
export async function acceptInvitation(db, authUser, token) {
  if (!authUser || !authUser.uid) throw new InvitationError('認証情報が不正です', 401);
  if (!token || typeof token !== 'string') throw new InvitationError('token は必須です', 400);

  const tokenHash = hashToken(token);
  const tenantRef = db.collection('tenants').doc();
  const tenantId = tenantRef.id;

  await db.runTransaction(async (txn) => {
    // 1. tokenHash で招待を引く（トランザクション読み取り）。
    const invSnap = await txn.get(db.collection('invitations').where('tokenHash', '==', tokenHash));
    if (invSnap.empty) throw new InvitationError('招待が見つかりません', 404);
    const invDoc = invSnap.docs[0];
    const inv = invDoc.data();

    // 2. pending かつ未期限の確認（消費済み・取り消し済みは弾く）。
    if (inv.status !== 'pending') {
      throw new InvitationError(`招待の状態が無効です: ${inv.status}`, 400);
    }
    if (isExpired(inv.expiresAt)) {
      txn.update(invDoc.ref, { status: 'expired' });
      throw new InvitationError('招待の有効期限が切れています', 400);
    }

    // users を txn 内で先読みする（Firestore txn は全 read を write より前に行う制約）。
    // 既存ユーザー（別テナント承諾済み・移行で superadmin 付与済み等）の作成時刻・email を上書きしないため。
    const userRef = db.collection('users').doc(authUser.uid);
    const userSnap = await txn.get(userRef);

    const role = inv.role || 'owner';
    const grantAdmin = inv.grantAdmin === true;

    // 3. 新テナント（initialized:false＝叩き台投入はこの後 txn 外で）。name は仮で、コーチが後で変更する。
    txn.set(tenantRef, {
      id: tenantId,
      name: '新しいチーム',
      status: 'active',
      initialized: false,
      themeKey: 'orange',
      createdBy: authUser.uid,
      createdAt: FieldValue.serverTimestamp(),
    });

    // 4. membership（作成者＝owner・isAdmin:true）。tenantId/userId はサーバ強制（クライアント値は入らない）。
    const membershipRef = db.collection('memberships').doc();
    txn.set(membershipRef, {
      id: membershipRef.id,
      tenantId,
      userId: authUser.uid,
      role,
      isAdmin: grantAdmin,
      joinedAt: FieldValue.serverTimestamp(),
    });

    // 5. users upsert（doc ID = uid）。createdAt は新規作成時のみ・email は今回取得できた時のみ書く
    //    （既存の作成時刻・既存 email を上書きしない。isSuperAdmin 等は merge で温存）。
    const userPayload = { authUid: authUser.uid };
    if (authUser.email) userPayload.email = authUser.email;
    if (!userSnap.exists) userPayload.createdAt = FieldValue.serverTimestamp();
    txn.set(userRef, userPayload, { merge: true });

    // 6. 招待を消費（accepted）。再利用・二重払い出しを防ぐ。
    txn.update(invDoc.ref, {
      status: 'accepted',
      acceptedBy: authUser.uid,
      acceptedAt: FieldValue.serverTimestamp(),
    });
  });

  return { tenantId };
}

export { InvitationError };
