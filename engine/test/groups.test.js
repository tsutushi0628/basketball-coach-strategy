/**
 * @file Tests for the cross-paired two-group weekday schedule (spec ②) and the
 * 3-classification display (spec ③).
 *
 * Business intent (not regex mechanics): one coach runs two groups (男子/女子).
 * The hard staffing rule is that the lone coach can supervise only one group's
 * live/contact rep (実践) at a time, so at no time slot may BOTH groups be in
 * 実践 — when one is coached, the other runs the SAME drill as 自走. Both groups
 * run the identical daily menu (ファンダ期 same curriculum). The Saturday host is
 * a co-ed "together" session (coach sees both). The display surfaces the three
 * coaching modes 自走/実践/レクチャ per drill so the session can be staffed at a
 * glance.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { createLocalStorage } from '../src/storage.js';
import { normalizeDrills } from '../src/normalize.js';
import { planWeek } from '../src/planWeek.js';
import { formatPlan } from '../src/format.js';
import {
  buildWeekdayCrossPair,
  buildTogether,
  buildWeekdayGroups,
  findSimultaneousPractice,
  DEFAULT_GROUPS,
} from '../src/groups.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const engineRoot = resolve(__dirname, '..');
const repoRoot = resolve(engineRoot, '..');

async function load() {
  const storage = createLocalStorage({
    drillsPath: resolve(repoRoot, 'docs/practice-knowledge/data/drills.json'),
    configPath: resolve(engineRoot, 'data/config.sample.json'),
    inputPath: resolve(engineRoot, 'data/team-input.sample.json'),
  });
  const drills = normalizeDrills(await storage.getDrills());
  const config = await storage.getConfig();
  const teamInput = await storage.getTeamInput();
  return { drills, config, teamInput };
}

/** A one-block day with the given items (each {id, mode}). */
function dayWith(dayLabel, items) {
  return {
    day: dayLabel,
    minutes: 100,
    court: '全面',
    coach_present: true,
    blocks: [
      {
        block: '技術',
        items: items.map((it) => ({
          drill_id: it.id,
          name: it.id,
          minutes: 10,
          category: 'C',
          intensity_class: '中',
          coaching_mode: it.mode,
          needs_coach: it.mode !== 'self',
        })),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Cross-pair staffing invariant (synthetic — tight control)
// ---------------------------------------------------------------------------

test('組違い: 実践スロットは男子→女子→男子…と交互にコーチが付く', () => {
  const day = dayWith('火', [
    { id: 'P1', mode: 'practice' },
    { id: 'P2', mode: 'practice' },
    { id: 'P3', mode: 'practice' },
  ]);
  const wd = buildWeekdayCrossPair(day, new Map(), DEFAULT_GROUPS);

  // Coach alternates: P1→男子, P2→女子, P3→男子.
  assert.equal(wd.columns['男子'][0].engagement, 'practice');
  assert.equal(wd.columns['女子'][0].engagement, 'self');
  assert.equal(wd.columns['男子'][1].engagement, 'self');
  assert.equal(wd.columns['女子'][1].engagement, 'practice');
  assert.equal(wd.columns['男子'][2].engagement, 'practice');
  assert.equal(wd.columns['女子'][2].engagement, 'self');
});

test('組違い不変条件: どのスロットも2グループ同時に実践にならない', () => {
  // Mix of practice and self slots; the invariant must hold throughout.
  const day = dayWith('火', [
    { id: 'S0', mode: 'self' },
    { id: 'P1', mode: 'practice' },
    { id: 'S1', mode: 'self' },
    { id: 'P2', mode: 'practice' },
    { id: 'P3', mode: 'practice' },
  ]);
  const wd = buildWeekdayCrossPair(day, new Map(), DEFAULT_GROUPS);
  assert.deepEqual(findSimultaneousPractice(wd), [], '同時に2グループが実践になってはならない');

  // The non-coached group on a practice slot runs the SAME drill (自走), so both
  // groups end up doing the identical menu (同じドリルIDが両列に並ぶ).
  for (let i = 0; i < wd.columns['男子'].length; i++) {
    assert.equal(wd.columns['男子'][i].drill_id, wd.columns['女子'][i].drill_id, `スロット${i}は両グループ同一ドリル`);
  }
});

test('組違い: 自走スロットは両グループ自走（コーチは浮く）', () => {
  const day = dayWith('火', [{ id: 'S1', mode: 'self' }, { id: 'S2', mode: 'self' }]);
  const wd = buildWeekdayCrossPair(day, new Map(), DEFAULT_GROUPS);
  for (const g of DEFAULT_GROUPS) {
    for (const s of wd.columns[g]) {
      assert.equal(s.engagement, 'self');
      assert.equal(s.coached, false, '自走スロットにコーチは付かない');
    }
  }
});

test('組違い: 既習レクチャが平日に来ても反復(自走)扱い（レクチャ表示にしない）', () => {
  const day = dayWith('火', [{ id: 'L1', mode: 'lecture' }]);
  const wd = buildWeekdayCrossPair(day, new Map(), DEFAULT_GROUPS);
  for (const g of DEFAULT_GROUPS) {
    assert.equal(wd.columns[g][0].engagement, 'self', '平日のレクチャ型は自走(反復)で表示');
  }
});

test('合同(土): コーチは両グループを同時に見る・モードはドリル本来の3分類', () => {
  const day = dayWith('土', [
    { id: 'P1', mode: 'practice' },
    { id: 'S1', mode: 'self' },
    { id: 'L1', mode: 'lecture' },
  ]);
  const tg = buildTogether(day, new Map(), DEFAULT_GROUPS);
  assert.equal(tg.kind, 'together');
  assert.deepEqual(tg.shared.map((s) => s.engagement), ['practice', 'self', 'lecture']);
  assert.deepEqual(tg.groups, DEFAULT_GROUPS);
});

test('shared_gym=false なら組違い表は作らない（単一列にフォールバック）', () => {
  const plan = { days: [dayWith('火', [{ id: 'P1', mode: 'practice' }])], saturday_lecture: null };
  const out = buildWeekdayGroups({ plan, drillIndex: new Map(), config: { shared_gym: false } });
  assert.deepEqual(out, [], 'shared_gym=false は空(=フォールバック)');
});

// ---------------------------------------------------------------------------
// End-to-end against the real catalog — the staffing invariant must hold there
// ---------------------------------------------------------------------------

test('planWeek(catalog): 全平日で同時実践が0件・土曜は合同セッション', async () => {
  const { drills, config, teamInput } = await load();
  const plan = planWeek(drills, config, teamInput);

  assert.ok(Array.isArray(plan.weekday_groups) && plan.weekday_groups.length > 0, '組違い表が生成される');

  let totalViolations = 0;
  let togetherDays = 0;
  for (const dp of plan.weekday_groups) {
    if (dp.kind === 'together') {
      togetherDays += 1;
      continue;
    }
    totalViolations += findSimultaneousPractice(dp).length;
    // identical menu across both columns
    const groupLabels = Object.keys(dp.columns);
    const a = groupLabels[0], b = groupLabels[1];
    for (let i = 0; i < dp.columns[a].length; i++) {
      assert.equal(dp.columns[a][i].drill_id, dp.columns[b][i].drill_id, `${dp.day} スロット${i}が両グループ不一致`);
    }
  }
  assert.equal(totalViolations, 0, '実機: どの平日スロットも2グループ同時に実践にならない');
  assert.equal(togetherDays, 1, '土曜が1日だけ合同セッションになる');
});

// ---------------------------------------------------------------------------
// 3-classification display (spec ③)
// ---------------------------------------------------------------------------

test('表示(③): 平日各ドリルに3分類(自走/実践)が出て旧2値「要コーチ」は消える', async () => {
  const { drills, config, teamInput } = await load();
  const plan = planWeek(drills, config, teamInput);
  const text = formatPlan(plan);

  // 3-classification labels are present.
  assert.match(text, /自走/, '自走ラベルが出る');
  assert.match(text, /実践/, '実践ラベルが出る');
  assert.match(text, /レクチャ/, 'レクチャラベルが出る(土曜導入)');

  // The legacy 要コーチ 2-value tag no longer appears in the per-drill line.
  assert.ok(!/　要コーチ$/m.test(text), '旧「要コーチ」タグは行末に出ない');

  // The cross-paired weekday section is rendered.
  assert.match(text, /組違い週次表/, '組違い週次表セクションが描画される');
  assert.match(text, /▶/, 'コーチ位置マーカー(▶)が描画される');
});

test('表示(③): planItem に coaching_mode が刻印され3分類のいずれか', async () => {
  const { drills, config, teamInput } = await load();
  const plan = planWeek(drills, config, teamInput);
  for (const day of plan.days) {
    for (const it of day.blocks.flatMap((b) => b.items)) {
      assert.ok(
        it.coaching_mode === 'self' || it.coaching_mode === 'practice' || it.coaching_mode === 'lecture',
        `${it.name} の coaching_mode が3分類でない: ${it.coaching_mode}`,
      );
    }
  }
});
