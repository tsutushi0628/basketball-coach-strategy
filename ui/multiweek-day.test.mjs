/**
 * @file 編集できる「日」画面の多週化（pattern-timeline.render / render-shared.clientScript）の業務意図テスト。
 *
 * 検証する業務意図（fix: 今日が日曜＝週起点が今週のとき、翌週火曜のメニューを打ち込む導線が無い）:
 *   - 日レベルが先頭週7日ぶんでなく data.weeks 全週ぶんに広がる（翌週の編集可能 .day が存在）。
 *   - 日レベルの .daywk 週グループ数＝data.weeks.length（各週が独立した日グループを持つ）。
 *   - cal-go の各曜日ボタンが実ISO(data-date)を持つ（別週の同曜日と衝突せず日付で一意に指せる）。
 *   - 単一可視日の不変条件: markup 上で可視（hidden でない）な .day は全週通して常に1つだけ。
 *     curDay（editor.mjs）＝「hidden でない最初の .day」が別週の日を誤編集しないための前提。
 *   - 週グリッドの曜日ヘッダ: 実日付のある日は button[data-jumpdate=実ISO]、空日はクリック不可。
 *   - クライアント制御: 日付起点の単一制御（showDayByDate）・週グリッド遷移（jumpToDate/data-jumpdate）・
 *     日レベル週セレクタ（cal-go-dayweek）・コピーが表示中の実ISOの .plain を拾う、が配線されている。
 *
 * 実装の途中値は写経しない。固定するのは「翌週日が編集可能に出る」「週グループ数＝週数」「可視は1日」
 * 「週グリッド日がジャンプ要素」「曜日でなく日付で切り替わる配線がある」という振る舞いのみ。
 *
 * テスト基盤: node --test。データは build.mjs の localStorages（ローカルJSON固定＝実データ）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildPlanData } from './plan-data.mjs';
import { localStorages } from './build.mjs';
import { render } from './pattern-timeline.mjs';
import { clientScript } from './render-shared.mjs';

/** body から data-level="day" 区画（次の data-level まで）を切り出す。 */
function dayRegionOf(body) {
  const start = body.indexOf('data-level="day"');
  const end = body.indexOf('data-level="week"');
  assert.ok(start >= 0 && end > start, 'day レベル区画が存在するべき');
  return body.slice(start, end);
}

/** body から data-level="week" 区画（次の data-level まで）を切り出す。 */
function weekRegionOf(body) {
  const start = body.indexOf('data-level="week"');
  const end = body.indexOf('data-level="month"');
  assert.ok(start >= 0 && end > start, 'week レベル区画が存在するべき');
  return body.slice(start, end);
}

/** day 区画を .daywk[data-week] グループに分解し、{key, html} の配列で返す。 */
function dayWeekGroupsOf(region) {
  const re = /<div class="daywk" data-week="([^"]*)"[^>]*>([\s\S]*?)(?=<div class="daywk"|$)/g;
  const groups = [];
  let m;
  while ((m = re.exec(region))) groups.push({ key: m[1], html: m[2] });
  return groups;
}

/** グループHTMLから「週の目標」の編集キー（data-goal-scope="week" の data-goal-key）を拾う。 */
function weekGoalKeyOf(groupHtml) {
  const m = groupHtml.match(/data-goal-scope="week" data-goal-key="([^"]*)"/);
  return m ? m[1] : null;
}

/** グループHTMLから「週の目標」バーの表示テキスト（gb-val）を拾う。 */
function weekGoalTextOf(groupHtml) {
  const m = groupHtml.match(/<span class="gb-lab">週の目標<\/span><span class="gb-val">([^<]*)<\/span>/);
  return m ? m[1] : null;
}

/** 区画内の編集可能な日ノード（.day[data-date]）の実ISO一覧。 */
function dayDatesIn(region) {
  return [...region.matchAll(/class="day pageb"[^>]*data-date="([^"]*)"/g)].map((x) => x[1]);
}

test('日レベルが全週ぶんに広がり、翌週（先頭週の次週）の編集可能 .day[data-date] が存在する', async () => {
  const data = await buildPlanData(localStorages());
  assert.ok(data.weeks.length >= 2, '前提: 複数週が生成されている');

  const { body } = render(data);
  const dates = dayDatesIn(dayRegionOf(body));

  // 翌週（weeks[1]）の各実日付が、日レベルの編集可能ノードとして全て出ている。
  for (const d of data.weeks[1].days) {
    if (!d.date) continue;
    assert.ok(dates.includes(d.date), `翌週の日 ${d.date} が編集可能 .day として日レベルに存在するべき`);
  }
  // 先頭週だけ（=従来の漏れ）ではない: 全週ぶんの日付が出る。
  const expected = data.weeks.flatMap((w) => w.days.map((d) => d.date).filter(Boolean));
  for (const iso of expected) {
    assert.ok(dates.includes(iso), `全週の日 ${iso} が日レベルに出るべき`);
  }
});

test('日レベルの .daywk 週グループ数が data.weeks.length と一致する', async () => {
  const data = await buildPlanData(localStorages());
  const { body } = render(data);
  const region = dayRegionOf(body);
  const groups = [...region.matchAll(/class="daywk" data-week="([^"]*)"/g)].map((x) => x[1]);
  assert.equal(groups.length, data.weeks.length, '日グループ数＝週数');
  // 各グループのキーは対応する週のキー（週セレクタ・showDayByDate の同期キー）。
  assert.deepEqual(groups, data.weeks.map((w) => w.key), '各 .daywk のキーは週キーと一致');
});

test('cal-go の各日ボタンが実ISO(data-date)を持つ（別週の同曜日と衝突しない）', async () => {
  const data = await buildPlanData(localStorages());
  const { body } = render(data);
  const region = dayRegionOf(body);
  const calgoDates = [...region.matchAll(/class="pk cal-go[^"]*"[^>]*data-date="([^"]*)"/g)].map((x) => x[1]);
  const nonEmpty = calgoDates.filter(Boolean);
  // 全週の練習日ぶん、実ISO付きの cal-go ボタンがある。
  const allDayDates = data.weeks.flatMap((w) => w.days.map((d) => d.date).filter(Boolean));
  for (const iso of allDayDates) {
    assert.ok(nonEmpty.includes(iso), `cal-go ボタンに実ISO ${iso} が付くべき`);
  }
  // 翌週の同曜日（例: 先頭週と翌週で曜日が重なる）でも、別ISOとして区別できる。
  assert.ok(new Set(nonEmpty).size === nonEmpty.length, 'cal-go の data-date は週をまたいで一意（重複なし）');
});

test('単一可視日の不変条件: markup 上で hidden でない .day は全週通して常に1つだけ', async () => {
  const data = await buildPlanData(localStorages());
  const { body } = render(data);
  const region = dayRegionOf(body);
  const articles = [...region.matchAll(/<article class="day pageb"[^>]*>/g)].map((x) => x[0]);
  assert.ok(articles.length > data.weeks[0].days.length, '複数週ぶんの日ノードがある');
  const visible = articles.filter((tag) => !/\shidden(?=[\s>])/.test(tag));
  assert.equal(visible.length, 1, '可視（hidden でない）日は常に1つだけ（curDay が別週を誤編集しない前提）');
});

test('週グリッドの曜日ヘッダ: 実日付のある日は button[data-jumpdate=実ISO]、空日はクリック不可', async () => {
  const data = await buildPlanData(localStorages());
  const { body } = render(data);
  const region = weekRegionOf(body);

  // クリック要素は button かつ data-jumpdate を持ち、値は実ISO。
  const jumps = [...region.matchAll(/<button[^>]*class="wg-dayhead wg-dayhead-go"[^>]*data-jumpdate="([^"]+)"/g)].map((x) => x[1]);
  assert.ok(jumps.length > 0, '週グリッドにジャンプ可能な曜日ヘッダがある');
  assert.ok(jumps.every((j) => /^\d{4}-\d{2}-\d{2}$/.test(j)), 'data-jumpdate は実ISO（YYYY-MM-DD）');

  // 先頭週の各実日付が週グリッドのジャンプ対象に出る（週ビューの各日→その日の入力へ）。
  for (const d of data.weeks[0].days) {
    if (!d.date) continue;
    assert.ok(jumps.includes(d.date), `週グリッドの ${d.date} がジャンプ対象（data-jumpdate）であるべき`);
  }
});

test('週グリッド: 実日付の無い日（空日）はジャンプ button にしない（クリック不可の div のまま）', async () => {
  const data = await buildPlanData(localStorages());
  // 先頭週の2日目の実日付を消して、空日が非クリック div になることを確認。
  const w0 = data.weeks[0];
  const daysCopy = w0.days.map((d, i) => (i === 1 ? { ...d, date: null, dateLabel: '' } : d));
  const data2 = { ...data, weeks: [{ ...w0, days: daysCopy }], days: daysCopy };

  const { body } = render(data2);
  const region = weekRegionOf(body);
  const jumps = [...region.matchAll(/data-jumpdate="([^"]+)"/g)].map((x) => x[1]);
  // 消した日の元ISOがジャンプ対象から外れる。
  assert.ok(!jumps.includes(w0.days[1].date), '空日にした曜日はジャンプ対象に出ない');
  // 空日は素の div（-go なし）として残る。
  assert.ok(region.includes('<div class="wg-dayhead"'), '空日は非クリックの div ヘッダで出る');
});

test('clientScript: 日付起点の単一制御・週グリッド遷移・日レベル週セレクタ・コピーが配線されている', () => {
  const js = clientScript();
  // 日付で切り替える単一制御（曜日名でなく実ISO起点）。
  assert.match(js, /function showDayByDate\(/, 'showDayByDate（日付起点の単一可視制御）が存在');
  assert.match(js, /\.day\[data-date="/, 'showDayByDate は .day[data-date] を起点に切り替える');
  // 週グリッド→その日の入力へ遷移（レベルを day に切替＋日付表示）。
  assert.match(js, /function jumpToDate\(/, 'jumpToDate（週グリッドからの遷移）が存在');
  assert.match(js, /\[data-jumpdate\]/, 'data-jumpdate クリックが配線されている');
  // 日レベルの週セレクタ（.daywk 切替の別系統ハンドル）。
  assert.match(js, /cal-go-dayweek/, '日レベル週セレクタ（cal-go-dayweek）が配線されている');
  assert.match(js, /data-dayweek/, '週セレクタは data-dayweek を読む');
  // cal-go は実ISO(data-date)を優先で読み、空なら曜日(data-go)へフォールバックする（二段化）。
  assert.match(js, /getAttribute\('data-date'\)/, 'cal-go クリックは data-date を読む');
  assert.match(js, /function showDayByDay\(/, '曜日フォールバック（週起点未設定で実ISO無し）が存在');
  // コピーは表示中の実ISO（__curDate）の .plain を拾う（多週で曜日名は衝突するため）。
  assert.match(js, /__curDate/, 'コピーは表示中の実ISO（__curDate）を使う');
});

test('日レベルの週目標 data-goal-key が data.weeks の各週起点ISOぶん存在する（週0固定でない）', async () => {
  const data = await buildPlanData(localStorages());
  assert.ok(data.weeks.length >= 2, '前提: 複数週が生成されている');
  // 前提: 各週は別々の週起点ISOを持つ（編集キーが週ごとに異なる根拠）。
  const weekStarts = data.weeks.map((w) => w.weekStartDate).filter(Boolean);
  assert.equal(new Set(weekStarts).size, weekStarts.length, '前提: 週起点ISOは週ごとに一意');

  const { body } = render(data);
  const region = dayRegionOf(body);

  // 日レベルに出る週scopeの編集キーが、全週の週起点ISOを過不足なく出す（週0だけに固定されていない）。
  const dayWeekGoalKeys = [...region.matchAll(/data-goal-scope="week" data-goal-key="([^"]*)"/g)].map((x) => x[1]);
  for (const ws of weekStarts) {
    assert.ok(dayWeekGoalKeys.includes(ws), `日レベルに週 ${ws} の週目標編集キーが出るべき`);
  }
  // 週0固定でない＝週起点ぶんの異なるキーが出ている（多週なら2件以上の distinct キー）。
  assert.ok(new Set(dayWeekGoalKeys).size >= weekStarts.length,
    '日レベルの週目標編集キーは週起点ぶん存在する（週0固定の退行を禁止）');
});

test('日レベルの各 .daywk グループの週目標バーが、その週の焦点(focus)と週起点ISOを指す', async () => {
  const data = await buildPlanData(localStorages());
  const { body } = render(data);
  const region = dayRegionOf(body);

  const groups = dayWeekGroupsOf(region);
  assert.equal(groups.length, data.weeks.length, '日グループ数＝週数（各週に1つ週目標バー）');

  // 各週グループの週目標バー: 編集キー＝その週の週起点ISO、表示テキスト＝その週の焦点。
  for (const grp of groups) {
    const w = data.weeks.find((x) => x.key === grp.key);
    assert.ok(w, `グループキー ${grp.key} に対応する週が data.weeks にある`);
    assert.equal(weekGoalKeyOf(grp.html), w.weekStartDate,
      `週 ${grp.key} の週目標編集キーは自週の週起点ISO（誤上書き防止＝他週キーを送らない）`);
    assert.equal(weekGoalTextOf(grp.html), w.focus,
      `週 ${grp.key} の週目標テキストは自週の焦点（未来週で週0の焦点を出さない）`);
  }
});

test('日レベルの月目標は全週グループで不変（同一アーク月内は月キーが追従しない＝月を週切替で誤上書きしない）', async () => {
  const data = await buildPlanData(localStorages());
  const { body } = render(data);
  const region = dayRegionOf(body);

  // 月scopeの編集キーは全グループで同一（アンカーarc月キー）。週切替で月キーが変わってはならない。
  const monthGoalKeys = [...region.matchAll(/data-goal-scope="month" data-goal-key="([^"]*)"/g)].map((x) => x[1]);
  assert.ok(monthGoalKeys.length >= data.weeks.length, '各週グループに月目標バーがある');
  assert.equal(new Set(monthGoalKeys).size, 1, '月目標キーは全週で不変（同一アーク月）');
  assert.equal(monthGoalKeys[0], String(data.goalKeys.monthArcKey), '月目標キーはアンカーarc月キー');
});
