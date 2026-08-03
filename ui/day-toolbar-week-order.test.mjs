/**
 * @file 日ビュー上部の並び順（週の切り替え→曜日/日付ピッカー）の業務意図テスト。
 *
 * 背景（オーナー指摘・2026-08-03）: 2026-07-29の上部ツールバー整理（toolbar-reorg）で、曜日/日付
 * ピッカーが独立した `.daytoolbar-picker` に括り出された副作用で、週の切り替え（.cal-go-dayweek）
 * が曜日/日付ピッカーより下に沈んだ。コーチは「週を選ぶ→日を選ぶ→その日の練習を見る」の順で
 * 画面を操作するため、操作の順序と画面の出力順を一致させる。
 *
 * 検証する業務意図（実装の途中値は写経しない。固定するのは「コーチから見た出力順」のみ）:
 *   - 週の切り替えが、曜日/日付ピッカーより先（DOM出力順で手前）に現れる。
 *     見た目の指定（order等）でのすり替えは対象外（出力そのものの順序を見る）。
 *
 * テスト基盤: node --test（静的アサーション・render() 出力の文字列検査）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildPlanData } from './plan-data.mjs';
import { localStorages, LOCAL_FIXTURE_TODAY } from './build.mjs';
import { render } from './pattern-timeline.mjs';

/** body から data-level="day" 区画（次の data-level まで）を切り出す。 */
function dayRegionOf(body) {
  const start = body.indexOf('data-level="day"');
  const end = body.indexOf('data-level="week"');
  assert.ok(start >= 0 && end > start, 'day レベル区画が存在するべき');
  return body.slice(start, end);
}

test('日ビュー: 週の切り替えが曜日/日付ピッカーより先に出力される（出力順で検証）', async () => {
  const data = await buildPlanData({ ...localStorages(), today: LOCAL_FIXTURE_TODAY });
  assert.ok(data.weeks.length >= 2, '前提: 複数週があり週の切り替えが実際に描かれる');

  const { body } = render(data);
  const region = dayRegionOf(body);

  // 週の切り替え＝ .cal-go-dayweek ボタン（週セレクタ固有のマーカー）。
  const weekSwitchIdx = region.indexOf('cal-go-dayweek');
  assert.ok(weekSwitchIdx >= 0, '週の切り替え(.cal-go-dayweek)が日ビューに出力されている');

  // 曜日/日付ピッカー＝ .daytoolbar-picker（7曜日ピッカーを括る容れ物・コーチが日を選ぶ場所）。
  const dayPickerIdx = region.indexOf('daytoolbar-picker');
  assert.ok(dayPickerIdx >= 0, '曜日/日付ピッカー(.daytoolbar-picker)が日ビューに出力されている');

  assert.ok(weekSwitchIdx < dayPickerIdx,
    '週の切り替えは曜日/日付ピッカーより先に出力されるべき（コーチは週を選んでから日を選ぶ）');
});

test('日ビュー: 表示単位タブ(日/週/月/年)は週の切り替え・曜日/日付ピッカーの両方より先に出力される', async () => {
  const data = await buildPlanData({ ...localStorages(), today: LOCAL_FIXTURE_TODAY });
  assert.ok(data.weeks.length >= 2, '前提: 複数週があり週の切り替えが実際に描かれる');

  const { body } = render(data);
  dayRegionOf(body); // 前提: day レベル区画自体が存在する
  const levelsIdx = body.indexOf('class="levels"');
  const weekSwitchIdx = body.indexOf('cal-go-dayweek');
  const dayPickerIdx = body.indexOf('daytoolbar-picker');

  assert.ok(levelsIdx >= 0 && levelsIdx < weekSwitchIdx && levelsIdx < dayPickerIdx,
    '表示単位タブは動かさず、いちばん上のまま');
});
