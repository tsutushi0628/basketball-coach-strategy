/**
 * @file 練習計画UI の単一データソース（決定論・LLM不使用）。
 *
 * コーチは1人で男女2チームを同じ体育館で見る。だから日々の練習メニューは男女共通（1本）。
 * 男女で違うのは「いつコーチが付くか」だけ——組違い＝同じメニューのコーチ付き段を男女で
 * 時間的にずらし、コーチが同時に見るのは必ず片方、もう片方はその間その段を自走する。
 *
 * 設計（オーナー差し戻しを反映）:
 *   1. 練習メニューは男女共通（1本だけ生成）。男女でドリルを変えない（コーチの負担を増やさない）。
 *   2. 組違い＝コーチ付き段を男女でずらすローテ。同時刻にコーチ付きは必ず片方だけ。
 *      ON＝体育館共有でこのローテ、OFF＝男女が別時間に同じメニューを各自フル（コーチが全段見る）。
 *   3. 年/月は原典 encode（annual-plan.json）から決定論的に解決（夏は山でない／山は冬の新人大会と
 *      翌夏の中体連の2つ）。今は男女とも同じ流れ（大会の男女差は未確定・コーチ確認で確定後に反映）。
 *
 * 表示規約:
 *   - 時刻は `HH:MM`（平日16:00開始・土09:00開始）。各段は持続尺（エンジンが5分丸めで保証）。
 *   - 段は主ドリル＋同カテゴリの「いずれか」候補（エンジンの alternatives）。
 *   - 平日に出る既習レクチャ型は反復＝自走表示。コーチ不在日（水木）は全段を自走表示。
 */

import { normalizeDrills } from '../engine/src/normalize.js';
import { editorBlockOf } from '../engine/src/allocate.js';
import { planWeek } from '../engine/src/planWeek.js';
import { resolveMonth, resolveWeekFocus, yearArc, peaks as annualPeaks, wrapMonth } from '../engine/src/annualPlan.js';
import { coachingMode } from '../engine/src/filter.js';
import { buildRotation } from './rotation.mjs';
import { buildDrillRegistry } from './drill-detail.mjs';

// ── 表記辞書（カテゴリ→狙い／短縮名）──────────────────────────────────────────
export const AIM_MAP = {
  'フィニッシュ(ゴール下/レイアップ)': 'リム付近でのフィニッシュ力を上げよう',
  シュート: 'シュートタッチと集中（フリースロー含む）を高めよう',
  'ハンドリング/ドリブル': 'プレッシャー下でもボールを失わない手を作ろう',
  '1on1': '1対1で「抜く・止める」の判断を磨こう',
  'チームディフェンス(オールコートマンツー/ヘルプ/帰陣)': 'オールコートマンツーの連携（ヘルプ→ローテ→帰陣）を固めよう',
  'チームオフェンス(アーリー/トランジション)': '速攻（アーリー／トランジション）の初速を上げよう',
  '意思決定/ゲーム形式': '実戦形式で、正しい判断を速くしよう',
  'パス&スペーシング': 'スペーシングとパスで相手を崩す形を覚えよう',
  'コンディショニング/ウォームアップ': '怪我をしない身体の使い方を整えよう',
  'フットワーク/アジリティ/ピボット': '止まる・切り返すの足元を鍛えよう',
};
export const SHORT_CAT = {
  'フィニッシュ(ゴール下/レイアップ)': 'ゴール下フィニッシュ',
  シュート: 'シュート',
  'ハンドリング/ドリブル': 'ボールハンドリング',
  '1on1': '1対1',
  'チームディフェンス(オールコートマンツー/ヘルプ/帰陣)': 'チーム守備',
  'チームオフェンス(アーリー/トランジション)': '速攻',
  '意思決定/ゲーム形式': '判断・ゲーム',
  'パス&スペーシング': 'パス＆スペース',
  'コンディショニング/ウォームアップ': 'コンディショニング',
  'フットワーク/アジリティ/ピボット': 'フットワーク',
};
const BLOCK_LABEL = {
  アップ: 'アップ',
  ファンダ: 'ファンダメンタル',
  シュート: 'シュート',
  対人: '対人',
  ラン: '走り込み',
  静的: '静的ストレッチ',
};
/** 束ね（左右同一・実尺占有）表示にするブロック＝ルーティン本（アップ/走り込み/静的）。 */
const BUNDLE_BLOCKS = new Set(['アップ', 'ラン', '静的']);
/** その日の開始時刻（実スケジュール: 平日16:05開始、土は09:00開始）。 */
const START_CLOCK = { 土: 9 * 60, 日: 9 * 60 };
const DEFAULT_START_MIN = 16 * 60 + 5; // 16:05（準備時間5分込み・窓95分=16:05〜17:40）

const shortCat = (c) => SHORT_CAT[c] || c;
const hhmm = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const timeToMin2 = (hm) => { const [h, m] = String(hm).split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const fullDayLabel = (d) => `${d}曜`;

// ── 実日付ヘルパー（週起点＝月曜から曜日オフセットで暦日を出す。UTC固定でTZズレを排除）──
/** 曜日→週起点（月曜=0）からのオフセット日数。 */
const WEEKDAY_OFFSET = { 月: 0, 火: 1, 水: 2, 木: 3, 金: 4, 土: 5, 日: 6 };
/** ISO日付(YYYY-MM-DD)に n 日加算した ISO を返す（UTCで安全に）。 */
const addDaysISO = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** 週起点(月曜ISO)と曜日名から、その曜日の実日付ISOを返す（未知の曜日は null）。 */
const dayDateISO = (weekStartDate, dayName) => {
  if (!weekStartDate || !(dayName in WEEKDAY_OFFSET)) return null;
  return addDaysISO(weekStartDate, WEEKDAY_OFFSET[dayName]);
};
/** "2026-06-23" を "2026/06/23" に。 */
const dateLabelYMD = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${y}/${m}/${d}`;
};

// ── 期間モデル（週/月ピッカーの実切替＝複数期間生成）─────────────────────────────
// 設計: 1回の generation は「1期間（1週＋その月のフェーズ）」を作る純粋な単位のまま。
// 複数期間は buildPlanData が period を変えて反復する（案B＝呼び出し側ループ）。
// アンカー（config.current_month / week_of_month / week_start_date）を起点に:
//   - 週: 現アーク月の週1..N（暦日は週起点+7日ずつ、焦点は週番号で変わる＝型→反復）。
//   - 月: アンカー月から半年。暦月ラベルと「フェーズ駆動月(current_month)」の定数オフセットを
//         保ったまま1ヶ月＝1アーク段ぶん進める（暦月とアーク月の二軸＝原典どおり維持）。
/** 1アーク月に生成する週数（型→反復で焦点が変わる現方針。weekly_focus 最大週=4 と一致）。 */
const WEEKS_PER_ARC_MONTH = 4;
/** 月ピッカーに並べる月数（現月＋先5ヶ月＝半年）。 */
const MONTHS_AHEAD = 6;

/**
 * 週ピッカー用の期間リスト。アンカー週から現アーク月の週1..N を並べる。
 * 各週: 暦日は週起点+7日ずつ進め、current_month は固定（同一アーク月内）、week_of_month は+1ずつ。
 * resolveWeekFocus(current_month, week_of_month) が週ごとに異なる焦点を返す＝中身が実際に変わる。
 * @param {{currentMonth:number, weekOfMonth:number, weekStartDate:?string}} anchor
 * @returns {Array<{key:string,label:string,currentMonth:number,weekOfMonth:number,weekStartDate:?string}>}
 */
export function computeWeekPeriods(anchor) {
  const out = [];
  for (let i = 0; i < WEEKS_PER_ARC_MONTH; i++) {
    const weekStartDate = anchor.weekStartDate ? addDaysISO(anchor.weekStartDate, 7 * i) : null;
    out.push({
      key: weekStartDate ? dateLabelYMD(weekStartDate) : `w${i}`,
      label: weekStartDate ? `${dateLabelYMD(weekStartDate)}〜` : `第${(anchor.weekOfMonth ?? 1) + i}週`,
      currentMonth: anchor.currentMonth,
      weekOfMonth: (anchor.weekOfMonth ?? 1) + i,
      weekStartDate,
    });
  }
  return out;
}

/**
 * 月ピッカー用の期間リスト。アンカー月から半年（暦月ラベル＋アーク駆動月）。
 * 暦月とアーク駆動月(current_month)の定数オフセットを保ち、1ヶ月＝1アーク段ぶん進める。
 * 各月の中身は resolveMonth(current_month) のフェーズ内容（週生成は不要＝軽量）。
 * @param {{currentMonth:number, displayMonth:number, year:number}} anchor
 * @returns {Array<{key:string,label:string,currentMonth:number,displayMonth:number,year:number}>}
 */
export function computeMonthPeriods(anchor) {
  const out = [];
  for (let i = 0; i < MONTHS_AHEAD; i++) {
    let mm = anchor.displayMonth + i;
    let yy = anchor.year;
    while (mm > 12) { mm -= 12; yy += 1; }
    const label = `${yy}/${String(mm).padStart(2, '0')}`;
    out.push({
      key: label,
      label,
      currentMonth: wrapMonth(anchor.currentMonth + i), // 1..12 に正規化（resolveMonth が内部 wrap するので値も揃える）
      displayMonth: mm,
      year: yy,
    });
  }
  return out;
}

/**
 * 組違い用 self-fill プールを作る。
 * その日の主眼カテゴリに同主眼で自走可能なドリルを catalog から affinity 順で返す。
 * selfFillPool は共通メニュー本体には追加しない（rotation.mjs の補充用候補のみ）。
 *
 * @param {Array} drills 正規化済みドリル全件
 * @param {string|null} dominantCat その日の主要カテゴリ（null なら全自走が対象）
 * @param {string[]} usedNames 既に共通メニューで使われているドリル名（重複排除）
 * @returns {Array<{name:string,minutes:number,category:string,mode:'self',video:string|null,alternatives:string[]}>}
 */
function buildSelfFillPool(drills, dominantCat, usedNames) {
  const usedSet = new Set(usedNames);
  return drills
    .filter((d) => coachingMode(d) === 'self' && !usedSet.has(d.name))
    .map((d) => {
      // 同カテゴリ優先（affinity スコア: 同カテゴリ=2、それ以外=0）
      const score = d.category === dominantCat ? 2 : 0;
      return { score, d };
    })
    .sort((a, b) => b.score - a.score || a.d.id.localeCompare(b.d.id))
    .map(({ d }) => ({
      name: d.name,
      minutes: Math.max(d.duration_min || 10, 10),
      category: d.category,
      mode: 'self',
      video: d.video_url || null,
      alternatives: [],
    }));
}

/** 編集画面の7枠（自動生成6枠＋ゲーム枠）。editorBlockOf の写像先と一致させる。 */
const EDITOR_BLOCKS = ['アップ', 'ファンダ', 'シュート', '対人', 'ラン', '静的', 'ゲーム'];

/**
 * 編集画面の枠（ブロック）別ドリル候補を、エンジンと同じ正規化済みドリル集合から構築する。
 *
 * 各ドリルを editorBlockOf でちょうど1枠に振り分け（自動生成の枠分けと同一判定＝唯一の真実源
 * blockOf を再利用）、その枠の候補配列に drill.name（drillIndex のキー＝カタログ名と一致）を
 * 重複なく積む。フィニッシュの mastery 分割（習得→ファンダ、反復/実戦化→シュート）も editorBlockOf
 * 経由で blockOf がそのまま行うので、ここで再判定はしない。editorBlockOf が null を返すドリル
 * （主ブロック非該当＝傷害予防の非アップ等）はどの枠にも入れない。
 *
 * @param {Array} drills 正規化済みドリル全件（blockOf が見る category/mastery_stage/philosophy_tags/
 *   sub_skill/intensity_class/name が揃っている集合）
 * @returns {Object<string, string[]>} 枠キー→候補ドリル名配列（EDITOR_BLOCKS の順）
 */
function buildBlockCandidates(drills) {
  /** @type {Object<string, string[]>} */
  const out = {};
  /** @type {Object<string, Set<string>>} 枠ごとの重複排除セット。 */
  const seen = {};
  for (const b of EDITOR_BLOCKS) {
    out[b] = [];
    seen[b] = new Set();
  }
  for (const d of drills) {
    const block = editorBlockOf(d);
    if (!block || !out[block]) continue; // 主ブロック非該当はどの枠にも出さない
    const name = d.name;
    if (!name || seen[block].has(name)) continue;
    seen[block].add(name);
    out[block].push(name);
  }
  return out;
}

/**
 * 男女共通の練習メニュー（1本）を生成する。コーチ1人が男女を同時に見るので、日々の中身は
 * 共通。暦月の基準で phase / focus_weights を解決して planWeek する（shared_gym:false）。
 *
 * @param {object} args
 * @param {object} args.annual loadAnnualPlan() の結果
 * @param {Array} args.drills 正規化済みドリル
 * @param {object} args.config team config（基準）
 * @param {object} args.teamInput team input（基準）
 * @returns {object} 共通セッションの表示データ（days / goals / month）
 */
function buildSession({ annual, drills, config, teamInput, period }) {
  // period（複数期間生成で注入）が無ければ config の単一期間にフォールバック（後方互換）。
  const currentMonth = period?.currentMonth ?? config.current_month;
  const weekOfMonth = period?.weekOfMonth ?? config.week_of_month ?? 1;
  const weekStartDate = period?.weekStartDate ?? config.week_start_date;
  // 共有セッションの基準月（暦月そのまま）。男女共通の1メニュー。
  const resolved = resolveMonth(annual, '男子', currentMonth);
  // 上から降ろした週の焦点（年→フェーズ→月の主眼→週）。後付け要約は廃止。
  const weekFocus = resolveWeekFocus(annual, '男子', currentMonth, weekOfMonth);
  const cfg = {
    ...config,
    phase: resolved.phase,
    phase_category_weights: resolved.focus_weights,
    shared_gym: false,
  };
  delete cfg.groups;
  // 複数週生成では既習レクチャ・ロスター（introduced）を週送りで連鎖させる（週Nの既習を週N+1の入力へ）。
  // これで2週目以降の土曜レクチャから既習分が消える＝週ごとに中身が進む。
  if (Array.isArray(period?.introduced)) cfg.introduced = period.introduced;

  const plan = planWeek(drills, cfg, teamInput, weekFocus);
  const videoIndex = new Map(drills.map((d) => [d.id, d.video_url || null]));
  const lectureHostDay = plan.saturday_lecture?.day ?? '土';

  const displayMode = (it, day) => {
    if (day.coach_present === false) return 'self'; // コーチ不在日は全段自走
    const raw = it.coaching_mode || (it.needs_coach ? 'practice' : 'self');
    if (raw === 'lecture' && day.day !== lectureHostDay) return 'self';
    return raw;
  };

  // 今週の焦点＝上から降ろした週の焦点（weekFocus.headline）。実分数からの後付け要約は撤去。
  // 「質」は今週の焦点に効くカテゴリ＝月の主眼focus_weights上位2カテゴリの狙い文を出す。
  const topCats = Object.entries(resolved.focus_weights || {})
    .sort((a, b) => b[1] - a[1])
    .map(([c]) => c)
    .slice(0, 2);

  const goals = {
    monthMain: resolved.headline,
    week: weekFocus.headline,
    qualitative: topCats.map((c) => AIM_MAP[c] || `${shortCat(c)}を磨く`),
    kpiHints: resolved.kpi_hints,
  };

  const month = {
    displayMonth: resolved.displayMonth,
    arcMonth: resolved.arcMonth, // 年アーク月キー（月/年の目標上書きの単一真実源キー）
    phase: resolved.phase,
    headline: resolved.headline,
    kpiHints: resolved.kpi_hints,
    peak: resolved.peak,
    peakLevel: resolved.peak_level,
  };

  const dominantCategory = (day) => {
    const acc = {};
    for (const b of day.blocks) {
      if (BUNDLE_BLOCKS.has(b.block)) continue; // ルーティン本（アップ/走り込み/静的）は主眼判定から除外
      for (const it of b.items) acc[it.category] = (acc[it.category] || 0) + it.minutes;
    }
    const top = Object.entries(acc).sort((a, b) => b[1] - a[1])[0];
    return top ? top[0] : null;
  };
  const practiceAim = (day) => {
    if (day.coach_present === false) return '各自で自走メニューを反復し、習った形を確実に体に入れよう（コーチ不在日）';
    const cat = dominantCategory(day);
    return (cat && AIM_MAP[cat]) || 'この日の重点スキルを反復で固めよう';
  };

  const days = plan.days.map((day) => {
    const startMin = START_CLOCK[day.day] ?? DEFAULT_START_MIN;
    let cur = startMin;
    const blocks = [];
    for (const b of day.blocks) {
      if (b.items.length === 0) continue;
      const blockStart = cur;
      const items = b.items.map((it) => {
        const item = {
          name: it.name,
          minutes: it.minutes,
          category: it.category,
          mode: displayMode(it, day),
          video: videoIndex.get(it.drill_id) || null,
          alternatives: (it.alternatives || []).map((a) => a.name),
        };
        cur += it.minutes;
        return item;
      });
      blocks.push({
        block: b.block,
        label: BLOCK_LABEL[b.block] || b.block,
        from: hhmm(blockStart),
        to: hhmm(cur),
        minutes: cur - blockStart,
        isBundle: BUNDLE_BLOCKS.has(b.block),
        // 2部構成の日（火）は区画（part）情報を引き継ぐ。単一セッション日は undefined。
        part: Number.isInteger(b.part) ? b.part : undefined,
        partLabel: b.part_label,
        partKind: b.part_kind,
        items,
      });
    }

    // アップ集約: CND-001（ダイナミックストレッチ）が主見出し、
    // 「可動域」タグの1分micro動作（CND-002〜006相当）をその components に畳む。
    // presentation のみ（engine データ・ブロック実尺は不変）。
    for (const bl of blocks) {
      if (!bl.isBundle || bl.block !== 'アップ') continue;
      const dynIdx = bl.items.findIndex((it) => it.name === 'ダイナミックストレッチ');
      if (dynIdx === -1) continue;
      // 同WUブロック内の、主見出し以外の「可動域」micro動作を抽出
      const microNames = [];
      const kept = [];
      for (let i = 0; i < bl.items.length; i++) {
        const it = bl.items[i];
        if (i === dynIdx) { kept.push(it); continue; }
        // duration_min<=2 かつ philosophy_tags に「可動域」が含まれる drill が micro 対象
        const rawDrill = drills.find((d) => d.name === it.name);
        const isMicro = rawDrill
          && (rawDrill.duration_max || rawDrill.duration_min || 99) <= 2
          && Array.isArray(rawDrill.philosophy_tags)
          && rawDrill.philosophy_tags.includes('可動域');
        if (isMicro) {
          microNames.push(it.name);
          // micro の実尺を主見出しに合算（合計尺は変わらない）
          bl.items[dynIdx].minutes += it.minutes;
        } else {
          kept.push(it);
        }
      }
      if (microNames.length > 0) {
        bl.items[dynIdx].components = microNames;
        bl.items = kept;
        // from/to/minutes を再算（items が変わったので）
        let t = timeToMin2(bl.from);
        for (const it of bl.items) { it._from = hhmm(t); t += it.minutes; }
        bl.to = hhmm(t);
        bl.minutes = timeToMin2(bl.to) - timeToMin2(bl.from);
      }
    }

    // 組違い用 self-fill プール（rotation 日のみ buildDays で使用）
    const domCat = dominantCategory(day);
    const usedNames = blocks.flatMap((b) => b.items.map((it) => it.name));
    const selfFillPool = buildSelfFillPool(drills, domCat, usedNames);

    // 2部構成の日（火）は区画ごとにブロックをまとめ、ヘッダ・タイムラインを分けて描けるよう
    // parts を作る。各区画は自分の開始時刻・終了時刻・ラベル・コートを持つ（engineの区画メタ由来）。
    let parts;
    if (Array.isArray(day.parts) && day.parts.length > 0) {
      parts = day.parts.map((meta, idx) => {
        const pblocks = blocks.filter((b) => b.part === idx);
        const pStart = pblocks.length ? pblocks[0].from : hhmm(startMin);
        const pEnd = pblocks.length ? pblocks[pblocks.length - 1].to : pStart;
        return {
          index: idx,
          label: meta.label,
          kind: meta.kind,
          court: meta.court,
          minutes: meta.minutes,
          start: pStart,
          end: pEnd,
          blocks: pblocks,
        };
      });
    }

    // 表示週の実日付（週起点＝period.weekStartDate の月曜から曜日オフセットで算出）。
    const dateISO = dayDateISO(weekStartDate, day.day);
    return {
      day: day.day,
      dayLabel: fullDayLabel(day.day),
      date: dateISO, // この曜日の実日付ISO（週起点未設定時は null）
      dateLabel: dateLabelYMD(dateISO), // "6/23"（未設定時は ''）
      court: day.court,
      coachPresent: day.coach_present !== false,
      start: hhmm(startMin),
      end: hhmm(cur),
      totalMinutes: cur - startMin,
      aim: practiceAim(day),
      blocks,
      parts, // 2部構成の日のみ（火）。単一セッション日は undefined。
      selfFillPool,
    };
  });

  // introduced は週送り用の更新後ロスター（次週の入力に連鎖させる）。
  return { days, goals, month, warnings: plan.warnings || [], introduced: plan.introduced || [] };
}

/**
 * 1チーム分の指標（KGI/KPI）。メニューは共通だが、各チームは自分の指標を追う。
 * @param {object} teamInput
 * @returns {object}
 */
function teamGoals(teamInput) {
  const kpi = (teamInput.indicators || []).map((i) => {
    const remain = i.good_direction === 'up' ? i.target - i.latest : i.latest - i.target;
    return { label: i.id, latest: i.latest, target: i.target, baseline: i.baseline, unit: i.unit, remain: Math.max(0, remain) };
  });
  const kgiText = (i) =>
    i.good_direction === 'down'
      ? `${i.id}を ${i.target}${i.unit} 以下まで減らす`
      : `${i.id}を ${i.target}${i.unit} まで上げる`;
  const mostBehind = [...kpi].sort((a, b) => b.remain - a.remain)[0] || null;
  return {
    kpi,
    kgi: (teamInput.indicators || []).map(kgiText),
    monthKpi: mostBehind ? `${mostBehind.label}を ${mostBehind.latest}${mostBehind.unit} → ${mostBehind.target}${mostBehind.unit} へ` : '',
  };
}

/**
 * 各曜日の表示単位を作る。日々のメニューは男女共通（1本）。組違いの ON/OFF はプレゼン層で
 * 切り替える:
 *   - 火金（コーチ在席・土以外）: ON=左右2列ローテ（pd.rotation.rows）／OFF=男女が別時間に各自フル。
 *   - 水木（コーチ不在）: 2列だが左右同一・全自走（independent）。
 *   - 土（コーチ在席・最長）: 1列・男女合同（together）。
 *
 * @param {object} session buildSession の結果
 * @returns {Array<object>}
 */
function buildDays(session) {
  return session.days.map((day) => {
    const isSaturday = day.day === '土';
    let kind;
    if (isSaturday && day.coachPresent) kind = 'together';
    else if (day.coachPresent) kind = 'rotation';
    else kind = 'independent';

    // 2部構成の日（火）: 区画ごとに独立した表示単位（ヘッダ・タイムライン）を作る。
    //  - 外トレ区画（kind=outdoor）= 走り込み・アジリティ。男女合同のコンディショニング（together扱い）。
    //  - 全面区画（kind=court）= コーチ在席なら組違いローテ、不在なら自走。
    let parts;
    if (Array.isArray(day.parts) && day.parts.length > 0) {
      parts = day.parts.map((p) => {
        const sub = {
          blocks: p.blocks,
          start: p.start,
          end: p.end,
          totalMinutes: p.minutes,
          day: day.day,
        };
        let partKind;
        let rotation = null;
        if (p.kind === 'outdoor') {
          // 外トレは男女合同の走り込み・アジリティ（コーチが両方を同時に見る＝together）。
          partKind = 'together';
        } else if (day.coachPresent && !isSaturday) {
          partKind = 'rotation';
          rotation = buildRotation(sub, day.selfFillPool || []);
        } else if (day.coachPresent) {
          partKind = 'together';
        } else {
          partKind = 'independent';
        }
        return {
          index: p.index,
          label: p.label,
          partCourt: p.court,
          start: p.start,
          end: p.end,
          totalMinutes: p.minutes,
          blocks: p.blocks,
          sharedKind: partKind,
          rotation,
        };
      });
    }

    // 単一セッション日の rotation（2部構成の日は parts 側に持つ）
    let rotation = null;
    if (kind === 'rotation' && !parts) {
      rotation = buildRotation(day, day.selfFillPool || []);
    }

    return {
      day: day.day,
      dayLabel: day.dayLabel,
      date: day.date, // 実日付ISO（週起点から算出済み）
      dateLabel: day.dateLabel, // "6/23"
      court: day.court,
      coachPresent: day.coachPresent,
      isSaturday,
      start: day.start,
      end: day.end,
      totalMinutes: day.totalMinutes,
      aim: day.aim,
      blocks: day.blocks, // 男女共通メニュー
      parts, // 2部構成の日（火）のみ。各区画が独自のヘッダ・タイムライン・組違いを持つ。
      sharedKind: kind,
      rotation, // 単一セッションの rotation 日のみ非 null
    };
  });
}

/**
 * 上書き手書きセル（男子/女子/both の片側）を描画セル形に正規化する。
 * 見出し(label)＋itemリスト（name＋手書きnote）を持つ。手書きは段取り不要なので mode:self 固定。
 * @param {object|undefined} cell ov.rows[].男子 / .女子 / .both のいずれか
 * @returns {{block:string,label:string,items:Array}|null} セル無し（その時間帯にその性別の予定が無い）なら null
 */
function toAuthoredCell(cell) {
  if (!cell) return null;
  return {
    block: cell.block || '',
    label: cell.label || cell.block || '',
    items: (cell.items || []).map((it) => ({
      name: it.name,
      note: it.note || '', // 手書き note を温存
      mode: 'self', // コーチ指定は段取り不要（modeMark非表示）
    })),
  };
}

/**
 * 上書き1件（layout:"two-col" の行ベーススキーマ）を男女2列タイムライン日に変換する。
 * 各 row は both（全幅1本）または 男子/女子（2カラム）を持つ。start=最初のrow.from、end=最後のrow.to。
 * @param {object} day 元の表示日（土台）
 * @param {object} ov layout:"two-col" の上書き1件
 * @param {string} dISO 実日付ISO
 * @returns {object} twoCol:true・rows を持つ source:'coach' の表示日
 */
function toTwoColDay(day, ov, dISO) {
  const rows = (ov.rows || []).map((r) => ({
    from: r.from || '',
    to: r.to || '',
    minutes: Number.isFinite(r.minutes) ? r.minutes : null,
    both: toAuthoredCell(r.both), // 全幅1本（男女共通）。無ければ null。
    boys: toAuthoredCell(r['男子']),
    girls: toAuthoredCell(r['女子']),
  }));
  const firstFrom = rows.length ? rows[0].from : day.start;
  const lastTo = rows.length ? rows[rows.length - 1].to : day.end;
  return {
    ...day, // day/dayLabel/court 等は元日を土台に
    date: dISO,
    dateLabel: dateLabelYMD(dISO), // "6/23"
    court: ov.court || day.court,
    start: firstFrom || day.start, // 最初のrow.from
    end: lastTo || day.end, // 最後のrow.to
    aim: ov.aim || day.aim, // dayHeader の狙い枠にコーチ指定の狙い
    title: ov.title,
    source: 'coach', // 描画分岐キー
    team: null, // 男女両方なので単一性別ではない
    twoCol: true, // 男女2列タイムラインで描く
    rows, // 行ベースの男女2列データ
    blocks: [], // 単一blocks経路は使わない（旧スキーマ互換ガードのため空で持つ）
    parts: undefined,
    sharedKind: 'authored',
    rotation: null,
  };
}

/**
 * 上書き1件を表示日(day)の形に変換する。
 *   - layout:"two-col"（行ベース・男女2列）: toTwoColDay（twoCol:true・rows を持つ）。
 *   - 旧スキーマ（単一blocks）: 従来どおり単一性別なら組違いを無効化し1列(authored)にする。
 * 手書きは時間割を持たないので from/to は空、minutes は手書き値（null可）をそのまま温存する。
 * @param {object} day buildDays が返した元の表示日（土台）
 * @param {object} ov getOverrides() の1要素（source:'coach'）
 * @param {string} dISO この表示日の実日付ISO（週起点から算出済み・ヘッダ日付表示に使う）
 * @returns {object} 置き換え後の表示日（source:'coach'）
 */
function toAuthoredDay(day, ov, dISO) {
  // layout:"two-col" は男女2列の行ベーススキーマ。layout 未指定/two-col 以外は旧スキーマ（単一blocks）。
  if (ov.layout === 'two-col') return toTwoColDay(day, ov, dISO);

  const isSingleGender = ov.team !== null && ov.team !== undefined;
  // 手書きブロックを描画ブロック形（plan-data の blocks と同形）に正規化。
  // コーチ指定は実時刻（from/to）とブロック尺（minutes）をデータから持つ＝タイムラインに時刻が出る。
  const blocks = (ov.blocks || []).map((b) => ({
    block: b.block,
    label: b.label || b.block,
    from: b.from || '',
    to: b.to || '',
    minutes: Number.isFinite(b.minutes)
      ? b.minutes
      : (b.items || []).reduce((s, it) => s + (Number(it.minutes) || 0), 0),
    isBundle: false,
    coach: true, // コーチ指定ブロック＝見出しを項目より大きく描く
    items: (b.items || []).map((it) => ({
      name: it.name,
      minutes: it.minutes ?? null, // ブロックに時刻があるので各itemの分は持たない
      note: it.note || '', // 手書き note を温存
      category: '',
      mode: 'self', // 上書きは段取り不要・コーチ指定で一律 self 扱い（modeMark非表示）
      video: null,
      alternatives: [],
    })),
  }));
  const firstFrom = blocks.length ? blocks[0].from : day.start;
  const lastTo = blocks.length ? blocks[blocks.length - 1].to : day.end;
  return {
    ...day, // day/dayLabel/court 等は元日を土台に
    date: dISO, // 実日付ISO（ヘッダ日付表示に使う）
    dateLabel: dateLabelYMD(dISO), // "6/23"
    court: ov.court || day.court,
    start: firstFrom || day.start, // 先頭ブロックの開始時刻
    end: lastTo || day.end, // 末尾ブロックの終了時刻（タイムライン終了行に出る）
    aim: ov.aim || day.aim, // dayHeader の狙い枠にコーチ指定の狙い
    title: ov.title, // バッジ横の見出し用（描画で参照）
    source: 'coach', // 描画分岐キー
    team: ov.team ?? null, // 単一性別 or null
    twoCol: false, // 旧スキーマは単一blocks経路
    blocks,
    parts: undefined, // 2部構成を無効化（単日として描く）
    sharedKind: isSingleGender ? 'authored' : day.sharedKind,
    rotation: null, // 単一性別/上書き日は組違いを出さない
  };
}

/**
 * コーチ指定の上書き日を days[] に合流する（決定論・実日付一致・単一性別1列化）。
 * 表示中の週（週起点＝weekStartDate の月曜）から各曜日の実日付を算出し、source:'coach'
 * かつ上書き date がその実日付と一致する上書きだけを当てる。実日付一致なので、別週・別曜日の
 * 上書きはこの週には漏れ込まない（bleedしない）。
 * @param {Array} days buildDays の結果
 * @param {Array} overrides getOverrides() の結果
 * @param {string} weekStartDate 表示週の月曜ISO（config.week_start_date）。未設定なら何も当てない。
 * @returns {Array} 置き換え後の days（非該当日は元の参照をそのまま返す）
 */
export function applyOverrides(days, overrides, weekStartDate) {
  if (!Array.isArray(overrides) || overrides.length === 0 || !weekStartDate) return days;
  return days.map((day) => {
    const dISO = dayDateISO(weekStartDate, day.day);
    if (!dISO) return day;
    const ov = overrides.find((o) => o.source === 'coach' && o.date === dISO);
    if (!ov) return day;
    return toAuthoredDay(day, ov, dISO);
  });
}

/**
 * 叩き台（エンジン生成日）を「空状態日」へ畳む（既定空白の単一真実源）。
 *
 * オーナー方針: コーチが入力していない日は中身を出さない。エンジンが各日に作る叩き台メニュー
 * （ドリル/時間割/組違いローテ/2部構成）は表示しない＝空状態に倒す。ただし日付・曜日・コート・
 * コーチ在席は日ピッカー／週グリッド／ヘッダの連続性のために残す（描画は空状態UIで出す）。
 * 叩き台そのものは捨てず seedDays として温存し、コーチが「自動で叩き台を入れる」を押したときの
 * 自動入力ソースにする（buildPlanData が seedDays を保持し editor のデータ島へ prefill する）。
 *
 * @param {object} day buildDays の結果1日（エンジン叩き台）
 * @param {?string} dISO この表示日の実日付ISO（週起点から算出済み・null可）
 * @returns {object} source:'empty' の空状態日
 */
function toEmptyDay(day, dISO) {
  return {
    day: day.day,
    dayLabel: day.dayLabel,
    date: dISO ?? day.date ?? null,
    dateLabel: dISO ? dateLabelYMD(dISO) : (day.dateLabel || ''),
    court: day.court,
    coachPresent: day.coachPresent,
    isSaturday: day.isSaturday,
    source: 'empty', // 描画分岐キー（空状態UIを出す）
    aim: '', // 叩き台の狙いは出さない（未入力）
    blocks: [], // 叩き台メニューは出さない
    parts: undefined, // 2部構成も出さない
    sharedKind: 'empty',
    rotation: null,
  };
}

/**
 * 既定空白の合流（決定論・実日付一致）。コーチ上書きがある日だけ手書き内容を出し、無い日は
 * エンジン叩き台を表示せず空状態に倒す（オーナー方針「未入力は空白」）。
 *
 * applyOverrides との違い: 上書きの無い日を「エンジン日そのまま」ではなく「空状態日」にする。
 * これが製品中核の挙動変更（自動で叩き台を出す→既定は空白）。叩き台は捨てず seedDays に残す。
 *
 * @param {Array} days buildDays の結果（エンジン叩き台）
 * @param {Array} overrides getOverrides() の結果
 * @param {?string} weekStartDate 表示週の月曜ISO。未設定なら全日 date:null の空状態に倒す。
 * @returns {Array} コーチ上書き日＝手書き／その他＝空状態 の days
 */
export function applyOverridesWithEmpty(days, overrides, weekStartDate) {
  const ovs = Array.isArray(overrides) ? overrides : [];
  return days.map((day) => {
    const dISO = weekStartDate ? dayDateISO(weekStartDate, day.day) : null;
    const ov = dISO ? ovs.find((o) => o.source === 'coach' && o.date === dISO) : null;
    if (ov) return toAuthoredDay(day, ov, dISO);
    return toEmptyDay(day, dISO);
  });
}

/**
 * コーチが編集した週/月/年の目標テキスト上書きを、組み立て済みの表示データへ適用する（決定論）。
 *
 * データモデルの要点（design 確定）:
 *   - 週の焦点は週起点日キー（YYYY-MM-DD）の `weeks` マップ。各週だけに効く。
 *   - 月の目標と年アークの各月見出しは同一源（annual.months[arcMonth].headline）。だから月の目標と
 *     年の各月の目標は arc月キーの同一マップ（`arcMonths`）で扱う＝月タブで編集すると年タブの同じ
 *     arc月セルにも反映される（単一真実源・正しい挙動）。
 *
 * 空文字は上書きとして扱わない（バックエンドが空文字キーを削除＝エンジン値へ戻すため、上書きマップに
 * 残らない。マップに残った値は必ず非空）。ここでも非空ガードを置いて二重防御する。
 *
 * @param {object} parts 組み立て済みデータ片（参照を直接書き換える）
 * @param {Array}  parts.weeks   週ピッカー用の複数週（先頭=アンカー）。各 weekStartDate/focus/goals を持つ。
 * @param {Array}  parts.months  月ピッカー用の複数月。各 arcMonth/month.headline を持つ。
 * @param {object} parts.year    年リボン（arc[].month=arc月・arc[].headline）。
 * @param {object} parts.session アンカー（session.goals.week/monthMain・session.month.headline/arcMonth）。
 * @param {{weeks:Object<string,string>, arcMonths:Object<string,string>}} goalOverrides storage.getGoalOverrides() の結果
 * @returns {object} parts（同一参照・テスト容易性のため返す）
 */
export function applyGoalOverrides(parts, goalOverrides) {
  const weekMap = (goalOverrides && goalOverrides.weeks) || {};
  const arcMap = (goalOverrides && goalOverrides.arcMonths) || {};
  const { weeks, months, year, session } = parts;

  // ── 週: weekStartDate キーで該当週だけに効く。アンカー週は session.goals.week も同値に。──
  for (const w of (weeks || [])) {
    const key = w.weekStartDate;
    const text = key ? weekMap[key] : '';
    if (typeof text === 'string' && text !== '') {
      w.focus = text;
      if (w.goals) w.goals.week = text;
    }
  }
  // アンカー週（先頭）の上書きを session.goals.week にも反映（top-level 展開の整合）。
  if (session && session.goals && weeks && weeks[0] && weeks[0].weekStartDate) {
    const text = weekMap[weeks[0].weekStartDate];
    if (typeof text === 'string' && text !== '') session.goals.week = text;
  }

  // ── 月/年: arc月キーで months / year.arc / session（アンカーarc月）の同一見出しに効く。──
  for (const m of (months || [])) {
    const text = arcMap[String(m.arcMonth)];
    if (typeof text === 'string' && text !== '') {
      if (m.month) m.month.headline = text;
    }
  }
  for (const a of (year && year.arc ? year.arc : [])) {
    const text = arcMap[String(a.month)];
    if (typeof text === 'string' && text !== '') a.headline = text;
  }
  if (session && session.month) {
    const text = arcMap[String(session.month.arcMonth)];
    if (typeof text === 'string' && text !== '') {
      session.month.headline = text;
      if (session.goals) session.goals.monthMain = text;
    }
  }
  return parts;
}

/**
 * 既定空白の目標合流（決定論・空文字は上書きしない）。
 *
 * オーナー方針「未入力は空白」を目標（週/月/年）にも適用する。applyGoalOverrides は上書きの
 * 無い目標をエンジン既定見出しのまま残すが、本関数はコーチ上書きの**無い**目標を空文字に倒す
 * （＝空状態UIを出す）。エンジン既定見出し（叩き台）は捨てず seed* フィールドに退避し、コーチが
 * 「自動で叩き台を入れる」を押せば編集欄に呼べるようにする（目標の自動入力ソース）。
 *
 * 効かせる範囲は applyGoalOverrides と同じ（weeks の focus/goals.week・months の month.headline・
 * year.arc[].headline・session の month.headline/goals.monthMain）。定性（qualitative）と KPI ヒントは
 * 「数字」であって自由記述の目標ではないため空白化しない（叩き台のまま＝チェックする数字の案内）。
 *
 * @param {object} parts applyGoalOverrides と同じ {weeks, months, year, session}
 * @param {{weeks:Object<string,string>, arcMonths:Object<string,string>}} goalOverrides
 * @returns {object} parts（同一参照）
 */
export function applyGoalOverridesWithEmpty(parts, goalOverrides) {
  const weekMap = (goalOverrides && goalOverrides.weeks) || {};
  const arcMap = (goalOverrides && goalOverrides.arcMonths) || {};
  const { weeks, months, year, session } = parts;
  const authored = (v) => typeof v === 'string' && v !== '';

  // ── 週: コーチ上書きがあればそれ／無ければ空白（叩き台は seedFocus へ退避）。──
  for (const w of (weeks || [])) {
    const text = w.weekStartDate ? weekMap[w.weekStartDate] : '';
    w.seedFocus = w.focus; // エンジン既定（叩き台）を退避＝自動入力ソース
    if (authored(text)) {
      w.focus = text;
      if (w.goals) w.goals.week = text;
    } else {
      w.focus = '';
      if (w.goals) { w.goals.seedWeek = w.goals.week; w.goals.week = ''; }
    }
  }
  if (session && session.goals) {
    const w0 = weeks && weeks[0];
    const text = w0 && w0.weekStartDate ? weekMap[w0.weekStartDate] : '';
    session.goals.seedWeek = session.goals.seedWeek ?? session.goals.week;
    session.goals.week = authored(text) ? text : '';
  }

  // ── 月/年: arc月キーで該当見出し。コーチ上書きが無ければ空白（叩き台は seedHeadline へ退避）。──
  for (const m of (months || [])) {
    if (!m.month) continue;
    const text = arcMap[String(m.arcMonth)];
    m.month.seedHeadline = m.month.headline;
    m.month.headline = authored(text) ? text : '';
  }
  for (const a of (year && year.arc ? year.arc : [])) {
    const text = arcMap[String(a.month)];
    a.seedHeadline = a.headline;
    a.headline = authored(text) ? text : '';
  }
  if (session && session.month) {
    const text = arcMap[String(session.month.arcMonth)];
    session.month.seedHeadline = session.month.headline;
    session.month.headline = authored(text) ? text : '';
    if (session.goals) {
      session.goals.seedMonthMain = session.goals.monthMain;
      session.goals.monthMain = authored(text) ? text : '';
    }
  }
  return parts;
}

/**
 * 練習計画UIの単一データを組み立てる（決定論・LLM不使用）。
 *
 * データ源は注入された storage に一本化（ローカルJSON or Firestore）。storage は
 * createLocalStorage / createFirestoreStorage のどちらでもよく、同じ契約
 * （getDrills/getConfig/getTeamInput/getOverrides/getAnnualPlan）を満たす。
 * 男子メニュー本体は storage から、女子は指標(KPI)のみ girlsStorage から引く。
 *
 * @param {Object} deps
 * @param {import('../engine/src/storage.js').Storage} deps.storage      男子（共通メニュー本体＋年間計画＋上書き）
 * @param {import('../engine/src/storage.js').Storage} deps.girlsStorage 女子（指標のみ）
 * @param {string} [deps.school] テナント表示名（マルチテナント解決後の tenant.name）。
 *                               未指定なら従来の現行校名にフォールバック（ローカル静的ビルド互換）。
 * @returns {Promise<object>} pattern-*.mjs の render() に渡す表示データ
 */
export async function buildPlanData({ storage, girlsStorage, school }) {
  if (!storage || !girlsStorage) {
    throw new Error('buildPlanData: storage と girlsStorage の注入が必須です');
  }

  const [annual, rawDrills, config, teamInput, girlsInput, overrides, goalOverrides] = await Promise.all([
    storage.getAnnualPlan(),
    storage.getDrills(),
    storage.getConfig(),
    storage.getTeamInput(),
    girlsStorage.getTeamInput(),
    storage.getOverrides(),
    storage.getGoalOverrides(),
  ]);
  const drills = normalizeDrills(rawDrills);

  const currentMonth = config.current_month;
  const anchor = {
    currentMonth,
    weekOfMonth: config.week_of_month ?? 1,
    weekStartDate: config.week_start_date || null,
  };

  // 1期間（1週）を生成する単位。period を変えて反復することで複数週を作る（案B）。
  // 既定空白方針: エンジン叩き台（buildDays）は seedDays として温存し、表示用 days は
  // コーチ上書きのある日だけ手書き／その他は空状態に倒す（applyOverridesWithEmpty）。
  // 叩き台を捨てないので「自動で叩き台を入れる」で editor に呼び戻せる。
  const buildOneWeek = (period) => {
    const s = buildSession({ annual, drills, config, teamInput, period });
    const seedDays = buildDays(s); // エンジン叩き台（自動入力ソース・表示しない）
    // コーチ上書きは各週の週起点で実日付一致＝別週へ漏れない（applyOverrides 既存設計を踏襲）。
    const weekDays = applyOverridesWithEmpty(seedDays, overrides, period.weekStartDate);
    return { session: s, days: weekDays, seedDays };
  };

  // ── 週ピッカー用の複数週（現アーク月の週1..N。焦点が型→反復で変わる）──────────────
  const weekDefs = anchor.weekStartDate
    ? computeWeekPeriods(anchor)
    : [{ key: 'w0', label: '今週', currentMonth: anchor.currentMonth, weekOfMonth: anchor.weekOfMonth, weekStartDate: null }];
  // 既習レクチャ・ロスターを週送りで連鎖（週Nの更新後を週N+1の入力へ）。土曜レクチャが週ごとに進む。
  let introducedSoFar = Array.isArray(config.introduced) ? config.introduced : [];
  const weeks = weekDefs.map((wp) => {
    const built = buildOneWeek({ ...wp, introduced: introducedSoFar });
    introducedSoFar = built.session.introduced || introducedSoFar;
    return {
      key: wp.key,
      label: wp.label,
      weekStartDate: wp.weekStartDate,
      focus: built.session.goals.week, // 今週の焦点（週ごとに変わる＝実切替の中身差）
      days: built.days,
      seedDays: built.seedDays, // エンジン叩き台（表示しない・自動入力ソース）
      goals: built.session.goals,
      month: built.session.month,
      warnings: built.session.warnings || [],
    };
  });

  // アンカー＝先頭週を top-level に展開（後方互換: 既存 days/session/month の参照を壊さない）。
  const anchorWeek = weeks[0];
  const session = { goals: anchorWeek.goals, month: anchorWeek.month };
  const days = anchorWeek.days;
  const seedDays = anchorWeek.seedDays; // アンカー週の叩き台（表示しない・自動入力ソース）

  // 表示する暦月: 週起点の暦月（例 2026-06-22 → 6月）。フェーズ位置（current_month=7）とは別軸で、
  // ヘッダ・index・配布テキストの「N月」表示に使う。週起点未設定時は従来どおり current_month。
  const displayCalendarMonth = anchor.weekStartDate
    ? Number(anchor.weekStartDate.split('-')[1])
    : wrapMonth(currentMonth);

  // ── 月ピッカー用の複数月（現月から半年。各月は年間計画のアーク内容＝週生成不要で軽量）──
  const anchorYear = anchor.weekStartDate ? Number(anchor.weekStartDate.split('-')[0]) : null;
  const monthDefs = anchorYear
    ? computeMonthPeriods({ currentMonth: anchor.currentMonth, displayMonth: displayCalendarMonth, year: anchorYear })
    : [];
  const months = monthDefs.map((mp) => {
    const r = resolveMonth(annual, '男子', mp.currentMonth);
    return {
      key: mp.key,
      label: mp.label,
      displayMonth: mp.displayMonth,
      arcMonth: r.arcMonth, // 月パネルが目標上書きを引くキー（年アーク月＝月と年で同一源）
      month: {
        displayMonth: mp.displayMonth,
        arcMonth: r.arcMonth,
        phase: r.phase,
        headline: r.headline,
        kpiHints: r.kpi_hints,
        peak: r.peak,
        peakLevel: r.peak_level,
      },
    };
  });

  // 年リボン: 新チーム12ヶ月アーク（8→7月）。フェーズは共通（男子基準の1本arc）。
  // 男女の「いま」は両方とも暦月に固定する（男女は同じ時間に生きているので現在位置はずれない）。
  const arc = yearArc(annual, '男子', currentMonth).map((e) => ({
    month: e.month,
    phase: e.phase,
    headline: e.headline,
    peak: e.peak,
    peakLevel: e.peak_level,
  }));
  const year = {
    arc,
    // 年の「いま」は男女とも同じ暦月。女子先行offset（_gender_offset）は arc 構造の遠因であり、
    // 「いま」の位置には効かせない（男女は同じ時間に生きているので現在位置はずれない）。
    currentBoys: currentMonth,
    currentGirls: currentMonth,
    peaks: annualPeaks(annual),
  };

  // ── コーチが編集した週/月/年の目標テキストを上書き適用（既定空白・決定論）──
  // 既定空白方針: コーチ上書きのある目標だけ表示し、無い目標は空白（叩き台＝seed* へ退避し
  // 「自動で叩き台を入れる」で呼べる）。週は週起点日キー、月/年は arc月キー（月と年は同一源）。
  applyGoalOverridesWithEmpty({ weeks, months, year, session }, goalOverrides);

  // 描画キー（編集導線が目標保存APIへ渡す scope/key の単一真実源）。
  //   - weekKey: アンカー週の週起点ISO（無ければ null＝編集導線を出さない）。
  //   - monthArcKey: アンカーの arc月（月/年の目標上書きの単一源キー）。
  const goalKeys = {
    weekKey: (weeks[0] && weeks[0].weekStartDate) || null,
    monthArcKey: session.month.arcMonth,
  };

  // ── ドリル詳細レジストリ（素カタログ・notesクレンジング済み）──────────────────
  // normalize.js 経由では balls 等が落ちるため、素レコード(rawDrills)から直接構築する。
  // storage.getDrills() の戻り値を normalize 用と詳細レジストリ用に共用（二重読みなし）。
  // 名前→詳細オブジェクトの Map。タイムラインのドリル名が Map に無い場合は throw。
  const drillIndex = buildDrillRegistry(rawDrills);

  // 編集画面の枠別ドリル候補（自動生成と同一の枠判定＝editorBlockOf 経由で blockOf を再利用）。
  // エンジンと同じ正規化済みドリル集合（drills）から作るので、手編集の候補が自動生成の枠分けと揃う。
  const blockCandidates = buildBlockCandidates(drills);

  return {
    // テナント名（解決後の tenant.name）。マルチテナント前のローカル静的ビルドは従来の現行校名にフォールバック。
    school: school ?? '南中野中',
    month: displayCalendarMonth, // 表示する暦月（週起点由来＝6月）。フェーズ位置(current_month=7)は year/session が保持。
    groups: ['男子', '女子'],
    session: { goals: session.goals, month: session.month },
    boysGoals: teamGoals(teamInput),
    girlsGoals: teamGoals(girlsInput),
    days, // アンカー週（先頭期間）の days。日レベルはこれを使う（後方互換）。
    seedDays, // アンカー週のエンジン叩き台（表示しない・「自動で叩き台を入れる」の自動入力ソース）。
    weeks, // 週ピッカー実切替用の複数週（先頭=アンカー）。
    months, // 月ピッカー実切替用の複数月（先頭=現月）。
    year,
    goalKeys, // 目標編集導線が目標保存APIへ渡す scope/key の単一真実源（weekKey/monthArcKey）
    drillIndex,
    blockCandidates, // 編集画面の枠別ドリル候補（枠に応じた候補だけを提案する）
    assumptions: [
      '練習メニューは男女共通（コーチ1人が両方を見るため）。組違いはコーチ付き段を男女でずらして回す。',
      '体育館のコート割り（男女どちらが左/右半面・どの曜日に合同/分離）は年間予定に書かれていないため暫定。',
      '今は男女とも同じ年間の流れにいる。大会の時期に男女差があるかは未確定（コーチ確認）。確認が取れるまで男女差は表示に出さない。',
      '選手の指標は合成値（実選手データは個人情報のため未接続）。',
    ],
    warnings: anchorWeek.warnings,
  };
}
