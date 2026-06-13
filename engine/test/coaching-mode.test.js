/**
 * @file Tests for the three-way coaching mode (`coachingMode`): 自走/実践/レクチャ.
 *
 * Each test asserts a coaching decision ("how does the coach engage with this
 * drill?"), not the regex/branch mechanics. The owner's anchor examples
 * (マイカン=自走 / 1on1=実践 / フォームシューティング等の新規習得非対人=レクチャ /
 * ビアー=要コーチ) are pinned first against the real catalog so a future rule
 * change that breaks them fails loudly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { normalizeDrill, normalizeDrills } from '../src/normalize.js';
import { coachingMode, coachingModeReason, needsCoach } from '../src/filter.js';
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

/** Load the real catalog indexed by id. */
async function loadCatalogById() {
  const storage = createLocalStorage({
    drillsPath: DRILLS_PATH,
    configPath: resolve(__dirname, '..', 'data/config.sample.json'),
    inputPath: resolve(__dirname, '..', 'data/team-input.sample.json'),
  });
  const drills = normalizeDrills(await storage.getDrills());
  return new Map(drills.map((d) => [d.id, d]));
}

// ---------------------------------------------------------------------------
// Owner's anchor examples — against the REAL catalog records
// ---------------------------------------------------------------------------

test('owner例(catalog): マイカンドリルは自走（孤立反復のゴール下フィニッシュ）', async () => {
  const byId = await loadCatalogById();
  for (const id of ['FIN-001', 'FIN-015']) {
    assert.equal(coachingMode(byId.get(id)), 'self', `${id} は自走であるべき`);
  }
});

test('owner例(catalog): 1on1（対人）は実践（攻防のリードを指導者が見る）', async () => {
  const byId = await loadCatalogById();
  for (const id of ['ONE-001', 'ONE-005']) {
    assert.equal(coachingMode(byId.get(id)), 'practice', `${id} は実践であるべき`);
  }
});

test('owner例(catalog): フォームシューティング/パワーレイアップ/ユーロステップはレクチャ（新規習得・非対人）', async () => {
  const byId = await loadCatalogById();
  for (const id of ['SHT-003', 'SHT-004', 'FIN-002', 'FIN-012']) {
    assert.equal(coachingMode(byId.get(id)), 'lecture', `${id} はレクチャであるべき`);
  }
});

test('owner例(catalog): ビアーフィニッシュ(FIN-011)は要コーチ（override で needs_coach=true）', async () => {
  const byId = await loadCatalogById();
  const beer = byId.get('FIN-011');
  // The override makes it 要コーチ (not 自走 — which the bare rule would derive,
  // since "接触下" is not a live/matchup keyword). Mode follows the rule on top
  // of that: a non-contact finish skill ⇒ lecture.
  assert.equal(needsCoach(beer), true, 'ビアーは要コーチであるべき');
  assert.notEqual(coachingMode(beer), 'self', 'ビアーは自走であってはならない');
});

// ---------------------------------------------------------------------------
// Mode-branch business intent (synthetic, not regex)
// ---------------------------------------------------------------------------

test('自走: 要コーチでないドリルは常に self', () => {
  assert.equal(coachingMode(drill({ category: 'シュート', name: 'フォーム反復', mastery_stage: '反復' })), 'self');
  assert.equal(coachingMode(drill({ category: 'ハンドリング/ドリブル', name: 'ドリブル', mastery_stage: '実戦化' })), 'self');
});

test('実践: 対人・戦術カテゴリの要コーチドリルは practice（習熟段階に依らず）', () => {
  for (const category of [
    '1on1',
    'チームディフェンス(オールコートマンツー/ヘルプ/帰陣)',
    'チームオフェンス(アーリー/トランジション)',
    '意思決定/ゲーム形式',
  ]) {
    assert.equal(coachingMode(drill({ category, mastery_stage: '実戦化' })), 'practice', `${category} は実践`);
  }
});

test('実践: 守備/ライブ/人付き等のキーワードを持つ要コーチドリルは practice', () => {
  for (const sub of ['ライブ1対1', 'クローズアウト守備', '人付きフィニッシュ', '2on2の合わせ']) {
    assert.equal(
      coachingMode(drill({ category: 'フィニッシュ(ゴール下/レイアップ)', name: 'レイアップ', sub_skill: sub, mastery_stage: '反復' })),
      'practice',
      `「${sub}」は実践`,
    );
  }
});

test('レクチャ: 新規習得の非対人スキルは lecture（教えて導入する対象）', () => {
  // 習得 → 要コーチ。対人/ライブ語が無い非対人なので practice ではなく lecture。
  for (const stage of ['習得', '習得→反復', '習得→実戦化']) {
    assert.equal(
      coachingMode(drill({ category: 'シュート', name: 'フォームシューティング', sub_skill: 'フォーム', mastery_stage: stage })),
      'lecture',
      `習熟「${stage}」の非対人スキルはレクチャ`,
    );
  }
});

test('境界: 新規習得でも対人キーワードがあれば実践（レクチャに落ちない）', () => {
  // 新規習得だが「人付き」なので live/contact ⇒ practice。
  assert.equal(
    coachingMode(drill({ category: 'フィニッシュ(ゴール下/レイアップ)', name: '人付きレイアップ', sub_skill: 'ディフェンスを背負った習得', mastery_stage: '習得' })),
    'practice',
  );
});

// ---------------------------------------------------------------------------
// Overrides
// ---------------------------------------------------------------------------

test('override: needs_coach=false は self に倒す（mode 派生より優先）', () => {
  // 1on1 は本来 practice だが、needs_coach=false override で要コーチ自体が消えるので self。
  assert.equal(coachingMode(drill({ category: '1on1', mastery_stage: '実戦化', needs_coach: false })), 'self');
});

test('override: coaching_mode 指定は派生より優先（両方向）', () => {
  // 本来 self のドリルを lecture に手動上書き。
  assert.equal(coachingMode(drill({ category: 'シュート', mastery_stage: '反復', coaching_mode: 'lecture' })), 'lecture');
  // 本来 practice の 1on1 を self に手動上書き。
  assert.equal(coachingMode(drill({ category: '1on1', mastery_stage: '実戦化', coaching_mode: 'self' })), 'self');
  // 理由文に override 経路が反映される。
  assert.match(coachingModeReason(drill({ coaching_mode: 'practice' })).reason, /override/);
});

// ---------------------------------------------------------------------------
// Reason consistency + whole-catalog sanity
// ---------------------------------------------------------------------------

test('coachingModeReason: 理由は判定と常に一致する', () => {
  const cases = [
    drill({ category: '1on1', mastery_stage: '実戦化' }),
    drill({ category: 'シュート', mastery_stage: '習得' }),
    drill({ category: 'フィニッシュ(ゴール下/レイアップ)', name: 'レイアップ', sub_skill: 'ライブ', mastery_stage: '反復' }),
    drill({ category: 'シュート', mastery_stage: '反復' }),
    drill({ coaching_mode: 'lecture' }),
  ];
  for (const d of cases) assert.equal(coachingModeReason(d).mode, coachingMode(d));
});

test('catalog全件: 全ドリルが3分類のいずれかに入り、3クラスとも非空', async () => {
  const byId = await loadCatalogById();
  const drills = [...byId.values()];
  assert.equal(drills.length, 215, 'catalog は215件（クールダウンジョグ CND-029 を追加）');

  const modes = drills.map((d) => coachingMode(d));
  assert.ok(modes.every((m) => m === 'self' || m === 'practice' || m === 'lecture'));
  assert.ok(modes.some((m) => m === 'self'), '自走が1件以上');
  assert.ok(modes.some((m) => m === 'practice'), '実践が1件以上');
  assert.ok(modes.some((m) => m === 'lecture'), 'レクチャが1件以上');

  // self ⇔ not needsCoach は厳密に一致（mode は needsCoach の上に載るので）。
  for (const d of drills) {
    assert.equal(coachingMode(d) === 'self', !needsCoach(d), `${d.id} self判定が要コーチ判定と矛盾`);
  }
});
