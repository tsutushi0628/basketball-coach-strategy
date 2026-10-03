/**
 * @file Deterministic roster-sheet normalization（男女別タブ・選手ID自動付与）。
 *
 * 1枚のタブ（`values` = ヘッダ行 + データ行）を1回の呼び出しで正規化する。性別はタブ名
 * （男子→'M' / 女子→'F'）が決めるので引数で受け取り、シートに性別の列は無い。
 * 純関数 — I/O も Firestore も Sheets クライアントも持たない。
 *
 * ヘッダ（A〜M列）:
 *   選手ID / 表示名 / 学年 / ポジション / 利き手 / 在籍状態 / 身長cm / Tier /
 *   役割1 / 役割2 / 役割3 / 本人の目標 / メモ
 *
 * 選手ID列は空欄運用。空欄の行には性別プレフィクス＋3桁連番（M001… / F001…）を、
 * 同じタブ内の既存IDと衝突しない未使用の最小番号から行の出現順に割り当て、
 * 「どのシート行にどのIDを振ったか」を `assignedIds` で返す（呼び出し側がシートへ書き戻す）。
 * 既に入っているIDは絶対に変えない。
 *
 * Tier 列はシート上が S/A/B/C/D（S=5 / A=4 / B=3 / C=2 / D=1・S が最強）で、エンジン内部の
 * tier は従来どおり 1〜5 の整数。旧表記の 1〜5 の数字入力も受ける（`parseTier`）。
 *
 * spec: docs/findings/spec-20260905-scrimmage-split.md §2.1, §10-A（男女別タブ改修で更新）。
 */

import { ROLE_LABELS, ROLE_GROUPS } from './scrimmage.js';

/** Set of every valid canonical role id (both label-mapped and bare ids). */
const VALID_ROLE_IDS = new Set([
  ...Object.values(ROLE_LABELS),
  ...Object.values(ROLE_GROUPS).flat(),
]);

/** 新ヘッダ（A〜M列）。役割は3列に分かれている。 */
const HEADER_COLUMNS = [
  '選手ID',
  '表示名',
  '学年',
  'ポジション',
  '利き手',
  '在籍状態',
  '身長cm',
  'Tier',
  '役割1',
  '役割2',
  '役割3',
  '本人の目標',
  'メモ',
];

/** 役割列は単一選択だが、手入力の区切り（カンマ・読点・空白・改行）も従来どおり許す。 */
const ROLE_SPLIT_RE = /[,，、\r\n　 ]+/;

/** 既存の選手IDとして受け入れる書式（Firestore のドキュメントIDに安全な範囲だけ）。 */
const EXISTING_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

/** Split-and-trim a 役割 cell into raw (untranslated) tokens. */
function splitRoleTokens(cell) {
  return String(cell ?? '')
    .split(ROLE_SPLIT_RE)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Resolve raw role tokens from several cells to canonical ids, dropping unknown words, deduped. */
function resolveRoles(cells) {
  const out = new Set();
  for (const cell of cells) {
    for (const token of splitRoleTokens(cell)) {
      if (Object.prototype.hasOwnProperty.call(ROLE_LABELS, token)) {
        out.add(ROLE_LABELS[token]);
      } else if (VALID_ROLE_IDS.has(token)) {
        out.add(token);
      }
      // unknown word → dropped silently, not counted in `missing`
    }
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

/** シートの Tier 表記（S/A/B/C/D）→ エンジン内部の 1〜5。S が最強。 */
const TIER_LETTERS = { S: 5, A: 4, B: 3, C: 2, D: 1 };

/**
 * Tier セルを内部表現（1〜5 の整数）へ写す純関数。
 * シートの入力は S/A/B/C/D（小文字・全角英字・前後空白も可）。旧表記の 1〜5 の数字も受ける。
 * 不正値・空欄は null（呼び出し側が既定値 3 を入れて `missing` に載せる）。
 * @param {*} raw
 * @returns {1|2|3|4|5|null}
 */
export function parseTier(raw) {
  // 全角英字・全角数字は NFKC で半角へ畳んでから判定する（I/O は持ち込まない）。
  const s = String(raw ?? '').normalize('NFKC').trim().toUpperCase();
  if (s === '') return null;
  if (Object.prototype.hasOwnProperty.call(TIER_LETTERS, s)) return TIER_LETTERS[s];
  return toIntOrNull(s, 1, 5);
}

/** 'M' + 7 → 'M007'（1000以上は桁がそのまま伸びる）。 */
function formatPlayerId(gender, n) {
  return `${gender}${String(n).padStart(3, '0')}`;
}

/**
 * 1枚のタブ（ヘッダ行 + データ行）を正規化する。性別はタブ名由来を引数で受ける。
 *
 * @param {string[][]} values `values[0]` がヘッダ行。`values[0]` はシートの1行目に対応する
 *   （取得範囲が A1 始まりである前提。データ行 index r → シート行 r+1）。
 * @param {'M'|'F'} gender タブ名が決める性別。
 * @returns {{
 *   players: Array<{
 *     playerId: string, name: string, gender: 'M'|'F', grade: 1|2|3,
 *     active: boolean, heightCm: number, tier: 1|2|3|4|5, roles: string[],
 *     missing: string[]
 *   }>,
 *   skipped: number,
 *   assignedIds: Array<{row:number, playerId:string}>
 * }}
 */
export function normalizeRoster(values, gender) {
  if (gender !== 'M' && gender !== 'F') {
    throw new Error("normalizeRoster: gender は 'M' か 'F' です");
  }
  if (!Array.isArray(values) || values.length === 0) {
    return { players: [], skipped: 0, assignedIds: [] };
  }
  const header = values[0];
  const colIndex = {};
  for (const name of HEADER_COLUMNS) {
    colIndex[name] = Array.isArray(header) ? header.indexOf(name) : -1;
  }

  let skipped = 0;
  const provisional = [];

  // 1周目: 行を読み、既存IDを集める（ID未記入の行は後で採番する）。
  for (let r = 1; r < values.length; r++) {
    const row = values[r] ?? [];
    const cell = (name) => (colIndex[name] >= 0 ? row[colIndex[name]] : undefined);

    // 表示名: trim, 1-30 文字。空（または長すぎ）はスキップ＝IDも振らない。
    const name = String(cell('表示名') ?? '').trim();
    if (name.length < 1 || name.length > 30) {
      skipped += 1;
      continue;
    }

    // 選手ID: 空欄なら後で自動付与。入っていれば絶対に変えない（書式が壊れている行だけスキップ）。
    const rawId = String(cell('選手ID') ?? '').trim();
    if (rawId !== '' && !EXISTING_ID_RE.test(rawId)) {
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

    // 身長cm: integer 100-220, else fill later from the median of this tab
    const heightRaw = toIntOrNull(cell('身長cm'), 100, 220);

    // Tier: シート表記 S/A/B/C/D（旧表記の 1〜5 も可）→ 内部 1〜5。不正値・空欄は 3 で missing。
    let tier = parseTier(cell('Tier'));
    if (tier === null) {
      tier = 3;
      missing.push('tier');
    }

    // 役割1〜3: 既知語だけ・重複除去。全部空なら missing。
    const roles = resolveRoles([cell('役割1'), cell('役割2'), cell('役割3')]);
    if (roles.length === 0) missing.push('roles');

    provisional.push({
      sheetRow: r + 1, // values[0] がシート1行目なので、データ行 index r はシート行 r+1。
      playerId: rawId, // '' のままなら採番対象。
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

  // 2周目: 未記入の選手IDを採番する。既存IDが使っている番号を避け、未使用の最小番号を
  // 行の出現順に割り当てる（同じシートなら結果は毎回同じ＝決定論）。
  const usedNumbers = new Set();
  const idPattern = new RegExp(`^${gender}(\\d+)$`);
  for (const p of provisional) {
    const m = p.playerId.match(idPattern);
    if (m) usedNumbers.add(Number(m[1]));
  }
  const assignedIds = [];
  let next = 1;
  for (const p of provisional) {
    if (p.playerId !== '') continue;
    while (usedNumbers.has(next)) next += 1;
    usedNumbers.add(next);
    p.playerId = formatPlayerId(gender, next);
    assignedIds.push({ row: p.sheetRow, playerId: p.playerId });
  }

  // Fill missing heights from the median of this tab's valid values (§2.1・タブ=同性別)。
  const validHeights = provisional.filter((p) => p.heightRaw !== null).map((p) => p.heightRaw);
  const median = lowerMedian(validHeights);

  const players = provisional.map((p) => {
    const { heightRaw, sheetRow, ...rest } = p;
    if (heightRaw !== null) {
      return { ...rest, heightCm: heightRaw };
    }
    const fallback = median ?? 160;
    return { ...rest, heightCm: fallback, missing: [...p.missing, 'heightCm'] };
  });

  // Keep §2.1 column order in `missing`: grade, heightCm, tier, roles.
  const order = ['grade', 'heightCm', 'tier', 'roles'];
  for (const p of players) {
    p.missing.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  }

  return { players, skipped, assignedIds };
}
