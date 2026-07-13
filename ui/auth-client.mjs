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
 * チームカラー設定（design §3.4）:
 *   - 管理者（isAdmin）のときだけログイン中表示に歯車＋16色パネルを描く。非管理者はメール＋ログアウトのみ。
 *   - スウォッチ押下 → POST /api/tenant/theme（編集の保存と同じ Bearer＋Cookie 経路・?t 引き継ぎ・
 *     401 で1回だけセッション張り直して再送）→ ok で location.reload()、失敗でフッタにエラー＋もう一度。
 *
 * 露出: window.__getIdToken()（編集の保存・削除が Bearer に付ける。未ログイン/ローカルは null）。
 *       window.__establishSession()（login.mjs・join.mjs から ID トークンでセッションを張る共通口）。
 */

import { PRESET_SWATCHES, THEME_KEYS, DEFAULT_THEME_KEY } from './color-presets.mjs';
import { esc } from './render-shared.mjs';
import { loadCss } from './styles/load-css.mjs';

const FB_VERSION = '12.0.0';

/** SVG 線画（歯車・閉じる×・チェック）。emoji 不可・currentColor で色を継ぐ。 */
const GEAR_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 13.5a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V20a2 2 0 0 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H4a2 2 0 0 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H10a1.7 1.7 0 0 0 1.03-1.56V4a2 2 0 0 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V10a1.7 1.7 0 0 0 1.56 1.03H20a2 2 0 0 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.03z"/></svg>';
const CLOSE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const CHECK_SVG = '<svg class="sw-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 13l4 4L19 7"/></svg>';

/**
 * テーマ保存失敗時の利用者向け文言を status から決める純関数（出し分けの単一真実源）。
 * サーバが返した本文 error があればそれを最優先（出し分けの真実源をサーバへ寄せる）。
 *   - サーバ error 文言あり → それをそのまま使う。
 *   - 401 → 再ログインを促す（セッション失効・張り直し再送も失敗した状態）。
 *   - 403 → 権限喪失を伝える（管理者でなくなった等）。
 *   - それ以外（500・ネットワーク断で status 不明等）→ 汎用文言。
 * いずれも「色は元のまま」を明示する（楽観適用しない設計＝失敗時に色が暴れない）。
 * クライアント IIFE はこの関数の本体を埋め込んで使う（node 側でテストした規則と実行時を一致させる＝ドリフト防止）。
 * @param {number} [status] HTTP ステータス（不明時は undefined）
 * @param {string} [serverError] サーバ応答 body の error 文言
 * @returns {string}
 */
export function themeSaveErrorText(status, serverError) {
  if (serverError) return serverError;
  if (status === 401) return 'サインインし直してください。色は元のままです。';
  if (status === 403) return '変更する権限がありません。色は元のままです。';
  return '保存できませんでした。色は元のままです。';
}

/**
 * 学校・チーム名の保存失敗時の利用者向け文言を status から決める純関数（themeSaveErrorText と同型）。
 * サーバが返した本文 error があればそれを最優先（出し分けの真実源をサーバへ寄せる）。
 *   - サーバ error 文言あり → それをそのまま使う。
 *   - 401 → 再ログインを促す（セッション失効・張り直し再送も失敗した状態）。
 *   - 403 → 権限喪失を伝える（管理者でなくなった等）。
 *   - それ以外（500・ネットワーク断で status 不明等）→ 汎用文言。
 * いずれも「名前は元のまま」を明示する（保存成功まで現在名のまま＝失敗時に名前が消えない）。
 * クライアント IIFE はこの関数の本体を埋め込んで使う（node 側でテストした規則と実行時を一致させる＝ドリフト防止）。
 * @param {number} [status] HTTP ステータス（不明時は undefined）
 * @param {string} [serverError] サーバ応答 body の error 文言
 * @returns {string}
 */
export function nameSaveErrorText(status, serverError) {
  if (serverError) return serverError;
  if (status === 401) return 'サインインし直してください。名前は元のままです。';
  if (status === 403) return '変更する権限がありません。名前は元のままです。';
  return '保存できませんでした。名前は元のままです。';
}

/**
 * 16色スウォッチ格子（4列×4行）の HTML を組む。現テーマを aria-pressed="true" にする。
 * スウォッチのキー・表示名・主色・第2色はすべて color-presets.mjs の PRESET_SWATCHES が真実源。
 * 属性値は二重防御で render-shared の共通 esc を通す（&/</>/" を実体参照化）。
 * @param {string} currentThemeKey
 * @returns {string}
 */
function swatchGridHtml(currentThemeKey) {
  return PRESET_SWATCHES.map((s) => {
    const pressed = s.key === currentThemeKey ? 'true' : 'false';
    return `<button class="sw" data-theme="${esc(s.key)}" type="button" aria-pressed="${pressed}"`
      + ` style="--sw-main:${esc(s.main)};--sw-2nd:${esc(s.second)}">`
      + `${CHECK_SVG}<span class="sw-dot"><i class="a"></i><i class="b"></i></span>`
      + `<span class="sw-name">${esc(s.label)}</span></button>`;
  }).join('');
}

/**
 * 本番ページに差し込むログインUI＋ブートストラップ（HTML文字列）。
 * @param {{apiKey:string, authDomain:string, projectId:string}} cfg 公開Web設定（秘密ではない）
 * @param {{isAdmin?:boolean, themeKey?:string, schoolName?:string}} [opts] 管理者なら歯車＋チーム設定パネルを出す。
 *        themeKey は初期選択色、schoolName は学校・チーム名フィールドの初期値。
 * @returns {string}
 */
export function authClientHtml(cfg, opts = {}) {
  const json = JSON.stringify(cfg).replace(/</g, '\\u003c');
  const isAdmin = opts.isAdmin === true;
  const themeKey = typeof opts.themeKey === 'string' && THEME_KEYS.includes(opts.themeKey)
    ? opts.themeKey
    : DEFAULT_THEME_KEY;
  const schoolName = typeof opts.schoolName === 'string' ? opts.schoolName : '';
  // 学校・チーム名セクション（16色スウォッチ格子の上）。管理者のみ＝パネル自体が管理者限定。
  const nameSectionHtml = `<div class="ed-name-sec">`
    + `<span class="ed-name-lab">学校・チーム名</span>`
    + `<div class="ed-name-row">`
    + `<input class="ed-name-in" id="ed-name-input" type="text" maxlength="60" value="${esc(schoolName)}" placeholder="例：港北中">`
    + `<button class="ed-name-save" id="ed-name-save" type="button">保存</button></div>`
    + `<div class="ed-name-foot" id="ed-name-foot"></div></div>`;
  // パネル本体（歯車＋ポップオーバー）は管理者のときだけ描く（design §3.4・モック状態5＝非管理者は非表示）。
  const panelHtml = isAdmin
    ? `<button class="ed-gear" id="ed-gear" type="button" aria-expanded="false" aria-haspopup="dialog" aria-label="チーム設定を変更" data-print-hide>${GEAR_SVG}</button>`
      + `<div class="theme-panel" id="ed-theme-panel" role="dialog" aria-label="チーム設定" hidden data-print-hide>`
      + `<div class="tp-head"><span class="tp-title">チーム設定</span>`
      + `<button class="tp-close" id="ed-tp-close" type="button" aria-label="閉じる">${CLOSE_SVG}</button></div>`
      + nameSectionHtml
      + `<p class="tp-lede">計画ページ全体の主色が変わります。選ぶとすぐに保存されます。</p>`
      + `<div class="tp-swatches" id="ed-tp-swatches">${swatchGridHtml(themeKey)}</div>`
      + `<div class="tp-foot" id="ed-tp-foot"></div></div>`
    : '';
  const bootJson = JSON.stringify({ isAdmin, themeKey, keys: THEME_KEYS }).replace(/</g, '\\u003c');
  return `
<div id="ed-auth" class="ed-authbox" data-print-hide></div>
<script>window.__edThemeBoot = ${bootJson}; window.__edThemePanelHtml = ${JSON.stringify(panelHtml).replace(/</g, '\\u003c')};</script>
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
  if(window.__e2eAuthOverride){ box.innerHTML = '<span class="ed-authlabel">E2E</span>'; window.__edMountThemePanel&&window.__edMountThemePanel(); return; }
  if(current){
    box.innerHTML = '<span class="ed-authlabel">'+(current.email||'ログイン中')+'</span>'+
      (window.__edThemePanelHtml||'')+
      '<button class="btn" id="ed-signout" type="button" data-print-hide>ログアウト</button>';
    // 歯車＋テーマパネルの配線（管理者のみ DOM が存在する）。
    window.__edMountThemePanel&&window.__edMountThemePanel();
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
</script>
<script>
// ── チームカラー・パネルの開閉と保存（編集の保存と同じセッション経路を踏襲）──────────
(function(){
  // 編集の保存（editor.mjs）と同じ作法: ?t を書き込み先URLへ引き継ぎ、Bearer を __getIdToken で付け、
  // Cookie は same-origin で同送、401 はセッション張り直して1回だけ再送する。
  function withTenantQ(path){
    try{
      var t=new URLSearchParams(location.search).get('t');
      if(!t)return path;
      return path+(path.indexOf('?')<0?'?':'&')+'t='+encodeURIComponent(t);
    }catch(_){return path;}
  }
  function withAuth(headers){
    var h=headers||{};
    if(typeof window.__getIdToken!=='function')return Promise.resolve(h);
    return window.__getIdToken().then(function(t){if(t)h['Authorization']='Bearer '+t;return h;}).catch(function(){return h;});
  }
  // 学校・チーム名の保存（テーマ保存と同じ withAuth/withTenantQ/credentials/401一回再送）。
  // status に応じた失敗文言は node 側でテスト済みの nameSaveErrorText を埋め込んで使う（ドリフト防止）。
  var nameErrorText=${nameSaveErrorText.toString()};
  function mountNameField(){
    var input=document.getElementById('ed-name-input');
    var saveBtn=document.getElementById('ed-name-save');
    var foot=document.getElementById('ed-name-foot');
    if(!input||!saveBtn||!foot)return;
    function setFoot(kind,text){
      if(!kind){foot.removeAttribute('data-kind');foot.textContent='';return;}
      foot.setAttribute('data-kind',kind);foot.textContent=text;
    }
    function save(){
      var name=(input.value||'').trim();
      input.disabled=true;saveBtn.disabled=true;
      setFoot('saving','保存しています…');
      var send=function(){return withAuth({'Content-Type':'application/json'})
        .then(function(headers){return fetch(withTenantQ('/api/tenant/name'),{
          method:'POST',headers:headers,credentials:'same-origin',body:JSON.stringify({name:name})});});};
      send()
        .then(function(r){
          // セッションCookieが約24hで失効して401なら、クライアント認証が生きていれば張り直して1回だけ再送。
          if(r.status===401&&typeof window.__establishSession==='function'){
            return window.__establishSession().then(send).catch(function(){return r;});
          }
          return r;
        })
        .then(function(r){
          var status=r.status;
          return r.json().catch(function(){return {ok:r.ok};}).then(function(res){
            if(res&&res.ok){window.location.reload();return;} // SSR再描画で新名を反映
            input.disabled=false;saveBtn.disabled=false;
            setFoot('error',nameErrorText(status,res&&res.error)); // 401/403/他を出し分け
          });
        })
        .catch(function(){
          input.disabled=false;saveBtn.disabled=false;
          setFoot('error',nameErrorText()); // ネットワーク断等は status 不明＝汎用文言
        });
    }
    saveBtn.addEventListener('click',save);
  }

  // 歯車・パネルの配線は描画のたびに呼ばれる（render() が box.innerHTML を差し替えるため）。
  window.__edMountThemePanel=function(){
    var boot=window.__edThemeBoot||{};
    if(!boot.isAdmin)return; // 非管理者は DOM 自体が無い
    mountNameField(); // 学校・チーム名フィールドの配線（パネル内・管理者のみ）
    var gear=document.getElementById('ed-gear');
    var panel=document.getElementById('ed-theme-panel');
    var swWrap=document.getElementById('ed-tp-swatches');
    var foot=document.getElementById('ed-tp-foot');
    var closeBtn=document.getElementById('ed-tp-close');
    if(!gear||!panel||!swWrap||!foot)return;
    var keys=boot.keys||[];
    var current=boot.themeKey; // 楽観適用しない＝保存成功まで現テーマのまま
    function open(){ panel.hidden=false; gear.setAttribute('aria-expanded','true'); }
    function close(){ panel.hidden=true; gear.setAttribute('aria-expanded','false'); }
    function setFoot(kind,html){
      if(!kind){ foot.removeAttribute('data-kind'); foot.textContent=''; return; }
      foot.setAttribute('data-kind',kind); foot.innerHTML=html;
    }
    function labelFor(key){
      var btn=swWrap.querySelector('.sw[data-theme="'+key+'"] .sw-name');
      return btn?btn.textContent:key;
    }
    function markSelected(key){
      swWrap.querySelectorAll('.sw').forEach(function(b){
        b.setAttribute('aria-pressed', b.getAttribute('data-theme')===key?'true':'false');
      });
    }
    gear.addEventListener('click',function(){ if(panel.hidden){open();}else{close();} });
    if(closeBtn)closeBtn.addEventListener('click',close);
    // status に応じた失敗文言は node 側でテスト済みの themeSaveErrorText を埋め込んで使う（ドリフト防止）。
    var errorText=${themeSaveErrorText.toString()};
    // 失敗の共通後処理: 楽観適用したチェック/太縁を実テーマ（current）へ巻き戻し、状態に応じた文言を出す。
    // current は据え置き（成功時のみ reload で SSR が更新する設計を維持）＝元色を押し直せばまた保存できる。
    function showError(key,status,serverError){
      swWrap.removeAttribute('data-busy');
      markSelected(current); // 三者整合: チェック/太縁を旧色へ戻す（楽観適用をチェック表示にも一貫）
      setFoot('error',errorText(status,serverError)+'<button class="tp-retry" id="ed-tp-retry" type="button">もう一度</button>');
      var retry=document.getElementById('ed-tp-retry');
      if(retry)retry.addEventListener('click',function(){ markSelected(key); save(key); });
    }
    function save(key){
      if(keys.indexOf(key)<0)return; // 未知キーは送らない（サーバ集合判定の二重防御）
      swWrap.setAttribute('data-busy','true');
      setFoot('saving','<span class="spin" aria-hidden="true"></span>'+labelFor(key)+'に変更しています…');
      var send=function(){return withAuth({'Content-Type':'application/json'})
        .then(function(headers){return fetch(withTenantQ('/api/tenant/theme'),{
          method:'POST',headers:headers,credentials:'same-origin',body:JSON.stringify({themeKey:key})});});};
      send()
        .then(function(r){
          // セッションCookieが約24hで失効して401なら、クライアント認証が生きていれば張り直して1回だけ再送。
          if(r.status===401&&typeof window.__establishSession==='function'){
            return window.__establishSession().then(send).catch(function(){return r;});
          }
          return r;
        })
        .then(function(r){
          var status=r.status;
          return r.json().catch(function(){return {ok:r.ok};}).then(function(res){
            if(res&&res.ok){ window.location.reload(); return; } // SSR再描画でテーマ適用（楽観適用しない）
            showError(key,status,res&&res.error); // 401/403/他を出し分け、チェックを実テーマへ戻す
          });
        })
        .catch(function(){ showError(key); }); // ネットワーク断等は status 不明＝汎用文言
    }
    swWrap.addEventListener('click',function(ev){
      var btn=ev.target&&ev.target.closest?ev.target.closest('.sw'):null;
      if(!btn||swWrap.getAttribute('data-busy')==='true')return;
      var key=btn.getAttribute('data-theme');
      if(!key||key===current)return; // 同じ色の再選択は何もしない
      markSelected(key);
      save(key);
    });
  };
  if(window.__edMountThemePanel)window.__edMountThemePanel();
})();
</script>`;
}

/** ログインUIのCSS（本番のみ注入。右上固定・印刷非表示・既存トークンのみ）。 */
export const AUTH_CSS = loadCss(import.meta.url, 'styles/auth-client.css');
