/**
 * @file 「男女共通」チェックの切替で練習内容を絶対に失わない、という業務意図を実ブラウザで固定する退行テスト。
 *
 * 背景の事故（オーナー一次情報）: 女子だけ組んだメニューを「やっぱり男女共通だった」と共通ONにすると、
 * 中身が両方とも消えて組み直しになる。原因は共通ONのseedが片側のみ採用で他方を捨て（マージしない）、
 * さらに共通OFFが both を男女両方へ複製して元の別内容を上書き破壊していたこと（往復で消える）。
 *
 * 検証する業務意図（実装の途中値は写経しない）:
 *   (a) 女子だけ内容→共通ON: その内容が共通(both)セルに残る。
 *   (b) 男子だけ内容→共通ON: その内容が共通(both)セルに残る。
 *   (c) 男女に別内容→共通ON: 両方の項目が共通(both)にマージされ、どちらも失われない。
 *   (d) 男女別→ON→OFF→ON 往復: OFFで元の男女別内容が distinct に復元され、再ONで再びマージ。消えない。
 *   (e) 両側空→共通ON: 共通は空（失う内容が無い）。クラッシュしない。
 *   保存スキーマ互換: 共通時は both が、男女別時は 男子/女子 が、入力どおり保存経路に乗る（cleanCell相当）。
 *
 * テスト基盤: node --test ＋ Playwright(chromium)。対象は build.mjs が出力する pattern-timeline.html の
 * 実DOM・実IIFE（editor.mjs の toggle-both ハンドラ本体）を直接駆動する。データは overrides.json のコーチ
 * 上書き日(2026-06-23)＝実データ。ビルド済みHTMLが無ければ skip ではなく前提エラーにする（CIは build 後に走る）。
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML = resolve(__dirname, 'pattern-timeline.html');
const DATE = '2026-06-23'; // overrides.json のコーチ上書き日（twoCol・編集可能）

let browser;
let page;

before(async () => {
  assert.ok(existsSync(HTML), 'pattern-timeline.html がビルド済みであること（node ui/build.mjs を先に実行）');
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.goto(pathToFileURL(HTML).href);
});

after(async () => { if (browser) await browser.close(); });

/** 対象日の編集パネルを開く（curDay＝hidden でない最初の .day に揃える）。
 * 対象日が属する週グループ（.daywk）も合わせて可視にする（多週描画は表示中の週グループだけが
 * 可視という不変条件を持つため、日を可視にしても所属週グループが隠れたままだと描画されない）。 */
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

/** パネルを閉じる（次シナリオを独立させる）。 */
async function closePanel() {
  await page.evaluate(() => { const c = document.querySelector('.ed-panel [data-act="cancel"]'); if (c) c.click(); });
}

/** 末尾に新規の空行を1つ足し、その行インデックスを返す（各シナリオを既存prefillと干渉させない）。 */
async function addRow() {
  await page.click('.ed-panel [data-act="add-row"]');
  await page.waitForFunction(() => document.querySelectorAll('.ed-panel .ed-row').length > 0);
  await page.waitForTimeout(50);
  return page.$$eval('.ed-panel .ed-row', (rs) => rs.length - 1);
}

/** 行 ri / side のセルへ見出し＋項目名を実タイピング（input/change を発火させる）。 */
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

/** 行 ri の「男女共通」チェックを want 状態へ（クリックで change を発火）。 */
async function setBoth(ri, want) {
  const sel = `.ed-panel .ed-row[data-ri="${ri}"] [data-act="toggle-both"]`;
  const cur = await page.$eval(sel, (b) => b.checked);
  if (cur !== want) await page.click(sel);
  await page.waitForTimeout(60); // renderPanel 反映待ち
}

/** 行 ri の現状（共通か／各セルの見出し・項目名）を実DOMから読む。 */
async function readRow(ri) {
  return page.evaluate((ri) => {
    const row = document.querySelector(`.ed-panel .ed-row[data-ri="${ri}"]`);
    const isBoth = !!row.querySelector('[data-act="toggle-both"]')?.checked;
    const rc = (s) => {
      const c = row.querySelector(`.ed-cell[data-side="${s}"]`);
      if (!c) return null;
      return {
        label: c.querySelector('[data-k="label"]')?.value ?? '',
        items: [...c.querySelectorAll('.ed-item [data-k="name"]')].map((n) => n.value).filter(Boolean),
      };
    };
    return { isBoth, both: rc('both'), 男子: rc('男子'), 女子: rc('女子') };
  }, ri);
}

/** 保存経路の中身（cleanCell相当）を行 ri について再現して読む（トグル起因で内容が落ちないことの確認）。 */
async function readSaved(ri) {
  return page.evaluate((ri) => {
    const r = window.__bcsEditor.model().rows[ri];
    const clean = (cell) => {
      if (!cell) return null;
      const items = (cell.items || []).filter((it) => it.name && it.name.trim()).map((it) => it.name.trim());
      const label = (cell.label || '').trim();
      if (items.length === 0 && !label) return null;
      return { label: label || cell.block || '', items };
    };
    if (r.both) return { kind: 'both', both: clean(r.both) };
    return { kind: 'split', 男子: clean(r['男子']), 女子: clean(r['女子']) };
  }, ri);
}

test('(a) 女子だけ内容→共通ON: 女子の内容が共通セルに残る（消えない）', async () => {
  await openPanel();
  const ri = await addRow();
  await fillCell(ri, '女子', 'ラントレ女子', ['走り込み', 'アジリティ']);
  await setBoth(ri, true);
  const row = await readRow(ri);
  assert.equal(row.isBoth, true, '共通モードになっている');
  assert.equal(row.both.label, 'ラントレ女子', '女子の見出しが共通に残る');
  assert.deepEqual(row.both.items, ['走り込み', 'アジリティ'], '女子の項目が共通に残る');
  const saved = await readSaved(ri);
  assert.equal(saved.kind, 'both', '保存は共通(both)で出る');
  assert.deepEqual(saved.both.items, ['走り込み', 'アジリティ'], '保存経路でも女子の項目が落ちない');
  await closePanel();
});

test('(b) 男子だけ内容→共通ON: 男子の内容が共通セルに残る（消えない）', async () => {
  await openPanel();
  const ri = await addRow();
  await fillCell(ri, '男子', 'シューティング男子', ['ミドル', 'スリー']);
  await setBoth(ri, true);
  const row = await readRow(ri);
  assert.equal(row.both.label, 'シューティング男子', '男子の見出しが共通に残る');
  assert.deepEqual(row.both.items, ['ミドル', 'スリー'], '男子の項目が共通に残る');
  await closePanel();
});

test('(c) 男女に別内容→共通ON: 両方の項目が共通にマージされ、どちらも失われない', async () => {
  await openPanel();
  const ri = await addRow();
  await fillCell(ri, '男子', '男子見出し', ['男ドリA', '男ドリB']);
  await fillCell(ri, '女子', '女子見出し', ['女ドリX', '女ドリY']);
  await setBoth(ri, true);
  const row = await readRow(ri);
  // 男子・女子の全項目が共通(both)に揃う（順序は男子→女子）。どちらか片方だけになっていない＝喪失ゼロ。
  for (const name of ['男ドリA', '男ドリB', '女ドリX', '女ドリY']) {
    assert.ok(row.both.items.includes(name), `共通に ${name} がマージされている（喪失ゼロ）`);
  }
  const saved = await readSaved(ri);
  for (const name of ['男ドリA', '男ドリB', '女ドリX', '女ドリY']) {
    assert.ok(saved.both.items.includes(name), `保存経路でも ${name} が残る`);
  }
  await closePanel();
});

test('(d) 男女別→ON→OFF→ON 往復: OFFで元の男女別が distinct に復元され、再ONでマージ。消えない', async () => {
  await openPanel();
  const ri = await addRow();
  await fillCell(ri, '男子', '男子D', ['Dア', 'Dイ']);
  await fillCell(ri, '女子', '女子D', ['Dカ', 'Dキ']);
  await setBoth(ri, true);
  const on1 = await readRow(ri);
  for (const name of ['Dア', 'Dイ', 'Dカ', 'Dキ']) assert.ok(on1.both.items.includes(name), `1回目ON: ${name} がマージ`);

  await setBoth(ri, false);
  const off = await readRow(ri);
  assert.equal(off.isBoth, false, 'OFFで男女別へ戻る');
  // 往復で別内容が混ざらず・消えず、元の distinct な男女別に戻る（共通OFFが上書き破壊しない）。
  assert.equal(off.男子.label, '男子D', 'OFF: 男子の見出しが復元');
  assert.deepEqual(off.男子.items, ['Dア', 'Dイ'], 'OFF: 男子の項目が復元（女子内容が混入しない）');
  assert.equal(off.女子.label, '女子D', 'OFF: 女子の見出しが復元');
  assert.deepEqual(off.女子.items, ['Dカ', 'Dキ'], 'OFF: 女子の項目が復元（男子内容に上書きされない）');

  await setBoth(ri, true);
  const on2 = await readRow(ri);
  for (const name of ['Dア', 'Dイ', 'Dカ', 'Dキ']) assert.ok(on2.both.items.includes(name), `再ON: ${name} が再びマージ`);
  await closePanel();
});

test('(e) 両側空→共通ON: 共通は空で、クラッシュせず、OFFで空セルに戻る（失う内容が無い）', async () => {
  await openPanel();
  const ri = await addRow();
  await setBoth(ri, true);
  const on = await readRow(ri);
  assert.equal(on.isBoth, true, '共通モードになる');
  assert.deepEqual(on.both.items, [], '共通は空（持ち込む内容が無い）');
  await setBoth(ri, false);
  const off = await readRow(ri);
  assert.equal(off.isBoth, false, 'OFFで男女別へ戻る');
  assert.deepEqual(off.男子.items, [], 'OFF: 男子は空のまま');
  assert.deepEqual(off.女子.items, [], 'OFF: 女子は空のまま');
  await closePanel();
});

test('オーナー実シナリオ: 男子=「？」(項目空)・女子=内容 の行で共通ON→女子の内容が共通に残る', async () => {
  await openPanel();
  // 行0は overrides.json の実データ: 男子 label「？」items[] / 女子 label「ラントレ（屋外）」items 1件。
  const before = await readRow(0);
  assert.deepEqual(before.女子.items, ['走り込み・アジリティ'], '前提: 行0の女子に実内容がある');
  await setBoth(0, true);
  const after = await readRow(0);
  assert.equal(after.isBoth, true, '共通モードになる');
  // 事故の核心: 女子の練習内容が共通ONで消えていた。マージで残ることを固定する。
  assert.ok(after.both.items.includes('走り込み・アジリティ'), 'オーナー事故シナリオで女子の内容が消えない');
  await closePanel();
});
