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

test('a mixed post-save preview keeps matching rows in one column and splits only the differing rows', async () => {
  const html = await page.evaluate(() => {
    const same = { block: 'ファンダ', label: '基礎', items: [{ name: '共通ドリル', note: '' }] };
    const ov = { date: '2026-06-23', weekday: '火', court: '全面', aim: '', rows: [
      { from: '16:00', to: '16:20', 男子: same, 女子: structuredClone(same) },
      {
        from: '16:20', to: '16:40',
        男子: { block: 'シュート', label: 'シュート', items: [{ name: '男子だけ', note: '' }] },
        女子: { block: 'ラン', label: 'ラン', items: [{ name: '女子だけ', note: '' }] },
      },
    ] };
    const article = document.createElement('article');
    window.__bcsEditor.renderDay(article, ov);
    return article.innerHTML;
  });
  assert.match(html, /id="plan-top" class="spine spine-only"/, '親spineは常に左端レールの1列モード');
  // class="tc2-bn"で視覚バンド側だけを見る（.plainのコピー用テキスト側の重複はカウントしない）。
  assert.equal((html.match(/class="tc2-bn">共通ドリル/g) || []).length, 1, '一致行の内容は左右に複製されない');
  assert.match(html, /spine-row spine-rotation tc2-only tc2-split/, '相違行だけ2列に割れる');
  assert.equal((html.match(/tc2-runhead/g) || []).length, 1, '相違区間の先頭にだけ見出しが1回出る');
});

test('a fully differing preview keeps every row split with a single leading heading', async () => {
  const html = await page.evaluate(() => {
    const ov = { date: '2026-06-23', weekday: '火', court: '全面', aim: '', rows: [
      { from: '16:00', to: '16:20', 男子: { block: 'ラン', label: 'ラン', items: [{ name: '男子A', note: '' }] }, 女子: { block: 'ラン', label: 'ラン', items: [{ name: '女子A', note: '' }] } },
      { from: '16:20', to: '16:40', 男子: { block: 'ラン', label: 'ラン', items: [{ name: '男子B', note: '' }] }, 女子: { block: 'ラン', label: 'ラン', items: [{ name: '女子B', note: '' }] } },
    ] };
    const article = document.createElement('article');
    window.__bcsEditor.renderDay(article, ov);
    return article.innerHTML;
  });
  assert.equal((html.match(/spine-row spine-rotation tc2-only tc2-split/g) || []).length, 2, '全行が2列のまま');
  assert.equal((html.match(/tc2-runhead/g) || []).length, 1, '連続する全行相違は見出し1回にまとまる');
  assert.doesNotMatch(html, /spine-band right/, '中央固定の左右ミラーは出さない');
});
