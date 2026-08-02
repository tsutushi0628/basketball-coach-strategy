/**
 * @file 削除口の出し方（決定書 docs/specs/button-color-system-20260802-ruling-v5.md 3.2節が引く
 * 3.3節・承認済みモック docs/specs/button-roles-20260730.html）の業務意図を実ブラウザで固定する退行テスト。
 *
 * 背景: 製品はこれまで行・項目の削除口が常時むき出しで、1つの行に最大4個も並んでいた。体育館で
 * コーチがタブレットを指で滑らせただけで誤って触れる恐れがある。削除口は既定では見えず、触れて
 * いるものにだけ出す形へ変える。出る数の上限は、行に触れたときは行の削除口1つだけ、項目に触れた
 * ときは行と当該項目の2つまで（項目は行の子孫なので、項目に触れれば行にも触れているため）。
 *
 * 検証する業務意図（実装の途中値は写経しない。固定するのは「コーチから見た振る舞い」のみ）:
 *   (a)(b) 行の余白・行番号に触れる(マウス相当のhover)と、行の削除口1つだけが見える。
 *   (c)(d) Tab移動で焦点が当たると、row-top内なら行の削除口1つ、項目内なら項目＋行の2つが見える
 *       （どちらも3つ以上にならない）。
 *   (e)(f) タッチ実機相当（hasTouch, 820×1180）のタップでも同じ上限で出る（1回目のタップ＝出現）。
 *   (g) 削除口は既定で見えない(opacity:0・pointer-events:none)が、DOM上には実在し、読み上げ用の
 *       名前(aria-label)は常に残っている（visibility/displayで消していないことの証跡）。
 *
 * テスト基盤: node --test ＋ Playwright(chromium)。対象は build.mjs が出力する pattern-timeline.html の
 * 実DOM・実IIFE（editor.mjs の削除口実装本体）を直接駆動する。
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
const HTML = resolve(__dirname, 'pattern-timeline.delete-affordance.tmp.html');

let browser;
let page;

before(async () => {
  const data = await buildPlanData({ ...localStorages(), today: LOCAL_FIXTURE_TODAY });
  const { css, body } = render(data);
  writeFileSync(HTML, renderPage({ title: 'delete-affordance fixture', css, body }), 'utf8');
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.goto(pathToFileURL(HTML).href);
});

after(async () => {
  if (browser) await browser.close();
  if (existsSync(HTML)) unlinkSync(HTML);
});

async function openPanel() {
  await page.evaluate(() => window.__bcsEditor.openPanel());
  await page.waitForSelector('.ed-panel .ed-row', { timeout: 5000 });
}

async function closePanelForce() {
  await page.evaluate(() => { const c = document.querySelector('.ed-panel [data-act="cancel"]'); if (c) c.click(); });
  await page.evaluate(() => {
    const dlg = document.getElementById('ed-cd');
    if (dlg && !dlg.hidden) { const exec = document.getElementById('ed-cd-exec'); if (exec) exec.click(); }
  });
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

/** 行(ri)の中で opacity:1（見えている＝触れられる）状態の削除口の数を数える。 */
async function revealedDelCount(p, ri) {
  return p.evaluate((r) => {
    const row = document.querySelector(`.ed-panel .ed-row[data-ri="${r}"]`);
    if (!row) return -1;
    return [...row.querySelectorAll('.ed-del')].filter((d) => getComputedStyle(d).opacity === '1').length;
  }, ri);
}

/** 入力操作で残った「焦点」と「マウスカーソルの位置」を両方リセットする。fillCell は最後に
 * 触れた入力欄へ焦点を残し、Playwrightの操作はマウスカーソルもその座標に残す（:hover はカーソル
 * 位置で決まり、blur() では動かない）。「まだ何にも触れていない」まっさらな状態から検証を始める
 * には両方を明示的に外す必要がある。 */
async function blurActive(p) {
  await p.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
  await p.mouse.move(2, 2); // パネルの外（左上の何もない場所）へカーソルを退避する
}

// opacity の遷移は .12s（120ms）。computed style を読む前に遷移が完全に収まるまで待つ。
const SETTLE_MS = 220;

test('(a) 行の余白にマウスで触れる(hover)と、行の削除口1つだけが見える', async () => {
  await openPanel();
  const ri = await addRow();
  await fillCell(ri, '男子', 'アップ', ['ジョグ']);
  await fillCell(ri, '女子', 'シュート', ['フリースロー']);
  await blurActive(page); // 入力直後に残る焦点を外し、「まだ何にも触れていない」状態にする
  await page.waitForTimeout(SETTLE_MS);
  assert.equal(await revealedDelCount(page, ri), 0, '前提: 触れる前は何も見えていない');
  // row-top のうち、ボタン類が無い隙間（時計マーク/チェックボックスの並びの手前）を狙う。
  await page.hover(`.ed-panel .ed-row[data-ri="${ri}"] .ed-row-top`);
  await page.waitForTimeout(SETTLE_MS);
  assert.equal(await revealedDelCount(page, ri), 1, '行に触れると行の削除口1つだけが見える（項目には波及しない）');
  await closePanelForce();
});

test('(b) 行番号にマウスで触れる(hover)と、行の削除口1つだけが見える', async () => {
  await openPanel();
  const ri = await addRow();
  await fillCell(ri, '男子', 'アップ', ['ジョグ']);
  await fillCell(ri, '女子', 'シュート', ['フリースロー']);
  await blurActive(page);
  await page.hover(`.ed-panel .ed-row[data-ri="${ri}"] .ed-rownum`);
  await page.waitForTimeout(SETTLE_MS);
  assert.equal(await revealedDelCount(page, ri), 1, '行番号に触れても行の削除口1つだけが見える（項目には波及しない）');
  await closePanelForce();
});

test('(c) Tab移動で行の時間欄（row-top内）に焦点が当たると、行の削除口1つだけが見える', async () => {
  await openPanel();
  const ri = await addRow();
  await fillCell(ri, '男子', 'アップ', ['ジョグ']);
  await fillCell(ri, '女子', 'シュート', ['フリースロー']);
  await blurActive(page);
  await page.focus(`.ed-panel .ed-row[data-ri="${ri}"] [data-k="from"]`);
  await page.waitForTimeout(SETTLE_MS);
  assert.equal(await revealedDelCount(page, ri), 1, 'row-top内の入力欄に焦点が当たると行の削除口だけが見える');
  await closePanelForce();
});

test('(d) Tab移動で項目のドリル名欄に焦点が当たると、項目＋行の削除口の2つが見える（3つ以上にならない）', async () => {
  await openPanel();
  const ri = await addRow();
  await fillCell(ri, '男子', 'アップ', ['ジョグ', 'ストレッチ']); // 男子2項目・女子は空のまま
  await fillCell(ri, '女子', 'シュート', ['フリースロー']);
  await blurActive(page);
  await page.focus(`.ed-panel .ed-cell[data-ri="${ri}"][data-side="男子"] .ed-item[data-ii="0"] [data-k="name"]`);
  await page.waitForTimeout(SETTLE_MS);
  assert.equal(await revealedDelCount(page, ri), 2, '項目に焦点が当たると項目＋行の削除口が2つ見える（他の項目には波及しない・3つ以上出ない）');
  await closePanelForce();
});

test('(e) タッチ実機相当(hasTouch, 820×1180)で行の余白をタップすると、行の削除口1つだけが見える', async () => {
  const ctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true });
  const tp = await ctx.newPage();
  await tp.goto(pathToFileURL(HTML).href);
  await tp.evaluate(() => window.__bcsEditor.openPanel());
  await tp.waitForSelector('.ed-panel .ed-row', { timeout: 5000 });
  await tp.click('.ed-panel [data-act="add-row"]');
  await tp.waitForFunction(() => document.querySelectorAll('.ed-panel .ed-row').length > 0);
  const ri = await tp.$$eval('.ed-panel .ed-row', (rs) => rs.length - 1);
  const base = `.ed-panel .ed-cell[data-ri="${ri}"][data-side="男子"]`;
  await (await tp.$(`${base} [data-k="label"]`)).fill('アップ');
  await tp.click(`${base} [data-act="add-item"]`);
  await tp.waitForSelector(`${base} .ed-item[data-ii="0"] [data-k="name"]`);
  await (await tp.$(`${base} .ed-item[data-ii="0"] [data-k="name"]`)).fill('ジョグ');
  await blurActive(tp);
  await tp.waitForTimeout(SETTLE_MS);

  // 「行の余白」＝row-top内の各ボタン・入力欄のどれでもない場所。.ed-row 自体の内側余白
  // （padding-top:13px/padding-left:15px）はどの子要素とも重ならないので、その角を狙えば
  // 押せる部品を経由せず確実に行の余白へ触れられる。
  await tp.tap(`.ed-panel .ed-row[data-ri="${ri}"]`, { position: { x: 5, y: 5 } });
  await tp.waitForTimeout(SETTLE_MS);
  const n = await revealedDelCount(tp, ri);
  assert.equal(n, 1, 'タッチで行の余白をタップすると行の削除口1つだけが見える（1回目のタップ＝出現）');
  await ctx.close();
});

test('(f) タッチ実機相当(hasTouch, 820×1180)で項目のドリル名欄をタップすると、項目＋行の2つが見える（3つ以上にならない）', async () => {
  const ctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true });
  const tp = await ctx.newPage();
  await tp.goto(pathToFileURL(HTML).href);
  await tp.evaluate(() => window.__bcsEditor.openPanel());
  await tp.waitForSelector('.ed-panel .ed-row', { timeout: 5000 });
  await tp.click('.ed-panel [data-act="add-row"]');
  await tp.waitForFunction(() => document.querySelectorAll('.ed-panel .ed-row').length > 0);
  const ri = await tp.$$eval('.ed-panel .ed-row', (rs) => rs.length - 1);
  const base = `.ed-panel .ed-cell[data-ri="${ri}"][data-side="男子"]`;
  await (await tp.$(`${base} [data-k="label"]`)).fill('アップ');
  await tp.click(`${base} [data-act="add-item"]`);
  await tp.waitForSelector(`${base} .ed-item[data-ii="0"] [data-k="name"]`);
  await (await tp.$(`${base} .ed-item[data-ii="0"] [data-k="name"]`)).fill('ジョグ');
  await blurActive(tp);
  await tp.waitForTimeout(SETTLE_MS);

  await tp.tap(`${base} .ed-item[data-ii="0"] [data-k="name"]`);
  await tp.waitForTimeout(SETTLE_MS);
  const n = await revealedDelCount(tp, ri);
  assert.equal(n, 2, 'タッチで項目に触れると項目＋行の削除口が2つ見える（1回目のタップ＝出現。3つ以上出ない）');
  await ctx.close();
});

test('(g) 削除口は既定で見えない(opacity:0・pointer-events:none)が、DOM上には実在し、読み上げ用の名前(aria-label)が常に残る', async () => {
  await openPanel();
  const ri = await addRow();
  await fillCell(ri, '男子', 'アップ', ['ジョグ']);
  await blurActive(page);
  await page.waitForTimeout(SETTLE_MS);
  const info = await page.evaluate((r) => {
    const row = document.querySelector(`.ed-panel .ed-row[data-ri="${r}"]`);
    const rowDel = row.querySelector('.ed-row-top .ed-del');
    const itemDel = row.querySelector('.ed-item .ed-del');
    const cs = getComputedStyle(rowDel);
    return {
      opacity: cs.opacity,
      pointerEvents: cs.pointerEvents,
      display: cs.display,
      visibility: cs.visibility,
      rowAriaLabel: rowDel.getAttribute('aria-label'),
      itemAriaLabel: itemDel ? itemDel.getAttribute('aria-label') : null,
    };
  }, ri);
  assert.equal(info.opacity, '0', '既定では見えない(opacity:0)');
  assert.equal(info.pointerEvents, 'none', '既定ではクリックも受け付けない（誤タップ防止）');
  assert.notEqual(info.display, 'none', 'display:noneでは消していない（支援技術の読み上げ順から外さない）');
  assert.notEqual(info.visibility, 'hidden', 'visibility:hiddenでも消していない（同上）');
  assert.equal(info.rowAriaLabel, 'この時間を削除', '見えない状態でも行の削除口の読み上げ名(aria-label)は残っている');
  assert.equal(info.itemAriaLabel, '項目を削除', '見えない状態でも項目の削除口の読み上げ名(aria-label)は残っている');
  await closePanelForce();
});
