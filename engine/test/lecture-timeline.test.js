/**
 * @file Tests for the lecture-mode time-series fix (spec ①).
 *
 * Business intent (not regex mechanics): a NEW lecture-mode drill is one the team
 * has not been taught yet, so the correct chronology is "introduce on Saturday,
 * THEN repeat on weekdays". Concretely:
 *   - while a lecture drill is NOT in `introduced`, it must NOT appear in any
 *     weekday (火水木金) practice — it only surfaces in the Saturday lecture;
 *   - once it lands in `introduced` (next week's input), it is allowed onto
 *     weekday practice as repetition (self-run);
 *   - the same week never both introduces a drill on Saturday AND drills it on a
 *     weekday (no "taught and practiced before taught" double-listing);
 *   - practice-mode (live contact) drills are unaffected — they belong on
 *     weekdays under the coach regardless of the introduced roster.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { createLocalStorage } from '../src/storage.js';
import { normalizeDrill, normalizeDrills } from '../src/normalize.js';
import { planWeek } from '../src/planWeek.js';
import { coachingMode, isNewLecture, filterPoolForDay } from '../src/filter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const engineRoot = resolve(__dirname, '..');
const repoRoot = resolve(engineRoot, '..');

const WEEKDAYS = new Set(['火', '水', '木', '金']);

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

/** Build a normalized drill; override any field. */
function drill(over) {
  return normalizeDrill({
    id: 'X',
    name: 'd',
    category: 'シュート',
    sub_skill: '',
    court: '不問',
    grades: '全',
    intensity_class: '中',
    mastery_stage: '反復',
    ...over,
  });
}

// ---------------------------------------------------------------------------
// isNewLecture predicate — the time-series gate's business meaning
// ---------------------------------------------------------------------------

test('isNewLecture: 未習のレクチャ型のみ true（実践/自走/既習は対象外）', () => {
  const newLecture = drill({ id: 'L1', category: 'シュート', name: 'フォームシューティング', sub_skill: 'フォーム', mastery_stage: '習得' });
  const practice = drill({ id: 'P1', category: '1on1', mastery_stage: '実戦化' });
  const self = drill({ id: 'S1', category: 'シュート', mastery_stage: '反復' });

  // sanity on the modes
  assert.equal(coachingMode(newLecture), 'lecture');
  assert.equal(coachingMode(practice), 'practice');
  assert.equal(coachingMode(self), 'self');

  assert.equal(isNewLecture(newLecture, []), true, '未習レクチャは新規導入対象');
  assert.equal(isNewLecture(newLecture, ['L1']), false, '既習レクチャは新規導入対象でない');
  assert.equal(isNewLecture(practice, []), false, '実践は平日から外さない');
  assert.equal(isNewLecture(self, []), false, '自走は平日から外さない');
});

test('filterPoolForDay: 平日プールは未習レクチャを除外、既習に入れると残る', () => {
  const newLecture = drill({ id: 'L1', category: 'シュート', name: 'フォームシューティング', sub_skill: 'フォーム', mastery_stage: '習得' });
  const self = drill({ id: 'S1', category: 'シュート', name: 'フォーム反復', mastery_stage: '反復' });
  const config = { grades: [], category: '中学', philosophy: {} };

  const weekday = filterPoolForDay([newLecture, self], config, '全面', { excludeNewLecture: true, introduced: [] });
  assert.ok(!weekday.some((d) => d.id === 'L1'), '未習レクチャは平日プールから外れる');
  assert.ok(weekday.some((d) => d.id === 'S1'), '自走は平日プールに残る');

  const afterIntro = filterPoolForDay([newLecture, self], config, '全面', { excludeNewLecture: true, introduced: ['L1'] });
  assert.ok(afterIntro.some((d) => d.id === 'L1'), '既習になれば平日プールに戻る');

  // The Saturday host (excludeNewLecture:false) keeps it so it can be introduced.
  const host = filterPoolForDay([newLecture, self], config, '全面', { excludeNewLecture: false, introduced: [] });
  assert.ok(host.some((d) => d.id === 'L1'), '土曜ホストは未習レクチャを残す(導入のため)');
});

// ---------------------------------------------------------------------------
// End-to-end against the real catalog — the owner's two verification steps
// ---------------------------------------------------------------------------

test('planWeek(catalog): 既習空だと新規レクチャ型は平日に1件も出ず、土曜にのみ並ぶ', async () => {
  const { drills, config, teamInput } = await load();
  const byId = new Map(drills.map((d) => [d.id, d]));
  const plan = planWeek(drills, { ...config, introduced: [] }, teamInput);

  // No lecture-mode drill appears on any weekday this week.
  const weekdayLecture = [];
  for (const day of plan.days) {
    if (!WEEKDAYS.has(day.day)) continue;
    for (const it of day.blocks.flatMap((b) => b.items)) {
      const d = byId.get(it.drill_id);
      if (d && coachingMode(d) === 'lecture') weekdayLecture.push(`${day.day}:${it.name}`);
    }
  }
  assert.deepEqual(weekdayLecture, [], '平日(火水木金)にレクチャ型ドリルは出ない');

  // They are introduced on Saturday instead.
  assert.ok(plan.saturday_lecture, '土曜レクチャが生成される');
  assert.ok(plan.saturday_lecture.items.length > 0, '既習空なら新規導入が1件以上');

  // No drill is both introduced on Saturday AND placed in a weekday this week.
  const introIds = new Set(plan.saturday_lecture.items.map((i) => i.drill_id));
  for (const day of plan.days) {
    if (!WEEKDAYS.has(day.day)) continue;
    for (const it of day.blocks.flatMap((b) => b.items)) {
      assert.ok(!introIds.has(it.drill_id), `今週導入の ${it.name} が平日に二重掲載されている`);
    }
  }
});

test('planWeek(catalog): 導入済みを次週入力にすると当該ドリルが平日に自走で出る', async () => {
  const { drills, config, teamInput } = await load();
  const byId = new Map(drills.map((d) => [d.id, d]));

  const week1 = planWeek(drills, { ...config, introduced: [] }, teamInput);
  const introIds = week1.saturday_lecture.items.map((i) => i.drill_id);
  assert.ok(introIds.length > 0, '前提: 週1で新規導入がある');

  const week2 = planWeek(drills, { ...config, introduced: week1.introduced }, teamInput);

  // At least one of last week's intros now appears on a weekday (as repetition).
  const onWeekday = [];
  for (const day of week2.days) {
    if (!WEEKDAYS.has(day.day)) continue;
    for (const it of day.blocks.flatMap((b) => b.items)) {
      if (introIds.includes(it.drill_id)) onWeekday.push(it.drill_id);
    }
  }
  assert.ok(onWeekday.length > 0, '週1で導入したレクチャ型が週2には平日に反復で出る');

  // In the cross-paired weekday view those introduced drills read as 自走
  // (already taught = repetition), never レクチャ on a weekday.
  for (const dp of week2.weekday_groups) {
    if (dp.kind !== 'weekday') continue;
    for (const g of Object.keys(dp.columns)) {
      for (const s of dp.columns[g]) {
        assert.notEqual(s.engagement, 'lecture', `平日(${dp.day})の${g}列にレクチャ表示が残っている: ${s.name}`);
      }
    }
  }

  // And none of them are re-introduced on week 2's Saturday.
  const week2NewIds = new Set(week2.saturday_lecture.items.map((i) => i.drill_id));
  for (const id of introIds) {
    assert.ok(!week2NewIds.has(id), `既習 ${id} が週2の土レクチャに再掲されている`);
  }
});
