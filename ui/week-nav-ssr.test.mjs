/**
 * @file 週ナビ（前の週／次の週／年月で飛ぶ／今週へ戻る）と過去週描画のSSR出力の業務意図テスト。
 *
 * 正本: docs/specs/past-weeks-and-copy-source/service-design.md（2.〜4.章）、
 *       docs/findings/spec-20260905-past-weeks-and-copy-source-impl.md（2.3・3.3・4・5.3・11章）。
 *
 * 検証する業務意図（実装の途中値は写経しない）:
 *   - 週ナビ（.wknav）は日レベル・週レベルの両方に1つずつ描かれ、前の週／次の週／年月で飛ぶ／
 *     今週へ戻るの部品を持つ。年月の選択肢は jumpMonths と同じ数・順・data-week。
 *   - 日レベルのタブ総数は pastWeeks+weeks の合計。表示中（hidden でない）は weeks の4件だけで、
 *     初期の on は weeks[0]。週レベルも同型（週タブ列の一貫性＝2.3節「片方だけ動く状態を作らない」）。
 *   - .daywk の数も同じ合計になり、過去週グループは hidden かつ data-past を持つ。初期可視の .day は
 *     1つだけで weeks[0] の先頭日（単一可視日の不変条件は過去週追加後も保たれる）。
 *   - 過去週の空日（上書き無し）は「この日の記録はありません。」＋入力導線1つだけ（叩き台導線を出さない）。
 *     今週・未来週の空日は現行どおり2導線のまま（非回帰）。
 *   - 各 .daywk の月セルは自週のアーク月キーを持ち、先頭週は現行の goalKeys.monthArcKey と同値。
 *     今日と学校年度が異なる週は月セルを出さず .goalbar--week-only になる。
 *   - 週起点未設定テナントは過去移動の対象日を持てないので .wknav 自体を出さない。
 *   - clientScript・editorScript の文字列に窓制御関数とコピー元候補関数が注入されている
 *     （既存の配線テストと同じ様式＝関数定義の有無を文字列検証する）。
 *
 * 対応前の現状（本ファイル作成時点で実走確認済み）: render() は data.pastWeeks・weeks[].monthArcKey
 * を未実装のため参照できず、.wknav・data-past・noRecord 分岐・weekNav も未実装で描かれない。
 * 各テストは「該当マークアップが見つからない／件数が現行のまま」で失敗する。
 *
 * テスト基盤: node --test。データは build.mjs の localStorages（ローカルJSON固定＝実データ）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildPlanData } from './plan-data.mjs';
import { localStorages, LOCAL_FIXTURE_TODAY } from './build.mjs';
import { render } from './pattern-timeline.mjs';
import { clientScript } from './render-shared.mjs';
import { editorScript } from './editor.mjs';

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

/** 領域内の .wknav 断片（[data-today-week]〜次の .wknav か領域末尾）を1つ返す。 */
function wknavOf(region) {
  const start = region.indexOf('class="wknav"');
  assert.ok(start >= 0, '.wknav が存在するべき');
  const from = region.lastIndexOf('<div', start);
  const rest = region.slice(from);
  const nextIdx = rest.indexOf('<div class="wknav"', 1);
  return nextIdx >= 0 ? rest.slice(0, nextIdx) : rest;
}

/* ───────────────────────── .wknav の構造（日・週レベル共通） ───────────────────────── */

test('.wknav が日レベル・週レベルにそれぞれ1つあり、前後移動・今週へ戻る・年月ジャンプを持つ', async () => {
  const data = await buildPlanData({ ...localStorages(), today: LOCAL_FIXTURE_TODAY });
  const { body } = render(data);

  const dayNav = wknavOf(dayRegionOf(body));
  const weekNav = wknavOf(weekRegionOf(body));
  for (const [label, nav] of [['日', dayNav], ['週', weekNav]]) {
    assert.match(nav, /class="wk-step wk-prev"/, `${label}レベル: 前の週ボタンがある`);
    assert.match(nav, /class="wk-step wk-next"[^>]*disabled/, `${label}レベル: 次の週は初期状態で押せない（今週+3週が上限）`);
    assert.match(nav, /class="wk-today"[^>]*data-shown="false"/, `${label}レベル: 今週へ戻るは初期非表示`);
    assert.match(nav, /class="[^"]*wk-jump-sel[^"]*"/, `${label}レベル: 年月で飛ぶセレクトがある`);
  }
});

test('年月で飛ぶの選択肢は jumpMonths と同じ数・順で、各 option が data-week を持つ', async () => {
  const data = await buildPlanData({ ...localStorages(), today: LOCAL_FIXTURE_TODAY });
  const { body } = render(data);
  const dayNav = wknavOf(dayRegionOf(body));
  const opts = [...dayNav.matchAll(/<option value="([^"]+)" data-week="([^"]+)">([^<]*)<\/option>/g)];
  assert.ok(opts.length > 0, '年月の選択肢が1件以上ある');
  assert.deepEqual(opts.map((o) => o[1]), data.jumpMonths.map((m) => m.ym), '順序と件数が jumpMonths と一致');
  assert.deepEqual(opts.map((o) => o[2]), data.jumpMonths.map((m) => m.weekKey), 'data-week が jumpMonths の weekKey と一致');
  assert.deepEqual(opts.map((o) => o[3]), data.jumpMonths.map((m) => m.label), 'ラベルも一致');
});

test('週起点未設定テナントは .wknav を出さない（過去移動の実日付が無いため）', async () => {
  const { storage, girlsStorage } = localStorages();
  const wrapped = {
    ...storage,
    async getConfig() {
      const c = await storage.getConfig();
      const { week_start_date, ...rest } = c;
      return rest;
    },
  };
  const data = await buildPlanData({ storage: wrapped, girlsStorage });
  const { body } = render(data);
  assert.ok(!body.includes('class="wknav"'), '週起点未設定では .wknav 自体を描かない（単一週フォールバックと同じ判定）');
});

/* ───────────────────────── 日レベル・週レベルのタブ総数と可視 ───────────────────────── */

test('日レベルのタブ総数は pastWeeks+weeks、hidden でないタブは weeks の4件、on は weeks[0]', async () => {
  const data = await buildPlanData({ ...localStorages(), today: LOCAL_FIXTURE_TODAY });
  const { body } = render(data);
  const region = dayRegionOf(body);
  const tags = [...region.matchAll(/<button class="pk cal-go-dayweek[^>]*>/g)].map((x) => x[0]);
  assert.equal(tags.length, data.pastWeeks.length + data.weeks.length, 'タブ総数＝過去週+表示週');
  const visible = tags.filter((t) => !/\shidden(?=[\s>])/.test(t));
  assert.equal(visible.length, data.weeks.length, '表示中（hidden でない）は4週ぶんだけ');
  assert.match(tags.find((t) => t.includes(' on')) || '', new RegExp(`data-dayweek="${data.weeks[0].key}"`), '初期 on は weeks[0]');
});

test('週レベルのタブ総数・可視・onも日レベルと同型', async () => {
  const data = await buildPlanData({ ...localStorages(), today: LOCAL_FIXTURE_TODAY });
  const { body } = render(data);
  const region = weekRegionOf(body);
  const tags = [...region.matchAll(/<button class="pk cal-go-week[^>]*>/g)].map((x) => x[0]);
  assert.equal(tags.length, data.pastWeeks.length + data.weeks.length);
  const visible = tags.filter((t) => !/\shidden(?=[\s>])/.test(t));
  assert.equal(visible.length, data.weeks.length);
});

/* ───────────────────────── .daywk の数・data-past・単一可視日 ───────────────────────── */

test('.daywk の数は pastWeeks+weeks、過去週グループは hidden かつ data-past を持つ', async () => {
  const data = await buildPlanData({ ...localStorages(), today: LOCAL_FIXTURE_TODAY });
  const { body } = render(data);
  const region = dayRegionOf(body);
  const groups = [...region.matchAll(/<div class="daywk"([^>]*)>/g)].map((x) => x[1]);
  assert.equal(groups.length, data.pastWeeks.length + data.weeks.length);
  const pastCount = groups.filter((attrs) => attrs.includes('data-past')).length;
  assert.equal(pastCount, data.pastWeeks.length, '過去週の数ぶん data-past が付く');
  for (const attrs of groups.filter((a) => a.includes('data-past'))) {
    assert.match(attrs, /\shidden(?=[\s"]|$)/, '過去週グループは hidden');
  }
});

test('初期可視の .day は全体で1つだけ・weeks[0] の先頭日', async () => {
  const data = await buildPlanData({ ...localStorages(), today: LOCAL_FIXTURE_TODAY });
  const { body } = render(data);
  const region = dayRegionOf(body);
  const articles = [...region.matchAll(/<article class="day pageb"[^>]*>/g)].map((x) => x[0]);
  const visible = articles.filter((tag) => !/\shidden(?=[\s>])/.test(tag));
  assert.equal(visible.length, 1, '過去週を足しても可視は常に1日');
  assert.match(visible[0], new RegExp(`data-date="${data.weeks[0].days[0].date}"`), '初期可視は weeks[0] の先頭日');
});

/* ───────────────────────── 過去週の空日＝記録なし・1導線 ───────────────────────── */

test('過去週の上書き無し日は「この日の記録はありません。」と入力導線1つだけ（叩き台導線を出さない）', async () => {
  const data = await buildPlanData({ ...localStorages(), today: LOCAL_FIXTURE_TODAY });
  const pastEmptyDay = data.pastWeeks.flatMap((w) => w.days).find((d) => d.source === 'empty' && d.noRecord);
  assert.ok(pastEmptyDay, '前提: 過去週に上書き無しの日がある');
  const { body } = render(data);
  const m = body.match(new RegExp(`<article class="day pageb"[^>]*data-date="${pastEmptyDay.date}"[^>]*>([\\s\\S]*?)</article>`));
  assert.ok(m, '対象日の article が存在する');
  assert.match(m[1], /この日の記録はありません。/, '過去週の空日文言');
  assert.match(m[1], /data-empty-act="blank"/, '入力導線がある');
  assert.doesNotMatch(m[1], /data-empty-act="seed"/, '叩き台導線を出さない');
});

test('今週・未来週の上書き無し日は現行どおり2導線のまま（非回帰）', async () => {
  const data = await buildPlanData({ ...localStorages(), today: LOCAL_FIXTURE_TODAY });
  const emptyDay = data.weeks.flatMap((w) => w.days).find((d) => d.source === 'empty');
  assert.ok(emptyDay, '前提: 表示週に上書き無しの日がある');
  const { body } = render(data);
  const m = body.match(new RegExp(`<article class="day pageb"[^>]*data-date="${emptyDay.date}"[^>]*>([\\s\\S]*?)</article>`));
  assert.ok(m);
  assert.match(m[1], /まだ入力がありません。この日の練習を入力してください。/, '現行の空状態文言のまま');
  assert.match(m[1], /data-empty-act="blank"/);
  assert.match(m[1], /data-empty-act="seed"/, '今週・未来週は叩き台導線を維持する');
});

/* ───────────────────────── 週ごとの月目標キー ───────────────────────── */

test('各 .daywk の月セルは自週の monthArcKey を持ち、先頭週は goalKeys.monthArcKey と同値', async () => {
  const data = await buildPlanData({ ...localStorages(), today: LOCAL_FIXTURE_TODAY });
  const { body } = render(data);
  const region = dayRegionOf(body);
  const groups = [...region.matchAll(/<div class="daywk"[^>]*data-week="([^"]*)"[^>]*>([\s\S]*?)(?=<div class="daywk"|$)/g)]
    .map((m) => ({ key: m[1], html: m[2] }));
  const w0 = groups.find((g) => g.key === data.weeks[0].key);
  assert.match(w0.html, new RegExp(`data-goal-scope="month" data-goal-key="${data.goalKeys.monthArcKey}"`), '先頭週の月キーは現行の goalKeys.monthArcKey');
});

test('今日と学校年度が異なる過去週は月セルを出さず .goalbar--week-only になる（today=2026-04-13で3月の過去週を作る）', async () => {
  const data = await buildPlanData({ ...localStorages(), today: '2026-04-13' });
  const outOfYear = data.pastWeeks.find((w) => Number(w.weekStartDate.slice(5, 7)) <= 3);
  assert.ok(outOfYear, '前提: 3月の過去週が生成されている（4週下限が3月にまで届く）');
  const { body } = render(data);
  const region = dayRegionOf(body);
  const m = region.match(new RegExp(`<div class="daywk"[^>]*data-week="${outOfYear.key}"[^>]*>([\\s\\S]*?)(?=<div class="daywk"|$)`));
  assert.ok(m, '対象週の .daywk がある');
  assert.match(m[1], /class="goalbar goalbar--week-only"/, '年度外の週は週セルだけの目標バー');
  assert.doesNotMatch(m[1], /data-goal-scope="month"/, '月セルを出さない');
});

/* ───────────────────────── clientScript / editorScript の配線 ───────────────────────── */

test('clientScript: 窓制御（applyWindow・stepWeek・jumpToMonth・goToday）と週ナビ部品の配線が含まれる', () => {
  const js = clientScript();
  assert.match(js, /function applyWindow\(/, 'applyWindow が存在');
  assert.match(js, /function stepWeek\(/, 'stepWeek が存在');
  assert.match(js, /function jumpToMonth\(/, 'jumpToMonth が存在');
  assert.match(js, /function goToday\(/, 'goToday が存在');
  assert.match(js, /wk-prev/, '.wk-prev の配線がある');
  assert.match(js, /wk-next/, '.wk-next の配線がある');
  assert.match(js, /wk-today/, '.wk-today の配線がある');
  assert.match(js, /wk-jump-sel/, '.wk-jump-sel の配線がある');
});

test('editorScript: copySourceCandidates の定義が注入されている', () => {
  const js = editorScript();
  assert.match(js, /copySourceCandidates/, 'copySourceCandidates がクライアントJSへ埋め込まれている');
});
