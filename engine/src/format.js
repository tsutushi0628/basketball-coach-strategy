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

/** Display labels for block keys (kept in fixed presentation order). */
const BLOCK_LABEL = {
  WU: 'ウォームアップ',
  技術: '技術',
  対人: '対人',
  ゲーム: 'ゲーム形式',
  CD: 'クールダウン',
};

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
      lines.push(
        `      - ${it.name}　${it.minutes}分　[${it.category}]　強度:${it.intensity_class}`,
      );
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

  // Spec #4: surface best-effort warnings (philosophy-floor shortfall / under-
  // filled days / empty blocks) at the end so the coach sees what couldn't be
  // fully programmed. Absent/empty warnings render nothing.
  const warnings =
    Array.isArray(plan.warnings) && plan.warnings.length > 0
      ? ['', '⚠ 注意（計画は生成済み）:', ...plan.warnings.map((w) => `  - ${w}`)]
      : [];

  return [...header, body, ...warnings, ''].join('\n');
}
