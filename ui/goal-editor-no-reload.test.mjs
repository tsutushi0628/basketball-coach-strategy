/**
 * @file 月/週目標の保存・自動に戻す、が location.reload() を呼ばず局所更新に留まる、という業務意図の
 * 退行テスト（不具合3）。
 *
 * 背景の事故（原因確定済み）: goal-editor.mjs:144 の doSave 成功経路が location.reload() を呼ぶため、
 * 同じページで開いていた「もう片方の目標の未保存入力」と「練習メニュー編集パネル（ed-panel）の未保存
 * 入力」が全消去される。editor.mjs:1245 の revertAuto（自動に戻す）成功経路も同型の location.reload()
 * を持つ。
 *
 * 対応後に固定する業務意図:
 *   (3-1) 月目標の保存成功: location.reload を呼ばない。同一 scope+key を持つ全ノード（週ごとの
 *         goalbar・月レベル表示 mc-aim・年カレンダー overlay の arccell）の表示値と data-goal-text が
 *         保存値へ更新され、保存した目標の入力ボックスは閉じる。
 *   (3-2) 月目標の保存後も、週目標の未保存入力（別の .ge-box の input 値）と練習メニュー編集パネル
 *         （ed-panel の #ed-aim）の未保存入力値は保存対象外なのでそのまま残る。
 *   (3-3) 保存失敗（res.ok=false）: 入力ボックスは閉じず入力値も残り、エラー文言が出る。
 *   (3-4) 「自動に戻す」（editor.mjs:1245・ed-panel [data-act="revert-auto"] 経由）の成功: location.reload
 *         を呼ばず、当該日の article が局所再描画され（コーチ手入力の痕跡が消える）、開いている目標
 *         入力ボックスの未保存値は残る。
 *
 * 対応前の現状（本ファイル作成時点で実走確認済み）: 4件とも reload 検知（window.__reloads）が 1 になり
 * 即座に失敗する。原因は各テストの冒頭コメントに1行で記す。
 *
 * テスト基盤: node --test ＋ Playwright(chromium)。build.mjs の localStorages（実データ）を
 * buildPlanData→render→renderPage で1枚のHTMLに焼き、実IIFE（goal-editor.mjs / editor.mjs 本体）を
 * 直接駆動する。fetch はモック（サーバ実装は functions/index.mjs の /api/tenant/goal・
 * /api/override/delete のレスポンス形をそのまま模す）。
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
const HTML = resolve(__dirname, 'pattern-timeline.goal-editor-no-reload.tmp.html');
// overrides.json のコーチ上書き実データ日（twoCol）。週起点は 2026-06-22（アンカー週）。
const DATE = '2026-06-23';
const WEEK_KEY = '2026-06-22';
let MONTH_KEY = '';

let browser;
let page;

before(async () => {
  const data = await buildPlanData({ ...localStorages(), today: LOCAL_FIXTURE_TODAY });
  MONTH_KEY = String(data.goalKeys.monthArcKey);
  const { css, body } = render(data);
  writeFileSync(HTML, renderPage({ title: 'goal-editor no-reload fixture', css, body }), 'utf8');
  browser = await chromium.launch();
});

after(async () => {
  if (browser) await browser.close();
  if (existsSync(HTML)) unlinkSync(HTML);
});

beforeEach(async () => {
  page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto(pathToFileURL(HTML).href);
  // 対象日とその所属週グループだけを可視化（多週描画の「可視は常に1日」不変条件に合わせる）。
  await page.evaluate((d) => {
    document.querySelectorAll('.day[data-date]').forEach((p) => { p.hidden = p.getAttribute('data-date') !== d; });
    const target = document.querySelector(`.day[data-date="${d}"]`);
    const wk = target && target.closest('.daywk');
    if (wk) document.querySelectorAll('.daywk[data-week]').forEach((g) => { g.hidden = g !== wk; });
  }, DATE);
});

afterEach(async () => {
  if (page) await page.close();
});

/** location.reload をカウンタへ差し替える（実ナビゲーションを起こさず検知する）。 */
async function stubReload() {
  await page.evaluate(() => {
    window.__reloads = 0;
    try { Object.defineProperty(window.location, 'reload', { value: () => { window.__reloads++; } }); } catch (e) { window.__reloadStubFail = String(e); }
  });
}

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

/** 対象日が属く週グループ内の goalbar から scope='month'|'week' のセルを開く。 */
async function openGoalBox(scope) {
  await page.evaluate(({ d, scope }) => {
    const wk = document.querySelector(`.day[data-date="${d}"]`).closest('.daywk');
    const cell = wk.querySelector(`.goalbar [data-goal-scope="${scope}"]`);
    cell.querySelector('.ge-edit').click();
  }, { d: DATE, scope });
  await page.waitForSelector(`.ge-box`, { timeout: 5000 });
}

/** 開いている .ge-box の input へ値をセットする（対象日の週グループ内の scope セル基準）。 */
async function setGoalInput(scope, text) {
  await page.evaluate(({ d, scope, text }) => {
    const wk = document.querySelector(`.day[data-date="${d}"]`).closest('.daywk');
    const cell = wk.querySelector(`.goalbar [data-goal-scope="${scope}"]`);
    cell.querySelector('.ge-in').value = text;
  }, { d: DATE, scope, text });
}

/** 対象日の週グループ内の scope セルの現況（未保存入力値・保存ボタン有無）を読む。 */
async function readGoalBoxState(scope) {
  return page.evaluate(({ d, scope }) => {
    const wk = document.querySelector(`.day[data-date="${d}"]`).closest('.daywk');
    const cell = wk.querySelector(`.goalbar [data-goal-scope="${scope}"]`);
    const box = cell.querySelector('.ge-box');
    const input = cell.querySelector('.ge-in');
    const foot = cell.querySelector('.ge-foot');
    return {
      boxOpen: !!box,
      inputValue: input ? input.value : null,
      inputDisabled: input ? input.disabled : null,
      footKind: foot ? foot.getAttribute('data-kind') : null,
      footText: foot ? foot.textContent : null,
    };
  }, { d: DATE, scope });
}

/** 対象日の週グループ内 scope セルの保存ボタンを押す。 */
async function clickGoalSave(scope) {
  await page.evaluate(({ d, scope }) => {
    const wk = document.querySelector(`.day[data-date="${d}"]`).closest('.daywk');
    wk.querySelector(`.goalbar [data-goal-scope="${scope}"] .ge-save`).click();
  }, { d: DATE, scope });
}

/** 同一 scope+key を持つ全ノードの data-goal-text と表示テキストを読む（全箇所反映の検証用）。 */
async function readAllGoalNodes(scope, key) {
  return page.evaluate(({ scope, key }) => {
    return [...document.querySelectorAll(`[data-goal-scope="${scope}"][data-goal-key="${key}"]`)].map((el) => {
      const gbVal = el.querySelector('.gb-val');
      const isMcAim = el.classList.contains('mc-aim');
      // mc-aim は data-goal-edit を el 自身が持ち、編集ボタン（テキスト「編集」）が子として付く。
      // ボタン分を除いた本文だけを比べるため、ボタン要素を除いた直下テキストを拾う。
      let display = null;
      if (gbVal) display = gbVal.textContent.trim();
      else if (isMcAim) {
        const clone = el.cloneNode(true);
        clone.querySelectorAll('button').forEach((b) => b.remove());
        display = clone.textContent.trim();
      }
      return { text: el.getAttribute('data-goal-text'), display };
    });
  }, { scope, key });
}

/* ───────────────────────── (3-1) 月目標の保存成功: reload せず全ノード更新・ボックスが閉じる ───────────────────────── */

test('(3-1) 月目標の保存成功で location.reload せず、同一 scope+key の全ノードが更新されボックスが閉じる', async () => {
  // 前提: 月目標 scope+key は週ごとの goalbar（4週ぶん）＋月レベル(mc-aim)＋年タブ overlay(arccell) に複製されている。
  const nodeCountBefore = await page.evaluate((key) => document.querySelectorAll(`[data-goal-scope="month"][data-goal-key="${key}"]`).length, MONTH_KEY);
  assert.ok(nodeCountBefore >= 4, '前提: 同一 scope+key の複製ノードが複数箇所にある');

  await openGoalBox('month');
  await setGoalInput('month', '新しい月目標・保存分');
  await stubReload();
  await stubFetch(`(url, body) => ({ status: 200, ok: true, json: async () => ({ ok: true, scope: body.scope, key: body.key, text: body.text }) })`);
  await clickGoalSave('month');
  await page.waitForTimeout(250);

  // 原因行由来の失敗確認ポイント: goal-editor.mjs:144 は res.ok を見て無条件に location.reload() を呼ぶ。
  const reloads = await page.evaluate(() => window.__reloads);
  assert.equal(reloads, 0, 'goal-editor.mjs:144 の location.reload() を呼んではならない');

  const nodes = await readAllGoalNodes('month', MONTH_KEY);
  assert.equal(nodes.length, nodeCountBefore, 'ノード数自体は変わらない');
  for (const n of nodes) {
    assert.equal(n.text, '新しい月目標・保存分', `data-goal-text が保存値に更新される（残: ${JSON.stringify(n)}）`);
    if (n.display != null) {
      assert.equal(n.display, '新しい月目標・保存分', `表示テキストが保存値に更新される（残: ${JSON.stringify(n)}）`);
    }
  }

  const state = await readGoalBoxState('month');
  assert.equal(state.boxOpen, false, '保存成功後は月目標の入力ボックスが閉じる');
});

/* ───────────────────────── (3-2) 月保存後も週の未保存入力と ed-panel の未保存入力が残る ───────────────────────── */

async function openEditorPanel() {
  await page.evaluate(() => window.__bcsEditor.openPanel());
  await page.waitForSelector('.ed-panel .ed-row', { timeout: 5000 });
}

test('(3-2) 月目標保存後も、週目標の未保存入力と練習メニュー編集パネルの未保存入力は残る', async () => {
  await openGoalBox('week');
  await setGoalInput('week', '週目標・未保存のまま');
  await openGoalBox('month');
  await setGoalInput('month', '月目標・保存する');
  await openEditorPanel();
  await page.$eval('.ed-panel #ed-aim', (e) => { e.value = '練習メニュー・未保存のねらい'; });

  await stubReload();
  await stubFetch(`(url, body) => ({ status: 200, ok: true, json: async () => ({ ok: true, scope: body.scope, key: body.key, text: body.text }) })`);
  await clickGoalSave('month');
  await page.waitForTimeout(250);

  // 原因行由来の失敗確認ポイント: reload されれば以下の未保存値は全て消える。
  const reloads = await page.evaluate(() => window.__reloads);
  assert.equal(reloads, 0, '月保存で reload してはならない（週目標・ed-panel の未保存値を守るため）');

  const weekState = await readGoalBoxState('week');
  assert.equal(weekState.boxOpen, true, '週目標の未保存入力ボックスは開いたまま');
  assert.equal(weekState.inputValue, '週目標・未保存のまま', '週目標の未保存入力値は保存対象外なので残る');

  const aimValue = await page.$eval('.ed-panel #ed-aim', (e) => e.value);
  assert.equal(aimValue, '練習メニュー・未保存のねらい', '練習メニュー編集パネルの未保存入力値も残る');
});

/* ───────────────────────── (3-3) 保存失敗時はボックスが閉じず入力値が残りエラー文が出る ───────────────────────── */

test('(3-3) 目標保存が失敗（res.ok=false）した場合、ボックスは閉じず入力値が残りエラー文が出る', async () => {
  await openGoalBox('month');
  await setGoalInput('month', '保存に失敗する入力');
  await stubReload();
  await stubFetch(`(url, body) => ({ status: 200, ok: true, json: async () => ({ ok: false, error: 'テスト用の保存失敗' }) })`);
  await clickGoalSave('month');
  await page.waitForTimeout(250);

  const reloads = await page.evaluate(() => window.__reloads);
  assert.equal(reloads, 0, '保存失敗時は reload しない（そもそも成功時しか呼ばれない経路のはずだが、失敗系の回帰も固定する）');

  const state = await readGoalBoxState('month');
  assert.equal(state.boxOpen, true, '保存失敗時は入力ボックスが閉じない');
  assert.equal(state.inputValue, '保存に失敗する入力', '保存失敗時は入力値が消えずに残る');
  assert.equal(state.inputDisabled, false, '保存失敗時は再入力できるよう disabled が解除される');
  assert.equal(state.footKind, 'error', 'エラー種別の文言枠が出る');
  assert.equal(state.footText, 'テスト用の保存失敗', 'サーバの error 文言がそのまま出る（goalSaveErrorText の優先順位）');
});

/* ───────────────────────── (3-4) 自動に戻す成功時も reload せず局所再描画・未保存値は残る ───────────────────────── */

test('(3-4) 「自動に戻す」成功時も location.reload せず当該日が局所再描画され、開いている目標入力ボックスの未保存値は残る', async () => {
  // 前提: 対象日にコーチ手入力の痕跡がある（overrides.json 実データ）。
  const beforeHtml = await page.evaluate((d) => document.querySelector(`.day[data-date="${d}"]`).innerHTML, DATE);
  assert.match(beforeHtml, /走り込み・アジリティ/, '前提: 対象日にコーチ手入力の痕跡がある');

  await openGoalBox('week');
  await setGoalInput('week', '自動に戻す最中の週目標・未保存');

  await openEditorPanel(); // editingArticle をセット・article.hidden=true にする

  await stubReload();
  await stubFetch(`(url, body) => {
    if (String(url).indexOf('/api/override/delete') >= 0) {
      return { status: 200, ok: true, json: async () => ({ ok: true, date: body.date }) };
    }
    return { status: 404, ok: false, json: async () => ({ ok: false, error: 'unexpected url' }) };
  }`);

  await page.click('.ed-panel [data-act="revert-auto"]');
  await page.waitForTimeout(80);
  // 中身がある日は確認カードを挟む（決定書3.2節）。出ていれば実行を押す。
  await page.evaluate(() => {
    const dlg = document.getElementById('ed-cd');
    if (dlg && !dlg.hidden) { const exec = document.getElementById('ed-cd-exec'); if (exec) exec.click(); }
  });
  await page.waitForTimeout(250);

  // 原因行由来の失敗確認ポイント: editor.mjs:1245 は res.ok を見て無条件に location.reload() を呼ぶ。
  const reloads = await page.evaluate(() => window.__reloads);
  assert.equal(reloads, 0, 'editor.mjs:1245 の location.reload() を呼んではならない');

  const afterHtml = await page.evaluate((d) => document.querySelector(`.day[data-date="${d}"]`).innerHTML, DATE);
  assert.doesNotMatch(afterHtml, /走り込み・アジリティ/, '局所再描画によりコーチ手入力の痕跡が消える（自動生成に戻る）');

  const weekState = await readGoalBoxState('week');
  assert.equal(weekState.boxOpen, true, '自動に戻す実行後も開いていた週目標の入力ボックスは残る');
  assert.equal(weekState.inputValue, '自動に戻す最中の週目標・未保存', '週目標の未保存入力値は消えずに残る');
});
