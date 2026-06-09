/**
 * @file 練習計画UI ビルダー。
 *
 * 単一データソース（plan-data.mjs＝エンジン実出力）を、`pattern-*.mjs` の各レンダラで
 * 複数の見せ方パターンに描画する。各パターンは年/月/週/日の4レベル・印刷PDF・貼れる
 * テキスト・組違いローテ2レーンを備える。トンマナは render-shared.mjs に固定（ST-labo・
 * Hallmark準拠）。`pattern-*.mjs` を足すだけで自動的にビルド対象に入る。
 *
 * 実行: ui/ で `node build.mjs`
 * 出力: ui/pattern-<id>.html（各パターン・自己完結）＋ ui/index.html（パターン選択）
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFileSync, readdirSync } from 'node:fs';

import { buildPlanData } from './plan-data.mjs';
import { BASE_CSS, clientScript, esc } from './render-shared.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function page({ title, css, body, script }) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)}</title>
<style>${BASE_CSS}${css || ''}</style>
</head>
<body>
<main class="wrap">
${body}
<p class="foot">エンジン生成（自動）。コーチが微修正して配布する想定。<br>コート図はドリルの動画リンクで代替中（手描き図の差し込み枠は次版で対応）。</p>
</main>
<script>${script || clientScript()}</script>
</body>
</html>`;
}

async function main() {
  const data = await buildPlanData();

  // pattern-*.mjs を発見して読み込む。
  const files = readdirSync(__dirname)
    .filter((f) => /^pattern-.*\.mjs$/.test(f))
    .sort();
  const patterns = [];
  for (const f of files) {
    const mod = await import('./' + f);
    if (typeof mod.render !== 'function' || !mod.meta) continue;
    patterns.push(mod);
  }

  const built = [];
  for (const p of patterns) {
    const { css, body } = p.render(data);
    const html = page({
      title: `${data.school} ${data.month}月 練習メニュー（男子・女子） — ${p.meta.name}`,
      css,
      body,
    });
    const out = resolve(__dirname, `pattern-${p.meta.id}.html`);
    writeFileSync(out, html, 'utf8');
    built.push({ id: p.meta.id, name: p.meta.name, tagline: p.meta.tagline, file: `pattern-${p.meta.id}.html` });
  }

  // パターン選択トップ。
  const cards = built
    .map(
      (b) => `<a class="pcard" href="${esc(b.file)}">
      <div class="pn">${esc(b.name)}</div>
      <div class="pt">${esc(b.tagline)}</div>
      <div class="pgo">開く →</div>
    </a>`,
    )
    .join('');
  const phase = data.session.month.phase;
  const indexBody = `
    <h1 style="font-size:clamp(22px,4vw,30px);font-weight:700;letter-spacing:-.01em;margin:2px 0 6px">${esc(data.school)}　練習計画</h1>
    <p style="color:var(--mute);font-size:14px;margin-bottom:8px">${data.month}月・${esc(phase)}　／　練習メニューは男女共通（コーチ1人が両方を見る）。組違い＝コーチ付き段を男女でずらして回す。見せ方を3パターン用意しました。</p>
    <div class="pgrid">${cards}</div>`;
  const indexCss = `
    .pgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-top:20px}
    .pcard{display:block;background:var(--surface);border-radius:22px;box-shadow:var(--shadow);padding:22px 22px;text-decoration:none;color:var(--ink);transition:transform .16s ease}
    .pcard:hover{transform:translateY(-3px)}
    .pn{font-size:18px;font-weight:700;margin-bottom:6px}
    .pt{font-size:13px;color:var(--mute);line-height:1.6;min-height:42px}
    .pgo{font-size:13px;color:var(--orange-deep);font-weight:700;margin-top:10px}`;
  writeFileSync(
    resolve(__dirname, 'index.html'),
    page({ title: `${data.school} 練習計画（男子・女子）`, css: indexCss, body: indexBody, script: '' }),
    'utf8',
  );

  process.stdout.write(`生成: ${built.length}パターン (${built.map((b) => b.id).join(', ')}) ＋ index.html\n`);
  if (data.warnings.length) process.stdout.write(`エンジン注記: ${data.warnings.length}件（空ブロック等・計画は生成済み）\n`);
}

main().catch((e) => {
  process.stderr.write(`UIビルド失敗: ${e.stack || e.message}\n`);
  process.exitCode = 1;
});
