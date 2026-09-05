/**
 * @file 行の明示フラグ split:true が「保存経路」（buildOverride → sanitizeOverride → dayToPrefill）を
 * 途切れず流れる、という業務意図の退行テスト（不具合4・(4-3)）。
 *
 * 背景（(4-1)(4-2) と対の保存経路テスト）: isTogetherRow と描画側が split フラグを尊重するよう直っても、
 * そもそも保存経路のどこかでフラグが落ちれば「再読込したら1本に戻る」という再発になる。本テストは
 * 経路の3点を個別に固定する。
 *   - buildOverride（ui/editor.mjs:1086-1125・クライアントIIFE）: model.rows[].split を ov.rows[].split
 *     として出力する。
 *   - sanitizeOverride（functions/index.mjs:134-177）: ホワイトリスト方式の保存ゲート。split:true を
 *     落とさず通す。
 *   - dayToPrefill（ui/editor.mjs:83-101）: 保存済み override（day.rows[].split）を編集欄の prefill に
 *     写すとき split を保持する。
 *
 * 対応前の現状（本ファイル作成時点で実走確認済み）: 3点とも split キーを一切読み書きしていないため、
 * 出力に split が現れず（undefined）失敗する。
 *
 * テスト基盤: buildOverride は node --test + Playwright（実IIFE駆動）。sanitizeOverride・dayToPrefill は
 * node --test 単体（純関数）。
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
import { editorDataIsland } from './editor.mjs';
import { sanitizeOverride } from '../functions/index.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML = resolve(__dirname, 'pattern-timeline.split-flag-save-pipeline.tmp.html');
const DATE = '2026-06-23'; // overrides.json のコーチ上書き実データ日（男女別行を持つ）

/* ───────────────────────── (4-3-a) buildOverride が split:true を出力する ───────────────────────── */

let browser;
let page;

before(async () => {
  const data = await buildPlanData({ ...localStorages(), today: LOCAL_FIXTURE_TODAY });
  const { css, body } = render(data);
  writeFileSync(HTML, renderPage({ title: 'split flag save pipeline fixture', css, body }), 'utf8');
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.goto(pathToFileURL(HTML).href);
  await page.evaluate((d) => {
    document.querySelectorAll('.day[data-date]').forEach((p) => { p.hidden = p.getAttribute('data-date') !== d; });
    const target = document.querySelector(`.day[data-date="${d}"]`);
    const wk = target && target.closest('.daywk');
    if (wk) document.querySelectorAll('.daywk[data-week]').forEach((g) => { g.hidden = g !== wk; });
  }, DATE);
});

after(async () => {
  if (browser) await browser.close();
  if (existsSync(HTML)) unlinkSync(HTML);
});

test('(4-3-a) buildOverride: 男女別行に split:true を立てると、出力される override 行にも split:true が乗る', async () => {
  await page.evaluate((d) => {
    document.querySelectorAll('.day[data-date]').forEach((p) => { p.hidden = p.getAttribute('data-date') !== d; });
    const target = document.querySelector(`.day[data-date="${d}"]`);
    const wk = target && target.closest('.daywk');
    if (wk) document.querySelectorAll('.daywk[data-week]').forEach((g) => { g.hidden = g !== wk; });
  }, DATE);
  await page.evaluate(() => window.__bcsEditor.openPanel());
  await page.waitForSelector('.ed-panel .ed-row', { timeout: 5000 });

  // 行0は overrides.json の実データ: 男子/女子の別内容行（both を持たない）。
  const before0 = await page.evaluate(() => {
    const r = window.__bcsEditor.model().rows[0];
    return { hasBoth: !!r.both, has男子: !!r['男子'], has女子: !!r['女子'] };
  });
  assert.equal(before0.hasBoth, false, '前提: 行0は男女別行（both を持たない）');
  assert.ok(before0.has男子 && before0.has女子, '前提: 行0は男女とも内容を持つ');

  // split:true を明示（本来は「共通OFFで男女別にした」印としてUI操作が立てるフラグ。UI導線は
  // 実装対応の一部なので、ここではモデルへ直接注入してbuildOverrideの出力だけを検証する）。
  await page.evaluate(() => { window.__bcsEditor.model().rows[0].split = true; });
  const ov = await page.evaluate(() => window.__bcsEditor.buildOverride());

  // 原因行由来の失敗確認ポイント: editor.mjs:1086-1125 buildOverride は split キーを一切読まない。
  assert.equal(ov.rows[0].split, true, 'buildOverride の出力行に split:true が乗る');
});

/* ───────────────────────── (4-3-b) sanitizeOverride が split:true を落とさない ───────────────────────── */

test('(4-3-b) sanitizeOverride: split:true を持つ行を通しても split:true が保持される（ホワイトリストが落とさない）', () => {
  const cellBody = { block: 'ファンダ', label: '見出し', items: [{ name: 'ドリル' }] };
  const body = {
    date: '2026-06-23',
    layout: 'two-col',
    rows: [{ from: '16:00', to: '16:20', split: true, 男子: cellBody, 女子: cellBody }],
  };
  const out = sanitizeOverride(body);

  // 原因行由来の失敗確認ポイント: functions/index.mjs:150-167 の行構築（rows.map）は
  // from/to/minutes/both/男子/女子だけをホワイトリストで通し、split を読まない。
  assert.equal(out.rows[0].split, true, 'sanitizeOverride を通しても split:true が残る');
});

test('sanitizeOverride: split フラグ無し（旧データ）は従来どおり split キーを出力しない（非回帰）', () => {
  const cellBody = { block: 'ファンダ', label: '見出し', items: [{ name: 'ドリル' }] };
  const body = {
    date: '2026-06-23',
    layout: 'two-col',
    rows: [{ from: '16:00', to: '16:20', 男子: cellBody, 女子: cellBody }],
  };
  const out = sanitizeOverride(body);
  assert.equal(out.rows[0].split, undefined, 'フラグ無し行は split キーを持たない（旧データ互換）');
});

/* ───────────────────────── (4-3-c) dayToPrefill が split を保持する ───────────────────────── */

test('(4-3-c) dayToPrefill: 保存済み override（day.rows[].split）の split が編集欄 prefill にも保持される', () => {
  const cellBody = { block: 'ファンダ', label: '見出し', items: [{ name: 'ドリル' }] };
  const day = {
    source: 'coach',
    twoCol: true,
    date: '2026-06-23',
    court: '',
    aim: '',
    title: '',
    rows: [{ from: '16:00', to: '16:20', minutes: 20, split: true, 男子: cellBody, 女子: cellBody }],
  };
  const data = { allCoachDays: [day], drillIndex: new Map(), blockCandidates: null, session: null };
  const html = editorDataIsland(data);
  const m = html.match(/<script[^>]*>([\s\S]*)<\/script>/);
  assert.ok(m, 'editorDataIsland が JSON script タグを返す');
  const island = JSON.parse(m[1]);

  // 原因行由来の失敗確認ポイント: ui/editor.mjs:83-101 dayToPrefill の row 組み立ては
  // from/to/minutes/both/男子/女子だけを写し、split を読まない。
  assert.equal(island.prefill['2026-06-23'].rows[0].split, true, 'dayToPrefill が split:true を保持する');
});

