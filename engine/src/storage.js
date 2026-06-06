/**
 * @file Storage abstraction layer.
 *
 * The rest of the engine depends only on the *shape* returned here, never on
 * where the data lives. The MVP ships a local-JSON implementation; a Firestore
 * implementation can be dropped in later by exposing the same three async
 * getters (getDrills / getConfig / getTeamInput) keyed by team_id.
 *
 * @typedef {import('./types.js').Drill} Drill
 * @typedef {import('./types.js').Config} Config
 * @typedef {import('./types.js').TeamInput} TeamInput
 */

import { readFile } from 'node:fs/promises';

/**
 * The interface every storage backend must satisfy.
 *
 * @typedef {Object} Storage
 * @property {() => Promise<Array<Object>>} getDrills  Raw (un-normalized) drill records.
 * @property {() => Promise<Config>} getConfig         Team config object.
 * @property {() => Promise<TeamInput>} getTeamInput   Team measured-indicator input.
 */

/**
 * Read+parse a JSON file from an absolute or cwd-relative path.
 * @param {string} path
 * @returns {Promise<any>}
 */
async function readJson(path) {
  const text = await readFile(path, 'utf8');
  return JSON.parse(text);
}

/**
 * Local-filesystem storage backend.
 *
 * Returns *raw* drill records (normalization is the caller's responsibility via
 * `normalizeDrill`), so this layer stays a pure I/O boundary with no business
 * logic. Config/TeamInput are returned as-is.
 *
 * @param {Object} paths
 * @param {string} paths.drillsPath  Path to the drills catalog JSON (array).
 * @param {string} paths.configPath  Path to the team config JSON.
 * @param {string} paths.inputPath   Path to the team-input JSON.
 * @returns {Storage}
 */
export function createLocalStorage({ drillsPath, configPath, inputPath }) {
  if (!drillsPath || !configPath || !inputPath) {
    throw new Error('createLocalStorage: drillsPath, configPath and inputPath are all required');
  }
  return {
    async getDrills() {
      const data = await readJson(drillsPath);
      if (!Array.isArray(data)) {
        throw new Error(`drills file must be a JSON array: ${drillsPath}`);
      }
      return data;
    },
    async getConfig() {
      return /** @type {Config} */ (await readJson(configPath));
    },
    async getTeamInput() {
      return /** @type {TeamInput} */ (await readJson(inputPath));
    },
  };
}

/**
 * Placeholder factory documenting the swap-in point for a Firestore backend.
 * Intentionally unimplemented in the MVP — present so the interface contract is
 * discoverable by the next implementer.
 *
 * Expected wiring: query collections keyed by team_id, e.g.
 *   drills:      collection('drills') filtered/global
 *   config:      doc(`teams/${teamId}/config/current`)
 *   teamInput:   doc(`teams/${teamId}/input/latest`)
 *
 * @param {{ db: unknown, teamId: string }} _opts
 * @returns {Storage}
 */
export function createFirestoreStorage(_opts) {
  throw new Error('createFirestoreStorage: not implemented in MVP (swap-in point for Firestore backend)');
}
