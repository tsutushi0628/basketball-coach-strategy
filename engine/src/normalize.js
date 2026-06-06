/**
 * @file Deterministic normalization of raw drill records into typed `Drill`s.
 *
 * The source catalog (docs/practice-knowledge/data/drills.json) stores several
 * fields as free Japanese text with caveats appended (e.g.
 * "全。膝・脛の張りに注意", "中学2〜3年(基本マイカン習得後)", "半面〜全面（ハーフコート展開可）").
 * These functions coerce those into stable enums / numbers / sets so all
 * downstream logic (filter, allocate, gates) can branch deterministically.
 *
 * Validated against all 211 records of the source catalog (2026-06).
 *
 * @typedef {import('./types.js').Drill} Drill
 * @typedef {import('./types.js').CourtEnum} CourtEnum
 * @typedef {import('./types.js').IntensityClass} IntensityClass
 * @typedef {import('./types.js').Grades} Grades
 */

const DEFAULT_DURATION_MIN = 10;
const DEFAULT_DURATION_MAX = 15;

/**
 * Normalize the free-text `court` field into an enum + a `requiresFull` flag.
 *
 * Semantics: the enum is the *minimum* footprint the drill needs. Range values
 * like "半面〜全面" resolve to their lower bound (半面), so they fit on a
 * half-court day. Only drills whose minimum is full court ("全面" with no
 * smaller bound) get `requiresFull = true` and are excluded from half-court days.
 * Off-court / circle / "不問" map to "不問" (no constraint).
 *
 * @param {unknown} raw
 * @returns {{ court: CourtEnum, requiresFull: boolean }}
 */
export function normalizeCourt(raw) {
  const s = String(raw ?? '不問').trim();
  const free = /不問|サークル|コート外/.test(s);
  const hasQuarter = /¼/.test(s);
  const hasHalf = /半面/.test(s);
  const hasFull = /全面/.test(s);

  if (free) return { court: '不問', requiresFull: false };
  if (hasQuarter) return { court: '¼', requiresFull: false };   // "¼" or "¼〜半面" → min ¼
  if (hasHalf) return { court: '半面', requiresFull: false };    // "半面" or "半面〜全面" → min 半面
  if (hasFull) return { court: '全面', requiresFull: true };     // only full court satisfies
  return { court: '不問', requiresFull: false };
}

/**
 * Normalize a duration value to a finite positive number, falling back to a
 * default when missing / non-numeric.
 * @param {unknown} raw
 * @param {number} fallback
 * @returns {number}
 */
export function normalizeDuration(raw, fallback) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Normalize the free-text `grades` field to either "全" or an ascending array
 * of middle-school year integers (1|2|3).
 *
 * Recognized forms (validated against the catalog):
 *  - "全" / "全。<caveat>"                  → "全"
 *  - "中学N〜M年" / "中学N年"               → [N..M] / [N]
 *  - "中N〜中M" / "中N〜M" / "中N"          → range / single
 *  - "小X〜中Y(...)"                        → [1..Y]
 *  - "中学全学年" / "中学生" / "中学(以上)" → [1,2,3]
 *  - bare "N〜M" / "N年" at head            → range / single (middle grades)
 *  - any other "中学..." mention            → [1,2,3] (conservative include)
 *  - age ranges / unparseable              → "全"
 *
 * @param {unknown} raw
 * @returns {Grades}
 */
export function normalizeGrades(raw) {
  if (raw == null) return '全';
  const s = String(raw).trim();
  // Strip caveats after the first 。 / ( / （ to inspect the leading clause.
  const head = s.split(/[。(（]/)[0].trim();
  if (/^全/.test(head)) return '全';

  // Spec #2: high-school-only / "試合不可" drills must NOT be exposed to middle
  // grades. Without this, a note that also mentions "中学" (e.g. "高校用。中学は
  // 試合不可") fell through to the generic 中学 branch below and resolved to the
  // full [1,2,3], so the drill could be selected for a middle-school team. Emit an
  // empty grade array (no middle grade 1-3 applies) so the F2 grade filter
  // (gradesFit: drill.grades.some(g ∈ teamGrades)) drops it for every
  // middle-school team while keeping the original text in gradesRaw for audit.
  if (/高校用|中学は試合不可|試合不可/.test(s)) {
    return /** @type {Grades} */ ([]);
  }

  /** @type {Set<number>} */
  const set = new Set();
  let m;

  // 中学N〜M年 / 中学N年 (digits follow 中学)
  const reGakuRange = /中学\s*([1-3])\s*[〜~\-]\s*([1-3])\s*年/g;
  while ((m = reGakuRange.exec(s))) for (let g = +m[1]; g <= +m[2]; g++) set.add(g);
  const reGakuSingle = /中学\s*([1-3])\s*年/g;
  while ((m = reGakuSingle.exec(s))) set.add(+m[1]);

  // 中N〜中M / 中N〜M
  const reRange = /中\s*([1-3])\s*[〜~\-]\s*中?\s*([1-3])/g;
  while ((m = reRange.exec(s))) {
    const a = +m[1], b = +m[2];
    for (let g = Math.min(a, b); g <= Math.max(a, b); g++) set.add(g);
  }
  // 中N (single, not part of a range and not 中N年 already handled)
  const reSingle = /中\s*([1-3])(?!\s*[〜~\-])(?!年)/g;
  while ((m = reSingle.exec(s))) set.add(+m[1]);

  // 小X〜中Y → include middle grades up to Y
  const reKtoM = /小[0-9]\s*[〜~\-]\s*中\s*([1-3])/g;
  while ((m = reKtoM.exec(s))) for (let g = 1; g <= +m[1]; g++) set.add(g);

  // Generic "中学全学年 / 中学生 / 中学入門 / 中学(以上)…" — all middle grades.
  if (set.size === 0 &&
      /中学全学年|中学生|中学入門|中学.*以上|中学に明示|中学年代|中学導入|中学高学年/.test(s)) {
    for (const g of [1, 2, 3]) set.add(g);
  }

  // Bare leading "N〜M" or "N年" (middle grades implied by context).
  if (set.size === 0) {
    if ((m = /^([1-3])\s*[〜~\-]\s*([1-3])/.exec(head))) {
      for (let g = +m[1]; g <= +m[2]; g++) set.add(g);
    } else if ((m = /^([1-3])年/.exec(head))) {
      set.add(+m[1]);
    }
  }

  // Mentions 中学 but no specific grade extracted → conservatively all grades.
  if (set.size === 0 && /中学/.test(s)) for (const g of [1, 2, 3]) set.add(g);

  if (set.size === 0) return '全'; // ages / unparseable → treat as all-grade
  return /** @type {Grades} */ ([...set].sort((a, b) => a - b));
}

/**
 * Normalize the intensity class to the {低|中|高} enum, defaulting to 中.
 * @param {unknown} raw
 * @returns {IntensityClass}
 */
export function normalizeIntensity(raw) {
  const s = String(raw ?? '').trim();
  if (s === '高') return '高';
  if (s === '低') return '低';
  return '中';
}

/**
 * Normalize one raw drill record into a typed `Drill`.
 * Preserves original free-text values in `*Raw` fields for audit, and builds a
 * lowercased `searchText` used by keyword-based filters (zone/sets/FT).
 *
 * @param {Object} raw  A record from drills.json.
 * @returns {Drill}
 */
export function normalizeDrill(raw) {
  const { court, requiresFull } = normalizeCourt(raw.court);
  const intensity_class = normalizeIntensity(raw.intensity_class);
  const tags = Array.isArray(raw.philosophy_tags) ? raw.philosophy_tags : [];

  const searchText = [
    raw.name, raw.category, raw.sub_skill, raw.notes,
    raw.metric_meaning, tags.join(' '), raw.grades,
  ].filter(Boolean).join(' ').toLowerCase();

  return {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? ''),
    category: String(raw.category ?? ''),
    sub_skill: String(raw.sub_skill ?? ''),
    metric_meaning: String(raw.metric_meaning ?? ''),
    court,
    requiresFull,
    courtRaw: String(raw.court ?? ''),
    duration_min: normalizeDuration(raw.duration_min, DEFAULT_DURATION_MIN),
    duration_max: normalizeDuration(raw.duration_max, DEFAULT_DURATION_MAX),
    grades: normalizeGrades(raw.grades),
    gradesRaw: String(raw.grades ?? ''),
    intensity_class,
    isHigh: intensity_class === '高',
    load_notes: String(raw.load_notes ?? ''),
    mastery_stage: String(raw.mastery_stage ?? ''),
    philosophy_tags: tags.map(String),
    notes: String(raw.notes ?? ''),
    source_name: raw.source_name,
    source_url: raw.source_url,
    video_url: raw.video_url,
    provenance: raw.provenance,
    source_kind: raw.source_kind,
    searchText,
  };
}

/**
 * Normalize an array of raw drill records.
 * @param {Object[]} rawDrills
 * @returns {Drill[]}
 */
export function normalizeDrills(rawDrills) {
  return rawDrills.map(normalizeDrill);
}
