/**
 * @file セッション Cookie 認証（SSR・素 firebase-admin）。
 *
 * SSR の GET ナビゲーションには Authorization: Bearer ヘッダを載せられないため、
 * 本人性をセッション Cookie（__session）で運ぶ（design §3）。firebase-kit の
 * createSessionAuthGate は「静的配信＋ドメイン許可」モデルで本件（動的描画＋招待制＋
 * テナント解決）に合わず CommonJS のため import せず、作法だけ踏襲して getAuth() で自前実装する。
 *
 * 検証の使い分け（design §7-a）:
 *   - 読み（GET 描画）: verifySession(cookie, {checkRevoked:false}) ＝ローカル署名検証のみ。
 *     毎リクエストの Auth RPC を避けて SSR の TTFB を守る。
 *   - 書き込み・ログイン: checkRevoked:true ＝失効確認あり。破壊操作だけ厳密化。
 *
 * Cookie 属性: HttpOnly / Secure / SameSite=Lax / Path=/ / Max-Age≈24h（共有端末の取り違え・
 * 置き忘れリスクを抑えるため TTL を約1日にする・design §7-b）。SameSite=Lax でクロスサイト
 * POST に Cookie が乗らず CSRF を緩和（design §8）。
 */

import { getAuth } from 'firebase-admin/auth';

/** Cookie 名（Firebase Hosting は __session だけを Function へ転送する）。 */
export const SESSION_COOKIE_NAME = '__session';

/** セッション TTL（約1日）。createSessionCookie の expiresIn と Cookie の Max-Age に共用する。 */
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Cookie ヘッダ文字列を name→value の Map 風オブジェクトへ素朴に分解する。
 * 値は decodeURIComponent する（Set-Cookie 側で encode した値と対称にする）。
 * @param {string|undefined|null} header  req.headers.cookie の生値
 * @returns {Record<string,string>}
 */
export function parseCookies(header) {
  const out = {};
  if (!header || typeof header !== 'string') return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    const rawVal = part.slice(eq + 1).trim();
    try {
      out[name] = decodeURIComponent(rawVal);
    } catch {
      // 壊れた %xx 列はそのまま渡す（検証側が無効トークンとして弾く）。
      out[name] = rawVal;
    }
  }
  return out;
}

/**
 * Set-Cookie ヘッダ1本を組み立てる（属性は本ファイル先頭の方針に固定）。
 * value 空文字＋maxAgeMs=0 でクリア用にも使える。
 * @param {string} name
 * @param {string} value
 * @param {Object} [opts]
 * @param {number} [opts.maxAgeMs]  Cookie 寿命（ミリ秒）。省略時は SESSION_TTL_MS。
 * @returns {string}
 */
export function serializeCookie(name, value, { maxAgeMs = SESSION_TTL_MS } = {}) {
  const maxAgeSec = Math.floor(maxAgeMs / 1000);
  return [
    `${name}=${encodeURIComponent(value)}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${maxAgeSec}`,
  ].join('; ');
}

/**
 * ID トークンからセッション Cookie 文字列を作る（ログイン）。
 * ログインは失効確認あり（verifyIdToken checkRevoked=true）で本人性を厳密に確かめてから発行する。
 * @param {string} idToken  クライアントの Google sign-in で得た ID トークン
 * @returns {Promise<string>} Set-Cookie ヘッダにそのまま入れる文字列
 */
export async function createSession(idToken) {
  if (!idToken || typeof idToken !== 'string') {
    const e = new Error('idToken が必要です');
    e.status = 400;
    throw e;
  }
  // ログイン時のみ失効確認あり（design §7-a）。失効・無効トークンはここで弾く。
  await getAuth().verifyIdToken(idToken, true);
  const sessionCookie = await getAuth().createSessionCookie(idToken, { expiresIn: SESSION_TTL_MS });
  return serializeCookie(SESSION_COOKIE_NAME, sessionCookie, { maxAgeMs: SESSION_TTL_MS });
}

/**
 * セッション Cookie をクリアする Set-Cookie 文字列（ログアウト）。
 * @returns {string}
 */
export function clearSession() {
  return serializeCookie(SESSION_COOKIE_NAME, '', { maxAgeMs: 0 });
}

/**
 * Cookie ヘッダからセッションを検証して uid/email を返す。
 * 読み（GET 描画）は checkRevoked:false（ローカル署名検証のみ・TTFB 優先）、
 * 書き込み・ログアウトは checkRevoked:true（失効確認あり）で呼び分ける（design §7-a）。
 * セッションが無い・無効・（厳密時）失効済みなら null を返す（呼び出し側がリダイレクト/401 を決める）。
 *
 * @param {string|undefined|null} cookieHeader  req.headers.cookie の生値
 * @param {Object} [opts]
 * @param {boolean} [opts.checkRevoked]  失効確認の要否（書き込み・ログアウト時のみ true）
 * @returns {Promise<{uid:string, email:string|null}|null>}
 */
export async function verifySession(cookieHeader, { checkRevoked = false } = {}) {
  const cookies = parseCookies(cookieHeader);
  const sessionCookie = cookies[SESSION_COOKIE_NAME];
  if (!sessionCookie) return null;
  try {
    const decoded = await getAuth().verifySessionCookie(sessionCookie, checkRevoked);
    return { uid: decoded.uid, email: decoded.email || null };
  } catch {
    // 無効・期限切れ・失効済み Cookie は「未ログイン」と同じ扱い（呼び出し側が動線を決める）。
    return null;
  }
}

/**
 * ログアウト: セッション Cookie の uid を引いてリフレッシュトークンを失効させる（best-effort）。
 * Cookie が無効でも例外にせず、クリア用 Set-Cookie 文字列を返す（ログアウトは常に成立させる）。
 * @param {string|undefined|null} cookieHeader
 * @returns {Promise<string>} クリア用 Set-Cookie 文字列
 */
export async function revokeAndClear(cookieHeader) {
  const session = await verifySession(cookieHeader, { checkRevoked: true });
  if (session) {
    // 失効は best-effort。ここで死んでもログアウト（Cookie クリア）は成立させたい。
    try {
      await getAuth().revokeRefreshTokens(session.uid);
    } catch {
      /* noop: Cookie クリアは下で必ず行う */
    }
  }
  return clearSession();
}
