/**
 * @file 選んでいる週の状態を日レベル・週レベルで単一の持ち場（render-shared.mjs の selectWeek/
 * goToWeek）に集約したことの業務意図テスト。
 *
 * 背景（QA差し戻し・2026-08-02）: 日レベルの週セレクタ(.cal-go-dayweek)と週レベルの週タブ
 * (.cal-go-week)がそれぞれ自分の表示だけを独立に切り替えていたため、日で前の週を選んで週タブへ
 * 移動しても週側は追従せず、週で別の週を選んで日タブへ戻っても日側は追従しなかった（コーチが
 * 「いま何週目を見ているか」を見失う）。今セッションの変更前のHEADでも実際に再現することを
 * 確認済み（前から存在した不具合。今回の週始まり日曜化とは別原因で、あわせて直した）。
 *
 * 検証する業務意図（実装の途中計算は写経しない）:
 *   - 日レベルで別の週を選び、週レベルへ切り替えても同じ週が選ばれている。
 *   - 週レベルで別の週を選び、日レベルへ戻っても同じ週が選ばれている。
 *
 * テスト基盤: node --test ＋ Playwright(chromium)。build.mjs 出力相当の使い捨てビルド（他テストと
 * 共有しない専用ファイル・並列実行での競合を避ける）。
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
const HTML = resolve(__dirname, 'pattern-timeline.week-day-selection-sync.tmp.html');

let browser;
let page;
let weekKeys; // 週タブ一覧のキー（表示順・data-go/data-dayweek/data-week で共有する値空間）。

before(async () => {
  const data = await buildPlanData({ ...localStorages(), today: LOCAL_FIXTURE_TODAY });
  assert.ok(data.weeks.length >= 3, '前提: 3週以上が並ぶ');
  weekKeys = data.weeks.map((w) => w.key);
  assert.equal(new Set(weekKeys).size, weekKeys.length, '前提: 週キーは重複しない');
  const { css, body } = render(data);
  writeFileSync(HTML, renderPage({ title: 'week-day-selection-sync fixture', css, body }), 'utf8');
  browser = await chromium.launch();
  page = await browser.newPage();
});

after(async () => {
  if (browser) await browser.close();
  if (existsSync(HTML)) unlinkSync(HTML);
});

test('日レベルで前の週を選び、週レベルへ切り替えても同じ週が選ばれている', async () => {
  await page.goto(pathToFileURL(HTML).href);
  // サーバ既定（週タブ先頭に "on" が付く静的初期状態）と同じ週だと、日側を操作しなくても
  // 最初から一致してしまい判別力が無い。先頭(weekKeys[0])ではなく3番目(weekKeys[2])を明示的に
  // 選ぶことで、実際にクリックが週レベルへ伝播したかを検査する（2026-08-02 レビュー是正）。
  await page.click(`.cal-go-dayweek[data-dayweek="${weekKeys[2]}"]`);
  await page.click('button.lvtab[data-go="week"]'); // 週レベルへ切替
  const onWeekTab = await page.$eval('.cal-go-week.on', (el) => el.getAttribute('data-go')).catch(() => null);
  const visiblePanelKey = await page.evaluate(() => {
    const p = [...document.querySelectorAll('.wkpanel')].find((x) => !x.hidden);
    return p ? p.getAttribute('data-week') : null;
  });
  assert.equal(onWeekTab, weekKeys[2], '週レベルの選択中タブが、日レベルで選んだ週と一致するべき');
  assert.equal(visiblePanelKey, weekKeys[2], '週レベルの可視パネルも、日レベルで選んだ週と一致するべき');
});

test('週レベルで次の週を選び、日レベルへ戻っても同じ週が選ばれている', async () => {
  await page.goto(pathToFileURL(HTML).href);
  await page.click('button.lvtab[data-go="week"]'); // 週レベルへ切替
  await page.click(`.cal-go-week[data-go="${weekKeys[2]}"]`); // 3番目の週を明示的に選ぶ
  await page.click('button.lvtab[data-go="day"]'); // 日レベルへ戻る
  const onDayWeek = await page.$eval('.cal-go-dayweek.on', (el) => el.getAttribute('data-dayweek')).catch(() => null);
  const visibleDaywkKey = await page.evaluate(() => {
    const p = [...document.querySelectorAll('.daywk')].find((x) => !x.hidden);
    return p ? p.getAttribute('data-week') : null;
  });
  assert.equal(onDayWeek, weekKeys[2], '日レベルの選択中週セレクタが、週レベルで選んだ週と一致するべき');
  assert.equal(visibleDaywkKey, weekKeys[2], '日レベルの可視グループも、週レベルで選んだ週と一致するべき');
});
