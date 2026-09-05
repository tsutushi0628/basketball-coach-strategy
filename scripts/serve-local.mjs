/**
 * @file ローカルNode起動（本番Firestore・ADC接続）。
 *
 * オーナー裁定: 「エミュレータはいらん。ローカル実行しつつデータだけ本番使え」。
 * Firestoreエミュレータ（Java必須・本環境に無し）を使わず、functions/index.mjs の
 * onRequest ハンドラ（実体は express の `server`）をプレーンな Node の HTTP サーバから直接呼び、
 * Firestore は本番プロジェクト ai-bb-coach へ ADC（このマシンの gcloud/firebase ログイン資格）で
 * 接続する。firebase-functions v2 の `onRequest()` が返す関数は `(req, res) => ...` として
 * 直に呼べる（内部で withErrorHandler/withInit を被せた express アプリの呼び出しに委譲するだけ）
 * ため、index.mjs 自体には一切手を入れない。
 *
 * 安全弁:
 *   - GCLOUD_PROJECT=ai-bb-coach をこのプロセスにだけ設定する（他スクリプト・エミュレータ実行に
 *     波及しない）。FIRESTORE_EMULATOR_HOST は設定しない＝index.mjs の IS_EMULATOR は false になり、
 *     ALLOW_UNAUTH（無認証フォールバック）には絶対に入らない（fail-secure）。つまり本番同様、
 *     GET はセッションCookieが無ければ /login へリダイレクト、書き込みAPIは 401 になる。
 *   - decide・sync は「本番書き込み」なのでこのスクリプトからは叩かない（オーナーの y/n 後、
 *     別の確認ステップで行う）。GET と split（読み取りのみ）の確認に使う想定。
 *   - ADC が無い/期限切れなら `render()` 内の Firestore 呼び出しが例外を投げ 500 になるだけで、
 *     このスクリプト自身はログイン等の副作用を一切起こさない（自分でログインしない）。
 *     事前に `gcloud auth application-default print-access-token` か `firebase login:list` で
 *     ADC の有無を確認してから起動すること。
 *
 * このPCでの本番実行前提: `GOOGLE_APPLICATION_CREDENTIALS` にリポ外の ADC（個人アカウントの
 * authorized_user 資格）、`GOOGLE_CLOUD_QUOTA_PROJECT=ai-bb-coach` を環境変数で与えれば、対話
 * ログイン無しに本番 Firestore へ接続できる（.spec-workflow/specs/scrimmage-split/tasks.md
 * の運用節参照）。
 *
 * 使い方: `node scripts/serve-local.mjs`（既定ポート 5173、`PORT` 環境変数で変更可）。
 */

import { createServer } from 'node:http';

process.env.GCLOUD_PROJECT = 'ai-bb-coach';
// Admin SDK 初期化コードの一部は GOOGLE_CLOUD_PROJECT も見るため揃えておく（index.mjs は
// GCLOUD_PROJECT だけを読むが、ADC 側のプロジェクト解決を安定させる目的で両方セットする）。
process.env.GOOGLE_CLOUD_PROJECT = 'ai-bb-coach';
if (process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('SERVE-LOCAL FAIL: FIRESTORE_EMULATOR_HOST が設定されています（本番ADC接続と競合するため未設定で実行してください）');
  process.exit(1);
}

const PORT = Number(process.env.PORT || 5173);

const { render } = await import('../functions/index.mjs');

const httpServer = createServer((req, res) => {
  render(req, res);
});

httpServer.listen(PORT, '127.0.0.1', () => {
  console.log(`SERVE-LOCAL OK: http://127.0.0.1:${PORT} （project=ai-bb-coach・Firestore本番・ADC接続）`);
  console.log('  未ログインは GET / で /login へリダイレクト、書き込みAPIは 401 になるのが正常（fail-secure）');
});
