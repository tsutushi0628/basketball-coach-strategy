/**
 * @file 週/月/年の目標テキスト編集UI（クライアント側のみ・LLM不使用・決定論）。
 *
 * タイムライン画面の目標表示（月の目標／週の焦点／今月やること／年アークの各月見出し）を
 * その場で編集し、Cloud Function の保存API（POST /api/tenant/goal）へ送ってバックエンド
 * （Firestore・Admin SDK経由）に保存する。クライアントからの Firestore 直書きは rules で全 deny のまま。
 * 保存後はページを再読込し、サーバが Firestore から読んだ同じ内容で全タブを整合させる。
 *
 * データモデル: 月の目標と年アークの各月見出しは同一源（arc月キーの arcMonths マップ）。だから月タブで
 * 編集すると年タブの同じ arc月セルにも反映される（単一真実源・正しい挙動）。週の焦点だけ別（週起点日キー）。
 *
 * 写経元は editor.mjs（withAuth/withTenantQ/401一回再送）と auth-client.mjs（themeSaveErrorText 埋め込み）。
 * Hallmark NG（border帯のカード強調・emoji・汎用書体・紫ピンクgradient・gradient見出し）は持ち込まない。
 * 色は既存デザイントークン（var(--orange) 等）だけで当てる。
 */

/**
 * 目標保存失敗時の利用者向け文言を status から決める純関数（themeSaveErrorText と同型）。
 * サーバが返した本文 error があればそれを最優先（出し分けの真実源をサーバへ寄せる）。
 *   - サーバ error 文言あり → それをそのまま使う。
 *   - 401 → 再ログインを促す（セッション失効・張り直し再送も失敗した状態）。
 *   - 403 → 権限喪失を伝える（編集権限がなくなった等）。
 *   - それ以外（500・ネットワーク断で status 不明等）→ 汎用文言。
 * いずれも「目標は元のまま」を明示する（保存成功まで現在値のまま＝失敗時に目標が消えない）。
 * クライアント IIFE はこの関数の本体を埋め込んで使う（node 側でテストした規則と実行時を一致＝ドリフト防止）。
 * @param {number} [status] HTTP ステータス（不明時は undefined）
 * @param {string} [serverError] サーバ応答 body の error 文言
 * @returns {string}
 */
export function goalSaveErrorText(status, serverError) {
  if (serverError) return serverError;
  if (status === 401) return 'サインインし直してください。目標は元のままです。';
  if (status === 403) return '編集する権限がありません。目標は元のままです。';
  return '保存できませんでした。目標は元のままです。';
}

/** 目標編集UIのCSS（既存トークンのみ・新規クラスは ge-* に限定。border帯・gradient・emoji・汎用書体なし）。 */
export const GOAL_EDITOR_CSS = `
/* 編集導線の小ボタン（既存 ed-mini と同じ surface+hair の pill トーン）。色帯にしない。 */
.ge-edit{appearance:none;cursor:pointer;font:inherit;font-size:12px;font-weight:600;background:var(--surface);color:var(--mute);border:1px solid var(--hair);border-radius:999px;padding:3px 11px;margin-left:8px;white-space:nowrap;vertical-align:middle;transition:transform .14s ease,color .14s ease}
.ge-edit:hover{transform:translateY(-1px);color:var(--orange)}
.ge-edit:focus-visible{outline:2px solid var(--orange);outline-offset:2px}
/* インライン編集ボックス（保存・取消・状態行）。全周罫線で囲う（帯にしない）。 */
.ge-box{display:block;margin-top:8px;background:var(--bg);border:1px solid var(--hair);border-radius:10px;padding:10px 12px}
.ge-row{display:flex;flex-wrap:wrap;gap:7px;align-items:center}
.ge-in{flex:1 1 auto;min-width:0;appearance:none;font:inherit;font-size:14px;color:var(--ink);background:var(--surface);border:1px solid var(--hair);border-radius:10px;padding:8px 11px;line-height:1.4}
.ge-in:focus{outline:2px solid var(--orange);outline-offset:1px;border-color:var(--orange)}
.ge-in:disabled{opacity:.6}
.ge-save{appearance:none;cursor:pointer;flex:0 0 auto;font:inherit;font-size:12px;font-weight:700;background:var(--orange);color:var(--orange-ink);border:1px solid var(--orange);border-radius:999px;padding:8px 15px;white-space:nowrap;transition:transform .14s ease}
.ge-save:hover{transform:translateY(-1px)}
.ge-save:focus-visible{outline:2px solid var(--orange);outline-offset:2px}
.ge-save:disabled{opacity:.55;cursor:default;transform:none}
.ge-cancel{appearance:none;cursor:pointer;flex:0 0 auto;font:inherit;font-size:12px;font-weight:600;background:var(--surface);color:var(--mute);border:1px solid var(--hair);border-radius:999px;padding:8px 13px;white-space:nowrap}
.ge-cancel:hover{color:var(--orange)}
.ge-cancel:focus-visible{outline:2px solid var(--orange);outline-offset:2px}
.ge-foot{font-size:12px;line-height:1.5;color:var(--ink);margin-top:6px}
.ge-foot:empty{display:none}
.ge-foot[data-kind="saving"]{color:var(--mute)}
.ge-foot[data-kind="error"]{color:var(--terra);font-weight:600}
/* 年タブの狭い arc月セル用: トリガは絶対配置（高さに影響させない）、編集ボックスは画面下中央のオーバーレイ。 */
.arccell[data-goal-edit]{position:relative}
.ge-edit-abs{position:absolute;top:4px;right:4px;margin-left:0;padding:2px 7px;font-size:11px}
.ge-scrim{position:fixed;inset:0;background:var(--scrim);z-index:59}
.ge-box-overlay{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:60;width:min(92vw,420px);margin-top:0;background:var(--surface);border:1px solid var(--line-2);border-radius:14px;padding:14px 16px}
.ge-ov-title{font-size:12px;font-weight:700;color:var(--orange-deep);letter-spacing:.04em;margin-bottom:9px}
@media print{.ge-edit,.ge-box,.ge-box-overlay,.ge-scrim{display:none!important}}
`;

/**
 * 目標編集UIのクライアントJS（IIFE文字列）。pattern-timeline の render() で <script> に差し込む。
 * - [data-goal-edit] 要素ごとに「編集」ボタンを付ける（data-print-hide・既存トーンの小ボタン）。
 * - 押下→現在値（data-goal-text）をプリフィルした input＋保存/取消に差し替え。
 * - 保存→ POST /api/tenant/goal { scope, key, text }（withAuth/withTenantQ/credentials/401一回再送）。
 *   成功→ location.reload()（全タブ整合）。失敗→インライン文言（401/403/他を出し分け）。
 * - 空文字保存も許可（＝その目標をエンジン値に戻す。サーバが該当キーを削除する）。
 * @returns {string} IIFE
 */
export function goalEditorScript() {
  return `(function(){
  // 失敗文言は node 側でテスト済みの goalSaveErrorText を埋め込んで使う（規則と実行時を一致＝ドリフト防止）。
  var goalErrorText=${goalSaveErrorText.toString()};
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
  // 1要素＝1編集導線。開いている間は二重に開かない（同じ要素に box があれば何もしない）。
  function attach(el){
    if(el.__geWired)return;
    el.__geWired=true;
    var btn=document.createElement('button');
    btn.type='button';
    // 年タブの狭セルは絶対配置トリガ（高さに影響させない＝行の崩れ・boys/girls高さズレを防ぐ）。
    btn.className=el.getAttribute('data-goal-overlay')?'ge-edit ge-edit-abs':'ge-edit';
    btn.setAttribute('data-print-hide','');
    btn.textContent='編集';
    el.appendChild(btn);
    btn.addEventListener('click',function(){openEditor(el,btn);});
  }
  function openEditor(el,btn){
    if(el.__geOpen)return; // 既に編集中（インライン・オーバーレイ共通のガード）
    el.__geOpen=true;
    btn.style.display='none';
    var scope=el.getAttribute('data-goal-scope')||'';
    var key=el.getAttribute('data-goal-key')||'';
    var current=el.getAttribute('data-goal-text')||'';
    var overlay=!!el.getAttribute('data-goal-overlay'); // 年タブの狭セルは画面下オーバーレイで編集（セル内展開だと行が崩れる）
    var titleText=el.getAttribute('data-goal-title')||'';
    var scrim=null;
    var box=document.createElement('div');
    box.className=overlay?'ge-box ge-box-overlay':'ge-box';
    box.setAttribute('data-print-hide','');
    if(overlay&&titleText){
      var h=document.createElement('div');h.className='ge-ov-title';h.textContent=titleText;box.appendChild(h);
    }
    var row=document.createElement('div');row.className='ge-row';
    var input=document.createElement('input');
    input.type='text';input.className='ge-in';input.maxLength=200;input.value=current;
    input.placeholder='目標を入力（空にすると自動の目標に戻ります）';
    var save=document.createElement('button');save.type='button';save.className='ge-save';save.textContent='保存';
    var cancel=document.createElement('button');cancel.type='button';cancel.className='ge-cancel';cancel.textContent='取消';
    var foot=document.createElement('div');foot.className='ge-foot';
    row.appendChild(input);row.appendChild(save);row.appendChild(cancel);
    box.appendChild(row);box.appendChild(foot);
    if(overlay){
      // 画面下中央のオーバーレイ＋暗幕（セル内に入れない＝年リボンの行を崩さない）。
      scrim=document.createElement('div');scrim.className='ge-scrim';scrim.setAttribute('data-print-hide','');
      document.body.appendChild(scrim);document.body.appendChild(box);
      scrim.addEventListener('click',function(){close();});
    }else{
      el.appendChild(box);
    }
    input.focus();
    function setFoot(kind,text){
      if(!kind){foot.removeAttribute('data-kind');foot.textContent='';return;}
      foot.setAttribute('data-kind',kind);foot.textContent=text;
    }
    function close(){
      if(box.parentNode)box.parentNode.removeChild(box);
      if(scrim&&scrim.parentNode)scrim.parentNode.removeChild(scrim);
      el.__geOpen=false;
      btn.style.display='';
    }
    cancel.addEventListener('click',close);
    function doSave(){
      var text=(input.value||'').trim(); // 空文字も許可（サーバが該当キー削除＝エンジン値へ戻す）
      input.disabled=true;save.disabled=true;cancel.disabled=true;
      setFoot('saving','保存しています…');
      var body=JSON.stringify({scope:scope,key:key,text:text});
      var send=function(){return withAuth({'Content-Type':'application/json'})
        .then(function(headers){return fetch(withTenantQ('/api/tenant/goal'),{
          method:'POST',headers:headers,credentials:'same-origin',body:body});});};
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
            if(res&&res.ok){location.reload();return;} // SSR再描画で全タブ整合（楽観適用しない）
            input.disabled=false;save.disabled=false;cancel.disabled=false;
            setFoot('error',goalErrorText(status,res&&res.error)); // 401/403/他を出し分け
          });
        })
        .catch(function(){
          input.disabled=false;save.disabled=false;cancel.disabled=false;
          setFoot('error',goalErrorText()); // ネットワーク断等は status 不明＝汎用文言
        });
    }
    save.addEventListener('click',doSave);
    input.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();doSave();}});
  }
  document.querySelectorAll('[data-goal-edit]').forEach(attach);
})();`;
}
