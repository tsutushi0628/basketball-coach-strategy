/**
 * @file split:true で保存した override を「保存API（サニタイズ）→再読込（描画）」の一気通貫に通しても
 * 男女2列（tc2-split）のまま、という業務意図の退行テスト（不具合4・(4-5)）。
 *
 * 背景: (4-1)〜(4-4) は isTogetherRow・pattern-timeline.mjs の描画・保存経路各点（buildOverride /
 * sanitizeOverride / dayToPrefill）・モデル操作の往復を個別に固定した。本テストはそれらを結線した
 * 「実際にコーチが保存して、次にページを開いたときの見え方」を通しで固定する（保存APIの出力
 * sanitizeOverride を getOverrides の戻り値として使い、plan-data.mjs の変換（toTwoColDay）→
 * pattern-timeline.mjs の描画まで一気に通す）。
 *
 * 対応前の現状（本ファイル作成時点で実走確認済み）: sanitizeOverride が split を落とし、
 * plan-data.mjs:629-644 toTwoColDay も split を転写しないため、男女同一内容の split 行が
 * 「再読込」相当の描画で1本（tc2-together）に畳まれてしまい失敗する。
 *
 * テスト基盤: node --test（ブラウザ不要・純粋な関数合成）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeOverride } from '../functions/index.mjs';
import { buildPlanData } from './plan-data.mjs';
import { localStorages, LOCAL_FIXTURE_TODAY } from './build.mjs';
import { render } from './pattern-timeline.mjs';

const DATE = '2026-06-23';
const cell = (name) => ({ block: 'ファンダ', label: name + '見出し', items: [{ name }] });

async function articleForSavedRows(rawRows) {
  // 保存API相当（サーバのホワイトリスト検証を通す）。
  const saved = sanitizeOverride({ date: DATE, weekday: '火', layout: 'two-col', rows: rawRows });
  // 再読込相当（保存済み override を getOverrides の戻り値として描画経路に通す）。
  const local = localStorages();
  const storage = Object.create(local.storage);
  storage.getOverrides = async () => [saved];
  const data = await buildPlanData({ storage, girlsStorage: local.girlsStorage, today: LOCAL_FIXTURE_TODAY });
  const { body } = render(data);
  const match = body.match(new RegExp(`<article class="day pageb"[^>]*data-date="${DATE}"[^>]*>([\\s\\S]*?)</article>`));
  assert.ok(match, '対象日の配布用タイムラインが描画される');
  return { article: match[1], saved };
}

test('split:true・男女同一内容の行を保存→再読込しても2列(tc2-split)のまま（1本に畳まれない）', async () => {
  const rawRows = [{ from: '16:00', to: '16:20', split: true, 男子: cell('同じ内容'), 女子: cell('同じ内容') }];
  const { article, saved } = await articleForSavedRows(rawRows);

  // 保存段階（サーバのホワイトリスト）で split が生き残っていることを前提として明示する。
  assert.equal(saved.rows[0].split, true, '前提: サーバ保存後の override にも split:true が残る');

  // 原因行由来の失敗確認ポイント: plan-data.mjs:629-644 toTwoColDay が row.split を転写しないため、
  // 描画段階で isTogetherRow が内容一致だけで true と判定し tc2-together（1本）になる。
  assert.match(article, /spine-row spine-rotation tc2-only tc2-split/, '保存→再読込を通しても2列(tc2-split)のまま出る');
  assert.doesNotMatch(article, /spine-row spine-together tc2-together tc2-only/, '男女同一内容でも1本(tc2-together)に畳まれない');
});

test('split フラグ無し（旧データ）・男女同一内容の行は、保存→再読込で従来どおり1本にまとまる（非回帰）', async () => {
  const rawRows = [{ from: '16:00', to: '16:20', 男子: cell('同じ内容'), 女子: cell('同じ内容') }];
  const { article } = await articleForSavedRows(rawRows);
  assert.match(article, /spine-row spine-together tc2-together tc2-only/, 'フラグ無し旧データは従来どおり1本にまとまる');
  assert.doesNotMatch(article, /spine-row spine-rotation tc2-only tc2-split/, '旧データの挙動は変えない（後方互換）');
});
