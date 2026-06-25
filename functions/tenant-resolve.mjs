/**
 * @file テナント・ロール解決（uid → 在籍テナント）。
 *
 * 唯一のテナントゲートは memberships 照合。クライアント送信の tenantId は信用せず、
 * 在籍（leftAt 無し）テナントの中から「どれを表示するか」の選択にのみ requestedTenantId を使う
 * （design §3・§8）。未在籍テナントを指定されても採用しない（呼び出し側が 403/誘導を決める）。
 *
 * ロール認可（membership.role / isAdmin）と管理者フラグ（users.isSuperAdmin）は直交2系統で解決する
 * （混在表は全組合せで破綻するため分ける・design §3）。
 *
 * この層は firebase-admin を import しない（CLI・ユニットテストからモック db で叩けるようにする）。
 * db は Firestore 互換（collection().where().get() / collection().doc().get()）であればよい。
 */

/**
 * @typedef {Object} TenantContext
 * @property {string} tenantId       採用したテナント id（在籍照合済み）。
 * @property {string} role           membership のロール（MVP は 'owner'）。
 * @property {boolean} isAdmin       membership の管理者フラグ。
 * @property {boolean} isSuperAdmin  プラットフォーム所有者フラグ（users.isSuperAdmin）。
 */

/**
 * @typedef {Object} ResolveResult
 * @property {'ok'|'none'|'choose'} status
 *   - 'ok'     : テナントを1つに決められた（context 付き）。
 *   - 'none'   : 在籍テナントが無い（/onboarding へ誘導）。
 *   - 'choose' : 複数在籍で requestedTenantId が未指定/不一致（テナント選択画面）。
 * @property {TenantContext} [context]                      status==='ok' のとき。
 * @property {Array<{tenantId:string, role:string, isAdmin:boolean}>} [memberships]
 *   status==='choose' のとき、選択肢として返す在籍一覧。
 */

/**
 * uid のスーパー管理者フラグを users から解決する（doc ID = uid）。
 * users doc が無い／フラグ未設定なら false（昇格は明示フラグのみ）。
 * @param {{collection:Function}} db
 * @param {string} uid
 * @returns {Promise<boolean>}
 */
async function resolveIsSuperAdmin(db, uid) {
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists) return false;
  const data = snap.data() || {};
  return data.isSuperAdmin === true;
}

/**
 * uid の在籍 membership 一覧を取得する。
 * 明示 where(userId==uid) で引き、leftAt を持つ（退籍済み）行をコード側で除外する
 * （フラット集合の越境防止＝必ず明示 where・非空検証・design §7-d）。
 * @param {{collection:Function}} db
 * @param {string} uid
 * @returns {Promise<Array<Object>>} 在籍中の membership ドキュメントデータ配列
 */
async function fetchActiveMemberships(db, uid) {
  const snap = await db.collection('memberships').where('userId', '==', uid).get();
  return snap.docs
    .map((d) => d.data())
    .filter((m) => m && typeof m.tenantId === 'string' && m.tenantId.length > 0 && !m.leftAt);
}

/**
 * uid から表示・操作するテナントを解決する。
 *
 * 分岐（design §3）:
 *   - 在籍 0 件          → status:'none'（承諾待ち/オンボーディングへ）。
 *   - 在籍 1 件          → status:'ok'（そのテナントを採用）。
 *   - 在籍 複数件        → requestedTenantId が在籍と一致すれば status:'ok'、
 *                          未指定/不一致なら status:'choose'（選択画面・在籍一覧を返す）。
 *
 * isSuperAdmin は採用テナントの有無に関わらず users から解決する（招待発行は在籍と直交）。
 *
 * @param {{collection:Function}} db                  Firestore 互換 db
 * @param {string} uid                                認証済み uid（セッションから渡る・信用できる）
 * @param {string|null|undefined} [requestedTenantId] クライアント送信 ?t（表示選択のみ・信用しない）
 * @returns {Promise<ResolveResult>}
 */
export async function resolveTenantContext(db, uid, requestedTenantId) {
  if (!db) throw new Error('resolveTenantContext: db が必要です');
  if (!uid) throw new Error('resolveTenantContext: uid が必要です');

  const [memberships, isSuperAdmin] = await Promise.all([
    fetchActiveMemberships(db, uid),
    resolveIsSuperAdmin(db, uid),
  ]);

  if (memberships.length === 0) {
    return { status: 'none' };
  }

  const toContext = (m) => ({
    uid, // 認証済み uid を文脈に載せる（招待発行の createdBy 監査などで使う）。
    tenantId: m.tenantId,
    role: m.role,
    isAdmin: m.isAdmin === true,
    isSuperAdmin,
  });

  if (memberships.length === 1) {
    return { status: 'ok', context: toContext(memberships[0]) };
  }

  // 複数在籍: requestedTenantId が在籍と一致したときだけ採用（クライアント値は選択にのみ使う）。
  const requested = typeof requestedTenantId === 'string' ? requestedTenantId : '';
  if (requested) {
    const matched = memberships.find((m) => m.tenantId === requested);
    if (matched) {
      return { status: 'ok', context: toContext(matched) };
    }
  }
  // 未指定 or 未在籍テナント指定 → 選択画面（在籍一覧を肯定形で返す）。
  // 表示名（学校名）を tenants から引いて載せる。引けないときは tenantId をフォールバック表示にする。
  const choices = await Promise.all(memberships.map(async (m) => {
    let name = m.tenantId;
    try {
      const snap = await db.collection('tenants').doc(m.tenantId).get();
      const data = snap.exists ? snap.data() : null;
      if (data && typeof data.name === 'string' && data.name) name = data.name;
    } catch { /* name は tenantId フォールバック */ }
    return { tenantId: m.tenantId, name, role: m.role, isAdmin: m.isAdmin === true };
  }));
  return { status: 'choose', memberships: choices };
}
