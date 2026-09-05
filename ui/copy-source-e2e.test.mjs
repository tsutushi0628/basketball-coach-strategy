/**
 * @file 「他の日からコピー」のおすすめ＋探すUIの業務意図テスト（実ブラウザ通し）。
 *
 * 正本: docs/specs/past-weeks-and-copy-source/service-design.md（3.章）、
 *       docs/findings/spec-20260905-past-weeks-and-copy-source-impl.md（7.2章・10章10・11章）。
 *
 * 検証する業務意図（実装の途中値は写経しない）:
 *   - おすすめの行を選ぶと隠し入力(#ed-copyfrom)にその日付が入り、「この日を取り込む」で内容が入る。
 *   - 「探す」で年月(cf-ym)を変えると日(cf-day)の選択肢が入れ替わる。
 *   - cf-day で日を選ぶとおすすめの選択（cf-radio）が外れ、隠し入力がその日付になる。
 *   - その後おすすめ(cf-radio)を選び直すと cf-day が「日を選んでください…」に戻る。
 *   - 中身がある状態で取り込むと「いまの内容を、{YYYY/MM/DD（曜）}の内容で置き換えます。
 *     よろしいですか？」の確認（window.confirm）が出て、キャンセルすれば取り込まれない。
 *
 * テナント種データ（overrides.json）はコーチ上書きが2026-06のみ3件しかなく「探す」の複数月を
 * 再現できないため、既存の allCoachDays（実データ由来の twoCol 日）を複製・改変して他の月・前年の
 * 候補を補う（only-gender-render.test.mjs と同じ「buildPlanData実データを加工してrender」作法）。
 *
 * 対応前の現状（本ファイル作成時点で実走確認済み）: copyFromOptions() が単一 <select id="ed-copyfrom"> の
 * ままで cf-radio・cf-group・cf-ym・cf-day 等のクラスが存在せず、各セレクタ待ちがタイムアウトする。
 *
 * テスト基盤: node --test ＋ Playwright(chromium)。goal-editor-no-reload.test.mjs と同じ駆動方式。
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
const HTML = resolve(__dirname, 'pattern-timeline.copy-source-e2e.tmp.html');
// 編集対象日: weeks[0]週内でコーチ上書きの無い金曜（それ自身がコピー元候補に紛れない）。
const EDIT_DATE = '2026-06-26';

let browser;
let page;

before(async () => {
  const data = await buildPlanData({ ...localStorages(), today: LOCAL_FIXTURE_TODAY });
  const template = data.allCoachDays[0]; // 実データ由来のtwoCol日（型を保ったまま複製する土台）
  assert.ok(template, '前提: 種データに twoCol コーチ上書き日が1件以上ある');
  // 種データ3件(2026-06-23/24/25)に加え、他月・前年の候補を補い「探す」を必ず出す（4件超）。
  const fabricated = [
    { ...template, date: '2026-05-05', title: '5月の候補' },
    { ...template, date: '2026-04-06', title: '4月の候補' },
    { ...template, date: '2025-06-27', title: '去年6月の候補' },
  ];
  data.allCoachDays = [...data.allCoachDays, ...fabricated];
  const { css, body } = render(data);
  writeFileSync(HTML, renderPage({ title: 'copy-source e2e fixture', css, body }), 'utf8');
  browser = await chromium.launch();
});

after(async () => {
  if (browser) await browser.close();
  if (existsSync(HTML)) unlinkSync(HTML);
});

/** 対象日だけを可視にし、編集パネルを開く。 */
async function openPanelFor(page, date) {
  await page.evaluate((d) => {
    document.querySelectorAll('.day[data-date]').forEach((p) => { p.hidden = p.getAttribute('data-date') !== d; });
    const target = document.querySelector(`.day[data-date="${d}"]`);
    const wk = target && target.closest('.daywk');
    if (wk) document.querySelectorAll('.daywk[data-week]').forEach((g) => { g.hidden = g !== wk; });
  }, date);
  await page.click('#ed-edit');
  await page.waitForSelector('.ed-panel .ed-row', { timeout: 3000 });
}

test('おすすめの行を選ぶと隠し入力に日付が入り、「この日を取り込む」で内容が入る', async () => {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(HTML).href);
  await openPanelFor(page, EDIT_DATE);

  await page.waitForSelector('.cf-group .cf-radio', { timeout: 3000 });
  const firstRadioDate = await page.$eval('.cf-radio', (el) => el.value);
  await page.click('.cf-radio');
  const hidden = await page.$eval('#ed-copyfrom', (el) => el.value);
  assert.equal(hidden, firstRadioDate, 'おすすめを選ぶと隠し入力にその日付が入る');

  // 編集中の日は中身が空（新規）なので確認なしで取り込まれる。
  await page.click('[data-act="copy-from"]');
  await page.waitForTimeout(150);
  const aim = await page.$eval('.ed-panel #ed-aim', (el) => el.value);
  assert.notEqual(aim, '', '取り込みで内容（ねらい等）が入る');
  await page.close();
});

test('「探す」で年月を変えると日の選択肢が入れ替わる', async () => {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(HTML).href);
  await openPanelFor(page, EDIT_DATE);

  await page.waitForSelector('.cf-ym', { timeout: 3000 });
  const ymValues = await page.$$eval('.cf-ym option', (os) => os.map((o) => o.value));
  assert.ok(ymValues.length >= 2, '前提: 複数月の選択肢がある（4月・5月・6月・前年6月を補っている）');

  const initialDayOptions = await page.$$eval('.cf-day option', (os) => os.map((o) => o.value));
  const currentYm = await page.$eval('.cf-ym', (el) => el.value);
  const otherYm = ymValues.find((y) => y !== currentYm);
  assert.ok(otherYm, '前提: 現在の年月と異なる選択肢がある');
  await page.selectOption('.cf-ym', otherYm);
  await page.waitForTimeout(80);
  const newDayOptions = await page.$$eval('.cf-day option', (os) => os.map((o) => o.value));
  assert.notDeepEqual(newDayOptions, initialDayOptions, '年月を変えると日の選択肢が入れ替わる');
  await page.close();
});

test('cf-day で日を選ぶとおすすめの選択が外れ、その後おすすめを選び直すと cf-day がプレースホルダに戻る', async () => {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(HTML).href);
  await openPanelFor(page, EDIT_DATE);

  await page.waitForSelector('.cf-radio', { timeout: 3000 });
  await page.click('.cf-radio'); // まずおすすめを選ぶ
  const checkedBefore = await page.$eval('.cf-radio', (el) => el.checked);
  assert.equal(checkedBefore, true, '前提: おすすめが選択されている');

  // 探すの日を1件選ぶ（現在の年月の候補から）。
  const dayValue = await page.$$eval('.cf-day option', (os) => (os.find((o) => o.value) || {}).value);
  assert.ok(dayValue, '前提: 探すに選べる日が1件以上ある');
  await page.selectOption('.cf-day', dayValue);
  await page.waitForTimeout(80);

  const checkedAfter = await page.$eval('.cf-radio', (el) => el.checked);
  assert.equal(checkedAfter, false, '探すで日を選ぶとおすすめの選択が外れる');
  const hidden = await page.$eval('#ed-copyfrom', (el) => el.value);
  assert.equal(hidden, dayValue, '隠し入力は探すで選んだ日付になる');

  // おすすめを選び直すと cf-day がプレースホルダ（空文字）へ戻る。
  await page.click('.cf-radio');
  const dayAfterRadio = await page.$eval('.cf-day', (el) => el.value);
  assert.equal(dayAfterRadio, '', 'おすすめを選び直すと探すの日は「日を選んでください…」に戻る');
  await page.close();
});

test('中身がある状態で取り込むと日付付きの確認が出て、キャンセルすれば取り込まれない', async () => {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(HTML).href);
  await openPanelFor(page, EDIT_DATE);

  // 先に何か入力して「中身がある」状態を作る。
  await page.$eval('.ed-panel #ed-aim', (el) => { el.value = '既存の入力（上書き確認の対象）'; });

  await page.waitForSelector('.cf-radio', { timeout: 3000 });
  await page.click('.cf-radio');
  const targetDate = await page.$eval('#ed-copyfrom', (el) => el.value);

  let dialogMessage = null;
  page.once('dialog', async (dlg) => { dialogMessage = dlg.message(); await dlg.dismiss(); });
  await page.click('[data-act="copy-from"]');
  await page.waitForTimeout(150);

  assert.ok(dialogMessage, '中身がある状態での取り込みは確認ダイアログを挟む');
  assert.match(dialogMessage, /置き換えます。よろしいですか？$/, '文言が新形式（対象日付を含む置き換え文）になっている');
  assert.doesNotMatch(dialogMessage, /選んだ日の内容で上書きします/, '旧文言のままではない');

  const aimAfterCancel = await page.$eval('.ed-panel #ed-aim', (el) => el.value);
  assert.equal(aimAfterCancel, '既存の入力（上書き確認の対象）', 'キャンセルすれば取り込まれず元の入力が残る');
  await page.close();
});
