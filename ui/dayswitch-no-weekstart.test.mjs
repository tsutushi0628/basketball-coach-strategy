/**
 * @file 週起点未設定テナント（新規テナント既定＝config に week_start_date 無し＝全日 date:null）で、
 * 日ピッカーの曜日ボタンが「曜日(data-go)」で日切替できることを業務意図として固定する退行テスト。
 *
 * 退行の背景（多週化で開いた穴）:
 *   多週化で「日」切替を実日付(data-date)起点の showDayByDate(iso) に変えたが、showDayByDate は
 *   先頭で空ISOを弾く（if(!iso)return）。週起点未設定テナントは全日 date:null → 日ピッカーの
 *   曜日ボタンが data-date="" になり、押しても無反応になる。新規テナント既定（tenant-template.mjs）は
 *   week_start_date を持たないため、外部配布の主対象＝新規コーチ全員の「日タブの日切替」が壊れる。
 *
 * 検証する業務意図（実装の途中値は写経しない）:
 *   - 週起点未設定なら全日 date:null（前提の固定）。
 *   - その時の日ピッカー cal-go ボタンは data-date="" だが data-go=曜日 を持つ（曜日で指せる）。
 *   - clientScript は data-date が空のとき data-go フォールバックで切り替える配線を持つ（showDayByDay）。
 *   - 曜日フォールバック経路でも「全 .day を一旦 hidden→対象1つだけ表示」で可視を一意化する
 *     （curDay＝hidden でない最初の .day が常に1件＝別週/別日を誤編集しない不変条件）。
 *
 * テスト基盤: node --test。データは localStorages の storage を getConfig だけラップして
 * week_start_date を外す（新規テナント既定と同じ状態を実データで再現）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildPlanData } from './plan-data.mjs';
import { localStorages } from './build.mjs';
import { render } from './pattern-timeline.mjs';
import { clientScript } from './render-shared.mjs';

/** localStorages を、storage.getConfig から week_start_date を外したものに差し替える（新規テナント状態）。 */
function noWeekStartStorages() {
  const { storage, girlsStorage } = localStorages();
  const wrapped = {
    ...storage,
    async getConfig() {
      const c = await storage.getConfig();
      const { week_start_date, ...rest } = c; // 週起点を外す＝新規テナント既定（plan-data の date:null 経路）
      return rest;
    },
  };
  return { storage: wrapped, girlsStorage };
}

/** body から data-level="day" 区画を切り出す。 */
function dayRegionOf(body) {
  const start = body.indexOf('data-level="day"');
  const end = body.indexOf('data-level="week"');
  assert.ok(start >= 0 && end > start, 'day レベル区画が存在するべき');
  return body.slice(start, end);
}

test('前提: 週起点未設定なら全日 date:null（cal-go の data-date が空になる経路）', async () => {
  const data = await buildPlanData(noWeekStartStorages());
  const allDates = data.weeks.flatMap((w) => w.days.map((d) => d.date));
  assert.ok(allDates.length > 0, '日が生成されている');
  assert.ok(allDates.every((d) => d == null), '週起点未設定では全日 date が null（実日付が立たない）');
});

test('週起点未設定: 日ピッカーの曜日ボタンは data-date 空だが data-go=曜日 を持つ（曜日で指せる）', async () => {
  const data = await buildPlanData(noWeekStartStorages());
  const region = dayRegionOf(render(data).body);

  // cal-go ボタン（押せる練習日）を列挙。
  const btns = [...region.matchAll(/<button class="pk cal-go[^"]*"[^>]*>/g)].map((x) => x[0]);
  assert.ok(btns.length > 0, '押せる cal-go 曜日ボタンが存在する');
  for (const b of btns) {
    const date = (b.match(/data-date="([^"]*)"/) || [])[1];
    const go = (b.match(/data-go="([^"]*)"/) || [])[1];
    assert.equal(date, '', '週起点未設定では data-date は空（実ISO無し）');
    assert.ok(go && go.length > 0, '曜日(data-go)は必ず付く＝曜日フォールバックで切替できる');
  }
});

test('clientScript: data-date 空のとき曜日(data-go)フォールバックで日切替する配線がある', () => {
  const js = clientScript();
  // 曜日フォールバック本体が存在する。
  assert.match(js, /function showDayByDay\(/, '曜日フォールバック関数 showDayByDay が存在');
  // cal-go ハンドラが「ISOあれば showDayByDate、空なら showDayByDay(data-go)」の二段分岐。
  assert.match(
    js,
    /var iso=b\.getAttribute\('data-date'\);\s*if\(iso\)\{showDayByDate\(iso\);\}else\{showDayByDay\(b\.getAttribute\('data-go'\)\);\}/,
    'cal-go は data-date 優先・空なら data-go フォールバックの二段化',
  );
  // フォールバックでも全 .day を一旦 hidden 化し対象1つだけ表示する（可視一意化＝curDay 不変条件）。
  assert.match(
    js,
    /function showDayByDay\(dayName\)\{[\s\S]*?querySelectorAll\('\.day\[data-date\]'\)\.forEach\(function\(p\)\{p\.hidden=p!==target;\}\)/,
    '曜日フォールバックは全 .day を hidden 化→対象1つだけ表示（可視は常に1日）',
  );
});
