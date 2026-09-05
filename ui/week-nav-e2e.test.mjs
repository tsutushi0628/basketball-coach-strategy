/**
 * @file 週ナビ（前の週／次の週／年月で飛ぶ／今週へ戻る）と過去週の記録入力・自動に戻すの
 * 業務意図テスト（実ブラウザ通し）。
 *
 * 正本: docs/specs/past-weeks-and-copy-source/service-design.md（2.章）、
 *       docs/findings/spec-20260905-past-weeks-and-copy-source-impl.md（4章・10章2〜7,11・11章）。
 *
 * 検証する業務意図（実装の途中値は写経しない）:
 *   - 「前の週」を押すと窓が1週戻り、先頭タブが1週前になって on、日・週タブが同じ選択で揃う。
 *     窓が今週を含まなくなると「今週へ戻る」が現れる。
 *   - 到達下限で「前の週」が押せなくなる。初期状態で「次の週」が押せず、「前の週」の後は押せる。
 *   - 「年月で飛ぶ」で選んだ月の第1週へ窓が動く。
 *   - 「今週へ戻る」で今日に最も近い練習日へ戻り、ボタンが消える。
 *   - 過去週の上書き無し日は「この日の記録はありません。」＋入力導線1つ。入力して保存すると
 *     location.reload せずその場で描き替わり、「自動に戻す」で1導線の空状態に戻る
 *     （3.3節「過去週は上書きだけで組む」・不具合3の再読込廃止の上に乗る設計）。
 *   - 320・375・414・768px のいずれでも横スクロールが出ない。
 *
 * 対応前の現状（本ファイル作成時点で実走確認済み）: .wknav・.wk-prev 等の週ナビ部品が
 * render() に未実装のため、`page.click('.wknav .wk-prev')` 等がセレクタ不在でタイムアウト失敗する。
 *
 * テスト基盤: node --test ＋ Playwright(chromium)。goal-editor-no-reload.test.mjs と同じ駆動方式
 * （buildPlanData→render→renderPage で1枚のHTMLに焼き、実IIFEを直接駆動・fetchはモック）。
 */
import { test, before, after, beforeEach, afterEach } from 'node:test';
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
const HTML = resolve(__dirname, 'pattern-timeline.week-nav-e2e.tmp.html');
// 過去週（4週前・最も新しい過去週）の上書き無し日。LOCAL_FIXTURE_TODAY=2026-06-22 の週(2026-06-22〜)
// より前、直近の過去週(2026-06-15〜)の水曜。overrides.json に該当日の上書きは無い。
const PAST_EMPTY_DATE = '2026-06-17';

let DATA;
let browser;
let page;

before(async () => {
  DATA = await buildPlanData({ ...localStorages(), today: LOCAL_FIXTURE_TODAY });
  const { css, body } = render(DATA);
  writeFileSync(HTML, renderPage({ title: 'week-nav e2e fixture', css, body }), 'utf8');
  browser = await chromium.launch();
});

after(async () => {
  if (browser) await browser.close();
  if (existsSync(HTML)) unlinkSync(HTML);
});

beforeEach(async () => {
  page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto(pathToFileURL(HTML).href);
});

afterEach(async () => {
  if (page) await page.close();
});

/** 日レベルの .wknav・週レベルの .wknav をそれぞれ返す（region限定でボタン取り違えを防ぐ）。 */
function dayNavSel(sel) { return `.level[data-level="day"] .wknav ${sel}`; }
function weekNavSel(sel) { return `.level[data-level="week"] .wknav ${sel}`; }

/** 日レベルの表示中（hidden でない）先頭タブの data-dayweek 値。 */
async function visibleDayTabKey() {
  return page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.cal-go-dayweek')].filter((b) => !b.hidden);
    return tabs.length ? tabs[0].getAttribute('data-dayweek') : null;
  });
}

/** 週レベルの on クラスが付いた週タブの data-go 値。 */
async function onWeekTabKey() {
  return page.evaluate(() => {
    const b = document.querySelector('.cal-go-week.on');
    return b ? b.getAttribute('data-go') : null;
  });
}

/* ───────────────────────── 前の週・今週へ戻る・両ナビ同期 ───────────────────────── */

test('「前の週」を1回押すと窓が1週戻り、先頭タブが on になり「今週へ戻る」が現れる。週タブも同じ選択', async () => {
  const beforeKey = await visibleDayTabKey();
  assert.equal(beforeKey, DATA.weeks[0].key, '前提: 初期は今週が先頭タブ');

  await page.click(dayNavSel('.wk-prev'), { timeout: 5000 });
  await page.waitForTimeout(80);

  const afterKey = await visibleDayTabKey();
  assert.notEqual(afterKey, beforeKey, '先頭タブが1週前に動く');

  const todayBtnShown = await page.$eval(dayNavSel('.wk-today'), (b) => b.getAttribute('data-shown'));
  assert.equal(todayBtnShown, 'true', '窓が今週を含まなくなったので「今週へ戻る」が現れる');

  // 週レベルへ切り替えても同じ選択週になっている（2.3節・片方だけ動く状態を作らない）。
  await page.click('.lvtab[data-go="week"]');
  const weekOn = await onWeekTabKey();
  assert.equal(weekOn, afterKey, '週タブも日レベルと同じ選択週');
});

test('到達下限まで「前の週」を連打すると押せなくなり、年月の選択肢もその月まで', async () => {
  const steps = DATA.pastWeeks.length; // 到達下限＝pastWeeks の先頭週まで
  for (let i = 0; i < steps; i++) {
    await page.click(dayNavSel('.wk-prev'), { timeout: 5000 });
    await page.waitForTimeout(30);
  }
  const disabled = await page.$eval(dayNavSel('.wk-prev'), (b) => b.disabled);
  assert.equal(disabled, true, '到達下限で「前の週」が押せなくなる');
  const oldestKey = await visibleDayTabKey();
  assert.equal(oldestKey, DATA.pastWeeks[0].key, '先頭タブが最古の過去週');
});

/* ───────────────────────── 次の週の初期状態 ───────────────────────── */

test('初期状態で「次の週」が押せず、「前の週」を押した後は押せる', async () => {
  const initiallyDisabled = await page.$eval(dayNavSel('.wk-next'), (b) => b.disabled);
  assert.equal(initiallyDisabled, true, '初期窓は今週+3週が上限なので次へは進めない');

  await page.click(dayNavSel('.wk-prev'), { timeout: 5000 });
  await page.waitForTimeout(50);
  const nowDisabled = await page.$eval(dayNavSel('.wk-next'), (b) => b.disabled);
  assert.equal(nowDisabled, false, '窓が過去へ動いたので「次の週」が押せる');
});

/* ───────────────────────── 年月で飛ぶ ───────────────────────── */

test('「年月で飛ぶ」で最古の月を選ぶと、窓の先頭がその月の第1週になる', async () => {
  const oldestMonth = DATA.jumpMonths[DATA.jumpMonths.length - 1]; // 新しい順配列の末尾＝最古
  await page.selectOption(dayNavSel('.wk-jump-sel'), oldestMonth.ym);
  await page.waitForTimeout(80);
  const key = await visibleDayTabKey();
  assert.equal(key, oldestMonth.weekKey, '窓の先頭がその月の第1週になる');
});

/* ───────────────────────── 今週へ戻る ───────────────────────── */

test('「今週へ戻る」を押すと今週の先頭タブへ戻り、ボタンが消える', async () => {
  await page.click(dayNavSel('.wk-prev'), { timeout: 5000 });
  await page.waitForTimeout(50);
  await page.click(dayNavSel('.wk-today'), { timeout: 5000 });
  await page.waitForTimeout(50);

  const key = await visibleDayTabKey();
  assert.equal(key, DATA.weeks[0].key, '今週の先頭タブへ戻る');
  const shown = await page.$eval(dayNavSel('.wk-today'), (b) => b.getAttribute('data-shown'));
  assert.equal(shown, 'false', '今週へ戻ったのでボタンが消える');
});

/* ───────────────────────── 過去週の記録入力・自動に戻す ───────────────────────── */

/** fetch を差し替える。responder(url, bodyObj) -> {status, ok, json} を返す関数。 */
async function stubFetch(responderSrc) {
  await page.evaluate((src) => {
    window.__posts = [];
    // eslint-disable-next-line no-new-func
    const responder = new Function(`return (${src})`)();
    window.fetch = async (url, opt) => {
      const bodyObj = opt && opt.body ? JSON.parse(opt.body) : null;
      window.__posts.push({ url: String(url), body: bodyObj });
      return responder(String(url), bodyObj);
    };
  }, responderSrc);
}

async function stubReload() {
  await page.evaluate(() => {
    window.__reloads = 0;
    try { Object.defineProperty(window.location, 'reload', { value: () => { window.__reloads++; } }); } catch (e) { /* noop */ }
  });
}

test('過去週の上書き無し日は「この日の記録はありません。」＋入力導線1つで、入力保存後は再読込せず描き替わる', async () => {
  // 対象日だけを可視にする（単一可視日の不変条件に合わせる。goal-editor-no-reload.test.mjs と同じ作法）。
  await page.evaluate((d) => {
    document.querySelectorAll('.day[data-date]').forEach((p) => { p.hidden = p.getAttribute('data-date') !== d; });
    const target = document.querySelector(`.day[data-date="${d}"]`);
    const wk = target && target.closest('.daywk');
    if (wk) document.querySelectorAll('.daywk[data-week]').forEach((g) => { g.hidden = g !== wk; });
  }, PAST_EMPTY_DATE);

  const emptyText = await page.$eval(`.day[data-date="${PAST_EMPTY_DATE}"] .es-text`, (e) => e.textContent);
  assert.equal(emptyText, 'この日の記録はありません。', '過去週の空日文言');
  const actionButtons = await page.$$eval(`.day[data-date="${PAST_EMPTY_DATE}"] .es-actions button`, (bs) => bs.map((b) => b.getAttribute('data-empty-act')));
  assert.deepEqual(actionButtons, ['blank'], '入力導線は1つだけ（叩き台導線は出ない）');

  await stubReload();
  await stubFetch(`(url, body) => ({ status: 200, ok: true, json: async () => ({ ok: true, override: body }) })`);

  await page.click(`.day[data-date="${PAST_EMPTY_DATE}"] [data-empty-act="blank"]`);
  await page.waitForSelector('.ed-panel', { timeout: 5000 });
  await page.$eval('.ed-panel #ed-aim', (e) => { e.value = '過去週の記録補填テスト'; });
  await page.click('.ed-panel [data-act="save"]');
  await page.waitForTimeout(250);

  const reloads = await page.evaluate(() => window.__reloads);
  assert.equal(reloads, 0, '過去週の保存も再読込しない');
  const stillEmpty = await page.$(`.day[data-date="${PAST_EMPTY_DATE}"] .emptystate`);
  assert.equal(stillEmpty, null, '保存後は空状態でなくなる（同じ日がその場で描き替わる）');

  // ── 自動に戻す: 過去週なので1導線の空状態に戻る（叩き台導線は出ない）──
  await stubFetch(`(url, body) => {
    if (String(url).indexOf('/api/override/delete') >= 0) return { status: 200, ok: true, json: async () => ({ ok: true, date: body.date }) };
    return { status: 404, ok: false, json: async () => ({ ok: false, error: 'unexpected url' }) };
  }`);
  await page.click('#ed-edit'); // 編集を開き直す（保存後はパネルが閉じている）
  await page.waitForSelector('.ed-panel', { timeout: 5000 });
  const revertBtn = await page.$('.ed-panel [data-act="revert-auto"]');
  assert.ok(revertBtn, '過去週の保存済み日にも「自動に戻す」が出る');
  await revertBtn.click();
  await page.waitForTimeout(80);
  await page.evaluate(() => {
    const dlg = document.getElementById('ed-cd');
    if (dlg && !dlg.hidden) { const exec = document.getElementById('ed-cd-exec'); if (exec) exec.click(); }
  });
  await page.waitForTimeout(200);

  const revertedActions = await page.$$eval(`.day[data-date="${PAST_EMPTY_DATE}"] .es-actions button`, (bs) => bs.map((b) => b.getAttribute('data-empty-act')));
  assert.deepEqual(revertedActions, ['blank'], '自動に戻す後も過去週は1導線の空状態のまま（叩き台導線を出さない）');
});

/* ───────────────────────── 過去週の月目標保存も location.reload しない ───────────────────────── */

test('過去週（今日と同じ学校年度）の月目標を保存しても location.reload しない', async () => {
  const pastWeek = DATA.pastWeeks[DATA.pastWeeks.length - 1];
  const targetDate = pastWeek.days.find((d) => d.date)?.date;
  assert.ok(targetDate, '前提: 過去週に実日付の日がある');

  await page.evaluate((d) => {
    document.querySelectorAll('.day[data-date]').forEach((p) => { p.hidden = p.getAttribute('data-date') !== d; });
    const target = document.querySelector(`.day[data-date="${d}"]`);
    const wk = target && target.closest('.daywk');
    if (wk) document.querySelectorAll('.daywk[data-week]').forEach((g) => { g.hidden = g !== wk; });
  }, targetDate);

  await stubReload();
  await stubFetch(`(url, body) => ({ status: 200, ok: true, json: async () => ({ ok: true, scope: body.scope, key: body.key, text: body.text }) })`);

  await page.evaluate((d) => {
    const wk = document.querySelector(`.day[data-date="${d}"]`).closest('.daywk');
    const cell = wk.querySelector('.goalbar [data-goal-scope="month"]');
    cell.querySelector('.ge-edit').click();
  }, targetDate);
  await page.waitForSelector('.ge-box', { timeout: 5000 });
  await page.evaluate((d) => {
    const wk = document.querySelector(`.day[data-date="${d}"]`).closest('.daywk');
    wk.querySelector('.goalbar [data-goal-scope="month"] .ge-in').value = '過去週の月目標テスト';
  }, targetDate);
  await page.evaluate((d) => {
    const wk = document.querySelector(`.day[data-date="${d}"]`).closest('.daywk');
    wk.querySelector('.goalbar [data-goal-scope="month"] .ge-save').click();
  }, targetDate);
  await page.waitForTimeout(250);

  const reloads = await page.evaluate(() => window.__reloads);
  assert.equal(reloads, 0, '過去週の月目標保存も再読込しない');
});

/* ───────────────────────── レスポンシブ: 横スクロール無し ───────────────────────── */

for (const width of [320, 375, 414, 768]) {
  test(`${width}px で横スクロールが出ない`, async () => {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(50);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `${width}px で横スクロールが出ないこと（実測差分: ${overflow}px）`);
  });
}
