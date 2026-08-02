/**
 * @file 確認カード（決定書 docs/specs/button-color-system-20260802-ruling-v5.md 3.2節・
 * 承認済みモック docs/specs/button-roles-20260730.html）の業務意図を実ブラウザで固定する退行テスト。
 *
 * 背景: 製品はこれまで行・項目の削除ボタンを押すと確認なしでその場で消えていた。「自動生成に戻す」
 * だけはブラウザ標準のwindow.confirmを使っていたが文言が決定書と合っていなかった。承認済みモックに
 * ある確認カード（失うものの名前を出して押した瞬間の実行を止める）を、行の削除／項目の削除／
 * 自動生成に戻す／キャンセル（未保存の変更を捨てる）の4つに製品実装として移す。
 *
 * 検証する業務意図（実装の途中値は写経しない）:
 *   (a)(c)(e)(f) 4つのきっかけそれぞれで確認カードが開き、見出し・本文・実行ラベルがモックの
 *       文言（WORDS）と一致する。行・項目は対象を名指しした動的な見出しになる。
 *   「やめる」を押すと対象は消えず、「実行」を押して初めて消える。
 *   (b)(d)(e2)(g) 対象が空のときは確認カードを出さず即実行する。
 *   (h) 開くとカードへ焦点が移り、Tabは確認カード内を巡回する（背後を操作できない）。Escで閉じる。
 *
 * テスト基盤: node --test ＋ Playwright(chromium)。対象は build.mjs が出力する pattern-timeline.html の
 * 実DOM・実IIFE（editor.mjs の確認カード実装本体）を直接駆動する。
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
const HTML = resolve(__dirname, 'pattern-timeline.confirm-dialog.tmp.html');

let browser;
let page;

before(async () => {
  const data = await buildPlanData({ ...localStorages(), today: LOCAL_FIXTURE_TODAY });
  const { css, body } = render(data);
  writeFileSync(HTML, renderPage({ title: 'confirm-dialog fixture', css, body }), 'utf8');
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.goto(pathToFileURL(HTML).href);
});

after(async () => {
  if (browser) await browser.close();
  if (existsSync(HTML)) unlinkSync(HTML);
});

/** 現在表示中の日の編集パネルを開く。 */
async function openPanel() {
  await page.evaluate(() => window.__bcsEditor.openPanel());
  await page.waitForSelector('.ed-panel .ed-row', { timeout: 5000 });
}

/** 開いたままの確認カードがあれば実行して閉じ切り、パネルをキャンセルで畳む（次シナリオの独立性確保）。 */
async function closePanelForce() {
  await page.evaluate(() => {
    const dlg = document.getElementById('ed-cd');
    if (dlg && !dlg.hidden) { const exec = document.getElementById('ed-cd-exec'); if (exec) exec.click(); }
  });
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

async function setTimes(ri, from, to) {
  const rowSel = `.ed-panel .ed-row[data-ri="${ri}"]`;
  await page.fill(`${rowSel} [data-k="from"]`, from);
  await page.fill(`${rowSel} [data-k="to"]`, to);
}

async function rowCount() { return page.$$eval('.ed-panel .ed-row', (rs) => rs.length); }

/** 確認カードの見出し・本文・実行ラベルを読む。 */
async function cdTexts() {
  return page.evaluate(() => ({
    h: document.getElementById('ed-cd-h')?.textContent ?? '',
    b: document.getElementById('ed-cd-b')?.textContent ?? '',
    x: document.getElementById('ed-cd-execlabel')?.textContent ?? '',
  }));
}

test('(a) 行の削除: 中身がある行のごみ箱を押すと確認カードが開き、時間帯を名指しした見出しが出る。やめるでは消えず実行で初めて消える', async () => {
  await openPanel();
  const ri = await addRow();
  await setTimes(ri, '17:00', '17:20');
  await fillCell(ri, '男子', 'アップ', ['ジョグ']);
  await page.click(`.ed-panel .ed-row[data-ri="${ri}"] [data-act="del-row"]`);
  await page.waitForSelector('#ed-cd:not([hidden])', { timeout: 3000 });
  const t = await cdTexts();
  assert.equal(t.h, `時間${ri + 1}（17:00〜17:20）を削除します。`, '見出しがモックの文言パターン（時間N（開始〜終了）を削除します。）どおり、実際の行番号・時刻で出る');
  assert.equal(t.b, 'この時間に入れた項目もいっしょに消えます。', '本文がモックの文言と一致する');
  assert.equal(t.x, '削除する', '実行ラベルがモックの文言と一致する');
  const beforeCount = await rowCount();
  await page.click('#ed-cd .rc-cancel');
  await page.waitForTimeout(100);
  assert.equal(await rowCount(), beforeCount, '「やめる」を押しただけでは行は消えない');
  await page.click(`.ed-panel .ed-row[data-ri="${ri}"] [data-act="del-row"]`);
  await page.waitForSelector('#ed-cd:not([hidden])', { timeout: 3000 });
  await page.click('#ed-cd-exec');
  await page.waitForTimeout(100);
  assert.equal(await rowCount(), beforeCount - 1, '「実行」を押すと初めて行が消える');
  await closePanelForce();
});

test('(b) 行の削除: 空行（時刻も中身も無い）のごみ箱は確認カードを出さず即削除する', async () => {
  await openPanel();
  const ri = await addRow(); // 時刻も中身も入れない＝空行
  const before = await rowCount();
  await page.click(`.ed-panel .ed-row[data-ri="${ri}"] [data-act="del-row"]`);
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#ed-cd').isHidden(), true, '確認カードは開かない');
  assert.equal(await rowCount(), before - 1, '空行は確認なしで即削除される');
  await closePanelForce();
});

test('(c) 項目の削除: 中身がある項目のごみ箱を押すと確認カードが開き、項目名を名指しした見出しが出る。やめるでは消えず実行で初めて消える', async () => {
  await openPanel();
  const ri = await addRow();
  await setTimes(ri, '18:00', '18:20');
  await fillCell(ri, '男子', 'アップ', ['動的ストレッチ']);
  const itemSel = `.ed-panel .ed-cell[data-ri="${ri}"][data-side="男子"] .ed-item[data-ii="0"]`;
  await page.click(`${itemSel} [data-act="del-item"]`);
  await page.waitForSelector('#ed-cd:not([hidden])', { timeout: 3000 });
  const t = await cdTexts();
  assert.equal(t.h, 'この項目（動的ストレッチ）を削除します。', '見出しに実際の項目名が入る（モックの文言パターンどおり）');
  assert.equal(t.b, '補足に書いた内容もいっしょに消えます。', '本文がモックの文言と一致する');
  await page.click('#ed-cd .rc-cancel');
  await page.waitForTimeout(100);
  const namesAfterCancel = await page.$$eval(`.ed-panel .ed-cell[data-ri="${ri}"][data-side="男子"] .ed-item [data-k="name"]`, (els) => els.map((e) => e.value));
  assert.deepEqual(namesAfterCancel, ['動的ストレッチ'], '「やめる」を押しただけでは項目は消えない');
  await page.click(`${itemSel} [data-act="del-item"]`);
  await page.waitForSelector('#ed-cd:not([hidden])', { timeout: 3000 });
  await page.click('#ed-cd-exec');
  await page.waitForTimeout(100);
  const namesAfterExec = await page.$$eval(`.ed-panel .ed-cell[data-ri="${ri}"][data-side="男子"] .ed-item [data-k="name"]`, (els) => els.map((e) => e.value));
  assert.deepEqual(namesAfterExec, [], '「実行」を押すと初めて項目が消える');
  await closePanelForce();
});

test('(d) 項目の削除: 空項目（名前もメモも無い）のごみ箱は確認カードを出さず即削除する', async () => {
  await openPanel();
  const ri = await addRow();
  await setTimes(ri, '19:00', '19:20');
  await fillCell(ri, '男子', 'アップ', []);
  await page.click(`.ed-panel .ed-cell[data-ri="${ri}"][data-side="男子"] [data-act="add-item"]`);
  await page.waitForSelector(`.ed-panel .ed-cell[data-ri="${ri}"][data-side="男子"] .ed-item[data-ii="0"]`);
  await page.click(`.ed-panel .ed-cell[data-ri="${ri}"][data-side="男子"] .ed-item[data-ii="0"] [data-act="del-item"]`);
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#ed-cd').isHidden(), true, '確認カードは開かない');
  const count = await page.$$eval(`.ed-panel .ed-cell[data-ri="${ri}"][data-side="男子"] .ed-item`, (els) => els.length);
  assert.equal(count, 0, '空項目は確認なしで即削除される');
  await closePanelForce();
});

test('(e) 自動生成に戻す: 中身がある日は確認カードが開き、モックと同じ文言が出る。やめるでは削除フローに入らない', async () => {
  await openPanel();
  const ri = await addRow();
  await setTimes(ri, '20:00', '20:20');
  await fillCell(ri, '男子', 'アップ', ['ジョグ']);
  await page.evaluate(() => { const el = document.getElementById('ed-msg'); if (el) el.textContent = ''; });
  await page.click('.ed-panel [data-act="revert-auto"]');
  await page.waitForSelector('#ed-cd:not([hidden])', { timeout: 3000 });
  const t = await cdTexts();
  assert.equal(t.h, '手で入れた内容を捨てて自動生成に戻します。', '見出しがモックの文言と一致する');
  assert.equal(t.b, 'この日に手で入れた時間と項目がすべて消えます。', '本文がモックの文言と一致する');
  assert.equal(t.x, '捨てて戻す', '実行ラベルがモックの文言と一致する');
  await page.click('#ed-cd .rc-cancel');
  await page.waitForTimeout(150);
  const msg = (await page.locator('#ed-msg').textContent()) || '';
  assert.doesNotMatch(msg, /バックエンド未接続|自動に戻して/, '「やめる」を押すと削除フローに入らない');
  await closePanelForce();
});

test('(e2) 自動生成に戻す: 何も手を入れていない日は確認カードを出さず即座に削除フローへ進む', async () => {
  await openPanel(); // 何も編集しない
  await page.evaluate(() => { const el = document.getElementById('ed-msg'); if (el) el.textContent = ''; });
  await page.click('.ed-panel [data-act="revert-auto"]');
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#ed-cd').isHidden(), true, '確認カードは開かない');
  // file:// 実行でバックエンド無しのため、最終的に「バックエンド未接続」の案内文が出ることをもって、
  // 削除フロー（サーバへのfetch）が確認なしで即座に発火したことの証跡とする。
  await page.waitForFunction(
    () => (document.getElementById('ed-msg')?.textContent || '').includes('バックエンド未接続'),
    { timeout: 5000 },
  );
  await closePanelForce();
});

test('(f) キャンセル: 未保存の入力がある状態では確認カードが開き、モックと同じ文言が出る。実行で初めて閉じる', async () => {
  await openPanel();
  const ri = await addRow();
  await setTimes(ri, '21:00', '21:20');
  await fillCell(ri, '男子', 'アップ', ['ジョグ']);
  await page.click('.ed-panel [data-act="cancel"]');
  await page.waitForSelector('#ed-cd:not([hidden])', { timeout: 3000 });
  const t = await cdTexts();
  assert.equal(t.h, '保存していない入力を捨てて編集を閉じます。', '見出しがモックの文言と一致する');
  assert.equal(t.b, '最後に保存した状態に戻ります。', '本文がモックの文言と一致する');
  assert.equal(t.x, '捨てて閉じる', '実行ラベルがモックの文言と一致する');
  assert.equal(await page.locator('.ed-panel').count(), 1, '「やめる」を押す前はパネルはまだ開いている');
  await page.click('#ed-cd .rc-cancel');
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.ed-panel').count(), 1, '「やめる」を押してもパネルは閉じない');
  await page.click('.ed-panel [data-act="cancel"]');
  await page.waitForSelector('#ed-cd:not([hidden])', { timeout: 3000 });
  await page.click('#ed-cd-exec');
  await page.waitForTimeout(150);
  assert.equal(await page.locator('.ed-panel').count(), 0, '「実行」を押すと初めてパネルが閉じる');
});

test('(g) キャンセル: 何も入力していない空のパネルでは確認カードを出さず即座に閉じる', async () => {
  await openPanel(); // 何も編集しない
  await page.click('.ed-panel [data-act="cancel"]');
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#ed-cd').isHidden(), true, '確認カードは開かない');
  assert.equal(await page.locator('.ed-panel').count(), 0, '空のときは確認なしで即座に閉じる');
});

test('(h) キーボード操作: 開くとカードへ焦点が移り、Tabは確認カード内だけを巡回し（背後を操作できない）、Escで閉じる', async () => {
  await openPanel();
  const ri = await addRow();
  await setTimes(ri, '22:00', '22:20');
  await fillCell(ri, '男子', 'アップ', ['ジョグ']);
  await page.click(`.ed-panel .ed-row[data-ri="${ri}"] [data-act="del-row"]`);
  await page.waitForSelector('#ed-cd:not([hidden])', { timeout: 3000 });

  const focusedIsCard = await page.evaluate(() => document.activeElement && document.activeElement.id === 'ed-cd-card');
  assert.equal(focusedIsCard, true, 'カードが開いたらカードの箱に焦点が移る');

  // 背後（確認カードの下に隠れている「＋時間を追加」ボタン）の座標は、確認カード側の要素が受け取る
  // ＝ポインタで背後を直接操作できない（覆いが物理的に上に乗っている）。
  const blockedByOverlay = await page.evaluate(() => {
    const btn = document.querySelector('.ed-panel [data-act="add-row"]');
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !(btn === el || btn.contains(el));
  });
  assert.equal(blockedByOverlay, true, '背後のボタンの座標は確認カード側の要素が受け取り、直接操作できない');

  // Tabを何度押しても、焦点は確認カード内の「やめる」「実行」の2つだけを行き来する（背後に出ない）。
  const focusClasses = [];
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab');
    focusClasses.push(await page.evaluate(() => (document.activeElement && document.activeElement.className) || ''));
  }
  assert.ok(
    focusClasses.every((c) => c.includes('rc-cancel') || c.includes('rc-exec')),
    'Tabで巡回する焦点は確認カード内の「やめる」「実行」だけ（実測: ' + focusClasses.join(' / ') + '）',
  );

  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#ed-cd').isHidden(), true, 'Escで閉じる');
  const beforeCount = await rowCount();
  assert.equal(beforeCount > 0, true, 'Escで閉じただけでは対象(行)は消えない（やめると同義）');
  await closePanelForce();
});
