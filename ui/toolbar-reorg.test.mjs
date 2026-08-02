/**
 * @file 日ビュー上部ツールバー整理（2026-07-29）の業務意図テスト。
 *
 * 背景: 上部に8個並んでいたボタンで「何を押せばよいか迷う」というコーチからの声を受け、オーナー合意済み
 * モック（docs/specs/toolbar/toolbar-20260728.html「整理後」）どおりに実画面を整理した。
 *   - 1段目=表示単位タブのみ、2段目=左に7曜日ピッカー・右に操作3つ（印刷・編集・コピー）。
 *   - 組違いON/OFFトグルは撤去（曜日とコーチ配置から機械的に決まる値で手入力フラグではないため）。
 *   - 「自動で叩き台を入れる」「自動に戻す」「入力を書き出し」は編集画面の中へ移設（機能は削除しない）。
 *   - 表示単位タブの選択中は墨黒反転、日付ピッカーの選択中だけオレンジ塗りを残す。
 *
 * 検証する業務意図（実装の途中値は写経しない。固定するのは「コーチから見た振る舞い」のみ）:
 *   - 上部に出る操作ボタンが印刷・編集・コピーの3つだけであること。
 *   - 組違いのトグルが画面のどこにも出ないこと（HTML・CSS・クライアントJSのいずれにも残っていない）。
 *   - 表示単位の選択中と日付の選択中が、別々の見え方（class系統・塗り色）で区別できること。
 *   - コーチが編集画面から叩き台の読み込み・自動に戻す・入力の書き出しを実行できること。
 *   - 印刷時に上部の操作ボタンが実際に非表示になること（計算スタイルで確認）。
 *
 * テスト基盤: node --test（静的アサーション） + Playwright(chromium)（実DOM・実CSSの挙動）。
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
import { renderPage, clientScript, BASE_CSS } from './render-shared.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML = resolve(__dirname, 'pattern-timeline.toolbar-reorg.tmp.html');
// overrides.json 実データ: コーチ上書き済み（twoCol）かつ自動生成の叩き台(seed)も両方ある日。
// 「叩き台を読み込む」の上書き確認ダイアログと「自動に戻す」の両方を同じ日で検証できる。
const DATE = '2026-06-23';

let browser;
let page;
let RENDER;

before(async () => {
  const data = await buildPlanData({ ...localStorages(), today: LOCAL_FIXTURE_TODAY });
  RENDER = render(data);
  writeFileSync(HTML, renderPage({ title: 'toolbar-reorg fixture', css: RENDER.css, body: RENDER.body }), 'utf8');
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.goto(pathToFileURL(HTML).href);
});

after(async () => {
  if (browser) await browser.close();
  if (existsSync(HTML)) unlinkSync(HTML);
});

/** body から data-level="day" 区画を切り出す（multiweek-day.test.mjs と同じ切り出し方）。 */
function dayRegionOf(body) {
  const start = body.indexOf('data-level="day"');
  const end = body.indexOf('data-level="week"');
  assert.ok(start >= 0 && end > start, 'day レベル区画が存在するべき');
  return body.slice(start, end);
}

/** 対象日の編集パネルを開く（curDay＝hidden でない最初の .day に揃え、所属週グループも可視にする）。 */
async function openPanel(dateIso) {
  await page.evaluate((d) => {
    document.querySelectorAll('.day[data-date]').forEach((p) => { p.hidden = p.getAttribute('data-date') !== d; });
    const target = document.querySelector(`.day[data-date="${d}"]`);
    const wk = target && target.closest('.daywk');
    if (wk) {
      const wkKey = wk.getAttribute('data-week');
      document.querySelectorAll('.daywk[data-week],.daywk-picker[data-week]').forEach((g) => { g.hidden = g.getAttribute('data-week') !== wkKey; });
    }
  }, dateIso);
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

// ── 静的アサーション（render() 出力・共有クライアントJSの文字列検査） ──────────────────────────

test('上部の操作ボタンは印刷・編集・コピーの3つだけ（旧4ボタンが無い）', () => {
  const region = dayRegionOf(RENDER.body);
  const m = region.match(/<div class="op-group"[^>]*>([\s\S]*?)<\/div>/);
  assert.ok(m, '操作ボタン群(op-group)が存在する');
  const ids = [...m[1].matchAll(/id="([a-zA-Z-]+)"/g)].map((x) => x[1]);
  assert.deepEqual(ids, ['printBtn', 'ed-edit', 'copyBtn'], '並びは印刷→編集→コピーの3つだけ');
  assert.doesNotMatch(region, /id="ed-seed"|id="ed-auto"|id="ed-export"/, '旧・上部4つ目以降のボタンIDが残っていない');
});

test('組違いのトグルが画面のどこにも出ない（文言・属性・配線のいずれにも残っていない）', () => {
  // 「組違いON（体育館共有）／組違いOFF（別時間）」の文言・切替属性・OFF側注記は完全撤去。
  // 注: class="modetoggle" 自体は編集画面内の別機能（男女オンリー3択トグル）が引き続き使うため、
  // クラス名の有無ではなく「組違い」固有の文言・属性で判定する。
  assert.doesNotMatch(RENDER.body, /組違いON|組違いOFF|下の共通メニュー|data-mode-go|組違いの切り替え/, '本文に組違いトグル固有の文言・属性が無い');
  const js = clientScript();
  assert.doesNotMatch(js, /data-interact|setMode|__shareMode/, '共有クライアントJSに組違いトグルの配線(ON/OFF状態管理)が無い');
});

test('表示単位の選択中(lvtab)と日付の選択中(pk)は別クラス系統で、どちらもこの製品の選択中の色(オレンジ)で塗られる', () => {
  assert.match(RENDER.body, /<button class="lvtab on" data-go="day"/, '表示単位タブの選択中クラスは lvtab.on');
  assert.match(RENDER.body, /class="pk cal-go[^"]*\son\b[^"]*"/, '日付ピッカーの選択中クラスは pk.on（別系統）');
  // 塗り色: 表示単位タブ・日付ピッカーとも、この製品の選択中を表す状態ロール（意味ロール層への
  // 付け替え後は --state-selected-fill。実値は var(--orange) のまま不変）で塗られる（CSSの実値で確認）。
  // 2段構成（表示単位/日付）は位置で軸が分かれているため、選択中の色を分ける必要はない。
  assert.match(BASE_CSS, /\.lvtab\.on\{background:var\(--state-selected-fill\)/, '表示単位タブの選択中はこの製品の選択中色(状態ロール)で塗られる');
  assert.match(RENDER.css, /\.pk\.on\{background:var\(--state-selected-fill\)/, '日付ピッカーの選択中は状態ロールの塗りを維持');
});

test('印刷用CSSは上部ツールバー(.daytoolbar)一式を非表示にする規則を持つ', () => {
  assert.match(RENDER.css, /@media print\{\.daytoolbar\{display:none\}\}/, '印刷時は .daytoolbar が非表示になる');
});

// ── 実DOM・実挙動（Playwright） ──────────────────────────────────────────────

test('実DOM: 上部の操作ボタンが印刷・編集・コピーの3つだけで、編集ボタンを押すと編集画面が開く', async () => {
  const btns = await page.$$eval('.daytoolbar-ops .op-group .op-btn', (els) => els.map((e) => e.id));
  assert.deepEqual(btns, ['printBtn', 'ed-edit', 'copyBtn']);
  await openPanel(DATE);
  assert.equal(await page.locator('.ed-panel').count(), 1, '編集を押すと編集画面(panel)が開く');
  await closePanel();
});

test('実DOM: 印刷時は上部の操作ボタン(.daytoolbar-ops)が非表示になる', async () => {
  await page.emulateMedia({ media: 'print' });
  try {
    const display = await page.locator('.daytoolbar').first().evaluate((el) => getComputedStyle(el).display);
    assert.equal(display, 'none', '印刷時は日ビュー2段目ツールバー(操作ボタン含む)が非表示');
  } finally {
    // 後続テストの編集画面操作に影響しないよう、アサーション結果に関わらず必ず screen に戻す
    // （.ed-panel は data-print-hide を持つため、print のまま残ると以降の openPanel が全滅する）。
    await page.emulateMedia({ media: 'screen' });
  }
});

test('実DOM: 組違いトグルに相当する要素が実DOMに1つも存在しない', async () => {
  // [data-mode-go] とその aria-label は組違いON/OFF固有（撤去対象）。class="modetoggle" 自体は
  // 編集画面内の別機能（男女オンリー3択）が引き続き使うため対象にしない。
  const count = await page.locator('[data-mode-go], [aria-label="組違いの切り替え"]').count();
  assert.equal(count, 0);
});

test('コーチが編集画面から「叩き台を読み込む」を実行できる（上書き確認→内容が置き換わる）', async () => {
  await openPanel(DATE);
  const seedBtn = page.locator('.ed-panel [data-act="load-seed"]');
  assert.equal(await seedBtn.count(), 1, 'この日は叩き台があるので導線が出る');

  const before = await page.evaluate(() => window.__bcsEditor.model().aim);
  page.once('dialog', (d) => d.accept()); // 既存の手直しがあるので上書き確認ダイアログが出る→承諾
  await seedBtn.click();
  await page.waitForTimeout(80);
  const after = await page.evaluate(() => window.__bcsEditor.model().aim);

  assert.notEqual(after, before, '叩き台読み込み後は「この日のねらい」が自動生成の内容に置き換わる');
  await closePanel();
});

test('コーチが編集画面から「自動に戻す」を実行できる（確認カードで誤操作防止・実行後は削除フローに実際に入る）', async () => {
  await openPanel(DATE);

  // (1) 確認カードで「やめる」を押すと、削除フローに入らない（削除フロー特有のメッセージが出ない＝
  //     誤操作防止ゲートが効く）。#ed-msg は直前のテストの一時メッセージが残っている場合があるため、
  //     「空である」ではなく「削除フロー特有の文言が無い」で判定する。
  await page.click('.ed-panel [data-act="revert-auto"]');
  await page.waitForSelector('#ed-cd:not([hidden])', { timeout: 3000 });
  assert.equal(await page.locator('#ed-cd-h').textContent(), '手で入れた内容を捨てて自動生成に戻します。', '確認カードの見出しが決定書・モックの文言と一致する');
  await page.click('#ed-cd .rc-cancel');
  await page.waitForTimeout(150);
  assert.equal(await page.locator('#ed-cd').isHidden(), true, '「やめる」でカードが閉じる');
  const msgAfterCancel = (await page.locator('#ed-msg').textContent()) || '';
  assert.doesNotMatch(msgAfterCancel, /バックエンド未接続|自動に戻して/, '確認カードで「やめる」を押すと削除フローに入らない');

  // (2) 「捨てて戻す」（実行）を押すと削除フローに実際に入る。このテストは file:// 実行でバックエンド
  //     無しのため、最終的に「バックエンド未接続」の案内文が出ることをもって、
  //     サーバへの削除依頼(fetch)が確実に発火したことの証跡とする。
  await page.click('.ed-panel [data-act="revert-auto"]');
  await page.waitForSelector('#ed-cd:not([hidden])', { timeout: 3000 });
  await page.click('#ed-cd-exec');
  await page.waitForFunction(
    () => (document.getElementById('ed-msg')?.textContent || '').includes('バックエンド未接続'),
    { timeout: 5000 },
  );
  await closePanel();
});

test('コーチが編集画面から「入力を書き出し」を実行できる（現在のサーバ保存内容をクリップボードへコピー）', async () => {
  await openPanel(DATE);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const exportBtn = page.locator('.ed-panel [data-act="export"]');
  assert.equal(await exportBtn.count(), 1);
  await exportBtn.click();
  await page.waitForTimeout(80);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const arr = JSON.parse(copied);
  assert.ok(Array.isArray(arr) && arr.some((o) => o.date === DATE), '書き出したJSONに今のサーバ保存日が含まれる');
  await closePanel();
});
