/**
 * @file 過去の週への移動（週ごとの月目標キー・到達下限・年月ジャンプ）の業務意図テスト（純関数）。
 *
 * 正本: docs/specs/past-weeks-and-copy-source/service-design.md（2.〜3.章・6章）、
 *       docs/findings/spec-20260905-past-weeks-and-copy-source-impl.md（2〜6章・11章）。
 *
 * 検証する業務意図（実装の途中値は写経しない）:
 *   - computePastWeekDefs: 到達下限＝「最古の上書き日を含む週」と「今週の4週前」の早い方から、
 *     今週の前週まで並ぶ（司令塔裁定: 未来週にも月キーを一律に当てるのと対で、過去週は叩き台なし）。
 *   - schoolYearOf: 学校年度は4月1日始まり（3月末と4月頭で年度が切り替わる）。
 *   - arcMonthOfWeek: 週ごとの月目標キーは「その週の月曜の暦月」を月タブと同じオフセットで
 *     アーク月へ写す（司令塔裁定: 未来週にも一律に当てる。先頭週は goalKeys.monthArcKey と一致）。
 *     年度外（今日と学校年度が異なる）週は null。
 *   - computeJumpMonths: 「年月で飛ぶ」の選択肢は上書きのある年月だけを新しい順に並べ、各月の
 *     weekKey はその月の第1週を指す。
 *   - buildPlanData: pastWeeks・weeks[].monthArcKey・weeks[].monthGoal が既存の weeks/goalKeys を
 *     不変に保ったまま追加される。過去週の日は叩き台を作らず（seedDays 空）、上書きの無い日は
 *     source:'empty' かつ noRecord:true。pastWeeks の coach 日は allCoachDays の同日と同一参照
 *     （テナント全件コピー元候補と過去週表示が同じ土台を指す＝二重に別実体を作らない）。
 *
 * 対応前の現状（本ファイル作成時点で実走確認済み）: computePastWeekDefs・schoolYearOf・
 * arcMonthOfWeek・computeJumpMonths のいずれも ui/plan-data.mjs に未実装（export 無し）。
 * ESM の名前付きインポートは存在しないバインディングを解決できずモジュール読み込み時点で
 * SyntaxError になるため、本ファイルの全テストが「実行前」に失敗する（個々の assert には届かない）。
 * buildPlanData 自体は実装済みだが、戻り値に pastWeeks・monthArcKey・monthGoal を持たないため、
 * 該当テストは実行はできても期待値と食い違って失敗する。
 *
 * テスト基盤: node --test。データは build.mjs の localStorages（ローカルJSON固定＝実データ）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  computePastWeekDefs,
  schoolYearOf,
  arcMonthOfWeek,
  computeJumpMonths,
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

test('computePastWeekDefs: 上書き無し(null)なら今週の4週前から4週生成する', () => {
  // 失敗理由(現状): computePastWeekDefs が未エクスポートで import 時に落ちる。
  const todayMonday = '2026-06-22';
  const weeks = computePastWeekDefs(todayMonday, null);
  assert.equal(weeks.length, 4, '上書きゼロのテナントでも直近4週は戻れる（3.1節）');
  assert.equal(weeks[weeks.length - 1].weekStartDate, addDaysISO(todayMonday, -7), '末尾は今週の月曜の7日前');
  assert.equal(weeks[0].weekStartDate, addDaysISO(todayMonday, -28), '先頭は今週の4週前（古い順）');
});

test('computePastWeekDefs: 最古の上書きが10週前ならその週まで10週生成する', () => {
  const todayMonday = '2026-06-22';
  // 2026-04-15（水）は 10週前の週（月曜 2026-04-13）に属する。
  const weeks = computePastWeekDefs(todayMonday, '2026-04-15');
  assert.equal(weeks.length, 10, '最古の上書き週まで戻れる（4週下限より遠ければそちらを優先）');
  assert.equal(weeks[0].weekStartDate, '2026-04-13', '先頭が最古の上書き週の月曜');
  assert.equal(weeks[weeks.length - 1].weekStartDate, addDaysISO(todayMonday, -7));
});

test('computePastWeekDefs: 最古の上書きが今週内なら4週下限が勝つ', () => {
  const todayMonday = '2026-06-22';
  // 2026-06-23（火）は今週（月曜2026-06-22）に属する＝「最古の上書き週」は今週そのもの。
  const weeks = computePastWeekDefs(todayMonday, '2026-06-23');
  assert.equal(weeks.length, 4, '最古の上書きが今週内でも4週は戻れる（下限は早い方＝4週前）');
  assert.equal(weeks[0].weekStartDate, addDaysISO(todayMonday, -28));
});

test('computePastWeekDefs: 最古の上書きがちょうど4週前の週なら4週生成する', () => {
  const todayMonday = '2026-06-22';
  const fourWeeksAgoMonday = addDaysISO(todayMonday, -28);
  // 月曜そのものでなく週内の1日（+1日）でも同じ週に属する。
  const weeks = computePastWeekDefs(todayMonday, addDaysISO(fourWeeksAgoMonday, 1));
  assert.equal(weeks.length, 4);
  assert.equal(weeks[0].weekStartDate, fourWeeksAgoMonday);
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

/* ───────────────────────── computeJumpMonths ───────────────────────── */

test('computeJumpMonths: 新しい順・各月の第1週をweekKeyに持つ・範囲外の月を含まない', () => {
  const allWeeks = [
    { key: 'a', weekStartDate: '2026-05-04' },
    { key: 'b', weekStartDate: '2026-05-11' },
    { key: 'c', weekStartDate: '2026-05-25' },
    { key: 'd', weekStartDate: '2026-06-01' },
    { key: 'e', weekStartDate: '2026-06-08' },
  ];
  const months = computeJumpMonths(allWeeks);
  assert.deepEqual(months.map((m) => m.ym), ['2026-06', '2026-05'], '新しい順（範囲は入力の月だけ＝2件）');
  assert.equal(months[0].weekKey, 'd', '6月の第1週は6月内で最初に現れた週');
  assert.equal(months[1].weekKey, 'a', '5月の第1週は5月内で最初に現れた週');
  assert.equal(months[0].label, '2026年6月');
  assert.equal(months[1].label, '2026年5月');
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

test('buildPlanData: pastWeeks は最古の上書き(今週内)と4週下限のうち早い方＝4週', async () => {
  const data = await buildPlanData({ ...localStorages(), today: LOCAL_FIXTURE_TODAY });
  // 種データの上書き最古日は 2026-06-23（今週内）なので、下限は「今週の4週前」が勝つ。
  assert.equal(data.pastWeeks.length, 4, '最古の上書きが今週内＝4週下限が勝つ（3.1節）');
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
