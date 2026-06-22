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

const server = express();

server.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', database: DATABASE_NAME });
});

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
