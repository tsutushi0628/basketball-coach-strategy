/**
 * @file 週/月/年の目標テキスト上書き適用（plan-data.mjs applyGoalOverrides）の業務意図テスト。
 *
 * 検証する業務意図（fix: 週/月/年の目標が編集できない・編集が他タブに整合しない）:
 *   - 週上書きは該当週（週起点日キー）だけに効き、別週・別軸（月/年）には漏れない。
 *   - 月上書き（arc月キー）は months/year.arc/session の同一arc月見出しに同時に効く（月＝年＝同一源）。
 *   - アンカー週の週上書きは session.goals.week にも反映される（top-level展開の整合）。
 *   - 空文字（マップに残らない正常系）や未設定キーは上書きしない＝エンジン値のまま。
 *
 * 注: applyGoalOverrides は参照を直接書き換える純関数。固定するのは「どのキーがどの表示要素に効くか」
 *     という業務意図のみで、実装の途中計算は写さない。
 *
 * テスト基盤: node --test。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyGoalOverrides } from './plan-data.mjs';

const WK0 = '2026-06-22'; // アンカー週起点
const WK1 = '2026-06-29'; // 翌週起点

/** 週/月/年/session を持つ合成データ片（buildPlanData の組み立て後相当の最小形）。 */
function makeParts() {
  // 週0=アンカー（goals は session と同一参照を共有する＝buildPlanData の実構造を模す）。
  const anchorGoals = { week: '型づくり（自動）', monthMain: '準備の月（自動）' };
  const anchorMonth = { arcMonth: 8, headline: '準備の月（自動）' };
  return {
    weeks: [
      { weekStartDate: WK0, focus: '型づくり（自動）', goals: anchorGoals, month: anchorMonth },
      { weekStartDate: WK1, focus: '反復（自動）', goals: { week: '反復（自動）', monthMain: '準備の月（自動）' }, month: { arcMonth: 8, headline: '準備の月（自動）' } },
    ],
    months: [
      { arcMonth: 8, month: { arcMonth: 8, headline: '準備の月（自動）' } },
      { arcMonth: 9, month: { arcMonth: 9, headline: '積み上げの月（自動）' } },
    ],
    year: {
      arc: [
        { month: 8, headline: '準備の月（自動）' },
        { month: 9, headline: '積み上げの月（自動）' },
      ],
    },
    session: { goals: anchorGoals, month: anchorMonth },
  };
}

test('週上書き: 該当週（週起点キー）の focus と goals.week だけが変わる', () => {
  const parts = makeParts();
  applyGoalOverrides(parts, { weeks: { [WK1]: '走り込み week1' }, arcMonths: {} });

  const w0 = parts.weeks[0];
  const w1 = parts.weeks[1];
  assert.equal(w1.focus, '走り込み week1', '該当週の焦点が置き換わる');
  assert.equal(w1.goals.week, '走り込み week1', '該当週の goals.week も置き換わる');
  assert.equal(w0.focus, '型づくり（自動）', '別週（アンカー）の焦点は不変');
  assert.equal(w0.goals.week, '型づくり（自動）', '別週の goals.week は不変');
});

test('週上書き: アンカー週の上書きは session.goals.week にも反映される', () => {
  const parts = makeParts();
  applyGoalOverrides(parts, { weeks: { [WK0]: 'アンカー週の焦点' }, arcMonths: {} });

  assert.equal(parts.weeks[0].focus, 'アンカー週の焦点');
  assert.equal(parts.session.goals.week, 'アンカー週の焦点', 'top-level展開＝session.goals.week にも効く');
});

test('週上書きは月/年軸（headline）に漏れない', () => {
  const parts = makeParts();
  applyGoalOverrides(parts, { weeks: { [WK0]: '週だけ変える' }, arcMonths: {} });

  assert.equal(parts.months[0].month.headline, '準備の月（自動）', '月見出しは週上書きの影響を受けない');
  assert.equal(parts.year.arc[0].headline, '準備の月（自動）', '年見出しも不変');
  assert.equal(parts.session.month.headline, '準備の月（自動）', 'session.month も不変');
});

test('月上書き（arc月キー）: months/year.arc/session の同一arc月見出しに同時に効く（月＝年＝同一源）', () => {
  const parts = makeParts();
  applyGoalOverrides(parts, { weeks: {}, arcMonths: { 8: '準備の月（コーチ編集）' } });

  // arc月8の月パネル・年セル・アンカーが同時に変わる。
  assert.equal(parts.months[0].month.headline, '準備の月（コーチ編集）', '月パネル（arc8）が変わる');
  assert.equal(parts.year.arc[0].headline, '準備の月（コーチ編集）', '年セル（arc8）も同時に変わる');
  assert.equal(parts.session.month.headline, '準備の月（コーチ編集）', 'アンカー（arc8）の月見出しも変わる');
  assert.equal(parts.session.goals.monthMain, '準備の月（コーチ編集）', 'アンカーの月の目標バーも変わる');
  // arc月9（別月）は不変。
  assert.equal(parts.months[1].month.headline, '積み上げの月（自動）', '別arc月（9）は不変');
  assert.equal(parts.year.arc[1].headline, '積み上げの月（自動）', '別arc月（9）の年セルも不変');
});

test('空文字・未設定キーは上書きしない（エンジン値のまま）', () => {
  const parts = makeParts();
  // 空文字（型汚染で混入したケースを模す）・別キー（存在しないarc月）。
  applyGoalOverrides(parts, { weeks: { [WK0]: '' }, arcMonths: { 8: '', 12: 'どこにも効かない' } });

  assert.equal(parts.weeks[0].focus, '型づくり（自動）', '空文字の週上書きは無視＝エンジン値のまま');
  assert.equal(parts.months[0].month.headline, '準備の月（自動）', '空文字の月上書きは無視＝エンジン値のまま');
  assert.equal(parts.year.arc[0].headline, '準備の月（自動）', '年見出しもエンジン値のまま');
});

test('上書きが空マップ/未設定でも壊れずそのまま返す', () => {
  const parts = makeParts();
  assert.equal(applyGoalOverrides(parts, { weeks: {}, arcMonths: {} }), parts, '同一参照を返す');
  assert.equal(applyGoalOverrides(parts, undefined), parts, '未設定でも壊れない');
  assert.equal(parts.weeks[0].focus, '型づくり（自動）', '何も変わらない');
});
