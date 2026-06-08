#!/usr/bin/env node
/**
 * @file Coach-context classification audit.
 *
 * Loads the full drill catalog, runs the deterministic `needsCoach` rule on
 * every drill, and prints an audit table: each drill's id / name / category /
 * mastery_stage / verdict (要コーチ|自走) / the rule that decided it. Ends with
 * the 要コーチ vs 自走 counts so the whole catalog can be reviewed at a glance
 * and borderline drills hand-corrected via the per-record `needs_coach` override.
 *
 * Usage:
 *   node bin/classify.js [drillsPath]          # full table + counts
 *   node bin/classify.js --summary [drillsPath] # counts only
 *
 * Drills path defaults to the shared 211-drill catalog.
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { createLocalStorage } from '../src/storage.js';
import { normalizeDrills } from '../src/normalize.js';
import { needsCoachReason, coachingModeReason } from '../src/filter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const engineRoot = resolve(__dirname, '..');
const repoRoot = resolve(engineRoot, '..');

const DEFAULT_DRILLS = resolve(repoRoot, 'docs/practice-knowledge/data/drills.json');
// config/input are required by the storage factory but unused here; point them at
// the engine samples so the local-storage contract is satisfied.
const DEFAULT_CONFIG = resolve(engineRoot, 'data/config.sample.json');
const DEFAULT_INPUT = resolve(engineRoot, 'data/team-input.sample.json');

async function main() {
  const args = process.argv.slice(2);
  const summaryOnly = args.includes('--summary');
  const drillsArg = args.find((a) => !a.startsWith('--'));
  const drillsPath = drillsArg ? resolve(drillsArg) : DEFAULT_DRILLS;

  const storage = createLocalStorage({
    drillsPath,
    configPath: DEFAULT_CONFIG,
    inputPath: DEFAULT_INPUT,
  });
  const drills = normalizeDrills(await storage.getDrills());

  /** Display label for a coaching mode. */
  const MODE_LABEL = { self: '自走　　', practice: '実践　　', lecture: 'レクチャ' };

  const rows = drills.map((d) => {
    const { needs_coach } = needsCoachReason(d);
    const { mode, reason } = coachingModeReason(d);
    return {
      id: d.id,
      name: d.name,
      category: d.category,
      mastery_stage: d.mastery_stage,
      needs_coach,
      mode,
      reason,
    };
  });

  const out = [];
  if (!summaryOnly) {
    out.push('=== ドリル別 コーチ関与3分類監査（自走/実践/レクチャ）===');
    for (const r of rows) {
      out.push(
        `${MODE_LABEL[r.mode]}  ${r.id}  ${r.name}` +
          `\n        分類:${r.category}  習熟:${r.mastery_stage}  判定理由:${r.reason}`,
      );
    }
    out.push('');
  }

  const selfCount = rows.filter((r) => r.mode === 'self').length;
  const practiceCount = rows.filter((r) => r.mode === 'practice').length;
  const lectureCount = rows.filter((r) => r.mode === 'lecture').length;
  const needCount = rows.filter((r) => r.needs_coach).length;
  out.push('=== 集計 ===');
  out.push(
    `自走: ${selfCount}件 / 実践: ${practiceCount}件 / レクチャ: ${lectureCount}件 ` +
      `（要コーチ計: ${needCount}件） / 合計: ${rows.length}件`,
  );

  process.stdout.write(out.join('\n') + '\n');
}

main().catch((err) => {
  process.stderr.write(`分類監査に失敗しました: ${err.message}\n`);
  process.exitCode = 1;
});
