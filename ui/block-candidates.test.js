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
 *   - ファンダ枠＝ハンドリング/パス/フットワークの3基礎だけ。得点動作（シュート/フィニッシュ/
 *     マイカン）はファンダ枠に出ない（ファンダ＝3基礎だけ・得点動作は全てシュート枠の方針）。
 *   - シュート枠に得点動作が集約される＝マイカン等のフィニッシュ系がシュート枠に在る。
 *   - 対人枠（1on1/チーム）に得点動作（マイカン等）が出ない。
 *   - 新ドリル「ラテラル・シャッフル＆フロアタッチ」がファンダ枠（フットワーク）の候補に在る。
 *
 * blockOf（枠判定の唯一の真実源）の振り分けを変えたら、候補の所属が変わってこのテストが落ちる。
 *
 * テスト基盤: node --test。データは build.mjs の localStorages（ローカルJSON固定）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildPlanData } from './plan-data.mjs';
import { localStorages } from './build.mjs';
import { normalizeDrills } from '../engine/src/normalize.js';

/** 編集画面の7枠（editor.mjs の BLOCK_KEYS と一致）。 */
const EDITOR_BLOCKS = ['アップ', 'ファンダ', 'シュート', '対人', 'ラン', '静的', 'ゲーム'];

/** 得点動作（リム付近のフィニッシュ含め全てシュート枠に集約済み。専用カテゴリは撤去）。 */
const SCORING_CATEGORIES = new Set(['シュート']);
/** ファンダ枠に許されるカテゴリ＝ハンドリング/パス/フットワークの3基礎だけ。 */
const FUNDA_CATEGORIES = new Set([
  'ハンドリング/ドリブル',
  'パス&スペーシング',
  'フットワーク/アジリティ/ピボット',
]);

/** ドリル名→カテゴリの索引を、エンジンと同じ正規化済み集合から作る（枠別候補の検証用）。 */
async function nameToCategory(storages) {
  const raw = await storages.storage.getDrills();
  const drills = normalizeDrills(raw);
  const m = new Map();
  for (const d of drills) m.set(d.name, d.category);
  return m;
}

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

test('ファンダ枠は3基礎（ハンドリング/パス/フットワーク）だけ＝得点動作（シュート/フィニッシュ/マイカン）が出ない', async () => {
  const storages = localStorages();
  const data = await buildPlanData(storages);
  const catOf = await nameToCategory(storages);
  const bc = data.blockCandidates;
  assert.ok(bc['ファンダ'].length > 0, 'ファンダ枠の候補が非空であるべき');
  for (const name of bc['ファンダ']) {
    const cat = catOf.get(name);
    assert.ok(FUNDA_CATEGORIES.has(cat), `ファンダ枠の候補「${name}」(${cat}) は3基礎カテゴリのいずれかであるべき`);
    assert.ok(!SCORING_CATEGORIES.has(cat), `ファンダ枠に得点動作「${name}」(${cat}) が出てはならない`);
    assert.ok(!/マイカン/.test(name), `ファンダ枠にマイカン系「${name}」が出てはならない`);
  }
});

test('シュート枠に得点動作が集約される＝マイカン等のフィニッシュ系がシュート枠に在る', async () => {
  const storages = localStorages();
  const data = await buildPlanData(storages);
  const catOf = await nameToCategory(storages);
  const bc = data.blockCandidates;
  assert.ok(bc['シュート'].length > 0, 'シュート枠の候補が非空であるべき');
  // シュート枠の候補は全て得点動作カテゴリ（シュート＋フィニッシュ）。
  for (const name of bc['シュート']) {
    const cat = catOf.get(name);
    assert.ok(SCORING_CATEGORIES.has(cat), `シュート枠の候補「${name}」(${cat}) は得点動作カテゴリであるべき`);
  }
  // マイカン系（得点動作の代表）がシュート枠に在る＝得点動作の集約が効いている。
  assert.ok(
    bc['シュート'].some((name) => /マイカン/.test(name)),
    'マイカン系ドリルがシュート枠の候補に在るべき（得点動作はシュート枠に集約）',
  );
});

test('対人枠（1on1/チーム）に得点動作（マイカン等）が出ない', async () => {
  const storages = localStorages();
  const data = await buildPlanData(storages);
  const catOf = await nameToCategory(storages);
  const bc = data.blockCandidates;
  for (const name of bc['対人']) {
    const cat = catOf.get(name);
    assert.ok(!SCORING_CATEGORIES.has(cat), `対人枠に得点動作「${name}」(${cat}) が出てはならない`);
    assert.ok(!/マイカン/.test(name), `対人枠にマイカン系「${name}」が出てはならない`);
  }
});

test('新ドリル「ラテラル・シャッフル＆フロアタッチ」がファンダ枠（フットワーク）の候補に在る', async () => {
  const data = await buildPlanData(localStorages());
  assert.ok(
    data.blockCandidates['ファンダ'].includes('ラテラル・シャッフル＆フロアタッチ'),
    'ラテラル・シャッフル＆フロアタッチ がファンダ枠の候補に在るべき',
  );
});
