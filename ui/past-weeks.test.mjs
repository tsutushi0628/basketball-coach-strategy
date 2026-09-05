/**
 * @file 過去の週への移動（週ごとの月目標キー・pastWeeksの範囲）の業務意図テスト（純関数）。
 *
 * 正本: docs/specs/past-weeks-and-copy-source/service-design.md（2.〜3.章・6章）、
 *       docs/findings/spec-20260905-past-weeks-and-copy-source-impl.md（2〜6章・11章）。
 *       ただし到達下限・「年月で飛ぶ」は本番差し戻しにより廃止（司令塔裁定 2026-09-05）。
 *
 * 検証する業務意図（実装の途中値は写経しない）:
 *   - computePastWeekDefs: 下限＝「最古の上書き日を含む週」と「今日と同じ学校年度の4月1日を含む週」の
 *     早い方から、今週の前週まで並ぶ（到達下限＝固定週数の概念は廃止。「前の週」は常に押せる）。
 *     第3引数 schoolYearAnchorMonday を渡すと、その週が属する学校年度の4月1日週を基準にする
 *     （?week クエリで前年度へ遡ったときに下限をさらに広げるため）。
 *   - schoolYearOf: 学校年度は4月1日始まり（3月末と4月頭で年度が切り替わる）。
 *   - arcMonthOfWeek: 週ごとの月目標キーは「その週の月曜の暦月」を月タブと同じオフセットで
 *     アーク月へ写す（司令塔裁定: 未来週にも一律に当てる。先頭週は goalKeys.monthArcKey と一致）。
 *     年度外（今日と学校年度が異なる）週は null。
 *   - buildPlanData: pastWeeks・weeks[].monthArcKey・weeks[].monthGoal が既存の weeks/goalKeys を
 *     不変に保ったまま追加される。過去週の日は叩き台を作らず（seedDays 空）、上書きの無い日は
 *     source:'empty' かつ noRecord:true。pastWeeks の coach 日は allCoachDays の同日と同一参照
 *     （テナント全件コピー元候補と過去週表示が同じ土台を指す＝二重に別実体を作らない）。
 *
 * テスト基盤: node --test。データは build.mjs の localStorages（ローカルJSON固定＝実データ）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  computePastWeekDefs,
  schoolYearOf,
  arcMonthOfWeek,
  buildPlanData,
} from './plan-data.mjs';
import { localStorages, LOCAL_FIXTURE_TODAY } from './build.mjs';

/** ISO日付に n 日加算（UTC固定）。テストの期待値を手計算せず組み立てるための局所ヘルパー。 */
function addDaysISO(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/* ───────────────────────── computePastWeekDefs ───────────────────────── */

test('computePastWeekDefs: 上書き無し(null)なら今日と同じ学校年度の4月1日を含む週から今週の前週まで生成する', () => {
  const todayMonday = '2026-06-22'; // 学校年度2026（4/1週=2026-03-30）
  const weeks = computePastWeekDefs(todayMonday, null);
  assert.equal(weeks[0].weekStartDate, '2026-03-30', '先頭は学校年度の4月1日を含む週の月曜');
  assert.equal(weeks[weeks.length - 1].weekStartDate, addDaysISO(todayMonday, -7), '末尾は今週の月曜の7日前');
  assert.equal(weeks.length, 12, '2026-03-30〜2026-06-15の12週（固定週数の下限は廃止）');
});

test('computePastWeekDefs: 最古の上書きが学校年度の4月1日週より古ければその週まで戻る', () => {
  const todayMonday = '2026-06-22';
  // 2026-01-15（木）は学校年度2026の前半（2026-01-12週）に属し、4/1週（2026-03-30）より古い。
  const weeks = computePastWeekDefs(todayMonday, '2026-01-15');
  assert.equal(weeks[0].weekStartDate, '2026-01-12', '先頭が最古の上書き週の月曜（4/1週より優先）');
  assert.equal(weeks[weeks.length - 1].weekStartDate, addDaysISO(todayMonday, -7));
});

test('computePastWeekDefs: 最古の上書きが学校年度の4月1日週より新しければ4月1日週が下限のまま勝つ', () => {
  const todayMonday = '2026-06-22';
  // 2026-06-23（火）は今週（月曜2026-06-22）に属し、4/1週（2026-03-30）より新しい。
  const weeks = computePastWeekDefs(todayMonday, '2026-06-23');
  assert.equal(weeks[0].weekStartDate, '2026-03-30', '4/1週が下限のまま勝つ（早い方＝4/1週）');
  assert.equal(weeks.length, 12);
});

test('computePastWeekDefs: schoolYearAnchorMonday を渡すと、その週が属する学校年度の4月1日週まで下限が広がる', () => {
  const todayMonday = '2026-06-22'; // weeks（今週+3週）は不変の前提
  // 2026-03-23（学校年度2025に属する週）を ?week 遷移先として渡すと、前年度の4/1週まで拡張される。
  const weeks = computePastWeekDefs(todayMonday, null, '2026-03-23');
  assert.equal(weeks[0].weekStartDate, '2025-03-31', '前年度2025の4月1日を含む週まで下限が広がる');
  assert.equal(weeks.length, 64, '2025-03-31〜2026-06-15の64週');
});

test('computePastWeekDefs: key・label が computeWeekPeriods と同じ規則（日曜始まりの表示日）', () => {
  const weeks = computePastWeekDefs('2026-06-22', null);
  for (const w of weeks) {
    assert.match(w.key, /^\d{4}\/\d{2}\/\d{2}$/, 'key は yyyy/mm/dd（週の表示開始日＝日曜）');
    assert.equal(w.label, `${w.key}〜`, 'label は key に〜を付けたもの');
  }
  // 先頭週（最古）の表示開始日＝月曜の前日（日曜）。
  assert.equal(weeks[0].key, dateLabelOfSunday(weeks[0].weekStartDate));
});

/** 月曜ISOからその週の表示開始日（日曜）の "yyyy/mm/dd" ラベルを作る（テスト専用の期待値ヘルパー）。 */
function dateLabelOfSunday(mondayIso) {
  const sunday = addDaysISO(mondayIso, -1);
  const [y, m, d] = sunday.split('-');
  return `${y}/${m}/${d}`;
}

/* ───────────────────────── schoolYearOf ───────────────────────── */

test('schoolYearOf: 学校年度は4月1日始まり', () => {
  assert.equal(schoolYearOf('2026-03-30'), 2025, '3月末はまだ前年度');
  assert.equal(schoolYearOf('2026-03-31'), 2025, '年度最終日も前年度');
  assert.equal(schoolYearOf('2026-04-01'), 2026, '4月1日は新年度の初日');
  assert.equal(schoolYearOf('2026-04-06'), 2026, '4月に入っていれば新年度');
});

/* ───────────────────────── arcMonthOfWeek ───────────────────────── */

test('arcMonthOfWeek: 先頭週の結果は buildPlanData の goalKeys.monthArcKey と一致する', async () => {
  const data = await buildPlanData({ ...localStorages(), today: LOCAL_FIXTURE_TODAY });
  const w0 = data.weeks[0];
  const key = arcMonthOfWeek(w0.weekStartDate, data.month, data.goalKeys.monthArcKey, LOCAL_FIXTURE_TODAY);
  assert.equal(key, data.goalKeys.monthArcKey, '先頭週は現行のアンカーarc月キーと同値になる（5.1節の式が正しく先頭週で恒等になること）');
});

test('arcMonthOfWeek: 今日と学校年度が異なる週は null', async () => {
  const data = await buildPlanData({ ...localStorages(), today: LOCAL_FIXTURE_TODAY });
  // LOCAL_FIXTURE_TODAY(2026-06-22)は学校年度2026。前年度に属する週（2026-03-16）で判定する。
  const key = arcMonthOfWeek('2026-03-16', data.month, data.goalKeys.monthArcKey, LOCAL_FIXTURE_TODAY);
  assert.equal(key, null, '年度外の週は月セルのキーを持たない（月目標を出さない＝2.4節）');
});

test('arcMonthOfWeek: 月をまたぐ未来週はその週の月曜の暦月のアーク月になる（先頭週固定でない）', async () => {
  const data = await buildPlanData({ ...localStorages(), today: LOCAL_FIXTURE_TODAY });
  const w0 = data.weeks[0]; // 2026-06-22（6月）
  const w2 = data.weeks[2]; // 2026-07-06（7月へ月をまたぐ週）
  assert.notEqual(
    w0.weekStartDate.slice(5, 7), w2.weekStartDate.slice(5, 7),
    '前提: weeks[0] と weeks[2] は暦月が異なる',
  );
  const key0 = arcMonthOfWeek(w0.weekStartDate, data.month, data.goalKeys.monthArcKey, LOCAL_FIXTURE_TODAY);
  const key2 = arcMonthOfWeek(w2.weekStartDate, data.month, data.goalKeys.monthArcKey, LOCAL_FIXTURE_TODAY);
  assert.notEqual(key2, key0, '月をまたぐ未来週は先頭週と同じキーに固定されない（規則を1本にする司令塔裁定）');
  assert.equal(key2, key0 + 1, 'その週の月曜の暦月ぶんキーが進む（7月は6月の翌アーク月）');
});

/* ───────────────────────── buildPlanData: pastWeeks / monthArcKey / monthGoal ───────────────────────── */

test('buildPlanData: pastWeeks・weeks[].monthArcKey・monthGoal を足しても既存の weeks/goalKeys は不変', async () => {
  const data = await buildPlanData({ ...localStorages(), today: LOCAL_FIXTURE_TODAY });
  assert.deepEqual(
    data.weeks.map((w) => w.key),
    ['2026/06/21', '2026/06/28', '2026/07/05', '2026/07/12'],
    'weeks の key 配列は現行のまま（週の連鎖・goalKeysの単一真実源を壊さない）',
  );
  assert.deepEqual(data.goalKeys, { weekKey: '2026-06-22', monthArcKey: 8 }, 'goalKeys は不変');
});

test('buildPlanData: pastWeeks は学校年度の4月1日週まで（種データの上書き最古日は今週内なので4/1週が下限）', async () => {
  const data = await buildPlanData({ ...localStorages(), today: LOCAL_FIXTURE_TODAY });
  // 種データの上書き最古日は 2026-06-23（今週内）なので、下限は学校年度2026の4/1週（2026-03-30）。
  assert.equal(data.pastWeeks[0].weekStartDate, '2026-03-30', '先頭は学校年度の4月1日を含む週');
  assert.equal(data.pastWeeks.length, 12, '2026-03-30〜2026-06-15の12週');
});

test('buildPlanData: 過去週の各日は7日ぶん・全日 date を持ち、上書きの無い日は source:empty かつ noRecord:true', async () => {
  const data = await buildPlanData({ ...localStorages(), today: LOCAL_FIXTURE_TODAY });
  for (const w of data.pastWeeks) {
    assert.equal(w.days.length, 7, `過去週 ${w.key} は日曜始まり7日ぶん`);
    for (const d of w.days) {
      assert.ok(d.date, `過去週の日は必ず実日付を持つ（週起点が実日付を持つ前提）`);
      if (d.source === 'empty') {
        assert.equal(d.noRecord, true, `上書きの無い過去日は noRecord:true（3.3節の描画分岐キー）`);
      }
    }
    assert.deepEqual(w.seedDays, [], '過去週は叩き台を作らない（既習連鎖に矛盾を持ち込まないため）');
  }
});

test('buildPlanData: 過去週にある coach 日は allCoachDays の同日と同一参照（表示とコピー元候補の二重実体化を禁止）', async () => {
  // today をずらし、種データの上書き日(2026-06-23〜25)が pastWeeks の範囲に入るようにする。
  const today = '2026-07-13';
  const data = await buildPlanData({ ...localStorages(), today });
  const coachDaysInPast = data.pastWeeks.flatMap((w) => w.days.filter((d) => d.source === 'coach'));
  assert.ok(coachDaysInPast.length > 0, '前提: このシナリオでは過去週にコーチ上書き日が含まれる');
  for (const d of coachDaysInPast) {
    const sameDate = data.allCoachDays.find((x) => x.date === d.date);
    assert.ok(sameDate, `allCoachDays に同日 ${d.date} が存在する`);
    assert.equal(sameDate, d, `過去週の coach 日と allCoachDays の同日は同一参照（同じオブジェクト）`);
  }
});
