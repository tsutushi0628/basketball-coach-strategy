/**
 * @file Review-driven business-intent tests.
 *
 * These cover the gaps a code review raised about the engine's *intent* (not its
 * mechanics). Each test pins a business guarantee and is written so it fails if the
 * corresponding gate / filter is gutted:
 *
 *   R2  assertCoachContext throws when a coach-absent day carries an acquisition
 *       (習得) / team-install drill — the player-self-run guarantee is enforced.
 *   R3  a team-input with missing/NaN indicator numbers yields finite finalWeights
 *       (no NaN) and a non-empty mainFocus — degenerate input cannot blank the plan.
 *   R4  a "高校用・中学は試合不可" drill is dropped for a middle-school team (F2).
 *   R5  a drill whose only "セット" marker lives in philosophy_tags / sub_skill is
 *       excluded in-year (F4 now scans tags + sub_skill, not just name/notes).
 *
 * (R1 covered the philosophy-floor accounting, which the rebuild removed — 撤去①
 * フロア強制廃止 — so those cases are gone.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeDrill, normalizeGrades } from '../src/normalize.js';
import { computeFinalWeights } from '../src/gap.js';
import {
  isSetsDrill,
  isGloballyForbidden,
  gradesFit,
  filterPoolForDay,
} from '../src/filter.js';
import { assertCoachContext } from '../src/gates.js';

// ───────────────────────────────────────────────────────────────────────────
// Small builders mirroring the engine's plan/day/item shapes.
// ───────────────────────────────────────────────────────────────────────────

/** One plan item. */
function item(over = {}) {
  return {
    drill_id: over.drill_id ?? 'X',
    name: over.name ?? 'd',
    minutes: over.minutes ?? 10,
    category: over.category ?? 'シュート',
    intensity_class: over.intensity_class ?? '中',
  };
}

/**
 * One plan day. `coach_present` defaults to true (matches engine default).
 * `blocks` can be passed directly; otherwise the items go in a 技術 block.
 */
function day({ label = '火', minutes = 100, coach_present = true, items = [], blocks } = {}) {
  const blks = blocks ?? [{ block: '技術', items }];
  const all = blks.flatMap((b) => b.items);
  return {
    day: label,
    minutes,
    court: '全面',
    coach_present,
    blocks: blks,
    total_minutes: all.reduce((s, it) => s + it.minutes, 0),
    high_intensity_count: all.filter((it) => it.intensity_class === '高').length,
  };
}

const DEFENSE_CAT = 'チームディフェンス(オールコートマンツー/ヘルプ/帰陣)';

// ───────────────────────────────────────────────────────────────────────────
// R2. assertCoachContext throws when a coach-absent day carries a drill players
//     cannot self-run: either an off-allow-list (team-install) category, or a
//     non-settled mastery stage (習得 / 習得→反復). The warm-up/cool-down blocks
//     are exempt (they run daily regardless of coach presence).
// ───────────────────────────────────────────────────────────────────────────
test('R2: assertCoachContext throws on a 習得-stage drill placed on a coach-absent day', () => {
  const config = {
    coach_absent_allow: ['シュート', 'ハンドリング/ドリブル', 'コンディショニング/ウォームアップ'],
  };
  // Acquisition-stage shooting drill: allow-listed category but NOT settled mastery.
  const drill = normalizeDrill({
    id: 'NEW-1',
    name: '新フォーム習得',
    category: 'シュート',
    mastery_stage: '習得',
    court: '半面',
    grades: '全',
    intensity_class: '中',
  });
  const idx = new Map([[drill.id, drill]]);
  const plan = {
    days: [
      day({
        label: '水',
        coach_present: false,
        blocks: [{ block: '技術', items: [item({ drill_id: 'NEW-1', name: '新フォーム習得', category: 'シュート' })] }],
      }),
    ],
  };
  assert.throws(() => assertCoachContext(plan, config, idx), /assertCoachContext/);
});

test('R2b: assertCoachContext throws on a team-install (off-allow-list) drill on a coach-absent day', () => {
  const config = {
    coach_absent_allow: ['シュート', 'ハンドリング/ドリブル', 'コンディショニング/ウォームアップ'],
  };
  // Settled mastery but a team-defense category that is NOT on the self-run allow list.
  const drill = normalizeDrill({
    id: 'TD-1',
    name: 'オールコートマンツー導入',
    category: DEFENSE_CAT,
    mastery_stage: '反復',
    court: '全面',
    grades: '全',
    intensity_class: '中',
  });
  const idx = new Map([[drill.id, drill]]);
  const plan = {
    days: [
      day({
        label: '木',
        coach_present: false,
        blocks: [{ block: '対人', items: [item({ drill_id: 'TD-1', name: 'オールコートマンツー導入', category: DEFENSE_CAT })] }],
      }),
    ],
  };
  assert.throws(() => assertCoachContext(plan, config, idx), /assertCoachContext/);
});

test('R2c: assertCoachContext does NOT throw on a settled, allow-listed drill on a coach-absent day', () => {
  const config = {
    coach_absent_allow: ['シュート', 'コンディショニング/ウォームアップ'],
  };
  const drill = normalizeDrill({
    id: 'OK-1',
    name: 'スポットシュート反復',
    category: 'シュート',
    mastery_stage: '反復',
    court: '半面',
    grades: '全',
    intensity_class: '中',
  });
  const idx = new Map([[drill.id, drill]]);
  const plan = {
    days: [
      day({
        label: '水',
        coach_present: false,
        blocks: [{ block: '技術', items: [item({ drill_id: 'OK-1', name: 'スポットシュート反復', category: 'シュート' })] }],
      }),
    ],
  };
  assert.doesNotThrow(() => assertCoachContext(plan, config, idx));
});

test('R2d: WU/CD blocks are exempt — a 習得 drill there does not trip assertCoachContext', () => {
  const config = { coach_absent_allow: ['コンディショニング/ウォームアップ'] };
  const drill = normalizeDrill({
    id: 'WU-NEW',
    name: '新動的ストレッチ習得',
    category: 'コンディショニング/ウォームアップ',
    mastery_stage: '習得',
    court: '不問',
    grades: '全',
    intensity_class: '低',
  });
  const idx = new Map([[drill.id, drill]]);
  const plan = {
    days: [
      day({
        label: '水',
        coach_present: false,
        blocks: [{ block: 'WU', items: [item({ drill_id: 'WU-NEW', name: '新動的ストレッチ習得', category: 'コンディショニング/ウォームアップ' })] }],
      }),
    ],
  };
  assert.doesNotThrow(() => assertCoachContext(plan, config, idx));
});

// ───────────────────────────────────────────────────────────────────────────
// R3. Missing / NaN indicator numbers must not poison the weights: finalWeights
//     stays finite (no NaN) and mainFocus is non-empty, so a degenerate input
//     can never blank the plan or disable the main-focus gate.
// ───────────────────────────────────────────────────────────────────────────
test('R3: a team-input with missing/NaN indicator numbers yields finite weights and a non-empty mainFocus', () => {
  const config = {
    phase_category_weights: {
      'ハンドリング/ドリブル': 0.4,
      'シュート': 0.3,
      '1on1': 0.3,
    },
  };
  // Every indicator is broken in a different way (missing field / NaN / null).
  const teamInput = {
    team_id: 't',
    grades: [1, 2],
    indicators: [
      { id: 'FT率', good_direction: 'up', baseline: undefined, latest: 52, target: 70, unit: '%' },
      { id: '試合TO', good_direction: 'down', baseline: 20, latest: NaN, target: 10, unit: '本' },
      { id: 'ゴール下成功率', good_direction: 'up', baseline: 45, latest: 55, target: null, unit: '%' },
    ],
  };

  const { finalWeights, mainFocus } = computeFinalWeights(config, teamInput);

  // No NaN may appear in any finalWeight.
  for (const [cat, w] of Object.entries(finalWeights)) {
    assert.ok(Number.isFinite(w), `finalWeights[${cat}] が有限でない: ${w}`);
  }
  // mainFocus must be a real category (falls back to the heaviest phase weight).
  assert.ok(mainFocus && mainFocus.length > 0, 'mainFocus が空であってはならない');
  assert.equal(mainFocus, 'ハンドリング/ドリブル', '全指標欠損時は最重フェーズ基底に落ちるべき');
});

test('R3b: with phase weights also empty, mainFocus falls back to the safe default category (still non-empty)', () => {
  const config = { phase_category_weights: {} };
  const teamInput = {
    team_id: 't',
    grades: [1],
    indicators: [{ id: 'FT率', good_direction: 'up', baseline: NaN, latest: NaN, target: NaN, unit: '%' }],
  };
  const { finalWeights, mainFocus } = computeFinalWeights(config, teamInput);
  for (const w of Object.values(finalWeights)) assert.ok(Number.isFinite(w), 'NaNが混入してはならない');
  assert.ok(mainFocus && mainFocus.length > 0, '退化入力でも mainFocus は非空であるべき');
});

// ───────────────────────────────────────────────────────────────────────────
// R4. A "高校用・中学は試合不可" drill must be excluded for a middle-school team:
//     normalizeGrades resolves such a note to an empty grade array, which the F2
//     grade filter then drops for every middle-school grade.
// ───────────────────────────────────────────────────────────────────────────
test('R4: a 高校用・中学は試合不可 drill is dropped for a middle-school team (F2 grade filter)', () => {
  // The grade note alone would otherwise resolve to [1,2,3] via the generic 中学 branch.
  assert.deepEqual(
    normalizeGrades('高校用。中学は試合不可'),
    [],
    '高校用・中学試合不可 表記は空配列(=どの中学学年にも該当しない)になるべき',
  );

  const drill = normalizeDrill({
    id: 'HS-1',
    name: '高校用5メンウィーブ',
    category: '意思決定/ゲーム形式',
    grades: '高校用。中学は試合不可',
    court: '全面',
    intensity_class: '中',
  });
  // F2 directly: this drill does not fit a [1,2] team.
  assert.equal(gradesFit(drill, [1, 2]), false, '中学[1,2]チームに該当しないべき');

  // And it is filtered out of a middle-school day pool entirely.
  const config = {
    category: '中学',
    grades: [1, 2],
    current_month: 8,
    philosophy: { zone_forbidden: true, sets_forbidden_in_year: true },
  };
  // A grade-valid control drill so we can prove the pool isn't empty by accident.
  const ctrl = normalizeDrill({
    id: 'OK-G',
    name: 'スポットシュート',
    category: 'シュート',
    grades: '中学1〜2年',
    court: '半面',
    intensity_class: '中',
  });
  const pool = filterPoolForDay([drill, ctrl], config, '全面');
  const ids = pool.map((d) => d.id);
  assert.ok(!ids.includes('HS-1'), '高校用ドリルはプールから除外されるべき');
  assert.ok(ids.includes('OK-G'), '中学該当ドリルはプールに残るべき(対照)');
});

// ───────────────────────────────────────────────────────────────────────────
// R5. A set-play drill whose only "セット" marker lives in philosophy_tags or in
//     sub_skill (not name/notes) must still be caught by F4 and excluded in-year.
//     This pins the spec #2 widening of isSetsDrill's haystack.
// ───────────────────────────────────────────────────────────────────────────
test('R5: a drill marked "セット" only in philosophy_tags is excluded in-year (F4)', () => {
  const drill = normalizeDrill({
    id: 'SET-TAG',
    name: 'ホーンズ展開', // name carries NO "セット"
    category: 'チームオフェンス(アーリー/トランジション)',
    notes: '5アウトからの展開', // notes carries NO "セット"
    sub_skill: '連携',
    philosophy_tags: ['セット'], // marker hides only here
    grades: '全',
    court: '全面',
    intensity_class: '中',
  });
  assert.equal(isSetsDrill(drill), true, 'philosophy_tags の「セット」も検知されるべき');

  const config = {
    category: '中学',
    grades: [1, 2],
    current_month: 8, // in-year
    philosophy: { zone_forbidden: true, sets_forbidden_in_year: true },
  };
  assert.equal(isGloballyForbidden(drill, config), true, '年内セット禁止で除外されるべき');
  const pool = filterPoolForDay([drill], config, '全面');
  assert.equal(pool.length, 0, '年内はセット系がプールから除外されるべき');
});

test('R5b: a drill marked "セット" only in sub_skill is also excluded in-year (F4)', () => {
  const drill = normalizeDrill({
    id: 'SET-SUB',
    name: 'クイックヒッター',
    category: 'チームオフェンス(アーリー/トランジション)',
    notes: 'タイムアウト明けの一発',
    sub_skill: 'セットオフェンス', // marker hides only here
    philosophy_tags: ['トランジション'],
    grades: '全',
    court: '全面',
    intensity_class: '中',
  });
  assert.equal(isSetsDrill(drill), true, 'sub_skill の「セット」も検知されるべき');

  const config = {
    category: '中学',
    grades: [1, 2],
    current_month: 8,
    philosophy: { zone_forbidden: true, sets_forbidden_in_year: true },
  };
  const pool = filterPoolForDay([drill], config, '全面');
  assert.equal(pool.length, 0, 'sub_skill 由来のセット系も年内除外されるべき');
});
