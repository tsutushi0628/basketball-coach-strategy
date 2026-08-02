/**
 * @file 「この日のねらい」(aim) を複数行（改行）で入力・保存・表示できる、という業務意図を実ブラウザで固定する。
 *
 * オーナー要望: この日のねらいを1行でなく複数行（箇条書き的な複数のねらい）で書けるようにする。
 * 対象は"この日のねらい"だけ（週/月/年の目標欄は対象外）。
 *
 * 検証する業務意図（実装の途中値は写経しない）:
 *   (a) 入力欄が textarea で、Enter で改行が打てる（1行入力の <input> ではない）。
 *   (b) buildOverride（保存ペイロード）で aim の内部改行(\n)が保持される（前後trimのみ・内部は残す）。
 *   (c) 保存後プレビュー（renderDay の .dh-aim）が改行を2行以上として描画する（white-space:pre-line）。
 *   (d) esc は維持＝ aim に HTML を入れてもタグとして解釈されない（XSS無害）。
 *
 * テスト基盤: node --test ＋ Playwright(chromium)。build.mjs 出力の pattern-timeline.html の実DOM・実IIFE。
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
// このテスト専用の使い捨てビルド（他テストファイルと共有しない・並列実行での競合を避ける）。
// buildPlanData の today を種データのアンカー週に固定するので、実行時刻に関わらず
// overrides.json の上書き日（2026-06-23等）が必ず表示範囲に入る（既定空白のPart C今日基準
// シフトは実運用のみが対象・テストの決定論とは別軸）。ui/*.html は .gitignore 対象。
const HTML = resolve(__dirname, 'pattern-timeline.aim-multiline.tmp.html');
const DATE = '2026-06-23';

let browser;
let page;

before(async () => {
  const data = await buildPlanData({ ...localStorages(), today: LOCAL_FIXTURE_TODAY });
  const { css, body } = render(data);
  writeFileSync(HTML, renderPage({ title: 'aim-multiline fixture', css, body }), 'utf8');
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

async function closePanel() {
  await page.evaluate(() => { const c = document.querySelector('.ed-panel [data-act="cancel"]'); if (c) c.click(); });
  // キャンセルは中身がある日では確認カードを出す（決定書3.2節）。テスト用クリーンアップとして
  // カードが出ていれば「実行」を押して閉じ切る（中身が無ければカードは出ず、次の evaluate は無害）。
  await page.evaluate(() => {
    const dlg = document.getElementById('ed-cd');
    if (dlg && !dlg.hidden) { const exec = document.getElementById('ed-cd-exec'); if (exec) exec.click(); }
  });
}

test('(a) ねらい入力欄は textarea で、Enter で改行が入る', async () => {
  await openPanel();
  const tag = await page.$eval('#ed-aim', (el) => el.tagName.toLowerCase());
  assert.equal(tag, 'textarea', 'ねらい欄は textarea（複数行入力）');

  const aim = await page.$('#ed-aim');
  await aim.fill(''); // 既存値をクリア
  await aim.click();
  await page.keyboard.type('1行目のねらい');
  await page.keyboard.press('Enter'); // textarea なら改行が入る（フォーム送信されない）
  await page.keyboard.type('2行目のねらい');
  const value = await page.$eval('#ed-aim', (el) => el.value);
  assert.ok(value.includes('\n'), 'Enter で改行(\\n)が入る');
  assert.deepEqual(value.split('\n'), ['1行目のねらい', '2行目のねらい'], '2行のテキストになる');
  await closePanel();
});

test('(b) buildOverride で aim の内部改行が保持される（前後trimのみ）', async () => {
  await openPanel();
  const ov = await page.evaluate(() => {
    const ta = document.querySelector('#ed-aim');
    ta.value = '  前後は空白\n中の改行は残す  '; // 前後空白＋内部改行
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    // collectInputs は保存時に呼ばれるので、buildOverride を直接叩く前に取り込む必要がある。
    // ここでは公開APIの buildOverride が collectInputs 済み前提のため、保存経路と同じく手動で取り込む。
    window.__bcsEditor.model().aim = ta.value; // collectInputs 相当（aim=textarea.value）
    return window.__bcsEditor.buildOverride();
  });
  assert.equal(ov.aim, '前後は空白\n中の改行は残す', '前後trim・内部の改行は保持');
  assert.equal(ov.aim.split('\n').length, 2, '2行のまま');
  await closePanel();
});

test('(c) 保存後プレビュー(.dh-aim)が改行を2行として描画する（pre-line）', async () => {
  await openPanel();
  const info = await page.evaluate(() => {
    const art = document.querySelector('.day[data-date="2026-06-23"]');
    const ov = { date: '2026-06-23', weekday: '火', court: '半面', aim: 'ねらいA\nねらいB', rows: [] };
    window.__bcsEditor.renderDay(art, ov);
    const dhAim = art.querySelector('.dh-aim');
    return {
      html: dhAim.innerHTML,
      whiteSpace: getComputedStyle(dhAim).whiteSpace,
      // 描画された高さが2行ぶん（pre-line で改行が効いている）かの近似: 改行文字がそのまま含まれる。
      hasNewlineInText: dhAim.textContent.includes('\n'),
    };
  });
  assert.match(info.whiteSpace, /pre-line/, '.dh-aim は white-space:pre-line（改行を表示に反映）');
  assert.ok(info.hasNewlineInText, 'テキストノードに改行が保持されている（pre-line で改行表示される）');
  assert.ok(info.html.includes('ねらいA') && info.html.includes('ねらいB'), '両行の内容が描画される');
  await closePanel();
});

test('(d) esc 維持: aim に HTML を入れてもタグ解釈されない（XSS無害）', async () => {
  await openPanel();
  const info = await page.evaluate(() => {
    const art = document.querySelector('.day[data-date="2026-06-23"]');
    const ov = { date: '2026-06-23', weekday: '火', court: '半面', aim: '<img src=x onerror=alert(1)>\n2行目', rows: [] };
    window.__bcsEditor.renderDay(art, ov);
    const dhAim = art.querySelector('.dh-aim');
    return { html: dhAim.innerHTML, imgCount: dhAim.querySelectorAll('img').length };
  });
  assert.equal(info.imgCount, 0, 'aim 内の <img> は要素として生成されない（esc でエスケープ）');
  assert.ok(info.html.includes('&lt;img'), 'タグはエスケープされてテキストとして出る');
  await closePanel();
});
