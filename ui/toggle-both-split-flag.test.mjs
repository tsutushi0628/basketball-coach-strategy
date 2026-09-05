/**
 * @file 「共通ON→OFF」で男女別に分けた行に split:true が立ち、再度「共通ON」で消える、という
 * 業務意図の退行テスト（不具合4・(4-4)）。
 *
 * 背景の事故（原因確定済み）: editor.mjs:1001-1013 splitFromBoth（共通OFF）は男女別へ複製するだけで
 * split フラグを立てない。そのため描画側 isTogetherRow が「男女同一内容」の複製行を誤って共通行と
 * 判定してしまう（two-col-together-split-flag.test.mjs / pattern-timeline-split-flag.test.mjs が
 * その描画結果を固定）。本ファイルは「モデル操作の往復で split フラグ自体がいつ立ち・いつ消えるか」を
 * 実IIFE（editor.mjs の toggle-both ハンドラ）で固定する。
 *
 * 対応後に固定する業務意図:
 *   - 共通ON（mergeToBoth, editor.mjs:978-997）: row.split は立っていない（both 行に split は無関係）。
 *   - 共通OFF（splitFromBoth, editor.mjs:1001-1013）: row.split=true を立てる（複製由来の印）。
 *   - 再び共通ON（mergeToBoth）: row.split は消える（both へ戻る＝split は男女別行だけの印）。
 *
 * 対応前の現状（本ファイル作成時点で実走確認済み）: splitFromBoth が split を一切セットしないため、
 * 共通OFF後も row.split が truthy にならず失敗する。
 *
 * テスト基盤: node --test + Playwright（toggle-both-no-loss.test.mjs と同型のIIFE駆動）。
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';

import { buildPlanData } from './plan-data.mjs';
import { localStorages, LOCAL_FIXTURE_TODAY } from './build.mjs';
import { render } from './pattern-timeline.mjs';
import { renderPage } from './render-shared.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML = resolve(__dirname, 'pattern-timeline.toggle-both-split-flag.tmp.html');
const DATE = '2026-06-23';

let browser;
let page;

before(async () => {
  const data = await buildPlanData({ ...localStorages(), today: LOCAL_FIXTURE_TODAY });
  const { css, body } = render(data);
  writeFileSync(HTML, renderPage({ title: 'toggle-both split-flag fixture', css, body }), 'utf8');
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.goto(pathToFileURL(HTML).href);
});

after(async () => {
  if (browser) await browser.close();
  if (existsSync(HTML)) unlinkSync(HTML);
});

async function openPanel() {
  await page.evaluate((d) => {
    document.querySelectorAll('.day[data-date]').forEach((p) => { p.hidden = p.getAttribute('data-date') !== d; });
    const target = document.querySelector(`.day[data-date="${d}"]`);
    const wk = target && target.closest('.daywk');
    if (wk) document.querySelectorAll('.daywk[data-week]').forEach((g) => { g.hidden = g !== wk; });
  }, DATE);
  await page.evaluate(() => window.__bcsEditor.openPanel());
  await page.waitForSelector('.ed-panel .ed-row', { timeout: 5000 });
}

async function addRow() {
  await page.click('.ed-panel [data-act="add-row"]');
  await page.waitForFunction(() => document.querySelectorAll('.ed-panel .ed-row').length > 0);
  await page.waitForTimeout(50);
  return page.$$eval('.ed-panel .ed-row', (rs) => rs.length - 1);
}

async function fillCell(ri, side, label, names) {
  const base = `.ed-panel .ed-cell[data-ri="${ri}"][data-side="${side}"]`;
  if (label != null) await (await page.$(`${base} [data-k="label"]`)).fill(label);
  for (let k = 0; k < names.length; k++) {
    const ns = `${base} .ed-item[data-ii="${k}"] [data-k="name"]`;
    let el = await page.$(ns);
    if (!el) { await page.click(`${base} [data-act="add-item"]`); await page.waitForSelector(ns); el = await page.$(ns); }
    await el.fill(names[k]);
  }
}

async function setBoth(ri, want) {
  const sel = `.ed-panel .ed-row[data-ri="${ri}"] [data-act="toggle-both"]`;
  const cur = await page.$eval(sel, (b) => b.checked);
  if (cur !== want) await page.click(sel);
  await page.waitForTimeout(60);
}

async function rowSplitFlag(ri) {
  return page.evaluate((ri) => !!window.__bcsEditor.model().rows[ri].split, ri);
}

test('共通ON→OFF→ONの往復: OFF直後は split:true が立ち、再度ONで split が消える', async () => {
  await openPanel();
  const ri = await addRow();
  await fillCell(ri, '男子', '男子見出し', ['男ドリA']);
  await fillCell(ri, '女子', '女子見出し', ['女ドリA']);

  await setBoth(ri, true); // mergeToBoth
  assert.equal(await rowSplitFlag(ri), false, '共通ON直後（both行）は split が立っていない');

  await setBoth(ri, false); // splitFromBoth
  // 原因行由来の失敗確認ポイント: editor.mjs:1001-1013 splitFromBoth は split を一切セットしない。
  assert.equal(await rowSplitFlag(ri), true, '共通OFF直後（複製された男女別行）は split:true が立つ');

  await setBoth(ri, true); // 再度 mergeToBoth
  assert.equal(await rowSplitFlag(ri), false, '再度共通ONにすると split は消える（both行に split は不要）');

  await page.evaluate(() => { document.querySelector('.ed-panel [data-act="cancel"]').click(); });
  await page.evaluate(() => {
    const dlg = document.getElementById('ed-cd');
    if (dlg && !dlg.hidden) { const exec = document.getElementById('ed-cd-exec'); if (exec) exec.click(); }
  });
});

test('男女に別内容を手入力しただけ（共通ONを一度も経由しない）行には split が立たない（非回帰）', async () => {
  await openPanel();
  const ri = await addRow();
  await fillCell(ri, '男子', '手入力男子', ['男ドリB']);
  await fillCell(ri, '女子', '手入力女子', ['女ドリB']);
  assert.equal(await rowSplitFlag(ri), false, '共通OFF経由でない男女別行は split フラグを持たない');

  await page.evaluate(() => { document.querySelector('.ed-panel [data-act="cancel"]').click(); });
  await page.evaluate(() => {
    const dlg = document.getElementById('ed-cd');
    if (dlg && !dlg.hidden) { const exec = document.getElementById('ed-cd-exec'); if (exec) exec.click(); }
  });
});
