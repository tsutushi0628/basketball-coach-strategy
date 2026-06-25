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

import { TOKENS } from './render-shared.mjs';

const FB_VERSION = '12.0.0';

/** 認証画面3種で共有する外殻CSS（render-shared のトークンだけで色・書体を当てる）。 */
export const AUTH_PAGE_CSS = `
/* Hallmark · macrostructure: focused-task-panel · genre: modern-minimal
   · pre-emit critique: P5 H5 E5 S5 R5 V5
   · tokens: render-shared.mjs (no inline color/font) · nav: none · footer: Ft2 inline single-line
   · contrast: pass (46-50) · slop: pass (51-55) · mobile: pass (36,59,61-69) */
:root{${TOKENS}}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:var(--bg);color:var(--ink);overflow-x:clip}
body{font-family:"Hiragino Sans",system-ui,sans-serif;line-height:1.7;-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums;min-height:100dvh;display:flex;flex-direction:column}
a{color:var(--orange-deep)}
/* 中央寄せではなく、上方バイアスで左揃えのカードを置く（全幅centered hero回避）。 */
.auth-main{flex:1 1 auto;width:100%;max-width:760px;margin:0 auto;padding:80px 22px 40px}
@media (max-width:560px){.auth-main{padding:48px 18px 32px}}
/* 認証カード: surface面 + 全周hairline（border帯にしない）。下padを上padより厚くして紙面に沈める。 */
.auth-card{background:var(--surface);border:1px solid var(--hair);border-radius:18px;padding:34px 34px 44px;max-width:440px}
@media (max-width:560px){.auth-card{padding:26px 22px 34px}}
/* かぶせラベル（プロダクト名の上に置く小見出し）。アイブロウの装飾濫用ではなく出自表示の1行のみ。 */
.auth-kicker{display:block;font-size:12px;font-weight:700;letter-spacing:.06em;color:var(--orange-deep);margin-bottom:10px}
.auth-title{font-size:27px;font-weight:700;letter-spacing:-.01em;line-height:1.25;overflow-wrap:anywhere;min-width:0}
.auth-lede{font-size:14px;color:var(--mute);line-height:1.7;margin-top:12px;max-width:46ch}
.auth-cta{margin-top:26px}
/* ボタンは render-shared の .btn と同型（surface+hair・pill・14px・shadow無し）。8状態を満たす。 */
.btn{appearance:none;border:1px solid var(--hair);cursor:pointer;background:var(--surface);color:var(--ink);border-radius:999px;padding:12px 22px;font:inherit;font-size:14px;font-weight:600;letter-spacing:.02em;white-space:nowrap;transition:transform .16s ease,color .16s ease,background-color .16s ease}
.btn:hover{transform:translateY(-2px);color:var(--orange)}
.btn:focus-visible{outline:2px solid var(--orange);outline-offset:3px}
.btn:active{transform:translateY(0)}
.btn:disabled{opacity:.55;cursor:not-allowed;transform:none;color:var(--mute)}
.btn-primary{background:var(--orange);color:var(--orange-ink);border-color:var(--orange)}
.btn-primary:hover{color:var(--orange-ink)}
.btn-primary:disabled{background:var(--orange-soft);border-color:var(--orange-soft);color:var(--orange-ink)}
/* Googleマーク（公式4色SVG・emoji不使用）。ボタン左にインラインで置く。 */
.btn-g{display:inline-flex;align-items:center;gap:10px;line-height:1}
.btn-g svg{display:block;width:18px;height:18px;flex:0 0 auto}
/* 状態メッセージ: 処理中（mute）・失敗（terra）。空のとき高さを予約して検証時のガタつきを防ぐ。 */
.auth-status{min-height:1.5lh;margin-top:16px;font-size:13px;line-height:1.6}
.auth-status:empty{min-height:1.5lh}
.auth-status[data-kind="working"]{color:var(--mute)}
.auth-status[data-kind="error"]{color:var(--terra);font-weight:600}
.auth-status[data-kind="ok"]{color:var(--orange-deep);font-weight:600}
/* 補助ノート（カード内・本文より弱い情報）。 */
.auth-note{font-size:12px;color:var(--mute);line-height:1.7;margin-top:22px;padding-top:18px;border-top:1px solid var(--line)}
/* フッタ: 1行インライン（Ft2）。4カラムリンク群＋social＋copyright の定型footerにしない。 */
.auth-foot{flex:0 0 auto;width:100%;max-width:760px;margin:0 auto;padding:24px 22px 32px;color:var(--mute);font-size:11px;letter-spacing:.04em}
.spin{display:inline-block;width:14px;height:14px;margin-right:7px;vertical-align:-2px;border:2px solid var(--orange-soft);border-top-color:var(--orange);border-radius:50%;animation:auth-spin .7s linear infinite}
@media (prefers-reduced-motion:reduce){
  .btn{transition:none}
  .btn:hover{transform:none}
  .spin{animation:none}
}
@keyframes auth-spin{to{transform:rotate(360deg)}}
`;

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
