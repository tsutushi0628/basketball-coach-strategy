/**
 * @file Deterministic plan → human-readable text rendering.
 *
 * Pure string assembly, no logic decisions — given the same plan it always
 * produces the same text. Renders the week day-by-day: each block with its
 * drills, per-drill minutes, and the day's total / available minutes.
 *
 * @typedef {import('./types.js').Plan} Plan
 * @typedef {import('./types.js').PlanDay} PlanDay
 */

/** Display labels for the fixed 6-block skeleton (kept in fixed presentation order). */
const BLOCK_LABEL = {
  アップ: 'アップ（動的）',
  ファンダ: 'ファンダメンタル',
  シュート: 'シュート',
  対人: '対人',
  ラン: '走り込み（コンディショニング）',
  静的: '静的ストレッチ',
};

/**
 * Display labels for the three-way coaching mode (spec ③). Replaces the old
 * 要コーチ/自走 two-value tag with 自走/実践/レクチャ so a 1-coach / 2-group session
 * can be staffed at a glance.
 */
const MODE_LABEL = { self: '自走', practice: '実践', lecture: 'レクチャ' };

/**
 * The 3-way coaching-mode tag for a plan item (spec ③). Prefers the stamped
 * `coaching_mode`; falls back to the legacy needs_coach flag (要コーチ→実践寄り、
 * 自走) only for items produced before the stamp existed.
 * @param {import('./types.js').PlanItem} item
 * @returns {string}
 */
function modeTag(item) {
  if (item.coaching_mode && MODE_LABEL[item.coaching_mode]) return MODE_LABEL[item.coaching_mode];
  return item.needs_coach ? '実践' : '自走';
}

/**
 * Render one day's section.
 * @param {PlanDay} day
 * @returns {string}
 */
function formatDay(day) {
  const lines = [];
  // coach_present defaults to true (in-attendance) when the flag is absent.
  const coachLabel = day.coach_present === false ? 'コーチ不在' : 'コーチ在席';
  lines.push(
    `■ ${day.day}（${day.court}・${day.minutes}分・${coachLabel}）` +
      `  合計 ${day.total_minutes}分 / 高強度 ${day.high_intensity_count}本`,
  );
  for (const block of day.blocks) {
    const blockMin = block.items.reduce((s, it) => s + it.minutes, 0);
    const label = BLOCK_LABEL[block.block] ?? block.block;
    lines.push(`  ▷ ${label}（${blockMin}分）`);
    if (block.items.length === 0) {
      lines.push('      （該当ドリルなし）');
      continue;
    }
    for (const it of block.items) {
      // 3分類タグ (spec ③): 自走 / 実践 / レクチャ。1コーチ・2グループ運用を一目で
      // スタッフィングできるよう各ドリルに出す（旧 要コーチ/自走 の2値を置換）。
      lines.push(
        `      - ${it.name}　${it.minutes}分　[${it.category}]　強度:${it.intensity_class}　${modeTag(it)}`,
      );
      // "いずれか" menu: a sustained main segment runs one primary drill, with a
      // small set of same-category alternatives the coach may swap in. Show them
      // indented under the primary so the segment reads as one themed slot.
      if (Array.isArray(it.alternatives) && it.alternatives.length > 0) {
        lines.push(`          いずれか: ${it.alternatives.map((a) => a.name).join(' / ')}`);
      }
    }
  }
  return lines.join('\n');
}

/**
 * Render a full plan as plain text.
 * @param {Plan} plan
 * @returns {string}
 */
export function formatPlan(plan) {
  const header = [
    `=== 週次練習計画 ===`,
    `チーム: ${plan.team_id}　/　${plan.month}月　/　フェーズ: ${plan.phase}`,
    plan.focus_summary,
    plan.notes,
    '',
  ];
  const body = plan.days.map(formatDay).join('\n\n');

  // Saturday new-drill lecture: the lecture-mode drills whose intro
  // is delivered together this week. Rendered as a dedicated section so the coach
  // can run one co-ed explanation block instead of re-teaching per group. An
  // empty intro list still renders the header so the absence is explicit ("no new
  // drills to introduce this week"); a missing host day renders nothing.
  const lecture = formatSaturdayLecture(plan.saturday_lecture);

  // Spec #4: surface best-effort warnings (philosophy-floor shortfall / under-
  // filled days / empty blocks) at the end so the coach sees what couldn't be
  // fully programmed. Absent/empty warnings render nothing.
  const warnings =
    Array.isArray(plan.warnings) && plan.warnings.length > 0
      ? ['', '⚠ 注意（計画は生成済み）:', ...plan.warnings.map((w) => `  - ${w}`)]
      : [];

  return [...header, body, ...lecture, ...warnings, ''].join('\n');
}

/**
 * Render the Saturday new-drill lecture section.
 * @param {import('./types.js').SaturdayLecture|null} lecture
 * @returns {string[]}  Lines to splice into the rendered plan (empty when absent).
 */
function formatSaturdayLecture(lecture) {
  if (!lecture) return [];
  const lines = ['', `★ ${lecture.day} 新規レクチャ（男女合同）`];
  if (lecture.items.length === 0) {
    lines.push('   （今週は新規導入のレクチャ型ドリルなし）');
    return lines;
  }
  for (const it of lecture.items) {
    lines.push(`   - ${it.name}　[${it.category}]`);
  }
  return lines;
}
