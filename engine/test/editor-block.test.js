/**
 * @file Tests for the editor's 7-block mapping (editorBlockOf) and the editor candidate buckets.
 *
 * Business intent verified (NOT the regex/branch mechanics):
 *   (a) Every drill in the real catalog is routed to exactly ONE of the 7 editor blocks —
 *       no drill is lost (取りこぼし) and none lands in two buckets (二重所属); the bucket
 *       sizes sum to the total drill count.
 *   (b) Finishing (フィニッシュ・ゴール下/レイアップ) splits by mastery — acquisition (習得) reps
 *       become fundamentals (ファンダ), settled (反復/実戦化) reps become shooting (シュート) — and
 *       BOTH buckets are non-empty. This is inherited from blockOf, so a change to blockOf's
 *       finishing routing breaks this test.
 *   (c) The ゲーム block is exactly the game-form / decision category (意思決定/ゲーム形式) — the
 *       editor-only block the auto session does not have (blockOf returns null for it).
 *
 * editorBlockOf delegates to blockOf for the 6 auto blocks and only adds the ゲーム branch, so
 * re-routing any drill in blockOf (e.g. flipping a finishing drill's bucket) fails these tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

import { normalizeDrill, normalizeDrills } from '../src/normalize.js';
import { editorBlockOf, blockOf } from '../src/allocate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const DRILLS_PATH = resolve(repoRoot, 'docs/practice-knowledge/data/drills.json');

/** The editor's 7 blocks (auto-generated 6 + ゲーム). */
const EDITOR_BLOCKS = ['アップ', 'ファンダ', 'シュート', '対人', 'ラン', '静的', 'ゲーム'];

/** Load + normalize the real catalog. */
function loadDrills() {
  const raw = JSON.parse(readFileSync(DRILLS_PATH, 'utf8'));
  const arr = Array.isArray(raw) ? raw : (raw.drills || raw.records || []);
  return normalizeDrills(arr);
}

/** Build a normalized drill with sensible defaults; override any field. */
function drill(over) {
  return normalizeDrill({
    id: over.id ?? 'X',
    name: over.name ?? 'd',
    category: over.category ?? 'シュート',
    court: '不問',
    grades: '全',
    intensity_class: over.intensity_class ?? '低',
    duration_min: 10,
    duration_max: 10,
    sub_skill: over.sub_skill ?? '',
    mastery_stage: over.mastery_stage ?? '反復',
    philosophy_tags: over.philosophy_tags ?? [],
  });
}

// ── (a) partition: every drill → exactly one editor block, sizes sum to the total ──
test('editorBlockOf partitions the whole catalog into the 7 editor blocks (no loss, no double-assignment)', () => {
  const drills = loadDrills();
  const buckets = Object.fromEntries(EDITOR_BLOCKS.map((b) => [b, 0]));
  let unmapped = 0;
  for (const d of drills) {
    const b = editorBlockOf(d);
    if (b === null) {
      unmapped += 1;
      continue;
    }
    assert.ok(EDITOR_BLOCKS.includes(b), `「${d.name}」が未知の枠「${b}」に振り分けられた`);
    buckets[b] += 1; // each drill counted once → no double-assignment by construction
  }
  const placed = EDITOR_BLOCKS.reduce((s, b) => s + buckets[b], 0);
  // No drill is lost or double-counted: placed + unmapped === total.
  assert.equal(placed + unmapped, drills.length, '振り分け済み＋未割当の合計が総ドリル数に一致するべき');
  // The real catalog has a home for every drill, so the 7 buckets cover ALL of it (sum = total).
  assert.equal(unmapped, 0, '実カタログの全ドリルが7枠のいずれかに入る（取りこぼしゼロ）');
  assert.equal(placed, drills.length, '7枠のサイズ合計＝総ドリル数');
});

// ── (b) finishing splits by mastery: 習得→ファンダ, 反復/実戦化→シュート, 両バケツとも非空 ──
test('finishing (ゴール下/レイアップ) splits by mastery — acquisition→ファンダ, settled→シュート, both non-empty', () => {
  const drills = loadDrills();
  const fin = drills.filter((d) => d.category === 'フィニッシュ(ゴール下/レイアップ)');
  assert.ok(fin.length > 0, '実カタログにフィニッシュ(ゴール下/レイアップ)が存在するべき');

  const toFunda = fin.filter((d) => editorBlockOf(d) === 'ファンダ');
  const toShoot = fin.filter((d) => editorBlockOf(d) === 'シュート');

  // Every acquisition-stage finishing rep is a fundamental; settled (反復/実戦化) is shooting.
  for (const d of fin) {
    const isAcquisition = /習得/.test(d.mastery_stage || '');
    const block = editorBlockOf(d);
    if (isAcquisition) {
      assert.equal(block, 'ファンダ', `習得段階のフィニッシュ「${d.name}」はファンダ枠に入るべき`);
    } else {
      assert.equal(block, 'シュート', `反復/実戦化のフィニッシュ「${d.name}」はシュート枠に入るべき`);
    }
  }
  // Both buckets are actually filled (the split is real, not all-to-one).
  assert.ok(toFunda.length > 0, '習得系フィニッシュ（ファンダ枠）が非空であるべき');
  assert.ok(toShoot.length > 0, '反復/実戦化フィニッシュ（シュート枠）が非空であるべき');
  // Finishing is fully partitioned between the two buckets (no finishing drill goes elsewhere).
  assert.equal(toFunda.length + toShoot.length, fin.length, 'フィニッシュは全件がファンダ/シュートのどちらかに入る');
});

// ── (c) ゲーム枠＝意思決定/ゲーム形式 のドリル（編集時だけの独立枠）──
test('the ゲーム block is exactly the game-form (意思決定/ゲーム形式) category — editor-only block', () => {
  const drills = loadDrills();
  const game = drills.filter((d) => d.category === '意思決定/ゲーム形式');
  assert.ok(game.length > 0, '実カタログに意思決定/ゲーム形式が存在するべき');

  // Every game-form drill maps to ゲーム in the editor, and to null in the auto session (no fixed block).
  for (const d of game) {
    assert.equal(editorBlockOf(d), 'ゲーム', `「${d.name}」は編集のゲーム枠に入るべき`);
    assert.equal(blockOf(d), null, `「${d.name}」は自動生成では独立ブロックを持たない（対人末尾の特例）`);
  }
  // Conversely, nothing OUTSIDE the game category lands in ゲーム (the branch is category-scoped).
  for (const d of drills) {
    if (editorBlockOf(d) === 'ゲーム') {
      assert.equal(d.category, '意思決定/ゲーム形式', `ゲーム枠に入る「${d.name}」は意思決定/ゲーム形式であるべき`);
    }
  }
});

// ── editorBlockOf is blockOf for the 6 auto blocks (re-use, not a re-decided mapping) ──
test('editorBlockOf equals blockOf for every non-game drill (no duplicated block logic)', () => {
  const drills = loadDrills();
  for (const d of drills) {
    if (d.category === '意思決定/ゲーム形式') continue; // the one branch editor adds on top of blockOf
    assert.equal(
      editorBlockOf(d),
      blockOf(d),
      `非ゲームの「${d.name}」は editorBlockOf と blockOf が一致するべき（枠判定はblockOfが唯一の真実源）`,
    );
  }
});

// ── synthetic edge: an injury-prevention drill that is neither warm-up/run/static maps to アップ
//    (warm-up activation default), confirming the delegation reaches blockOf's NMT default. ──
test('a plain warm-up/NMT drill routes through blockOf (アップ default), not a separate editor rule', () => {
  const nmt = drill({ id: 'NMT', name: '体幹プランク', category: '傷害予防/NMT', sub_skill: '体幹安定', philosophy_tags: [] });
  assert.equal(editorBlockOf(nmt), blockOf(nmt));
  assert.equal(editorBlockOf(nmt), 'アップ');
});
