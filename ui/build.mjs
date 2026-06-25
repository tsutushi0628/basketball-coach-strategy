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

import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFileSync, readdirSync } from 'node:fs';

import { createLocalStorage } from '../engine/src/storage.js';
import { buildPlanData } from './plan-data.mjs';
import { esc, renderPage } from './render-shared.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const engineRoot = resolve(__dirname, '../engine');
const repoRoot = resolve(__dirname, '..');

/**
 * 静的ビルド用のローカル storage を組む（ドリル台帳は docs 配下・config は男女別）。
 * Cloud Function は同じ buildPlanData を Firestore storage で呼ぶ（build.mjs はローカルJSON固定）。
 * @returns {{storage: import('../engine/src/storage.js').Storage, girlsStorage: import('../engine/src/storage.js').Storage}}
 */
export function localStorages() {
  const drillsPath = resolve(repoRoot, 'docs/practice-knowledge/data/drills.json');
  const storage = createLocalStorage({
    drillsPath,
    configPath: resolve(engineRoot, 'data/config.sample.json'),
    inputPath: resolve(engineRoot, 'data/team-input.sample.json'),
    overridesPath: resolve(engineRoot, 'data/overrides.json'),
    annualPath: resolve(engineRoot, 'data/annual-plan.json'),
  });
  const girlsStorage = createLocalStorage({
    drillsPath,
    configPath: resolve(engineRoot, 'data/config.girls.sample.json'),
    inputPath: resolve(engineRoot, 'data/team-input.girls.sample.json'),
    annualPath: resolve(engineRoot, 'data/annual-plan.json'),
  });
  return { storage, girlsStorage };
}

async function main() {
  const data = await buildPlanData(localStorages());

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
    const html = renderPage({
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
    <p style="color:var(--mute);font-size:14px;margin-bottom:8px">${data.month}月・${esc(phase)}</p>
    <div class="pgrid">${cards}</div>`;
  // T5: pcard は surface+line-2（shadow廃止）・17px（H2段）
  const indexCss = `
    .pgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-top:20px}
    .pcard{display:block;background:var(--surface);border-radius:14px;border:1px solid var(--line-2);padding:22px;text-decoration:none;color:var(--ink);transition:transform .16s ease}
    .pcard:hover{transform:translateY(-3px)}
    .pn{font-size:17px;font-weight:700;margin-bottom:6px}
    .pt{font-size:12px;color:var(--mute);line-height:1.6;min-height:42px}
    .pgo{font-size:12px;color:var(--orange-deep);font-weight:700;margin-top:10px}`;
  writeFileSync(
    resolve(__dirname, 'index.html'),
    renderPage({ title: `${data.school} 練習計画（男子・女子）`, css: indexCss, body: indexBody, script: '' }),
    'utf8',
  );

  process.stdout.write(`生成: ${built.length}パターン (${built.map((b) => b.id).join(', ')}) ＋ index.html\n`);
  if (data.warnings.length) process.stdout.write(`エンジン注記: ${data.warnings.length}件（空ブロック等・計画は生成済み）\n`);
}

// 直接実行時（node ui/build.mjs）のみ静的ビルドを走らせる。
// Cloud Function が renderPage / localStorages を import するときは main() を起動しない。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    process.stderr.write(`UIビルド失敗: ${e.stack || e.message}\n`);
    process.exitCode = 1;
  });
}
