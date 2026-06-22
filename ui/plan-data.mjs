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
import { planWeek } from '../engine/src/planWeek.js';
import { resolveMonth, resolveWeekFocus, yearArc, peaks as annualPeaks } from '../engine/src/annualPlan.js';
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
function buildSession({ annual, drills, config, teamInput }) {
  const currentMonth = config.current_month;
  const weekOfMonth = config.week_of_month ?? 1;
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

    // 表示週の実日付（週起点＝config.week_start_date の月曜から曜日オフセットで算出）。
    const dateISO = dayDateISO(config.week_start_date, day.day);
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

  return { days, goals, month, warnings: plan.warnings || [] };
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
 * @returns {Promise<object>} pattern-*.mjs の render() に渡す表示データ
 */
export async function buildPlanData({ storage, girlsStorage }) {
  if (!storage || !girlsStorage) {
    throw new Error('buildPlanData: storage と girlsStorage の注入が必須です');
  }

  const [annual, rawDrills, config, teamInput, girlsInput, overrides] = await Promise.all([
    storage.getAnnualPlan(),
    storage.getDrills(),
    storage.getConfig(),
    storage.getTeamInput(),
    girlsStorage.getTeamInput(),
    storage.getOverrides(),
  ]);
  const drills = normalizeDrills(rawDrills);

  // 男女共通の練習メニュー（1本）。
  const session = buildSession({ annual, drills, config, teamInput });
  const currentMonth = config.current_month;
  // コーチ指定の上書き日を合流（実日付一致・単一性別1列化）。上書きが無い日は従来どおり。
  const days = applyOverrides(buildDays(session), overrides, config.week_start_date);
  // 表示する暦月: 週起点の暦月（例 2026-06-22 → 6月）。フェーズ位置（current_month=7）とは別軸で、
  // ヘッダ・index・配布テキストの「N月」表示に使う。週起点未設定時は従来どおり current_month。
  const displayCalendarMonth = config.week_start_date
    ? Number(config.week_start_date.split('-')[1])
    : currentMonth;

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

  // ── ドリル詳細レジストリ（素カタログ・notesクレンジング済み）──────────────────
  // normalize.js 経由では balls 等が落ちるため、素レコード(rawDrills)から直接構築する。
  // storage.getDrills() の戻り値を normalize 用と詳細レジストリ用に共用（二重読みなし）。
  // 名前→詳細オブジェクトの Map。タイムラインのドリル名が Map に無い場合は throw。
  const drillIndex = buildDrillRegistry(rawDrills);

  return {
    school: '南中野中',
    month: displayCalendarMonth, // 表示する暦月（週起点由来＝6月）。フェーズ位置(current_month=7)は year/session が保持。
    groups: ['男子', '女子'],
    session: { goals: session.goals, month: session.month },
    boysGoals: teamGoals(teamInput),
    girlsGoals: teamGoals(girlsInput),
    days,
    year,
    drillIndex,
    assumptions: [
      '練習メニューは男女共通（コーチ1人が両方を見るため）。組違いはコーチ付き段を男女でずらして回す。',
      '体育館のコート割り（男女どちらが左/右半面・どの曜日に合同/分離）は年間予定に書かれていないため暫定。',
      '今は男女とも同じ年間の流れにいる。大会の時期に男女差があるかは未確定（コーチ確認）。確認が取れるまで男女差は表示に出さない。',
      '選手の指標は合成値（実選手データは個人情報のため未接続）。',
    ],
    warnings: session.warnings,
  };
}
