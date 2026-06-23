/**
 * @file Cloud Functions エントリポイント（HTML を返す単一 HTTPS 関数）。
 *
 * firebase-kit 基盤ルール:
 *   - 全データ操作は Cloud Functions（Admin SDK）経由のみ。クライアントから Firestore へ直アクセス禁止
 *     （firestore.rules で全 deny。Admin SDK はルールをバイパスするので Function からは読める）。
 *   - LLM 呼び出しなし（エンジンは決定論）。
 *
 * 実装方針（描画ロジックは書き直さない）:
 *   既存の純関数 buildPlanData() に Firestore storage を注入し、既存レンダラ pattern-*.mjs の
 *   render() と build.mjs の renderPage() をそのまま呼んで HTML を返す。エンジン(engine/src)・
 *   描画(ui/*.mjs)は一切改変せず再利用する。
 *
 * 注（クラウド本番デプロイ時の packaging）:
 *   この関数は ../engine ../ui を相対 import する。firebase.json の functions.source=functions のため
 *   実デプロイ時は engine/ui を functions 配下へ vendoring する必要がある（本回はエミュレータ検証のみ・
 *   エミュレータは実ファイルシステムを辿るので相対 import で動く）。
 */

import { onRequest } from 'firebase-functions/v2/https';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import express from 'express';

import { createFirestoreStorage } from '../engine/src/storage.js';
import { buildPlanData } from '../ui/plan-data.mjs';
import { renderPage } from '../ui/build.mjs';

// プロジェクト設定（本番確定後に projectId を差し替え。エミュレータはダミー projectId で動く）。
const PROJECT_ID = process.env.GCLOUD_PROJECT || 'demo-basketball-strategy';
const DATABASE_NAME = 'basketball-strategy-db';
const REGION = 'asia-northeast1';
const BOYS_TEAM = 'minami-nakano-boys';
const GIRLS_TEAM = 'minami-nakano-girls';

// Admin SDK 初期化（DEFAULT app を1度だけ）。
// FIRESTORE_EMULATOR_HOST が立っていれば getFirestore は自動でエミュレータに接続する。
const app = getApps().length ? getApps()[0] : initializeApp({ projectId: PROJECT_ID });
const db = getFirestore(app, DATABASE_NAME);

const DATE_DOC_ID = /^\d{4}-\d{2}-\d{2}$/;

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
    const row = { from: str(r && r.from, 5), to: str(r && r.to, 5) };
    if (typeof r.minutes === 'number' && r.minutes >= 0) row.minutes = Math.floor(r.minutes);
    const both = cell(r && r.both);
    if (both) { row.both = both; } else {
      const boys = cell(r && r['男子']); const girls = cell(r && r['女子']);
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

/**
 * 書き込みAPI（コーチ上書きの保存/削除）を express サーバへマウントする。
 * db は依存注入（本番は Admin SDK の Firestore、テストはモック db）。書き込みは
 * Function/Admin SDK 経由のみ＝クライアント直書きは rules で全 deny。
 * 注: 認証なし＝本番公開前にコーチ認証 or 共有シークレットの付与が必須（abuse 防止）。
 * @param {import('express').Express} appServer
 * @param {{collection:Function}} dbInstance  Firestore 互換（collection().doc().set()/delete()）
 */
export function mountWriteApi(appServer, dbInstance) {
  appServer.use(express.json({ limit: '256kb' }));
  appServer.get('/healthz', (_req, res) => {
    res.json({ status: 'ok', database: DATABASE_NAME });
  });
  appServer.post('/api/override', async (req, res) => {
    try {
      const ov = sanitizeOverride(req.body);
      await dbInstance.collection('overrides').doc(ov.date).set(ov);
      res.json({ ok: true, date: ov.date });
    } catch (e) {
      res.status(400).json({ ok: false, error: e && e.message ? e.message : String(e) });
    }
  });
  appServer.post('/api/override/delete', async (req, res) => {
    try {
      const date = String((req.body && req.body.date) || '');
      if (!DATE_DOC_ID.test(date)) throw new Error('date must be YYYY-MM-DD');
      await dbInstance.collection('overrides').doc(date).delete();
      res.json({ ok: true, date });
    } catch (e) {
      res.status(400).json({ ok: false, error: e && e.message ? e.message : String(e) });
    }
  });
}

const server = express();
mountWriteApi(server, db);

// 全リクエストで HTML を返す。?p=<patternId> で描画パターンを選ぶ（既定 timeline）。
server.get('*', async (req, res) => {
  try {
    const storage = createFirestoreStorage({ db, teamId: BOYS_TEAM });
    const girlsStorage = createFirestoreStorage({ db, teamId: GIRLS_TEAM });

    const data = await buildPlanData({ storage, girlsStorage });

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
    const html = renderPage({
      title: `${data.school} ${data.month}月 練習メニュー（男子・女子） — ${mod.meta?.name || patternId}`,
      css,
      body,
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
