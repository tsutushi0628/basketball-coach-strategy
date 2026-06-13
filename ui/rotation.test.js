/**
 * @file 組違いローテーション（ui/rotation.mjs）の業務意図テスト。
 *
 * 設計仕様 §2.4 に従い、逐次レイアウト版の不変条件を検証する。
 *
 * 検証する業務意図:
 *   時計: 全 rows.minutes 合計 == pd.totalMinutes（時間消失の回帰テスト）
 *   主自走: together 行が実尺を保持（practice 窓に溶けない）
 *   不変2: practice は rotation 行の coachSide 側にしか出ない
 *   不変3: 各 rotation 行で boys.name !== girls.name
 *   不変4: boys列 = girls列 被覆集合（スワップ保証）
 *   swap: coachSide が round ごと交互
 *   E2E: 火曜の実出力で start=16:05・end=17:45・合計100分・主自走 together
 *
 * テスト基盤: node --test（node 標準テストランナー）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRotation,
  findRotationViolations,
  coveredColumnNames,
} from './rotation.mjs';

// ── ヘルパ ──────────────────────────────────────────────────────────────────

/**
 * テスト用 presentation day を構築する。totalMinutes を合計から自動計算。
 * blocks: [{block, isBundle, items:[{name,mode,minutes?}]}]
 */
function pdWithBlocks(dayLabel, blocks) {
  const totalMinutes = blocks.reduce((s, b) => s + b.items.reduce((s2, it) => s2 + (it.minutes ?? 10), 0), 0);
  let cur = 16 * 60 + 5; // 16:05
  const builtBlocks = blocks.map((b) => {
    const bStart = cur;
    const items = b.items.map((it) => {
      const mins = it.minutes ?? 10;
      const item = { name: it.name, minutes: mins, category: 'C', mode: it.mode, video: null, alternatives: [] };
      cur += mins;
      return item;
    });
    return {
      block: b.block || '技術',
      label: b.label || b.block || '技術',
      isBundle: b.isBundle ?? false,
      from: hhmm(bStart),
      to: hhmm(cur),
      minutes: items.reduce((s, it) => s + it.minutes, 0),
      items,
    };
  });
  const hStart = 16 * 60 + 5;
  return {
    day: dayLabel,
    dayLabel: `${dayLabel}曜`,
    coachPresent: true,
    start: hhmm(hStart),
    end: hhmm(hStart + totalMinutes),
    totalMinutes,
    blocks: builtBlocks,
  };
}

/** 簡易テスト用: 単一技術ブロックの pd を作る。 */
function pdWith(dayLabel, items) {
  return pdWithBlocks(dayLabel, [
    { block: '技術', isBundle: false, items },
  ]);
}

function hhmm(min) {
  return `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

// ── 時計不変: 全 rows.minutes 合計 === pd.totalMinutes ──────────────────────

test('時計不変: rows.minutes 合計 === pd.totalMinutes（時間消失ゼロ）', () => {
  const pd = pdWithBlocks('火', [
    { block: 'WU', isBundle: true, items: [{ name: 'ウォームアップ', mode: 'self', minutes: 15 }] },
    { block: '技術', isBundle: false, items: [
      { name: 'P1', mode: 'practice', minutes: 20 },
      { name: 'S1', mode: 'self', minutes: 30 },
    ]},
    { block: 'CD', isBundle: true, items: [{ name: 'ダウン', mode: 'self', minutes: 5 }] },
  ]);
  const selfPool = [{ name: 'FillDrill', mode: 'self', minutes: 10, category: 'C', video: null, alternatives: [] }];
  const rot = buildRotation(pd, selfPool);
  const rowsTotal = rot.rows.reduce((s, r) => s + r.minutes, 0);
  assert.equal(rowsTotal, pd.totalMinutes, `rows合計(${rowsTotal}) !== pd.totalMinutes(${pd.totalMinutes})`);
});

// ── 時計不変: pd.totalMinutes と不一致なら throw ──────────────────────────────

test('時計不変: rows合計が窓と一致しないとき buildRotation が throw する', () => {
  // totalMinutes を意図的に実blockより大きくして不一致を作る
  const pd = pdWith('火', [
    { name: 'P1', mode: 'practice', minutes: 10 },
    { name: 'S1', mode: 'self', minutes: 10 },
  ]);
  // 実際のblocks合計は20分なので totalMinutes=30 にするとthrowするはず
  pd.totalMinutes = 30;
  const pool = [{ name: 'FillDrill', mode: 'self', minutes: 10, category: 'C', video: null, alternatives: [] }];
  assert.throws(
    () => buildRotation(pd, pool),
    /時間消失/,
    '時計不一致で throw する',
  );
});

// ── 主自走 together 実尺保持: 全 self ブロックは together 行で実尺占有 ──────────

test('主自走together: self専用ブロックは together 行として実尺占有される（practice窓に溶けない）', () => {
  const selfMinutes = 25;
  const pd = pdWithBlocks('火', [
    { block: '技術', isBundle: false, items: [{ name: 'ツーメン', mode: 'self', minutes: selfMinutes }] },
    { block: '対人', isBundle: false, items: [
      { name: 'P1', mode: 'practice', minutes: 20 },
    ]},
  ]);
  const pool = [{ name: 'FillDrill', mode: 'self', minutes: 10, category: 'C', video: null, alternatives: [] }];
  const rot = buildRotation(pd, pool);

  // 「ツーメン」は together 行に出てくるはず
  const togetherRow = rot.rows.find((r) => r.type === 'together' && r.drill.name === 'ツーメン');
  assert.ok(togetherRow, 'ツーメンが together 行に出る');
  assert.equal(togetherRow.minutes, selfMinutes, `together 行の minutes が実尺(${selfMinutes})と一致`);
});

// ── 不変2: practice は rotation 行の coachSide 側にしか出ない ──────────────────

test('不変2: rotation 行で practice が coachSide 以外に出ない', () => {
  const pd = pdWith('火', [
    { name: 'P1', mode: 'practice', minutes: 20 },
    { name: 'S1', mode: 'self', minutes: 20 },
    { name: 'P2', mode: 'practice', minutes: 20 },
    { name: 'S2', mode: 'self', minutes: 20 },
  ]);
  const rot = buildRotation(pd, []);
  const violations = findRotationViolations(rot.rows);
  assert.deepEqual(violations, [], '不変条件2違反はゼロ');

  for (const row of rot.rows.filter((r) => r.type === 'rotation')) {
    const coachCell = row.coachSide === '男子' ? row.boys : row.girls;
    const otherCell = row.coachSide === '男子' ? row.girls : row.boys;
    assert.equal(coachCell.mode, 'practice', `coachSide '${row.coachSide}' セルは practice`);
    assert.notEqual(otherCell.mode, 'practice', `非coachSide '${row.coachSide === '男子' ? '女子' : '男子'}' セルは self`);
  }
});

// ── 不変3: 各 rotation 行で boys.name !== girls.name ──────────────────────────

test('不変3: 各 rotation 行で boys.name !== girls.name', () => {
  const pd = pdWith('火', [
    { name: 'P1', mode: 'practice', minutes: 20 },
    { name: 'S1', mode: 'self', minutes: 20 },
    { name: 'P2', mode: 'practice', minutes: 20 },
    { name: 'S2', mode: 'self', minutes: 20 },
  ]);
  const rot = buildRotation(pd, []);
  const violations = findRotationViolations(rot.rows);
  assert.deepEqual(violations, [], '不変条件3違反はゼロ');

  for (const row of rot.rows.filter((r) => r.type === 'rotation')) {
    assert.notEqual(row.boys.name, row.girls.name, `row [${row.half}]: boys.name === girls.name`);
  }
});

// ── 不変4: boys列被覆 = girls列被覆（スワップで両列が同一カリキュラム）──────────

test('不変4: boys列の被覆集合 === girls列の被覆集合', () => {
  const pd = pdWith('火', [
    { name: 'P1', mode: 'practice', minutes: 20 },
    { name: 'S1', mode: 'self', minutes: 20 },
    { name: 'P2', mode: 'practice', minutes: 20 },
    { name: 'S2', mode: 'self', minutes: 20 },
  ]);
  const rot = buildRotation(pd, []);

  // rotation 行のみで比較（together は左右同一なのでいずれも含む）
  const boysCovered = new Set();
  const girlsCovered = new Set();
  for (const row of rot.rows) {
    if (row.type === 'rotation') {
      boysCovered.add(row.boys.name);
      girlsCovered.add(row.girls.name);
    }
  }
  assert.deepEqual([...boysCovered].sort(), [...girlsCovered].sort(), 'boys列とgirls列の rotation被覆集合が一致');
});

// ── swap: coachSide が round ごと交互 ──────────────────────────────────────────

test('swap: coachSide が rotation round ごとに男女交互', () => {
  // 逐次レイアウトではブロック単位でコーチ段を判断するので、複数ラウンドには複数ブロックが必要
  const pd = pdWithBlocks('火', [
    { block: '対人', isBundle: false, items: [
      { name: 'P1', mode: 'practice', minutes: 10 },
    ]},
    { block: '技術', isBundle: false, items: [
      { name: 'S1', mode: 'self', minutes: 10 },
    ]},
    { block: 'ゲーム', isBundle: false, items: [
      { name: 'P2', mode: 'practice', minutes: 10 },
    ]},
    { block: '補助', isBundle: false, items: [
      { name: 'S2', mode: 'self', minutes: 10 },
    ]},
    { block: '応用', isBundle: false, items: [
      { name: 'P3', mode: 'practice', minutes: 10 },
    ]},
    { block: '復習', isBundle: false, items: [
      { name: 'S3', mode: 'self', minutes: 10 },
    ]},
  ]);
  const rot = buildRotation(pd, []);

  const roundCoachSides = [];
  for (let i = 0; ; i++) {
    const frontRow = rot.rows.find((r) => r.type === 'rotation' && r.round === i && r.half === '前半');
    if (!frontRow) break;
    roundCoachSides.push(frontRow.coachSide);
  }

  assert.ok(roundCoachSides.length >= 2, '複数 round が必要');
  for (let i = 0; i < roundCoachSides.length - 1; i++) {
    assert.notEqual(roundCoachSides[i], roundCoachSides[i + 1], `round ${i} と ${i + 1} の coachSide が同じ`);
  }
});

// ── rows展開: 各 rotation round が前後半2行・後半は左右入れ替え ──────────────────

test('rows展開: 各 rotation round は前後半2行・後半は前半の左右入れ替え', () => {
  const pd = pdWith('火', [
    { name: 'P1', mode: 'practice', minutes: 20 },
    { name: 'S1', mode: 'self', minutes: 20 },
  ]);
  const rot = buildRotation(pd, []);
  const rotRows = rot.rows.filter((r) => r.type === 'rotation' && r.round === 0);

  assert.equal(rotRows.length, 2, 'round 0 は前後半2行');
  const [front, back] = rotRows;
  assert.equal(front.half, '前半');
  assert.equal(back.half, '後半');
  assert.notEqual(front.coachSide, back.coachSide, '前後半で coachSide が入れ替わる');

  if (front.boys.mode === 'practice') {
    assert.equal(back.boys.mode, 'self', '後半は前半の boys が self に切り替わる');
    assert.equal(back.girls.mode, 'practice', '後半は前半の girls が practice に切り替わる');
  } else {
    assert.equal(back.girls.mode, 'self', '後半は前半の girls が self に切り替わる');
    assert.equal(back.boys.mode, 'practice', '後半は前半の boys が practice に切り替わる');
  }
});

// ── selfFillPool: practice の裏で pool の短い自走が使われる ──────────────────────

test('selfFillPool: practice 段がある場合 pool から裏埋め自走が選ばれる', () => {
  const pd = pdWith('火', [
    { name: 'P1', mode: 'practice', minutes: 20 },
  ]);
  const pool = [
    { name: 'FillA', mode: 'self', minutes: 10, category: 'C', video: null, alternatives: [] },
  ];
  const rot = buildRotation(pd, pool);
  const rotRows = rot.rows.filter((r) => r.type === 'rotation');
  assert.ok(rotRows.length > 0, 'rotation 行が生成される');

  // 裏埋めが P1 と別ドリル
  for (const row of rotRows) {
    const nonCoachCell = row.coachSide === '男子' ? row.girls : row.boys;
    assert.notEqual(nonCoachCell.name, 'P1', '裏埋めが practice と異なるドリル名');
  }
});

// ── WU/CD together: バンドルは together 行として実尺占有 ──────────────────────────

test('WU/CD: isBundle ブロックは together 行として実尺占有される', () => {
  const wuMin = 15;
  const cdMin = 5;
  const pd = pdWithBlocks('火', [
    { block: 'WU', isBundle: true, items: [{ name: 'ウォームアップ', mode: 'self', minutes: wuMin }] },
    { block: '技術', isBundle: false, items: [
      { name: 'P1', mode: 'practice', minutes: 20 },
    ]},
    { block: 'CD', isBundle: true, items: [{ name: 'ダウン', mode: 'self', minutes: cdMin }] },
  ]);
  const pool = [{ name: 'FillDrill', mode: 'self', minutes: 10, category: 'C', video: null, alternatives: [] }];
  const rot = buildRotation(pd, pool);

  // label は block.label || block.block のため pdWithBlocks が 'WU'/'CD' を返す
  const wuRow = rot.rows.find((r) => r.type === 'together' && (r.label === 'ウォームアップ' || r.label === 'WU'));
  assert.ok(wuRow, 'WU は together 行');
  assert.equal(wuRow.minutes, wuMin, `WU は実尺(${wuMin}分)を保持`);

  const cdRow = rot.rows.find((r) => r.type === 'together' && (r.label === 'ダウン' || r.label === 'CD'));
  assert.ok(cdRow, 'CD は together 行');
  assert.equal(cdRow.minutes, cdMin, `CD は実尺(${cdMin}分)を保持`);
});

// ── E2E: 実カタログ火曜で16:05開始・17:45終了・合計100分・violations=0 ────────────

test('E2E火曜: 実カタログ出力で16:05開始・17:45終了（100分）・violations=0・主自走together', async () => {
  const { fileURLToPath } = await import('node:url');
  const { dirname, resolve } = await import('node:path');
  const { createLocalStorage } = await import('../engine/src/storage.js');
  const { normalizeDrills } = await import('../engine/src/normalize.js');
  const { planWeek } = await import('../engine/src/planWeek.js');
  const { coachingMode } = await import('../engine/src/filter.js');

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const engineRoot = resolve(__dirname, '../engine');
  const repoRoot = resolve(__dirname, '..');

  const storage = createLocalStorage({
    drillsPath: resolve(repoRoot, 'docs/practice-knowledge/data/drills.json'),
    configPath: resolve(engineRoot, 'data/config.sample.json'),
    inputPath: resolve(engineRoot, 'data/team-input.sample.json'),
  });
  const [rawDrills, config, teamInput] = await Promise.all([
    storage.getDrills(),
    storage.getConfig(),
    storage.getTeamInput(),
  ]);
  const drills = normalizeDrills(rawDrills);

  const cfg = { ...config, shared_gym: false };
  delete cfg.groups;
  const plan = planWeek(drills, cfg, teamInput);

  const tuePlan = plan.days.find((d) => d.day === '火');
  assert.ok(tuePlan, '火曜の planDay が取れる');

  // presentation day 形式に変換（plan-data.mjs 相当の簡易版）
  const videoIndex = new Map(drills.map((d) => [d.id, d.video_url || null]));
  const START_MIN = 16 * 60 + 5; // 16:05
  let cur = START_MIN;
  const BLOCK_LABEL = { WU: 'ウォームアップ', 技術: '技術', 対人: '対人', ゲーム: 'ゲーム形式', CD: 'ダウン' };
  const hhmm2 = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const lectureHostDay = plan.saturday_lecture?.day ?? '土';
  const displayMode = (it, day) => {
    if (day.coach_present === false) return 'self';
    const raw = it.coaching_mode || (it.needs_coach ? 'practice' : 'self');
    if (raw === 'lecture' && day.day !== lectureHostDay) return 'self';
    return raw;
  };

  const blocks = [];
  for (const b of tuePlan.blocks) {
    if (b.items.length === 0) continue;
    const bStart = cur;
    const items = b.items.map((it) => {
      const item = {
        name: it.name,
        minutes: it.minutes,
        category: it.category,
        mode: displayMode(it, tuePlan),
        video: videoIndex.get(it.drill_id) || null,
        alternatives: (it.alternatives || []).map((a) => a.name),
      };
      cur += it.minutes;
      return item;
    });
    blocks.push({
      block: b.block,
      label: BLOCK_LABEL[b.block] || b.block,
      from: hhmm2(bStart),
      to: hhmm2(cur),
      minutes: cur - bStart,
      isBundle: b.block === 'WU' || b.block === 'CD',
      items,
    });
  }

  const pd = {
    day: '火',
    dayLabel: '火曜',
    coachPresent: true,
    start: hhmm2(START_MIN),
    end: hhmm2(cur),
    totalMinutes: cur - START_MIN,
    blocks,
  };

  // 開始 16:05・窓 100分・終了 17:45 の検証
  assert.equal(pd.start, '16:05', '開始 16:05');
  assert.equal(pd.totalMinutes, 100, '窓 100分');
  assert.equal(pd.end, '17:45', '終了 17:45');

  // selfFillPool（短い自走ドリルのプール）
  const selfPool = drills
    .filter((d) => coachingMode(d) === 'self')
    .map((d) => ({
      name: d.name,
      minutes: Math.max(d.duration_min || 10, 10),
      category: d.category,
      mode: 'self',
      video: d.video_url || null,
      alternatives: [],
    }));

  const rot = buildRotation(pd, selfPool);

  // violations = 0
  assert.deepEqual(findRotationViolations(rot.rows), [], '火曜 rotation violations = 0');

  // rows 合計 = 100分
  const rowsTotal = rot.rows.reduce((s, r) => s + r.minutes, 0);
  assert.equal(rowsTotal, 100, `rows合計(${rowsTotal}) === 100分（窓一致）`);

  // 全 self ブロックが together 行として保持されている（主自走の実尺）
  const togetherRows = rot.rows.filter((r) => r.type === 'together');
  assert.ok(togetherRows.length > 0, 'together 行が1行以上ある');
  for (const r of togetherRows) {
    assert.ok(r.minutes > 0, `together 行 '${r.drill?.name}' の minutes > 0`);
  }

  // boys/girls 被覆一致（rotation 行のみ）
  const boysSet = new Set();
  const girlsSet = new Set();
  for (const row of rot.rows) {
    if (row.type === 'rotation') {
      boysSet.add(row.boys.name);
      girlsSet.add(row.girls.name);
    }
  }
  // rotation 行が存在する場合のみ被覆一致を検証
  if (boysSet.size > 0) {
    assert.deepEqual([...boysSet].sort(), [...girlsSet].sort(), 'boys/girls 被覆集合が一致');
  }
});

// ── 小ブロック: 5分グリッドで割れない practice ブロックは分割せず1行（クラッシュ回避）──

test('小ブロック: 5分で割れない/10分未満の practice ブロックは分割せず1行・throwしない', () => {
  // 端数の philosophy-floor 等で 8分（5で割れない）の practice ブロックが来ても、
  // 前後半に割れずプラン全体を throw で落とさず、実尺1行で出すことを保証する。
  const pd = pdWithBlocks('火', [
    { block: '技術', isBundle: false, items: [{ name: 'P1', mode: 'practice', minutes: 8 }] },
  ]);
  const pool = [{ name: 'FillA', mode: 'self', minutes: 10, category: 'C', video: null, alternatives: [] }];
  let rot;
  assert.doesNotThrow(() => { rot = buildRotation(pd, pool); }, '小ブロックでも throw しない');

  const rotRows = rot.rows.filter((r) => r.type === 'rotation');
  assert.equal(rotRows.length, 1, '8分ブロックは前後半に割らず1行で出る');
  assert.equal(rotRows[0].minutes, 8, '1行が実尺8分を保持（時間消失なし）');

  const rowsTotal = rot.rows.reduce((s, r) => s + r.minutes, 0);
  assert.equal(rowsTotal, pd.totalMinutes, '時計不変（rows合計===窓）');
  assert.deepEqual(findRotationViolations(rot.rows), [], '不変条件違反ゼロ（practiceはcoachSideのみ）');
});
