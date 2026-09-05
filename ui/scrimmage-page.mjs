/**
 * @file /scrimmage 紅白戦チーム分け画面（SSRが配信する完全HTML）。
 *
 * 契約の正本: docs/findings/spec-20260905-scrimmage-split.md 10章C。
 * 見た目の正本: docs/findings/design-20260905-scrimmage-split-mock.html（面1/面2/面3）。
 * 独立URL /scrimmage をスマホのホーム画面に追加して直接開く前提で、head にホーム画面追加用の
 * メタ（apple-mobile-web-app-capable・apple-mobile-web-app-title・theme-color）を足す。
 *
 * Tier・役割・身長・学年・平均・警告・評価は、この画面にもデータ島にも一切載せない
 * （model 自体がそれらのフィールドを持たない設計。10章B参照）。
 *
 * ブラウザ側 JS は ui/editor.mjs / ui/join.mjs と同じ作法（IIFE 文字列・var/function・
 * credentials:'same-origin'・URL の ?t を API へ引き継ぐ withTenantQ 相当）。
 */

import { renderPage } from './render-shared.mjs';

/** HTMLエスケープ（join.mjs / render-shared.mjs と同じ規約）。 */
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** チェック印SVG（モックと同じ形。act-primary・chk の中身で共有）。 */
const CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 13l4 4L19 7"/></svg>';

/**
 * ページ専用CSS。値はすべて意味ロールトークン（var(--*)）経由で、色プリミティブ・インラインhex
 * を直参照しない（docs/design-system/component-spec.md「押せる部品の5役割」に準拠）。
 * `*`・`html,body`・`body`・`.wrap`・`a` のリセットは render-shared.mjs の BASE_CSS が既に持つため
 * ここでは足さない（重複定義の禁止／単一の定義元に置く規律）。
 */
const PAGE_CSS = `
.scr-app{margin-top:8px}
.hdr{display:flex;align-items:center;flex-wrap:wrap;gap:10px}
.hdr .lnk{margin-left:auto}
.hdr+.seg{margin-top:10px}
.sc-t{font-size:22px;font-weight:700;letter-spacing:-.01em;line-height:1.35}
.sc-sub{font-size:14px;color:var(--on-surface-muted);line-height:1.6;margin-top:2px}
.lab{display:block;font-size:12px;font-weight:700;letter-spacing:.04em;color:var(--on-label-accent);margin:18px 0 8px}
.seg{display:flex;gap:6px;background:var(--surface-ground);border:1px solid var(--line-strong);border-radius:20px;padding:5px;margin-top:8px}
.seg .st{flex:1 1 0;appearance:none;cursor:pointer;font:inherit;display:inline-flex;flex-direction:column;align-items:center;justify-content:center;gap:0;min-height:44px;padding:0 6px;border-radius:999px;background:var(--state-idle-fill);border:1px solid var(--state-idle-line);color:var(--on-state-idle);font-size:14px;font-weight:600;line-height:1.3;transition:transform .16s ease}
.seg .st:hover{transform:translateY(-2px)}
.seg .st:active{transform:translateY(1px)}
.seg .st[aria-pressed="true"]{background:var(--state-selected-fill);border:1.5px solid var(--state-selected-ring);color:var(--on-state-selected);font-weight:700}
.seg .st small{font-size:12px;font-weight:400}
.seg .st:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px}
.act-primary{appearance:none;cursor:pointer;font:inherit;display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;width:100%;padding:0 22px;border-radius:8px;background:var(--action-primary-fill);border:1.5px solid var(--action-primary-line);color:var(--on-action-primary);font-size:15px;font-weight:700;letter-spacing:.04em;transition:transform .16s ease}
.act-primary:hover{transform:translateY(-2px)}
.act-primary:active{transform:translateY(1px)}
.act-primary:disabled{opacity:.6;cursor:default;transform:none}
.act-primary:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px}
.act-primary svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.ops{display:flex;justify-content:flex-end;gap:8px;flex-wrap:nowrap}
.act-secondary{appearance:none;cursor:pointer;font:inherit;display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:44px;padding:0 16px;border-radius:8px;background:var(--action-secondary-fill);border:1px solid var(--action-secondary-line);color:var(--on-action-secondary);font-size:14px;font-weight:600;white-space:nowrap;transition:background-color .16s ease,transform .16s ease}
.act-secondary:hover{background:var(--action-secondary-fill-hover)}
.act-secondary:active{transform:translateY(1px)}
.act-secondary:disabled{opacity:.6;cursor:default}
.act-secondary:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px}
.lnk{display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:44px;padding:0 4px;color:var(--on-link);font-size:14px;font-weight:400;text-decoration:underline;text-underline-offset:2px;background:none;border:none;cursor:pointer;font-family:inherit}
.lnk:hover{text-decoration-thickness:2px}
.lnk:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px}
.lnk--body{font-size:16px}
.roster{list-style:none;display:flex;flex-direction:column;gap:6px}
.chk{display:flex;align-items:center;gap:14px;min-height:52px;padding:0 16px;background:var(--surface-card);border:1px solid var(--line-hairline);border-radius:10px;cursor:pointer;user-select:none}
.chk input{position:absolute;opacity:0;width:1px;height:1px;font:inherit}
.chk .box{flex:0 0 auto;width:24px;height:24px;border-radius:6px;background:var(--surface-card);border:1px solid var(--line-strong);display:inline-flex;align-items:center;justify-content:center;color:var(--on-surface)}
.chk .box svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round;visibility:hidden}
.chk input:checked+.box svg{visibility:visible}
.chk input:focus-visible+.box{outline:2px solid var(--focus-ring);outline-offset:2px}
.chk .nm{font-size:18px;font-weight:600;line-height:1.3}
.chk input:not(:checked)~.nm{color:var(--on-surface-muted);font-weight:400}
.names{list-style:none;display:flex;flex-direction:column;gap:6px}
.names li{display:flex;align-items:center;min-height:52px;padding:0 16px;background:var(--surface-card);border:1px solid var(--line-hairline);border-radius:10px;font-size:18px;font-weight:600;line-height:1.3}
.line{font-size:16px;line-height:1.6;margin-top:10px}
.line b{font-weight:700}
.meta{font-size:14px;color:var(--on-surface-muted);line-height:1.6}
.bottom{margin-top:28px}
.bottom .act-primary{margin-top:14px}
.err{font-size:14px;color:var(--terra-ink);line-height:1.6;margin-top:10px}
.missing{list-style:none;display:flex;flex-direction:column;gap:6px}
.missing li{display:flex;align-items:center;gap:12px;min-height:52px;padding:0 16px;background:var(--surface-card);border:1px solid var(--line-hairline);border-radius:10px;font-size:18px;font-weight:600;line-height:1.3}
.missing li .pid{font-size:14px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--on-surface-muted)}
.missing li .cnt{margin-left:auto;color:var(--on-surface-muted);font-size:14px;white-space:nowrap}
`;

/** 面1（出欠とチーム数）の骨格。roster は空で JS が data island から組む（二重実装を避ける）。 */
function screen1Html(isAdmin) {
  return `<section class="screen" id="scr-1" data-screen="1">
  <div class="hdr">
    <div class="sc-t">チーム分け</div>
    ${isAdmin ? '<button class="lnk" type="button" id="btn-roster">名簿</button>' : ''}
  </div>
  <div class="seg" role="group" aria-label="対象の切り替え" id="gender-seg">
    <button class="st" type="button" data-gender="M" aria-pressed="true">男子</button>
    <button class="st" type="button" data-gender="F" aria-pressed="false">女子</button>
  </div>
  <div class="sc-sub" id="scr1-date"></div>

  <span class="lab">出席</span>
  <ul class="roster" id="scr1-roster"></ul>

  <div class="bottom">
    <span class="lab" style="margin-top:0">チーム数</span>
    <div class="seg" role="group" aria-label="チーム数" id="teamcount-seg">
      <button class="st" type="button" data-count="2" aria-pressed="true">2</button>
      <button class="st" type="button" data-count="3" aria-pressed="false">3</button>
    </div>
    <p class="line" id="scr1-preview"></p>
    <p class="err" id="scr1-err" hidden></p>
    <button class="act-primary" type="button" id="btn-split">${CHECK_SVG}分ける</button>
  </div>
</section>`;
}

/** 面2（結果）の骨格。チームの中身・人数は split 応答を受けてから JS が描く。 */
function screen2Html(isAdmin) {
  return `<section class="screen" id="scr-2" data-screen="2" hidden>
  <div class="hdr">
    <div class="sc-t">チーム分け</div>
    ${isAdmin ? '<button class="lnk" type="button" id="btn-roster-2">名簿</button>' : ''}
  </div>
  <div class="seg" role="group" aria-label="対象" id="gender-seg-2">
    <button class="st" type="button" aria-pressed="false" tabindex="-1">男子</button>
    <button class="st" type="button" aria-pressed="false" tabindex="-1">女子</button>
  </div>
  <div class="sc-sub" id="scr2-sub"></div>

  <span class="lab">チーム</span>
  <div class="seg" role="group" aria-label="チーム" id="team-seg"></div>

  <span class="lab" id="scr2-team-lab"></span>
  <ul class="names" id="scr2-names"></ul>
  <p class="err" id="scr2-err" hidden></p>

  <div class="bottom">
    <div class="ops">
      <button class="act-secondary" type="button" id="btn-reroll">もう一回</button>
    </div>
    <button class="act-primary" type="button" id="btn-decide">${CHECK_SVG}この分けで決める</button>
  </div>
</section>`;
}

/** 面3（名簿同期・管理者のみ）の骨格。 */
function screen3Html(sync) {
  const syncedAtText = formatSyncedAt(sync && sync.syncedAt);
  const sheetUrl = (sync && sync.sheetUrl) || null;
  const missing = (sync && Array.isArray(sync.missing)) ? sync.missing : [];
  const missingHtml = missing.length
    ? missing.map((m) => `<li><span class="pid">${esc(m.playerId)}</span><span>${esc(m.name)}</span><span class="cnt">未入力 ${esc(String(m.count))}列</span></li>`).join('')
    : '<li><span>未入力の項目はありません</span></li>';
  return `<section class="screen" id="scr-3" data-screen="3" hidden>
  <div class="hdr">
    <div class="sc-t">名簿同期</div>
    <button class="lnk" type="button" id="btn-back-from-roster">チーム分けへ戻る</button>
  </div>
  <div class="sc-sub" id="scr3-synced">最終同期 ${esc(syncedAtText)}</div>

  <span class="lab">シートで未入力の列がある子</span>
  <ul class="missing" id="scr3-missing">${missingHtml}</ul>
  <p class="line">${sheetUrl ? `<a class="lnk lnk--body" href="${esc(sheetUrl)}" target="_blank" rel="noopener">名簿シートを開く</a>` : ''}</p>
  <p class="err" id="scr3-err" hidden></p>

  <div class="bottom">
    <p class="meta">シートの内容でアプリの名簿を置き換える。</p>
    <button class="act-primary" type="button" id="btn-sync">${CHECK_SVG}名簿を同期</button>
  </div>
</section>`;
}

/** `syncedAt`（ISO文字列|null）を「9/3 18:20」形式へ整形する。null は「未実施」。 */
function formatSyncedAt(syncedAt) {
  if (!syncedAt) return '未実施';
  const d = new Date(syncedAt);
  if (Number.isNaN(d.getTime())) return '未実施';
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${mm}`;
}

/**
 * ブラウザ側 JS（IIFE 文字列）。fetch は credentials:'same-origin'、URL の ?t を API へ引き継ぐ
 * （ui/editor.mjs withTenantQ と同型）。Math.random は使わない（サーバの seed をそのまま持ち回る）。
 */
function clientScript(isAdmin) {
  return `(function(){
  'use strict';
  var dataEl = document.getElementById('scrim-model');
  var MODEL = JSON.parse(dataEl.textContent);
  var PLAYERS = MODEL.players || [];
  var NAME_BY_ID = {};
  for (var i = 0; i < PLAYERS.length; i++) NAME_BY_ID[PLAYERS[i].playerId] = PLAYERS[i].name;

  var state = { gender: 'M', teamCount: 2, split: null, activeTeam: 0 };

  function withTenantQ(path) {
    try {
      var t = new URLSearchParams(location.search).get('t');
      if (!t) return path;
      return path + (path.indexOf('?') < 0 ? '?' : '&') + 't=' + encodeURIComponent(t);
    } catch (_) { return path; }
  }

  function postJson(path, body) {
    return fetch(withTenantQ(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    }).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: 'サーバ応答エラー' }; }).then(function (j) {
        return { status: r.status, json: j };
      });
    });
  }

  function showError(elId, message) {
    var el = document.getElementById(elId);
    if (!el) return;
    if (!message) { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false;
    el.textContent = message;
  }

  function switchScreen(n) {
    var s1 = document.getElementById('scr-1');
    var s2 = document.getElementById('scr-2');
    var s3 = document.getElementById('scr-3');
    if (s1) s1.hidden = (n !== 1);
    if (s2) s2.hidden = (n !== 2);
    if (s3) s3.hidden = (n !== 3);
  }

  // ── 面1: 出欠とチーム数 ──
  function rosterForGender(gender) {
    var out = [];
    for (var i = 0; i < PLAYERS.length; i++) {
      var p = PLAYERS[i];
      if (p.gender === gender && p.active) out.push(p);
    }
    return out;
  }

  function renderRoster() {
    var list = document.getElementById('scr1-roster');
    var players = rosterForGender(state.gender);
    var html = '';
    for (var i = 0; i < players.length; i++) {
      var p = players[i];
      html += '<li><label class="chk"><input type="checkbox" checked data-pid="' + p.playerId + '">'
        + '<span class="box"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 13l4 4L19 7"/></svg></span>'
        + '<span class="nm"></span></label></li>';
    }
    list.innerHTML = html;
    var lis = list.querySelectorAll('li');
    for (var j = 0; j < lis.length; j++) {
      lis[j].querySelector('.nm').textContent = players[j].name;
      lis[j].querySelector('input').addEventListener('change', updatePreview);
    }
    updatePreview();
  }

  function checkedIds() {
    var boxes = document.querySelectorAll('#scr1-roster input[type="checkbox"]');
    var ids = [];
    for (var i = 0; i < boxes.length; i++) if (boxes[i].checked) ids.push(boxes[i].getAttribute('data-pid'));
    ids.sort();
    return ids;
  }

  // n人を teamCount チームへ、余りをAから順に1人ずつ足して割る（engine の teamSizes と同じ規則の
  // 表示用プレビューのみ。実際の分けは必ずサーバの /api/scrimmage/split が決める）。
  function previewSizes(n, teamCount) {
    var base = Math.floor(n / teamCount);
    var rem = n % teamCount;
    var sizes = [];
    for (var i = 0; i < teamCount; i++) sizes.push(base + (i < rem ? 1 : 0));
    return sizes;
  }

  function updatePreview() {
    var n = checkedIds().length;
    var el = document.getElementById('scr1-preview');
    if (n < state.teamCount) {
      el.innerHTML = '<b>' + n + '人</b>（チーム数に足りません）';
      return;
    }
    var sizes = previewSizes(n, state.teamCount);
    el.innerHTML = '<b>' + n + '人</b> → ' + sizes.join('・');
  }

  function formatToday() {
    var d = new Date();
    var w = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
    return (d.getMonth() + 1) + '/' + d.getDate() + '（' + w + '）';
  }

  document.getElementById('scr1-date').textContent = formatToday();

  var genderSeg = document.getElementById('gender-seg');
  genderSeg.addEventListener('click', function (ev) {
    var btn = ev.target.closest('.st');
    if (!btn) return;
    state.gender = btn.getAttribute('data-gender');
    var btns = genderSeg.querySelectorAll('.st');
    for (var i = 0; i < btns.length; i++) btns[i].setAttribute('aria-pressed', String(btns[i] === btn));
    renderRoster();
    showError('scr1-err', '');
  });

  var teamCountSeg = document.getElementById('teamcount-seg');
  teamCountSeg.addEventListener('click', function (ev) {
    var btn = ev.target.closest('.st');
    if (!btn) return;
    state.teamCount = Number(btn.getAttribute('data-count'));
    var btns = teamCountSeg.querySelectorAll('.st');
    for (var i = 0; i < btns.length; i++) btns[i].setAttribute('aria-pressed', String(btns[i] === btn));
    updatePreview();
  });

  function doSplit(seed) {
    var attendees = checkedIds();
    var body = { gender: state.gender, teamCount: state.teamCount, attendees: attendees };
    if (typeof seed === 'number') body.seed = seed;
    var btn = document.getElementById('btn-split');
    var reroll = document.getElementById('btn-reroll');
    if (btn) btn.disabled = true;
    if (reroll) reroll.disabled = true;
    return postJson('/api/scrimmage/split', body).then(function (res) {
      if (btn) btn.disabled = false;
      if (reroll) reroll.disabled = false;
      if (!res.json || res.json.ok !== true) {
        var msg = (res.json && res.json.error) || 'サーバ応答エラー';
        showError('scr1-err', msg);
        showError('scr2-err', msg);
        return;
      }
      state.split = { gender: state.gender, teamCount: state.teamCount, attendees: attendees, teams: res.json.teams, seed: res.json.seed };
      state.activeTeam = 0;
      renderResult();
      switchScreen(2);
    });
  }

  document.getElementById('btn-split').addEventListener('click', function () {
    showError('scr1-err', '');
    doSplit();
  });

  // ── 面2: 結果 ──
  var TEAM_LETTERS = ['A', 'B', 'C'];

  function renderResult() {
    var sp = state.split;
    document.getElementById('scr2-sub').textContent = formatToday() + ' ' + sp.attendees.length + '人';
    var seg = document.getElementById('team-seg');
    var html = '';
    for (var i = 0; i < sp.teams.length; i++) {
      html += '<button class="st" type="button" data-team="' + i + '" aria-pressed="' + (i === state.activeTeam) + '">'
        + TEAM_LETTERS[i] + '<small>' + sp.teams[i].length + '人</small></button>';
    }
    seg.innerHTML = html;
    renderTeamNames();
  }

  function renderTeamNames() {
    var sp = state.split;
    var team = sp.teams[state.activeTeam];
    document.getElementById('scr2-team-lab').textContent = 'チーム' + TEAM_LETTERS[state.activeTeam];
    var html = '';
    for (var i = 0; i < team.length; i++) {
      html += '<li>' + (NAME_BY_ID[team[i]] || team[i]) + '</li>';
    }
    document.getElementById('scr2-names').innerHTML = html;
  }

  document.getElementById('team-seg').addEventListener('click', function (ev) {
    var btn = ev.target.closest('.st');
    if (!btn) return;
    state.activeTeam = Number(btn.getAttribute('data-team'));
    var btns = document.getElementById('team-seg').querySelectorAll('.st');
    for (var i = 0; i < btns.length; i++) btns[i].setAttribute('aria-pressed', String(btns[i] === btn));
    renderTeamNames();
  });

  document.getElementById('btn-reroll').addEventListener('click', function () {
    showError('scr2-err', '');
    doSplit(state.split.seed + 1);
  });

  function pad2(n) { return String(n).length < 2 ? '0' + n : String(n); }
  function todayIso() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  document.getElementById('btn-decide').addEventListener('click', function () {
    showError('scr2-err', '');
    var sp = state.split;
    var btn = document.getElementById('btn-decide');
    btn.disabled = true;
    postJson('/api/scrimmage/decide', {
      date: todayIso(),
      gender: sp.gender,
      teamCount: sp.teamCount,
      attendees: sp.attendees,
      teams: sp.teams,
      seed: sp.seed,
    }).then(function (res) {
      btn.disabled = false;
      if (!res.json || res.json.ok !== true) {
        showError('scr2-err', (res.json && res.json.error) || 'サーバ応答エラー');
        return;
      }
      showError('scr2-err', '');
    });
  });

  ${isAdmin ? `
  // ── 名簿への出入り（管理者のみ） ──
  function goRoster() { switchScreen(3); }
  var rb1 = document.getElementById('btn-roster');
  var rb2 = document.getElementById('btn-roster-2');
  if (rb1) rb1.addEventListener('click', goRoster);
  if (rb2) rb2.addEventListener('click', goRoster);
  var back = document.getElementById('btn-back-from-roster');
  if (back) back.addEventListener('click', function () { switchScreen(1); });

  document.getElementById('btn-sync').addEventListener('click', function () {
    showError('scr3-err', '');
    var btn = document.getElementById('btn-sync');
    btn.disabled = true;
    postJson('/api/roster/sync', {}).then(function (res) {
      btn.disabled = false;
      if (!res.json || res.json.ok !== true) {
        showError('scr3-err', (res.json && res.json.error) || 'サーバ応答エラー');
        return;
      }
      var syncedText = res.json.syncedAt ? new Date(res.json.syncedAt) : null;
      document.getElementById('scr3-synced').textContent = '最終同期 ' + (syncedText
        ? ((syncedText.getMonth() + 1) + '/' + syncedText.getDate() + ' ' + syncedText.getHours() + ':' + pad2(syncedText.getMinutes()))
        : '未実施');
      var missing = res.json.missing || [];
      var mhtml = missing.length ? '' : '<li><span>未入力の項目はありません</span></li>';
      for (var i = 0; i < missing.length; i++) {
        mhtml += '<li><span class="pid"></span><span></span><span class="cnt"></span></li>';
      }
      var ml = document.getElementById('scr3-missing');
      ml.innerHTML = mhtml;
      var lis = ml.querySelectorAll('li');
      for (var j = 0; j < missing.length; j++) {
        lis[j].querySelector('.pid').textContent = missing[j].playerId;
        lis[j].querySelector('.pid').nextElementSibling.textContent = missing[j].name;
        lis[j].querySelector('.cnt').textContent = '未入力 ' + missing[j].count + '列';
      }
    });
  });` : ''}

  renderRoster();
})();`;
}

/**
 * `/scrimmage` の完全 HTML を返す。
 * @param {{school:string, isAdmin:boolean, themeKey:string, tenantId:string,
 *   players: Array<{playerId:string, name:string, gender:'M'|'F', active:boolean}>,
 *   sync: {syncedAt:string|null, sheetUrl:string|null, missing: Array<{playerId:string, name:string, count:number}>} | null}} model
 * @returns {string} 完全な HTML 文書
 */
export function renderScrimmagePage(model) {
  if (!model || typeof model !== 'object') throw new Error('renderScrimmagePage: model が必須です');
  if (!Array.isArray(model.players)) throw new Error('renderScrimmagePage: model.players が必須です');
  const isAdmin = model.isAdmin === true;

  const dataIsland = JSON.stringify({ players: model.players }).replace(/</g, '\\u003c');

  const body = `<div class="scr-app" id="scrimApp">
${screen1Html(isAdmin)}
${screen2Html(isAdmin)}
${isAdmin ? screen3Html(model.sync) : ''}
</div>
<script type="application/json" id="scrim-model">${dataIsland}</script>`;

  const html = renderPage({
    title: `${model.school || 'チーム分け'} チーム分け`,
    css: PAGE_CSS,
    body,
    script: clientScript(isAdmin),
  });

  const homeScreenMeta =
    '<meta name="apple-mobile-web-app-capable" content="yes" />\n' +
    '<meta name="apple-mobile-web-app-title" content="チーム分け" />\n' +
    '<meta name="theme-color" content="#a8480c" />\n';
  return html.replace('</head>', homeScreenMeta + '</head>');
}
