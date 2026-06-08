/**
 * @file Tests for the mixed-gender Saturday new-drill lecture (spec).
 *
 * Asserts the coaching contract, not implementation mechanics:
 *  - new (not-yet-introduced) lecture-mode drills are batched onto Saturday
 *    (the coach-present longest day) and added to the introduced roster;
 *  - already-introduced lecture drills are NOT re-lectured;
 *  - practice-mode / self-mode drills never appear in the lecture;
 *  - feeding the returned introduced roster back yields no new intros.
 *
 * Uses both synthetic plans (for tight branch control) and the real 211-drill
 * catalog end-to-end (for the integration contract).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { createLocalStorage } from '../src/storage.js';
import { normalizeDrills } from '../src/normalize.js';
import { planWeek } from '../src/planWeek.js';
import { coachingMode } from '../src/filter.js';
import {
  buildSaturdayLecture,
  pickLectureDay,
  collectLectureDrills,
} from '../src/lecture.js';

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

// ---------------------------------------------------------------------------
// Synthetic-plan unit tests (tight control over which modes appear)
// ---------------------------------------------------------------------------

/** Minimal normalized-ish drill for the index (only fields lecture.js reads). */
function idx(records) {
  return new Map(records.map((r) => [r.id, r]));
}

/** A plan with one block on each named day carrying the given drill ids. */
function planWithDays(days) {
  return {
    days: days.map((d) => ({
      day: d.day,
      minutes: d.minutes,
      coach_present: d.coach_present !== false,
      blocks: [{ block: '技術', items: d.ids.map((id) => ({ drill_id: id, name: id, category: 'C' })) }],
    })),
  };
}

test('レクチャ日選択: コーチ在席の最長枠（=土）が選ばれる', () => {
  const days = [
    { day: '火', minutes: 100, coach_present: true },
    { day: '水', minutes: 100, coach_present: false },
    { day: '土', minutes: 165, coach_present: true },
  ];
  assert.equal(pickLectureDay(days).day, '土');
});

test('レクチャ日選択: コーチ在席日が無ければ null（不在日にレクチャは置けない）', () => {
  const days = [
    { day: '水', minutes: 100, coach_present: false },
    { day: '木', minutes: 100, coach_present: false },
  ];
  assert.equal(pickLectureDay(days), null);
});

test('収集: レクチャ型のみ拾い、実践/自走は拾わない（重複IDは1回）', () => {
  const index = idx([
    { id: 'L1', name: 'L1', category: 'シュート', mastery_stage: '習得', sub_skill: 'フォーム' }, // lecture
    { id: 'P1', name: 'P1', category: '1on1', mastery_stage: '実戦化', sub_skill: '' }, // practice
    { id: 'S1', name: 'S1', category: 'シュート', mastery_stage: '反復', sub_skill: '' }, // self
  ]);
  // sanity: confirm the synthetic records classify as intended
  assert.equal(coachingMode(index.get('L1')), 'lecture');
  assert.equal(coachingMode(index.get('P1')), 'practice');
  assert.equal(coachingMode(index.get('S1')), 'self');

  const plan = planWithDays([
    { day: '火', minutes: 100, ids: ['L1', 'P1', 'S1'] },
    { day: '土', minutes: 165, ids: ['L1'] }, // L1 again → dedup
  ]);
  const got = collectLectureDrills(plan, index).map((d) => d.drill_id);
  assert.deepEqual(got, ['L1'], 'レクチャ型 L1 のみ・重複なし');
});

test('新規レクチャ: 既習(introduced)に無いレクチャ型が土に並び、introducedが更新される', () => {
  const index = idx([
    { id: 'L1', name: 'フォームシューティング', category: 'シュート', mastery_stage: '習得', sub_skill: 'フォーム' },
    { id: 'L2', name: 'パワーレイアップ', category: 'フィニッシュ(ゴール下/レイアップ)', mastery_stage: '習得', sub_skill: '両足' },
  ]);
  const plan = planWithDays([
    { day: '火', minutes: 100, ids: ['L1'] },
    { day: '土', minutes: 165, ids: ['L2'] },
  ]);
  const { saturdayLecture, introduced } = buildSaturdayLecture({ plan, drillIndex: index, introduced: [] });
  assert.equal(saturdayLecture.day, '土');
  assert.deepEqual(saturdayLecture.items.map((i) => i.drill_id), ['L1', 'L2']);
  assert.deepEqual(introduced, ['L1', 'L2'], 'introduced は配置IDを追加して返す');
});

test('既習除外: introduced に有るレクチャ型は土に出ない（週内は反復扱い）', () => {
  const index = idx([
    { id: 'L1', name: 'L1', category: 'シュート', mastery_stage: '習得', sub_skill: 'フォーム' },
    { id: 'L2', name: 'L2', category: 'シュート', mastery_stage: '習得', sub_skill: 'フォーム' },
  ]);
  const plan = planWithDays([{ day: '土', minutes: 165, ids: ['L1', 'L2'] }]);
  const { saturdayLecture, introduced } = buildSaturdayLecture({ plan, drillIndex: index, introduced: ['L1'] });
  assert.deepEqual(saturdayLecture.items.map((i) => i.drill_id), ['L2'], '既習 L1 は土レクチャに出ない');
  assert.deepEqual(introduced, ['L1', 'L2'], '既習 L1 を保ったまま L2 を追加');
});

test('在席日なし: 土レクチャは null・introduced は据え置き（未習のまま）', () => {
  const index = idx([{ id: 'L1', name: 'L1', category: 'シュート', mastery_stage: '習得', sub_skill: 'フォーム' }]);
  const plan = planWithDays([
    { day: '水', minutes: 100, ids: ['L1'], coach_present: false },
    { day: '木', minutes: 100, ids: ['L1'], coach_present: false },
  ]);
  const { saturdayLecture, introduced } = buildSaturdayLecture({ plan, drillIndex: index, introduced: [] });
  assert.equal(saturdayLecture, null);
  assert.deepEqual(introduced, [], '在席日が無いので何も導入されない');
});

// ---------------------------------------------------------------------------
// End-to-end against the real catalog
// ---------------------------------------------------------------------------

test('planWeek(catalog): 土曜に新規レクチャが並び、全項目がレクチャ型・未習', async () => {
  const { drills, config, teamInput } = await load();
  const byId = new Map(drills.map((d) => [d.id, d]));
  const plan = planWeek(drills, config, teamInput);

  assert.ok(plan.saturday_lecture, '土レクチャが生成される（在席最長日=土）');
  assert.equal(plan.saturday_lecture.day, '土');
  assert.ok(plan.saturday_lecture.items.length > 0, '既習空なら新規レクチャが1件以上');

  for (const it of plan.saturday_lecture.items) {
    const d = byId.get(it.drill_id);
    assert.ok(d, `${it.drill_id} がカタログに存在`);
    assert.equal(coachingMode(d), 'lecture', `${it.name} はレクチャ型のみ（実践/自走は不可）`);
  }
  // updated introduced は今週の新規導入IDを含む
  for (const it of plan.saturday_lecture.items) {
    assert.ok(plan.introduced.includes(it.drill_id), `${it.drill_id} が introduced に追加される`);
  }
});

test('planWeek(catalog): 既習を渡すと当該ドリルは土レクチャから消える', async () => {
  const { drills, config, teamInput } = await load();
  const week1 = planWeek(drills, config, teamInput);
  const introducedIds = week1.saturday_lecture.items.map((i) => i.drill_id);
  assert.ok(introducedIds.length > 0, '前提: 週1で新規導入がある');

  // 週2: 週1の introduced を渡す
  const week2 = planWeek(drills, { ...config, introduced: week1.introduced }, teamInput);
  const week2Ids = new Set(week2.saturday_lecture.items.map((i) => i.drill_id));
  for (const id of introducedIds) {
    assert.ok(!week2Ids.has(id), `既習 ${id} は週2の土レクチャに再掲されない`);
  }
});

test('planWeek(catalog): ビアー(FIN-011)は要コーチ。週内に出れば土レクチャ対象（自走で漏れない）', async () => {
  const { drills, config, teamInput } = await load();
  const byId = new Map(drills.map((d) => [d.id, d]));
  const beer = byId.get('FIN-011');
  assert.equal(beer.needs_coach, true, 'override で needs_coach=true');
  assert.notEqual(coachingMode(beer), 'self', 'ビアーは自走に分類されない');

  const plan = planWeek(drills, config, teamInput);
  const appearsInWeek = plan.days.some((day) =>
    day.blocks.some((b) => b.items.some((it) => it.drill_id === 'FIN-011')),
  );
  if (appearsInWeek) {
    assert.ok(
      plan.saturday_lecture.items.some((i) => i.drill_id === 'FIN-011'),
      'ビアーが週内に出るならレクチャ型として土に並ぶ',
    );
  }
});
