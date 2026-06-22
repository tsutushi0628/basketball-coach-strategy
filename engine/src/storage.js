/**
 * @file Storage abstraction layer.
 *
 * The rest of the engine depends only on the *shape* returned here, never on
 * where the data lives. Two backends share one interface so the same
 * `buildPlanData` runs against local JSON (static build) or Firestore
 * (Cloud Function) with only the storage factory swapped.
 *
 * Interface (all async): getDrills / getConfig / getTeamInput / getOverrides /
 * getAnnualPlan. getDrills returns *raw* (un-normalized) records; getOverrides
 * returns every coach override (across teams) so applyOverrides can match on the
 * override body's own `team` field, exactly as the single local overrides file did.
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
 * @property {() => Promise<Array<Object>>} getOverrides  Coach-authored day overrides (empty array when none).
 * @property {() => Promise<Object>} getAnnualPlan    Annual-plan document (months/peaks/...).
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
 * @param {string} [paths.overridesPath]  Optional path to coach-authored day overrides (array).
 * @param {string} [paths.annualPath]  Optional path to the annual-plan JSON.
 * @returns {Storage}
 */
export function createLocalStorage({ drillsPath, configPath, inputPath, overridesPath, annualPath }) {
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
    async getOverrides() {
      if (!overridesPath) return [];
      const data = await readJson(overridesPath);
      if (!Array.isArray(data)) {
        throw new Error(`overrides file must be a JSON array: ${overridesPath}`);
      }
      return data;
    },
    async getAnnualPlan() {
      if (!annualPath) {
        throw new Error('createLocalStorage: annualPath is required to call getAnnualPlan');
      }
      return readJson(annualPath);
    },
  };
}

/** doc-ID 文字種ゲート（コーチ入力由来の date を doc ID に使う前段の検証）。 */
const DATE_DOC_ID = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Firestore storage backend (Admin SDK). Mirrors createLocalStorage's contract.
 *
 * Collection layout (Admin SDK only — clients are blocked by rules):
 *   drills/{drillId}              raw catalog records (un-normalized).
 *   teams/{teamId}                team config doc.
 *   teams/{teamId}/input/latest   team-input doc (indicators).
 *   annualPlan/current            annual-plan doc.
 *   overrides/{date}              coach overrides, top-level & cross-team
 *                                 (getOverrides returns all of them so
 *                                 applyOverrides matches on each body's `team`).
 *
 * `db` is an already-initialized firebase-admin Firestore instance for the
 * named database; this module never imports firebase-admin so it stays usable
 * from the CLI and unit tests.
 *
 * @param {Object} opts
 * @param {import('firebase-admin/firestore').Firestore} opts.db
 * @param {string} opts.teamId  Team document id (e.g. "minami-nakano-boys").
 * @returns {Storage}
 */
export function createFirestoreStorage({ db, teamId }) {
  if (!db) throw new Error('createFirestoreStorage: db is required');
  if (!teamId) throw new Error('createFirestoreStorage: teamId is required');
  return {
    async getDrills() {
      const snap = await db.collection('drills').get();
      // 台帳順を id で安定化（pattern 描画の決定論性のため）。
      return snap.docs
        .map((d) => d.data())
        .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    },
    async getConfig() {
      const doc = await db.collection('teams').doc(teamId).get();
      if (!doc.exists) throw new Error(`Firestore: teams/${teamId} が見つかりません`);
      return /** @type {Config} */ (doc.data());
    },
    async getTeamInput() {
      const doc = await db.collection('teams').doc(teamId).collection('input').doc('latest').get();
      if (!doc.exists) throw new Error(`Firestore: teams/${teamId}/input/latest が見つかりません`);
      return /** @type {TeamInput} */ (doc.data());
    },
    async getOverrides() {
      const snap = await db.collection('overrides').get();
      return snap.docs
        .map((d) => d.data())
        // 念のため: doc ID 規約外の混入を読み側でも弾く（書き側のゲートと二重化）。
        .filter((o) => o && typeof o.date === 'string' && DATE_DOC_ID.test(o.date));
    },
    async getAnnualPlan() {
      const doc = await db.collection('annualPlan').doc('current').get();
      if (!doc.exists) throw new Error('Firestore: annualPlan/current が見つかりません');
      return doc.data();
    },
  };
}
