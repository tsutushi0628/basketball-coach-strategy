import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, webkit } from '@playwright/test';
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildPlanData } from './plan-data.mjs';
import { localStorages, LOCAL_FIXTURE_TODAY } from './build.mjs';
import { render } from './pattern-timeline.mjs';
import { renderPage } from './render-shared.mjs';
import { EDITOR_CSS, editorDataIsland, editorScript } from './editor.mjs';

const HTML = join(process.cwd(), '.tmp', 'editor-together-preview.test.html');
const keyboardEvidence = [];
const pointerEvidence = [];
const browsers = new Map();
let browser;
let page;

before(async () => {
  const data = await buildPlanData({ ...localStorages(), today: LOCAL_FIXTURE_TODAY });
  const { css, body } = render(data);
  mkdirSync(join(process.cwd(), '.tmp'), { recursive: true });
  writeFileSync(HTML, renderPage({ title: 'editor together preview', css, body }), 'utf8');
  browser = await chromium.launch();
  browsers.set('chromium', browser);
  browsers.set('webkit', await webkit.launch());
  page = await browser.newPage();
  await page.goto(pathToFileURL(HTML).href);
});

after(async () => {
  await Promise.all([...browsers.values()].map((engine) => engine.close()));
  const evidence = new URL('../.tmp/e2e/evidence/', import.meta.url);
  mkdirSync(evidence, { recursive: true });
  writeFileSync(new URL('practice-start-keyboard.json', evidence), JSON.stringify(keyboardEvidence, null, 2));
  writeFileSync(new URL('practice-start-pointer.json', evidence), JSON.stringify(pointerEvidence, null, 2));
  try { unlinkSync(HTML); } catch {}
});

test('raw identical gender cells use the one-column editor preview', async () => {
  const html = await page.evaluate(() => {
    const cell = { block: 'ファンダ', label: '基礎', items: [{ name: 'パス', note: '正確に' }] };
    const ov = { date: '2026-06-23', weekday: '火', court: '全面', aim: '', rows: [
      { from: '16:00', to: '16:20', 男子: cell, 女子: structuredClone(cell) },
      { from: '16:20', to: '16:40', 男子: cell, 女子: structuredClone(cell) },
    ] };
    const article = document.createElement('article');
    window.__bcsEditor.renderDay(article, ov);
    return article.innerHTML;
  });
  assert.match(html, /id="plan-top" class="spine spine-only"/);
  assert.match(html, /基礎|パス/, 'raw gender cell content is retained in the one-column band');
  assert.doesNotMatch(html, /spine-header|spine-band right|tc2-split/);
});

test('a mixed post-save preview keeps matching rows in one column and splits only the differing rows', async () => {
  const html = await page.evaluate(() => {
    const same = { block: 'ファンダ', label: '基礎', items: [{ name: '共通ドリル', note: '' }] };
    const ov = { date: '2026-06-23', weekday: '火', court: '全面', aim: '', rows: [
      { from: '16:00', to: '16:20', 男子: same, 女子: structuredClone(same) },
      {
        from: '16:20', to: '16:40',
        男子: { block: 'シュート', label: 'シュート', items: [{ name: '男子だけ', note: '' }] },
        女子: { block: 'ラン', label: 'ラン', items: [{ name: '女子だけ', note: '' }] },
      },
    ] };
    const article = document.createElement('article');
    window.__bcsEditor.renderDay(article, ov);
    return article.innerHTML;
  });
  assert.match(html, /id="plan-top" class="spine spine-only"/, '親spineは常に左端レールの1列モード');
  // class="tc2-bn"で視覚バンド側だけを見る（.plainのコピー用テキスト側の重複はカウントしない）。
  assert.equal((html.match(/class="tc2-bn">共通ドリル/g) || []).length, 1, '一致行の内容は左右に複製されない');
  assert.match(html, /spine-row spine-rotation tc2-only tc2-split/, '相違行だけ2列に割れる');
  assert.equal((html.match(/tc2-runhead/g) || []).length, 1, '相違区間の先頭にだけ見出しが1回出る');
});

test('a fully differing preview keeps every row split with a single leading heading', async () => {
  const html = await page.evaluate(() => {
    const ov = { date: '2026-06-23', weekday: '火', court: '全面', aim: '', rows: [
      { from: '16:00', to: '16:20', 男子: { block: 'ラン', label: 'ラン', items: [{ name: '男子A', note: '' }] }, 女子: { block: 'ラン', label: 'ラン', items: [{ name: '女子A', note: '' }] } },
      { from: '16:20', to: '16:40', 男子: { block: 'ラン', label: 'ラン', items: [{ name: '男子B', note: '' }] }, 女子: { block: 'ラン', label: 'ラン', items: [{ name: '女子B', note: '' }] } },
    ] };
    const article = document.createElement('article');
    window.__bcsEditor.renderDay(article, ov);
    return article.innerHTML;
  });
  assert.equal((html.match(/spine-row spine-rotation tc2-only tc2-split/g) || []).length, 2, '全行が2列のまま');
  assert.equal((html.match(/tc2-runhead/g) || []).length, 1, '連続する全行相違は見出し1回にまとまる');
  assert.doesNotMatch(html, /spine-band right/, '中央固定の左右ミラーは出さない');
});

const PRACTICE_TIMES = [['09:00', '09:20'], ['09:20', '10:00'], ['10:10', '11:30']];

/** 時刻だけ異なる編集用の日を、既存のデータ島と実スクリプトで開く。 */
async function openPracticePanel(t, times, copyTimes = PRACTICE_TIMES, pageOptions = {}, browserName = 'chromium') {
  const practicePage = await browsers.get(browserName).newPage({ locale: 'ja-JP', reducedMotion: 'reduce', ...pageOptions });
  t.after(() => practicePage.close());
  const makeRows = (values) => values.map(([from, to], index) => ({
    from, to, both: { block: 'ファンダ', label: `練習${index + 1}`, items: [{ name: 'パス', note: '' }] },
  }));
  const data = {
    days: [
      { source: 'coach', twoCol: true, date: '2026-10-17', rows: makeRows(times) },
      { source: 'coach', twoCol: true, date: '2026-10-11', rows: makeRows(copyTimes) },
    ],
    seedDays: [{ date: '2026-10-17', blocks: [
      { from: '07:30', to: '08:00', block: 'ファンダ', items: [{ name: 'パス' }] },
    ] }],
  };
  await practicePage.setContent(renderPage({ title: 'editor practice start', css: EDITOR_CSS, body: `
    <button id="ed-edit" type="button">編集</button><span id="ed-msg"></span>
    <article class="day" data-date="2026-10-17" data-day="土"></article>
    ${editorDataIsland(data)}`, script: editorScript() }));
  await practicePage.click('#ed-edit');
  return practicePage;
}

/** 入力途中と確定を分けてイベントを送る。 */
async function changePracticeTime(practicePage, selector, value, eventType) {
  await practicePage.$eval(selector, (input, detail) => {
    input.value = detail.value;
    input.dispatchEvent(new Event(detail.eventType, { bubbles: true }));
  }, { value, eventType });
}

/** 編集モデルと表示の両方を読み、時刻と練習内容の一致を検証できるようにする。 */
async function practiceState(practicePage) {
  return practicePage.evaluate(() => ({
    start: document.querySelector('#ed-start').value,
    rows: window.__bcsEditor.model().rows,
    times: [...document.querySelectorAll('.ed-row')].map((row) => [
      row.querySelector('[data-k="from"]').value,
      row.querySelector('[data-k="to"]').value,
    ]),
    message: document.querySelector('#ed-start-msg').textContent,
  }));
}

/** 保存要求を記録し、blur後にサーバ応答を返せるようにする。 */
async function capturePracticeSave(practicePage) {
  await practicePage.evaluate(() => {
    window.__saveRequests = [];
    window.fetch = (url, options) => {
      const override = JSON.parse(options.body);
      window.__saveRequests.push({ url, method: options.method, override });
      return new Promise((resolve) => {
        window.__completeSave = () => resolve({
          status: 200,
          json: async () => ({ ok: true, override }),
        });
      });
    };
  });
}

test('練習開始: blur前の保存で17:00へ一度だけずらし、blurと保存の順序によらず同じ内容を送る', async (t) => {
  for (const blurFirst of [false, true]) {
    const practicePage = await openPracticePanel(t, PRACTICE_TIMES);
    await capturePracticeSave(practicePage);
    await practicePage.locator('#ed-start').focus();
    await changePracticeTime(practicePage, '#ed-start', '17:00', 'input');
    if (blurFirst) {
      await practicePage.locator('#ed-aim').focus();
    }
    await practicePage.click('[data-act="save"]');
    await practicePage.waitForFunction(() => window.__saveRequests.length === 1);
    const committed = await practiceState(practicePage);
    const expectedTimes = [['17:00', '17:20'], ['17:20', '18:00'], ['18:10', '19:30']];
    assert.deepEqual(committed.times, expectedTimes);
    assert.equal(committed.start, '17:00');
    await practicePage.locator('#ed-aim').focus();
    assert.deepEqual(await practiceState(practicePage), committed, '保存前確定後のblurでは二重適用しない');
    const requests = await practicePage.evaluate(() => window.__saveRequests);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/api/override');
    assert.equal(requests[0].method, 'POST');
    assert.deepEqual(requests[0].override.rows.map((row) => [row.from, row.to, row.minutes]), [
      ['17:00', '17:20', 20], ['17:20', '18:00', 40], ['18:10', '19:30', 80],
    ]);
    assert.equal(Object.hasOwn(requests[0].override, 'start'), false);
    await practicePage.evaluate(() => window.__completeSave());
    await practicePage.waitForFunction(() => !document.querySelector('.ed-panel'));
    assert.match(await practicePage.locator('.day').innerText(), /17:00/);
    await practicePage.click('#ed-edit');
    assert.deepEqual((await practiceState(practicePage)).times, expectedTimes, '保存内容を再編集しても一度分の移動を保つ');
  }
});

test('練習開始: blur前の保存で00:00前・24:00以上になる値を拒否し、保存要求を送らない', async (t) => {
  for (const boundary of [
    { times: [['09:00', '09:20'], ['', '00:10']], value: '08:00', reason: /00:00/ },
    { times: [['09:00', '09:20'], ['16:00', '17:00']], value: '17:00', reason: /24:00/ },
  ]) {
    const practicePage = await openPracticePanel(t, boundary.times);
    await capturePracticeSave(practicePage);
    const initial = await practiceState(practicePage);
    await practicePage.locator('#ed-start').focus();
    await changePracticeTime(practicePage, '#ed-start', boundary.value, 'input');
    await practicePage.click('[data-act="save"]');
    const rejected = await practiceState(practicePage);
    assert.deepEqual(await practicePage.evaluate(() => window.__saveRequests), []);
    assert.equal(rejected.start, boundary.value);
    assert.deepEqual(rejected.rows, initial.rows);
    assert.deepEqual(rejected.times, initial.times);
    assert.match(rejected.message, boundary.reason);
    assert.equal(await practicePage.locator('#ed-start').evaluate((input) => input.nextElementSibling.id), 'ed-start-msg');
    assert.equal(await practicePage.locator('#ed-msg').textContent(), '');
    await practicePage.locator('#ed-aim').focus();
    assert.deepEqual(await practiceState(practicePage), rejected);
  }
});

for (const browserName of ['chromium', 'webkit']) {
  test(`練習開始: ${browserName}のプレビュー・行追加・項目追加・男女切替も未確定値を先に適用し、拒否時は操作を止める`, async (t) => {
    for (const operation of ['preview', 'add-row', 'add-item', 'only-gender', 'toggle-both']) {
      for (const value of ['17:00', '23:00']) {
        const practicePage = await openPracticePanel(t, PRACTICE_TIMES, PRACTICE_TIMES, {}, browserName);
        const initial = await practiceState(practicePage);
        await practicePage.locator('#ed-start').focus();
        await changePracticeTime(practicePage, '#ed-start', value, 'input');
        if (operation === 'only-gender') {
          practicePage.once('dialog', (dialog) => dialog.accept());
        }
        let preview = null;
        if (operation === 'preview') {
          preview = await practicePage.evaluate(() => window.__bcsEditor.buildOverride());
        } else {
          await practicePage.click('[data-act="' + operation + '"]');
        }
        const state = await practiceState(practicePage);
        if (value === '23:00') {
          assert.equal(preview, null);
          assert.deepEqual(state.rows, initial.rows, operation);
          assert.deepEqual(state.times, initial.times, operation);
          assert.equal(state.start, value, operation);
          assert.match(state.message, /24:00/, operation);
          assert.equal(await practicePage.locator('[data-act="toggle-both"]').first().isChecked(), true);
          continue;
        }
        const expectedTimes = [['17:00', '17:20'], ['17:20', '18:00'], ['18:10', '19:30']];
        if (operation === 'add-row') {
          expectedTimes.push(['19:30', '19:30']);
        }
        assert.deepEqual(state.times, expectedTimes, operation);
        assert.equal(state.start, value, operation);
        if (operation === 'preview') {
          assert.deepEqual(preview.rows.map((row) => [row.from, row.to]), expectedTimes);
          assert.deepEqual(await practicePage.evaluate(() => window.__bcsEditor.buildOverride()), preview);
        } else if (operation === 'add-item') {
          assert.equal(state.rows[0].both.items.length, initial.rows[0].both.items.length + 1);
        } else if (operation === 'only-gender') {
          assert.equal(await practicePage.evaluate(() => window.__bcsEditor.model().onlyGender), '女子');
        } else if (operation === 'toggle-both') {
          assert.equal(await practicePage.locator('[data-act="toggle-both"]').first().isChecked(), false);
          assert.equal(state.rows[0].both, null);
        }
        await practicePage.locator('#ed-aim').focus();
        assert.deepEqual(await practiceState(practicePage), state, operation + '後のblurでも二重適用しない');
      }
    }
  });

  for (const pointer of [
    { method: 'click', viewport: { width: 1280, height: 1600 }, hasTouch: false },
    { method: 'tap', viewport: { width: 390, height: 844 }, hasTouch: true },
  ]) {
    for (const value of ['17:00', '23:00']) {
      test(`練習開始: ${browserName}の${pointer.method}で8行の日を保存し、範囲外なら理由を画面内に保って再保存も止める（${value}）`, async (t) => {
        const times = [...PRACTICE_TIMES, ...Array.from({ length: 5 }, () => ['10:10', '11:30'])];
        const practicePage = await openPracticePanel(t, times, PRACTICE_TIMES, {
          viewport: pointer.viewport, hasTouch: pointer.hasTouch,
        }, browserName);
        await capturePracticeSave(practicePage);
        const initial = await practiceState(practicePage);
        await practicePage.locator('#ed-start').focus();
        await changePracticeTime(practicePage, '#ed-start', value, 'input');
        const save = practicePage.locator('[data-act="save"]');
        await save.scrollIntoViewIfNeeded();
        await practicePage.evaluate(() => window.scrollTo({ top: window.scrollY, behavior: 'instant' }));
        const scrollBefore = await practicePage.evaluate(() => window.scrollY);
        const before = await save.evaluate((button) => button.getBoundingClientRect().top);
        const layoutBefore = await save.evaluate((button) => button.offsetTop);
        if (pointer.hasTouch) {
          await practicePage.tap('[data-act="save"]');
        } else {
          await practicePage.click('[data-act="save"]');
        }
        await practicePage.mouse.move(0, 0);
        await practicePage.waitForFunction(() => document.querySelector('[data-act="save"]').getAnimations().length === 0);
        const after = await save.evaluate((button) => button.getBoundingClientRect().top);
        const scrollAfter = await practicePage.evaluate(() => window.scrollY);
        const message = practicePage.locator('#ed-start-msg');
        const measurement = await message.evaluate((element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          return {
            rect: element.getBoundingClientRect().toJSON(),
            lineCount: new Set([...range.getClientRects()].map((rect) => rect.top)).size,
            text: element.textContent,
            lineHeight: getComputedStyle(element).lineHeight,
          };
        });
        pointerEvidence.push({ browserName, ...pointer, value, before, after, scrollBefore, scrollAfter, measurement });
        t.diagnostic(JSON.stringify({ browserName, ...pointer, value, before, after, scrollBefore, scrollAfter, measurement }));
        assert.equal(await save.evaluate((button) => button.offsetTop), layoutBefore, '通知で保存ボタンのレイアウト位置を動かさない');
        assert.equal(await message.isVisible(), true);
        const state = await practiceState(practicePage);
        const requests = await practicePage.evaluate(() => window.__saveRequests);
        if (value === '23:00') {
          assert.equal(requests.length, 0, '拒否した値でも元の時刻でも保存しない');
          assert.equal(await practicePage.locator('.ed-panel').isVisible(), true);
          assert.deepEqual(state.rows, initial.rows);
          assert.deepEqual(state.times, initial.times);
          assert.equal(state.start, value);
          assert.match(state.message, /24:00以降/);
          assert.ok(measurement.rect.top >= 0 && measurement.rect.bottom <= pointer.viewport.height,
            '保存の直後にスクロールを手助けせず拒否理由を読める');
          assert.ok(measurement.rect.left >= 0 && measurement.rect.right <= pointer.viewport.width);
          assert.equal(await practicePage.locator('#ed-start').evaluate((input) => input === document.activeElement), true);
          if (pointer.hasTouch) {
            await save.tap();
          } else {
            await save.click();
          }
          assert.equal(await practicePage.evaluate(() => window.__saveRequests.length), 0, '再保存も送信しない');
          assert.deepEqual(await practiceState(practicePage), state);
          assert.equal(await message.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return rect.top >= 0 && rect.bottom <= innerHeight;
          }), true, '再保存でも理由を画面内に戻す');
          await changePracticeTime(practicePage, '#ed-start', '17:00', 'input');
          assert.equal(await message.textContent(), '', '入力を直すと理由を消す');
          if (pointer.hasTouch) {
            await save.tap();
          } else {
            await save.click();
          }
          assert.equal(await practicePage.evaluate(() => window.__saveRequests.length), 1, '直せば保存できる');
          await practicePage.evaluate(() => window.__completeSave());
          await practicePage.waitForFunction(() => !document.querySelector('.ed-panel'));
          return;
        }
        assert.equal(scrollAfter, scrollBefore, '有効値の保存ではスクロールを動かさない');
        assert.equal(requests.length, 1, '1回の操作で1件だけ保存する');
        const expectedTimes = [['17:00', '17:20'], ['17:20', '18:00'], ...Array.from({ length: 6 }, () => ['18:10', '19:30'])];
        assert.deepEqual(state.times, expectedTimes);
        assert.deepEqual(requests[0].override.rows.map((row) => [row.from, row.to]), expectedTimes);
        await practicePage.locator('#ed-start').focus();
        await practicePage.locator('#ed-aim').focus();
        assert.deepEqual(await practiceState(practicePage), state, '確定後のblurで二重適用しない');
        await practicePage.evaluate(() => window.__completeSave());
        await practicePage.waitForFunction(() => !document.querySelector('.ed-panel'));
        assert.match(await practicePage.locator('.day').innerText(), /17:00/);
      });
    }

    for (const operation of ['cancel', 'revert-auto', 'load-seed', 'copy-from']) {
      test(`練習開始: ${browserName}の${pointer.method}の${operation}は未確定値を捨てて1回で確認へ進む`, async (t) => {
        for (const value of ['17:00', '23:00']) {
          const practicePage = await openPracticePanel(t, PRACTICE_TIMES, [['12:00', '13:00']], {
            viewport: pointer.viewport, hasTouch: pointer.hasTouch,
          }, browserName);
          if (operation === 'copy-from') {
            await practicePage.locator('.cf-radio').check();
          }
          const initial = await practiceState(practicePage);
          await practicePage.locator('#ed-start').focus();
          await changePracticeTime(practicePage, '#ed-start', value, 'input');
          if (value === '23:00') {
            await practicePage.locator('#ed-aim').focus();
            assert.match((await practiceState(practicePage)).message, /24:00/);
          }
          let confirmations = 0;
          if (operation === 'load-seed' || operation === 'copy-from') {
            practicePage.once('dialog', async (dialog) => {
              confirmations += 1;
              await dialog.dismiss();
            });
          }
          if (pointer.hasTouch) {
            await practicePage.tap(`[data-act="${operation}"]`);
          } else {
            await practicePage.click(`[data-act="${operation}"]`);
          }
          if (operation === 'cancel' || operation === 'revert-auto') {
            assert.equal(await practicePage.locator('#ed-cd').isVisible(), true);
            await practicePage.click('#ed-cd .rc-cancel');
          } else {
            assert.equal(confirmations, 1, '未確定の範囲外値で上書き確認を止めない');
          }
          assert.deepEqual(await practiceState(practicePage), initial, '開始時刻の検査・移動・通知を行わず有効値へ戻す');
          await practicePage.locator('#ed-start').focus();
          await changePracticeTime(practicePage, '#ed-start', '10:00', 'input');
          await practicePage.locator('#ed-aim').focus();
          assert.deepEqual((await practiceState(practicePage)).times, [
            ['10:00', '10:20'], ['10:20', '11:00'], ['11:10', '12:30'],
          ], '確認をやめた後も次のblurで確定する');
          if (operation === 'load-seed' || operation === 'copy-from') {
            await practicePage.locator('#ed-start').focus();
            await changePracticeTime(practicePage, '#ed-start', value, 'input');
            practicePage.once('dialog', (dialog) => dialog.accept());
            if (pointer.hasTouch) {
              await practicePage.tap(`[data-act="${operation}"]`);
            } else {
              await practicePage.click(`[data-act="${operation}"]`);
            }
            let expectedTimes = [['07:30', '08:00']];
            if (operation === 'copy-from') {
              expectedTimes = [['12:00', '13:00']];
            }
            assert.deepEqual((await practiceState(practicePage)).times, expectedTimes);
          }
        }
      });
    }
  }
}

test('練習開始: 390pxで文字を拡大して通知が2行になっても表示・消去でボタンを動かさない', async (t) => {
  const viewport = { width: 390, height: 844 };
  for (const value of ['17:00', '23:00']) {
    const practicePage = await openPracticePanel(t, PRACTICE_TIMES, PRACTICE_TIMES, { viewport, hasTouch: true });
    await practicePage.clock.install();
    await practicePage.locator('#ed-start-msg').evaluate((message) => {
      message.style.fontSize = parseFloat(getComputedStyle(message).fontSize) * 1.25 + 'px';
    });
    const start = practicePage.locator('#ed-start');
    const save = practicePage.locator('[data-act="save"]');
    await start.focus();
    await changePracticeTime(practicePage, '#ed-start', value, 'input');
    const before = await save.evaluate((button) => {
      window.scrollTo({ top: 0, behavior: 'instant' });
      return button.getBoundingClientRect().top;
    });
    await practicePage.keyboard.press('Enter');
    const after = await save.evaluate((button) => {
      window.scrollTo({ top: 0, behavior: 'instant' });
      return button.getBoundingClientRect().top;
    });
    const lineCount = await practicePage.locator('#ed-start-msg').evaluate((message) => {
      const range = document.createRange();
      range.selectNodeContents(message);
      return new Set([...range.getClientRects()].map((rect) => rect.top)).size;
    });
    assert.equal(lineCount, 2);
    assert.equal(after, before);
    await practicePage.clock.runFor(5000);
    if (value === '23:00') {
      assert.match(await practicePage.locator('#ed-start-msg').textContent(), /24:00/);
      await practicePage.keyboard.press('Escape');
      assert.equal(await start.inputValue(), PRACTICE_TIMES[0][0]);
    }
    assert.equal(await practicePage.locator('#ed-start-msg').textContent(), '');
    const cleared = await save.evaluate((button) => {
      window.scrollTo({ top: 0, behavior: 'instant' });
      return button.getBoundingClientRect().top;
    });
    assert.equal(cleared, before);
    pointerEvidence.push({ viewport, value, textScale: 1.25, lineCount, before, after, cleared });
  }
});

test('練習開始: Chromiumで1700を入力してTabで叩き台ボタンへ移ると確定し、時間帯の編集でも戻らない', async (t) => {
  const practicePage = await openPracticePanel(t, PRACTICE_TIMES);
  await practicePage.locator('#ed-start').focus();
  await practicePage.keyboard.type('1700');
  await practicePage.keyboard.press('Tab');
  await practicePage.keyboard.press('Tab');
  assert.equal(await practicePage.locator('[data-act="load-seed"]').evaluate((button) => button === document.activeElement), true);
  const committed = await practiceState(practicePage);
  assert.equal(committed.start, '17:00');
  assert.deepEqual(committed.times, [['17:00', '17:20'], ['17:20', '18:00'], ['18:10', '19:30']]);
  let confirmations = 0;
  practicePage.once('dialog', async (dialog) => {
    confirmations += 1;
    await dialog.dismiss();
  });
  await practicePage.keyboard.press('Enter');
  assert.equal(confirmations, 1);
  assert.deepEqual(await practiceState(practicePage), committed);
  await changePracticeTime(practicePage, '.ed-row [data-k="to"]', '17:30', 'change');
  const edited = await practiceState(practicePage);
  assert.equal(edited.start, '17:00');
  assert.deepEqual(edited.times, [['17:00', '17:30'], ['17:20', '18:00'], ['18:10', '19:30']]);
});

for (const browserName of ['chromium', 'webkit']) {
  test(`練習開始: ${browserName}でclickが300ms遅れてもキャンセル後に行をずらさない`, async (t) => {
    for (const value of ['17:00', '23:00']) {
      const practicePage = await openPracticePanel(t, PRACTICE_TIMES, PRACTICE_TIMES, {}, browserName);
      const initial = await practiceState(practicePage);
      await practicePage.locator('#ed-start').focus();
      await changePracticeTime(practicePage, '#ed-start', value, 'input');
      const measurement = await practicePage.evaluate(async () => {
        const cancel = document.querySelector('[data-act="cancel"]');
        cancel.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, pointerType: 'touch', button: 0 }));
        cancel.focus();
        cancel.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, pointerType: 'touch', button: 0 }));
        const releasedAt = performance.now();
        await new Promise((resolve) => setTimeout(resolve, 300));
        const delay = performance.now() - releasedAt;
        const rowsBeforeClick = structuredClone(window.__bcsEditor.model().rows);
        cancel.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
        return { delay, rowsBeforeClick };
      });
      pointerEvidence.push({ browserName, operation: 'delayed-cancel', value, measurement });
      assert.ok(measurement.delay >= 300);
      assert.deepEqual(measurement.rowsBeforeClick, initial.rows, '遅延click前にblurを確定しない');
      assert.equal(await practicePage.locator('#ed-cd').isVisible(), true);
      await practicePage.click('#ed-cd .rc-cancel');
      await practicePage.waitForTimeout(450);
      assert.deepEqual(await practiceState(practicePage), initial, 'やめる後も待機タイマーでずらさない');
    }
  });

  test(`練習開始: ${browserName}のblur拒否は焦点・スクロールを戻さず持続し、時間帯の手直しでも未確定値を保つ`, async (t) => {
    const practicePage = await openPracticePanel(t, PRACTICE_TIMES, PRACTICE_TIMES, {}, browserName);
    await capturePracticeSave(practicePage);
    await practicePage.clock.install();
    const initial = await practiceState(practicePage);
    await practicePage.locator('#ed-start').focus();
    await changePracticeTime(practicePage, '#ed-start', '23:00', 'input');
    const movement = await practicePage.evaluate(() => {
      const before = scrollY;
      document.querySelector('#ed-aim').focus({ preventScroll: true });
      return { before, after: scrollY, focused: document.activeElement.id };
    });
    assert.equal(movement.before, movement.after);
    assert.equal(movement.focused, 'ed-aim');
    const rejected = await practiceState(practicePage);
    assert.equal(rejected.start, '23:00');
    assert.deepEqual(rejected.rows, initial.rows);
    assert.match(rejected.message, /24:00/);
    await practicePage.clock.runFor(6000);
    assert.deepEqual(await practiceState(practicePage), rejected, '5秒を過ぎても値と理由を保つ');
    await changePracticeTime(practicePage, '.ed-row[data-ri="0"] [data-k="from"]', '09:10', 'change');
    await changePracticeTime(practicePage, '.ed-row[data-ri="0"] [data-k="to"]', '09:30', 'change');
    const edited = await practiceState(practicePage);
    assert.equal(edited.start, '23:00');
    assert.deepEqual(edited.rows.map((row) => [row.from, row.to]), edited.times);
    assert.deepEqual(edited.times, [['09:10', '09:30'], ...PRACTICE_TIMES.slice(1)]);
    await practicePage.click('[data-act="save"]');
    assert.equal(await practicePage.evaluate(() => window.__saveRequests.length), 0);
    assert.equal((await practiceState(practicePage)).start, '23:00');
    await practicePage.keyboard.press('Escape');
    assert.equal((await practiceState(practicePage)).start, '09:10');
    assert.equal((await practiceState(practicePage)).message, '');
    await changePracticeTime(practicePage, '#ed-start', '17:00', 'input');
    await practicePage.click('[data-act="save"]');
    const saved = await practicePage.evaluate(() => window.__saveRequests);
    assert.equal(saved.length, 1);
    assert.deepEqual(saved[0].override.rows.map((row) => [row.from, row.to]), [
      ['17:00', '17:20'], ['17:10', '17:50'], ['18:00', '19:20'],
    ]);
  });

  test(`練習開始: ${browserName}の保存拒否は動きを減らす設定に合わせて欄を中央へ戻す`, async (t) => {
    for (const reducedMotion of ['reduce', 'no-preference']) {
      const practicePage = await openPracticePanel(t, PRACTICE_TIMES, PRACTICE_TIMES, { reducedMotion }, browserName);
      await capturePracticeSave(practicePage);
      await practicePage.locator('#ed-start').evaluate((input) => {
        window.__startScrolls = [];
        const scrollIntoView = input.scrollIntoView;
        input.scrollIntoView = function (options) {
          window.__startScrolls.push(options);
          return scrollIntoView.call(this, options);
        };
      });
      await practicePage.locator('#ed-start').focus();
      await changePracticeTime(practicePage, '#ed-start', '23:00', 'input');
      await practicePage.click('[data-act="save"]');
      const scrolls = await practicePage.evaluate(() => window.__startScrolls);
      assert.equal(scrolls.length, 1);
      assert.equal(scrolls[0].block, 'center');
      if (reducedMotion === 'reduce') {
        assert.notEqual(scrolls[0].behavior, 'smooth');
      } else {
        assert.equal(scrolls[0].behavior, 'smooth');
      }
      await practicePage.waitForFunction(() => {
        const rect = document.querySelector('#ed-start-msg').getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= innerHeight;
      });
      assert.equal(await practicePage.locator('#ed-start').evaluate((input) => input === document.activeElement), true);
      assert.equal(await practicePage.evaluate(() => window.__saveRequests.length), 0);
    }
  });

  test(`練習開始: ${browserName}でボタン外へ離してclickが来なくても確定し、次のblurも確定する`, async (t) => {
    for (const value of ['17:00', '23:00']) {
      const practicePage = await openPracticePanel(t, PRACTICE_TIMES, PRACTICE_TIMES, {}, browserName);
      await capturePracticeSave(practicePage);
      const initial = await practiceState(practicePage);
      const save = practicePage.locator('[data-act="save"]');
      await save.scrollIntoViewIfNeeded();
      await practicePage.locator('#ed-start').focus();
      await changePracticeTime(practicePage, '#ed-start', value, 'input');
      await save.hover();
      await practicePage.mouse.down();
      assert.deepEqual((await practiceState(practicePage)).rows, initial.rows, 'pointerdown後のblurではずらさない');
      await practicePage.mouse.move(0, 0);
      await practicePage.mouse.up();
      await practicePage.waitForFunction(() => document.querySelector('#ed-start-msg').textContent !== '');
      const state = await practiceState(practicePage);
      assert.deepEqual(await practicePage.evaluate(() => window.__saveRequests), []);
      if (value === '23:00') {
        assert.deepEqual(state.rows, initial.rows);
        assert.match(state.message, /24:00以降/);
      } else {
        assert.deepEqual(state.times, [['17:00', '17:20'], ['17:20', '18:00'], ['18:10', '19:30']]);
      }
      await practicePage.locator('#ed-start').focus();
      await changePracticeTime(practicePage, '#ed-start', '10:00', 'input');
      await practicePage.locator('#ed-aim').focus();
      assert.deepEqual((await practiceState(practicePage)).times, [
        ['10:00', '10:20'], ['10:20', '11:00'], ['11:10', '12:30'],
      ]);
    }
  });

  test(`練習開始: ${browserName}で焦点がある間は時間帯の同期で入力を上書きしない`, async (t) => {
    const practicePage = await openPracticePanel(t, PRACTICE_TIMES, PRACTICE_TIMES, {}, browserName);
    await practicePage.locator('#ed-start').focus();
    await changePracticeTime(practicePage, '#ed-start', '17:00', 'input');
    await changePracticeTime(practicePage, '.ed-row [data-k="to"]', '09:30', 'change');
    assert.equal((await practiceState(practicePage)).start, '17:00');
    assert.equal(await practicePage.locator('#ed-start').evaluate((input) => input === document.activeElement), true);
    await practicePage.locator('#ed-aim').focus();
    assert.deepEqual((await practiceState(practicePage)).times, [
      ['17:00', '17:30'], ['17:20', '18:00'], ['18:10', '19:30'],
    ]);
  });

  test(`練習開始: ${browserName}のpointercancelでも確定して印を解除する`, async (t) => {
    const practicePage = await openPracticePanel(t, PRACTICE_TIMES, PRACTICE_TIMES, {}, browserName);
    const save = practicePage.locator('[data-act="save"]');
    await save.evaluate((button) => {
      button.addEventListener('pointerdown', (event) => { window.__pointerId = event.pointerId; }, { once: true });
    });
    await practicePage.locator('#ed-start').focus();
    await changePracticeTime(practicePage, '#ed-start', '17:00', 'input');
    await save.hover();
    await practicePage.mouse.down();
    await save.evaluate((button) => button.dispatchEvent(new PointerEvent('pointercancel', {
      bubbles: true, pointerId: window.__pointerId,
    })));
    await practicePage.waitForFunction(() => document.querySelector('.ed-row [data-k="from"]').value === '17:00');
    await practicePage.mouse.move(0, 0);
    await practicePage.mouse.up();
    await practicePage.locator('#ed-start').focus();
    await changePracticeTime(practicePage, '#ed-start', '10:00', 'input');
    await practicePage.locator('#ed-aim').focus();
    assert.deepEqual((await practiceState(practicePage)).times, [
      ['10:00', '10:20'], ['10:20', '11:00'], ['11:10', '12:30'],
    ]);
  });
}

test('練習開始: 時間帯だけを変更してプレビューを繰り返しても元の開始時刻へずらさない', async (t) => {
  const practicePage = await openPracticePanel(t, PRACTICE_TIMES);
  await practicePage.locator('.ed-row [data-k="from"]').first().evaluate((input) => { input.value = '09:10'; });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const preview = await practicePage.evaluate(() => window.__bcsEditor.buildOverride());
    assert.deepEqual(preview.rows.map((row) => [row.from, row.to]), [
      ['09:10', '09:20'], ['09:20', '10:00'], ['10:10', '11:30'],
    ]);
  }
  assert.equal((await practiceState(practicePage)).start, '09:10');
});

test('練習開始: 並べ替え前にも確定し、拒否時は行と項目の表示順も戻す', async (t) => {
  for (const selector of ['.ed-rows', '.ed-items']) {
    for (const value of ['17:00', '23:00']) {
      const practicePage = await openPracticePanel(t, PRACTICE_TIMES);
      await practicePage.evaluate(() => {
        window.__bcsEditor.model().rows[0].both.items.push({ name: 'ドリブル', note: '' });
        window.__sortables = [];
        window.Sortable = { create(element, options) {
          const sortable = { element, options, destroy() {} };
          window.__sortables.push(sortable);
          return sortable;
        } };
        window.__bcsEditor.setOnlyGender(null);
      });
      const initial = await practiceState(practicePage);
      await practicePage.locator('#ed-start').focus();
      await changePracticeTime(practicePage, '#ed-start', value, 'input');
      await practicePage.evaluate((selector) => {
        const sortable = window.__sortables.find(({ element }) => element.matches(selector));
        sortable.element.appendChild(sortable.element.firstElementChild);
        sortable.options.onEnd({ from: sortable.element, oldIndex: 0, newIndex: sortable.element.children.length - 1 });
      }, selector);
      const state = await practiceState(practicePage);
      if (value === '23:00') {
        assert.deepEqual(state.rows, initial.rows, selector);
        assert.deepEqual(state.times, initial.times, selector);
        assert.match(state.message, /24:00/);
      } else if (selector === '.ed-rows') {
        assert.deepEqual(state.times, [['17:20', '18:00'], ['18:10', '19:30'], ['17:00', '17:20']]);
      } else {
        assert.deepEqual(state.times, [['17:00', '17:20'], ['17:20', '18:00'], ['18:10', '19:30']]);
        assert.deepEqual(state.rows[0].both.items.map((item) => item.name), ['ドリブル', 'パス']);
      }
      const names = await practicePage.locator('.ed-row').evaluateAll((rows) => rows.map((row) => (
        [...row.querySelectorAll('[data-k="name"]')].map((input) => input.value)
      )));
      assert.deepEqual(names, state.rows.map((row) => row.both.items.map((item) => item.name)), selector);
    }
  }
});

test('練習開始: 最早開始を表示し、欄外移動で一度だけ全行をずらして長さ・すき間・順序・内容を保つ', async (t) => {
  const practicePage = await openPracticePanel(t, [PRACTICE_TIMES[2], ...PRACTICE_TIMES.slice(0, 2)]);
  const initial = await practiceState(practicePage);
  assert.equal(initial.start, '09:00');
  assert.equal(await practicePage.locator('label[for="ed-start"]').textContent(), '練習開始');
  assert.equal(await practicePage.locator('#ed-start-hint').textContent(), '変えると全部の時間帯が同じだけずれます');
  await changePracticeTime(practicePage, '#ed-start', '14:30', 'input');
  assert.deepEqual((await practiceState(practicePage)).rows, initial.rows, '入力途中は移動しない');
  await changePracticeTime(practicePage, '#ed-start', '14:30', 'change');
  assert.deepEqual((await practiceState(practicePage)).rows, initial.rows, 'changeだけでは移動しない');
  await changePracticeTime(practicePage, '#ed-start', '14:30', 'focusout');
  const shifted = await practiceState(practicePage);
  const expectedTimes = [['15:40', '17:00'], ['14:30', '14:50'], ['14:50', '15:30']];
  assert.equal(shifted.start, '14:30');
  assert.deepEqual(shifted.times, expectedTimes);
  assert.deepEqual(shifted.rows, initial.rows.map((row, index) => ({
    ...row, from: expectedTimes[index][0], to: expectedTimes[index][1],
  })));
  assert.equal(shifted.message, '全部の時間帯を+5時間30分ずらしました（09:00→14:30開始）');
  await changePracticeTime(practicePage, '#ed-start', '14:30', 'focusout');
  assert.deepEqual((await practiceState(practicePage)).rows, shifted.rows, '同値の確定で二重にずらさない');
  const saved = await practicePage.evaluate(() => window.__bcsEditor.buildOverride());
  assert.deepEqual(saved.rows.map((row) => [row.from, row.to, row.minutes]), [
    ['15:40', '17:00', 80], ['14:30', '14:50', 20], ['14:50', '15:30', 40],
  ]);
  assert.equal(Object.hasOwn(saved, 'start'), false, '保存形に練習開始を追加しない');
});

test('練習開始: 空行と片側だけ空の時刻は空のまま、分だけの移動も表示する', async (t) => {
  const practicePage = await openPracticePanel(t, [['', ''], ['09:00', ''], ['', '10:00']]);
  await changePracticeTime(practicePage, '#ed-start', '09:30', 'focusout');
  const shifted = await practiceState(practicePage);
  assert.deepEqual(shifted.times, [['', ''], ['09:30', ''], ['', '10:30']]);
  assert.deepEqual(shifted.rows.map((row) => [row.from, row.to]), shifted.times);
  assert.equal(shifted.message, '全部の時間帯を+30分ずらしました（09:00→09:30開始）');
});

test('練習開始: 前倒しはマイナスの時間で知らせる', async (t) => {
  const practicePage = await openPracticePanel(t, PRACTICE_TIMES);
  await changePracticeTime(practicePage, '#ed-start', '08:00', 'focusout');
  const shifted = await practiceState(practicePage);
  assert.deepEqual(shifted.times, [['08:00', '08:20'], ['08:20', '09:00'], ['09:10', '10:30']]);
  assert.equal(shifted.message, '全部の時間帯を−1時間ずらしました（09:00→08:00開始）');
});

test('練習開始: 24:00以上になると全行を保ち、未確定の入力値と理由を残す', async (t) => {
  const practicePage = await openPracticePanel(t, [['09:00', '09:20'], ['16:00', '17:00'], ['', '']]);
  const initial = await practiceState(practicePage);
  for (const start of ['23:00', '16:00']) {
    await changePracticeTime(practicePage, '#ed-start', start, 'focusout');
    const rejected = await practiceState(practicePage);
    assert.equal(rejected.start, start);
    assert.deepEqual(rejected.rows, initial.rows);
    assert.deepEqual(rejected.times, initial.times);
    assert.match(rejected.message, /24:00/);
    assert.match(rejected.message, /15:59/);
  }
  await changePracticeTime(practicePage, '#ed-start', '15:59', 'focusout');
  assert.deepEqual((await practiceState(practicePage)).times, [['15:59', '16:19'], ['22:59', '23:59'], ['', '']]);
});

test('練習開始: 開始だけの行も24:00境界を検査する', async (t) => {
  const practicePage = await openPracticePanel(t, [['09:00', '09:20'], ['23:30', '']]);
  const initial = await practiceState(practicePage);
  await changePracticeTime(practicePage, '#ed-start', '09:30', 'focusout');
  const rejected = await practiceState(practicePage);
  assert.equal(rejected.start, '09:30');
  assert.deepEqual(rejected.rows, initial.rows);
  assert.deepEqual(rejected.times, initial.times);
  assert.match(rejected.message, /24:00/);
});

test('練習開始: 終了だけの行が00:00前になる変更を全件拒否し、00:00ちょうどは許可する', async (t) => {
  const practicePage = await openPracticePanel(t, [['09:00', '09:20'], ['', '00:30']]);
  const initial = await practiceState(practicePage);
  await changePracticeTime(practicePage, '#ed-start', '08:00', 'focusout');
  const rejected = await practiceState(practicePage);
  assert.equal(rejected.start, '08:00');
  assert.deepEqual(rejected.rows, initial.rows);
  assert.deepEqual(rejected.times, initial.times);
  assert.match(rejected.message, /00:00/);
  assert.match(rejected.message, /08:30/);
  await changePracticeTime(practicePage, '#ed-start', '08:30', 'focusout');
  assert.deepEqual((await practiceState(practicePage)).times, [['08:30', '08:50'], ['', '00:00']]);
});

test('練習開始: 行なし・全時刻空・開始なしでは空を表示し、基準のない変更では行を動かさない', async (t) => {
  for (const times of [[], [['', '']], [['', '10:00']]]) {
    const practicePage = await openPracticePanel(t, times);
    const initial = await practiceState(practicePage);
    assert.equal(initial.start, '');
    assert.equal(await practicePage.locator('#ed-start').isDisabled(), true);
    await changePracticeTime(practicePage, '#ed-start', '14:30', 'focusout');
    const unchanged = await practiceState(practicePage);
    assert.equal(unchanged.start, '');
    assert.deepEqual(unchanged.rows, initial.rows);
    assert.deepEqual(unchanged.times, initial.times);
    assert.match(unchanged.message, /時間帯.*開始時刻/);
  }
});

test('練習開始: 入力を空にして確定しても時間帯を消さず最早開始を再表示する', async (t) => {
  const practicePage = await openPracticePanel(t, PRACTICE_TIMES);
  const initial = await practiceState(practicePage);
  await changePracticeTime(practicePage, '#ed-start', '', 'focusout');
  const unchanged = await practiceState(practicePage);
  assert.equal(unchanged.start, initial.start);
  assert.deepEqual(unchanged.rows, initial.rows);
  assert.deepEqual(unchanged.times, initial.times);
});

test('練習開始: コピー取り込み後の最早時刻で表示と移動の基準を更新する', async (t) => {
  const practicePage = await openPracticePanel(t, [['16:00', '17:00']]);
  assert.equal((await practiceState(practicePage)).start, '16:00');
  practicePage.once('dialog', (dialog) => dialog.accept());
  await practicePage.locator('.cf-radio').check();
  await practicePage.click('[data-act="copy-from"]');
  assert.equal((await practiceState(practicePage)).start, '09:00');
  await changePracticeTime(practicePage, '#ed-start', '14:30', 'focusout');
  assert.deepEqual((await practiceState(practicePage)).times, [['14:30', '14:50'], ['14:50', '15:30'], ['15:40', '17:00']]);
});

test('練習開始: 自動入力と行の追加削除後に最早時刻を再表示する', async (t) => {
  const practicePage = await openPracticePanel(t, PRACTICE_TIMES);
  practicePage.once('dialog', (dialog) => dialog.accept());
  await practicePage.click('[data-act="load-seed"]');
  assert.equal((await practiceState(practicePage)).start, '07:30');
  await practicePage.click('[data-act="add-row"]');
  assert.equal((await practiceState(practicePage)).start, '07:30');
  assert.equal(await practicePage.locator('#ed-start').isDisabled(), false);
  await practicePage.click('.ed-row[data-ri="0"] [data-act="del-row"]');
  await practicePage.click('#ed-cd-exec');
  assert.equal((await practiceState(practicePage)).start, '08:00');
  await practicePage.click('.ed-row[data-ri="0"] [data-act="del-row"]');
  await practicePage.click('#ed-cd-exec');
  assert.equal((await practiceState(practicePage)).start, '');
  assert.equal(await practicePage.locator('#ed-start').isDisabled(), true);
  await practicePage.click('[data-act="add-row"]');
  assert.equal(await practicePage.locator('#ed-start').isDisabled(), true);
});

test('練習開始: 行の開始入力の既存補完を保ち、編集やクリア後の最早開始を反映する', async (t) => {
  const practicePage = await openPracticePanel(t, [['09:00', '09:20'], ['10:00', '11:00']]);
  await changePracticeTime(practicePage, '.ed-row[data-ri="0"] [data-k="from"]', '10:30', 'change');
  let state = await practiceState(practicePage);
  assert.equal(state.start, '10:00');
  assert.deepEqual(state.times, [['10:30', '10:30'], ['10:00', '11:00']]);
  await changePracticeTime(practicePage, '.ed-row[data-ri="1"] [data-k="from"]', '09:30', 'change');
  state = await practiceState(practicePage);
  assert.equal(state.start, '09:30');
  assert.deepEqual(state.times[1], ['09:30', '11:00']);
  await changePracticeTime(practicePage, '.ed-row[data-ri="1"] [data-k="from"]', '', 'change');
  assert.equal((await practiceState(practicePage)).start, '10:30');
  await changePracticeTime(practicePage, '.ed-row[data-ri="0"] [data-k="from"]', '', 'change');
  assert.equal((await practiceState(practicePage)).start, '');
});

test('練習開始: 実キーの分↑は確定まで全行を保ち、Enter・blurで直前の確定値から一度だけずらす', async (t) => {
  const practicePage = await openPracticePanel(t, PRACTICE_TIMES);
  const initial = await practiceState(practicePage);
  const originalNodes = await practicePage.evaluateHandle(() => [...document.querySelectorAll('.ed-panel *')]);
  await practicePage.locator('#ed-start').focus();
  await practicePage.keyboard.press('ArrowRight');
  const client = await practicePage.context().newCDPSession(practicePage);
  const expected = [
    [['09:01', '09:21'], ['09:21', '10:01'], ['10:11', '11:31']],
    [['09:02', '09:22'], ['09:22', '10:02'], ['10:12', '11:32']],
  ];
  for (const times of expected) {
    await practicePage.keyboard.press('ArrowUp');
    const state = await practiceState(practicePage);
    const { nodes } = await client.send('Accessibility.getFullAXTree');
    const segment = nodes.find((node) => node.role.value === 'spinbutton'
      && node.properties.some((property) => property.name === 'focused' && property.value.value === true));
    const sameNodes = await originalNodes.evaluate((elements) => elements.every((element) => element.isConnected));
    keyboardEvidence.push({ operation: 'ArrowUp', state, sameNodes, focusedSegment: segment.name.value });
    assert.equal(state.start, times[0][0]);
    assert.deepEqual(state.times, initial.times);
    assert.deepEqual(state.rows, initial.rows);
    assert.equal(state.message, '');
    assert.equal(sameNodes, true, '入力欄と時間帯のDOMを作り直さない');
    assert.equal(await practicePage.locator('#ed-start').evaluate((input) => input === document.activeElement), true);
    assert.match(segment.name.value, /^Minutes\b/);
  }
  await practicePage.keyboard.press('Enter');
  const committed = await practiceState(practicePage);
  assert.deepEqual(committed.times, expected[1]);
  assert.deepEqual(committed.rows.map((row) => [row.from, row.to]), expected[1]);
  assert.equal(committed.message, '全部の時間帯を+2分ずらしました（09:00→09:02開始）');
  await practicePage.locator('#ed-aim').focus();
  assert.deepEqual(await practiceState(practicePage), committed, 'Enter後のblurで二重適用しない');
  await practicePage.locator('#ed-start').focus();
  await practicePage.keyboard.press('ArrowRight');
  await practicePage.keyboard.press('ArrowDown');
  assert.deepEqual((await practiceState(practicePage)).rows, committed.rows);
  await practicePage.locator('#ed-aim').focus();
  const reversed = await practiceState(practicePage);
  assert.equal(reversed.start, '09:01', '次の矢印も分を操作する');
  assert.deepEqual(reversed.times, expected[0]);
  assert.equal(reversed.message, '全部の時間帯を−1分ずらしました（09:02→09:01開始）');
  const saved = await practicePage.evaluate(() => window.__bcsEditor.buildOverride());
  assert.deepEqual(saved.rows.map((row) => [row.from, row.to]), expected[0]);
});

test('練習開始: 分↑の09:59→09:00は確定まで行を保ち、Escapeで直前の有効値に戻す', async (t) => {
  for (const commitKey of ['Enter', 'blur']) {
    const practicePage = await openPracticePanel(t, [['09:59', '10:19']]);
    const initial = await practiceState(practicePage);
    const start = practicePage.locator('#ed-start');
    await start.focus();
    await practicePage.keyboard.press('ArrowRight');
    await practicePage.keyboard.press('ArrowUp');
    const pending = await practiceState(practicePage);
    keyboardEvidence.push({ operation: `minute-wrap/${commitKey}`, state: pending });
    assert.equal(pending.start, '09:00');
    assert.deepEqual(pending.rows, initial.rows);
    assert.deepEqual(pending.times, initial.times);
    await practicePage.keyboard.press('Escape');
    assert.deepEqual(await practiceState(practicePage), initial);
    await practicePage.locator('#ed-aim').focus();
    assert.deepEqual(await practiceState(practicePage), initial, 'Escape後のblurでも移動しない');

    await start.focus();
    await practicePage.keyboard.press('ArrowRight');
    await practicePage.keyboard.press('ArrowUp');
    assert.equal(await start.inputValue(), '09:00');
    if (commitKey === 'Enter') {
      await practicePage.keyboard.press(commitKey);
    } else {
      await practicePage.locator('#ed-aim').focus();
    }
    const committed = await practiceState(practicePage);
    assert.deepEqual(committed.times, [['09:00', '09:20']]);
    assert.equal(committed.message, '全部の時間帯を−59分ずらしました（09:59→09:00開始）');
    await practicePage.locator('#ed-aim').focus();
    assert.deepEqual(await practiceState(practicePage), committed);

    await start.focus();
    await practicePage.keyboard.press('ArrowRight');
    await practicePage.keyboard.press('ArrowUp');
    await practicePage.keyboard.press('Escape');
    assert.deepEqual(await practiceState(practicePage), committed, '最初の値ではなく直前に適用した値へ戻す');
    await practicePage.locator('#ed-aim').focus();
    assert.deepEqual(await practiceState(practicePage), committed);
  }
});

test('終了時刻: changeは対象行のtoだけをモデルに取り込み、練習開始を同期する', async (t) => {
  const practicePage = await openPracticePanel(t, PRACTICE_TIMES);
  const initial = await practiceState(practicePage);
  await practicePage.evaluate(() => {
    document.querySelector('#ed-aim').value = '入力途中';
    document.querySelector('.ed-row[data-ri="1"] [data-k="from"]').value = '08:00';
    document.querySelector('.ed-row[data-ri="2"] [data-k="to"]').value = '12:00';
    document.querySelector('.ed-row [data-k="name"]').value = '編集中';
  });
  await changePracticeTime(practicePage, '.ed-row[data-ri="0"] [data-k="to"]', '09:25', 'change');
  const changed = await practiceState(practicePage);
  const expectedRows = structuredClone(initial.rows);
  expectedRows[0].to = '09:25';
  assert.deepEqual(changed.rows, expectedRows);
  assert.equal(changed.start, initial.start);
  assert.equal(await practicePage.evaluate(() => window.__bcsEditor.model().aim), '');
  assert.deepEqual(changed.times, [['09:00', '09:25'], ['08:00', '10:00'], ['10:10', '12:00']]);
});

test('練習開始: 実キー1430は入力途中の行を保ち、Enter・別の入力欄への移動で14:30に確定する', async (t) => {
  for (const commitKey of ['Enter', 'blur']) {
    const practicePage = await openPracticePanel(t, PRACTICE_TIMES);
    const initial = await practiceState(practicePage);
    const originalInput = await practicePage.locator('#ed-start').elementHandle();
    await originalInput.focus();
    for (const key of '1430') {
      await practicePage.keyboard.press(key);
      const pending = await practiceState(practicePage);
      keyboardEvidence.push({ operation: `1430/${commitKey}/${key}`, state: pending });
      assert.deepEqual(pending.rows, initial.rows, '数字の入力途中はmodelをずらさない');
      assert.deepEqual(pending.times, initial.times, '数字の入力途中は表をずらさない');
    }
    assert.equal(await practicePage.locator('#ed-start').inputValue(), '14:30');
    if (commitKey === 'Enter') {
      await practicePage.keyboard.press(commitKey);
    } else {
      await practicePage.locator('#ed-aim').focus();
    }
    const shifted = await practiceState(practicePage);
    keyboardEvidence.push({ operation: `1430/${commitKey}/committed`, state: shifted });
    const expectedTimes = [['14:30', '14:50'], ['14:50', '15:30'], ['15:40', '17:00']];
    assert.equal(shifted.start, '14:30');
    assert.deepEqual(shifted.times, expectedTimes);
    assert.deepEqual(shifted.rows, initial.rows.map((row, index) => ({
      ...row, from: expectedTimes[index][0], to: expectedTimes[index][1],
    })));
    assert.equal(await originalInput.evaluate((input) => input === document.querySelector('#ed-start')), true);
    const saved = await practicePage.evaluate(() => window.__bcsEditor.buildOverride());
    assert.deepEqual(saved.rows.map((row) => [row.from, row.to, row.minutes]), [
      ['14:30', '14:50', 20], ['14:50', '15:30', 40], ['15:40', '17:00', 80],
    ]);
  }
});

test('練習開始: 実キーの境界超過は未確定値を残して全行・modelを保ち、逆方向へ続けて操作できる', async (t) => {
  const cases = [
    { times: [['09:00', '09:20'], ['23:58', '23:58']], key: 'ArrowUp', reverse: 'ArrowDown', valid: '09:01', reason: /24:00/ },
    { times: [['09:02', '09:22'], ['', '00:01']], key: 'ArrowDown', reverse: 'ArrowUp', valid: '09:01', reason: /00:00/ },
  ];
  for (const boundary of cases) {
    const practicePage = await openPracticePanel(t, boundary.times);
    const originalInput = await practicePage.locator('#ed-start').elementHandle();
    await originalInput.focus();
    await practicePage.keyboard.press('ArrowRight');
    await practicePage.keyboard.press(boundary.key);
    await practicePage.keyboard.press('Enter');
    const valid = await practiceState(practicePage);
    assert.equal(valid.start, boundary.valid);
    const saved = await practicePage.evaluate(() => window.__bcsEditor.buildOverride());
    await practicePage.keyboard.press(boundary.key);
    assert.deepEqual((await practiceState(practicePage)).rows, valid.rows);
    await practicePage.keyboard.press('Enter');
    const rejected = await practiceState(practicePage);
    keyboardEvidence.push({ operation: `boundary/${boundary.key}`, valid, rejected });
    assert.notEqual(rejected.start, valid.start);
    assert.deepEqual(rejected.rows, valid.rows);
    assert.deepEqual(rejected.times, valid.times);
    assert.match(rejected.message, boundary.reason);
    assert.equal(await practicePage.evaluate(() => window.__bcsEditor.buildOverride()), null);
    assert.equal(await originalInput.evaluate((input) => input === document.activeElement), true);
    await practicePage.keyboard.press(boundary.reverse);
    await practicePage.keyboard.press('Enter');
    const reversed = await practiceState(practicePage);
    assert.equal(reversed.start, valid.start);
    assert.deepEqual(reversed.times, valid.times);
    assert.deepEqual(await practicePage.evaluate(() => window.__bcsEditor.buildOverride()), saved);
  }
});

test('練習開始: 実キーの数字入力を拒否した後、Escapeで戻して直前の有効値から分を変更できる', async (t) => {
  const practicePage = await openPracticePanel(t, [['09:00', '09:20'], ['23:00', '23:30']]);
  const initial = await practiceState(practicePage);
  await practicePage.locator('#ed-start').focus();
  await practicePage.keyboard.type('1430');
  await practicePage.keyboard.press('Enter');
  const rejected = await practiceState(practicePage);
  keyboardEvidence.push({ operation: '1430/rejected', state: rejected });
  assert.equal(rejected.start, '14:30');
  assert.deepEqual(rejected.rows, initial.rows);
  assert.deepEqual(rejected.times, initial.times);
  assert.match(rejected.message, /24:00/);
  await practicePage.keyboard.press('Escape');
  assert.deepEqual(await practiceState(practicePage), initial);
  await practicePage.keyboard.press('ArrowUp');
  assert.deepEqual((await practiceState(practicePage)).rows, initial.rows);
  await practicePage.keyboard.press('Enter');
  const shifted = await practiceState(practicePage);
  assert.equal(shifted.start, '09:01');
  assert.deepEqual(shifted.times, [['09:01', '09:21'], ['23:01', '23:31']]);
});

test('練習開始: 開始なしの日は無効で、開始の入力とクリアに追従する', async (t) => {
  for (const times of [[], [['', '']], [['', '10:00']]]) {
    const practicePage = await openPracticePanel(t, times);
    const start = practicePage.locator('#ed-start');
    assert.equal(await start.isDisabled(), true);
    assert.equal(await practicePage.locator('#ed-start-hint').textContent(), '時間帯の開始時刻を入れると使えます');
    await start.focus();
    assert.equal(await start.evaluate((input) => input === document.activeElement), false);
    await practicePage.keyboard.press('Tab');
    assert.equal((await practiceState(practicePage)).message, '');
    assert.equal(await practicePage.locator('#ed-msg').textContent(), '');

    const from = practicePage.locator('.ed-row [data-k="from"]').first();
    const to = practicePage.locator('.ed-row [data-k="to"]').first();
    await to.fill('10:00');
    assert.equal(await start.isDisabled(), true, '終了だけでは入力できない');
    await start.focus();
    await from.focus();
    assert.equal((await practiceState(practicePage)).message, '', '値を変えずに離れても警告しない');
    await to.fill('');
    assert.equal(await start.isDisabled(), true);

    await from.focus();
    await practicePage.keyboard.type('0900');
    await practicePage.keyboard.press('Tab');
    await practicePage.keyboard.press('Tab');
    assert.equal(await start.isDisabled(), false);
    assert.equal(await start.inputValue(), '09:00');
    assert.equal(await practicePage.locator('#ed-start-hint').textContent(), '変えると全部の時間帯が同じだけずれます');
    await from.fill('');
    assert.equal(await start.isDisabled(), true, '終了時刻が残っていても開始がなければ無効');
    await to.fill('');
    assert.equal(await start.isDisabled(), true);
    assert.equal(await practicePage.locator('#ed-start-hint').textContent(), '時間帯の開始時刻を入れると使えます');
  }
});

test('練習開始: コピー取り込みで時刻ゼロと入力済みの有効状態を切り替える', async (t) => {
  for (const [times, copyTimes, disabled] of [
    [[['', '']], PRACTICE_TIMES, false],
    [PRACTICE_TIMES, [['', '']], true],
  ]) {
    const practicePage = await openPracticePanel(t, times, copyTimes);
    assert.equal(await practicePage.locator('#ed-start').isDisabled(), !disabled);
    practicePage.once('dialog', (dialog) => dialog.accept());
    await practicePage.locator('.cf-radio').check();
    await practicePage.click('[data-act="copy-from"]');
    assert.equal(await practicePage.locator('#ed-start').isDisabled(), disabled);
    assert.deepEqual((await practiceState(practicePage)).times, copyTimes);
  }
});

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  test(`練習開始: ${viewport.width}x${viewport.height}の実画面で23:50の拒否を持続し成功を入力直下に5秒表示する`, async (t) => {
    const practicePage = await browser.newPage({ locale: 'ja-JP', viewport, reducedMotion: 'reduce' });
    t.after(() => practicePage.close());
    await practicePage.goto(pathToFileURL(HTML).href);
    await practicePage.evaluate(() => {
      const target = document.querySelector('.day[data-date="2026-06-23"]');
      document.querySelectorAll('.day').forEach((day) => { day.hidden = day !== target; });
      document.querySelectorAll('.daywk').forEach((week) => { week.hidden = week !== target.closest('.daywk'); });
    });
    await practicePage.click('#ed-edit');
    const start = practicePage.locator('#ed-start');
    await start.scrollIntoViewIfNeeded();
    await start.focus();
    await practicePage.clock.install({ time: new Date(LOCAL_FIXTURE_TODAY) });
    await practicePage.clock.pauseAt(new Date(`${LOCAL_FIXTURE_TODAY}T01:00:00Z`));
    const initial = await practiceState(practicePage);
    await practicePage.keyboard.type('2350');
    await practicePage.keyboard.press('Enter');
    const rejected = await practiceState(practicePage);
    assert.equal(rejected.start, '23:50');
    assert.deepEqual(rejected.rows, initial.rows);
    assert.match(rejected.message, /24:00以降/);

    const message = practicePage.locator('#ed-start-msg');
    assert.equal(await message.getAttribute('role'), 'status');
    assert.equal(await message.getAttribute('aria-live'), 'polite');
    assert.match(await start.getAttribute('aria-describedby'), /\bed-start-msg\b/);
    for (const operation of ['rejected', 'success']) {
      if (operation === 'success') {
        await practicePage.clock.runFor(6000);
        assert.equal(await message.textContent(), rejected.message, '5秒を過ぎても拒否理由が残る');
        await practicePage.keyboard.press('ArrowLeft');
        await practicePage.keyboard.type('1430');
        await practicePage.keyboard.press('Enter');
        assert.equal(await start.inputValue(), '14:30');
        assert.match(await message.textContent(), /全部の時間帯を.*→14:30開始/);
      }
      const measurement = await start.evaluate((input) => {
        const message = document.querySelector('#ed-start-msg');
        const style = getComputedStyle(message);
        return {
          input: input.getBoundingClientRect().toJSON(),
          message: message.getBoundingClientRect().toJSON(),
          text: message.textContent,
          adjacent: input.nextElementSibling === message,
          fontSize: style.fontSize, lineHeight: style.lineHeight, color: style.color,
          scrollWidth: document.documentElement.scrollWidth,
        };
      });
      keyboardEvidence.push({ viewport, operation, measurement });
      t.diagnostic(JSON.stringify({ viewport, operation, measurement }));
      assert.equal(measurement.adjacent, true);
      assert.ok(measurement.message.top >= measurement.input.bottom);
      assert.ok(measurement.message.top - measurement.input.bottom <= 8);
      for (const rect of [measurement.input, measurement.message]) {
        assert.ok(rect.left >= 0 && rect.right <= viewport.width);
        assert.ok(rect.top >= 0 && rect.bottom <= viewport.height);
        assert.ok(rect.height > 0);
      }
      assert.equal(measurement.scrollWidth, viewport.width);
      assert.equal(await practicePage.locator('#ed-msg').textContent(), '');
    }
    const success = await message.textContent();
    await practicePage.clock.runFor(2501);
    assert.equal(await message.textContent(), success, '先の通知のタイマーで成功通知を消さない');
    await practicePage.clock.runFor(2498);
    assert.equal(await message.textContent(), success, '成功から4999msは表示を保つ');
    await practicePage.clock.runFor(1);
    assert.equal(await message.textContent(), '', '成功から5000msで消す');
  });
}
