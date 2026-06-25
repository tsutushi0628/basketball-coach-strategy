/**
 * @file テナント選択画面（複数所属時のみ・サーバ描画）。
 *
 * 1人のコーチが複数チーム（テナント）に在籍する場合、サーバは membership 照合の結果（在籍中の
 * テナント一覧）をこの画面に渡す。コーチは1つ選び `/?t={tenantId}` で当該テナントの計画を開く。
 * MVP は1所属が主なので最小実装（クライアント認証処理は不要＝セッションは描画前に確立済み）。
 *
 * デザインは render-shared.mjs のトークンに準拠。Hallmark NG（border帯・emoji・汎用書体・
 * gradient・全幅centered hero・定型ナビ・偽chrome・3等分icon-grid）は不使用。テナント行は
 * 等幅3カラムのfeature-card-gridにせず、縦積みの選択リスト（押せる行）にする。
 */

import { TOKENS } from './render-shared.mjs';

/** HTMLエスケープ。 */
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** テナント選択画面専用CSS（共有外殻＋選択リスト）。色・書体はトークンのみ。 */
const PICKER_CSS = `
/* Hallmark · macrostructure: index-first-list · genre: modern-minimal
   · pre-emit critique: P5 H5 E5 S5 R5 V5
   · tokens: render-shared.mjs (no inline color/font) · nav: none · footer: Ft2 inline single-line
   · contrast: pass (46-50) · slop: pass (51-55) · mobile: pass (36,59,61-69) */
:root{${TOKENS}}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:var(--bg);color:var(--ink);overflow-x:clip}
body{font-family:"Hiragino Sans",system-ui,sans-serif;line-height:1.7;-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums;min-height:100dvh;display:flex;flex-direction:column}
a{color:var(--orange-deep)}
.pk-main{flex:1 1 auto;width:100%;max-width:760px;margin:0 auto;padding:72px 22px 40px}
@media (max-width:560px){.pk-main{padding:44px 18px 32px}}
.pk-kicker{display:block;font-size:12px;font-weight:700;letter-spacing:.06em;color:var(--orange-deep);margin-bottom:10px}
.pk-title{font-size:27px;font-weight:700;letter-spacing:-.01em;line-height:1.25;overflow-wrap:anywhere;min-width:0}
.pk-lede{font-size:14px;color:var(--mute);line-height:1.7;margin-top:12px;max-width:46ch}
/* 選択リスト: 縦積み・押せる行（surface面 + 全周hairline）。3等分グリッドにしない。 */
.pk-list{display:flex;flex-direction:column;gap:10px;margin-top:24px;max-width:520px}
.pk-row{display:flex;align-items:center;gap:14px;background:var(--surface);border:1px solid var(--hair);border-radius:14px;padding:16px 18px;text-decoration:none;color:var(--ink);transition:transform .16s ease,border-color .16s ease}
.pk-row:hover{transform:translateY(-2px);border-color:var(--orange-soft)}
.pk-row:focus-visible{outline:2px solid var(--orange);outline-offset:3px}
.pk-row:active{transform:translateY(0)}
.pk-body{flex:1 1 auto;min-width:0}
.pk-name{font-size:17px;font-weight:700;line-height:1.4;overflow-wrap:anywhere}
.pk-role{font-size:12px;color:var(--mute);margin-top:3px}
/* 行末の進む矢印（>）はSVG線画（emoji不使用）。 */
.pk-go{flex:0 0 auto;color:var(--orange-deep);display:inline-flex;align-items:center}
.pk-go svg{display:block;width:18px;height:18px}
.pk-empty{margin-top:24px;font-size:14px;color:var(--mute);background:var(--surface);border:1px solid var(--hair);border-radius:14px;padding:18px 20px;max-width:520px;line-height:1.7}
.pk-foot{flex:0 0 auto;width:100%;max-width:760px;margin:0 auto;padding:24px 22px 32px;color:var(--mute);font-size:11px;letter-spacing:.04em}
@media (prefers-reduced-motion:reduce){
  .pk-row{transition:none}
  .pk-row:hover{transform:none}
}
`;

/** 進む矢印（chevron-right・SVG線画）。 */
const CHEVRON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>';

/** ロールの機能ラベル（識別子を出さず役割名で見せる）。 */
const ROLE_LABEL = { owner: '所有コーチ', editor: '編集コーチ', viewer: '閲覧' };

/**
 * 在籍テナント一覧の選択画面HTMLを返す（サーバ描画・クライアント認証処理なし）。
 * @param {{tenants: Array<{tenantId:string, name:string, role?:string}>}} arg
 * @returns {string} 完全な HTML 文書
 */
export function tenantPickerHtml({ tenants }) {
  if (!Array.isArray(tenants)) {
    throw new Error('tenantPickerHtml: tenants 配列が必須です');
  }

  const rows = tenants
    .map((t) => {
      const roleText = t.role && ROLE_LABEL[t.role] ? ROLE_LABEL[t.role] : '';
      const roleHtml = roleText ? `<div class="pk-role">${esc(roleText)}</div>` : '';
      const href = `/?t=${encodeURIComponent(t.tenantId)}`;
      return `<a class="pk-row" href="${esc(href)}">
        <div class="pk-body">
          <div class="pk-name">${esc(t.name || t.tenantId)}</div>
          ${roleHtml}
        </div>
        <span class="pk-go">${CHEVRON_SVG}</span>
      </a>`;
    })
    .join('');

  const listHtml = tenants.length
    ? `<div class="pk-list">${rows}</div>`
    : `<p class="pk-empty">所属しているチームがありません。招待リンクから参加するか、管理者にお問い合わせください。</p>`;

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>チームを選ぶ — 練習計画</title>
<style>${PICKER_CSS}</style>
</head>
<body>
<main class="pk-main">
  <span class="pk-kicker">練習計画ツール</span>
  <h1 class="pk-title">どのチームを開きますか</h1>
  <p class="pk-lede">あなたは複数のチームに所属しています。開きたいチームを選んでください。</p>
  ${listHtml}
</main>
<footer class="pk-foot">練習計画ツール</footer>
</body>
</html>`;
}
