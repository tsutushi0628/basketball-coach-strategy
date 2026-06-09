/**
 * @file 全パターン共通の描画基盤（トンマナ固定・Hallmark準拠）。
 *
 * ここで ST-labo トンマナ（温かいニューモーフィズム: クリーム地＋オレンジ・大角丸・
 * 柔らかい影・Hiragino）を一点に固定し、各パターンはこの上にレイアウトだけを足す。
 * Hallmark NG（border帯のカード強調・emoji・汎用書体 Inter/Roboto・紫ピンクgradient・
 * gradient見出し・全幅centered hero・定型AIナビ）は基盤から排除しているので、
 * 各パターンはトンマナを発明せずレイアウトの違いだけで差別化する。
 */

/** ST-labo デザイントークン（warmブランド: クリーム地＋オレンジ）。 */
export const TOKENS = `
  --bg:#fbf5ec; --surface:#fffaf2; --ink:#2a201a; --mute:#7a6a5c;
  --orange:#ef7a32; --orange-ink:#fffaf2; --orange-soft:#ffd7b9; --orange-deep:#c4521b;
  --terra:#b8623b; --gold:#cf9a3e; --sage:#7c8a5a;
  --line:rgba(168,110,64,.13); --line-2:rgba(168,110,64,.22);
  --shadow:14px 18px 46px rgba(168,110,64,.15), -6px -8px 18px rgba(255,255,255,.9);
  --shadow-soft:0 8px 20px rgba(168,110,64,.09);
  --inset:inset 3px 3px 8px rgba(168,110,64,.10), inset -3px -3px 8px rgba(255,255,255,.85);
`;

/**
 * 共通ベースCSS（body・書体・印刷・ボタン・タブ・タグ・目標カード・ローテ表）。
 * 各パターンはこの後ろに自分のレイアウトCSSを連結する。
 */
export const BASE_CSS = `
:root{${TOKENS}}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:var(--bg);color:var(--ink)}
body{font-family:"Hiragino Sans","Helvetica Neue",system-ui,sans-serif;line-height:1.7;-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums}
.wrap{max-width:760px;margin:0 auto;padding:32px 18px 80px}
.eyebrow{font-size:11px;letter-spacing:.22em;color:var(--orange);text-transform:uppercase}
a{color:var(--orange-deep)}

/* レベル切替＆配布ツールバー */
.toolbar{display:flex;gap:9px;flex-wrap:wrap;align-items:center;margin:14px 0 18px}
.btn{appearance:none;border:none;cursor:pointer;background:var(--surface);color:var(--ink);box-shadow:var(--shadow-soft);border-radius:999px;padding:10px 18px;font:inherit;font-size:13px;letter-spacing:.02em;transition:transform .16s ease,color .16s ease}
.btn:hover{transform:translateY(-2px);color:var(--orange)}
.btn:focus-visible{outline:2px solid var(--orange);outline-offset:3px}
.btn-primary{background:var(--orange);color:var(--orange-ink)}
.btn-primary:hover{color:var(--orange-ink)}
.levels{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:16px}
.lvtab{appearance:none;border:none;cursor:pointer;background:var(--surface);color:var(--mute);box-shadow:var(--shadow-soft);border-radius:14px;padding:8px 16px;font:inherit;font-size:14px;font-weight:600;transition:transform .16s ease}
.lvtab:hover{transform:translateY(-2px)}
.lvtab.on{background:var(--orange);color:var(--orange-ink);box-shadow:var(--shadow)}
.lvtab:focus-visible{outline:2px solid var(--orange);outline-offset:3px}
.daytabs{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:18px}
.daytab{appearance:none;border:none;cursor:pointer;background:var(--surface);color:var(--mute);box-shadow:var(--shadow-soft);border-radius:16px;padding:8px 14px;font:inherit;font-size:15px;font-weight:600;display:flex;flex-direction:column;align-items:center;gap:1px;min-width:52px;transition:transform .16s ease}
.daytab small{font-weight:400;font-size:10px;opacity:.82}
.daytab:hover{transform:translateY(-2px)}
.daytab.on{background:var(--orange);color:var(--orange-ink);box-shadow:var(--shadow)}

/* 目標（KGI/KPI/定性 ＋ 今月/今週/本日） */
.goals{background:var(--surface);border-radius:24px;box-shadow:var(--shadow);padding:20px 24px;margin-bottom:16px}
.goals h3{font-size:12px;letter-spacing:.14em;color:var(--orange);margin-bottom:12px;font-weight:700}
.g3{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}
.g3 .cell{background:var(--bg);border-radius:16px;padding:13px 16px;box-shadow:var(--inset)}
.g3 .k{font-size:11px;letter-spacing:.08em;color:var(--orange-deep);font-weight:700;margin-bottom:5px}
.g3 .v{font-size:15px;line-height:1.55}
.g3 .v .sub{display:block;font-size:12px;color:var(--mute);margin-top:3px}
.gline{display:flex;gap:13px;align-items:baseline;padding:9px 0;border-bottom:1px solid var(--line)}
.gline:last-child{border-bottom:none}
.gline .lab{flex:0 0 64px;font-size:11px;letter-spacing:.08em;color:var(--orange-deep);font-weight:700}
.gline .txt{font-size:15px;line-height:1.55}

/* KPIメーター（残りを帯で見せる・gradientなし） */
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:12px}
.kpi{background:var(--bg);border-radius:14px;padding:11px 14px;box-shadow:var(--inset)}
.kpi .name{font-size:12px;color:var(--mute);margin-bottom:6px}
.kpi .val{font-size:17px;font-weight:700}
.kpi .val .arrow{color:var(--mute);font-weight:400;font-size:13px;margin:0 4px}
.kpi .val .tgt{color:var(--orange-deep)}
.kpi .bar{height:7px;border-radius:999px;background:var(--orange-soft);margin-top:8px;overflow:hidden}
.kpi .bar>span{display:block;height:100%;border-radius:999px;background:var(--orange)}

/* タグ（自走/コーチ付き/レクチャ） */
.tag{flex:0 0 auto;font-size:11px;border-radius:999px;padding:3px 10px;white-space:nowrap;font-weight:600}
.tag-coach{background:var(--orange);color:var(--orange-ink)}
.tag-self{background:var(--bg);color:var(--mute);box-shadow:var(--inset)}
.tag-lec{background:var(--orange-soft);color:var(--orange-deep)}
.alt{color:var(--mute);font-size:13px;margin-top:3px}
.alt b{color:var(--orange-deep);font-weight:700;font-style:normal}
.vid{display:inline-flex;align-items:center;gap:3px;color:var(--orange-deep);text-decoration:none;font-size:12px;background:var(--bg);padding:2px 9px;border-radius:999px;box-shadow:var(--inset)}
.vid:hover{text-decoration:underline}

/* ローテ表（コーチ1人・男女2レーン横） */
.rotwrap{background:var(--surface);border-radius:22px;box-shadow:var(--shadow);padding:18px 20px;margin-top:14px}
.rotwrap h4{font-size:13px;color:var(--orange-deep);margin-bottom:4px;font-weight:700}
.rotwrap .desc{font-size:12px;color:var(--mute);margin-bottom:14px;line-height:1.6}
.rotday{margin-bottom:16px}
.rotday>.rd{font-size:14px;font-weight:700;margin-bottom:8px}
.lane{display:flex;align-items:stretch;gap:8px;margin-bottom:7px}
.lane .who{flex:0 0 86px;font-size:12px;color:var(--mute);align-self:center}
.lane .track{flex:1;display:flex;gap:6px}
.seg{border-radius:12px;padding:8px 12px;font-size:13px;line-height:1.3;box-shadow:var(--shadow-soft);display:flex;flex-direction:column;justify-content:center;min-width:0}
.seg .sm{font-size:11px;opacity:.85;margin-top:2px}
.seg.coached{background:var(--orange);color:var(--orange-ink)}
.seg.self{background:var(--surface);color:var(--ink)}
.rotswap{font-size:11px;color:var(--mute);text-align:center;letter-spacing:.04em;margin:2px 0 8px}

.foot{margin-top:34px;color:var(--mute);font-size:11px;text-align:center;letter-spacing:.03em;line-height:1.7}
.note{font-size:12px;color:var(--mute);background:var(--surface);box-shadow:var(--shadow-soft);border-radius:14px;padding:10px 15px;margin-bottom:14px;line-height:1.6}

@media (max-width:520px){.wrap{padding:24px 12px 64px}.lane .who{flex-basis:64px}}
@media print{
  body{background:#fff}
  .toolbar,.levels,.daytabs,.foot{display:none}
  [data-print-hide]{display:none!important}
  .day[hidden],.level[hidden]{display:block!important}
  .goals,.rotwrap,.note,[class*="card"]{box-shadow:none;border:1px solid var(--line-2)}
  .wrap{max-width:none;padding:0}
  .pageb{page-break-after:always}
}
`;

/** ブロック種別の色（warm系で統一・虹色にしない）。 */
export const BLOCK_TINT = {
  WU: 'var(--sage)',
  技術: 'var(--orange)',
  対人: 'var(--terra)',
  ゲーム: 'var(--gold)',
  CD: 'var(--mute)',
};

/** HTMLエスケープ。 */
export const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 再生アイコン（SVG・emoji不使用）。 */
export const VIDEO_SVG =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M10 9l5 3-5 3z"/></svg>';

const MODE_LABEL = { self: '自走', practice: 'コーチ付き', lecture: 'レクチャ' };
/** 自走/コーチ付き/レクチャのタグHTML。 */
export const modeTag = (mode) => {
  const cls = mode === 'practice' ? 'tag tag-coach' : mode === 'lecture' ? 'tag tag-lec' : 'tag tag-self';
  return `<span class="${cls}">${MODE_LABEL[mode] || mode}</span>`;
};

/** 動画リンク（あれば）。 */
export const videoLink = (url) =>
  url ? ` <a class="vid" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${VIDEO_SVG}<span>動画</span></a>` : '';

/** 「いずれか」候補行。 */
export const altLine = (alts) =>
  alts && alts.length ? `<div class="alt"><b>いずれか</b>　${alts.map(esc).join(' ／ ')}</div>` : '';

/** 目標カード（KGI/KPI/定性 ＋ 今月/今週/本日）。全パターン共通。 */
export function goalsCard(g) {
  const kpiMeters = g.kpi
    .map((k) => {
      const span = Math.abs(k.target - k.baseline) || 1;
      const done = Math.max(0, Math.min(100, Math.round(((span - k.remain) / span) * 100)));
      return `<div class="kpi"><div class="name">${esc(k.label)}</div>
        <div class="val">${esc(String(k.latest))}${esc(k.unit)}<span class="arrow">→</span><span class="tgt">${esc(String(k.target))}${esc(k.unit)}</span></div>
        <div class="bar"><span style="width:${done}%"></span></div></div>`;
    })
    .join('');
  const qual = g.qualitative.map((q) => `・${esc(q)}`).join('<br>');
  return `<section class="goals">
    <h3>目標</h3>
    <div class="gline"><span class="lab">今月</span><span class="txt">${esc(g.monthMain)}${g.monthKpi ? `<span class="g-kpi" style="color:var(--mute);font-size:13px"> （${esc(g.monthKpi)}）</span>` : ''}</span></div>
    <div class="gline"><span class="lab">今週</span><span class="txt">${esc(g.week)}</span></div>
    <div class="g3" style="margin-top:14px">
      <div class="cell"><div class="k">KGI（成果）</div><div class="v">${g.kgi.map(esc).join('<span class="sub"></span>')}</div></div>
      <div class="cell"><div class="k">定性（質）</div><div class="v">${qual || '—'}</div></div>
    </div>
    <div class="kpis">${kpiMeters}</div>
  </section>`;
}

/** ローテ表（コーチ1人・男女2レーン横）。全パターン共通。 */
export function rotationTable(rt, groups) {
  if (!rt || rt.length === 0) return '';
  const days = rt
    .map((d) => {
      const rounds = d.rounds
        .map((r) => {
          const coached = `<div class="lane"><span class="who">コーチ付き</span><div class="track"><div class="seg coached" style="flex:${r.coached.minutes}">${esc(r.coached.name)}<span class="sm">${r.coached.minutes}分</span></div></div></div>`;
          const selfSegs = r.self
            .map((s) => `<div class="seg self" style="flex:${Math.max(8, s.minutes)}">${esc(s.name)}<span class="sm">${s.minutes}分</span></div>`)
            .join('');
          const self = `<div class="lane"><span class="who">その間 自走</span><div class="track">${selfSegs || '<div class="seg self" style="flex:1">—</div>'}</div></div>`;
          return `${coached}${self}<div class="rotswap">↑ 終わったら入れ替え（両組が両方を実施）</div>`;
        })
        .join('');
      return `<div class="rotday"><div class="rd">${esc(d.dayLabel)}　${esc(d.groups.join(' ⇄ '))}</div>${rounds}</div>`;
    })
    .join('');
  return `<section class="rotwrap">
    <h4>組違いローテーション（コーチ1人・${esc((groups || ['男子', '女子']).join('／'))}）</h4>
    <p class="desc">在席日は、片方の組に「コーチ付き」を付け、その間もう片方は別の自走ドリル。終わったら入れ替えて、両組が同じメニューを一通りこなす。不在日は両組とも同一メニューを各自で自走。</p>
    ${days}
  </section>`;
}

/** タブ切替＋印刷＋テキストコピーの共通スクリプト。 */
export function clientScript() {
  return `(function(){
  function tabs(group,target){
    document.querySelectorAll('[data-'+group+']').forEach(function(p){p.hidden=p.getAttribute('data-'+group)!==target;});
  }
  document.querySelectorAll('.lvtab').forEach(function(b){b.addEventListener('click',function(){
    document.querySelectorAll('.lvtab').forEach(function(x){x.classList.toggle('on',x===b);});
    tabs('level',b.getAttribute('data-go'));
  });});
  var dts=document.querySelectorAll('.daytab');
  function showDay(t){document.querySelectorAll('[data-day]').forEach(function(p){if(p.classList.contains('day'))p.hidden=p.getAttribute('data-day')!==t;});
    dts.forEach(function(b){b.classList.toggle('on',b.getAttribute('data-go')===t);});window.__curDay=t;}
  dts.forEach(function(b){b.addEventListener('click',function(){showDay(b.getAttribute('data-go'));});});
  var p=document.getElementById('printBtn'); if(p)p.addEventListener('click',function(){window.print();});
  var c=document.getElementById('copyBtn'); if(c)c.addEventListener('click',function(){
    var el=document.querySelector('.day[data-day="'+(window.__curDay||'')+'"] .plain')||document.querySelector('.plain');
    navigator.clipboard.writeText(el?el.textContent:'').then(function(){c.textContent='コピーしました';setTimeout(function(){c.textContent='テキストでコピー';},1500);});
  });
})();`;
}

/** 貼り付け用プレーンテキスト（Googleクラスルーム配布）。全パターン共通。 */
export function plainText(data, d) {
  const t = data.team;
  const L = [];
  L.push(`【${t.label}】${t.month}月 ${d.dayLabel}（${d.court}・${d.start}〜${d.end}）練習メニュー`);
  L.push('');
  L.push(`■ 今月の目標：${data.goals.monthMain}${data.goals.monthKpi ? `（${data.goals.monthKpi}）` : ''}`);
  L.push(`■ 今週の目標：${data.goals.week}`);
  L.push(`■ 本日の狙い：${d.aim}`);
  L.push('');
  L.push('■ 練習メニュー');
  for (const b of d.blocks) {
    L.push(`${b.from}〜${b.to}　${b.label}（${b.minutes}分）`);
    for (const it of b.items) {
      L.push(`　・${it.name}（${it.minutes}分）${it.alternatives.length ? `／いずれか：${it.alternatives.join('・')}` : ''}`);
    }
    if (!b.isBundle) L.push('　・給水');
  }
  L.push('　・ダウン／ミーティング（振り返り）');
  return L.join('\n');
}
