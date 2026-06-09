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
 *      翌夏の中体連の2つ）。大会の山は男女で時期がずれる（女子が約1ヶ月先行）ので年リボンに併記。
 *
 * 表示規約:
 *   - 時刻は `HH:MM`（平日16:00開始・土09:00開始）。各段は持続尺（エンジンが5分丸めで保証）。
 *   - 段は主ドリル＋同カテゴリの「いずれか」候補（エンジンの alternatives）。
 *   - 平日に出る既習レクチャ型は反復＝自走表示。コーチ不在日（水木）は全段を自走表示。
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { createLocalStorage } from '../engine/src/storage.js';
import { normalizeDrills } from '../engine/src/normalize.js';
import { planWeek } from '../engine/src/planWeek.js';
import { loadAnnualPlan, resolveMonth, yearArc, peaks as annualPeaks } from '../engine/src/annualPlan.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const engineRoot = resolve(__dirname, '../engine');
const repoRoot = resolve(__dirname, '..');

// ── 表記辞書（カテゴリ→狙い／短縮名）──────────────────────────────────────────
const AIM_MAP = {
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
const SHORT_CAT = {
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
const BLOCK_LABEL = { WU: 'ウォームアップ', 技術: '技術', 対人: '対人', ゲーム: 'ゲーム形式', CD: 'ダウン' };
/** その日の開始時刻（実スケジュール: 平日16:00開始、土は09:00開始）。 */
const START_CLOCK = { 土: 9 * 60, 日: 9 * 60 };
const DEFAULT_START_MIN = 16 * 60;

const shortCat = (c) => SHORT_CAT[c] || c;
const hhmm = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const fullDayLabel = (d) => `${d}曜`;

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
  // 共有セッションの基準月（暦月そのまま）。男女共通の1メニュー。
  const resolved = resolveMonth(annual, '男子', currentMonth);
  const cfg = {
    ...config,
    phase: resolved.phase,
    phase_category_weights: resolved.focus_weights,
    shared_gym: false,
  };
  delete cfg.groups;

  const plan = planWeek(drills, cfg, teamInput);
  const videoIndex = new Map(drills.map((d) => [d.id, d.video_url || null]));
  const lectureHostDay = plan.saturday_lecture?.day ?? '土';

  const displayMode = (it, day) => {
    if (day.coach_present === false) return 'self'; // コーチ不在日は全段自走
    const raw = it.coaching_mode || (it.needs_coach ? 'practice' : 'self');
    if (raw === 'lecture' && day.day !== lectureHostDay) return 'self';
    return raw;
  };

  // 今週の重点＝計画に実際に配分された主カテゴリ上位2つ（実分数から決定論的に導出）。
  const mainMinutesByCat = {};
  for (const day of plan.days) {
    for (const b of day.blocks) {
      if (b.block === 'WU' || b.block === 'CD') continue;
      for (const it of b.items) mainMinutesByCat[it.category] = (mainMinutesByCat[it.category] || 0) + it.minutes;
    }
  }
  const topCats = Object.entries(mainMinutesByCat)
    .sort((a, b) => b[1] - a[1])
    .map(([c]) => c)
    .slice(0, 2);
  const weekGoal = topCats.length
    ? `「${topCats.map(shortCat).join('」と「')}」を重点的に磨く`
    : '今週の重点スキルを反復で固める';

  const goals = {
    monthMain: resolved.headline,
    week: weekGoal,
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
      if (b.block === 'WU' || b.block === 'CD') continue;
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
        isBundle: b.block === 'WU' || b.block === 'CD',
        items,
      });
    }
    return {
      day: day.day,
      dayLabel: fullDayLabel(day.day),
      court: day.court,
      coachPresent: day.coach_present !== false,
      start: hhmm(startMin),
      end: hhmm(cur),
      totalMinutes: cur - startMin,
      aim: practiceAim(day),
      blocks,
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
 * 組違いローテを導出する（コーチ在席平日のみ）。共通メニューのコーチ付き段（要監督）を、
 * 男女でずらしてコーチが交互に見る。各コーチ付き段は「前半=先攻チームにコーチ付き／その間
 * もう片方は同じ段を自走→後半で入れ替え」。先攻は段ごとに男女交互にして公平にする。
 * 自走段は男女同時にできる（コーチ不要）。これでコーチ付きが同時刻に重ならない。
 *
 * @param {object} day buildSession の day
 * @returns {{coachRounds:Array, selfSegs:Array}|null}
 */
function deriveCoachSplit(day) {
  if (!day.coachPresent || day.day === '土') return null;
  const coachRounds = [];
  const selfSegs = [];
  let ci = 0;
  for (const b of day.blocks) {
    if (b.isBundle) continue;
    for (const it of b.items) {
      if (it.mode === 'practice' || it.mode === 'lecture') {
        const first = ci % 2 === 0 ? '男子' : '女子';
        const second = first === '男子' ? '女子' : '男子';
        coachRounds.push({ name: it.name, minutes: it.minutes, from: b.from, first, second });
        ci += 1;
      } else {
        selfSegs.push({ name: it.name, minutes: it.minutes, from: b.from });
      }
    }
  }
  return { coachRounds, selfSegs };
}

/**
 * 各曜日の表示単位を作る。日々のメニューは男女共通（1本）。組違いの ON/OFF はプレゼン層で
 * 切り替える:
 *   - 火金（コーチ在席・土以外）: ON=コーチ付き段を男女でずらすローテ／OFF=男女が別時間に各自フル。
 *   - 水木（コーチ不在）: ON/OFF とも男女同時に各自で自走（independent）。
 *   - 土（コーチ在席・最長）: ON=男女合同（together）／OFF=各自独立。
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
    return {
      day: day.day,
      dayLabel: day.dayLabel,
      court: day.court,
      coachPresent: day.coachPresent,
      isSaturday,
      start: day.start,
      end: day.end,
      totalMinutes: day.totalMinutes,
      aim: day.aim,
      blocks: day.blocks, // 男女共通メニュー
      sharedKind: kind,
      coachSplit: kind === 'rotation' ? deriveCoachSplit(day) : null,
    };
  });
}

export async function buildPlanData() {
  const annual = await loadAnnualPlan();

  const drillsPath = resolve(repoRoot, 'docs/practice-knowledge/data/drills.json');
  const storage = createLocalStorage({
    drillsPath,
    configPath: resolve(engineRoot, 'data/config.sample.json'),
    inputPath: resolve(engineRoot, 'data/team-input.sample.json'),
  });
  const girlsStorage = createLocalStorage({
    drillsPath,
    configPath: resolve(engineRoot, 'data/config.girls.sample.json'),
    inputPath: resolve(engineRoot, 'data/team-input.girls.sample.json'),
  });

  const [rawDrills, config, teamInput, girlsInput] = await Promise.all([
    storage.getDrills(),
    storage.getConfig(),
    storage.getTeamInput(),
    girlsStorage.getTeamInput(),
  ]);
  const drills = normalizeDrills(rawDrills);

  // 男女共通の練習メニュー（1本）。
  const session = buildSession({ annual, drills, config, teamInput });
  const days = buildDays(session);
  const currentMonth = config.current_month;

  // 年リボン: 新チーム12ヶ月アーク（8→7月）。フェーズは共通、大会の山に向かう「今」が男女で
  // 約1ヶ月ずれる（女子先行）。1本のリボンに男子今・女子今の2マーカー。
  const arc = yearArc(annual, '男子', currentMonth).map((e) => ({
    month: e.month,
    phase: e.phase,
    headline: e.headline,
    peak: e.peak,
    peakLevel: e.peak_level,
  }));
  const year = {
    arc,
    currentBoys: resolveMonth(annual, '男子', currentMonth).arcMonth,
    currentGirls: resolveMonth(annual, '女子', currentMonth).arcMonth,
    peaks: annualPeaks(annual),
  };

  return {
    school: '南中野中',
    month: currentMonth,
    groups: ['男子', '女子'],
    session: { goals: session.goals, month: session.month },
    boysGoals: teamGoals(teamInput),
    girlsGoals: teamGoals(girlsInput),
    days,
    year,
    assumptions: [
      '練習メニューは男女共通（コーチ1人が両方を見るため）。組違いはコーチ付き段を男女でずらして回す。',
      '体育館のコート割り（男女どちらが左/右半面・どの曜日に合同/分離）は原典に明記がなく暫定。',
      '大会の山は男女で約1ヶ月ずれる（女子先行）ため年リボンの「いま」が1ヶ月ずれる。先行幅はコーチ確認で確定。',
      '選手の指標は合成値（実選手データは個人情報のため未接続）。',
    ],
    warnings: session.warnings,
  };
}
