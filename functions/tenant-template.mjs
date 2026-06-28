/**
 * @file 新テナント初期化テンプレート（合成値・実校名禁止）。
 *
 * 招待承諾でテナントが払い出された直後、その配下に「叩き台」を投入して描画が成立する状態にする
 * （design §4・§7-e）。テンプレは:
 *   - tenants/{tid}/teams/boys  ＋ tenants/{tid}/teams/girls   … チーム config（合成）
 *   - tenants/{tid}/teams/{teamId}/input/latest                … 指標 KPI（合成）
 *   - tenants/{tid}/annualPlan/current                         … 年間計画（汎用シーズン構造）
 *
 * 重要（機密）: 実校名・実選手データを一切含めない。team_label は汎用語（"自チーム 男子/女子"）、
 * 指標は合成値。年間計画は basketball の普遍的シーズン構造（夏発足→冬新人→翌夏中体連の2山）で
 * 学校固有名を持たない（engine/data/annual-plan.json と同じ汎用モデル）。
 *
 * 冪等性（design §7-e）: initializeTenant は承諾 txn の外で走り、途中失敗で initialized:false の
 * テナントが残りうる。再実行で叩き台が二重生成されない（同 doc を set で上書き）よう全 set は
 * 決定論的な doc ID（boys/girls/latest/current）に対して行い、最後に initialized:true を立てる。
 */

import { FieldValue } from 'firebase-admin/firestore';

/** チーム config（合成）。schedule/philosophy はエンジンの単独チーム前提に合わせた最小の汎用枠。 */
function teamConfig(teamId, genderLabel) {
  return {
    team_id: teamId,
    team_label: `自チーム ${genderLabel}`,
    category: '中学',
    grades: [1, 2],
    philosophy: {
      df: 'オールコートマンツー一本',
      zone_forbidden: true,
      sets_forbidden_in_year: true,
      shot_clock_sec: 15,
    },
    // 準備（始動）アーク。週起点はテンプレでは持たない（コーチが実日付を入れるまで週ピッカーは
    // フェーズ駆動の相対表示にフォールバックする＝plan-data の week_start_date null 経路）。
    current_month: 7,
    week_of_month: 1,
    phase: '準備（始動）＋初戦',
    shared_gym: false,
    schedule: [
      { day: '火', minutes: 120, court: '全面', coach_present: true, parts: [
        { label: '外トレ', kind: 'outdoor', minutes: 60, court: '不問', run_minutes: 60 },
        { label: '全面', kind: 'court', minutes: 60, court: '全面', run_minutes: 0, no_funda: true },
      ] },
      { day: '水', minutes: 120, court: '半面', coach_present: false, run_minutes: 0 },
      { day: '木', minutes: 120, court: '半面', coach_present: false, run_minutes: 0 },
      { day: '金', minutes: 120, court: '全面', coach_present: true, run_minutes: 15 },
      { day: '土', minutes: 180, court: '全面', coach_present: true, run_minutes: 25 },
    ],
    coach_absent_allow: [
      'ファンダメンタル基礎', 'シュート', 'ハンドリング/ドリブル',
      'パス&スペーシング',
      'フットワーク/アジリティ/ピボット', '1on1', 'リバウンド/ボックスアウト',
      'チームディフェンス(オールコートマンツー/ヘルプ/帰陣)', '意思決定/ゲーム形式',
      'コンディショニング/ウォームアップ',
    ],
    introduced: [],
    phase_category_weights: {
      'コンディショニング/ウォームアップ': 0.1,
      'ハンドリング/ドリブル': 0.15,
      'シュート': 0.3,
      'チームオフェンス(アーリー/トランジション)': 0.15,
      'チームディフェンス(オールコートマンツー/ヘルプ/帰陣)': 0.15,
      '意思決定/ゲーム形式': 0.1,
      '1on1': 0.05,
    },
    load_caps: { high_intensity_per_session: 2, high_intensity_per_week: 3, no_consecutive_high_days: true },
  };
}

/** 指標 KPI（合成値・男女で差をつけ別チームとして出ることを確認できる値）。 */
function teamInput(teamId, indicators) {
  return { team_id: teamId, grades: [1, 2], indicators };
}

const BOYS_INDICATORS = [
  { id: 'FT率', good_direction: 'up', baseline: 40, latest: 50, target: 70, unit: '%' },
  { id: '試合TO', good_direction: 'down', baseline: 20, latest: 16, target: 10, unit: '本' },
  { id: 'ゴール下成功率', good_direction: 'up', baseline: 45, latest: 55, target: 70, unit: '%' },
];
const GIRLS_INDICATORS = [
  { id: 'FT率', good_direction: 'up', baseline: 35, latest: 45, target: 65, unit: '%' },
  { id: '試合TO', good_direction: 'down', baseline: 24, latest: 20, target: 12, unit: '本' },
  { id: 'ゴール下成功率', good_direction: 'up', baseline: 40, latest: 48, target: 65, unit: '%' },
];

/**
 * 汎用シーズン年間計画（実校名なし）。engine/data/annual-plan.json と同じ普遍モデルを
 * テンプレ用に最小化して埋め込む（夏発足→冬新人→翌夏中体連の2山・focus_weights は月別主眼）。
 * テナントごとに同一でよい（学校固有の大会名はコーチが上書きで足す前提）。
 */
function annualPlanTemplate() {
  return {
    _model: '汎用シーズン構造（合成）。夏発足→冬の新人大会→翌夏の中体連の2山。学校固有名は含めない。',
    new_team_start_month: 7,
    peaks: [
      { key: 'winter_shinjin', label: '冬の新人大会（通過点の山）', months: [11, 12, 1, 2] },
      { key: 'summer_chutairen', label: '翌夏の中体連（いちばんの目標）', months: [6, 7] },
    ],
    months: {
      '7': { phase: '準備（始動）＋初戦', headline: '代替わり後の立ち上げ。型づくり＝固定形を体に入れる', peak: null, peak_level: 0,
        focus_weights: { 'コンディショニング/ウォームアップ': 0.1, 'ハンドリング/ドリブル': 0.15, 'シュート': 0.3, 'チームオフェンス(アーリー/トランジション)': 0.15, 'チームディフェンス(オールコートマンツー/ヘルプ/帰陣)': 0.15, '意思決定/ゲーム形式': 0.1, '1on1': 0.05 },
        kpi_hints: ['ハンドリング落球', 'ゴール下/レイアップ成功率', '守備姿勢維持'],
        weekly_focus: [
          { week: 1, headline: '型づくり＝アップ→ファンダ→シュート→対人→走り込み→静的の固定形を体に入れる', mastery_bias: ['習得', '習得→反復'], allow_scrimmage: true },
          { week: '2-4', headline: '反復・強度＝固めた型を強度を上げて反復。対人を厚くし全面の日は5on5で締める', mastery_bias: ['反復', '実戦化'], allow_scrimmage: true },
        ] },
      '8': { phase: '準備（積み上げ）', headline: '点の取り方の土台を積み上げる。DF基礎を3on3で', peak: null, peak_level: 0,
        focus_weights: { 'ハンドリング/ドリブル': 0.15, 'シュート': 0.3, 'チームオフェンス(アーリー/トランジション)': 0.15, 'チームディフェンス(オールコートマンツー/ヘルプ/帰陣)': 0.15, '意思決定/ゲーム形式': 0.15, '1on1': 0.1 },
        kpi_hints: ['ゴール下/レイアップ成功率', '守備姿勢維持'] },
      '9': { phase: '準備（積み上げ）', headline: '得点の基礎を実戦（1on1/3on3/5on5）に乗せ強度を上げる', peak: null, peak_level: 0,
        focus_weights: { 'ハンドリング/ドリブル': 0.15, 'シュート': 0.3, '1on1': 0.25, '意思決定/ゲーム形式': 0.15, 'チームディフェンス(オールコートマンツー/ヘルプ/帰陣)': 0.1, 'パス&スペーシング': 0.05 },
        kpi_hints: ['1on1得点', '被OR'] },
      '10': { phase: '鍛錬', headline: '個の攻めを磨きDFのチーム連携を3on3〜5on5で固める', peak: null, peak_level: 0,
        focus_weights: { '1on1': 0.2, 'シュート': 0.35, 'チームディフェンス(オールコートマンツー/ヘルプ/帰陣)': 0.2, '意思決定/ゲーム形式': 0.15, 'ハンドリング/ドリブル': 0.1 },
        kpi_hints: ['FT率', '被FG%'] },
      '11': { phase: '試合期（新人大会）', headline: '新人大会で勝つ（冬の力試し）。攻め＋DF徹底を実戦で出す', peak: 'winter_shinjin', peak_level: 1,
        focus_weights: { '意思決定/ゲーム形式': 0.3, '1on1': 0.2, 'チームディフェンス(オールコートマンツー/ヘルプ/帰陣)': 0.2, 'チームオフェンス(アーリー/トランジション)': 0.1, 'シュート': 0.2 },
        kpi_hints: ['試合TO', 'FT率'] },
      '12': { phase: '試合期（締め・振り返り）', headline: '新人大会の締めと振り返り。次への課題出し', peak: 'winter_shinjin', peak_level: 1,
        focus_weights: { '意思決定/ゲーム形式': 0.3, 'チームディフェンス(オールコートマンツー/ヘルプ/帰陣)': 0.15, '1on1': 0.15, 'シュート': 0.3, 'チームオフェンス(アーリー/トランジション)': 0.1 },
        kpi_hints: ['試合スタッツ全般'] },
      '1': { phase: '試合期（都新人大会）', headline: '都新人大会。攻めは継続', peak: 'winter_shinjin', peak_level: 1,
        focus_weights: { '意思決定/ゲーム形式': 0.3, '1on1': 0.2, 'チームディフェンス(オールコートマンツー/ヘルプ/帰陣)': 0.15, 'チームオフェンス(アーリー/トランジション)': 0.15, 'シュート': 0.2 },
        kpi_hints: ['試合スタッツ全般'] },
      '2': { phase: '試合期（都新人大会続き）', headline: '都大会の続き・締め', peak: 'winter_shinjin', peak_level: 1,
        focus_weights: { '意思決定/ゲーム形式': 0.35, 'チームディフェンス(オールコートマンツー/ヘルプ/帰陣)': 0.2, '1on1': 0.15, 'チームオフェンス(アーリー/トランジション)': 0.15, 'シュート': 0.15 },
        kpi_hints: ['試合スタッツ全般'] },
      '3': { phase: '移行', headline: '研修大会。翌4月に新1年が加入＝次の代へ', peak: null, peak_level: 0,
        focus_weights: { '1on1': 0.2, 'ハンドリング/ドリブル': 0.2, 'シュート': 0.35, 'チームディフェンス(オールコートマンツー/ヘルプ/帰陣)': 0.15, 'コンディショニング/ウォームアップ': 0.1 },
        kpi_hints: [] },
      '4': { phase: '再編成', headline: '新年度。新1年が加入。基礎立ち上げ＋チームを組み直す', peak: null, peak_level: 0,
        focus_weights: { 'コンディショニング/ウォームアップ': 0.15, 'ハンドリング/ドリブル': 0.2, 'シュート': 0.35, '1on1': 0.15, 'チームディフェンス(オールコートマンツー/ヘルプ/帰陣)': 0.15 },
        kpi_hints: ['ハンドリング落球'] },
      '5': { phase: '試合準備', headline: '中体連へ仕上げ。実戦化し強度を上げる', peak: 'summer_chutairen', peak_level: 1,
        focus_weights: { '1on1': 0.2, 'チームディフェンス(オールコートマンツー/ヘルプ/帰陣)': 0.2, 'チームオフェンス(アーリー/トランジション)': 0.2, '意思決定/ゲーム形式': 0.15, 'シュート': 0.25 },
        kpi_hints: ['試合TO', 'FG%'] },
      '6': { phase: '試合期（中体連が本番）', headline: 'いちばん大事な大会。持てるものを出し切る', peak: 'summer_chutairen', peak_level: 2,
        focus_weights: { '意思決定/ゲーム形式': 0.35, 'チームディフェンス(オールコートマンツー/ヘルプ/帰陣)': 0.2, 'チームオフェンス(アーリー/トランジション)': 0.15, '1on1': 0.15, 'シュート': 0.15 },
        kpi_hints: ['試合スタッツ全般'] },
    },
  };
}

/**
 * 新テナント配下へ叩き台（合成テンプレ）を投入し、最後に initialized:true を立てる。
 * 承諾トランザクションの外で呼ぶ（txn 肥大化・競合回避・design §7-e）。
 * 冪等: 全 set は決定論的 doc ID（boys/girls/latest/current）への上書きで、再実行しても二重生成しない。
 *
 * 起動経路: functions/index.mjs の /api/invitations/accept ハンドラが acceptInvitation（txn）成功後に呼ぶ。
 *
 * @param {{collection:Function}} db  Firestore 互換（Admin SDK）
 * @param {string} tenantId
 * @returns {Promise<void>}
 */
export async function initializeTenant(db, tenantId) {
  if (!db) throw new Error('initializeTenant: db が必要です');
  if (!tenantId) throw new Error('initializeTenant: tenantId が必要です');
  const tenantRef = db.collection('tenants').doc(tenantId);

  // 男女2チーム config（決定論 doc ID＝冪等）。
  await tenantRef.collection('teams').doc('boys').set(teamConfig('boys', '男子'));
  await tenantRef.collection('teams').doc('girls').set(teamConfig('girls', '女子'));
  // team-input/latest（合成 KPI）。
  await tenantRef.collection('teams').doc('boys').collection('input').doc('latest').set(teamInput('boys', BOYS_INDICATORS));
  await tenantRef.collection('teams').doc('girls').collection('input').doc('latest').set(teamInput('girls', GIRLS_INDICATORS));
  // 年間計画（汎用シーズン）。
  await tenantRef.collection('annualPlan').doc('current').set(annualPlanTemplate());

  // 叩き台が揃ったら準備完了フラグを立てる（描画は initialized:false なら「準備中」を出す）。
  await tenantRef.set({ initialized: true, initializedAt: FieldValue.serverTimestamp() }, { merge: true });
}
