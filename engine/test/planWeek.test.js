/**
 * @file End-to-end integration test against the real 211-drill catalog and
 * sample config/input. Asserts the business contract of a generated plan.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { createLocalStorage } from '../src/storage.js';
import { normalizeDrills } from '../src/normalize.js';
import { planWeek } from '../src/planWeek.js';
import { isCoolDownEligible } from '../src/allocate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const engineRoot = resolve(__dirname, '..');
const repoRoot = resolve(engineRoot, '..');

async function loadPlan() {
  const storage = createLocalStorage({
    drillsPath: resolve(repoRoot, 'docs/practice-knowledge/data/drills.json'),
    configPath: resolve(engineRoot, 'data/config.sample.json'),
    inputPath: resolve(engineRoot, 'data/team-input.sample.json'),
  });
  const drills = normalizeDrills(await storage.getDrills());
  const config = await storage.getConfig();
  const teamInput = await storage.getTeamInput();
  return { plan: planWeek(drills, config, teamInput), drills, config };
}

test('planWeek: produces a plan for every scheduled day without throwing gates', async () => {
  const { plan, config } = await loadPlan();
  assert.equal(plan.days.length, config.schedule.length);
  assert.equal(plan.team_id, config.team_id);
});

test('planWeek: each day fits within its available minutes (assertTimeFits)', async () => {
  const { plan } = await loadPlan();
  for (const day of plan.days) {
    assert.ok(day.total_minutes <= day.minutes, `${day.day} ${day.total_minutes} <= ${day.minutes}`);
  }
});

test('planWeek: no zone drill appears (middle-school, zone-forbidden)', async () => {
  const { plan, drills } = await loadPlan();
  const idx = new Map(drills.map((d) => [d.id, d]));
  for (const day of plan.days) {
    for (const it of day.blocks.flatMap((b) => b.items)) {
      const drill = idx.get(it.drill_id);
      assert.ok(!/ゾーン|zone/i.test(`${drill.name} ${drill.category} ${drill.notes}`),
        `zone drill leaked: ${it.name}`);
    }
  }
});

test('planWeek: half-court days contain no full-court-only drills', async () => {
  const { plan, drills } = await loadPlan();
  const idx = new Map(drills.map((d) => [d.id, d]));
  // Warm-up / cool-down stretch & mobility work is space-agnostic and exempt from
  // the full-court restriction (F1 in filter.js): a hip rotation or shoulder roll
  // needs no court, so it legitimately appears on half-court days even though the
  // catalog lists 全面. The court restriction applies to drills that genuinely
  // need playing-court space (technical / 対人 / ゲーム), which is what we assert.
  const CONDITIONING = 'コンディショニング/ウォームアップ';
  for (const day of plan.days) {
    if (String(day.court).includes('全面')) continue;
    for (const it of day.blocks.flatMap((b) => b.items)) {
      const drill = idx.get(it.drill_id);
      if (drill.category === CONDITIONING) continue; // WU/CD stretch fits any space
      assert.equal(drill.requiresFull, false,
        `${day.day}(half) has full-court-only drill ${it.name}`);
    }
  }
});

test('planWeek: the FT-only emphasis keeps the シュート category to free-throw drills', async () => {
  const { plan } = await loadPlan();
  const shotItems = plan.days
    .flatMap((d) => d.blocks.flatMap((b) => b.items))
    .filter((it) => it.category === 'シュート');
  assert.ok(shotItems.length > 0, 'expected some シュート work given the FT率 gap');
  for (const it of shotItems) {
    assert.ok(/フリースロー|FT/i.test(it.name), `non-FT シュート drill placed: ${it.name}`);
  }
});

test('planWeek: every practice day has a non-empty cooldown (整理運動)', async () => {
  const { plan } = await loadPlan();
  for (const day of plan.days) {
    const cd = day.blocks.find((b) => b.block === 'CD');
    assert.ok(cd, `${day.day} に CD ブロックが存在しない`);
    assert.ok(
      cd.items.length > 0,
      `${day.day} のクールダウン（整理運動）が空: 全練習日に整理運動が入っていること`,
    );
    const cdMinutes = cd.items.reduce((s, it) => s + it.minutes, 0);
    assert.ok(cdMinutes > 0, `${day.day} のクールダウン合計が0分`);
  }
});

test('planWeek: every practice day cooldown is low-intensity stretch only (no 追い込み/跳躍/空)', async () => {
  const { plan, drills } = await loadPlan();
  const idx = new Map(drills.map((d) => [d.id, d]));

  // Names that betray a "push" (追い込み: HIIT/sprint/shuttle/burpee) — none of
  // these may settle a session down.
  const PUSH_NAME = /HIIT|ボディビルダー|ダッシュ|シャトル|バーピー|インターバル|階段/i;
  // Jump / plyometric / locomotor-skip movements that are warm-up activation, not
  // warm-down. "スキップ" alone is intentionally NOT matched: 肩甲骨スキップ is a
  // shoulder-blade mobility drill, not a locomotor skip. The genuine locomotor
  // skips that previously leaked are caught explicitly: Aスキップ, スキップ(…variant),
  // and 縄跳び. Plyometric jumps are caught by the jump keywords.
  const JUMP_OR_SKIP_NAME =
    /ジャンプ|跳び|跳躍|バウンド|バウンディング|ホップ|ポゴ|プライオ|縄跳び|なわとび|Aスキップ|スキップ[（(]/;

  for (const day of plan.days) {
    const cd = day.blocks.find((b) => b.block === 'CD');
    assert.ok(cd, `${day.day} に CD ブロックが存在しない`);

    // 空が無いこと: every practice day must carry a settle-down cooldown.
    assert.ok(cd.items.length > 0, `${day.day} のクールダウンが空（整理運動なし）`);
    const cdMinutes = cd.items.reduce((s, it) => s + it.minutes, 0);
    assert.ok(cdMinutes > 0, `${day.day} のクールダウン合計が0分`);

    for (const it of cd.items) {
      const drill = idx.get(it.drill_id);
      assert.ok(drill, `${day.day} CD: ドリル ${it.drill_id} がカタログに無い`);

      // 低強度であること: a cooldown drill is never 中/高 intensity (追い込み禁止).
      assert.equal(
        it.intensity_class,
        '低',
        `${day.day} CD に低強度でないドリル「${it.name}」(強度:${it.intensity_class})`,
      );

      // 跳躍/スキップ系でないこと: no jump / skip / plyometric movement.
      assert.ok(
        !JUMP_OR_SKIP_NAME.test(it.name),
        `${day.day} CD に跳躍/スキップ系「${it.name}」が混入（例: Aスキップ等は整理運動に不可）`,
      );

      // 追い込み系でないこと: no HIIT / sprint / shuttle / stair / burpee push.
      assert.ok(
        !PUSH_NAME.test(it.name),
        `${day.day} CD に追い込み系「${it.name}」が混入`,
      );

      // canonical engine predicate も満たすこと（弾性/ばね/パワー/協調/リズム等の
      // plyometric・心肺系 sub_skill を整理運動から排除する単一の真実源）。
      assert.ok(
        isCoolDownEligible(drill),
        `${day.day} CD「${it.name}」(sub:${drill.sub_skill}) は整理運動の適格条件を満たさない`,
      );
    }
  }
});

test('planWeek: the main focus (フィニッシュ) appears in the week', async () => {
  const { plan } = await loadPlan();
  const present = plan.days.some((d) =>
    d.blocks.flatMap((b) => b.items).some((it) => it.category === 'フィニッシュ(ゴール下/レイアップ)'),
  );
  assert.ok(present, 'main-focus category must appear at least once');
});

test('planWeek: weekly high-intensity total respects the cap', async () => {
  const { plan, config } = await loadPlan();
  const weekHigh = plan.days.reduce((s, d) => s + d.high_intensity_count, 0);
  assert.ok(weekHigh <= config.load_caps.high_intensity_per_week, `week high ${weekHigh}`);
});
