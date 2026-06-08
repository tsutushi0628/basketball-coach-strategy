/**
 * @file Tests for the rotation-model two-group weekday schedule (spec ②) and the
 * 3-classification display (spec ③).
 *
 * Business intent (not regex mechanics): one coach runs two groups (男子/女子).
 *
 * Core model:
 *   - The coach attaches to one group's practice (live/contact) drill while the
 *     OTHER group fills that time with a DIFFERENT self-runnable drill ("self_fill").
 *     Then they swap. Both groups ultimately complete the full menu.
 *   - Coach-required (practice-mode) drills are NEVER done unsupervised.
 *   - The "empty side is doing the SAME drill unsupervised" antipattern is gone.
 *   - The Saturday host is a co-ed "together" session (coach sees both).
 *
 * Verified invariants:
 *   1. Each rotation round has exactly ONE practice drill. (No simultaneous practice)
 *   2. practice-mode drills appear only in rotation.practice, never in self_fill or both_self.
 *   3. self_fill drills are different drills from the paired practice drill.
 *   4. Both groups cover the full menu (coveredDrillIds = the day's full menu).
 *   5. shortfall_minutes>0 only when self drills are fewer minutes than practice drills.
 *   6. Saturday together: co-ed, coach sees both, original 3-mode classification preserved.
 *   7. shared_gym=false → empty list (single-column fallback).
 *   8. E2E: real catalog output has no rotation violations, covered ids match menu,
 *      exactly one together day, no practice-mode drills in self_fill/both_self anywhere.
 *   9. Display: rotation section and 実践/自走/入れ替え labels appear in formatPlan output.
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
  buildWeekdayRotation,
  buildSelfParallel,
  buildTogether,
  buildWeekdayGroups,
  findRotationViolations,
  coveredDrillIds,
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

/**
 * Build a one-block day with the given items (each {id, mode, minutes?}).
 * minutes defaults to 10. coachPresent defaults to true.
 */
function dayWith(dayLabel, items, coachPresent = true) {
  return {
    day: dayLabel,
    minutes: 200,
    court: '全面',
    coach_present: coachPresent,
    blocks: [
      {
        block: '技術',
        items: items.map((it) => ({
          drill_id: it.id,
          name: it.id,
          minutes: it.minutes ?? 10,
          category: 'C',
          intensity_class: '中',
          coaching_mode: it.mode,
          needs_coach: it.mode !== 'self',
        })),
      },
    ],
  };
}

/** Collect all drill_ids in a weekday rotation plan for a given "role" (practice/self_fill/both_self). */
function collectByRole(weekdayPlan, role) {
  const ids = [];
  for (const round of weekdayPlan.rounds) {
    if (round.kind === 'rotation') {
      if (role === 'practice') ids.push(round.practice.drill_id);
      if (role === 'self_fill') for (const sf of round.self_fill) ids.push(sf.drill_id);
    } else if (round.kind === 'both_self' && role === 'both_self') {
      for (const d of round.drills) ids.push(d.drill_id);
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------
// 1. Rotation: each practice paired with self_fill; no round has >1 practice
// ---------------------------------------------------------------------------

test('ローテーション: practiceドリルはself_fillバンドルと対になる。各ラウンドのpracticeは1本だけ', () => {
  const day = dayWith('火', [
    { id: 'P1', mode: 'practice' },
    { id: 'S1', mode: 'self' },
    { id: 'P2', mode: 'practice' },
    { id: 'S2', mode: 'self' },
    { id: 'S3', mode: 'self' },
  ]);
  const wd = buildWeekdayRotation(day, new Map(), DEFAULT_GROUPS);

  // Each rotation round has exactly 1 practice drill.
  const rotationRounds = wd.rounds.filter((r) => r.kind === 'rotation');
  assert.equal(rotationRounds.length, 2, 'practice 2本 → rotation 2ラウンド');
  for (const r of rotationRounds) {
    assert.ok(r.practice, 'rotation round に practice フィールドがある');
    assert.equal(r.practice.mode, 'practice', 'rotation.practice.mode === practice');
  }
});

// ---------------------------------------------------------------------------
// 2. No practice-mode drills in self_fill or both_self (core safety invariant)
// ---------------------------------------------------------------------------

test('不変条件: self_fill / both_self に practice-mode ドリルが入らない', () => {
  const day = dayWith('火', [
    { id: 'P1', mode: 'practice' },
    { id: 'P2', mode: 'practice' },
    { id: 'S1', mode: 'self' },
  ]);
  const wd = buildWeekdayRotation(day, new Map(), DEFAULT_GROUPS);
  assert.deepEqual(findRotationViolations(wd), [], '不変条件違反はゼロ');

  // self_fill に practice は絶対に現れない
  for (const r of wd.rounds) {
    if (r.kind === 'rotation') {
      for (const sf of r.self_fill) {
        assert.notEqual(sf.mode, 'practice', `self_fill に practice-mode ドリルが混入: ${sf.drill_id}`);
      }
    } else if (r.kind === 'both_self') {
      for (const d of r.drills) {
        assert.notEqual(d.mode, 'practice', `both_self に practice-mode ドリルが混入: ${d.drill_id}`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// 3. self_fill drills are different from their paired practice drill
// ---------------------------------------------------------------------------

test('空き側は practice と別ドリル（drill_id が self_fill に混入しない）', () => {
  const day = dayWith('火', [
    { id: 'P1', mode: 'practice' },
    { id: 'S1', mode: 'self' },
    { id: 'S2', mode: 'self' },
  ]);
  const wd = buildWeekdayRotation(day, new Map(), DEFAULT_GROUPS);
  for (const r of wd.rounds) {
    if (r.kind === 'rotation') {
      for (const sf of r.self_fill) {
        assert.notEqual(sf.drill_id, r.practice.drill_id, 'self_fill に practice と同一 drill_id が混入している');
      }
    }
  }
  assert.deepEqual(findRotationViolations(wd), []);
});

// ---------------------------------------------------------------------------
// 4. Coverage: coveredDrillIds = the day's full menu (both groups cover everything)
// ---------------------------------------------------------------------------

test('網羅: coveredDrillIds がその日の全ドリルと一致する', () => {
  const day = dayWith('火', [
    { id: 'P1', mode: 'practice' },
    { id: 'S1', mode: 'self' },
    { id: 'P2', mode: 'practice' },
    { id: 'S2', mode: 'self' },
    { id: 'S3', mode: 'self' },
  ]);
  const wd = buildWeekdayRotation(day, new Map(), DEFAULT_GROUPS);
  const covered = coveredDrillIds(wd);
  const allIds = ['P1', 'P2', 'S1', 'S2', 'S3'].sort();
  assert.deepEqual(covered, allIds, '全ドリルが covered に含まれる');
});

// ---------------------------------------------------------------------------
// 5. Synthetic: practice 2 + self 4 → rotation 2 + both_self 1, violations=[]
// ---------------------------------------------------------------------------

test('合成ケース: practice 2本 + self 4本 → rotation 2 + both_self 1、violations=[]', () => {
  // P1=10min, P2=10min; S1-S4 each 10min (total self=40 > practice=20)
  // Balance allocation (neediest bundle first): need=[10,10]
  //   S1 → bundle0 (need=[0,10]); S2 → bundle1 (need=[0,0])
  //   S3,S4 → all needs <=0 → leftover → both_self
  const day = dayWith('火', [
    { id: 'P1', mode: 'practice', minutes: 10 },
    { id: 'P2', mode: 'practice', minutes: 10 },
    { id: 'S1', mode: 'self', minutes: 10 },
    { id: 'S2', mode: 'self', minutes: 10 },
    { id: 'S3', mode: 'self', minutes: 10 },
    { id: 'S4', mode: 'self', minutes: 10 },
  ]);
  const wd = buildWeekdayRotation(day, new Map(), DEFAULT_GROUPS);

  const rotations = wd.rounds.filter((r) => r.kind === 'rotation');
  const bothSelfs = wd.rounds.filter((r) => r.kind === 'both_self');
  assert.equal(rotations.length, 2, 'rotation ラウンドが 2');
  assert.equal(bothSelfs.length, 1, 'both_self ラウンドが 1');
  // Every rotation bundle is non-empty (balance allocation, no starved bundle).
  for (const r of rotations) {
    assert.ok(r.self_fill.length > 0, '均し配分により自走0の rotation 束が出ない');
  }
  assert.deepEqual(findRotationViolations(wd), []);
  assert.equal(wd.shortfall_minutes, 0, '自走合計 >= 実践合計なので shortfall=0');
});

// ---------------------------------------------------------------------------
// 6. Edge: all-practice day → shortfall>0, practice never in self_fill/both_self
// ---------------------------------------------------------------------------

test('エッジ: 全ドリルが practice のとき → shortfall>0、practice が self_fill/both_self に絶対現れない', () => {
  const day = dayWith('火', [
    { id: 'P1', mode: 'practice' },
    { id: 'P2', mode: 'practice' },
    { id: 'P3', mode: 'practice' },
  ]);
  const wd = buildWeekdayRotation(day, new Map(), DEFAULT_GROUPS);

  // shortfall > 0 (自走ドリルがないため埋められない)
  assert.ok(wd.shortfall_minutes > 0, '全 practice 日は shortfall>0');

  // practice が self_fill や both_self に絶対現れない
  assert.deepEqual(findRotationViolations(wd), []);

  // buildWeekdayGroups 経由で warnings に出る
  const plan = {
    days: [day],
    saturday_lecture: null,
    warnings: [],
  };
  buildWeekdayGroups({ plan, drillIndex: new Map(), config: { shared_gym: true, groups: DEFAULT_GROUPS } });
  assert.ok(plan.warnings.some((w) => w.includes('火') && w.includes('自走ドリルが実践ドリルより')), '自走不足 warning が出る');
});

// ---------------------------------------------------------------------------
// 6b. Coach-absent day → self_parallel, no practice supervision at all
// ---------------------------------------------------------------------------

test('コーチ不在日: self_parallel になり「コーチ付き(実践)」監督ラウンドが一切無い', () => {
  // A coach-absent day with what would otherwise be practice-flagged items: the
  // self_parallel builder treats everything as 自走 (no coach to supervise).
  const day = dayWith('水', [
    { id: 'A1', mode: 'practice' },
    { id: 'A2', mode: 'self' },
    { id: 'A3', mode: 'practice' },
  ], false);

  const sp = buildSelfParallel(day, new Map(), DEFAULT_GROUPS);
  assert.equal(sp.kind, 'self_parallel', 'コーチ不在日は self_parallel');
  // Every drill runs as 自走 — there is no practice-mode (=コーチ付き) drill.
  for (const d of sp.drills) {
    assert.equal(d.mode, 'self', `不在日のドリルは全て自走: ${d.drill_id}`);
  }
  // The full menu is present (both groups run the same menu on their own).
  assert.deepEqual(sp.drills.map((d) => d.drill_id).sort(), ['A1', 'A2', 'A3'].sort());

  // Routed correctly through buildWeekdayGroups: a coach-absent day becomes
  // self_parallel (not a rotation), so no rotation/practice supervision exists,
  // and no shortfall warning is emitted for it.
  const plan = { days: [day], saturday_lecture: null, warnings: [] };
  const out = buildWeekdayGroups({ plan, drillIndex: new Map(), config: { shared_gym: true, groups: DEFAULT_GROUPS } });
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'self_parallel', '不在日は rotation ではなく self_parallel に振り分けられる');
  assert.equal(plan.warnings.length, 0, '不在日は rotation 対象外なので自走不足 warning は出ない');
});

// ---------------------------------------------------------------------------
// 6c. Coach-present day, T_self >= T_practice → all bundles non-empty, shortfall=0, no warning
// ---------------------------------------------------------------------------

test('在席日 T_self>=T_practice: 全 rotation 束が非空・shortfall=0・warning無し', () => {
  // T_practice = 10+10 = 20, T_self = 12+12+12 = 36 (>= 20)
  const day = dayWith('火', [
    { id: 'P1', mode: 'practice', minutes: 10 },
    { id: 'P2', mode: 'practice', minutes: 10 },
    { id: 'S1', mode: 'self', minutes: 12 },
    { id: 'S2', mode: 'self', minutes: 12 },
    { id: 'S3', mode: 'self', minutes: 12 },
  ]);
  const wd = buildWeekdayRotation(day, new Map(), DEFAULT_GROUPS);

  // Every rotation bundle is non-empty (no starved bundle).
  for (const r of wd.rounds) {
    if (r.kind === 'rotation') {
      assert.ok(r.self_fill.length > 0, `自走0に枯れた rotation 束が出ている (practice=${r.practice.drill_id})`);
    }
  }
  assert.equal(wd.shortfall_minutes, 0, 'T_self>=T_practice なので shortfall=0');

  const plan = { days: [day], saturday_lecture: null, warnings: [] };
  buildWeekdayGroups({ plan, drillIndex: new Map(), config: { shared_gym: true, groups: DEFAULT_GROUPS } });
  assert.equal(plan.warnings.length, 0, 'T_self>=T_practice なので warning は出ない');
});

// ---------------------------------------------------------------------------
// 6d. Coach-present day, T_practice > T_self → shortfall = global T_practice - T_self, warning出る
// ---------------------------------------------------------------------------

test('在席日 T_practice>T_self: shortfall_minutes が (T_practice - T_self) のグローバル真値・warning出る', () => {
  // T_practice = 20+20 = 40, T_self = 5+5 = 10 → shortfall = 30
  const day = dayWith('火', [
    { id: 'P1', mode: 'practice', minutes: 20 },
    { id: 'P2', mode: 'practice', minutes: 20 },
    { id: 'S1', mode: 'self', minutes: 5 },
    { id: 'S2', mode: 'self', minutes: 5 },
  ]);
  const wd = buildWeekdayRotation(day, new Map(), DEFAULT_GROUPS);
  assert.equal(wd.shortfall_minutes, 30, 'shortfall は (T_practice 40 - T_self 10) = 30 のグローバル真値');
  assert.deepEqual(findRotationViolations(wd), []);

  const plan = { days: [day], saturday_lecture: null, warnings: [] };
  buildWeekdayGroups({ plan, drillIndex: new Map(), config: { shared_gym: true, groups: DEFAULT_GROUPS } });
  assert.ok(
    plan.warnings.some((w) => w.includes('火') && w.includes('30') && w.includes('自走ドリルが実践ドリルより')),
    'shortfall 30分の自走不足 warning が出る（業務語＋曜日＋分数で拘束）',
  );
});

// ---------------------------------------------------------------------------
// 6e. shortfall is the GLOBAL figure, not a per-bundle leftover rollup
// ---------------------------------------------------------------------------

test('shortfall はグローバル真値: per束の残need積み上げと分岐するケースで検証', () => {
  // menu order: P1(30) S1(5) P2(10) S2(20). Pass A seeds bundle0←S1(5)→need0=25,
  // bundle1←S2(20)→need1=-10. A per-bundle "sum of leftover needs" would be 25, but
  // the real day-global shortfall is max(0, T_practice 40 - T_self 25) = 15.
  // Asserting 15 (not 25) proves shortfall is the day-global figure.
  const day = dayWith('火', [
    { id: 'P1', mode: 'practice', minutes: 30 },
    { id: 'S1', mode: 'self', minutes: 5 },
    { id: 'P2', mode: 'practice', minutes: 10 },
    { id: 'S2', mode: 'self', minutes: 20 },
  ]);
  const wd = buildWeekdayRotation(day, new Map(), DEFAULT_GROUPS);
  assert.equal(wd.shortfall_minutes, 15, 'shortfall は global(40-25=15)、per束積み上げ(25)ではない');
});

// ---------------------------------------------------------------------------
// 7. Saturday together: co-ed, coach sees both, 3-mode classification preserved
// ---------------------------------------------------------------------------

test('合同(土): コーチは両グループを同時に見る・ドリル本来の3分類が保たれる', () => {
  const day = dayWith('土', [
    { id: 'P1', mode: 'practice' },
    { id: 'S1', mode: 'self' },
    { id: 'L1', mode: 'lecture' },
  ]);
  const tg = buildTogether(day, new Map(), DEFAULT_GROUPS);
  assert.equal(tg.kind, 'together');
  assert.deepEqual(tg.shared.map((s) => s.engagement), ['practice', 'self', 'lecture']);
  assert.deepEqual(tg.groups, DEFAULT_GROUPS);
  // coach is true for practice and lecture (co-ed: coach watches both)
  assert.equal(tg.shared[0].coached, true, 'practice: coached=true');
  assert.equal(tg.shared[1].coached, false, 'self: coached=false');
  assert.equal(tg.shared[2].coached, true, 'lecture: coached=true');
});

// ---------------------------------------------------------------------------
// 8. shared_gym=false → empty list (single-column fallback)
// ---------------------------------------------------------------------------

test('shared_gym=false なら組違い表は作らない（単一列フォールバック）', () => {
  const plan = { days: [dayWith('火', [{ id: 'P1', mode: 'practice' }])], saturday_lecture: null, warnings: [] };
  const out = buildWeekdayGroups({ plan, drillIndex: new Map(), config: { shared_gym: false } });
  assert.deepEqual(out, [], 'shared_gym=false は空(=フォールバック)');
});

// ---------------------------------------------------------------------------
// 8. E2E against the real catalog
// ---------------------------------------------------------------------------

test('planWeek(catalog): 在席日rotation/不在日self_parallel/合同日1日に振り分け・violations=0・covered=メニュー・不在日は監督ゼロ・warning0件', async () => {
  const { drills, config, teamInput } = await load();
  const plan = planWeek(drills, config, teamInput);

  assert.ok(Array.isArray(plan.weekday_groups) && plan.weekday_groups.length > 0, '組違い表が生成される');

  let togetherDays = 0;
  let rotationDays = 0;
  let selfParallelDays = 0;

  for (const dp of plan.weekday_groups) {
    if (dp.kind === 'together') {
      togetherDays += 1;
      continue;
    }

    if (dp.kind === 'self_parallel') {
      selfParallelDays += 1;
      // No coach: every drill runs as 自走 — there is no practice supervision.
      for (const d of dp.drills) {
        assert.equal(d.mode, 'self', `不在日(${dp.day})に practice-mode (=コーチ付き) ドリルが残っている: ${d.drill_id}`);
      }
      continue;
    }

    // Coach-present rotation day
    rotationDays += 1;

    // rotation violations = 0
    assert.deepEqual(
      findRotationViolations(dp),
      [],
      `${dp.day} に rotation 不変条件違反がある`,
    );

    // No starved bundle: when this day has at least as many self drills as
    // practice drills, every rotation round must have a non-empty self_fill (the
    // off-group always has something to do). Locks the regression where the
    // greedy/overshoot allocation left a small bundle empty even on a feasible day.
    const rotationCount = dp.rounds.filter((r) => r.kind === 'rotation').length;
    const selfDrillCount =
      dp.rounds.reduce((s, r) => s + (r.kind === 'rotation' ? r.self_fill.length : 0), 0) +
      dp.rounds.reduce((s, r) => s + (r.kind === 'both_self' ? r.drills.length : 0), 0);
    if (selfDrillCount >= rotationCount) {
      for (const round of dp.rounds) {
        if (round.kind === 'rotation') {
          assert.ok(
            round.self_fill.length > 0,
            `${dp.day}: 自走本数(${selfDrillCount})>=実践本数(${rotationCount})なのに自走0に枯れた束がある (practice=${round.practice.drill_id})`,
          );
        }
      }
    }

    // covered drill ids = the day's full menu
    const planDay = plan.days.find((d) => d.day === dp.day);
    if (planDay) {
      const menuIds = planDay.blocks
        .flatMap((b) => b.items)
        .map((it) => it.drill_id)
        .sort()
        .filter((v, i, a) => a.indexOf(v) === i); // unique & sorted
      const covered = coveredDrillIds(dp);
      assert.deepEqual(covered, menuIds, `${dp.day} の coveredDrillIds がその日のメニューと不一致`);
    }

    // self_fill / both_self に practice-mode ドリルが絶対現れない（旧破綻の回帰ガード）
    for (const round of dp.rounds) {
      if (round.kind === 'rotation') {
        for (const sf of round.self_fill) {
          assert.notEqual(sf.mode, 'practice', `${dp.day} self_fill に practice-mode ドリル混入: ${sf.drill_id}`);
        }
      } else if (round.kind === 'both_self') {
        for (const d of round.drills) {
          assert.notEqual(d.mode, 'practice', `${dp.day} both_self に practice-mode ドリル混入: ${d.drill_id}`);
        }
      }
    }
  }

  assert.equal(togetherDays, 1, '土曜が1日だけ合同セッションになる');
  assert.ok(rotationDays > 0, '在席日(火金)が rotation に振り分けられる');
  assert.ok(selfParallelDays > 0, '不在日(水木)が self_parallel に振り分けられる');

  // 実機サンプルでは在席日は自走十分・不在日は rotation 対象外なので、組違いの自走不足
  // warning は1件も出ない。
  const rotationShortfallWarnings = (plan.warnings ?? []).filter((w) => w.includes('自走ドリルが実践ドリルより'));
  assert.deepEqual(rotationShortfallWarnings, [], '実機サンプルで組違いの自走不足 warning は0件');

  // Structural (format-independent) guard for the same fact: every coach-present
  // rotation day in the real sample has zero real shortfall. Unlike the string
  // filter above, this survives any change to the warning wording.
  const rotationShortfalls = plan.weekday_groups
    .filter((dp) => dp.kind === 'weekday')
    .map((dp) => dp.shortfall_minutes);
  assert.ok(
    rotationShortfalls.length > 0 && rotationShortfalls.every((s) => s === 0),
    `実機サンプルの在席日 shortfall_minutes は全て0であるべき: ${rotationShortfalls}`,
  );
});

// ---------------------------------------------------------------------------
// 9. Display: rotation section and labels appear in formatPlan output
// ---------------------------------------------------------------------------

test('表示(③): formatPlan 出力に組違いセクション・実践/自走ラベル・入れ替えの文言が出る', async () => {
  const { drills, config, teamInput } = await load();
  const plan = planWeek(drills, config, teamInput);
  const text = formatPlan(plan);

  // 組違いセクション
  assert.match(text, /組違い週次表/, '組違い週次表セクションが描画される');
  // 実践ラベル
  assert.match(text, /コーチ付き\(実践\)/, 'コーチ付き(実践)ラベルが出る');
  // 自走ラベル
  assert.match(text, /自走/, '自走ラベルが出る');
  // 入れ替え文言
  assert.match(text, /入れ替え/, '入れ替えの文言が出る');
  // 旧「▶グループ」方式の2列表示は消えている（列方式の旧マーカーで両グループが並ぶ形式が消えた証跡）
  // 新形式: ▶ コーチ付き(実践): ...
  assert.match(text, /▶ コーチ付き/, '新ローテーション形式の描画が確認できる');

  // コーチ不在日(水木)は self_parallel ヘッダで描画され、「コーチ付き(実践)」が付かない
  assert.match(text, /コーチ不在 \/ 男女とも同一メニューを各自で自走/, '不在日は self_parallel ヘッダで描画される');

  // 既習レクチャが平日に出てもレクチャ表示にならない（3分類タグが適切に反映される）
  assert.match(text, /自走|実践/, '平日ドリルに3分類ラベルが出る');
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
