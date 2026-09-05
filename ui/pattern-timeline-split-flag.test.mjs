/**
 * @file 行の明示フラグ split:true が pattern-timeline.mjs の配布用タイムライン描画（twoColTimeline）で
 * 2列表示（tc2-split）を維持する、という業務意図の退行テスト（不具合4）。
 *
 * 背景（(4-1) と対の描画側テスト）: isTogetherRow が split フラグを尊重するよう直っても、その値が
 * override 保存→plan-data.mjs の変換（toTwoColDay）→pattern-timeline.mjs の描画まで途切れず届かなければ
 * 画面には反映されない。本テストは「render() を通した実描画結果」で split:true が2列のまま出ることを
 * 固定する（probe-e.mjs の render 経由の方式を流用）。
 *
 * 対応前の現状（本ファイル作成時点で実走確認済み）: plan-data.mjs の toTwoColDay（ui/plan-data.mjs:629-644）
 * が row.split をコピーしないため、3行目（男女同一内容・split:true）は split フラグが失われた状態で
 * pattern-timeline.mjs に渡り、isTogetherRow が内容一致だけで true と判定 → 1本（tc2-together）に畳まれて
 * 失敗する。
 *
 * テスト基盤: node --test。データは build.mjs の localStorages を土台に、getOverrides だけを
 * 差し替えて実描画経路（buildPlanData→render）に通す。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlanData } from './plan-data.mjs';
import { localStorages, LOCAL_FIXTURE_TODAY } from './build.mjs';
import { render } from './pattern-timeline.mjs';

const DATE = '2026-06-23';
const cell = (name) => ({ block: 'ファンダ', label: name + '見出し', items: [{ name }] });

function override(rows) {
  return { date: DATE, weekday: '火', source: 'coach', layout: 'two-col', court: '全面', title: 'split flag probe', aim: '', rows };
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

test('rows=[split(別内容), both, split(男女同一内容・split:true)] → 3行目も2列(tc2-split)のまま、区間見出し(tc2-runhead)は2回出る', async () => {
  const rows = [
    { from: '16:00', to: '16:20', minutes: 20, 男子: cell('男A'), 女子: cell('女A') }, // 1行目: split（別内容）
    { from: '16:20', to: '16:40', minutes: 20, both: cell('共通B') }, // 2行目: both
    { from: '16:40', to: '17:00', minutes: 20, split: true, 男子: cell('同C'), 女子: cell('同C') }, // 3行目: split明示・男女同一内容
  ];
  const article = await articleFor(rows);

  // 原因行由来の失敗確認ポイント: plan-data.mjs:629-644 toTwoColDay が row.split を転写しないため、
  // 3行目は isTogetherRow=true と判定され tc2-together（1本）になってしまう。
  assert.equal((article.match(/spine-row spine-rotation tc2-only tc2-split/g) || []).length, 2,
    '1行目・3行目の両方が2列(tc2-split)のまま出る（split:true は男女同一内容でも畳ませない）');
  assert.equal((article.match(/tc2-runhead/g) || []).length, 2,
    '区間見出しは「1行目の区間」と「3行目の区間」で別々に2回出る（2行目のboth行で区間が切れるため）');
  assert.equal((article.match(/tc2-bn">共通B/g) || []).length, 1, '2行目(both)は全幅1本のまま');
});
