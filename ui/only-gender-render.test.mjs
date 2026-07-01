/**
 * @file 男女オンリーモード（女子のみ／男子のみ／男女両方）の描画・保存往復の業務意図テスト。
 *
 * オーナー確定挙動（2026-07-01・spec-20260701-gender-day-modes.md）: 日レベルに「女子のみ／男子のみ／
 * 男女両方」の切替を追加する。オンリー時は反対性別の列を消して1列で表示する。反対性別の列に既に
 * コーチ手入力がある状態でオンリーへ切り替える時だけ、無損失退避＋確認を挟む（元に戻せば復元・
 * 退避キーは保存ペイロードに載らない）。
 *
 * 検証する業務意図（実装の途中値は写経しない）:
 *   (a) 描画: onlyGender:'女子' の日は男子列が描かれず女子1列で描かれる（既存twoColの2列描画は使わない）。
 *   (b) 描画: onlyGender 未指定の日は従来どおり男女2列で描かれる（非回帰）。
 *   (c) 編集: setOnlyGender で '女子' へ切替→反対列(男子)の中身が退避され、_onlyMemoに残る。
 *   (d) 編集: 退避後に「男女両方」へ戻すと、未編集なら反対列の内容が完全復元される（消えない）。
 *   (e) 保存: buildOverride は onlyGender 設定時、対象性別のセルだけを載せ、退避キー(_onlyMemo)は
 *       保存ペイロードに含めない（スキーマ汚染防止）。
 *
 * テスト基盤: (a)(b) は node --test の純関数テスト（buildPlanData実データ＋render出力の文字列検証）。
 * (c)(d)(e) は Playwright(chromium)。対象は build.mjs が出力する pattern-timeline.html の実DOM・実IIFE
 * （editor.mjs の setOnlyGender ハンドラ本体）を直接駆動する。
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';

import { buildPlanData } from './plan-data.mjs';
import { localStorages } from './build.mjs';
import { render } from './pattern-timeline.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── (a)(b) 描画: buildPlanData実データを onlyGender で加工し render() の出力を検証 ──────────

test('(a) onlyGender:"女子" の日は男子列を描かず、女子1列で描かれる', async () => {
  const data = await buildPlanData(localStorages());
  const tue = data.weeks[0].days.find((d) => d.day === '火'); // 06/23・twoCol上書きあり
  assert.equal(tue.twoCol, true, '前提: twoCol上書き日である');
  tue.onlyGender = '女子';

  const { body } = render(data);
  const m = body.match(/<article class="day pageb"[^>]*data-date="2026-06-23"[^>]*>([\s\S]*?)<\/article>/);
  assert.ok(m, '火(06/23)の article が存在する');
  const article = m[1];
  assert.doesNotMatch(article, /spine-side spine-self tc2-cell/, 'オンリー時は既存の男女2列セル描画を使わない');
  assert.match(article, /女子/, '女子の内容は描かれる');
});

test('(b) onlyGender 未指定の日は従来どおり男女2列（非回帰）', async () => {
  const data = await buildPlanData(localStorages());
  const { body } = render(data);
  const m = body.match(/<article class="day pageb"[^>]*data-date="2026-06-23"[^>]*>([\s\S]*?)<\/article>/);
  assert.ok(m, '火(06/23)の article が存在する');
  const article = m[1];
  assert.match(article, /spine-side spine-self tc2-cell/, '従来どおり男女2列セル描画が使われる');
});

// ── (c)(d)(e) 編集・保存: 実ブラウザでのドラフト操作 ──────────────────────────────────

const HTML = resolve(__dirname, 'pattern-timeline.html');
const DATE = '2026-06-23';

let browser;
let page;

before(async () => {
  assert.ok(existsSync(HTML), 'pattern-timeline.html がビルド済みであること（node ui/build.mjs を先に実行）');
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.goto(pathToFileURL(HTML).href);
});

after(async () => { if (browser) await browser.close(); });

/** 対象日の編集パネルを開く（所属 .daywk 週グループも可視にする）。 */
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
}

test('(c) setOnlyGender("女子")で反対列(男子)が退避され、model上は空になる', async () => {
  await openPanel();
  const result = await page.evaluate(() => {
    const m = window.__bcsEditor.model();
    const before男子 = JSON.parse(JSON.stringify(m.rows[0]['男子']));
    window.__bcsEditor.setOnlyGender('女子');
    const after = window.__bcsEditor.model();
    return {
      before男子,
      onlyGender: after.onlyGender,
      afterMemo: after.rows[0]._onlyMemo,
    };
  });
  assert.equal(result.onlyGender, '女子', 'model.onlyGenderが女子になる');
  assert.ok(result.afterMemo, '反対列の退避(_onlyMemo)が作られる');
  assert.deepEqual(result.afterMemo['男子'], result.before男子, '退避された男子内容は切替前と一致（無損失）');
  await closePanel();
});

test('(d) オンリー中に未編集のまま「男女両方」へ戻すと、反対列の内容が完全復元される', async () => {
  await openPanel();
  const result = await page.evaluate(() => {
    const m = window.__bcsEditor.model();
    const before男子 = JSON.parse(JSON.stringify(m.rows[0]['男子']));
    window.__bcsEditor.setOnlyGender('女子');
    window.__bcsEditor.setOnlyGender(null); // 男女両方へ戻す（未編集）
    const after = window.__bcsEditor.model();
    return { before男子, after男子: after.rows[0]['男子'], onlyGender: after.onlyGender };
  });
  assert.equal(result.onlyGender, null, '男女両方(null)に戻る');
  assert.deepEqual(result.after男子, result.before男子, '未編集なら男子内容が完全復元される（消えない）');
  await closePanel();
});

test('(e) buildOverride: onlyGender設定時は対象性別セルだけが載り、退避キーは保存に含まれない', async () => {
  await openPanel();
  const result = await page.evaluate(() => {
    window.__bcsEditor.setOnlyGender('女子');
    return window.__bcsEditor.buildOverride();
  });
  assert.equal(result.onlyGender, '女子', '保存ペイロードにonlyGenderが付与される');
  assert.ok(!('男子' in result.rows[0]), 'オンリー時は反対性別(男子)のセルを保存に載せない');
  assert.ok('女子' in result.rows[0], '対象性別(女子)のセルは保存に載る');
  const json = JSON.stringify(result);
  assert.doesNotMatch(json, /_onlyMemo/, '退避キー(_onlyMemo)は保存ペイロードの文字列に一切出ない');
  await closePanel();
});

/** 編集パネルの実DOMから、各行の男子/女子/共通の編集セルが描かれているか（数）を読む。 */
async function readPanelSides() {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll('.ed-panel .ed-row')];
    return rows.map((row) => ({
      男子: !!row.querySelector('.ed-cell[data-side="男子"]'),
      女子: !!row.querySelector('.ed-cell[data-side="女子"]'),
      both: !!row.querySelector('.ed-cell[data-side="both"]'),
    }));
  });
}

// BUG-001 回帰テスト: 編集パネルの実DOM（rowHtmlForm の出力＝コーチが触る画面）を検証する。
// (c)(d)(e) は内部model/buildOverride だけを見ており、UI描画の実装漏れをすり抜けた。

test('(f) 実DOM: オンリー中は反対性別(男子)の編集セルが描かれず、対象性別(女子)1列だけになる', async () => {
  await openPanel();
  await page.evaluate(() => window.__bcsEditor.setOnlyGender('女子'));
  await page.waitForTimeout(80); // renderPanel 反映待ち
  const sides = await readPanelSides();
  assert.ok(sides.length > 0, '前提: 行が描かれている');
  for (const s of sides) {
    assert.equal(s.女子, true, '対象性別(女子)の編集セルは描かれる');
    assert.equal(s.男子, false, '反対性別(男子)の編集セルは描かれない（コーチが入力できない）');
    assert.equal(s.both, false, 'オンリー時は男女共通(both)セルも出ない');
  }
  await closePanel();
});

test('(g) 実DOM: 「男女両方」へ戻すと反対列が再表示され、退避した手入力が復元される', async () => {
  await openPanel();
  // オンリー切替前の男子1列目の見出しを実DOMから控える（退避→復元の一次情報）。
  const before男子Label = await page.evaluate(() =>
    document.querySelector('.ed-panel .ed-row[data-ri="0"] .ed-cell[data-side="男子"] [data-k="label"]')?.value ?? null);

  await page.evaluate(() => window.__bcsEditor.setOnlyGender('女子'));
  await page.waitForTimeout(80);
  const onlySides = await readPanelSides();
  assert.equal(onlySides[0].男子, false, 'オンリー中は男子セルが消えている（前提）');

  await page.evaluate(() => window.__bcsEditor.setOnlyGender(null)); // 男女両方へ戻す（未編集）
  await page.waitForTimeout(80);
  const bothSides = await readPanelSides();
  assert.equal(bothSides[0].男子, true, '両方へ戻すと男子セルが再表示される（実DOM）');
  assert.equal(bothSides[0].女子, true, '女子セルも並ぶ（2列に戻る）');

  const after男子Label = await page.evaluate(() =>
    document.querySelector('.ed-panel .ed-row[data-ri="0"] .ed-cell[data-side="男子"] [data-k="label"]')?.value ?? null);
  assert.equal(after男子Label, before男子Label, '退避した男子の手入力(見出し)が実DOMで復元される');
  await closePanel();
});

/** model の1行から男子/女子/共通の見出し・項目名を素データで読む（退避復元の一次情報）。 */
async function readModelRow(ri) {
  return page.evaluate((ri) => {
    const r = window.__bcsEditor.model().rows[ri];
    const c = (cell) => (cell ? { label: cell.label || '', items: (cell.items || []).map((it) => it.name).filter(Boolean) } : null);
    return { 男子: c(r['男子']), 女子: c(r['女子']), both: c(r.both), onlyGender: window.__bcsEditor.model().onlyGender };
  }, ri);
}

// 【A】直接オンリー切替（両方を経由せず 女子のみ→男子のみ）で原本が消えないことを固定する。
test('(A) 直接切替: 女子のみ→男子のみ→両方 で元の男女別が完全復元される（原本消失しない）', async () => {
  await openPanel();
  // 行0の元の男子・女子の見出しを控える（切替前の一次情報）。
  const orig = await readModelRow(0);
  assert.ok(orig.男子 && orig.女子, '前提: 行0に男女別の中身がある');

  // 女子のみ→（両方を経由せず）男子のみ→両方
  await page.evaluate(() => window.__bcsEditor.setOnlyGender('女子'));
  await page.waitForTimeout(50);
  await page.evaluate(() => window.__bcsEditor.setOnlyGender('男子')); // 直接切替（Aの経路）
  await page.waitForTimeout(50);
  await page.evaluate(() => window.__bcsEditor.setOnlyGender(null));
  await page.waitForTimeout(50);

  const after = await readModelRow(0);
  assert.equal(after.onlyGender, null, '男女両方に戻っている');
  assert.deepEqual(after.男子, orig.男子, '直接切替を経ても男子の原本が復元される（両列空にならない）');
  assert.deepEqual(after.女子, orig.女子, '直接切替を経ても女子の原本が復元される');
  await closePanel();
});

// 【B】男女共通(both)行がある日をオンリー化→両方で both が復元されることを固定する。
test('(B) 男女共通行がある日をオンリー化→両方 で共通(both)の内容が復元される', async () => {
  await openPanel();
  // 行0を男女共通にしてから既知内容を入れる（both行を作る）。
  await page.evaluate(() => {
    const m = window.__bcsEditor.model();
    m.rows[0].both = { block: 'ラン', label: '共通ラントレ', items: [{ name: '共通走り込み', note: '' }] };
    m.rows[0]['男子'] = { block: '', label: '', items: [] };
    m.rows[0]['女子'] = { block: '', label: '', items: [] };
  });
  const beforeBoth = await readModelRow(0);
  assert.ok(beforeBoth.both && beforeBoth.both.label === '共通ラントレ', '前提: 行0が男女共通(both)で内容を持つ');

  await page.evaluate(() => window.__bcsEditor.setOnlyGender('女子'));
  await page.waitForTimeout(50);
  const during = await readModelRow(0);
  assert.equal(during.both, null, 'オンリー中は共通行が畳まれている（both:null）');

  await page.evaluate(() => window.__bcsEditor.setOnlyGender(null));
  await page.waitForTimeout(50);
  const after = await readModelRow(0);
  assert.deepEqual(after.both, beforeBoth.both, '両方へ戻すと共通(both)の内容が復元される（消えない）');
  await closePanel();
});

// 【C】女子のみ保存直後のクライアントプレビューが1列（男子列が出ない）であること。
test('(C) 保存直後プレビュー: 女子のみは1列描画（空の男子列付き2列にならない）', async () => {
  await openPanel();
  const html = await page.evaluate(() => {
    window.__bcsEditor.setOnlyGender('女子');
    const ov = window.__bcsEditor.buildOverride();
    // doSave が保存後に呼ぶ描画を、DOMを汚さずに文字列で取り出す。
    const tmp = document.createElement('article');
    window.__bcsEditor.renderDay(tmp, ov);
    return tmp.innerHTML;
  });
  assert.doesNotMatch(html, /spine-side spine-self tc2-cell/, 'プレビューが男女2列セル描画を使わない（1列）');
  assert.doesNotMatch(html, /gchip boys/, 'プレビューヘッダに男子チップが出ない（女子のみ）');
  assert.match(html, /gchip girls/, 'プレビューヘッダに女子チップが出る');
  await closePanel();
});

// 【E-client】女子のみの日のコピー用テキスト（クライアント plainTextOf）に「男子｜」行が出ない。
test('(E-client) コピー用テキスト: 女子のみは「男子｜」の幽霊行を出さない', async () => {
  await openPanel();
  const plain = await page.evaluate(() => {
    window.__bcsEditor.setOnlyGender('女子');
    const ov = window.__bcsEditor.buildOverride();
    const tmp = document.createElement('article');
    window.__bcsEditor.renderDay(tmp, ov);
    return tmp.querySelector('.plain')?.textContent ?? '';
  });
  assert.doesNotMatch(plain, /男子｜/, 'コピー用テキストに「男子｜」行が出ない');
  assert.match(plain, /女子｜/, '女子の行は出る');
  await closePanel();
});

// ── 【E-server】【F】 render()側（サーバ描画・コピー用テキスト）を buildPlanData実データで検証 ──

test('(E-server) コピー用テキスト（サーバ）: 女子のみの日に「男子｜」行が出ない', async () => {
  const data = await buildPlanData(localStorages());
  const tue = data.weeks[0].days.find((d) => d.day === '火');
  tue.onlyGender = '女子';
  const { body } = render(data);
  const m = body.match(/<article class="day pageb"[^>]*data-date="2026-06-23"[^>]*>([\s\S]*?)<\/article>/);
  assert.ok(m, '火(06/23)の article が存在する');
  const plainMatch = m[1].match(/<pre class="plain" hidden>([\s\S]*?)<\/pre>/);
  assert.ok(plainMatch, 'コピー用テキスト(.plain)が存在する');
  const plain = plainMatch[1];
  assert.doesNotMatch(plain, /男子｜/, 'サーバのコピー用テキストに「男子｜」行が出ない');
  assert.match(plain, /女子｜/, '女子の行は出る');
});

test('(F) both＋onlyGender の日: 共通(both)内容が1列(spine)に出る（"—"にならない）', async () => {
  const data = await buildPlanData(localStorages());
  const tue = data.weeks[0].days.find((d) => d.day === '火');
  // 手書き/旧データ相当: 対象性別セルが無く both を持つ行を1つ作る（both＋onlyGender 共存）。
  tue.rows = [{
    from: '16:00', to: '16:30', minutes: 30,
    both: { block: 'ラン', label: '共通アップ', items: [{ name: '共通ドリルX', note: '' }] },
    boys: null, girls: null,
  }];
  tue.onlyGender = '女子';
  const { body } = render(data);
  const m = body.match(/<article class="day pageb"[^>]*data-date="2026-06-23"[^>]*>([\s\S]*?)<\/article>/);
  assert.ok(m, '火(06/23)の article が存在する');
  // .plain（テキストコピー用）には出るので、視覚タイムライン(spine)部分だけを切り出して検証する。
  const spineMatch = m[1].match(/<div id="plan-top" class="spine">([\s\S]*?)<\/div>\s*<pre/);
  assert.ok(spineMatch, '視覚タイムライン(.spine)が存在する');
  const spine = spineMatch[1];
  assert.match(spine, /共通アップ/, 'both の見出しが1列タイムラインに出る（"—"で潰れない）');
  assert.match(spine, /共通ドリルX/, 'both の項目が1列タイムラインに出る');
});
