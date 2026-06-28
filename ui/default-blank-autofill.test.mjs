/**
 * @file 既定空白＋オプトイン自動入力（製品中核の挙動変更）の業務意図テスト。
 *
 * オーナー方針（一次情報）: 「基本、日々の練習メニューは空白にしとけ。俺が入力してないのに何か
 * 出てるのが嫌だ。全部空白で、自動入力を指示したときだけ入れろ」。
 *
 * 検証する業務意図（実装の途中値は写経しない・振る舞いだけ固定）:
 *   ① 既定空白: コーチ上書きの無い日は source:'empty'（叩き台メニューを自動表示しない・blocks空）。
 *   ② 叩き台は隠し持ち: 各週 seedDays にエンジン叩き台（中身あり）が温存される（捨てない）。
 *   ③ コーチ上書きは出る: 上書きのある日はこれまでどおり source:'coach' で中身が出る。
 *   ④ 目標の既定空白: コーチ未入力の週/月の目標は空（表示用）。叩き台は seed* に温存。
 *   ⑤ オプトイン自動入力ソース: editor データ島に seedPrefill（叩き台の twoCol prefill）が日付キーで載る。
 *   ⑥ 空状態UI: 描画に空状態（まだ入力がありません）と2導線（入力する／自動で叩き台を入れる）が出る。
 *   ⑦ レンダラに叩き台ドリルが自動表示されない（既定で drill-trig が日レベルに出ない）。
 *
 * テスト基盤: node --test。データは build.mjs の localStorages（ローカルJSON固定＝実データ）。
 *   ローカル種データのコーチ上書きは 火(06/23)・水(06/24)・木(06/25)。金/土・翌週は未入力＝空状態。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPlanData,
  applyOverridesWithEmpty,
  applyGoalOverridesWithEmpty,
} from './plan-data.mjs';
import { localStorages } from './build.mjs';
import { editorDataIsland } from './editor.mjs';
import { render } from './pattern-timeline.mjs';

/** editor データ島の JSON を取り出す。 */
function islandJson(data) {
  const html = editorDataIsland(data);
  return JSON.parse(html.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, ''));
}

// ① 既定空白: コーチ上書きの無い日は空状態（叩き台を自動表示しない）─────────────────
test('① 既定空白: コーチ上書きの無い日は source:empty で叩き台メニューを出さない', async () => {
  const data = await buildPlanData(localStorages());
  const w0 = data.weeks[0];
  const fri = w0.days.find((d) => d.day === '金'); // 上書き無し
  assert.equal(fri.source, 'empty', '上書き無しの金は空状態日');
  assert.deepEqual(fri.blocks, [], '叩き台メニュー（blocks）を出さない');
  assert.equal(fri.rotation, null, '組違いローテも出さない');
  assert.equal(fri.parts, undefined, '2部構成も出さない');
  // 翌週は丸ごと未入力＝全日が空状態。
  for (const d of data.weeks[1].days) {
    assert.equal(d.source, 'empty', `翌週の${d.day}は空状態（既定空白）`);
  }
});

// ② 叩き台は隠し持ち（捨てない）─────────────────────────────────────────────────
test('② 叩き台は隠し持ち: 各週 seedDays にエンジン叩き台（中身あり）が温存される', async () => {
  const data = await buildPlanData(localStorages());
  for (const w of data.weeks) {
    assert.ok(Array.isArray(w.seedDays) && w.seedDays.length > 0, `週${w.key}に seedDays がある`);
  }
  // 空状態で出していない金の叩き台は seedDays 側に中身（blocks）を持つ＝自動入力で呼べる。
  const seedFri = data.weeks[0].seedDays.find((d) => d.day === '金');
  assert.ok(seedFri && seedFri.blocks.length > 0, '叩き台（seed）の金は中身を持つ（捨てていない）');
});

// ③ コーチ上書きはこれまでどおり出る ───────────────────────────────────────────
test('③ コーチ上書き日はこれまでどおり source:coach で中身が出る', async () => {
  const data = await buildPlanData(localStorages());
  const tue = data.weeks[0].days.find((d) => d.day === '火'); // 06/23 上書きあり
  assert.equal(tue.source, 'coach', '上書きのある火はコーチ日');
  assert.equal(tue.twoCol, true, '男女2列の上書き日として出る');
  assert.ok(tue.rows && tue.rows.length > 0, '手書きの行が出る');
});

// ④ 目標の既定空白（叩き台は seed に温存）────────────────────────────────────────
test('④ 目標の既定空白: コーチ未入力の週/月目標は空・叩き台は seed* に温存', async () => {
  const data = await buildPlanData(localStorages());
  assert.equal(data.weeks[0].focus, '', '週の焦点はコーチ未入力なら空（叩き台を出さない）');
  assert.ok(data.weeks[0].seedFocus, '週の焦点の叩き台は seedFocus に温存');
  assert.equal(data.months[0].month.headline, '', '月の見出しはコーチ未入力なら空');
  assert.ok(data.months[0].month.seedHeadline, '月見出しの叩き台は seedHeadline に温存');
});

test('④b applyGoalOverridesWithEmpty: コーチ上書きのある目標だけ表示し、無い目標は空にする', () => {
  const parts = {
    weeks: [
      { weekStartDate: '2026-06-22', focus: 'エンジン既定W1', goals: { week: 'エンジン既定W1' } },
      { weekStartDate: '2026-06-29', focus: 'エンジン既定W2', goals: { week: 'エンジン既定W2' } },
    ],
    months: [{ arcMonth: 1, month: { arcMonth: 1, headline: 'エンジン既定M1' } }],
    year: { arc: [{ month: 1, headline: 'エンジン既定M1' }] },
    session: { goals: { week: 'エンジン既定W1', monthMain: 'エンジン既定M1' }, month: { arcMonth: 1, headline: 'エンジン既定M1' } },
  };
  // 週1だけコーチ上書きあり。週2・月は未入力。
  applyGoalOverridesWithEmpty(parts, { weeks: { '2026-06-22': 'コーチ週1' }, arcMonths: {} });
  assert.equal(parts.weeks[0].focus, 'コーチ週1', 'コーチ上書きのある週は表示される');
  assert.equal(parts.weeks[1].focus, '', '上書きの無い週は空（叩き台を出さない）');
  assert.equal(parts.weeks[1].seedFocus, 'エンジン既定W2', '叩き台は seedFocus に温存');
  assert.equal(parts.months[0].month.headline, '', '上書きの無い月は空');
  assert.equal(parts.months[0].month.seedHeadline, 'エンジン既定M1', '月の叩き台は seedHeadline に温存');
});

// ⑤ オプトイン自動入力ソース（editor データ島の seedPrefill）─────────────────────
test('⑤ オプトイン自動入力: editor データ島に叩き台 prefill が日付キーで載る', async () => {
  const data = await buildPlanData(localStorages());
  const island = islandJson(data);
  assert.ok(island.seedPrefill && typeof island.seedPrefill === 'object', 'seedPrefill がデータ島にある');
  // 空状態の金（06/26）の叩き台が prefill 形（rows に時間行・男女共通 both・ドリル名）で載る。
  const fri = island.seedPrefill['2026-06-26'];
  assert.ok(fri && Array.isArray(fri.rows) && fri.rows.length > 0, '金の叩き台 prefill が時間行を持つ');
  const hasName = fri.rows.some((r) => (r.both && (r.both.items || []).some((it) => it.name)));
  assert.ok(hasName, '叩き台 prefill にドリル名が入っている（自動入力で編集欄へ読める）');
});

// ⑥⑦ 空状態UIと「叩き台が自動表示されない」をレンダラ出力で固定 ──────────────────
test('⑥ 空状態UI: 未入力の日に空状態と2導線（入力する／自動で叩き台を入れる）が出る', async () => {
  const data = await buildPlanData(localStorages());
  const { body } = render(data);
  assert.match(body, /class="emptystate"/, '空状態ブロックが描かれる');
  assert.match(body, /まだ入力がありません/, '空状態の文言が出る');
  assert.match(body, /data-empty-act="blank"/, '「入力する」導線が出る');
  assert.match(body, /data-empty-act="seed"/, '「自動で叩き台を入れる」導線が出る');
});

test('⑦ 叩き台が自動表示されない: 空状態日には叩き台ドリル要素（drill-trig/spine）が出ない', async () => {
  const data = await buildPlanData(localStorages());
  const { body } = render(data);
  // 空状態日の article を1つ抜き出し、その中に叩き台ドリル描画が無いことを確認。
  const m = body.match(/<article class="day pageb"[^>]*data-date="2026-06-26"[^>]*>([\s\S]*?)<\/article>/);
  assert.ok(m, '金(06/26)の article が存在する');
  const friArticle = m[1];
  assert.doesNotMatch(friArticle, /class="drill-trig"/, '空状態日に叩き台ドリルのタップ要素が出ない');
  assert.doesNotMatch(friArticle, /class="spine"/, '空状態日に叩き台タイムラインが出ない');
  assert.match(friArticle, /class="emptystate"/, '代わりに空状態が出る');
});

// ⑨ 死んだボタン根治: 実日付の有無で空状態の2導線を出し分ける ───────────────────────
// 背景（一次情報）: 週起点未設定テナント＝全日 date:null。空状態の「入力する／自動で叩き台を入れる」は
// editor の openPanel に渡るが、openPanel は実日付(data-date)を保存APIの doc ID に使うため date 無しを弾く。
// よって date 無しの日に導線を出すと押しても無反応の死んだボタンになる。外部配布の主対象＝新規コーチ全員に当たる。
// 検証する業務意図: 実日付のある空状態日は導線が出て押せる／実日付の無い空状態日は導線を出さず文言だけにする。

/** localStorages の getConfig から week_start_date を外す（新規テナント＝全日 date:null）。 */
function noWeekStartStorages() {
  const { storage, girlsStorage } = localStorages();
  const wrapped = {
    ...storage,
    async getConfig() {
      const c = await storage.getConfig();
      const { week_start_date, ...rest } = c;
      return rest;
    },
  };
  return { storage: wrapped, girlsStorage };
}

/** body から1つの空状態 article（指定属性を含む）を取り出す。 */
function emptyArticleWith(body, attrFragment) {
  const re = new RegExp(`<article class="day pageb"[^>]*${attrFragment}[^>]*>([\\s\\S]*?)<\\/article>`);
  const m = body.match(re);
  return m ? m[1] : null;
}

test('⑨ 実日付のある空状態日: 2導線（入力する／自動で叩き台を入れる）が出て押せる', async () => {
  const data = await buildPlanData(localStorages()); // 週起点あり＝空状態日も実日付を持つ
  const { body } = render(data);
  // 金(06/26)は空状態かつ実日付あり。
  const friArticle = emptyArticleWith(body, 'data-date="2026-06-26"');
  assert.ok(friArticle, '金(06/26)の空状態 article が存在する');
  assert.match(friArticle, /class="emptystate"/, '空状態である');
  assert.match(friArticle, /data-empty-act="blank"/, '実日付ありなら「入力する」導線が出る');
  assert.match(friArticle, /data-empty-act="seed"/, '実日付ありなら「自動で叩き台を入れる」導線が出る');
});

test('⑨b 実日付の無い空状態日（週起点未設定）: 押せない導線を出さず文言だけにする', async () => {
  const data = await buildPlanData(noWeekStartStorages()); // 全日 date:null＝全日が空状態
  const { body } = render(data);
  // 全日 date:null なので空状態 article は data-date="" を持つ。少なくとも1つ存在する前提。
  const emptyArticle = emptyArticleWith(body, 'data-date=""');
  assert.ok(emptyArticle, '実日付の無い空状態 article が存在する（週起点未設定）');
  assert.match(emptyArticle, /class="emptystate"/, '空状態である');
  assert.match(emptyArticle, /まだ入力がありません/, '空状態の文言は出る');
  // 死んだボタンを出さない（openPanel が date 無しを弾くため）。
  assert.doesNotMatch(emptyArticle, /data-empty-act/, '実日付が無い日には空状態の導線を出さない（無反応ボタン根治）');
});

// ⑩ 月タブの目標パネル: コーチ未入力の今月/今週を「未入力」淡色で揃える（空欄にしない）──────
// 背景: goalsBar・monthSection はコーチ未入力時に「未入力」淡色で守るが、月タブの目標パネル（goalsSection）の
// 今月/今週は空欄になり「壊れて見える」。質行が || '—' で守られているのと同じ非対称を解消する。
test('⑩ 月タブの目標パネル: 未入力の今月/今週は「未入力」表示で空欄にしない', async () => {
  const data = await buildPlanData(localStorages()); // 種データの月/週目標はコーチ未入力＝空
  const { body } = render(data);
  // 月タブ（data-level="month"）区画を切り出し、目標パネル（.goals）に「未入力」淡色が出ることを確認。
  const start = body.indexOf('data-level="month"');
  assert.ok(start >= 0, '月レベル区画が存在する');
  const monthRegion = body.slice(start, body.indexOf('data-level="year"', start) >= 0 ? body.indexOf('data-level="year"', start) : undefined);
  const goalsM = monthRegion.match(/<section class="goals">([\s\S]*?)<\/section>/);
  assert.ok(goalsM, '月タブに目標パネル（.goals）が存在する');
  const goals = goalsM[1];
  // 今月・今週の行が「未入力」淡色（es-inline）で出る（空欄でない）。
  assert.match(goals, /<span class="lab">今月<\/span><span class="txt es-inline">未入力<\/span>/, '今月の未入力が淡色「未入力」で出る');
  assert.match(goals, /<span class="lab">今週<\/span><span class="txt es-inline">未入力<\/span>/, '今週の未入力が淡色「未入力」で出る');
});

// ⑧ applyOverridesWithEmpty 単体: 上書きのある日だけ手書き／他は空状態 ──────────────
test('⑧ applyOverridesWithEmpty: 上書き日は手書き化・非上書き日は空状態に倒す', () => {
  const WEEK_START = '2026-06-22'; // 火=06/23
  const days = [
    { day: '火', dayLabel: '火曜', court: '全面', coachPresent: true, isSaturday: false,
      blocks: [{ block: '対人', label: '対人', from: '16:05', to: '16:25', minutes: 20, isBundle: false, items: [{ name: 'P1', minutes: 20, mode: 'practice', category: 'C', video: null, alternatives: [] }] }],
      rotation: { rows: [] }, parts: undefined, sharedKind: 'rotation' },
    { day: '水', dayLabel: '水曜', court: '半面', coachPresent: false, isSaturday: false,
      blocks: [{ block: 'シュート', label: 'シュート', from: '16:05', to: '16:25', minutes: 20, isBundle: false, items: [{ name: 'S1', minutes: 20, mode: 'self', category: 'C', video: null, alternatives: [] }] }],
      rotation: null, parts: undefined, sharedKind: 'independent' },
  ];
  const ov = {
    date: '2026-06-23', weekday: '火', source: 'coach', layout: 'two-col',
    rows: [{ from: '16:00', to: '17:00', minutes: 60, both: { block: 'ラン', label: 'ラントレ', items: [{ name: '走り込み' }] } }],
  };
  const result = applyOverridesWithEmpty(days, [ov], WEEK_START);
  const tue = result.find((d) => d.day === '火');
  const wed = result.find((d) => d.day === '水');
  assert.equal(tue.source, 'coach', '上書きのある火は手書き化');
  assert.equal(tue.twoCol, true, '男女2列の上書き日');
  assert.equal(wed.source, 'empty', '上書きの無い水は空状態');
  assert.deepEqual(wed.blocks, [], '空状態日は叩き台 blocks を出さない');
  // 空状態でも日付・曜日・コートは温存（ピッカー・週グリッド・ヘッダの連続性）。
  assert.equal(wed.date, '2026-06-24', '空状態日も実日付を保つ');
  assert.equal(wed.court, '半面', '空状態日もコートを保つ');
});
