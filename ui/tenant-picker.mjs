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

import { loadCssWithTokens } from './render-shared.mjs';

/** HTMLエスケープ。 */
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** テナント選択画面専用CSS（共有外殻＋選択リスト）。色・書体はトークンのみ。 */
const PICKER_CSS = loadCssWithTokens(import.meta.url, 'styles/picker.css');

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
