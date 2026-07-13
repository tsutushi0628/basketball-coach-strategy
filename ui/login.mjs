/**
 * @file ログイン画面（SSRが認証不要で配信する完全HTML）。
 *
 * マルチテナント化で「閲覧もログイン必須」になるため、未ログインのGETはサーバが /login へ流す。
 * この画面は Google sign-in（既存 auth-client.mjs の CDN 1コピー方式を踏襲）→ ID トークンを
 * POST /api/session/login して __session Cookie を確立 → `/` へ遷移する、だけを担う。
 *
 * デザインは render-shared.mjs のトークン（クリーム地＋オレンジ・Hiragino Sans・shadow無し・
 * hairline罫線・pillボタン）に完全準拠。Hallmark NG（border帯・emoji・汎用書体・紫ピンク
 * gradient・gradient見出し・全幅centered hero・定型ナビ・偽chrome）は持ち込まない。
 *
 * 状態: 待機（ボタン表示）／処理中（ログイン中…）／失敗（再試行可・エラー文言）。
 */

import { loadCssWithTokens } from './render-shared.mjs';

const FB_VERSION = '12.0.0';

/** 認証画面3種で共有する外殻CSS（render-shared のトークンだけで色・書体を当てる）。実体は styles/auth-page.css。 */
export const AUTH_PAGE_CSS = loadCssWithTokens(import.meta.url, 'styles/auth-page.css');

/** Google公式4色マーク（SVG・emoji不使用・1ライブラリ内）。 */
export const GOOGLE_MARK_SVG =
  '<svg viewBox="0 0 18 18" aria-hidden="true">' +
  '<path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62z"/>' +
  '<path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/>' +
  '<path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z"/>' +
  '<path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/>' +
  '</svg>';

/** HTMLエスケープ（render-shared と同等・ここで自己完結させる）。 */
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * ログイン画面の完全HTML文字列を返す。
 * @param {{apiKey:string, authDomain:string, projectId:string}} cfg 公開Web設定（秘密ではない）
 * @returns {string} 完全な HTML 文書
 */
export function loginPageHtml(cfg) {
  if (!cfg || !cfg.apiKey || !cfg.authDomain || !cfg.projectId) {
    throw new Error('loginPageHtml: cfg.apiKey / authDomain / projectId が必須です');
  }
  const json = JSON.stringify({ apiKey: cfg.apiKey, authDomain: cfg.authDomain, projectId: cfg.projectId })
    .replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>ログイン — 練習計画</title>
<style>${AUTH_PAGE_CSS}</style>
</head>
<body>
<main class="auth-main">
  <section class="auth-card">
    <span class="auth-kicker">練習計画ツール</span>
    <h1 class="auth-title">ログインして計画を開く</h1>
    <p class="auth-lede">男女2チームの練習メニューは、ログインしたコーチだけが見られます。職員のGoogleアカウントでログインしてください。</p>
    <div class="auth-cta">
      <button class="btn btn-primary btn-g" id="login-go" type="button">
        ${GOOGLE_MARK_SVG}<span>Googleでログイン</span>
      </button>
    </div>
    <p class="auth-status" id="login-status" role="status" aria-live="polite"></p>
    <p class="auth-note">招待リンクをお持ちの方は、そのリンクから参加手続きを進めてください。リンクが無い場合は管理者にお問い合わせください。</p>
  </section>
</main>
<footer class="auth-foot">${esc(cfg.projectId)} ・ 練習計画ツール</footer>
<script type="module">
import { initializeApp } from 'https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup } from 'https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-auth.js';
const cfg = ${json};
const auth = getAuth(initializeApp(cfg));
const btn = document.getElementById('login-go');
const status = document.getElementById('login-status');
function setStatus(kind, text){
  status.setAttribute('data-kind', kind);
  status.innerHTML = (kind === 'working' ? '<span class="spin" aria-hidden="true"></span>' : '') + text;
}
function clearStatus(){ status.removeAttribute('data-kind'); status.textContent=''; }
// ID トークンを login API へ送り、サーバに __session Cookie を張らせる（SSRの本人性運搬）。
async function establishSession(idToken){
  const res = await fetch('/api/session/login', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    credentials:'same-origin',
    body: JSON.stringify({ idToken: idToken }),
  });
  if(!res.ok) throw new Error('session login failed: '+res.status);
}
async function doLogin(){
  btn.disabled = true;
  setStatus('working', 'ログインしています…');
  try{
    const cred = await signInWithPopup(auth, new GoogleAuthProvider());
    const idToken = await cred.user.getIdToken();
    await establishSession(idToken);
    setStatus('ok', '計画を開いています…');
    window.location.assign('/');
  }catch(e){
    btn.disabled = false;
    setStatus('error', 'ログインできませんでした。もう一度お試しください。');
  }
}
btn.addEventListener('click', doLogin);
</script>
</body>
</html>`;
}
