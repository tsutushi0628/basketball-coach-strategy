/**
 * @file Deterministic roster-sheet normalization.
 *
 * Turns the raw `values` matrix from the Google Sheets API (header row +
 * data rows) into the roster shape the scrimmage engine and Firestore sync
 * use. Pure function — no I/O, no Firestore, no Sheets client.
 *
 * spec: docs/findings/spec-20260905-scrimmage-split.md §2.1, §10-A.
 */

import { ROLE_LABELS, ROLE_GROUPS } from './scrimmage.js';

/** Set of every valid canonical role id (both label-mapped and bare ids). */
const VALID_ROLE_IDS = new Set([
  ...Object.values(ROLE_LABELS),
  ...Object.values(ROLE_GROUPS).flat(),
]);

const HEADER_COLUMNS = [
  '選手ID',
  '表示名',
  '性別',
  '学年',
  '在籍状態',
  '身長cm',
  'Tier',
  '役割',
];

const ROLE_SPLIT_RE = /[,，、\r\n　 ]+/;

/** Split-and-trim a 役割 cell into raw (untranslated) tokens. */
function splitRoleTokens(cell) {
  return String(cell ?? '')
    .split(ROLE_SPLIT_RE)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Resolve raw role tokens to canonical ids, dropping unknown words, deduped. */
function resolveRoles(cell) {
  const out = new Set();
  for (const token of splitRoleTokens(cell)) {
    if (Object.prototype.hasOwnProperty.call(ROLE_LABELS, token)) {
      out.add(ROLE_LABELS[token]);
    } else if (VALID_ROLE_IDS.has(token)) {
      out.add(token);
    }
    // unknown word → dropped silently, not counted in `missing`
  }
  return [...out];
}

/** Median of a numeric array, "smaller of the two middles" on ties (even n). §2.1. */
function lowerMedian(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor((sorted.length - 1) / 2);
  return sorted[idx];
}

function toIntOrNull(raw, min, max) {
  const n = Number(String(raw ?? '').trim());
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

/**
 * Normalize the roster spreadsheet's raw `values` matrix (header + rows).
 * §2.1, §10-A.
 *
 * @param {string[][]} values `values[0]` is the header row.
 * @returns {{
 *   players: Array<{
 *     playerId: string, name: string, gender: 'M'|'F', grade: 1|2|3,
 *     active: boolean, heightCm: number, tier: number, roles: string[],
 *     missing: string[]
 *   }>,
 *   skipped: number
 * }}
 */
export function normalizeRoster(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return { players: [], skipped: 0 };
  }
  const header = values[0];
  const colIndex = {};
  for (const name of HEADER_COLUMNS) {
    colIndex[name] = header.indexOf(name);
  }

  let skipped = 0;
  const provisional = [];

  for (let r = 1; r < values.length; r++) {
    const row = values[r] ?? [];
    const cell = (name) => row[colIndex[name]];

    // 選手ID: ^[MF]\d{2}$
    const rawId = String(cell('選手ID') ?? '').trim();
    if (!/^[MF]\d{2}$/.test(rawId)) {
      skipped += 1;
      continue;
    }

    // 表示名: trim, 1-30 chars
    const name = String(cell('表示名') ?? '').trim();
    if (name.length < 1 || name.length > 30) {
      skipped += 1;
      continue;
    }

    // 性別: first char 男→M, 女→F, else skip
    const rawGender = String(cell('性別') ?? '').trim();
    const genderChar = rawGender.charAt(0);
    let gender;
    if (genderChar === '男') gender = 'M';
    else if (genderChar === '女') gender = 'F';
    else {
      skipped += 1;
      continue;
    }

    const missing = [];

    // 学年: integer 1-3, default 1
    let grade = toIntOrNull(cell('学年'), 1, 3);
    if (grade === null) {
      grade = 1;
      missing.push('grade');
    }

    // 在籍状態: contains "在籍" → true
    const active = String(cell('在籍状態') ?? '').includes('在籍');

    // 身長cm: integer 100-220, else fill later from same-gender median
    const heightRaw = toIntOrNull(cell('身長cm'), 100, 220);

    // Tier: integer 1-5, default 3
    let tier = toIntOrNull(cell('Tier'), 1, 5);
    if (tier === null) {
      tier = 3;
      missing.push('tier');
    }

    // 役割: known vocabulary only, dedup; empty → missing
    const roles = resolveRoles(cell('役割'));
    if (roles.length === 0) missing.push('roles');

    provisional.push({
      playerId: rawId,
      name,
      gender,
      grade,
      active,
      heightRaw,
      tier,
      roles,
      missing,
    });
  }

  // Fill missing heights from the same-gender median of valid values (§2.1).
  const validHeightsByGender = { M: [], F: [] };
  for (const p of provisional) {
    if (p.heightRaw !== null) validHeightsByGender[p.gender].push(p.heightRaw);
  }
  const medianByGender = {
    M: lowerMedian(validHeightsByGender.M),
    F: lowerMedian(validHeightsByGender.F),
  };

  const players = provisional.map((p) => {
    const { heightRaw, ...rest } = p;
    if (heightRaw !== null) {
      return { ...rest, heightCm: heightRaw };
    }
    const fallback = medianByGender[p.gender] ?? 160;
    return { ...rest, heightCm: fallback, missing: [...p.missing, 'heightCm'] };
  });

  // Keep §2.1 column order in `missing`: grade, heightCm, tier, roles.
  const order = ['grade', 'heightCm', 'tier', 'roles'];
  for (const p of players) {
    p.missing.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  }

  return { players, skipped };
}
