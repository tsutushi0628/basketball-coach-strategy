/**
 * @file 招待承諾画面（SSRが認証不要で配信する完全HTML）。
 *
 * 登録は招待リンク制。コーチは `/join?token=<raw>` を開き、この画面が:
 *   1. URL の ?token を読む（無ければ「無効なリンク」状態）。
 *   2. POST /api/invitations/lookup { token } で有効性を確認（応答 {valid, kind, expired}、
 *      任意で {accepted|status} があれば「承諾済み」も区別する）。
 *   3. 有効なら Google sign-in（既存 auth-client.mjs の CDN 1コピー方式を踏襲）→ ID トークンで
 *      セッションを張り、POST /api/invitations/accept { token } で自テナントを払い出す。
 *   4. 成功で自テナントの計画 `/` へ遷移。
 *
 * 全状態を画面に持つ: 確認中 / 有効（参加ボタン）/ 期限切れ / 無効 / 承諾済み / 処理中 / 失敗。
 * accept は GET ナビゲーションでなく fetch なので Cookie に頼らず ID トークンも Bearer で添える
 * （サーバが session でも Bearer でも本人解決できるよう両方渡す。Cookie は credentials で同送）。
 *
 * デザインは render-shared.mjs のトークンに完全準拠（login.mjs と同じ AUTH_PAGE_CSS を共有）。
 * Hallmark NG（border帯・emoji・汎用書体・gradient・全幅centered hero・定型ナビ・偽chrome）は不使用。
 */

import { AUTH_PAGE_CSS, GOOGLE_MARK_SVG } from './login.mjs';

const FB_VERSION = '12.0.0';

/** HTMLエスケープ。 */
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * 招待承諾画面の完全HTML文字列を返す。
 * @param {{apiKey:string, authDomain:string, projectId:string}} cfg 公開Web設定（秘密ではない）
 * @returns {string} 完全な HTML 文書
 */
export function joinPageHtml(cfg) {
  if (!cfg || !cfg.apiKey || !cfg.authDomain || !cfg.projectId) {
    throw new Error('joinPageHtml: cfg.apiKey / authDomain / projectId が必須です');
  }
  const json = JSON.stringify({ apiKey: cfg.apiKey, authDomain: cfg.authDomain, projectId: cfg.projectId })
    .replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>招待を受ける — 練習計画</title>
<style>${AUTH_PAGE_CSS}</style>
</head>
<body>
<main class="auth-main">
  <section class="auth-card">
    <span class="auth-kicker">練習計画ツール</span>
    <h1 class="auth-title" id="join-title">招待を確認しています</h1>
    <p class="auth-lede" id="join-lede">リンクの有効性を確認しています。少しお待ちください。</p>
    <div class="auth-cta" id="join-cta" hidden>
      <button class="btn btn-primary btn-g" id="join-go" type="button">
        ${GOOGLE_MARK_SVG}<span>Googleで参加する</span>
      </button>
    </div>
    <p class="auth-status" id="join-status" role="status" aria-live="polite"></p>
    <p class="auth-note" id="join-note">参加すると、あなたのチームの練習計画が新しく用意されます。職員のGoogleアカウントで参加してください。</p>
  </section>
</main>
<footer class="auth-foot">${esc(cfg.projectId)} ・ 練習計画ツール</footer>
<script type="module">
import { initializeApp } from 'https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup } from 'https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-auth.js';
const cfg = ${json};
const auth = getAuth(initializeApp(cfg));

const titleEl = document.getElementById('join-title');
const ledeEl = document.getElementById('join-lede');
const ctaEl = document.getElementById('join-cta');
const btn = document.getElementById('join-go');
const statusEl = document.getElementById('join-status');
const noteEl = document.getElementById('join-note');

function setStatus(kind, text){
  if(!kind){ statusEl.removeAttribute('data-kind'); statusEl.textContent=''; return; }
  statusEl.setAttribute('data-kind', kind);
  statusEl.innerHTML = (kind === 'working' ? '<span class="spin" aria-hidden="true"></span>' : '') + text;
}
// 画面の主状態を1関数で切り替える（確認中/有効/期限切れ/無効/承諾済み/失敗）。処理中は status 行で重ねる。
function setView(view, opts){
  const o = opts || {};
  if(view === 'checking'){
    titleEl.textContent = '招待を確認しています';
    ledeEl.textContent = 'リンクの有効性を確認しています。少しお待ちください。';
    ctaEl.hidden = true; setStatus(null);
    return;
  }
  if(view === 'valid'){
    titleEl.textContent = 'チームに参加する';
    ledeEl.textContent = 'この招待は有効です。Googleアカウントで参加すると、あなたのチームの練習計画が用意されます。';
    ctaEl.hidden = false; btn.disabled = false; setStatus(null);
    return;
  }
  if(view === 'expired'){
    titleEl.textContent = 'リンクの期限が切れています';
    ledeEl.textContent = 'この招待リンクは有効期限を過ぎています。管理者に新しいリンクの発行を依頼してください。';
    ctaEl.hidden = true; noteEl.hidden = true; setStatus(null);
    return;
  }
  if(view === 'invalid'){
    titleEl.textContent = 'リンクが無効です';
    ledeEl.textContent = 'この招待リンクは確認できませんでした。リンクが正しいかご確認のうえ、管理者にお問い合わせください。';
    ctaEl.hidden = true; noteEl.hidden = true; setStatus(null);
    return;
  }
  if(view === 'accepted'){
    titleEl.textContent = 'すでに参加済みです';
    ledeEl.textContent = 'この招待はすでに使われています。ログインして計画を開いてください。';
    ctaEl.hidden = true; noteEl.hidden = true;
    setStatus('ok', '<a href="/login">ログイン画面へ</a>');
    return;
  }
  if(view === 'error'){
    titleEl.textContent = '確認できませんでした';
    ledeEl.textContent = '通信に問題が起きました。電波の良い場所で、もう一度開き直してください。';
    ctaEl.hidden = true;
    setStatus('error', (o.message || '時間をおいて再度お試しください。'));
    return;
  }
}

function getToken(){
  const params = new URLSearchParams(window.location.search);
  const t = params.get('token');
  return t ? t.trim() : '';
}
const token = getToken();

async function lookup(){
  const res = await fetch('/api/invitations/lookup', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    credentials:'same-origin',
    body: JSON.stringify({ token: token }),
  });
  if(!res.ok) throw new Error('lookup failed: '+res.status);
  return res.json();
}
// lookup 応答 {valid, kind, expired}（任意で accepted|status）から表示状態を決める（判定はコード側）。
function viewFromLookup(r){
  const isAccepted = r.reason === 'accepted' || r.accepted === true || r.status === 'accepted';
  if(isAccepted) return 'accepted';
  if(r.expired === true) return 'expired';
  if(r.valid === true) return 'valid';
  return 'invalid';
}

async function establishSession(idToken){
  const res = await fetch('/api/session/login', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    credentials:'same-origin',
    body: JSON.stringify({ idToken: idToken }),
  });
  if(!res.ok) throw new Error('session login failed: '+res.status);
}
async function accept(idToken){
  const res = await fetch('/api/invitations/accept', {
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+idToken},
    credentials:'same-origin',
    body: JSON.stringify({ token: token }),
  });
  if(!res.ok){
    let detail = '';
    try{ const j = await res.json(); detail = (j && j.error) ? j.error : ''; }catch(_){ detail = ''; }
    const err = new Error('accept failed: '+res.status);
    err.status = res.status;
    err.detail = detail;
    throw err;
  }
  return res.json().catch(function(){ return {}; });
}

async function doJoin(){
  btn.disabled = true;
  setStatus('working', '参加手続きをしています…');
  try{
    const cred = await signInWithPopup(auth, new GoogleAuthProvider());
    const idToken = await cred.user.getIdToken();
    // 先にセッションを張ってから accept（accept 後のルート遷移が Cookie で本人解決されるように）。
    await establishSession(idToken);
    const out = await accept(idToken);
    setStatus('ok', '計画を準備しています…');
    // サーバがテナントを返せば ?t= 付きで、無ければ素のルートへ（サーバが所属解決する）。
    const tenantId = out && out.tenantId ? ('/?t=' + encodeURIComponent(out.tenantId)) : '/';
    window.location.assign(tenantId);
  }catch(e){
    btn.disabled = false;
    // サーバは accept 失敗を 400＋メッセージ（期限切れ/消費済み/不正）、未検出を 404 で返す。
    // lookup→クリックの間に期限切れ・消費されたレースを、メッセージ内容で状態画面へ寄せる。
    const d = (e && e.detail) ? String(e.detail) : '';
    if(d.indexOf('期限') >= 0){ setView('expired'); return; }
    if(d.indexOf('accepted') >= 0 || d.indexOf('状態') >= 0){ setView('accepted'); return; }
    if(e && e.status === 404){ setView('invalid'); return; }
    setStatus('error', d || '参加できませんでした。もう一度お試しください。');
  }
}
btn.addEventListener('click', doJoin);

// 起動: token が無ければ即「無効」、あれば lookup して状態を決める。
async function init(){
  if(!token){ setView('invalid'); return; }
  setView('checking');
  try{
    const r = await lookup();
    setView(viewFromLookup(r));
  }catch(e){
    setView('error');
  }
}
init();
</script>
</body>
</html>`;
}
