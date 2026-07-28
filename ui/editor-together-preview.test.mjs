import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildPlanData } from './plan-data.mjs';
import { localStorages, LOCAL_FIXTURE_TODAY } from './build.mjs';
import { render } from './pattern-timeline.mjs';
import { renderPage } from './render-shared.mjs';

const HTML = join(process.cwd(), 'ui', '.editor-together-preview.test.html');
let browser;
let page;

before(async () => {
  const data = await buildPlanData({ ...localStorages(), today: LOCAL_FIXTURE_TODAY });
  const { css, body } = render(data);
  writeFileSync(HTML, renderPage({ title: 'editor together preview', css, body }), 'utf8');
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.goto(pathToFileURL(HTML).href);
});

after(async () => {
  await browser?.close();
  try { unlinkSync(HTML); } catch {}
});

test('raw identical gender cells use the one-column editor preview', async () => {
  const html = await page.evaluate(() => {
    const cell = { block: 'ファンダ', label: '基礎', items: [{ name: 'パス', note: '正確に' }] };
    const ov = { date: '2026-06-23', weekday: '火', court: '全面', aim: '', rows: [
      { from: '16:00', to: '16:20', 男子: cell, 女子: structuredClone(cell) },
      { from: '16:20', to: '16:40', 男子: cell, 女子: structuredClone(cell) },
    ] };
    const article = document.createElement('article');
    window.__bcsEditor.renderDay(article, ov);
    return article.innerHTML;
  });
  assert.match(html, /id="plan-top" class="spine spine-only"/);
  assert.match(html, /基礎|パス/, 'raw gender cell content is retained in the one-column band');
  assert.doesNotMatch(html, /spine-header|spine-band right|tc2-split/);
});
