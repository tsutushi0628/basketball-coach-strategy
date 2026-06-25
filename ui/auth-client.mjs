/**
 * @file 本番限定の編集ログイン（Google）クライアント。
 *
 * 設計（兄弟 ai-basketball-coach の作法に合わせる）:
 *   - 認証は本番だけ。ローカル(emulator)では一切ログイン不要＝サーバ側ゲートも素通り。
 *   - E2E は `window.__e2eAuthOverride = { idToken }` を仕込めば Google ポップアップ無しで
 *     書き込み経路を試せる（=「Authつかわなくてもいい口」）。
 *   - firebase は CDN から1コピーだけ読む（二重ロードで Google ログインが壊れる事故を回避）。
 *
 * マルチテナント化（セッションCookie方式）:
 *   - SSR は GET ナビゲーションに Bearer を載せられないため、本人性はセッションCookieで運ぶ。
 *   - Google sign-in 成功 → ID トークンを POST /api/session/login して __session Cookie を確立。
 *     以後のページ遷移（GET 描画）はこの Cookie で本人解決される。
 *   - ログアウトは POST /api/session/logout（サーバが失効＋Cookieクリア）→ /login へ。
 *   - login/logout への fetch は credentials:'same-origin'（Set-Cookie を受け取る・送る）。
 *
 * 露出: window.__getIdToken()（編集の保存・削除が Bearer に付ける。未ログイン/ローカルは null）。
 *       window.__establishSession()（login.mjs・join.mjs から ID トークンでセッションを張る共通口）。
 */

const FB_VERSION = '12.0.0';

/**
 * 本番ページに差し込むログインUI＋ブートストラップ（HTML文字列）。
 * @param {{apiKey:string, authDomain:string, projectId:string}} cfg 公開Web設定（秘密ではない）
 * @returns {string}
 */
export function authClientHtml(cfg) {
  const json = JSON.stringify(cfg).replace(/</g, '\\u003c');
  return `
<div id="ed-auth" class="ed-authbox" data-print-hide></div>
<script type="module">
import { initializeApp } from 'https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-auth.js';
const cfg = ${json};
const auth = getAuth(initializeApp(cfg));
const box = document.getElementById('ed-auth');
let current = null;
// ID トークンを login API へ送り、サーバに __session Cookie を張らせる（SSRの本人性運搬）。
// 失敗時は呼び出し側で扱えるよう reject させる（握りつぶさない）。
async function establishSession(idToken){
  const res = await fetch('/api/session/login', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    credentials:'same-origin',
    body: JSON.stringify({ idToken: idToken }),
  });
  if(!res.ok) throw new Error('session login failed: '+res.status);
  return res;
}
// 他画面（login.mjs/join.mjs）が呼べる共通口。current から取り直してセッションを張る。
window.__establishSession = async function(idToken){
  const token = idToken || (current ? await current.getIdToken() : null);
  if(!token) throw new Error('no id token');
  return establishSession(token);
};
function render(){
  if(!box) return;
  if(window.__e2eAuthOverride){ box.innerHTML = '<span class="ed-authlabel">E2E</span>'; return; }
  if(current){
    box.innerHTML = '<span class="ed-authlabel">'+(current.email||'ログイン中')+'</span>'+
      '<button class="btn" id="ed-signout" type="button" data-print-hide>ログアウト</button>';
    const o=document.getElementById('ed-signout');
    if(o)o.onclick=function(){
      // サーバ側で失効＋Cookieクリアしてから client signOut → /login へ。
      fetch('/api/session/logout', { method:'POST', credentials:'same-origin' })
        .catch(function(){})
        .then(function(){ return signOut(auth); })
        .then(function(){ window.location.assign('/login'); });
    };
  }else{
    box.innerHTML = '<button class="btn btn-primary" id="ed-signin" type="button" data-print-hide>Googleでログイン（編集）</button>';
    const i=document.getElementById('ed-signin');
    if(i)i.onclick=function(){
      signInWithPopup(auth,new GoogleAuthProvider())
        .then(function(cred){ return cred.user.getIdToken(); })
        .then(function(t){ return establishSession(t); })
        .then(function(){ window.location.reload(); })
        .catch(function(e){ alert('ログインに失敗しました: '+(e&&e.message?e.message:e)); });
    };
  }
}
onAuthStateChanged(auth, function(u){
  current=u; render();
  // ログイン中ならセッションCookieを取り直す（約24h失効後の再読込で自動再確立＝サイレント401の予防）。
  if(u){ u.getIdToken().then(function(t){ return establishSession(t); }).catch(function(){}); }
});
render();
// 保存・削除が Bearer に付けるトークン取得口。E2Eは override 優先＝ポップアップ不要。
window.__getIdToken = async function(){
  if(window.__e2eAuthOverride && window.__e2eAuthOverride.idToken) return window.__e2eAuthOverride.idToken;
  return current ? await current.getIdToken() : null;
};
</script>`;
}

/** ログインUIのCSS（本番のみ注入。右上固定・印刷非表示・既存トークンのみ）。 */
export const AUTH_CSS = `
.ed-authbox{position:fixed;top:12px;right:14px;z-index:50;display:inline-flex;align-items:center;gap:8px}
.ed-authbox .ed-authlabel{font-size:12px;font-weight:700;color:var(--orange-deep);background:var(--surface);border:1px solid var(--hair);border-radius:999px;padding:5px 11px}
@media print{.ed-authbox{display:none}}
`;
