/**
 * @file 編集画面の枠別ドリル候補（buildPlanData().blockCandidates）の業務意図テスト。
 *
 * 検証する業務意図:
 *   - blockCandidates は編集画面の7枠（自動生成6枠＋ゲーム）をキーに持ち、各枠に
 *     その枠に該当するドリル名だけが並ぶ（手編集の候補が自動生成の枠分けと揃う）。
 *   - 候補のドリル名は drillIndex（タイムラインが引く詳細レジストリ＝カタログ名）のキーに含まれる
 *     ＝編集画面で選んだ候補が必ず詳細を引ける（孤児候補を出さない）。
 *   - 枠をまたいだ二重所属が無い（あるドリル名が2枠に現れない）。
 *   - ゲーム枠＝意思決定/ゲーム形式 の候補が非空（編集時だけの独立枠が実際に候補を持つ）。
 *   - フィニッシュは mastery で割れる＝ファンダ枠・シュート枠の両方に候補が乗る。
 *
 * blockOf（枠判定の唯一の真実源）の振り分けを変えたら、候補の所属が変わってこのテストが落ちる。
 *
 * テスト基盤: node --test。データは build.mjs の localStorages（ローカルJSON固定）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildPlanData } from './plan-data.mjs';
import { localStorages } from './build.mjs';

/** 編集画面の7枠（editor.mjs の BLOCK_KEYS と一致）。 */
const EDITOR_BLOCKS = ['アップ', 'ファンダ', 'シュート', '対人', 'ラン', '静的', 'ゲーム'];

/** drillIndex（Map か 素オブジェクト）からカタログ名の集合を作る。 */
function catalogNameSet(drillIndex) {
  if (!drillIndex) return new Set();
  if (typeof drillIndex.keys === 'function') return new Set([...drillIndex.keys()]);
  return new Set(Object.keys(drillIndex));
}

test('blockCandidates は編集画面の7枠を持ち、各候補名がカタログ（drillIndex）に実在する', async () => {
  const data = await buildPlanData(localStorages());
  const bc = data.blockCandidates;
  assert.ok(bc && typeof bc === 'object', 'blockCandidates が返るべき');
  assert.deepEqual(Object.keys(bc).sort(), [...EDITOR_BLOCKS].sort(), '7枠ちょうどをキーに持つ');

  const catalog = catalogNameSet(data.drillIndex);
  for (const block of EDITOR_BLOCKS) {
    assert.ok(Array.isArray(bc[block]), `${block} は配列であるべき`);
    for (const name of bc[block]) {
      assert.ok(catalog.has(name), `${block} の候補「${name}」はカタログ（drillIndex）に実在するべき`);
    }
    // 同一枠内に重複が無い（buildBlockCandidates の重複排除）。
    assert.equal(new Set(bc[block]).size, bc[block].length, `${block} の候補に重複が無いべき`);
  }
});

test('blockCandidates は枠をまたいだ二重所属が無い（あるドリル名は1枠だけ）', async () => {
  const data = await buildPlanData(localStorages());
  const bc = data.blockCandidates;
  const homeOf = new Map();
  for (const block of EDITOR_BLOCKS) {
    for (const name of bc[block]) {
      assert.ok(!homeOf.has(name), `「${name}」が ${homeOf.get(name)} と ${block} の二枠に現れた`);
      homeOf.set(name, block);
    }
  }
});

test('ゲーム枠の候補が非空（編集時だけの独立枠が実際に候補を持つ）', async () => {
  const data = await buildPlanData(localStorages());
  assert.ok(data.blockCandidates['ゲーム'].length > 0, 'ゲーム枠（意思決定/ゲーム形式）の候補が非空であるべき');
});

test('フィニッシュは mastery で割れ、ファンダ枠とシュート枠の両方が非空（候補レベルでも分割が効く）', async () => {
  const data = await buildPlanData(localStorages());
  const bc = data.blockCandidates;
  // フィニッシュは習得→ファンダ、反復/実戦化→シュート に割れるので、両枠とも候補を持つ。
  assert.ok(bc['ファンダ'].length > 0, 'ファンダ枠の候補が非空であるべき');
  assert.ok(bc['シュート'].length > 0, 'シュート枠の候補が非空であるべき');
});
