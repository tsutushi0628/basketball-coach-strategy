/** @file 手書き上書き日（男女2列）を「日ごとの全か無か」でなく行単位で1本化・分割する業務意図テスト。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlanData } from './plan-data.mjs';
import { localStorages, LOCAL_FIXTURE_TODAY } from './build.mjs';
import { render } from './pattern-timeline.mjs';

const DATE = '2026-06-23';
const cell = (name) => ({ block: 'ファンダ', label: '基礎', items: [{ name, note: '正確に' }] });

function authored(rows) {
  return { date: DATE, weekday: '火', source: 'coach', layout: 'two-col', court: '全館', title: '表示確認', aim: '読みやすく', rows };
}

async function articleFor(rows) {
  const local = localStorages();
  const storage = Object.create(local.storage);
  storage.getOverrides = async () => [authored(rows)];
  const data = await buildPlanData({ storage, girlsStorage: local.girlsStorage, today: LOCAL_FIXTURE_TODAY });
  const { body } = render(data);
  const match = body.match(new RegExp(`<article class="day pageb"[^>]*data-date="${DATE}"[^>]*>([\\s\\S]*?)</article>`));
  assert.ok(match, '上書き日のHTMLがある');
  return match[1];
}

test('全行が男女共通の日は内容を1回だけ、時刻を左端の1列構造で出す', async () => {
  const article = await articleFor([
    { from: '16:00', to: '16:20', both: cell('共通ドリルA') },
    { from: '16:20', to: '16:40', both: cell('共通ドリルB') },
  ]);

  assert.match(article, /id="plan-top" class="spine spine-only"/, '親spineは1列用の縦線位置になる');
  assert.equal((article.match(/class="tc2-bn">共通ドリルA/g) || []).length, 1, '共通内容を左右に複写しない');
  assert.doesNotMatch(article, /class="spine-band right/, '右ミラーバンドを出さない');
  assert.ok(article.indexOf('<div class="spine-clk">') < article.indexOf('<div class="spine-band left">'), '時刻が内容より先＝左端レール');
});

test('全行が男女共通の日は男子/女子の見出しを1つも出さない', async () => {
  const article = await articleFor([{ from: '16:00', to: '16:20', both: cell('見出しなし') }]);
  assert.doesNotMatch(article, /spine-header/, '男子／女子の見出しを出さない（区間見出しも含め0件）');
});

test('男女セルの内容が一致する行はbothが無くても1本にまとまる（重複複製しない）', async () => {
  const article = await articleFor([
    { from: '16:00', to: '16:20', 男子: cell('内容一致'), 女子: cell('内容一致') },
  ]);
  assert.match(article, /spine-row spine-together tc2-together tc2-only/, 'bothが無くても共通の全幅バンドになる');
  assert.equal((article.match(/class="tc2-bn">内容一致/g) || []).length, 1, '一致した内容を左右に複写しない');
  assert.doesNotMatch(article, /spine-header/, '全行一致なら見出しを出さない');
});

test('一部の行だけ男女で異なる日は、同一行は1本・相違行だけ2列に割れ、その区間にだけ見出しが出る', async () => {
  const article = await articleFor([
    { from: '16:00', to: '16:20', both: cell('共通はミラーでなく1本') },
    { from: '16:20', to: '16:40', 男子: cell('男子ドリル'), 女子: cell('女子ドリル') },
    { from: '16:40', to: '17:00', 男子: cell('締めくくり'), 女子: cell('締めくくり') },
  ]);

  // 見出し(spine-header)は区間見出し(tc2-runhead)として1回だけ出る。
  assert.equal((article.match(/spine-header tc2-only tc2-runhead/g) || []).length, 1, '相違区間の先頭にだけ見出しが1回出る');
  // 共通行は全幅1本・複製しない（class="tc2-bn"で視覚バンド側だけを見る。コピー用テキストの重複はカウントしない）。
  assert.equal((article.match(/class="tc2-bn">共通はミラーでなく1本/g) || []).length, 1, '共通行は左右に複製されない');
  assert.equal((article.match(/class="tc2-bn">締めくくり/g) || []).length, 1, '内容一致の相違扱いでない行も複製されない');
  // 相違行だけ2列（tc2-pair内の左右セル）。
  assert.match(article, /class="tc2-pair">[\s\S]*?男子ドリル[\s\S]*?女子ドリル/, '相違行は男子=左・女子=右の2列で読める');
  // 親spineは常に1列レール（時刻は常に左端）。
  assert.match(article, /id="plan-top" class="spine spine-only"/, '混在日でも親spineは左端レールの1列モード');
});

test('離れた区間ごとに男子/女子の見出しがそれぞれ1回ずつ出る', async () => {
  const article = await articleFor([
    { from: '16:00', to: '16:10', 男子: cell('相違A男'), 女子: cell('相違A女') },
    { from: '16:10', to: '16:20', both: cell('間の共通行') },
    { from: '16:20', to: '16:30', 男子: cell('相違B男'), 女子: cell('相違B女') },
  ]);
  assert.equal((article.match(/spine-header tc2-only tc2-runhead/g) || []).length, 2, '離れた相違区間ごとに見出しが1回ずつ出る');
});

test('全行が男女で異なる日は、従来どおり全区間が左右に割れる（時刻は左端固定）', async () => {
  const article = await articleFor([
    { from: '16:00', to: '16:20', 男子: cell('男子だけA'), 女子: cell('女子だけA') },
    { from: '16:20', to: '16:40', 男子: cell('男子だけB'), 女子: cell('女子だけB') },
  ]);
  // 見出しは区間先頭に1回だけ（全行が1つの相違区間として連続する）。
  assert.equal((article.match(/spine-header tc2-only tc2-runhead/g) || []).length, 1, '全行相違でも見出しは区間先頭に1回');
  assert.equal((article.match(/spine-row spine-rotation tc2-only tc2-split/g) || []).length, 2, '全行が2列セルのまま');
  assert.doesNotMatch(article, /spine-band right/, '中央固定の左右ミラーは出さない');
  // 時刻(spine-clk)が常に左端＝内容(tc2-pair)より先。
  const rowMatch = article.match(/<div class="spine-row spine-rotation tc2-only tc2-split">([\s\S]*?)<\/div>\s*<div class="spine-row/);
  assert.ok(rowMatch, '相違行の中身が取れる');
  const inner = rowMatch[1];
  assert.ok(inner.indexOf('spine-clk') < inner.indexOf('tc2-pair'), '時刻が内容より先＝時刻は常に左端');
});

test('組違い自動生成の日の3列表示は変えない', async () => {
  const local = localStorages();
  const storage = Object.create(local.storage);
  storage.getOverrides = async () => [];
  const data = await buildPlanData({ storage, girlsStorage: local.girlsStorage, today: LOCAL_FIXTURE_TODAY });
  // fixture の表示日は空上書きで置き換わるため、エンジン生成済みの組違い seed を配布HTMLに渡す。
  data.days = data.seedDays;
  data.weeks[0].days = data.seedDays;
  const rotationDay = data.days.find((day) => day.rotation?.rows?.some((row) => row.type === 'rotation'));
  assert.ok(rotationDay, '組違い自動生成の日がfixtureにある');
  const { body } = render(data);
  const match = body.match(new RegExp(`<article class="day pageb"[^>]*data-date="${rotationDay.date}"[^>]*>([\\s\\S]*?)</article>`));
  assert.ok(match, '組違い日のHTMLがある');
  const article = match[1];
  assert.match(article, /class="spine-header"/, '男子／女子の3列見出しを維持する');
  assert.match(article, /spine-row spine-rotation/, '男女で異なるドリルの3列行を維持する');
  assert.doesNotMatch(article, /spine-only|tc2-only/, '組違い日を1列モードにしない（エンジン自動生成は別データ系統）');
});
