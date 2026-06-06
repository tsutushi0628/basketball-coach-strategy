/**
 * @file The ONLY LLM injection point in the engine.
 *
 * Everything else (gap math, filtering, load budget, allocation, gates, format)
 * is deterministic code. This module isolates the single genuinely fuzzy task:
 * mapping a free-text coach comment to a known drill category. That is the only
 * thing an LLM would ever be asked to do here — interpret ambiguous natural
 * language and bucket it into an existing category.
 *
 * MVP behavior: NO real LLM call. A deterministic keyword map stands in, so the
 * engine has zero network/API dependency and stays fully reproducible. When a
 * real model is wired in later, replace ONLY the body of
 * `mapCoachCommentToCategory` with a Cloud Functions / Gemini call that returns
 * one of the known categories. The surrounding contract (string in, category
 * string or null out) must not change.
 *
 * Design rule honored: the LLM is never given thresholds, counting, sorting,
 * dedup, or formatting — only "which existing category does this sentence mean".
 */

/**
 * Known categories the comment may resolve to (must match catalog categories).
 * Kept here so the keyword map and any future prompt share one vocabulary.
 * @type {string[]}
 */
export const KNOWN_CATEGORIES = [
  'ハンドリング/ドリブル',
  'シュート',
  'フィニッシュ(ゴール下/レイアップ)',
  'パス&スペーシング',
  '1on1',
  'チームオフェンス(アーリー/トランジション)',
  'チームディフェンス(オールコートマンツー/ヘルプ/帰陣)',
  'リバウンド/ボックスアウト',
  'フットワーク/アジリティ/ピボット',
  'コンディショニング/ウォームアップ',
  '傷害予防/NMT',
  '意思決定/ゲーム形式',
];

/**
 * Ordered keyword → category rules. First match wins. This is the MVP stand-in
 * for an LLM classifier — intentionally simple and deterministic.
 * @type {Array<{ re: RegExp, category: string }>}
 */
const KEYWORD_RULES = [
  { re: /フリースロー|ft|シュート|得点力|決め切/i, category: 'シュート' },
  { re: /ゴール下|レイアップ|フィニッシュ|決定力/i, category: 'フィニッシュ(ゴール下/レイアップ)' },
  { re: /ドリブル|ハンドリング|ボール運び|キープ/i, category: 'ハンドリング/ドリブル' },
  { re: /パス|スペーシング|展開|繋ぎ/i, category: 'パス&スペーシング' },
  { re: /1on1|一対一|抜き|個の/i, category: '1on1' },
  { re: /トランジション|速攻|アーリー|走/i, category: 'チームオフェンス(アーリー/トランジション)' },
  { re: /ディフェンス|守備|マンツー|帰陣|ヘルプ/i, category: 'チームディフェンス(オールコートマンツー/ヘルプ/帰陣)' },
  { re: /リバウンド|ボックスアウト|競り/i, category: 'リバウンド/ボックスアウト' },
  { re: /フットワーク|アジリティ|ピボット|足/i, category: 'フットワーク/アジリティ/ピボット' },
  { re: /ターンオーバー|to|判断|読み|ゲーム形式|実戦/i, category: '意思決定/ゲーム形式' },
  { re: /ウォーム|アップ|コンディショ|体力/i, category: 'コンディショニング/ウォームアップ' },
  { re: /怪我|傷害|予防|ケア/i, category: '傷害予防/NMT' },
];

/**
 * Map a free-text coach comment to a known drill category.
 *
 * MVP: deterministic keyword match (no LLM call). Returns the matched category
 * string, or null when nothing matches (caller falls back to gap-derived
 * weights — the comment is advisory, never load-bearing).
 *
 * @param {string} comment  Free-text coach note, e.g. "今週はゴール下の決定力を上げたい".
 * @returns {string|null}  One of KNOWN_CATEGORIES, or null.
 */
export function mapCoachCommentToCategory(comment) {
  if (!comment || typeof comment !== 'string') return null;
  const text = comment.trim();
  if (!text) return null;
  for (const { re, category } of KEYWORD_RULES) {
    if (re.test(text)) return category;
  }
  return null;
}
