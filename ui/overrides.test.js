/**
 * @file コーチ指定の上書き日（ui/plan-data.mjs applyOverrides）の業務意図テスト。
 *
 * 検証する業務意図:
 *   置換: 表示週（週起点＝月曜）の火の実日付に source:coach（team:女子）の上書きがあると、
 *         火がその手書き内容へ置き換わり source:'coach'・team:'女子'・単一性別1列
 *         （sharedKind:'authored'・rotation:null・parts:undefined）になり、ヘッダ用の
 *         dateLabel（"2026/06/23"）を持つ。
 *   不変: 上書き対象外の日（水木金土）は触らない（オブジェクト同一性 === で固定）。
 *   実日付一致: 上書きの date がこの週に属さない別週の日付なら、火を含むどの日も置換されない
 *         （別週の上書きがこの週へ漏れ込まない＝bleedしない）。
 *   フォールバック: overrides が空配列/未設定なら days をそのまま返す。
 *
 * 注: minutes 合算等の途中計算はアサートしない（実装の写経になるため）。固定するのは
 *     source/team/sharedKind/rotation/parts/dateLabel の状態と「対象外日の不変」「別週は当たらない」
 *     という業務意図のみ。
 *
 * テスト基盤: node --test（node 標準テストランナー）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyOverrides } from './plan-data.mjs';

// 表示週の起点（2026-06-22 月曜）。火=06/23・水=06/24・木=06/25・金=06/26・土=06/27。
const WEEK_START = '2026-06-22';

// ── ヘルパ: 合成 days（buildDays 相当の最小形） ──────────────────────────────────

/** 組違い日（火・金）相当の合成日。 */
function rotationDay(dayLabel) {
  return {
    day: dayLabel,
    dayLabel: `${dayLabel}曜`,
    court: '全面',
    coachPresent: true,
    sharedKind: 'rotation',
    rotation: { rows: [{ type: 'rotation' }] },
    parts: undefined,
    blocks: [{ block: '対人', label: '対人', from: '16:05', to: '16:25', minutes: 20, isBundle: false, items: [{ name: 'P1', minutes: 20, mode: 'practice', category: 'C', video: null, alternatives: [] }] }],
  };
}

/** コーチ不在日（水木）相当の合成日。 */
function independentDay(dayLabel) {
  return {
    day: dayLabel,
    dayLabel: `${dayLabel}曜`,
    court: '半面',
    coachPresent: false,
    sharedKind: 'independent',
    rotation: null,
    parts: undefined,
    blocks: [{ block: 'シュート', label: 'シュート', from: '16:05', to: '16:25', minutes: 20, isBundle: false, items: [{ name: 'S1', minutes: 20, mode: 'self', category: 'C', video: null, alternatives: [] }] }],
  };
}

/** 週テンプレ（火水木金土）の合成 days。 */
function makeWeek() {
  return [rotationDay('火'), independentDay('水'), independentDay('木'), rotationDay('金'), rotationDay('土')];
}

/** 火（女子・実日付）の上書き1件。既定は表示週の火 06/23。 */
function girlsTuesdayOverride(dateStr = '2026-06-23') {
  return {
    date: dateStr,
    weekday: '火',
    team: '女子',
    source: 'coach',
    title: 'シュートの日',
    note: '本数より形。全体で各10本。',
    court: '半面',
    blocks: [
      {
        block: 'シュート',
        label: 'シュート（正しい形を一から）',
        items: [
          { name: 'カールからゴール下', minutes: null, note: '形を見せてから全体で10本' },
          { name: 'レイアップ', minutes: null, note: '全体で10本イン' },
        ],
      },
    ],
  };
}

/** 火（男女2列・layout:two-col）の上書き1件。既定は表示週の火 06/23。 */
function twoColTuesdayOverride(dateStr = '2026-06-23') {
  return {
    date: dateStr,
    weekday: '火',
    source: 'coach',
    layout: 'two-col',
    title: 'アラウンドシュート',
    note: '男子は全面でゲーム、女子はアラウンドシュート。',
    rows: [
      {
        from: '16:00', to: '17:00', minutes: 60,
        both: { block: 'ラン', label: 'ラントレ', items: [{ name: '走り込み・アジリティ', note: '屋外' }] },
      },
      {
        from: '17:00', to: '17:25', minutes: 25,
        男子: { block: '対人', label: 'アップ', items: [{ name: 'アップ（ゲーム準備）' }] },
        女子: { block: 'シュート', label: 'アラウンドシュート', items: [{ name: 'カールからゴール下', note: '説明＋全体で10本' }] },
      },
    ],
  };
}

// ① 置換: 表示週の火の実日付に女子上書きがあると手書き内容へ置換される ──────────────────

test('① 置換: 週起点06/22の火(06/23)に女子の上書きがあると手書き内容へ置換される', () => {
  const week = makeWeek();
  const result = applyOverrides(week, [girlsTuesdayOverride('2026-06-23')], WEEK_START);

  const tue = result.find((d) => d.day === '火');
  assert.equal(tue.source, 'coach', '火が source:coach になる');
  assert.equal(tue.team, '女子', '火が単一性別（女子）を持つ');
  assert.equal(tue.sharedKind, 'authored', '単一性別なので 1列(authored)');
  assert.equal(tue.rotation, null, '組違いを出さない（rotation:null）');
  assert.equal(tue.parts, undefined, '2部構成を無効化（parts:undefined）');
  assert.equal(tue.dateLabel, '2026/06/23', 'ヘッダ表示用の実日付ラベルを持つ');
  assert.equal(tue.blocks[0].items[0].name, 'カールからゴール下', '手書きドリル名に置き換わる');
  assert.equal(tue.blocks[0].items[0].minutes, null, '手書き minutes(null) をそのまま温存');
  assert.equal(tue.blocks[0].items[0].note, '形を見せてから全体で10本', '手書き note を温存');
  assert.equal(tue.title, 'シュートの日', '手書き title を保持');
});

// ② 不変: 上書き対象外の日（水木金土）は元参照のまま（=== で同一） ──────────────────

test('② 不変: 上書き対象外の日（水木金土）は元の参照のまま（=== で同一）', () => {
  const week = makeWeek();
  const result = applyOverrides(week, [girlsTuesdayOverride('2026-06-23')], WEEK_START);

  for (const label of ['水', '木', '金', '土']) {
    const orig = week.find((d) => d.day === label);
    const out = result.find((d) => d.day === label);
    assert.equal(out, orig, `${label} は元オブジェクトと同一参照（触っていない）`);
    assert.equal(out.source, undefined, `${label} は source を持たない`);
  }
});

// ③ 別週の上書きはこの週には当たらない（bleedしない） ──────────────────────────────

test('③ 実日付一致: 別週の火(07/21)の上書きは週起点06/22の週には当たらない', () => {
  const week = makeWeek();
  // 上書きは 2026-07-21（別週の火）。表示週は 06/22起点 → どの日にも当たらない。
  const result = applyOverrides(week, [girlsTuesdayOverride('2026-07-21')], WEEK_START);

  const tue = result.find((d) => d.day === '火');
  assert.equal(tue, week.find((d) => d.day === '火'), '火は元オブジェクトと同一参照（置換されない）');
  assert.equal(tue.source, undefined, '火は source を持たない（別週の上書きは漏れ込まない）');
  assert.equal(tue.sharedKind, 'rotation', '火は rotation のまま');
  // 他の日も全て元参照のまま
  for (const label of ['水', '木', '金', '土']) {
    assert.equal(result.find((d) => d.day === label), week.find((d) => d.day === label), `${label} も不変`);
  }
});

// ⑤ 男女2列: layout:two-col の上書きは twoCol:true・rows（both/男女別）へ置換される ──────────

test('⑤ 男女2列: layout:two-col の上書きは twoCol:true で男女2列の rows へ置換される', () => {
  const week = makeWeek();
  const result = applyOverrides(week, [twoColTuesdayOverride('2026-06-23')], WEEK_START);

  const tue = result.find((d) => d.day === '火');
  assert.equal(tue.source, 'coach', '火が source:coach になる');
  assert.equal(tue.twoCol, true, '男女2列フラグ twoCol:true を持つ');
  assert.equal(tue.team, null, '男女両方が対象なので単一性別ではない（team:null）');
  assert.equal(tue.sharedKind, 'authored', 'authored（組違いローテは出さない）');
  assert.equal(tue.rotation, null, '組違いを出さない（rotation:null）');
  assert.equal(tue.parts, undefined, '2部構成を無効化（parts:undefined）');
  assert.equal(tue.dateLabel, '2026/06/23', 'ヘッダ表示用の実日付ラベルを持つ');
  assert.equal(tue.start, '16:00', 'start=最初のrow.from');
  assert.equal(tue.end, '17:25', 'end=最後のrow.to');
  assert.equal(tue.rows.length, 2, 'rows を2行持つ');
  assert.ok(tue.rows[0].both, '先頭行は男女共通（both）バンド');
  assert.equal(tue.rows[0].both.label, 'ラントレ', '共通バンドの見出しはラントレ');
  assert.equal(tue.rows[1].both, null, '2行目は男女別なので both は無い');
  assert.equal(tue.rows[1].boys.label, 'アップ', '男子セルの見出しはアップ');
  assert.equal(tue.rows[1].girls.label, 'アラウンドシュート', '女子セルの見出しはアラウンドシュート');
  assert.equal(tue.rows[1].girls.items[0].note, '説明＋全体で10本', '女子セル項目の手書き note を温存');
});

// ⑥ 旧スキーマ互換: layout 未指定（単一blocks）の上書きでも壊れず単一性別1列になる ──────────

test('⑥ 旧スキーマ互換: layout 未指定（単一blocks）でも twoCol:false で1列(authored)に置換される', () => {
  const week = makeWeek();
  const result = applyOverrides(week, [girlsTuesdayOverride('2026-06-23')], WEEK_START);

  const tue = result.find((d) => d.day === '火');
  assert.equal(tue.source, 'coach', '火が source:coach になる');
  assert.equal(tue.twoCol, false, '旧スキーマは男女2列ではない（twoCol:false）');
  assert.equal(tue.team, '女子', '旧スキーマは単一性別（女子）を保持');
  assert.equal(tue.sharedKind, 'authored', '単一性別なので1列(authored)');
  assert.ok(Array.isArray(tue.blocks) && tue.blocks.length > 0, '単一blocks経路を保持');
});

// ④ フォールバック: 上書きが空配列/未設定なら days をそのまま返す ──────────────────

test('④ フォールバック: overrides が空配列/未設定なら days をそのまま返す', () => {
  const week = makeWeek();
  assert.equal(applyOverrides(week, [], WEEK_START), week, '空配列なら同一参照を返す');
  assert.equal(applyOverrides(week, undefined, WEEK_START), week, '未設定(undefined)でも同一参照を返す');
  assert.equal(applyOverrides(week, [girlsTuesdayOverride()], undefined), week, '週起点未設定なら何も当てず同一参照を返す');
});

// ⑦ 男女オンリーモード: layout:two-col の上書きに onlyGender があれば表示日へそのまま伝わる ─────

/** 火（男女2列・女子のみオンリー）の上書き1件。 */
function onlyGenderTuesdayOverride(dateStr = '2026-06-23') {
  return {
    date: dateStr,
    weekday: '火',
    source: 'coach',
    layout: 'two-col',
    onlyGender: '女子',
    rows: [
      {
        from: '16:00', to: '17:00', minutes: 60,
        女子: { block: 'シュート', label: 'アラウンドシュート', items: [{ name: 'カールからゴール下' }] },
      },
    ],
  };
}

test('⑦ 男女オンリーモード: onlyGender:"女子" が表示日(pd.onlyGender)へそのまま伝わる', () => {
  const week = makeWeek();
  const result = applyOverrides(week, [onlyGenderTuesdayOverride('2026-06-23')], WEEK_START);

  const tue = result.find((d) => d.day === '火');
  assert.equal(tue.twoCol, true, '男女2列スキーマのまま（onlyGenderは行構造を変えない）');
  assert.equal(tue.onlyGender, '女子', 'オンリー対象の性別が表示日に伝わる');
});

test('⑦ 男女オンリーモード: onlyGender 未指定の従来上書きは pd.onlyGender が無い（既定=男女両方・非回帰）', () => {
  const week = makeWeek();
  const result = applyOverrides(week, [twoColTuesdayOverride('2026-06-23')], WEEK_START);

  const tue = result.find((d) => d.day === '火');
  assert.equal(tue.onlyGender, undefined, 'onlyGender未指定の日は従来どおり男女両方（キー自体を持たない）');
});
