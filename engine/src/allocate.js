/**
 * @file Deterministic per-day allocation as a FIXED 6-block session (作り直し方針2).
 *
 * A practice day is built as the coach's固定セッション形＝6つの固定ブロックを必ずこの順で:
 *
 *   アップ → ファンダ → シュート → 対人 → ラン(走り込み) → 静的ストレッチ
 *   (warm-up → fundamentals → shooting → contested → conditioning run → static stretch)
 *
 * 各ブロックは「月の主眼」で埋める。ブロックの尺は曜日枠テンプレ（全面/半面・分数・走り込み分）で
 * 与え、その中身は『習熟段階(mastery_stage) × 狙い(philosophy_tags) の教育的フィット』で選ぶ。
 *
 * 撤去した3点（旧 allocate に同居していた）:
 *   ① 速攻/守備の毎週強制フロア（哲学フロア先取り）
 *   ② 必ずゲームで締める固定枠（GAME_CATEGORY 予約）
 *   ③ カテゴリ内ドリルの duration_max 降順（自然長が長い順）選定
 *
 * これらの代わりに:
 *   - 量はブロックテンプレ＋月の主眼で決まる（フロアではない）。チームDF/速攻は対人ブロックの
 *     受けカテゴリとして月の focus_weights ぶん自然に乗る。
 *   - 意思決定/ゲーム形式（5on5/スクリメージ）は独立ブロックを廃し、対人ブロックの末尾候補に格下げ。
 *     全面の日 かつ 週の焦点が allow_scrimmage のときだけ置く（半面の水木は出さない）。対人は基本
 *     「1on1 と 3on3」だけ（刻まない）。
 *   - ドリルは educationalFitScore（習熟段階×狙い×主眼補正）で選ぶ。自然長は選定根拠にしない。
 *
 * コンディショニング/ウォームアップ1カテゴリは philosophy_tags で3用途に振り分ける:
 *   アップ=ウォームアップ群、ラン=心肺/持久/スプリント/サーキット/パワー群、静的=クールダウン/整理運動群。
 *
 * 週内重複排除(usedIds)・同日重複ガード・load budget(canPlaceHigh/recordHigh/endDay)・5分丸めは流用。
 * coach-absent 日は主ブロックの選定プールを自走可能内容に絞る（WU/CD相当のアップ/静的は毎日）。
 *
 * 選定は貪欲で決定論（乱数なし）: 同じ入力 ⇒ 同じプラン。
 *
 * @typedef {import('./types.js').Drill} Drill
 * @typedef {import('./types.js').Config} Config
 * @typedef {import('./types.js').PlanBlock} PlanBlock
 * @typedef {import('./types.js').PlanItem} PlanItem
 * @typedef {import('./types.js').PlanDay} PlanDay
 * @typedef {import('./types.js').WeekFocus} WeekFocus
 */

import { isHighIntensity } from './loadModel.js';
import { isCoachAbsentEligible, needsCoach, coachingMode } from './filter.js';

/** Conditioning / warm-up catalog category (split 3 ways into アップ / ラン / 静的). */
const COND_CATEGORY = 'コンディショニング/ウォームアップ';
/** Injury-prevention / NMT category — activation work that belongs in the warm-up. */
const INJURY_CATEGORY = '傷害予防/NMT';
/** Game-form (scrimmage) category — placed only at the 対人 block tail on full-court days. */
const GAME_CATEGORY = '意思決定/ゲーム形式';

// ── Fixed 6-block skeleton (作り直し方針2) ────────────────────────────────────

/** The fixed block keys, in fixed presentation order (固定ブロック順). */
export const BLOCK_ORDER = ['アップ', 'ファンダ', 'シュート', '対人', 'ラン', '静的'];

/** Bundle blocks (routine bookends + conditioning run) — exempt from week-scope dedup. */
const BUNDLE_BLOCKS = new Set(['アップ', 'ラン', '静的']);

/**
 * Fundamentals block categories (ファンダ): the owner's three fundamentals ONLY —
 * handling, passing, footwork. ファンダ＝ハンドリング/パス/フットワークの3つだけ。
 * Scoring actions (finishing / Mikan / layups / catch-&-shoot) are NEVER fundamentals;
 * they all belong to the shooting block (see SHOOT_CATEGORIES / blockOf below).
 */
const FUNDA_CATEGORIES = new Set([
  'ハンドリング/ドリブル',
  'パス&スペーシング',
  'フットワーク/アジリティ/ピボット',
]);

/**
 * Shooting block categories (シュート): every scoring action at/around the rim and beyond —
 * catch-&-shoot, free-throw, AND all finishing (ゴール下/レイアップ/マイカン). Finishing is a
 * scoring action, so it is ALWAYS shooting. The separate finishing category was retired —
 * all scoring actions live under the single シュート category, so this set holds only シュート.
 */
const SHOOT_CATEGORIES = new Set([
  'シュート',
]);

/**
 * Contested block categories (対人): live-vs-opponent / team tactics. The owner's rule is
 * 対人＝基本「1on1 と 3on3」だけ（刻まない）。1on1 / team-D(3on3) carry it; rebound / team-O are
 * supporting contested work. 意思決定/ゲーム形式 is NOT here — it is the tail scrimmage only.
 */
const CONTESTED_CATEGORIES = new Set([
  '1on1',
  'チームディフェンス(オールコートマンツー/ヘルプ/帰陣)',
  'チームオフェンス(アーリー/トランジション)',
  'リバウンド/ボックスアウト',
]);

/**
 * Which fixed block a drill belongs to (null = not a main-block drill, e.g. injury
 * prevention that isn't warm-up activation). Finishing (ゴール下/レイアップ/マイカン) is a
 * scoring action, so it ALWAYS goes to the shooting block regardless of mastery stage —
 * fundamentals are the owner's three基礎 only (handling / passing / footwork). The shooting
 * block therefore carries every finishing drill (close-range base reps AND running/C2C
 * finishes), matching the owner's rule ファンダ=3基礎だけ・得点動作は全てシュート枠.
 *
 * @param {Drill} drill
 * @returns {('アップ'|'ファンダ'|'シュート'|'対人'|'ラン'|'静的'|null)}
 */
export function blockOf(drill) {
  const cat = drill.category;
  if (cat === COND_CATEGORY || cat === INJURY_CATEGORY) {
    if (isStaticCool(drill)) return '静的';
    if (isRunConditioning(drill)) return 'ラン';
    return 'アップ'; // warm-up activation / mobility / NMT
  }
  if (FUNDA_CATEGORIES.has(cat)) return 'ファンダ';
  if (SHOOT_CATEGORIES.has(cat)) return 'シュート'; // シュート＋フィニッシュ＝全て得点動作→シュート枠
  if (CONTESTED_CATEGORIES.has(cat)) return '対人';
  if (cat === GAME_CATEGORY) return null; // scrimmage is the 対人-tail special case, not a block
  return null;
}

/**
 * Which of the EDITOR's 7 blocks a drill belongs to — the manual-edit mirror of the auto-generated
 * 6-block mapping. The editor exposes one extra block, ゲーム, so the coach can hand-place the
 * session-ending 5on5 / scrimmage (意思決定/ゲーム形式) as its own block; in the auto session that
 * game-form work is not a fixed block (it rides the 対人 tail), which is why blockOf returns null
 * for it. editorBlockOf delegates to blockOf for the 6 auto blocks (so all finishing → シュート枠 is
 * inherited, not re-decided here — 得点動作は全てシュート、ファンダは3基礎だけ) and only adds the
 * ゲーム branch. blockOf stays the single source of truth for block judgement; this function adds
 * nothing to it beyond surfacing the game category as an editor-only block.
 *
 * @param {Drill} drill
 * @returns {('アップ'|'ファンダ'|'シュート'|'対人'|'ラン'|'静的'|'ゲーム'|null)}
 */
export function editorBlockOf(drill) {
  return blockOf(drill) || (drill.category === GAME_CATEGORY ? 'ゲーム' : null);
}

/** Round to the nearest 5 minutes (the coach's display / planning grain). */
function round5(x) {
  return Math.round(x / 5) * 5;
}
/** clamp(x, lo, hi). */
function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

/** Jump-drill names that must never appear in the static-stretch block (安全網). */
const JUMP_NAME_RE =
  /ポゴ|バウンディング|ジャンプキック|スクワットジャンプ|ジャンプ|跳び|バウンド|ホップ|プライオ/;

/**
 * Static cool-down marker (静的ストレッチブロック適格). Positive test: a クールダウン /
 * 整理運動 philosophy tag or a static-recovery sub_skill, and never high-intensity or a jump.
 * @param {Drill} drill
 * @returns {boolean}
 */
export function isStaticCool(drill) {
  if (drill.intensity_class === '高') return false;
  if (JUMP_NAME_RE.test(drill.name)) return false;
  const tags = Array.isArray(drill.philosophy_tags) ? drill.philosophy_tags : [];
  if (tags.includes('クールダウン') || tags.includes('整理運動')) return true;
  // Injury-prevention / NMT strength & stability work (e.g. FIFA11+ 体幹プランク) is warm-up
  // activation, not a settle-down stretch — exclude it from the static-stretch block even when
  // its sub_skill mentions 静的安定性. Only an explicit cool-down tag (handled above) moves NMT
  // into the static block.
  if (drill.category === INJURY_CATEGORY) return false;
  // A cool-down sub_skill keyword, but exclude "静的安定性" (a stability quality, not a stretch).
  const sub = drill.sub_skill ?? '';
  if (/静的安定|静的\/動的|動的安定/.test(sub)) return false;
  return /静的|整理|鎮静|呼吸|クールダウン|筋温|リカバリ|筋膜/.test(sub);
}

/** Backward-compatible alias: the cool-down-eligibility predicate (used by gates/tests). */
export const isCoolDownEligible = isStaticCool;

/**
 * Conditioning-run marker (ラン/走り込みブロック適格). Cardio / endurance / sprint / circuit /
 * power conditioning — the 走り込み the owner programs (5BB / HIIT / 階段 / シャトル / 縄跳び等).
 * Positive test on philosophy_tags / sub_skill; static cool-down work is excluded first.
 * @param {Drill} drill
 * @returns {boolean}
 */
export function isRunConditioning(drill) {
  if (isStaticCool(drill)) return false;
  const tags = Array.isArray(drill.philosophy_tags) ? drill.philosophy_tags : [];
  const hay = `${tags.join(' ')} ${drill.sub_skill ?? ''} ${drill.name ?? ''}`;
  if (tags.includes('ウォームアップ')) return false; // warm-up activation, not a run
  return /心肺|持久|スプリント|サーキット|無酸素持久|脚パワー|水平パワー|垂直パワー|横方向パワー|反応筋力|弾性接地|爆発力|ダッシュ|階段|シャトル|縄跳び|実戦的コンディション/.test(
    hay,
  );
}

/** Footwork/agility category — ladder / agility / pivot work (ラダー等). */
const AGILITY_CATEGORY = 'フットワーク/アジリティ/ピボット';

/**
 * Agility / footwork marker for the OUTDOOR run-and-agility session (火の外トレ＝走り込み・
 * アジリティ). The owner's 外トレ60 is ラダー/5BB/HIIT/階段/シャトル — i.e. conditioning runs PLUS
 * ladder/agility footwork. blockOf routes フットワーク/アジリティ to the ファンダ block, so on the
 * normal court session those drills are fundamentals; but the outdoor run part has no ファンダ
 * block, so it pulls agility drills (ラダー等) into its run/agility pool via this predicate.
 * @param {Drill} drill
 * @returns {boolean}
 */
export function isAgilityDrill(drill) {
  if (drill.category !== AGILITY_CATEGORY) return false;
  const hay = `${drill.name ?? ''} ${drill.sub_skill ?? ''} ${(drill.philosophy_tags ?? []).join(' ')}`;
  return /ラダー|アジリティ|ステップ|クイックネス|敏捷|切り返し|方向転換|フットワーク|シャトル/.test(hay);
}

/** Cool-down routine progression rank (0=軽有酸素鎮静 / 1=静的ストレッチ / 2=呼吸・リカバリ). */
export function coolDownStage(drill) {
  const text = `${drill.name} ${drill.sub_skill ?? ''}`;
  if (/ジョグ|ウォーク|有酸素/.test(text)) return 0;
  if (/静的|ストレッチ/.test(text)) return 1;
  return 2;
}

/**
 * Does a drill belong to the FT-only subset? FT matching is limited to name/sub_skill.
 * @param {Drill} drill
 * @returns {boolean}
 */
function isFtDrill(drill) {
  return /フリースロー|FT/i.test(`${drill.name} ${drill.sub_skill}`);
}

/** Is a drill a half-court-or-smaller, non-scrimmage 1on1 / 3on3 contested drill? */

/** Intensity ordering helper for warm-up (低=0, 中=1, 高=2). */
function intensityRank(drill) {
  return drill.intensity_class === '低' ? 0 : drill.intensity_class === '中' ? 1 : 2;
}

// ── Educational-fit selection (撤去③ 自然長降順の置換) ─────────────────────────

/** Settled-stage rank for a mastery_stage string (low = earlier learning stage). */
function masteryRank(stage) {
  const s = String(stage || '');
  // Judge by the FIRST segment of a compound (習得→反復 → 習得).
  if (s.startsWith('習得')) return 0;
  if (s.startsWith('反復')) return 1;
  if (s.startsWith('実戦化')) return 2;
  return 1; // unknown → treat as mid (反復) so it neither wins nor loses outright
}

/**
 * Educational-fit score for a drill given the week's focus and the month's emphasis.
 * Replaces the old duration_max-descending pick (撤去③). Higher = better fit. Pure integer
 * scoring, deterministic:
 *   (1) mastery_bias 一致: the week prescribes which stage to drill (型づくり週=習得寄り、
 *       反復週=反復/実戦化寄り). A drill whose stage matches the week's bias scores highest;
 *       earlier-in-list bias entries weigh more.
 *   (2) philosophy_tags 一致: tokens shared with the month's headline (両手強化・成長期基礎・
 *       走り込みフィニッシュ 等) — the狙い fit.
 *   (3) focus_weights 補正: a small nudge by the month's category weight (selection preference
 *       only — it does NOT size the block; quantity comes from the template).
 *
 * @param {Drill} drill
 * @param {WeekFocus} weekFocus
 * @param {Object<string, number>} finalWeights
 * @param {Set<string>} headlineTokens  tokens drawn from the month/week headline.
 * @returns {number}
 */
function educationalFitScore(drill, weekFocus, finalWeights, headlineTokens) {
  let score = 0;

  // (1) mastery_bias fit — strongest signal.
  const bias = Array.isArray(weekFocus?.mastery_bias) ? weekFocus.mastery_bias : [];
  const stage = String(drill.mastery_stage || '');
  for (let i = 0; i < bias.length; i++) {
    // First segment match (習得→反復 matches 習得 and 反復).
    const want = bias[i];
    if (stage === want || stage.split(/→/).includes(want)) {
      score += (bias.length - i) * 10; // earlier bias entries weigh more
      break;
    }
  }

  // (2) philosophy_tags fit against the month/week headline tokens.
  const tags = Array.isArray(drill.philosophy_tags) ? drill.philosophy_tags : [];
  if (headlineTokens && headlineTokens.size > 0) {
    for (const t of tags) {
      for (const tok of headlineTokens) {
        if (tok.length >= 2 && (t.includes(tok) || tok.includes(t))) {
          score += 2;
        }
      }
    }
  }

  // (3) focus_weights nudge (selection preference, not sizing).
  const w = finalWeights?.[drill.category];
  if (Number.isFinite(w)) score += Math.round(w * 5);

  return score;
}

/** Tokenize a free-text headline into ≥2-char content tokens for tag matching. */
function headlineTokenSet(text) {
  const toks = String(text ?? '')
    .split(/[・/、，,。.\s（）()「」＝=＋+〜~―\-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  return new Set(toks);
}

/**
 * Drill-form affinity between a primary and a candidate "いずれか" alternative, so swap-ins
 * share the primary's shape (peopleShape / court / sub_skill token / staffing). Deterministic.
 * @param {Drill} primary
 * @param {Drill} cand
 * @returns {number}
 */
function alternativeAffinity(primary, cand) {
  let score = 0;
  if (primary.peopleShape && cand.peopleShape && primary.peopleShape === cand.peopleShape) score += 3;
  if (primary.court && cand.court && primary.court === cand.court) score += 2;
  const tokens = (s) => new Set(String(s ?? '').split(/[・/、，,\s（）()]+/).filter((t) => t.length >= 2));
  const pt = tokens(primary.sub_skill);
  for (const t of tokens(cand.sub_skill)) {
    if (pt.has(t)) { score += 1; break; }
  }
  if (!!primary.needs_helper === !!cand.needs_helper) score += 1;
  return score;
}

/** Max "いずれか" alternative drills offered alongside a segment's primary. */
const MAX_ALTERNATIVES = 2;

/**
 * Running-finish preference for the 火 全面60 シュート枠 (走ってフィニッシュ). The owner's
 * シュート on that part is トランジション/コーストToコースト/2on1系 (走る系) — e.g. ツーメン
 * (トランジション/2対1速攻). A static novelty finish (リバースショット＆阻止: philosophy_tags『遊び』)
 * must not win the primary slot. Higher = more "走る"; positive on トランジション/走り/速攻/合わせ
 * tag or name, negative on a 遊び tag, so the candidate list re-sorts the runners to the top while
 * keeping deterministic id-tiebreak ordering elsewhere.
 * @param {Drill} drill
 * @returns {number}
 */
function runFinishPreference(drill) {
  let score = 0;
  const tags = Array.isArray(drill.philosophy_tags) ? drill.philosophy_tags : [];
  const hay = `${drill.name ?? ''} ${drill.sub_skill ?? ''} ${tags.join(' ')}`;
  if (/トランジション|速攻|コーストToコースト|コーストtoコースト|オールコート|走り|ツーメン|2対1|2on1|スリーメン|3メン|ランニング/i.test(hay)) {
    score += 5;
  }
  if (tags.includes('遊び') || /遊び/.test(drill.sub_skill ?? '')) score -= 5;
  return score;
}

/**
 * Re-order a fit-ordered candidate list to put running-finish drills first (火 全面60 走ってフィニッシュ).
 * Stable: only the runFinishPreference key changes ordering; ties fall back to the incoming
 * educational-fit order (and ultimately id-ascending), so selection stays deterministic.
 * @param {Drill[]} candidates
 * @returns {Drill[]}
 */
function preferRunningFinish(candidates) {
  return candidates
    .map((d, i) => ({ d, i, pref: runFinishPreference(d) }))
    .sort((a, b) => b.pref - a.pref || a.i - b.i)
    .map((x) => x.d);
}

/**
 * Order a candidate list by educational fit (descending), id ascending for ties.
 * Narrows to FT drills when the category is FT-only (and any exist).
 *
 * `skipFtOnly` opts a single seat OUT of the FT-only narrowing even when the category is FT-only:
 * used by the 火 全面60 走ってフィニッシュ slot, which now lives in the シュート category (得点動作は
 * 全てシュート) but is about running finishes (トランジション/レイアップ), not free throws — so a
 * team's FT率 gap must not collapse that slot to free-throw drills. Ordinary シュート seats keep
 * the FT-only narrowing.
 * @param {Object} args
 * @param {Drill[]} args.pool
 * @param {string} args.category
 * @param {Set<string>} args.ftOnlyCategories
 * @param {WeekFocus} args.weekFocus
 * @param {Object<string, number>} args.finalWeights
 * @param {Set<string>} args.headlineTokens
 * @param {boolean} [args.skipFtOnly]
 * @returns {Drill[]}
 */
function categoryCandidates({ pool, category, ftOnlyCategories, weekFocus, finalWeights, headlineTokens, skipFtOnly = false }) {
  let inCat = pool.filter((d) => d.category === category);
  if (!skipFtOnly && ftOnlyCategories.has(category)) {
    const ft = inCat.filter(isFtDrill);
    if (ft.length > 0) inCat = ft;
  }
  return inCat
    .map((d) => ({ d, fit: educationalFitScore(d, weekFocus, finalWeights, headlineTokens) }))
    .sort((a, b) => b.fit - a.fit || (a.d.id < b.d.id ? -1 : a.d.id > b.d.id ? 1 : 0))
    .map((x) => x.d);
}

/**
 * A real full-court 5-on-5 — the session-ending scrimmage the owner programs on full-court days
 * (火・金・土 の対人末尾). Requires the literal 5対5 / 5on5 so the all-court 5-on-5 ranks strictly
 * ABOVE the half-court game (DEC-015 ハーフコート/オールコートゲーム), which is a smaller-game
 * fallback, not the owner's 5on5.
 */
const FULL_SCRIMMAGE_NAME_RE = /5対5|5on5/;
/** Game-form names that read as a real session-ending scrimmage (5on5 / full game / 3on3 game). */
const SCRIMMAGE_NAME_RE = /ゲーム|スクリメージ|5対5|5on5|3on3|3対3|オールコート|ハーフコート|ワーク/;

/**
 * Ordered scrimmage candidates for the 対人 block tail: game-form (意思決定/ゲーム形式) drills,
 * ranked in three tiers so the session ends with a REAL game, not a 2on1 break:
 *   ① a real full-court 5on5 / オールコートゲーム (FULL_SCRIMMAGE_NAME_RE) — the owner's全面日の締め,
 *   ② other scrimmage-shaped games (3on3 game / half-or-full court game, SCRIMMAGE_NAME_RE),
 *   ③ everything else in the game-form category (small-number transition drills),
 * each tier kept in its existing educational-fit order. wantScrim gates on full-court, so a 全面 5on5
 * drill (requiresFull) is reachable here; the half-court game (DEC-015) only wins when no 全面 5on5 fits.
 * @param {Object} args
 * @returns {Drill[]}
 */
function scrimmageCandidates({ pool, ftOnlyCategories, weekFocus, finalWeights, headlineTokens }) {
  const game = categoryCandidates({ pool, category: GAME_CATEGORY, ftOnlyCategories, weekFocus, finalWeights, headlineTokens })
    // Exclude novelty / non-game items that live in the game-form category but are NOT a scrimmage
    // (e.g. ハーフコートショット＝超ロングシュートの遊び). They must never stand in for the 5on5 tail.
    .filter((d) => !/ショット|遊び|ハーフコートショット/.test(`${d.name} ${d.sub_skill ?? ''}`));
  // Stable 3-tier partition: real 5on5 first, then other scrimmage-shaped games, then the rest.
  const fullScrim = game.filter((d) => FULL_SCRIMMAGE_NAME_RE.test(d.name));
  const otherScrim = game.filter((d) => !FULL_SCRIMMAGE_NAME_RE.test(d.name) && SCRIMMAGE_NAME_RE.test(d.name));
  const rest = game.filter((d) => !FULL_SCRIMMAGE_NAME_RE.test(d.name) && !SCRIMMAGE_NAME_RE.test(d.name));
  return [...fullScrim, ...otherScrim, ...rest];
}

/**
 * Pick a primary drill (+ alternatives) for a block from a fit-ordered candidate list.
 * Prefers fresh (unused this week, unseen today, load-placeable); reuse only as fallback.
 * @param {Object} args
 * @param {Drill[]} args.candidates
 * @param {Set<string>} args.usedIds
 * @param {Set<string>} args.daySeenIds
 * @param {ReturnType<import('./loadModel.js').createLoadBudget>} args.budget
 * @returns {{primary: Drill, alternatives: Drill[]}|null}
 */
function pickDrill({ candidates, usedIds, daySeenIds, budget }) {
  const placeable = (d) => {
    if (daySeenIds.has(d.id)) return false;
    if (isHighIntensity(d) && !budget.canPlaceHigh()) return false;
    return true;
  };
  const fresh = candidates.filter((d) => !usedIds.has(d.id) && placeable(d));
  const reusable = candidates.filter((d) => usedIds.has(d.id) && placeable(d));
  const ordered = fresh.length > 0 ? fresh : reusable;
  if (ordered.length === 0) return null;

  const primary = ordered[0];
  const altPool = [...fresh, ...reusable].filter((d) => d.id !== primary.id && !daySeenIds.has(d.id));
  const ranked = altPool
    .map((d, i) => ({ d, i, aff: alternativeAffinity(primary, d) }))
    .sort((a, b) => b.aff - a.aff || a.i - b.i);
  const alternatives = [];
  const altSeen = new Set([primary.id]);
  for (const { d } of ranked) {
    if (alternatives.length >= MAX_ALTERNATIVES) break;
    if (altSeen.has(d.id)) continue;
    altSeen.add(d.id);
    alternatives.push(d);
  }
  return { primary, alternatives };
}

/**
 * Pick the session-ending scrimmage for the 対人 tail. UNLIKE pickDrill, the scrimmage is exempt
 * from week-scope variety dedup: the owner ends EVERY full-court day with the same 5on5
 * (オールコートゲーム), so the same drill must be reusable across 火・金・土 — picking a "fresh"
 * lesser game (3on3 / ハーフコートショット) just to avoid repetition is wrong here. So this takes the
 * top-ranked scrimmage candidate that is day-placeable (not already in TODAY's plan, load-OK),
 * regardless of whether it was used earlier in the WEEK.
 * @param {Object} args
 * @param {Drill[]} args.candidates  Scrimmage candidates already ranked (real 5on5 first).
 * @param {Set<string>} args.daySeenIds
 * @param {ReturnType<import('./loadModel.js').createLoadBudget>} args.budget
 * @returns {{primary: Drill, alternatives: Drill[]}|null}
 */
function pickScrimmage({ candidates, daySeenIds, budget }) {
  const placeable = candidates.filter((d) => {
    if (daySeenIds.has(d.id)) return false;
    if (isHighIntensity(d) && !budget.canPlaceHigh()) return false;
    return true;
  });
  if (placeable.length === 0) return null;
  const primary = placeable[0];
  const alternatives = placeable.slice(1, 1 + MAX_ALTERNATIVES);
  return { primary, alternatives };
}

/**
 * Turn a chosen drill into a sustained PlanItem of the given minutes (decoupled from the
 * drill's natural length), recording the primary in the budget / used sets and attaching
 * the "いずれか" alternatives as display-only menu options.
 * @param {Object} args
 * @param {Drill} args.primary
 * @param {Drill[]} args.alternatives
 * @param {number} args.minutes
 * @param {Set<string>} args.usedIds
 * @param {Set<string>} args.daySeenIds
 * @param {ReturnType<import('./loadModel.js').createLoadBudget>} args.budget
 * @param {boolean} args.dedup
 * @returns {PlanItem}
 */
function toPlanItem({ primary, alternatives, minutes, usedIds, daySeenIds, budget, dedup }) {
  if (isHighIntensity(primary)) budget.recordHigh();
  daySeenIds.add(primary.id);
  if (dedup) usedIds.add(primary.id);
  return {
    drill_id: primary.id,
    name: primary.name,
    minutes,
    category: primary.category,
    intensity_class: primary.intensity_class,
    needs_coach: needsCoach(primary),
    coaching_mode: coachingMode(primary),
    alternatives: alternatives.map((d) => ({ drill_id: d.id, name: d.name })),
  };
}

// ── Day skeleton: how a day's minutes split across the 6 fixed blocks ─────────

/** Minimum minutes a fixed block must hold to be worth placing (else folded away). */
const MIN_BLOCK = 5;

/**
 * Compute the day's fixed 6-block minute template from court + minutes (+ optional run override).
 *
 * The template honors the owner's SCHEDULE: full-court days carry a 走り込み(ラン) block and a
 * fuller 対人 block; half-court days carry NO run and put their time into ファンダ/シュート/対人
 * (no 5on5). アップ/静的 are routine bookends sized by day length. The remaining minutes go to
 * ファンダ/シュート/対人/ラン by fixed proportions, all on a 5-minute grain, summing EXACTLY to
 * the day minutes (the last main block absorbs the rounding remainder so the day is never short).
 *
 * `run_minutes` lets a config pin the conditioning block (e.g. an outdoor-training day = large
 * run); omitted → derived (full-court gets a moderate run, half-court gets 0).
 *
 * `no_funda` drops the ファンダ block and folds its minutes into 走ってフィニッシュ(シュート)＋対人 —
 * used by the 火 court part (全面60 = アップ→走ってフィニッシュ→3on3→5on5→静的), whose fundamentals
 * are covered by 水木金土, not 火.
 *
 * @param {import('./types.js').ScheduleDay & {kind?: string, no_funda?: boolean}} scheduleDay
 * @returns {{ アップ:number, ファンダ:number, シュート:number, 対人:number, ラン:number, 静的:number }}
 */
export function computeDaySkeleton(scheduleDay) {
  const minutes = scheduleDay.minutes;
  const full = String(scheduleDay.court ?? '').includes('全面');

  // Outdoor run/agility session (火の外トレ60): the whole part is the 走り込み・アジリティ run —
  // no court curriculum (ファンダ/シュート/対人) and no separate bookends. The owner's 外トレ60 is
  // ラダー/5BB/HIIT/階段/シャトル straight through, so the entire part is the ラン block.
  if (scheduleDay.kind === 'outdoor') {
    return { アップ: 0, ファンダ: 0, シュート: 0, 対人: 0, ラン: minutes, 静的: 0 };
  }

  // Bookends scale with day length (5-min grain). The 火 全面60 court part (no_funda) pins both
  // bookends to a fixed 10分: the owner's内訳 is アップ10 / 静的10 (a short court block whose
  // proportional rounding would otherwise shrink the静的 to 5分). For other days the静的 keeps its
  // length-proportional size.
  const fixedBookends = scheduleDay.no_funda === true;
  const up = fixedBookends ? 10 : clamp(round5(minutes * 0.12), 10, 20);
  const cd = fixedBookends ? 10 : clamp(round5(minutes * 0.08), 5, 20);

  // Conditioning run: explicit override wins; else full-court days get a moderate run,
  // half-court days get none (no走る系 on half-court per the owner's rule).
  let run;
  if (Number.isFinite(scheduleDay.run_minutes)) {
    run = clamp(round5(scheduleDay.run_minutes), 0, minutes);
  } else {
    run = full ? clamp(round5(minutes * 0.15), 10, 40) : 0;
  }

  // The rest is the curriculum body: ファンダ / シュート / 対人.
  let body = Math.max(0, minutes - up - cd - run);
  body = Math.floor(body / 5) * 5;
  const leftover = minutes - up - cd - run - body; // 0 by construction (all 5-min) — keep explicit

  // Body proportions. When the run is large (an outdoor-training day — 火 is トレ60＋全面60),
  // the on-court body is short, so concentrate it on 走ってフィニッシュ(シュート)＋対人(3on3→5on5)
  // and drop the fundamentals block (the owner's 火 has no ファンダ — それは水木金土でやる).
  // Otherwise full-court days make 対人 the spine; half-court days tilt to skill (ファンダ/シュート).
  const runHeavy = run >= body; // run dominates → outdoor-training style day
  // 火の全面60部: 走ってフィニッシュ→3on3→5on5 で ファンダなし。runHeavy と同じく ファンダ=0 に振り、
  // 走ってフィニッシュ(シュート)＋対人(3on3→5on5) に寄せる。
  const noFunda = scheduleDay.no_funda === true || runHeavy;
  const props = noFunda
    ? { ファンダ: 0.0, シュート: 0.38, 対人: 0.62 }
    : full
      ? { ファンダ: 0.28, シュート: 0.22, 対人: 0.5 }
      : { ファンダ: 0.34, シュート: 0.31, 対人: 0.35 };

  let funda = round5(body * props.ファンダ);
  let shoot = round5(body * props.シュート);
  let contested = body - funda - shoot; // absorbs the rounding remainder → exact body sum
  // Guard: if rounding pushed contested negative or below min, rebalance from ファンダ.
  if (contested < MIN_BLOCK) {
    const deficit = MIN_BLOCK - contested;
    funda = Math.max(0, funda - round5(deficit));
    contested = body - funda - shoot;
  }

  return {
    アップ: up,
    ファンダ: funda,
    シュート: shoot,
    対人: contested + leftover,
    ラン: run,
    静的: cd,
  };
}

// ── Block fillers ─────────────────────────────────────────────────────────────

/**
 * Fill a bundle block (アップ / ラン / 静的) up to its target minutes from an ordered
 * candidate list. Bundle blocks are exempt from week-scope dedup (the same stretch / run is
 * fine daily) and run every day regardless of coach presence. Only the same-day guard applies.
 * @param {Object} args
 * @param {string} args.block
 * @param {number} args.target
 * @param {Drill[]} args.candidates  Ordered (warm-up: 低→高; static: cool-down stage; run: fit).
 * @param {ReturnType<import('./loadModel.js').createLoadBudget>} args.budget
 * @param {Set<string>} args.daySeenIds
 * @returns {PlanBlock}
 */
function fillBundleBlock({ block, target, candidates, budget, daySeenIds }) {
  /** @type {PlanBlock} */
  const planBlock = { block, items: [] };
  if (target < MIN_BLOCK) return planBlock;

  // Per-drill cap so a long run block (e.g. 60min 走り込み) reads as a varied circuit
  // (ラダー/5BB/HIIT/階段/シャトル) rather than one drill stretched to fill the whole block.
  // Short bookends (アップ/静的) keep their natural micro durations.
  const perCap = block === 'ラン' ? clamp(Math.ceil(target / Math.max(1, Math.min(candidates.length, 5))), 5, 15) : Infinity;

  let used = 0;
  for (const d of candidates) {
    if (used >= target) break;
    if (daySeenIds.has(d.id)) continue;
    const want = Number.isFinite(perCap) ? Math.min(d.duration_min, perCap) : d.duration_min;
    const dur = Math.min(want, target - used);
    if (dur < 1) continue;
    if (isHighIntensity(d)) {
      if (!budget.canPlaceHigh()) continue;
      budget.recordHigh();
    }
    planBlock.items.push({
      drill_id: d.id,
      name: d.name,
      minutes: dur,
      category: d.category,
      intensity_class: d.intensity_class,
      needs_coach: needsCoach(d),
      coaching_mode: coachingMode(d),
    });
    daySeenIds.add(d.id);
    used += dur;
  }
  // Top up to the exact target. Distribute the shortfall across the placed items (round-robin,
  // 5-min steps where possible) so the run circuit stays varied rather than dumping everything on
  // the final drill. Bookends (one main stretch) simply top up the last item.
  if (planBlock.items.length > 0 && used < target) {
    let short = target - used;
    if (block === 'ラン' && planBlock.items.length > 1) {
      let i = 0;
      while (short > 0) {
        const step = Math.min(short, 5);
        planBlock.items[i % planBlock.items.length].minutes += step;
        short -= step;
        i += 1;
      }
    } else {
      planBlock.items[planBlock.items.length - 1].minutes += short;
    }
  }
  return planBlock;
}

/**
 * Fill a curriculum block (ファンダ / シュート / 対人) up to its target minutes as a small set of
 * sustained themed segments drawn from that block's categories, ordered by the month's emphasis
 * (focus_weights) and selected by educational fit. The contested block additionally appends a
 * single 5-on-5 scrimmage as its LAST segment when the day is full-court and the week's focus
 * allows it (作り直し方針3) — never on half-court days, and never as a forced固定枠.
 *
 * @param {Object} args
 * @param {string} args.block               'ファンダ' | 'シュート' | '対人'
 * @param {number} args.target              Block minutes (5-min grain).
 * @param {Drill[]} args.pool               Day pool (already coach-context restricted for main).
 * @param {Object<string, number>} args.finalWeights
 * @param {Set<string>} args.ftOnlyCategories
 * @param {WeekFocus} args.weekFocus
 * @param {Set<string>} args.headlineTokens
 * @param {Set<string>} args.usedIds
 * @param {Set<string>} args.daySeenIds
 * @param {ReturnType<import('./loadModel.js').createLoadBudget>} args.budget
 * @param {boolean} args.fullCourt
 * @returns {PlanBlock}
 */
function fillCurriculumBlock({
  block, target, pool, finalWeights, ftOnlyCategories, weekFocus, headlineTokens,
  usedIds, daySeenIds, budget, fullCourt, runHeavy = false, noFunda = false,
}) {
  /** @type {PlanBlock} */
  const planBlock = { block, items: [] };
  if (target < MIN_BLOCK) return planBlock;

  // Categories this block accepts that are present in the pool.
  const blockCats = new Set();
  for (const d of pool) {
    if (blockOf(d) === block) blockCats.add(d.category);
  }
  // 対人 leads with the 3on3 (team-defense) on outdoor-training days (runHeavy) AND on the
  // 火 全面60 (no_funda) part — both are the owner's 3on3(チームディフェンス)→5on5 shape.
  const orderedCats = orderBlockCategories(block, [...blockCats], finalWeights, runHeavy || noFunda);

  // How many themed segments fit: keep them sustained (one per ~SEGMENT_TARGET minutes),
  // bounded by the available categories. 対人 stays coarse (1on1 + 3on3) — don't slice.
  const SEGMENT_TARGET = block === '対人' ? 18 : 15;
  const maxByMinutes = Math.max(1, Math.floor(target / SEGMENT_TARGET));
  const segCount = Math.min(orderedCats.length, maxByMinutes);
  if (segCount === 0) return planBlock;

  // Reserve a scrimmage tail slot for the contested block on full-court allow-scrimmage days.
  const wantScrim = block === '対人' && fullCourt && weekFocus?.allow_scrimmage === true;

  // Categories to seat (the heaviest segCount). If we want a scrimmage, leave room: the
  // scrimmage takes the LAST slot, so seat (segCount-? ) contested categories before it.
  const seatCats = orderedCats.slice(0, segCount);

  // Split the (non-scrimmage) target across the seated categories proportional to emphasis.
  // When a scrimmage is wanted, carve a fixed scrimmage slice off the top first.
  const scrimMinutes = wantScrim ? clamp(round5(target * 0.3), 15, 25) : 0;
  const bodyTarget = Math.max(0, target - scrimMinutes);

  // 対人 splits its seated categories evenly (1on1 と 3on3 を同じくらい厚く＝刻まない・偏らせない);
  // ファンダ/シュート split by the month's emphasis so the主眼カテゴリ gets more time.
  const sizes = block === '対人'
    ? splitEven(seatCats.length, bodyTarget)
    : splitByWeight(seatCats, finalWeights, bodyTarget);

  let placed = 0;
  for (let i = 0; i < seatCats.length; i++) {
    const cat = seatCats[i];
    let segMin = sizes[i];
    if (segMin < MIN_BLOCK) continue;
    // 火 全面60 のシュート枠＝走ってフィニッシュ は FT-only 絞り込みを外す（走る系フィニッシュは
    // 得点動作としてシュートカテゴリに統合済み。FT率ギャップでこの枠をフリースローに潰さない）。
    const skipFtOnly = noFunda && block === 'シュート';
    let candidates = categoryCandidates({ pool, category: cat, ftOnlyCategories, weekFocus, finalWeights, headlineTokens, skipFtOnly });
    // 火 全面60 のシュート枠＝走ってフィニッシュ: トランジション/2on1速攻系（走る系）を主に優先し、
    // 静的な遊び系（リバースショット＆阻止 等）を主から降格する。
    if (noFunda && block === 'シュート') candidates = preferRunningFinish(candidates);
    const pick = pickDrill({ candidates, usedIds, daySeenIds, budget });
    if (!pick) continue;
    planBlock.items.push(
      toPlanItem({ primary: pick.primary, alternatives: pick.alternatives, minutes: segMin, usedIds, daySeenIds, budget, dedup: true }),
    );
    placed += segMin;
  }

  // Scrimmage tail (last segment, full-court allow-scrimmage only). The tail is the
  // session-ending 5on5/スクリメージ, so prefer actual game-form scrimmages (5対5/3on3 full
  // game / ハーフ・オールコートゲーム) over small-number transition drills that also live in
  // the game-form category — the owner ends the 対人 block with a real game, not a 2on1 break.
  if (wantScrim) {
    const candidates = scrimmageCandidates({
      pool, ftOnlyCategories, weekFocus, finalWeights, headlineTokens, fullCourt,
    });
    // Scrimmage tail is exempt from week-scope dedup: the same 5on5 ends every full-court day.
    const pick = pickScrimmage({ candidates, daySeenIds, budget });
    if (pick) {
      const remaining = target - placed;
      const scrimMin = remaining >= MIN_BLOCK ? remaining : scrimMinutes;
      planBlock.items.push(
        toPlanItem({ primary: pick.primary, alternatives: pick.alternatives, minutes: scrimMin, usedIds, daySeenIds, budget, dedup: false }),
      );
      placed += scrimMin;
    }
  }

  // If we under-placed (a category had no placeable drill), grow the last placed segment to
  // the block target so the day's minutes are conserved (clock invariant).
  if (planBlock.items.length > 0 && placed < target) {
    planBlock.items[planBlock.items.length - 1].minutes += target - placed;
  }
  return planBlock;
}

/**
 * Order a block's available categories.
 *
 * 対人 follows the owner's fixed intent 対人＝基本「1on1 と 3on3」だけ（刻まない）: 1on1 leads,
 * then team-defense (the 3on3 confirmation), then team-offense / rebound as supporting contested
 * work — NOT raw month-emphasis, which would float team-O/team-D above the 1on1 spine. Other
 * blocks order by the month's emphasis (focus_weights), id-ascending for ties (deterministic).
 *
 * @param {string} block
 * @param {string[]} cats
 * @param {Object<string, number>} finalWeights
 * @param {boolean} [teamDFirst]  Lead the 対人 block with the 3on3 (team-defense). True on the
 *   outdoor-training-style day (大きな走り込み＋短い全面) AND on the 火 全面60 (no_funda) part, whose
 *   対人 is the owner's 3on3(チームディフェンス)→5on5 — team-defense leads, not 1on1.
 * @returns {string[]}
 */
function orderBlockCategories(block, cats, finalWeights, teamDFirst = false) {
  if (block === '対人') {
    const PRIORITY = teamDFirst
      ? [
          'チームディフェンス(オールコートマンツー/ヘルプ/帰陣)',
          '1on1',
          'チームオフェンス(アーリー/トランジション)',
          'リバウンド/ボックスアウト',
        ]
      : [
          '1on1',
          'チームディフェンス(オールコートマンツー/ヘルプ/帰陣)',
          'チームオフェンス(アーリー/トランジション)',
          'リバウンド/ボックスアウト',
        ];
    const rank = (c) => {
      const i = PRIORITY.indexOf(c);
      return i === -1 ? PRIORITY.length : i;
    };
    return cats.slice().sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
  }
  return cats
    .slice()
    .sort((a, b) => (finalWeights[b] ?? 0) - (finalWeights[a] ?? 0) || (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Split `total` minutes across `cats` proportional to finalWeight, each on a 5-min grain,
 * summing to `total` exactly (largest-remainder). Equal split when weights are absent.
 * @param {string[]} cats
 * @param {Object<string, number>} finalWeights
 * @param {number} total
 * @returns {number[]}
 */
/**
 * Split `total` minutes into `n` parts as evenly as possible on a 5-min grain (sums to total;
 * earlier parts get any remainder). Used by the 対人 block so 1on1 と 3on3 stay comparably厚い.
 * @param {number} n
 * @param {number} total
 * @returns {number[]}
 */
function splitEven(n, total) {
  if (n <= 0 || total <= 0) return new Array(Math.max(0, n)).fill(0);
  const steps = Math.round(total / 5);
  const base = Math.floor(steps / n);
  let extra = steps - base * n;
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push((base + (extra > 0 ? 1 : 0)) * 5);
    if (extra > 0) extra -= 1;
  }
  return out;
}

function splitByWeight(cats, finalWeights, total) {
  const n = cats.length;
  if (n === 0 || total <= 0) return new Array(n).fill(0);
  const steps = Math.round(total / 5);
  const weights = cats.map((c) => Math.max(0, finalWeights[c] ?? 0));
  let wsum = weights.reduce((s, w) => s + w, 0);
  const useEqual = wsum <= 0;
  const exact = cats.map((_, i) => (useEqual ? steps / n : (weights[i] / wsum) * steps));
  const floored = exact.map((e, i) => ({ i, n: Math.floor(e), frac: e - Math.floor(e) }));
  let assigned = floored.reduce((s, f) => s + f.n, 0);
  let leftover = steps - assigned;
  floored.sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; k < floored.length && leftover > 0; k++) { floored[k].n += 1; leftover -= 1; }
  const out = new Array(n).fill(0);
  for (const f of floored) out[f.i] = f.n * 5;
  return out;
}

// ── Day allocation ──────────────────────────────────────────────────────────

/**
 * Allocate a single day's plan as the fixed 6-block session
 * (アップ→ファンダ→シュート→対人→ラン→静的). Blocks are sized by the day skeleton (court +
 * minutes + run override) and filled by educational-fit selection under the month's emphasis.
 *
 * @param {Object} args
 * @param {import('./types.js').ScheduleDay} args.scheduleDay
 * @param {Drill[]} args.dayPool           Pool already filtered for this day (court/grades/zone/sets).
 * @param {Object<string, number>} args.finalWeights
 * @param {Set<string>} args.ftOnlyCategories
 * @param {ReturnType<import('./loadModel.js').createLoadBudget>} args.budget
 * @param {Set<string>} [args.usedIds]    Week-scope used ids (shared across days).
 * @param {Config} [args.config]          For coach-context pool restriction.
 * @param {WeekFocus} [args.weekFocus]    The week's focus (mastery bias / scrimmage allowance).
 * @returns {PlanDay}
 */
export function allocateDay({
  scheduleDay,
  dayPool,
  finalWeights,
  ftOnlyCategories,
  budget,
  usedIds = new Set(),
  config,
  weekFocus = { headline: '', mastery_bias: [], allow_scrimmage: false },
}) {
  const { day, minutes, court } = scheduleDay;
  const coachPresent = scheduleDay.coach_present !== false; // default present when unset

  /** @type {Set<string>} day-scope guard: a drill never appears twice in one day (spans parts). */
  const daySeenIds = new Set();
  const headlineTokens = headlineTokenSet(weekFocus?.headline);

  const ctx = {
    dayPool, finalWeights, ftOnlyCategories, budget, usedIds, config,
    weekFocus, headlineTokens, coachPresent, daySeenIds,
  };

  let blocks;
  /** @type {Array<{label:string, kind:string, minutes:number, court:string}>|undefined} */
  let parts;

  if (Array.isArray(scheduleDay.parts) && scheduleDay.parts.length > 0) {
    // Multi-part day (火 = 外トレ60 ＋ 全面60): build each part as its OWN fixed-block mini-session
    // and concatenate. Blocks carry the part index/label/kind so the gate asserts fixed order
    // WITHIN each part and the UI splits headers / timelines. Budget, week-scope dedup, and the
    // day-scope guard are shared across parts (one weekly load budget, no cross-part repeats).
    blocks = [];
    parts = [];
    scheduleDay.parts.forEach((part, idx) => {
      const kind = part.kind ?? 'court';
      const partBlocks = buildSessionBlocks(ctx, {
        minutes: part.minutes,
        court: part.court,
        kind,
        run_minutes: part.run_minutes,
        no_funda: part.no_funda === true,
      });
      for (const b of partBlocks) {
        b.part = idx;
        b.part_label = part.label;
        b.part_kind = kind;
      }
      blocks.push(...partBlocks);
      parts.push({ label: part.label, kind, minutes: part.minutes, court: String(part.court ?? '') });
    });
  } else {
    // Single-session day (the default).
    blocks = buildSessionBlocks(ctx, {
      minutes, court, kind: 'court', run_minutes: scheduleDay.run_minutes,
    });
  }

  const total_minutes = blocks.reduce(
    (sum, b) => sum + b.items.reduce((s, it) => s + it.minutes, 0),
    0,
  );
  const high_intensity_count = blocks.reduce(
    (sum, b) => sum + b.items.filter((it) => it.intensity_class === '高').length,
    0,
  );

  // Day boundary: roll the load budget's consecutive-day state.
  budget.endDay();

  /** @type {PlanDay} */
  const planDay = {
    day,
    minutes,
    court,
    coach_present: coachPresent,
    blocks,
    total_minutes,
    high_intensity_count,
  };
  if (parts) planDay.parts = parts;
  return planDay;
}

/**
 * Build the ordered, non-empty fixed-6-block list for ONE session (a whole single-session day, or
 * one part of a multi-part day). The session is sized by its own court/minutes/kind/run and filled
 * by educational-fit selection under the shared week budget. The caller concatenates sessions and
 * stamps part metadata.
 *
 * `kind:"outdoor"` makes the whole session a 走り込み・アジリティ run (no curriculum blocks); its run
 * pool also draws ladder/agility footwork (ラダー等) so the 外トレ reads as ラダー/5BB/HIIT/階段/シャトル.
 * `kind:"court"` (default) builds the normal アップ→ファンダ→シュート→対人→ラン→静的 court session.
 *
 * @param {Object} ctx  Shared per-day context (pools, weights, budget, dedup sets, week focus).
 * @param {{minutes:number, court:(string|undefined), kind:('outdoor'|'court'), run_minutes:(number|undefined)}} session
 * @returns {PlanBlock[]}
 */
function buildSessionBlocks(ctx, session) {
  const {
    dayPool, finalWeights, ftOnlyCategories, budget, usedIds, config,
    weekFocus, headlineTokens, coachPresent, daySeenIds,
  } = ctx;
  const { minutes, court, kind } = session;
  const outdoor = kind === 'outdoor';
  const fullCourt = String(court ?? '').includes('全面');
  const skeleton = computeDaySkeleton({ minutes, court, kind, run_minutes: session.run_minutes, no_funda: session.no_funda });
  // Run-dominant session (火の外トレ等): the run dominates and the on-court body is short.
  const runHeavy = skeleton.ラン >= skeleton.ファンダ + skeleton.シュート + skeleton.対人;
  // 火 全面60 (no_funda): シュート枠＝走ってフィニッシュ・対人＝3on3(チームディフェンス)→5on5。
  const noFunda = session.no_funda === true;

  // Coach-absent days: narrow the MAIN (curriculum) pool to player-self-runnable content.
  const mainPool = coachPresent ? dayPool : dayPool.filter((d) => isCoachAbsentEligible(d, config));

  // Bundle pools (run every session regardless of coach presence; conditioning split 3 ways).
  const upPool = dayPool
    .filter((d) => blockOf(d) === 'アップ')
    .slice()
    .sort((a, b) => intensityRank(a) - intensityRank(b) || (a.id < b.id ? -1 : 1));
  // Run pool: conditioning-run drills, PLUS — on an outdoor run/agility session — ladder/agility
  // footwork (ラダー等) so the 外トレ60 carries ラダー/5BB/HIIT/階段/シャトル, not just power jumps.
  const runPool = dayPool
    .filter((d) => blockOf(d) === 'ラン' || (outdoor && isAgilityDrill(d)))
    .slice()
    .sort((a, b) => intensityRank(a) - intensityRank(b) || (a.id < b.id ? -1 : 1));
  const staticPool = dayPool
    .filter((d) => blockOf(d) === '静的')
    .slice()
    .sort((a, b) => coolDownStage(a) - coolDownStage(b) || a.duration_min - b.duration_min);

  const upBlock = fillBundleBlock({ block: 'アップ', target: skeleton.アップ, candidates: upPool, budget, daySeenIds });

  const fundaBlock = fillCurriculumBlock({
    block: 'ファンダ', target: skeleton.ファンダ, pool: mainPool, finalWeights, ftOnlyCategories,
    weekFocus, headlineTokens, usedIds, daySeenIds, budget, fullCourt,
  });
  const shootBlock = fillCurriculumBlock({
    block: 'シュート', target: skeleton.シュート, pool: mainPool, finalWeights, ftOnlyCategories,
    weekFocus, headlineTokens, usedIds, daySeenIds, budget, fullCourt, noFunda,
  });
  const contestedBlock = fillCurriculumBlock({
    block: '対人', target: skeleton.対人, pool: mainPool, finalWeights, ftOnlyCategories,
    weekFocus, headlineTokens, usedIds, daySeenIds, budget, fullCourt, runHeavy, noFunda,
  });

  const runBlock = fillBundleBlock({ block: 'ラン', target: skeleton.ラン, candidates: runPool, budget, daySeenIds });

  // Static stretch closes a court session. Avoid the warm-up's stretches (shared daySeenIds);
  // if that empties it, refill with a fresh set. An outdoor run-only session has 静的=0 (no CD).
  let staticBlock = fillBundleBlock({ block: '静的', target: skeleton.静的, candidates: staticPool, budget, daySeenIds });
  if (staticBlock.items.length === 0 && skeleton.静的 >= MIN_BLOCK && staticPool.length > 0) {
    staticBlock = fillBundleBlock({ block: '静的', target: skeleton.静的, candidates: staticPool, budget, daySeenIds: new Set() });
  }

  const byKey = {
    アップ: upBlock, ファンダ: fundaBlock, シュート: shootBlock,
    対人: contestedBlock, ラン: runBlock, 静的: staticBlock,
  };
  // Keep the fixed order; drop only blocks that ended up genuinely empty (a court session keeps its
  // sized-up 静的; an outdoor session is just the ラン block).
  return BLOCK_ORDER.map((k) => byKey[k]).filter((b) => b.items.length > 0);
}
