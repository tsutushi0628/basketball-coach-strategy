/**
 * @file Tests for the coach-context classification (`needsCoach`).
 *
 * Each test asserts a coaching decision ("does this drill need a coach's eye?"),
 * not the regex/branch mechanics. The owner's four anchor examples
 * (マイカン=自走 / Tポイント系シュート=自走 / 対人=要コーチ / 人付きレイアップ=要コーチ)
 * are pinned first so a future rule change that breaks them fails loudly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { normalizeDrill, normalizeDrills } from '../src/normalize.js';
import { needsCoach, needsCoachReason } from '../src/filter.js';
import { createLocalStorage } from '../src/storage.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const DRILLS_PATH = resolve(repoRoot, 'docs/practice-knowledge/data/drills.json');

/** Build a normalized drill with sensible defaults; override any field. */
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
// Owner's four anchor examples
// ---------------------------------------------------------------------------

test('owner例: マイカンドリルは自走（孤立反復のゴール下フィニッシュ）', () => {
  const mikan = drill({
    name: 'マイカンドリル',
    category: 'フィニッシュ(ゴール下/レイアップ)',
    sub_skill: 'ゴール下連続・両手フィニッシュ',
    mastery_stage: '反復',
  });
  assert.equal(needsCoach(mikan), false);
});

test('owner例: Tポイントシュートは自走（規定スポットからの反復シュート）', () => {
  const tpoint = drill({
    name: 'Tポイントシュート',
    category: 'シュート',
    sub_skill: '規定スポットからの安定射出',
    mastery_stage: '反復',
  });
  assert.equal(needsCoach(tpoint), false);
});

test('owner例: 1on1（対人）は要コーチ（攻防のリードに指導者の目が要る）', () => {
  const oneOnOne = drill({
    name: '1on1（ドリブル有/無・パス無）',
    category: '1on1',
    sub_skill: '個の攻防・1対1判断',
    mastery_stage: '実戦化',
  });
  assert.equal(needsCoach(oneOnOne), true);
});

test('owner例: 人付きレイアップは要コーチ（守備を付けたフィニッシュ）', () => {
  // フィニッシュ category alone would be 自走, but a live defender ("人付き"/
  // ディフェンス) makes it contact work that needs coaching.
  const guarded = drill({
    name: '人付きレイアップ',
    category: 'フィニッシュ(ゴール下/レイアップ)',
    sub_skill: 'ディフェンスを背負ったフィニッシュ',
    mastery_stage: '反復',
  });
  assert.equal(needsCoach(guarded), true);
});

// ---------------------------------------------------------------------------
// Rule branches (business intent, not regex)
// ---------------------------------------------------------------------------

test('対人・戦術カテゴリは習熟段階に関わらず要コーチ', () => {
  for (const category of [
    '1on1',
    'チームディフェンス(オールコートマンツー/ヘルプ/帰陣)',
    'チームオフェンス(アーリー/トランジション)',
    '意思決定/ゲーム形式',
  ]) {
    // even a settled (実戦化) tactical drill still needs a coach
    assert.equal(
      needsCoach(drill({ category, mastery_stage: '実戦化', name: 'X', sub_skill: '' })),
      true,
      `${category} は要コーチであるべき`,
    );
  }
});

test('新規習得段階のドリルは（孤立スキルでも）要コーチ', () => {
  // A shooting drill is normally 自走, but while it is being newly acquired the
  // coach must build the rep. Compound transitions starting with 習得 also count.
  for (const stage of ['習得', '習得→反復', '習得→実戦化']) {
    assert.equal(
      needsCoach(drill({ category: 'シュート', name: 'フォームシュート', mastery_stage: stage })),
      true,
      `習熟「${stage}」は要コーチであるべき`,
    );
  }
  // ...but a settled transition that does not start with 習得 is self-runnable.
  assert.equal(
    needsCoach(drill({ category: 'シュート', name: 'フォームシュート', mastery_stage: '反復→実戦化' })),
    false,
  );
});

test('守備/ライブ/クローズアウト等のキーワードは孤立カテゴリでも要コーチ', () => {
  for (const sub of ['ライブ1対1', 'クローズアウト守備', 'マッチアップ', '2on2の合わせ']) {
    assert.equal(
      needsCoach(drill({ category: 'ハンドリング/ドリブル', name: 'ドリル', sub_skill: sub, mastery_stage: '反復' })),
      true,
      `「${sub}」は要コーチであるべき`,
    );
  }
});

test('孤立反復の基礎スキルは自走（フォーム・ハンドリング・フットワーク・整理運動）', () => {
  const selfRun = [
    { category: 'シュート', name: 'フォームシュート', sub_skill: '射出フォーム' },
    { category: 'ハンドリング/ドリブル', name: 'ストーショナリーハンドリング', sub_skill: '指先コントロール' },
    { category: 'フットワーク/アジリティ/ピボット', name: 'ラダー', sub_skill: '足運び' },
    { category: 'コンディショニング/ウォームアップ', name: '股関節ストレッチ', sub_skill: '可動域' },
  ];
  for (const o of selfRun) {
    assert.equal(needsCoach(drill({ ...o, mastery_stage: '反復' })), false, `${o.name} は自走であるべき`);
  }
});

// ---------------------------------------------------------------------------
// Override
// ---------------------------------------------------------------------------

test('override: レコードの needs_coach がルールより優先される（両方向）', () => {
  // A tactical category would derive 要コーチ, but an explicit false flips it to 自走.
  const forcedSelf = drill({ category: '1on1', name: '簡易1on1', mastery_stage: '実戦化', needs_coach: false });
  assert.equal(needsCoach(forcedSelf), false);

  // A plain fundamentals drill would derive 自走, but an explicit true flips it to 要コーチ.
  const forcedCoach = drill({ category: 'シュート', name: 'フォームシュート', mastery_stage: '反復', needs_coach: true });
  assert.equal(needsCoach(forcedCoach), true);

  // The reason string reflects the override path.
  assert.match(needsCoachReason(forcedSelf).reason, /override/);
});

// ---------------------------------------------------------------------------
// Reason precedence + whole-catalog sanity
// ---------------------------------------------------------------------------

test('needsCoachReason: 理由は判定と常に一致する', () => {
  const cases = [
    drill({ category: '1on1', mastery_stage: '実戦化' }),
    drill({ category: 'シュート', mastery_stage: '習得' }),
    drill({ category: 'シュート', name: 'ライブ', mastery_stage: '反復' }),
    drill({ category: 'シュート', name: 'フォーム', mastery_stage: '反復' }),
    drill({ category: '1on1', mastery_stage: '実戦化', needs_coach: false }),
  ];
  for (const d of cases) {
    assert.equal(needsCoachReason(d).needs_coach, needsCoach(d));
  }
});

test('catalog全件: 全ドリルが要コーチ/自走のいずれかに分類され、両クラスが存在する', async () => {
  const storage = createLocalStorage({
    drillsPath: DRILLS_PATH,
    configPath: resolve(__dirname, '..', 'data/config.sample.json'),
    inputPath: resolve(__dirname, '..', 'data/team-input.sample.json'),
  });
  const drills = normalizeDrills(await storage.getDrills());
  assert.equal(drills.length, 211, 'catalog should hold all 211 drills');

  const verdicts = drills.map((d) => needsCoach(d));
  // every verdict is a real boolean (no undefined leaking through)
  assert.ok(verdicts.every((v) => typeof v === 'boolean'));
  // both classes are represented (the rule is not degenerate)
  assert.ok(verdicts.some((v) => v === true), '要コーチが少なくとも1件');
  assert.ok(verdicts.some((v) => v === false), '自走が少なくとも1件');

  // every tactical-category drill is 要コーチ regardless of mastery
  const TACTICAL = new Set([
    '1on1',
    'チームディフェンス(オールコートマンツー/ヘルプ/帰陣)',
    'チームオフェンス(アーリー/トランジション)',
    '意思決定/ゲーム形式',
  ]);
  for (const d of drills) {
    if (TACTICAL.has(d.category)) {
      assert.equal(needsCoach(d), true, `${d.id} ${d.name} (${d.category}) は要コーチであるべき`);
    }
  }
});
