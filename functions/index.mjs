/**
 * @file Cloud Functions エントリポイント（HTML を返す単一 HTTPS 関数・マルチテナント）。
 *
 * firebase-kit 基盤ルール:
 *   - 全データ操作は Cloud Functions（Admin SDK）経由のみ。クライアントから Firestore へ直アクセス禁止
 *     （firestore.rules で全 deny。Admin SDK はルールをバイパスするので Function からは読める）。
 *   - LLM 呼び出しなし（エンジンは決定論）。
 *
 * 実装方針（描画ロジックは書き直さない）:
 *   既存の純関数 buildPlanData() に Firestore storage を注入し、既存レンダラ pattern-*.mjs の
 *   render() と build.mjs の renderPage() をそのまま呼んで HTML を返す。エンジン(engine/src)・
 *   描画(ui/*.mjs)の描画ロジックは改変せず再利用する。マルチテナント化で足したのは認証
 *   （セッション Cookie）・テナント解決・招待登録の配線だけ（design §3/§4/§6）。
 *
 * テナント境界（design §8）:
 *   - 唯一のテナントゲートは memberships 照合（resolveTenantContext）。クライアント送信 ?t は
 *     在籍テナントの中からどれを表示するかの選択にのみ使い、未在籍なら採用しない。
 *   - storage は必ず resolve 済み tenantId で作る（createFirestoreStorage が空 tenantId を throw）。
 *   - 越境チェックを通さない経路は login/logout/lookup/accept/静的ログイン画面だけ。
 */

import { onRequest } from 'firebase-functions/v2/https';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import express from 'express';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createFirestoreStorage } from '../engine/src/storage.js';
import { buildPlanData } from '../ui/plan-data.mjs';
import { renderPage } from '../ui/render-shared.mjs';
import { AUTH_CSS, authClientHtml } from '../ui/auth-client.mjs';
import { THEME_KEYS, themeOverrideCss } from '../ui/color-presets.mjs';

// セッション認証・テナント解決・招待（マルチテナント核）。
import { createSession, revokeAndClear, verifySession } from './session-auth.mjs';
import { resolveTenantContext } from './tenant-resolve.mjs';
import {
  mintInvitation,
  lookupInvitation,
  acceptInvitation,
  InvitationError,
} from './invitations.mjs';
import { initializeTenant } from './tenant-template.mjs';

// UI 画面モジュール（別担当が実装。ここでは import して /login・/join・選択画面に配線する）。
import { loginPageHtml } from '../ui/login.mjs';
import { joinPageHtml } from '../ui/join.mjs';
import { tenantPickerHtml } from '../ui/tenant-picker.mjs';

// プロジェクト設定（本番確定後に projectId を差し替え。エミュレータはダミー projectId で動く）。
const PROJECT_ID = process.env.GCLOUD_PROJECT || 'demo-basketball-strategy';
const DATABASE_NAME = 'basketball-strategy-db';
const REGION = 'asia-northeast1';
// テナント配下の固定2チーム（design §1：teamId は boys/girls 固定）。
const BOYS_TEAM = 'boys';
const GIRLS_TEAM = 'girls';

// Admin SDK 初期化（DEFAULT app を1度だけ）。
// FIRESTORE_EMULATOR_HOST が立っていれば getFirestore は自動でエミュレータに接続する。
const app = getApps().length ? getApps()[0] : initializeApp({ projectId: PROJECT_ID });
const db = getFirestore(app, DATABASE_NAME);

const DATE_DOC_ID = /^\d{4}-\d{2}-\d{2}$/;

// ── ローカル永続（エミュレータ専用）──────────────────────────────────────────
// エミュレータの名前付きDBは組み込みexport/importで永続化できず再起動で消える。
// そこで保存・削除のたびにローカルファイルへ書き写し、起動シードがそこから復元する。
// マルチテナント化に伴い退避はテナント別（tenantId キー付き）にする（design §6）。
// 本番（FIRESTORE_EMULATOR_HOST 未設定）では何もしない＝本番Firestoreは元から永続。
const IS_EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST;
// 本番(Cloud Functions)実行時だけ認証を強制する。emulator・単体テストでは K_SERVICE 未設定でスキップ。
const ENFORCE_AUTH = !!process.env.K_SERVICE && !process.env.FUNCTIONS_EMULATOR;
// エミュレータ無認証時の既定テナント（design §6：?t 未指定でも分離検証できるよう既定を1つ持つ）。
const LOCAL_DEFAULT_TENANT = process.env.LOCAL_DEFAULT_TENANT || 'tenant-genchi';
// Firebase Web 公開設定（apiKey はクライアント用の公開値＝秘密ではない）。ログイン/承諾画面に渡す。
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyCol5hF_-bqRlOIF-6rYxoSnQjo_xDCj58';
const WEB_CONFIG = {
  apiKey: FIREBASE_API_KEY,
  authDomain: `${PROJECT_ID}.firebaseapp.com`,
  projectId: PROJECT_ID,
};

// バンドル(dist/index.mjs)・ソース(index.mjs)どちらから起動しても repo 直下の .emulator-data を指すよう上方探索する。
function resolveLocalStoreDir() {
  if (process.env.LOCAL_STORE_DIR) return process.env.LOCAL_STORE_DIR;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (existsSync(resolve(dir, 'engine')) && existsSync(resolve(dir, 'functions'))) {
      return resolve(dir, '.emulator-data');
    }
    const up = resolve(dir, '..');
    if (up === dir) break;
    dir = up;
  }
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '.emulator-data');
}
const LOCAL_STORE_DIR = resolveLocalStoreDir();
// テナント別退避ファイル（design §6）。tenantId を doc ID 同様に文字種で固定してパス組み立てを安全化。
const TENANT_ID_RE = /^[A-Za-z0-9_-]+$/;
function localStorePath(tenantId) {
  return resolve(LOCAL_STORE_DIR, `overrides-local-${tenantId}.json`);
}
function readLocalStore(tenantId) {
  try { const a = JSON.parse(readFileSync(localStorePath(tenantId), 'utf8')); return Array.isArray(a) ? a : []; }
  catch { return []; }
}
function writeLocalStore(tenantId, arr) {
  // best-effort: ローカル退避の失敗は保存APIの成否に影響させない（本筋はFirestore書き込み）。
  try { mkdirSync(LOCAL_STORE_DIR, { recursive: true }); writeFileSync(localStorePath(tenantId), JSON.stringify(arr, null, 2), 'utf8'); }
  catch { /* noop */ }
}
function localUpsert(tenantId, ov) {
  if (!IS_EMULATOR || !TENANT_ID_RE.test(tenantId)) return;
  const arr = readLocalStore(tenantId).filter((o) => o && o.date !== ov.date);
  arr.push(ov);
  arr.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  writeLocalStore(tenantId, arr);
}
function localRemove(tenantId, date) {
  if (!IS_EMULATOR || !TENANT_ID_RE.test(tenantId)) return;
  writeLocalStore(tenantId, readLocalStore(tenantId).filter((o) => o && o.date !== date));
}

/**
 * コーチ上書き1件を検証・サニタイズして overrides/{date} に書ける形へ正規化する。
 * 余計なキーは落とし、保存スキーマ（date/weekday/source/layout/court/title/aim/rows）だけ通す。
 * 不正なら throw（呼び出し側が 400 にする）。
 */
function sanitizeOverride(body) {
  if (!body || typeof body !== 'object') throw new Error('body required');
  const date = String(body.date || '');
  if (!DATE_DOC_ID.test(date)) throw new Error('date must be YYYY-MM-DD');
  if (!Array.isArray(body.rows)) throw new Error('rows must be an array');
  if (body.rows.length > 50) throw new Error('too many rows');
  const str = (v, max) => (v == null ? '' : String(v).slice(0, max));
  const cell = (c) => {
    if (!c || typeof c !== 'object') return undefined;
    const items = Array.isArray(c.items) ? c.items.slice(0, 50).map((it) => {
      const o = { name: str(it && it.name, 200) };
      if (it && it.note) o.note = str(it.note, 500);
      return o;
    }).filter((it) => it.name) : [];
    return { block: str(c.block, 40), label: str(c.label, 200), items };
  };
  const rows = body.rows.map((r) => {
    const rr = (r && typeof r === 'object') ? r : {}; // null/非オブジェクト行でも落ちない
    const row = { from: str(rr.from, 5), to: str(rr.to, 5) };
    if (typeof rr.minutes === 'number' && rr.minutes >= 0) row.minutes = Math.floor(rr.minutes);
    const both = cell(rr.both);
    if (both) { row.both = both; } else {
      const boys = cell(rr['男子']); const girls = cell(rr['女子']);
      if (boys) row['男子'] = boys;
      if (girls) row['女子'] = girls;
    }
    return row;
  });
  const out = { date, source: 'coach', layout: 'two-col', rows };
  if (body.weekday) out.weekday = str(body.weekday, 2);
  if (body.court) out.court = str(body.court, 60);
  if (body.title) out.title = str(body.title, 120);
  if (body.aim) out.aim = str(body.aim, 400);
  return out;
}

// ── テナント解決ヘルパ（GET 描画・書き込み API 共通）──────────────────────────────
/**
 * リクエストからテナントコンテキストを解決する。
 *   - 本番（ENFORCE_AUTH）: セッション Cookie 検証（読みは checkRevoked=false・書きは true）→
 *     resolveTenantContext。クライアント送信 ?t は表示選択のみ（在籍照合が唯一のゲート）。
 *   - ローカル/エミュレータ: 認証を素通りし ?t または既定テナントで解決（無認証 E2E の口を維持）。
 *
 * @param {{collection:Function}} dbInstance  テナント解決に使う Firestore（書き込み経路は注入 db と一致させる）。
 * @param {import('express').Request} req
 * @param {{forWrite?:boolean}} [opts]  書き込み経路は失効確認あり（checkRevoked=true）。
 * @returns {Promise<{kind:'auth'|'context'|'none'|'choose', status?:number,
 *   redirect?:string, context?:object, memberships?:Array}>}
 *   - kind:'auth'    : 未ログイン（GET は /login へ・API は 401）。
 *   - kind:'none'    : テナント未所有（GET は /onboarding へ・API は 403）。
 *   - kind:'choose'  : 複数在籍・選択未確定（GET は選択画面・API は 400）。
 *   - kind:'context' : 解決成功（context を持つ）。
 */
async function resolveRequestTenant(dbInstance, req, { forWrite = false } = {}) {
  const requestedTenantId = typeof req.query.t === 'string' ? req.query.t : null;

  // 無認証フォールバックは「エミュレータ実行時（FIRESTORE_EMULATOR_HOST あり）」に限定する。
  // ENFORCE_AUTH（K_SERVICE 由来）の単独判定に全依存せず、本番ランタイムで K_SERVICE が万一
  // 外れても無認証で全テナントが開かないよう fail-secure にする（review medium 対応）。
  const ALLOW_UNAUTH = IS_EMULATOR && !ENFORCE_AUTH;
  if (ALLOW_UNAUTH) {
    // ローカル/エミュレータ: 無認証でテナントを解決（?t 優先・無ければ既定テナント）。
    // 権限は最小（superadmin は付けない＝招待発行はシード済み superadmin uid でのみ）。
    const tenantId = requestedTenantId && TENANT_ID_RE.test(requestedTenantId)
      ? requestedTenantId
      : LOCAL_DEFAULT_TENANT;
    return {
      kind: 'context',
      context: { uid: 'local-dev', tenantId, role: 'owner', isAdmin: true, isSuperAdmin: false },
    };
  }
  // ここから先は認証必須（ENFORCE_AUTH=true、または emulator でない想定外起動の fail-secure 経路）。
  const session = await verifySession(req.headers.cookie, { checkRevoked: forWrite });
  if (!session) {
    return { kind: 'auth', status: 401, redirect: '/login' };
  }
  const resolved = await resolveTenantContext(dbInstance, session.uid, requestedTenantId);
  if (resolved.status === 'none') {
    return { kind: 'none', status: 403, redirect: '/onboarding' };
  }
  if (resolved.status === 'choose') {
    return { kind: 'choose', status: 400, memberships: resolved.memberships };
  }
  return { kind: 'context', context: resolved.context };
}

/**
 * チームカラー保存の認可＋入力検証（テナント解決後・Firestore 書き込み前の純判定）。
 * 分岐・集合所属判定はコード側に閉じる（LLM不要）。テナント解決と越境担保はハンドラ側。
 *   - 管理者でない（ctx.isAdmin !== true）→ 403。
 *   - themeKey がプリセット集合（THEME_KEYS）外 → 400（壊れデータを作らせない＝書かせない）。
 *   - 上記を通過 → ok:true（ハンドラが ctx.tenantId 配下へ merge 書き込み）。
 * @param {{isAdmin?:boolean}} ctx 解決済みテナントコンテキスト
 * @param {*} body リクエストボディ（themeKey を持つ想定）
 * @returns {{ok:true, themeKey:string} | {ok:false, status:number, error:string}}
 */
export function themeWriteDecision(ctx, body) {
  if (!ctx || ctx.isAdmin !== true) {
    return { ok: false, status: 403, error: '設定の変更権限がありません' };
  }
  const themeKey = typeof body?.themeKey === 'string' ? body.themeKey : '';
  if (!THEME_KEYS.includes(themeKey)) {
    return { ok: false, status: 400, error: 'themeKey が不正です' };
  }
  return { ok: true, themeKey };
}

/**
 * 書き込みAPI・認証API・招待APIを express サーバへマウントする。
 * db は依存注入（本番は Admin SDK の Firestore、テストはモック db）。書き込みは
 * Function/Admin SDK 経由のみ＝クライアント直書きは rules で全 deny。
 * @param {import('express').Express} appServer
 * @param {{collection:Function, runTransaction:Function}} dbInstance
 */
export function mountWriteApi(appServer, dbInstance) {
  // JSON ボディ解析は /api 配下だけに効かせる（HTML を返す GET '*' を巻き込まない）。
  const json = express.json({ limit: '256kb' });
  appServer.get('/healthz', (_req, res) => {
    res.json({ status: 'ok', database: DATABASE_NAME });
  });

  // ── セッション認証（B2）──────────────────────────────────────────────────
  appServer.post('/api/session/login', json, async (req, res) => {
    try {
      const idToken = req.body && req.body.idToken;
      const setCookie = await createSession(idToken);
      res.set('Set-Cookie', setCookie).json({ ok: true });
    } catch (e) {
      res.status(e.status || 401).json({ ok: false, error: 'login failed' });
    }
  });
  appServer.post('/api/session/logout', json, async (req, res) => {
    // 失効は best-effort、Cookie クリアは必ず返す。失敗してもログアウト動線は成立させる。
    const setCookie = await revokeAndClear(req.headers.cookie);
    res.set('Set-Cookie', setCookie).json({ ok: true });
  });

  // ── 招待登録（D3）─────────────────────────────────────────────────────────
  // 発行: スーパー管理者のみ（テナント解決でロールを確かめてから mint）。
  appServer.post('/api/invitations', json, async (req, res) => {
    let ctx;
    try {
      const r = await resolveRequestTenant(dbInstance, req, { forWrite: true });
      if (r.kind === 'auth') { res.status(401).json({ ok: false, error: 'auth required' }); return; }
      if (r.kind !== 'context') { res.status(r.status || 403).json({ ok: false, error: 'forbidden' }); return; }
      ctx = r.context;
    } catch {
      res.status(500).json({ ok: false, error: 'resolve failed' });
      return;
    }
    try {
      const role = typeof req.body?.role === 'string' ? req.body.role : 'owner';
      const grantAdmin = req.body?.grantAdmin !== false;
      // joinUrl の基点は固定の公開ベースURL（APP_BASE_URL）を最優先。未設定時のみリクエストのオリジンから
      // 組む（Host/x-forwarded-host はクライアント改ざん可能なので、本番は APP_BASE_URL を設定する）。
      const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      const baseUrl = process.env.APP_BASE_URL || `${proto}://${host}`;
      const result = await mintInvitation(dbInstance, ctx, { role, grantAdmin, baseUrl });
      res.json({ ok: true, invitationId: result.invitationId, joinUrl: result.joinUrl });
    } catch (e) {
      if (e instanceof InvitationError) { res.status(e.status).json({ ok: false, error: e.message }); return; }
      res.status(500).json({ ok: false, error: 'mint failed' });
    }
  });
  // 照合: 公開（未認証）。register なので個人情報は返さない。
  appServer.post('/api/invitations/lookup', json, async (req, res) => {
    try {
      const result = await lookupInvitation(dbInstance, req.body && req.body.token);
      res.json(result);
    } catch {
      res.status(500).json({ valid: false, error: 'lookup failed' });
    }
  });
  // 承諾: セッション必須（idToken→Cookie 済み or 同時ログイン）。txn 成功後にテンプレ初期化（txn 外）。
  appServer.post('/api/invitations/accept', json, async (req, res) => {
    if (!ENFORCE_AUTH && !IS_EMULATOR) {
      // 認証強制も無く emulator でもない純テスト環境では accept は使わない（経路を明確化）。
      res.status(400).json({ ok: false, error: 'accept requires a session' });
      return;
    }
    let session;
    try {
      // 承諾は破壊操作なので失効確認あり。
      session = await verifySession(req.headers.cookie, { checkRevoked: true });
    } catch {
      session = null;
    }
    if (!session) { res.status(401).json({ ok: false, error: 'auth required' }); return; }
    let tenantId;
    try {
      const result = await acceptInvitation(dbInstance, session, req.body && req.body.token);
      tenantId = result.tenantId;
    } catch (e) {
      if (e instanceof InvitationError) { res.status(e.status).json({ ok: false, error: e.message }); return; }
      res.status(500).json({ ok: false, error: 'accept failed' });
      return;
    }
    // テンプレ初期化は txn 外（design §7-e）。Express4 は async ハンドラの reject を拾わないので
    // 必ず try/catch で囲む（囲まないと throw 時に応答が出ずクライアントがハングする）。
    // 失敗してもユーザーは既に払い出し済み（tenant+membership 作成済み・招待は消費済みで再 accept 不可）
    // なので ok を返して遷移させ、initialized:false のまま残す。描画 GET が initialized:false を検知して
    // 冪等に再初期化（自己修復）するため、ユーザー操作だけで復旧できる。
    try {
      await initializeTenant(dbInstance, tenantId);
    } catch {
      res.json({ ok: true, tenantId, uninitialized: true });
      return;
    }
    res.json({ ok: true, tenantId });
  });

  // ── コーチ上書きの保存/削除（C3：テナント所有者スコープ）────────────────────────
  appServer.post('/api/override', json, async (req, res) => {
    let ctx;
    try {
      const r = await resolveRequestTenant(dbInstance, req, { forWrite: true });
      if (r.kind === 'auth') { res.status(401).json({ ok: false, error: 'サインインが必要です' }); return; }
      if (r.kind === 'none') { res.status(403).json({ ok: false, error: 'テナントがありません' }); return; }
      if (r.kind !== 'context') { res.status(r.status || 400).json({ ok: false, error: 'テナントを選択してください' }); return; }
      ctx = r.context;
    } catch {
      res.status(500).json({ ok: false, error: 'resolve failed' });
      return;
    }
    // owner ロールだけ書き込みを通す（MVP は owner のみ）。
    if (ctx.role !== 'owner') { res.status(403).json({ ok: false, error: '編集権限がありません' }); return; }
    // 入力検証の失敗（クライアント起因）は 400、Firestore 書き込みの失敗（サーバ起因）は 500 に分ける。
    let ov;
    try {
      ov = sanitizeOverride(req.body);
    } catch (e) {
      res.status(400).json({ ok: false, error: e && e.message ? e.message : String(e) });
      return;
    }
    try {
      // 対象 date は必ず解決済み tenantId 配下へ書く（越境チェック＝パスで担保・design §8）。
      await dbInstance.collection('tenants').doc(ctx.tenantId).collection('overrides').doc(ov.date).set(ov);
      localUpsert(ctx.tenantId, ov); // エミュレータでは再起動でも残るようローカルへも書き写す（本番は no-op）
      res.json({ ok: true, date: ov.date, override: ov }); // 正規化後を返す（クライアントの表示・書き出しと一致させる）
    } catch {
      res.status(500).json({ ok: false, error: 'save failed' });
    }
  });
  appServer.post('/api/override/delete', json, async (req, res) => {
    let ctx;
    try {
      const r = await resolveRequestTenant(dbInstance, req, { forWrite: true });
      if (r.kind === 'auth') { res.status(401).json({ ok: false, error: 'サインインが必要です' }); return; }
      if (r.kind === 'none') { res.status(403).json({ ok: false, error: 'テナントがありません' }); return; }
      if (r.kind !== 'context') { res.status(r.status || 400).json({ ok: false, error: 'テナントを選択してください' }); return; }
      ctx = r.context;
    } catch {
      res.status(500).json({ ok: false, error: 'resolve failed' });
      return;
    }
    if (ctx.role !== 'owner') { res.status(403).json({ ok: false, error: '編集権限がありません' }); return; }
    const date = String((req.body && req.body.date) || '');
    if (!DATE_DOC_ID.test(date)) {
      res.status(400).json({ ok: false, error: 'date must be YYYY-MM-DD' });
      return;
    }
    try {
      await dbInstance.collection('tenants').doc(ctx.tenantId).collection('overrides').doc(date).delete();
      localRemove(ctx.tenantId, date); // ローカル退避からも消す（本番は no-op）
      res.json({ ok: true, date });
    } catch {
      res.status(500).json({ ok: false, error: 'delete failed' });
    }
  });

  // ── チームカラー設定の保存（テナント設定スコープ＝isAdmin ゲート）────────────────
  // 認証・テナント解決は /api/override と同型（resolveRequestTenant→kind 分岐）。差分は3点:
  //   (a) owner ロールでなく管理者フラグ isAdmin を要求する（テナント設定は招待発行=isSuperAdmin・
  //       上書き保存=owner と直交する第3系統）。
  //   (b) themeKey をプリセット集合 THEME_KEYS にコード厳密判定（集合外は 400・LLM不要）。
  //   (c) overrides サブコレクションでなく tenants/{tid} doc 本体へ themeKey を merge 書き込み。
  appServer.post('/api/tenant/theme', json, async (req, res) => {
    let ctx;
    try {
      const r = await resolveRequestTenant(dbInstance, req, { forWrite: true });
      if (r.kind === 'auth') { res.status(401).json({ ok: false, error: 'サインインが必要です' }); return; }
      if (r.kind === 'none') { res.status(403).json({ ok: false, error: 'テナントがありません' }); return; }
      if (r.kind !== 'context') { res.status(r.status || 400).json({ ok: false, error: 'テナントを選択してください' }); return; }
      ctx = r.context;
    } catch {
      res.status(500).json({ ok: false, error: 'resolve failed' });
      return;
    }
    // 認可（isAdmin・403）＋入力検証（集合外themeKey・400）はコード側の純判定に閉じる。
    const decision = themeWriteDecision(ctx, req.body);
    if (!decision.ok) { res.status(decision.status).json({ ok: false, error: decision.error }); return; }
    try {
      // 対象は必ず解決済み tenantId 配下（越境はパスで担保＝/api/override と同じ作法）。
      await dbInstance.collection('tenants').doc(ctx.tenantId).set({ themeKey: decision.themeKey }, { merge: true });
      res.json({ ok: true, themeKey: decision.themeKey });
    } catch {
      res.status(500).json({ ok: false, error: 'save failed' });
    }
  });
}

const server = express();
mountWriteApi(server, db);

// ── 認証不要の静的画面（design §6）─────────────────────────────────────────────
// /login・/join はテナント解決を通さない（クライアントが sign-in / lookup / accept を駆動する）。
server.get('/login', (_req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8').send(loginPageHtml(WEB_CONFIG));
});
server.get('/join', (_req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8').send(joinPageHtml(WEB_CONFIG));
});
// テナント未所有の承諾待ち画面。認証は要るがテナント解決は通さない（在籍0の正常状態のため、
// GET '*' に流すと /onboarding へ無限リダイレクトする）。本番のみ表示し、未ログインは /login へ。
server.get('/onboarding', async (req, res) => {
  if (ENFORCE_AUTH) {
    const session = await verifySession(req.headers.cookie, { checkRevoked: false });
    if (!session) { res.redirect(302, '/login'); return; }
  }
  res.set('Content-Type', 'text/html; charset=utf-8').send(renderPage({
    title: '承諾待ち',
    css: '',
    body: '<div class="wrap"><h1>まだチームがありません</h1><p>招待リンクを受け取ったら、そのリンクを開いて承諾してください。承諾するとあなた専用のチームが用意されます。</p></div>',
  }));
});

// 全リクエストで HTML を返す。?p=<patternId> で描画パターンを選ぶ（既定 timeline）。
server.get('*', async (req, res) => {
  try {
    // テナント解決（読み：失効確認なし＝TTFB 優先・design §7-a）。
    let resolved;
    try {
      resolved = await resolveRequestTenant(db, req, { forWrite: false });
    } catch {
      res.status(500).set('Content-Type', 'text/plain; charset=utf-8').send('render error: tenant resolve');
      return;
    }
    if (resolved.kind === 'auth') { res.redirect(302, '/login'); return; }
    if (resolved.kind === 'none') { res.redirect(302, '/onboarding'); return; }
    if (resolved.kind === 'choose') {
      // 複数在籍：在籍テナントから表示対象を選ぶ画面（?t で再アクセスさせる）。
      res.set('Content-Type', 'text/html; charset=utf-8').send(tenantPickerHtml({ tenants: resolved.memberships }));
      return;
    }
    const ctx = resolved.context;

    // 未初期化テナント（叩き台未投入）は、まず冪等に再初期化を試みる（accept 時の初期化失敗の自己修復）。
    // 再初期化も失敗したときだけ「準備中」を出す（本番・ローカル共通＝ローカルでも生の 500 を出さない）。
    const tenantSnap = await db.collection('tenants').doc(ctx.tenantId).get();
    let tenant = tenantSnap.exists ? tenantSnap.data() : null;
    if (tenant && tenant.initialized === false) {
      try {
        await initializeTenant(db, ctx.tenantId); // 冪等（決定論 doc ID への set）。
        const re = await db.collection('tenants').doc(ctx.tenantId).get();
        tenant = re.exists ? re.data() : tenant;
      } catch { /* 再初期化失敗は下の「準備中」で扱う（生の 500 にしない） */ }
      if (!tenant || tenant.initialized !== true) {
        res.set('Content-Type', 'text/html; charset=utf-8')
          .send(renderPage({ title: '準備中', css: '', body: '<div class="wrap"><h1>準備中</h1><p>計画の叩き台を準備しています。少し待ってから再読み込みしてください。</p></div>' }));
        return;
      }
    }
    const schoolName = tenant && typeof tenant.name === 'string' ? tenant.name : undefined;

    const storage = createFirestoreStorage({ db, tenantId: ctx.tenantId, teamId: BOYS_TEAM });
    const girlsStorage = createFirestoreStorage({ db, tenantId: ctx.tenantId, teamId: GIRLS_TEAM });

    const data = await buildPlanData({ storage, girlsStorage, school: schoolName });

    const patternId = typeof req.query.p === 'string' && /^[a-z-]+$/.test(req.query.p)
      ? req.query.p
      : 'timeline';
    const mod = await import(`../ui/pattern-${patternId}.mjs`).catch(() => null);
    if (!mod || typeof mod.render !== 'function') {
      res.status(404).set('Content-Type', 'text/plain; charset=utf-8')
        .send(`unknown pattern: ${patternId}`);
      return;
    }

    const { css, body } = mod.render(data);
    // チームカラー: テナントの themeKey（未設定→既定オレンジ）でアクセント主色を末尾カスケード上書き。
    // 末尾連結で BASE_CSS の :root（既定オレンジ）に勝たせる（design §3.2・既定/未知キーは空文字）。
    const themeKey = tenant && typeof tenant.themeKey === 'string' ? tenant.themeKey : 'orange';
    const themeCss = themeOverrideCss(themeKey);
    // 本番だけ認証UI（ログイン状態表示＋ログアウト＋セッション再確立＋__getIdToken）を本体に差し込む。
    // 管理者には歯車＋16色パネルも出す（isAdmin・現テーマを渡す。非管理者はメール＋ログアウトのみ）。
    const html = renderPage({
      title: `${data.school} ${data.month}月 練習メニュー（男子・女子） — ${mod.meta?.name || patternId}`,
      css: css + themeCss + (ENFORCE_AUTH ? AUTH_CSS : ''),
      body: body + (ENFORCE_AUTH ? authClientHtml(WEB_CONFIG, { isAdmin: ctx.isAdmin === true, themeKey }) : ''),
    });
    res.set('Content-Type', 'text/html; charset=utf-8').send(html);
  } catch (e) {
    res.status(500).set('Content-Type', 'text/plain; charset=utf-8')
      .send(`render error: ${e && e.message ? e.message : String(e)}`);
  }
});

// Hosting からの全リクエストを受ける単一関数。
export const render = onRequest(
  { region: REGION, timeoutSeconds: 120, memory: '512MiB', maxInstances: 10 },
  server,
);
