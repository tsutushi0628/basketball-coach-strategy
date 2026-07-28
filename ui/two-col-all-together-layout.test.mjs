/** @file 男女共通だけの手書き日を、既存 onlyGender の1列HTML構造で出す業務意図テスト。 */
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

test('全行が男女共通の日は男女の列見出しを出さない', async () => {
  const article = await articleFor([{ from: '16:00', to: '16:20', both: cell('見出しなし') }]);
  assert.doesNotMatch(article, /class="spine-header/, '男子／女子の列見出しを出さない');
});

test('男女で異なる行が1行でもある日は従来の2列HTMLを維持する', async () => {
  const article = await articleFor([
    { from: '16:00', to: '16:20', both: cell('共通はミラーのまま') },
    { from: '16:20', to: '16:40', 男子: cell('男子ドリル'), 女子: cell('女子ドリル') },
  ]);

  assert.match(article, /class="spine-header"/, '男女列見出しを維持する');
  assert.match(article, /id="plan-top" class="spine"/, '親spineを1列モードにしない');
  assert.doesNotMatch(article, /tc2-only/, '行を部分的に1列化しない');
  assert.equal((article.match(/class="tc2-bn">共通はミラーのまま/g) || []).length, 2, '共通行も従来どおり左右ミラー');
  assert.match(article, /spine-row spine-rotation tc2-split/, '異なる内容の行は2列セルのまま');
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
  assert.doesNotMatch(article, /spine-only|tc2-only/, '組違い日を1列モードにしない');
});
