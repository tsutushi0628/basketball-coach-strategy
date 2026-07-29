/** @file コーチ入力の男女重複行を、配布紙面では行単位で共通の全幅行として読むための表示テスト。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlanData } from './plan-data.mjs';
import { localStorages, LOCAL_FIXTURE_TODAY } from './build.mjs';
import { render } from './pattern-timeline.mjs';

const DATE = '2026-06-23';
const cell = (name = 'パス', note = '正確に') => ({ block: 'ファンダ', label: '基礎', items: [{ name, note }] });

function override(rows) {
  return { date: DATE, weekday: '火', source: 'coach', layout: 'two-col', court: '全面', title: '表示確認', aim: '読みやすく', rows };
}

async function articleFor(rows) {
  const local = localStorages();
  const storage = Object.create(local.storage);
  storage.getOverrides = async () => [override(rows)];
  const data = await buildPlanData({ storage, girlsStorage: local.girlsStorage, today: LOCAL_FIXTURE_TODAY });
  const { body } = render(data);
  const match = body.match(new RegExp(`<article class="day pageb"[^>]*data-date="${DATE}"[^>]*>([\\s\\S]*?)</article>`));
  assert.ok(match, '対象日の配布用タイムラインが描画される');
  return match[1];
}

test('左右が完全一致する行は全幅1本になる', async () => {
  const article = await articleFor([{ from: '16:00', to: '16:20', minutes: 20, 男子: cell(), 女子: cell() }]);
  assert.match(article, /spine-row spine-together tc2-together tc2-only/, '共通の全幅バンドとして配布紙面に出る');
  assert.doesNotMatch(article, /spine-row spine-rotation tc2-only tc2-split/, '左右2列セルを重複して出さない');
});

test('1項目でも違えば2列のまま', async () => {
  const article = await articleFor([{ from: '16:00', to: '16:20', minutes: 20, 男子: cell('パス'), 女子: cell('ドリブル') }]);
  assert.match(article, /spine-row spine-rotation tc2-only tc2-split/, '異なる練習内容は左右の列で読める');
});

test('片方しか予定が無い行は2列のまま', async () => {
  const article = await articleFor([{ from: '16:00', to: '16:20', minutes: 20, 男子: cell() }]);
  assert.match(article, /spine-row spine-rotation tc2-only tc2-split/, '予定のない側を含め従来の2列表示を保つ');
});

test('all matching rows use one-column bands, not mirror bands', async () => {
  const article = await articleFor([
    { from: '16:00', to: '16:20', minutes: 20, 男子: cell(), 女子: cell() },
    { from: '16:20', to: '16:40', minutes: 20, 男子: cell('シュート'), 女子: cell('シュート') },
  ]);
  assert.match(article, /id="plan-top" class="spine spine-only"/, 'day uses one-column layout');
  assert.match(article, /spine-row spine-together tc2-together tc2-only/, 'rows use one-column bands');
  assert.doesNotMatch(article, /spine-band right|spine-row spine-rotation tc2-only tc2-split/, 'neither mirror nor split bands appear');
  assert.doesNotMatch(article, /tc2-runhead/, '相違行が無い日は区間見出しも出ない');
});

test('一致行と相違行が混在する日は、一致行だけ1本にまとまり相違行だけ2列に割れる（重複表示しない）', async () => {
  const article = await articleFor([
    { from: '16:00', to: '16:20', minutes: 20, 男子: cell('一致'), 女子: cell('一致') },
    { from: '16:20', to: '16:40', minutes: 20, 男子: cell('男子だけ'), 女子: cell('女子だけ') },
  ]);
  // 一致行: 全幅1本・複製しない。
  assert.equal((article.match(/spine-row spine-together tc2-together tc2-only/g) || []).length, 1, '一致行は1本だけ');
  assert.equal((article.match(/tc2-bn">一致/g) || []).length, 1, '一致内容を左右に複製しない');
  // 相違行: 2列セルのまま。
  assert.match(article, /spine-row spine-rotation tc2-only tc2-split/, '相違行は2列セルのまま');
  // 区間見出しは相違行の区間にだけ1回出る。
  assert.equal((article.match(/tc2-runhead/g) || []).length, 1, '相違区間の先頭にだけ見出しが1回出る');
  // 親spineは常に左端レールの1列モード（時刻が常に左端）。
  assert.match(article, /id="plan-top" class="spine spine-only"/, '混在日でも親spineは1列モード');
});
