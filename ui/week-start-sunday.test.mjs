/**
 * @file 週始まり日曜統一（曜日ボタン・週タブ・週タブの範囲）の業務意図テスト。
 *
 * 背景（オーナー指摘・2026-08-02）: 曜日ボタンは日曜始まりの並びなのに日付計算が月曜起点のまま
 * だったため、「日 08/09／月 08/03／…／土 08/08」のように7日が連続しない週になっていた。週タブ
 * も月曜始まりのラベルのままだった。
 *
 * 週の保存キー（weekStartDate・goalOverrides.weeks の Firestore キー）は「その週（日曜始まり）に
 * 含まれる月曜のISO」で、日曜始まり週にも月曜はちょうど1つだけ含まれる（1対1対応）。そのため表示
 * だけ日曜始まりに直せば、既存の月曜キー保存データはそのまま引ける（移行スクリプトは不要）。
 *
 * 是正の経緯（PdM是正・2026-08-02）: 最初の実装は「今日を含む週」の判定（表示アンカーの起点＝
 * 週タブ一覧の先頭）自体を日曜始まりに変えたため、今日が日曜のとき週タブの先頭が今日の週まで
 * 進んでしまい、直す前は見えていた「1つ前の週」が一覧から消えた（範囲が狭まる退行）。
 * 起点（週タブ一覧の先頭＝表示アンカーの位置決め）と選択（今日の週をどれか強調表示するか）は
 * 別の関心事: 起点は直す前と同じ月〜日の暦週ベースの位置決め（plan-data.mjs の mondayOfISO、
 * 今日が日曜でも前の月曜へ戻り先頭を進めない）のまま据え置き、今日の週を選択中にする処理は
 * render-shared.mjs のクライアント側（日レベルで解決済みの実日付から週を逆引きして
 * .cal-go-week/.wkpanel を同期）に切り出した。
 *
 * 検証する業務意図（実装の途中計算は写経しない）:
 *   - 曜日ボタンの7日が連続した1本の週になる（日曜始まり）。
 *   - 週タブの各区切りが日曜になる。
 *   - 月をまたぐ週・年をまたぐ週でも7日が連続する。
 *   - 週タブの一覧の起点（先頭タブ）は、今日が週内のどの曜日でも同じ週に据え置かれる
 *     （今日が日曜でも起点を翌週へ進めない＝範囲を狭めない）。
 *   - 週タブの一覧は、今日を含む週だけでなくその前後の週も含む（範囲を狭めない）。
 *   - 既存の月曜キーで保存された週目標が、日曜始まりの週表示からそのまま引ける（データ移行不要の実証）。
 *
 * テスト基盤: node --test。データは build.mjs の localStorages（ローカルJSON固定＝実データ）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildPlanData, computeWeekPeriods } from './plan-data.mjs';
import { localStorages, LOCAL_FIXTURE_TODAY } from './build.mjs';
import { render } from './pattern-timeline.mjs';

const JP_DOW = ['日', '月', '火', '水', '木', '金', '土'];
const dow = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** localStorages の boys storage.getConfig を差し替え、週起点(week_start_date)を任意の月曜ISOに固定する。 */
function withWeekStart(mondayISO) {
  const { storage, girlsStorage } = localStorages();
  const wrapped = {
    ...storage,
    async getConfig() {
      const c = await storage.getConfig();
      return { ...c, week_start_date: mondayISO };
    },
  };
  return { storage: wrapped, girlsStorage };
}

/** localStorages の boys storage.getGoalOverrides を差し替え、週の目標上書きマップを注入する
 * （ローカルJSON経路は本来 getGoalOverrides が常に空マップ・Firestore専用機能のためテスト側で模す）。 */
function withGoalOverrides(weeksMap) {
  const { storage, girlsStorage } = localStorages();
  const wrapped = {
    ...storage,
    async getGoalOverrides() {
      return { weeks: weeksMap, arcMonths: {} };
    },
  };
  return { storage: wrapped, girlsStorage };
}

/** body から data-level="day" 区画（次の data-level まで）を切り出す。 */
function dayRegionOf(body) {
  const start = body.indexOf('data-level="day"');
  const end = body.indexOf('data-level="week"');
  assert.ok(start >= 0 && end > start, 'day レベル区画が存在するべき');
  return body.slice(start, end);
}

/** day 区画を .daywk-picker[data-week] グループに分解し、{key, html} の配列で返す（曜日ピッカー側）。 */
function dayPickerGroupsOf(region) {
  const re = /<div class="daywk-picker" data-week="([^"]*)"[^>]*>([\s\S]*?)(?=<div class="daywk-picker"|$)/g;
  const groups = [];
  let m;
  while ((m = re.exec(region))) groups.push({ key: m[1], html: m[2] });
  return groups;
}

test('曜日ボタンの7日が連続した1本の週になる（日曜始まり）', async () => {
  const data = await buildPlanData({ ...localStorages(), today: LOCAL_FIXTURE_TODAY });
  const { body } = render(data);
  const groups = dayPickerGroupsOf(dayRegionOf(body));
  assert.ok(groups.length > 0, '日ピッカーのグループが存在する');

  const dates = [...groups[0].html.matchAll(/class="pk cal-go[^"]*"[^>]*data-date="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(dates.length, 7, 'アンカー週の日ピッカーは7日ぶんのボタンを持つ');
  assert.equal(dow(dates[0]), 0, `先頭ボタン ${dates[0]} は日曜であるべき`);
  assert.equal(dow(dates[6]), 6, `末尾ボタン ${dates[6]} は土曜であるべき`);
  for (let i = 1; i < dates.length; i++) {
    assert.equal(addDays(dates[i - 1], 1), dates[i],
      `${dates[i - 1]}の翌日は${dates[i]}であるべき（7日が飛ばず連続した1本の週）`);
  }
});

test('週タブの各区切りが日曜になる', async () => {
  // 単体: computeWeekPeriods（週タブ生成の単一定義元）が生成する各週の表示開始日はすべて日曜。
  const weeks = computeWeekPeriods({ currentMonth: 7, weekOfMonth: 1, weekStartDate: '2026-06-22' });
  for (const w of weeks) {
    const iso = w.key.replace(/\//g, '-');
    assert.equal(dow(iso), 0, `週タブ ${w.key} の区切りは日曜であるべき`);
  }

  // 結合: 実際にレンダリングされた週タブのラベルでも同じことが成立する。
  const data = await buildPlanData({ ...localStorages(), today: LOCAL_FIXTURE_TODAY });
  assert.ok(data.weeks.length >= 2, '前提: 複数週が生成されている');
  const { body } = render(data);
  const start = body.indexOf('data-level="week"');
  const end = body.indexOf('data-level="month"');
  const weekRegion = body.slice(start, end);
  const labels = [...weekRegion.matchAll(/class="pk cal-go-week[^"]*"[^>]*>([\d/]+)〜/g)].map((m) => m[1]);
  assert.ok(labels.length >= 2, '週タブのラベルが複数出る');
  for (const label of labels) {
    assert.equal(dow(label.replace(/\//g, '-')), 0, `週タブ表示 ${label}〜 は日曜始まりであるべき`);
  }
});

test('月をまたぐ週・年をまたぐ週でも7日が連続する', async () => {
  const cases = [
    { mondayISO: '2026-08-31', desc: '月またぎ（2026年8月→9月）' },
    { mondayISO: '2026-12-28', desc: '年またぎ（2026年→2027年）' },
  ];
  for (const { mondayISO, desc } of cases) {
    const data = await buildPlanData({ ...withWeekStart(mondayISO), today: mondayISO });
    const days = data.weeks[0].days;
    assert.equal(days.length, 7, `${desc}: 週は7日ぶん`);
    const dates = days.map((d) => d.date);
    assert.ok(dates.every(Boolean), `${desc}: 全日に実日付がある`);
    assert.equal(dow(dates[0]), 0, `${desc}: 先頭日 ${dates[0]} は日曜であるべき`);
    for (let i = 1; i < dates.length; i++) {
      assert.equal(addDays(dates[i - 1], 1), dates[i], `${desc}: ${dates[i - 1]}の翌日は${dates[i]}であるべき`);
    }
  }
});

test('週タブ一覧の起点（先頭タブ）は、今日が週内のどの曜日でも同じ週に据え置かれる（範囲を狭めない）', async () => {
  // 2026-06-22(月)〜2026-06-28(日)の暦週。週内のどの曜日が「今日」でも、週タブ一覧の先頭（表示
  // アンカー）は同じ月〜日の暦週（保存キー2026-06-22）に据え置かれるべき——今日が日曜でも先頭を
  // 翌週へ進めない（前の週を一覧から失わない）。
  const wholeWeek = ['2026-06-22', '2026-06-23', '2026-06-27', '2026-06-28'];
  for (const today of wholeWeek) {
    const data = await buildPlanData({ ...localStorages(), today });
    assert.equal(data.weeks[0].weekStartDate, '2026-06-22',
      `今日=${today}（${JP_DOW[dow(today)]}）でも週タブ一覧の先頭は月〜日の暦週の起点2026-06-22に据え置かれるべき`);
  }
});

test('週タブの一覧は、今日を含む週だけでなくその前後の週も含む（範囲を狭めない）', async () => {
  const today = '2026-08-02'; // 日曜（オーナーが指摘した実際の状況と同じ）
  const data = await buildPlanData({ ...localStorages(), today });
  const weeks = data.weeks;
  assert.ok(weeks.length >= 3, '前提: 3週以上が一覧に並ぶ');

  // 今日を実際に含む週（表示は日曜始まりなので、その週の days に today の実日付が含まれるかで判定）。
  const containingIdx = weeks.findIndex((w) => w.days.some((d) => d.date === today));
  assert.ok(containingIdx >= 0, `今日(${today})を含む週が一覧のどこかに存在するべき`);
  assert.ok(containingIdx > 0,
    `今日を含む週(index=${containingIdx})の前に、少なくとも1つ前の週が一覧に出ているべき（範囲を狭めない）`);
  assert.ok(containingIdx < weeks.length - 1,
    `今日を含む週(index=${containingIdx})の後にも、少なくとも1つ先の週が一覧に出ているべき`);
});

test('既存の月曜キーで保存された週目標が、日曜始まりの週表示からそのまま引ける（データ移行不要の実証）', async () => {
  const existingGoalText = '①リム付近の成功率を上げよう ②外角シュートを含めた駆け引きを覚えよう';
  const data = await buildPlanData({
    ...withGoalOverrides({ '2026-06-22': existingGoalText }),
    today: LOCAL_FIXTURE_TODAY,
  });
  assert.equal(data.weeks[0].weekStartDate, '2026-06-22',
    '前提: 表示週の保存キーは従来どおり月曜2026-06-22（保存フォーマット不変）');
  assert.equal(data.weeks[0].key, '2026/06/21',
    '前提: 表示ラベルは日曜始まり（保存キーの月曜そのものではなく前日の日曜になる）');
  assert.equal(data.weeks[0].focus, existingGoalText,
    '週始まりを日曜表示に変えても、既存の月曜キー保存データがそのまま表示に引ける（移行不要）');
});
