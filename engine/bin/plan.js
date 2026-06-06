#!/usr/bin/env node
/**
 * @file CLI entry point.
 *
 * Wires the storage layer to the engine: reads the drills catalog, team config
 * and team input via `createLocalStorage`, normalizes the drills, generates a
 * validated weekly plan, and prints the human-readable rendering to stdout.
 *
 * Paths default to the repo's sample data but can be overridden by argv:
 *   node bin/plan.js [configPath] [inputPath] [drillsPath]
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { createLocalStorage } from '../src/storage.js';
import { normalizeDrills } from '../src/normalize.js';
import { planWeek } from '../src/planWeek.js';
import { formatPlan } from '../src/format.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const engineRoot = resolve(__dirname, '..');
const repoRoot = resolve(engineRoot, '..');

// Defaults: engine sample config/input + the shared 211-drill catalog.
const DEFAULT_CONFIG = resolve(engineRoot, 'data/config.sample.json');
const DEFAULT_INPUT = resolve(engineRoot, 'data/team-input.sample.json');
const DEFAULT_DRILLS = resolve(repoRoot, 'docs/practice-knowledge/data/drills.json');

async function main() {
  const [, , configArg, inputArg, drillsArg] = process.argv;
  const configPath = configArg ? resolve(configArg) : DEFAULT_CONFIG;
  const inputPath = inputArg ? resolve(inputArg) : DEFAULT_INPUT;
  const drillsPath = drillsArg ? resolve(drillsArg) : DEFAULT_DRILLS;

  const storage = createLocalStorage({ drillsPath, configPath, inputPath });
  const [rawDrills, config, teamInput] = await Promise.all([
    storage.getDrills(),
    storage.getConfig(),
    storage.getTeamInput(),
  ]);

  const drills = normalizeDrills(rawDrills);
  const plan = planWeek(drills, config, teamInput);

  process.stdout.write(formatPlan(plan));
}

main().catch((err) => {
  process.stderr.write(`計画生成に失敗しました: ${err.message}\n`);
  process.exitCode = 1;
});
