/**
 * @file 練習計画UI の単一データソース（決定論・LLM不使用）。
 *
 * エンジン（planWeek）の実出力を読み、UIの全パターン・全レベル（年/月/週/日）が
 * 共有する構造化データを返す。HTML描画はこのデータだけを真実源にする — 数値・ドリル・
 * 時刻・「いずれか」候補・組違いローテ・目標は常にエンジンの本物の出力から決定論的に派生。
 *
 * 表示規約（しんたろうさんの却下フィードバック反映）:
 *   - 時刻は `HH:MM`（コロン区切り。`0900` のような4桁無コロンにしない）。
 *   - 時間ブロックは「開始〜終了」の範囲を持ち、各段は持続尺（エンジンが5分丸めで保証）。
 *   - 段は主ドリル＋同カテゴリの「いずれか」候補（エンジンの alternatives）。
 *   - 目標は KGI / KPI / 定性 の3層＋「今月 / 今週 / 本日」の3段（木曜練習計画Docの型）。
 *
 * 年/月レベルはエンジン未実装のため、config.phase と大会カレンダー（一般情報）から仮置きで導出する。
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { createLocalStorage } from '../engine/src/storage.js';
import { normalizeDrills } from '../engine/src/normalize.js';
import { planWeek } from '../engine/src/planWeek.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const engineRoot = resolve(__dirname, '../engine');
const repoRoot = resolve(__dirname, '..');

// ── 表記辞書（役割名・短縮名・狙い）──────────────────────────────────────────
const PHASE_THEME = {
  準備: 'オールコートマンツーの型と、個人ファンダの土台を全員で固める',
  鍛錬: '強度を上げ、接触と競り合いに強くなる',
  試合: '実戦での判断とセットの精度を上げる',
  移行: '疲労を抜き、次のシーズンへ橋渡しする',
};
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
const MODE_LABEL = { self: '自走', practice: 'コーチ付き', lecture: 'レクチャ' };
/** その日の開始時刻（実スケジュール: 平日16:00開始、土は09:00開始）。 */
const START_CLOCK = { 土: 9 * 60, 日: 9 * 60 };
const DEFAULT_START_MIN = 16 * 60;

const shortCat = (c) => SHORT_CAT[c] || c;
const hhmm = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const fullDayLabel = (d) => `${d}曜`;

/**
 * 年間フェーズ帯（仮置き・依存線なしの期間帯）。シーズン構造（夏の大会＝現チーム／
 * 新人大会＝新チームの2つの山）から導出。大会名は一般公開情報。
 */
function buildYearBands(currentMonth) {
  const bands = [
    { phase: '準備', months: [4, 5], focus: '個人ファンダと型の土台づくり', peak: false },
    { phase: '鍛錬', months: [5, 6], focus: '強度を上げ接触に強くなる', peak: false },
    { phase: '夏の大会（現チーム）', months: [6, 7], focus: '中野区選手権→東京都選手権でピークを作る', peak: true },
    { phase: '新チーム始動', months: [8, 9, 10], focus: '代替わり。新チームの型を入れ直す', peak: false },
    { phase: '新人大会（新チーム）', months: [11, 12, 1, 2], focus: '区新人→都新人でピークを作る', peak: true },
    { phase: '研修・1年生大会', months: [3], focus: '経験を積ませ次年度へ橋渡し', peak: false },
  ];
  return bands.map((b) => ({ ...b, current: b.months.includes(currentMonth) }));
}

/**
 * 月レベルの足場（仮置き）。当月の重点（KGI/KPIギャップ）と週の狙いを、月内の
 * 4週分のテーマ配分として並べる。エンジンは1週ぶんしか出さないので、当週＝実データ、
 * 他週＝同テーマの反復として示す（仮置きである旨を持たせる）。
 */
function buildMonthWeeks(weekGoal, monthMain) {
  return [
    { label: '第1週', theme: weekGoal, note: '当週（実データ）', current: true },
    { label: '第2週', theme: weekGoal, note: '反復で定着（仮置き）', current: false },
    { label: '第3週', theme: monthMain, note: '強度を一段上げる（仮置き）', current: false },
    { label: '第4週', theme: '実戦形式で確認', note: '練習試合・ゲーム比率↑（仮置き）', current: false },
  ];
}

export async function buildPlanData() {
  const storage = createLocalStorage({
    drillsPath: resolve(repoRoot, 'docs/practice-knowledge/data/drills.json'),
    configPath: resolve(engineRoot, 'data/config.sample.json'),
    inputPath: resolve(engineRoot, 'data/team-input.sample.json'),
  });
  const [rawDrills, config, teamInput] = await Promise.all([
    storage.getDrills(),
    storage.getConfig(),
    storage.getTeamInput(),
  ]);
  const drills = normalizeDrills(rawDrills);
  const plan = planWeek(drills, config, teamInput);
  const videoIndex = new Map(drills.map((d) => [d.id, d.video_url || null]));

  const phase = config.phase || '準備';
  const monthMain = PHASE_THEME[phase] || '今期の重点スキルを固める';

  // KPI（測定指標）と最も遅れている指標。
  const kpi = (teamInput.indicators || []).map((i) => {
    const remain = i.good_direction === 'up' ? i.target - i.latest : i.latest - i.target;
    return { label: i.id, latest: i.latest, target: i.target, baseline: i.baseline, unit: i.unit, remain: Math.max(0, remain) };
  });
  const mostBehind = [...kpi].sort((a, b) => b.remain - a.remain)[0] || null;

  // 今週の重点＝計画に実際に配分された主カテゴリ上位2つ（カテゴリ名に「/」を含むため
  // focus_summary文字列のパースはせず、実分数から決定論的に導出する）。
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

  // KGI（成果目標）は指標の方向に合わせて自然文にする（up=上げる / down=減らす）。
  const kgiText = (i) =>
    i.good_direction === 'down'
      ? `${i.id}を ${i.target}${i.unit} 以下まで減らす`
      : `${i.id}を ${i.target}${i.unit} まで上げる`;

  // 目標3層（KGI=成果 / KPI=測定 / 定性=質的）。木曜練習計画Docの型。
  const goals = {
    monthMain,
    monthKpi: mostBehind ? `${mostBehind.label}を ${mostBehind.latest}${mostBehind.unit} → ${mostBehind.target}${mostBehind.unit} へ` : '',
    week: weekGoal,
    kgi: (teamInput.indicators || []).map(kgiText),
    kpi,
    qualitative: topCats.map((c) => AIM_MAP[c] || `${shortCat(c)}を磨く`),
  };

  // 各日の段（持続段＋いずれか）を HH:MM の時間ブロックに変換。
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

  const week = plan.days.map((day) => {
    const startMin = START_CLOCK[day.day] ?? DEFAULT_START_MIN;
    let cur = startMin;
    const blocks = [];
    for (const b of day.blocks) {
      if (b.items.length === 0) continue; // 空ブロックは出さない
      const blockStart = cur;
      const items = b.items.map((it) => {
        const item = {
          name: it.name,
          minutes: it.minutes,
          category: it.category,
          mode: it.coaching_mode || (it.needs_coach ? 'practice' : 'self'),
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
        // WU/CD は短いドリルの束（個別時刻は出さない）。主段は持続段。
        isBundle: b.block === 'WU' || b.block === 'CD',
        items,
      });
    }
    const rotation = (plan.weekday_groups || []).find((g) => g.day === day.day) || null;
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
      rotation,
    };
  });

  // 組違いローテの2レーン化（在席日のみ）: コーチ付きレーン と 自走レーン を時間で並べる。
  const rotationTable = week
    .filter((d) => d.rotation && d.rotation.kind === 'weekday')
    .map((d) => {
      const rounds = (d.rotation.rounds || []).filter((r) => r.kind === 'rotation');
      return {
        day: d.day,
        dayLabel: d.dayLabel,
        groups: config.groups || ['男子', '女子'],
        rounds: rounds.map((r) => ({
          coached: { name: r.practice.name, minutes: r.practice.minutes },
          self: r.self_fill.map((s) => ({ name: s.name, minutes: s.minutes })),
        })),
      };
    });

  return {
    team: {
      id: config.team_id,
      label: config.team_label || config.team_id,
      month: config.current_month,
      phase,
      phaseTheme: monthMain,
      groups: config.groups || ['男子', '女子'],
      players: '男女各10名前後',
    },
    goals,
    monthWeeks: buildMonthWeeks(weekGoal, monthMain),
    year: buildYearBands(config.current_month),
    week,
    rotationTable,
    warnings: plan.warnings || [],
  };
}
