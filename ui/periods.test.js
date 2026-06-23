/**
 * @file 複数期間生成（週/月ピッカーの実切替）の業務意図テスト。
 *
 * 検証する振る舞い:
 *  - 週ピッカーは「現アーク月の週1..N」を、暦日+7日ずつ・週番号+1ずつで並べる。
 *  - 月ピッカーは「現月から半年」を、暦月ラベルとアーク駆動月の定数オフセットを保って並べる（年跨ぎも）。
 *  - buildPlanData は単一週の後方互換（top-level days/session）を保ったまま weeks[]/months[] を足す。
 *  - 週の中身が実際に変わる（週1=型づくり ≠ 週2=反復・強度／既習レクチャは週送りで進む）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeWeekPeriods, computeMonthPeriods, buildPlanData } from './plan-data.mjs';
import { localStorages } from './build.mjs';

test('週ピッカー: 現アーク月の4週を暦日+7日・週番号+1で並べる', () => {
  const weeks = computeWeekPeriods({ currentMonth: 7, weekOfMonth: 1, weekStartDate: '2026-06-22' });
  assert.equal(weeks.length, 4, '現アーク月=4週ぶん生成する');
  assert.deepEqual(weeks.map((w) => w.weekStartDate), ['2026-06-22', '2026-06-29', '2026-07-06', '2026-07-13'], '週起点は+7日ずつ');
  assert.deepEqual(weeks.map((w) => w.weekOfMonth), [1, 2, 3, 4], '週番号は+1ずつ（焦点が型→反復で変わる軸）');
  assert.ok(weeks.every((w) => w.currentMonth === 7), 'アーク駆動月は同一月内で固定');
  assert.equal(weeks[0].key, '2026/06/22', 'key はパネル対応用の yyyy/mm/dd');
  assert.equal(weeks[1].label, '2026/06/29〜', 'label はピッカー表示用');
});

test('週ピッカー: 週起点未設定（CLI fallback）でも週番号で4週並ぶ', () => {
  const weeks = computeWeekPeriods({ currentMonth: 7, weekOfMonth: 1, weekStartDate: null });
  assert.equal(weeks.length, 4);
  assert.equal(weeks[0].weekStartDate, null, '日付は持たない');
  assert.equal(weeks[1].label, '第2週', '日付が無ければ週番号ラベル');
});

test('月ピッカー: 現月から半年を暦月ラベル＋アーク駆動月の定数オフセットで並べる', () => {
  const months = computeMonthPeriods({ currentMonth: 7, displayMonth: 6, year: 2026 });
  assert.equal(months.length, 6, '現月＋先5ヶ月');
  assert.deepEqual(months.map((m) => m.displayMonth), [6, 7, 8, 9, 10, 11], '暦月ラベルは+1ずつ');
  assert.deepEqual(months.map((m) => m.currentMonth), [7, 8, 9, 10, 11, 12], 'アーク駆動月は暦月＋定数オフセットを保つ');
  assert.deepEqual(months.map((m) => m.label), ['2026/06', '2026/07', '2026/08', '2026/09', '2026/10', '2026/11']);
});

test('月ピッカー: 年跨ぎでラベルの年が繰り上がる', () => {
  const months = computeMonthPeriods({ currentMonth: 12, displayMonth: 11, year: 2026 });
  assert.deepEqual(months.map((m) => m.label), ['2026/11', '2026/12', '2027/01', '2027/02', '2027/03', '2027/04'], '12月の次は翌年1月');
  assert.deepEqual(months.map((m) => m.displayMonth), [11, 12, 1, 2, 3, 4]);
});

test('buildPlanData: 後方互換（top-level days/session）を保ったまま weeks[]/months[] を足す', async () => {
  const data = await buildPlanData(localStorages());
  assert.equal(data.weeks.length, 4, '週は4つ');
  assert.equal(data.months.length, 6, '月は6つ');
  // 後方互換: top-level days は先頭週（アンカー）の days と同一。
  assert.equal(data.days, data.weeks[0].days, 'top-level days はアンカー週の days');
  assert.equal(data.session.goals, data.weeks[0].goals, 'top-level session はアンカー週の goals');
});

test('buildPlanData: 週の中身が実際に変わる（週1=型づくり ≠ 週2=反復）', async () => {
  const data = await buildPlanData(localStorages());
  assert.notEqual(data.weeks[0].focus, data.weeks[1].focus, '週1と週2で今週の焦点が変わる＝実切替の中身差');
  assert.match(data.weeks[0].focus, /型づくり/, '週1は型づくり');
  assert.match(data.weeks[1].focus, /反復/, '週2は反復・強度');
});

test('buildPlanData: 月の中身が実際に変わる（各月で別フェーズ）', async () => {
  const data = await buildPlanData(localStorages());
  const phases = data.months.map((m) => m.month.phase);
  assert.equal(new Set(phases).size, phases.length, '6ヶ月すべて別フェーズ＝実切替の中身差');
});

test('buildPlanData: コーチ上書きは各週の実日付にだけ当たる（別週へ漏れない）', async () => {
  const data = await buildPlanData(localStorages());
  const wk1Tue = data.weeks[0].days.find((d) => d.day === '火');
  const wk2Tue = data.weeks[1].days.find((d) => d.day === '火');
  assert.equal(wk1Tue.source, 'coach', '週1の火（06/23）はコーチ上書き');
  assert.notEqual(wk2Tue.source, 'coach', '週2の火（06/30）は上書き対象外＝自動生成');
});
