/**
 * @file /scrimmage 画面の描画契約テスト（spec-20260905-scrimmage-split.md 10章C）。
 *
 * 検証する業務意図:
 *   - 面1・面2に Tier・役割・身長・学年・平均・警告・評価の語や数値が一切出ない
 *     （model 自体がそれらのフィールドを持たない設計だが、描画側でも取りこぼしを機械検査する）。
 *   - model.players 全員の名前が描画結果（データ島含む）に出る。
 *   - 管理者でないとき「名簿」への導線がどこにも出ない。管理者のときは出る。
 *   - 実ブラウザ（Playwright/chromium）で 390px 幅・出欠→分ける→結果→もう一回→決める の通しが動き、
 *     横スクロール0・タップ目標44px以上・選手名18px以上を実測する（e2e/evidence 配下に保存）。
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createServer } from 'node:http';
import { chromium } from 'playwright';

import { renderScrimmagePage } from './scrimmage-page.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = resolve(__dirname, 'e2e', 'evidence');

/** `<style>...</style>` を除いた本文（可視テキスト＋データ島）だけを対象に語チェックする。
 * design-system の CSS コメントは「役割」等をUI部品の意味ロールとして使っており、
 * 選手データの禁止語（Tier・役割・身長など）とは無関係の同綴りのため対象から外す。 */
function stripStyleBlocks(html) {
  return html.replace(/<style>[\s\S]*?<\/style>/g, '');
}

// 合成名簿（実名不使用）。男女それぞれ在籍中のみを並べる。
const PLAYERS = [
  { playerId: 'M01', name: 'ホシノ', gender: 'M', active: true },
  { playerId: 'M02', name: 'ミナミ', gender: 'M', active: true },
  { playerId: 'M03', name: 'キタガワ', gender: 'M', active: true },
  { playerId: 'M04', name: 'ヒガシ', gender: 'M', active: true },
  { playerId: 'M05', name: 'ニシムラ', gender: 'M', active: true },
  { playerId: 'F01', name: 'ハルナ', gender: 'F', active: true },
  { playerId: 'F02', name: 'アキコ', gender: 'F', active: true },
  { playerId: 'F03', name: 'フユミ', gender: 'F', active: true },
  { playerId: 'F04', name: 'ナツキ', gender: 'F', active: true },
];

const BASE_MODEL = {
  school: '合成中',
  themeKey: 'default',
  tenantId: 'synthetic-tenant',
  players: PLAYERS,
};

const NON_ADMIN_MODEL = { ...BASE_MODEL, isAdmin: false, sync: null };
const ADMIN_MODEL = {
  ...BASE_MODEL,
  isAdmin: true,
  sync: {
    syncedAt: '2026-09-03T09:20:00.000Z',
    sheetUrl: 'https://docs.google.com/spreadsheets/d/synthetic-sheet-id',
    missing: [{ playerId: 'F03', name: 'フユミ', count: 1 }],
  },
};

const FORBIDDEN_WORDS = ['Tier', 'ティア', '役割', '身長', '学年', '平均', '警告', '評価'];

test('renderScrimmagePage: model 必須・players 必須を throw で守る', () => {
  assert.throws(() => renderScrimmagePage(undefined));
  assert.throws(() => renderScrimmagePage({ isAdmin: false }));
});

test('renderScrimmagePage: 禁止語（Tier/役割/身長/学年/平均/警告/評価）が一切出ない', () => {
  const html = stripStyleBlocks(renderScrimmagePage(NON_ADMIN_MODEL));
  for (const word of FORBIDDEN_WORDS) {
    assert.ok(!html.includes(word), `禁止語 "${word}" が描画結果に含まれている`);
  }
});

test('renderScrimmagePage: model.players 全員の名前が描画結果に出る', () => {
  const html = renderScrimmagePage(NON_ADMIN_MODEL);
  for (const p of PLAYERS) {
    assert.ok(html.includes(p.name), `選手名 "${p.name}" が描画結果に含まれていない`);
  }
});

test('renderScrimmagePage: 管理者でないとき「名簿」への導線が一切出ない', () => {
  const html = renderScrimmagePage(NON_ADMIN_MODEL);
  assert.ok(!html.includes('名簿'), '非管理者の描画結果に「名簿」の文字列が含まれている');
});

test('renderScrimmagePage: 管理者のとき「名簿」への導線と面3が出る', () => {
  const html = renderScrimmagePage(ADMIN_MODEL);
  assert.ok(html.includes('名簿'), '管理者の描画結果に「名簿」の文字列が無い');
  assert.ok(html.includes('id="scr-3"'), '管理者の描画結果に面3（名簿同期）が無い');
  assert.ok(html.includes('未入力 1列'), '未入力列数の表記が仕様どおりでない');
});

test('renderScrimmagePage: ホーム画面追加用メタが head に出る', () => {
  const html = renderScrimmagePage(NON_ADMIN_MODEL);
  assert.ok(html.includes('apple-mobile-web-app-capable'));
  assert.ok(html.includes('apple-mobile-web-app-title" content="チーム分け"'));
  assert.ok(html.includes('name="theme-color"'));
  assert.ok(html.includes('name="viewport"'));
});

test('renderScrimmagePage: ブラウザ側 JS は Math.random を使わない（seed 決定論を壊さない）', () => {
  const html = renderScrimmagePage(ADMIN_MODEL);
  assert.ok(!html.includes('Math.random'));
});

// ── 実ブラウザでの通し検証（Playwright/chromium）。fetch は page.route でスタブする。 ──
// fetch('/api/...') は相対パスの絶対URL解決が要るため file:// では動かない（Chromiumが
// file scheme への fetch を拒否する）。ローカルHTTPサーバで配信して確かめる。
let browser;
let httpServer;
let baseUrl;

before(async () => {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const pages = {
    '/non-admin': renderScrimmagePage(NON_ADMIN_MODEL),
    '/admin': renderScrimmagePage(ADMIN_MODEL),
  };
  httpServer = createServer((req, res) => {
    const html = pages[req.url];
    if (!html) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise((resolve_) => httpServer.listen(0, '127.0.0.1', resolve_));
  const { port } = httpServer.address();
  baseUrl = `http://127.0.0.1:${port}`;
  browser = await chromium.launch();
});

after(async () => {
  if (browser) await browser.close();
  if (httpServer) await new Promise((resolve_) => httpServer.close(resolve_));
});

test('実ブラウザ: 出欠→分ける→結果→もう一回→決める の通しが動き、390pxで崩れない', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  let splitCalls = 0;
  let decideCalls = 0;
  await page.route('**/api/scrimmage/split', async (route) => {
    splitCalls += 1;
    const body = route.request().postDataJSON();
    const seed = typeof body.seed === 'number' ? body.seed : 1;
    // 出席者を2分割した固定の疑似分割（決定論チェック用ではなく契約形状の確認用）。
    const half = Math.ceil(body.attendees.length / body.teamCount);
    const teams = [];
    for (let i = 0; i < body.teamCount; i++) teams.push(body.attendees.slice(i * half, (i + 1) * half).filter(Boolean));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, seed, teams }) });
  });
  await page.route('**/api/scrimmage/decide', async (route) => {
    decideCalls += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, id: '2026-09-05-1' }) });
  });

  await page.goto(baseUrl + '/non-admin');

  // 面1: 出欠が男子で5人分描かれている。
  const rosterCount = await page.locator('#scr1-roster li').count();
  assert.equal(rosterCount, 5, '男子の在籍5人が出欠に描かれていない');

  await page.click('#btn-split');
  await page.waitForSelector('#scr-2:not([hidden])');
  assert.equal(splitCalls, 1);

  const namesCount = await page.locator('#scr2-names li').count();
  assert.ok(namesCount > 0, '結果画面に選手名が出ていない');

  await page.click('#btn-reroll');
  await page.waitForTimeout(50);
  assert.equal(splitCalls, 2, 'もう一回で split が再度呼ばれていない');

  await page.click('#btn-decide');
  await page.waitForTimeout(50);
  assert.equal(decideCalls, 1, '決めるで decide が呼ばれていない');

  // DOM実測: 横スクロール0・タップ目標44px以上・選手名18px以上。
  const measured = await page.evaluate(() => {
    const de = document.documentElement;
    const tappable = [...document.querySelectorAll('button, a, label.chk')].map((el) => {
      const r = el.getBoundingClientRect();
      return { text: (el.innerText || '').trim().slice(0, 20), w: r.width, h: r.height };
    }).filter((t) => t.w > 0 && t.h > 0);
    const names = [...document.querySelectorAll('.chk .nm, .names li')].map((el) => ({
      text: el.innerText.trim(),
      fontSize: parseFloat(getComputedStyle(el).fontSize),
    }));
    return {
      scrollWidth: de.scrollWidth,
      viewportWidth: window.innerWidth,
      tappableUnder44: tappable.filter((t) => t.w < 44 || t.h < 44),
      namesUnder18: names.filter((n) => n.fontSize < 18),
      namesCount: names.length,
    };
  });

  writeFileSync(
    resolve(EVIDENCE_DIR, `scrimmage-page-dom-${new Date().toISOString().replace(/[:.]/g, '-')}.json`),
    JSON.stringify(measured, null, 2),
  );

  assert.ok(measured.scrollWidth <= measured.viewportWidth, `横スクロールが発生している（scrollWidth=${measured.scrollWidth} > viewportWidth=${measured.viewportWidth}）`);
  assert.deepEqual(measured.tappableUnder44, [], 'タップ目標44px未満の要素がある');
  assert.deepEqual(measured.namesUnder18, [], '選手名フォント18px未満の要素がある');
  assert.ok(measured.namesCount > 0);

  await page.close();
});

test('実ブラウザ: 男子/女子ピルを切り替えると出欠リストが入れ替わる', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(baseUrl + '/non-admin');
  assert.equal(await page.locator('#scr1-roster li').count(), 5);
  await page.click('#gender-seg [data-gender="F"]');
  assert.equal(await page.locator('#scr1-roster li').count(), 4);
  const names = await page.locator('#scr1-roster .nm').allInnerTexts();
  assert.deepEqual(names.sort(), ['アキコ', 'ナツキ', 'ハルナ', 'フユミ'].sort());
  await page.close();
});

test('実ブラウザ: split 失敗時は面を変えずエラー文を出す', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route('**/api/scrimmage/split', async (route) => {
    await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'attendees が不正です' }) });
  });
  await page.goto(baseUrl + '/non-admin');
  await page.click('#btn-split');
  await page.waitForSelector('#scr1-err:not([hidden])');
  const errText = await page.locator('#scr1-err').innerText();
  assert.equal(errText, 'attendees が不正です');
  assert.equal(await page.locator('#scr-1').isHidden(), false, '失敗時に面1から離脱している');
  await page.close();
});

test('実ブラウザ: 管理者は「名簿」から面3へ入り「名簿を同期」できる。非管理者には導線が無い', async () => {
  const nonAdminPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await nonAdminPage.goto(baseUrl + '/non-admin');
  assert.equal(await nonAdminPage.locator('#btn-roster').count(), 0);
  assert.equal(await nonAdminPage.locator('#scr-3').count(), 0);
  await nonAdminPage.close();

  const adminPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  let syncCalls = 0;
  await adminPage.route('**/api/roster/sync', async (route) => {
    syncCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, syncedAt: '2026-09-05T10:00:00.000Z', count: 9, skipped: 0, missing: [] }),
    });
  });
  await adminPage.goto(baseUrl + '/admin');
  assert.equal(await adminPage.locator('#btn-roster').count(), 1);
  await adminPage.click('#btn-roster');
  await adminPage.waitForSelector('#scr-3:not([hidden])');
  const missingBefore = await adminPage.locator('#scr3-missing li').count();
  assert.equal(missingBefore, 1, '事前描画済みの未入力一覧が出ていない');

  await adminPage.click('#btn-sync');
  await adminPage.waitForTimeout(50);
  assert.equal(syncCalls, 1);
  const syncedText = await adminPage.locator('#scr3-synced').innerText();
  assert.ok(syncedText.includes('9/5'), `同期後の表示に日付が反映されていない: ${syncedText}`);
  const missingAfter = await adminPage.locator('#scr3-missing li').count();
  assert.equal(missingAfter, 1, '同期後に未入力ゼロの表示へ切り替わっていない');
  const missingAfterText = await adminPage.locator('#scr3-missing').innerText();
  assert.ok(missingAfterText.includes('未入力の項目はありません'));

  await adminPage.click('#btn-back-from-roster');
  await adminPage.waitForSelector('#scr-1:not([hidden])');
  await adminPage.close();
});
