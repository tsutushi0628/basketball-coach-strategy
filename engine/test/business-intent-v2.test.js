/**
 * @file Business-intent tests for the REBUILT engine (作り直し方針1〜3).
 *
 * These assert *what a coach / the new fixed-session form expects of a week*, not how
 * the allocator achieves it. They run the real pipeline over the real catalog and the
 * sample team config (the production path), resolving the week's focus top-down via
 * resolveWeekFocus, so a regression in the fixed 6-block form, contested composition,
 * scrimmage placement, coach-context, the static-stretch close, or responsiveness shows
 * up as a business failure.
 *
 * Coverage (rebuilt intent):
 *   V1  チームDF/速攻 show up driven by the MONTH'S EMPHASIS (主眼), not a forced weekly floor.
 *   V2  coach-absent days (水木) carry only self-runnable settled-mastery contested work; no
 *       team-install (off-allow-list) and no 習得 acquisition.
 *   V3  coach-absent days hold only coach_absent_allow categories with settled mastery.
 *   V4  火水木金土 differ from one another (週内変化).
 *   V5  ファンダ and シュート are SEPARATE blocks (the old single 技術 block is split).
 *   V6  the static-stretch (静的) block holds only settle-down work (no jump / push), and is last.
 *   V7  the legacy safety gates still hold (時間収まり / ゾーン除外 / 年内セット除外 / 負荷上限).
 *   V8  changing the measured input changes the allocation (responsive, not fixed).
 *   V9  5on5/scrimmage appears only at the 対人 block tail and only on full-court days.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { createLocalStorage } from '../src/storage.js';
import { normalizeDrills } from '../src/normalize.js';
import { planWeek } from '../src/planWeek.js';
import { loadAnnualPlan, resolveMonth, resolveWeekFocus } from '../src/annualPlan.js';
import { isCoachAbsentEligible, isZoneDrill, isSetsDrill } from '../src/filter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const engineRoot = resolve(__dirname, '..');
const repoRoot = resolve(engineRoot, '..');

const DEFENSE_CAT = 'チームディフェンス(オールコートマンツー/ヘルプ/帰陣)';
const OFFENSE_CAT = 'チームオフェンス(アーリー/トランジション)';
const GAME_CAT = '意思決定/ゲーム形式';

/** Jump keywords forbidden in the static-stretch block. */
const JUMP_NAME_RE =
  /ポゴ|バウンディング|ジャンプキック|スクワットジャンプ|ジャンプ|跳び|バウンド|ホップ|プライオ/;

/**
 * Load the real catalog + sample config/input, resolve the month emphasis and the week's
 * focus top-down, and produce a plan for the given week-of-month. week 2 of the 準備始動
 * month (allow_scrimmage=true) is the default so contested/scrimmage intent is exercised.
 */
async function loadPlan(weekOfMonth = 2) {
  const storage = createLocalStorage({
    drillsPath: resolve(repoRoot, 'docs/practice-knowledge/data/drills.json'),
    configPath: resolve(engineRoot, 'data/config.sample.json'),
    inputPath: resolve(engineRoot, 'data/team-input.sample.json'),
  });
  const drills = normalizeDrills(await storage.getDrills());
  const config = await storage.getConfig();
  const baseInput = await storage.getTeamInput();
  const annual = await loadAnnualPlan();
  const resolved = resolveMonth(annual, '男子', config.current_month);
  const weekFocus = resolveWeekFocus(annual, '男子', config.current_month, weekOfMonth);
  const cfg = { ...config, phase: resolved.phase, phase_category_weights: resolved.focus_weights };
  return { drills, config: cfg, baseInput, weekFocus, plan: planWeek(drills, cfg, baseInput, weekFocus) };
}

function inputWith(baseInput, overrides) {
  const next = JSON.parse(JSON.stringify(baseInput));
  for (const [id, patch] of Object.entries(overrides)) {
    const ind = next.indicators.find((i) => i.id === id);
    if (ind) Object.assign(ind, patch);
  }
  return next;
}

function dayItems(day) {
  return day.blocks.flatMap((b) => b.items);
}
function minutesByCategory(plan) {
  const out = {};
  for (const day of plan.days) {
    for (const it of dayItems(day)) out[it.category] = (out[it.category] ?? 0) + it.minutes;
  }
  return out;
}
function block(day, key) {
  return day.blocks.find((b) => b.block === key);
}

// ───────────────────────────────────────────────────────────────────────────
// V1. Team defense & fast-break show up driven by the MONTH'S EMPHASIS (主眼),
//     not a forced weekly floor (撤去①). In the 準備始動 month they carry real
//     focus_weight, so they must appear in the week — but as a consequence of the
//     emphasis, not a hard floor the allocator reserves up front.
// ───────────────────────────────────────────────────────────────────────────
test('V1: チーム守備が月の主眼ぶん週内に出る（フロア強制ではなく主眼駆動）', async () => {
  const { plan, config } = await loadPlan();
  // The month emphasis actually weights team defense (準備始動の主眼).
  assert.ok((config.phase_category_weights[DEFENSE_CAT] ?? 0) > 0, '準備始動月はチーム守備に主眼重みがある前提');
  const byCat = minutesByCategory(plan);
  assert.ok((byCat[DEFENSE_CAT] ?? 0) > 0, 'チーム守備（3on3）が週内に配置されるべき');
  // And the config no longer declares any philosophy floor (撤去① の不在を固定).
  assert.equal(config.philosophy_floors, undefined, 'フロア強制(philosophy_floors)は撤去されているべき');
});

// ───────────────────────────────────────────────────────────────────────────
// V2. Coach-absent days (水木) carry no team-install (off-allow-list) and no 習得.
// ───────────────────────────────────────────────────────────────────────────
test('V2: 不在日(水木)はチームオフェンス導入を持たず、置かれた対人は自走可能な既習形のみ', async () => {
  const { plan, config, drills } = await loadPlan();
  const idx = new Map(drills.map((d) => [d.id, d]));
  for (const day of plan.days) {
    if (day.coach_present !== false) continue; // inspect absent days (水/木)
    for (const it of dayItems(day)) {
      // Team-offense is NOT on the self-run allow list → must not appear on an absent day.
      assert.notEqual(it.category, OFFENSE_CAT, `不在日 ${day.day} にチームオフェンス(導入要コーチ)が混入`);
      const drill = idx.get(it.drill_id);
      // Any curriculum drill on an absent day must be self-run-eligible (settled + allow-listed).
      const isBundle = ['アップ', 'ラン', '静的'].includes(
        day.blocks.find((b) => b.items.includes(it))?.block,
      );
      if (!isBundle) {
        assert.ok(isCoachAbsentEligible(drill, config), `不在日 ${day.day} に自走不可ドリル「${it.name}」`);
      }
    }
  }
});

// ───────────────────────────────────────────────────────────────────────────
// V3. Coach-absent days hold only coach_absent_allow categories with settled mastery
//     in the curriculum (non-bundle) blocks — no 習得, no team-install.
// ───────────────────────────────────────────────────────────────────────────
test('V3: 不在日の主ブロックは許可カテゴリ×既習(反復/実戦化)のみ', async () => {
  const { plan, config, drills } = await loadPlan();
  const idx = new Map(drills.map((d) => [d.id, d]));
  const BUNDLE = new Set(['アップ', 'ラン', '静的']);
  const absentDays = plan.days.filter((d) => d.coach_present === false);
  assert.ok(absentDays.length > 0, 'サンプル週には不在日(水/木)があるべき');
  const allow = config.coach_absent_allow;
  for (const day of absentDays) {
    for (const b of day.blocks) {
      if (BUNDLE.has(b.block)) continue;
      for (const it of b.items) {
        const drill = idx.get(it.drill_id);
        assert.ok(allow.includes(drill.category), `不在日 ${day.day} ${b.block} に許可外カテゴリ「${drill.category}」(${it.name})`);
        assert.ok(drill.mastery_stage === '反復' || drill.mastery_stage === '実戦化', `不在日 ${day.day} ${b.block} に未習得「${drill.mastery_stage}」(${it.name})`);
        assert.doesNotMatch(drill.mastery_stage, /習得/, `不在日 ${day.day} ${b.block} に新規習得系(${it.name})`);
      }
    }
  }
});

// ───────────────────────────────────────────────────────────────────────────
// V4. The five practice days differ from one another (週内変化).
// ───────────────────────────────────────────────────────────────────────────
test('V4: 火水木金土 are not identical to each other (週内変化)', async () => {
  const { plan } = await loadPlan();
  const signatures = plan.days.map((day) =>
    JSON.stringify([...new Set(dayItems(day).map((it) => it.drill_id))].sort()),
  );
  assert.equal(new Set(signatures).size, signatures.length, '各日の内容は互いに異なるべき');
});

// ───────────────────────────────────────────────────────────────────────────
// V5. ファンダ and シュート are SEPARATE fixed blocks (旧 単一 技術 ブロックの分離).
// ───────────────────────────────────────────────────────────────────────────
test('V5: ファンダとシュートが別々の固定ブロックとして存在する（旧 技術 一括の分離）', async () => {
  const { plan } = await loadPlan();
  let daysWithBoth = 0;
  for (const day of plan.days) {
    const funda = block(day, 'ファンダ');
    const shoot = block(day, 'シュート');
    // No day collapses both into one bucket — when present they are distinct blocks.
    if (funda && shoot) {
      daysWithBoth += 1;
      // ファンダ＝3基礎だけ（ハンドリング/パス/フットワーク）。シュート＝得点動作（catch&shoot＋全フィニッシュ）。
      // フィニッシュ専用カテゴリは撤去済みで、得点動作は全てシュートに集約される。
      for (const it of shoot.items) {
        assert.equal(
          it.category, 'シュート',
          `シュートブロックに場違いカテゴリ「${it.category}」(${it.name})`,
        );
      }
      for (const it of funda.items) {
        assert.ok(
          ['ハンドリング/ドリブル', 'パス&スペーシング', 'フットワーク/アジリティ/ピボット'].includes(it.category),
          `ファンダブロックに場違いカテゴリ「${it.category}」(${it.name})＝ファンダは3基礎だけ・得点動作は出ない`,
        );
      }
    }
  }
  assert.ok(daysWithBoth > 0, 'ファンダとシュートが共に出る日が少なくとも1日あるべき');
});

// ───────────────────────────────────────────────────────────────────────────
// V6. The static-stretch (静的) block holds ONLY settle-down work and is the last block.
// ───────────────────────────────────────────────────────────────────────────
test('V6: 静的ストレッチは整理運動のみ・動的アップ/跳躍は混入しない・常に末尾', async () => {
  const { plan, drills } = await loadPlan();
  const idx = new Map(drills.map((d) => [d.id, d]));
  const COOLDOWN_MARK = /静的|整理|鎮静|呼吸|クールダウン|筋温|リカバリ|筋膜/;
  for (const day of plan.days) {
    const keys = day.blocks.map((b) => b.block);
    assert.equal(keys[keys.length - 1], '静的', `${day.day} は静的ストレッチで終わるべき`);
    const cd = block(day, '静的');
    for (const it of cd.items) {
      assert.notEqual(it.intensity_class, '高', `${day.day} の静的に高強度「${it.name}」`);
      assert.doesNotMatch(it.name, JUMP_NAME_RE, `${day.day} の静的に跳躍系「${it.name}」が混入`);
      const src = idx.get(it.drill_id);
      const tags = Array.isArray(src.philosophy_tags) ? src.philosophy_tags : [];
      const isSettle = tags.includes('クールダウン') || tags.includes('整理運動') || COOLDOWN_MARK.test(src.sub_skill ?? '');
      assert.ok(isSettle, `${day.day} の静的に整理運動でない「${it.name}」が混入`);
    }
  }
});

// ───────────────────────────────────────────────────────────────────────────
// V7. The legacy safety gates still hold on the produced plan.
// ───────────────────────────────────────────────────────────────────────────
test('V7: legacy invariants hold (time fits / no zone / no in-year sets / load caps)', async () => {
  const { plan, config, drills } = await loadPlan();
  const idx = new Map(drills.map((d) => [d.id, d]));
  for (const day of plan.days) {
    const sum = dayItems(day).reduce((s, it) => s + it.minutes, 0);
    assert.ok(sum <= day.minutes, `${day.day} ${sum}分 が枠 ${day.minutes}分 を超過`);
    assert.equal(sum, day.total_minutes, `${day.day} total_minutes が実合計と不一致`);
  }
  for (const day of plan.days) {
    for (const it of dayItems(day)) {
      assert.ok(!isZoneDrill(idx.get(it.drill_id)), `zone系が混入: ${it.name}`);
      assert.ok(!isSetsDrill(idx.get(it.drill_id)), `年内禁止のセット系が混入: ${it.name}`);
    }
  }
  const caps = config.load_caps;
  let weekHigh = 0;
  let prevHigh = false;
  for (const day of plan.days) {
    const high = dayItems(day).filter((it) => it.intensity_class === '高').length;
    assert.ok(high <= caps.high_intensity_per_session, `${day.day} 高強度 ${high} > 上限 ${caps.high_intensity_per_session}`);
    if (caps.no_consecutive_high_days && high > 0) assert.equal(prevHigh, false, `高強度が連続日（${day.day}）`);
    weekHigh += high;
    prevHigh = high > 0;
  }
  assert.ok(weekHigh <= caps.high_intensity_per_week, `週合計の高強度 ${weekHigh} > 週上限 ${caps.high_intensity_per_week}`);
});

// ───────────────────────────────────────────────────────────────────────────
// V8. Changing the measured input re-shapes the allocation (responsive, not fixed).
// ───────────────────────────────────────────────────────────────────────────
test('V8: changing the input changes the allocation (responsive, not fixed)', async () => {
  const { drills, config, baseInput, weekFocus } = await loadPlan();
  // ブロック分数は曜日枠テンプレ固定・指標ギャップが動かすのはカテゴリ/ドリルの選定。試合TOを動かすと
  // ハンドリング/パス/判断の中身配分が変わる（得点動作のシュート集約後も成立する責任あるレバー）。
  const below = planWeek(drills, config, inputWith(baseInput, {
    '試合TO': { good_direction: 'down', baseline: 30, latest: 30, target: 10 },
  }), weekFocus);
  const met = planWeek(drills, config, inputWith(baseInput, {
    '試合TO': { good_direction: 'down', baseline: 30, latest: 10, target: 10 },
  }), weekFocus);
  assert.notDeepEqual(
    minutesByCategory(below),
    minutesByCategory(met),
    '入力を変えても配分が同一＝固定値を返している疑い',
  );
});

// ───────────────────────────────────────────────────────────────────────────
// V9. 5on5/scrimmage appears only at the 対人 block tail and only on full-court days.
// ───────────────────────────────────────────────────────────────────────────
test('V9: 5on5は対人ブロック末尾かつ全面の日のみ（独立ブロックなし・半面は無し）', async () => {
  const { plan } = await loadPlan(); // week 2 → allow_scrimmage=true
  let scrimDays = 0;
  for (const day of plan.days) {
    const fullCourt = String(day.court).includes('全面');
    for (const b of day.blocks) {
      const gameItems = b.items.filter((it) => it.category === GAME_CAT);
      if (gameItems.length === 0) continue;
      assert.equal(b.block, '対人', `${day.day} の「${b.block}」に5on5が独立配置（対人末尾のみ可）`);
      assert.ok(fullCourt, `半面日 ${day.day} に5on5が混入（5on5は全面のみ）`);
      // It is the LAST segment of the contested block.
      assert.equal(b.items[b.items.length - 1].category, GAME_CAT, `${day.day} の5on5が対人ブロックの末尾でない`);
      scrimDays += 1;
    }
  }
  assert.ok(scrimDays > 0, 'allow_scrimmage週には全面日の対人末尾に5on5が出るべき');
});
