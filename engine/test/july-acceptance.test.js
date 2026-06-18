/**
 * @file 7月（準備始動）受け入れテスト（オーナー確定SCHEDULE＝受け入れ基準）。
 *
 * 新チームは男女とも7月始動扱い。current_month=7 が準備始動アークを引き、resolveWeekFocus が
 * 週の焦点（週1=型づくり／週2-4=反復・強度）を上から降ろす。本テストは生成物が固定セッション形と
 * SCHEDULE のルールに沿うことを業務意図として検証する（特定ドリルIDに依存せず、ブロック順・カテゴリ・
 * 段階・場所で判定する）。
 *
 * 受け入れ観点:
 *   A1  7月→準備始動アークが引ける（resolveMonth）。週の焦点が型づくり/反復で割れる（resolveWeekFocus）。
 *   A2  全曜日が固定6ブロック順（アップ→ファンダ→シュート→対人→ラン→静的）で、末尾は静的ストレッチ。
 *   A3  対人は基本「1on1 と 3on3（チーム守備）」で構成（刻まない）。
 *   A4  5on5（意思決定/ゲーム形式）は全面の日の対人ブロック末尾のみ。半面(水木)には出ない。
 *       オーナー確定メニューは型づくり週(週1)でも全面日（火・土）に5on5を出す（水木は無し）。
 *   A5  撤去3点の不在: ①哲学フロア(config.philosophy_floors)なし ②必ずゲームで締める固定枠なし
 *       （独立ゲームブロックが存在しない）③長さ順選定でない（同カテゴリ最長でないドリルが選ばれうる）。
 *   A6  火＝2部構成（外トレ60＝走り込み・アジリティ ＋ 全面60＝アップ→走ってフィニッシュ→3on3→5on5→静的）。
 *   A7  全面日の対人末尾の5on5は実体（5対5/オールコートゲーム）で、3on3/3対2の代替でない。
 *   A8  土曜限定ドリル（シャトルラン）は土のみ。火・金の走り込みに出ない。
 *   A9  火の外トレ（走り込み・アジリティ）にラダー等のアジリティ系が並ぶ。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { createLocalStorage } from '../src/storage.js';
import { normalizeDrills } from '../src/normalize.js';
import { planWeek } from '../src/planWeek.js';
import { loadAnnualPlan, resolveMonth, resolveWeekFocus } from '../src/annualPlan.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const engineRoot = resolve(__dirname, '..');
const repoRoot = resolve(engineRoot, '..');

const GAME_CAT = '意思決定/ゲーム形式';
const FIXED_ORDER = ['アップ', 'ファンダ', 'シュート', '対人', 'ラン', '静的'];

async function loadJulyPlan(weekOfMonth) {
  const storage = createLocalStorage({
    drillsPath: resolve(repoRoot, 'docs/practice-knowledge/data/drills.json'),
    configPath: resolve(engineRoot, 'data/config.sample.json'),
    inputPath: resolve(engineRoot, 'data/team-input.sample.json'),
  });
  const drills = normalizeDrills(await storage.getDrills());
  const config = await storage.getConfig();
  const teamInput = await storage.getTeamInput();
  const annual = await loadAnnualPlan();
  const resolved = resolveMonth(annual, '男子', config.current_month);
  const weekFocus = resolveWeekFocus(annual, '男子', config.current_month, weekOfMonth);
  const cfg = { ...config, phase: resolved.phase, phase_category_weights: resolved.focus_weights };
  return { drills, config: cfg, plan: planWeek(drills, cfg, teamInput, weekFocus), resolved, weekFocus };
}

// A1. 7月→準備始動が引け、週の焦点が型づくり/反復で割れる。
test('A1: 7月始動が準備始動アークを引き、週の焦点が型づくり(週1)/反復(週2-4)で割れる', async () => {
  const annual = await loadAnnualPlan();
  const m = resolveMonth(annual, '男子', 7);
  assert.match(m.phase, /準備/, '7月→準備フェーズを引くべき（始動扱い）');
  const w1 = resolveWeekFocus(annual, '男子', 7, 1);
  const w2 = resolveWeekFocus(annual, '男子', 7, 2);
  // オーナー確定メニュー: 型づくり週(週1)でも全面日（火・土）に5on5を出す。
  assert.equal(w1.allow_scrimmage, true, '週1（型づくり）でも全面日には5on5を解禁する');
  assert.equal(w2.allow_scrimmage, true, '週2-4（反復・強度）は5on5を解禁する');
  assert.ok(w1.mastery_bias.includes('習得'), '週1は習得段階を優先する（段階バイアスは型づくり寄り）');
  assert.notDeepEqual(w1.headline, w2.headline, '週1と週2-4で週の焦点文が異なるべき');
  // 男女とも7月始動（女子offset不使用）: 女子も7月→準備始動。
  const g = resolveMonth(annual, '女子', 7);
  assert.match(g.phase, /準備/, '女子も7月→準備始動（offset不使用）');
});

// A2. 全曜日が固定6ブロック順・末尾は静的。2部構成の日（火）は区画ごとに固定順。
test('A2: 全曜日が固定6ブロック順で末尾は静的ストレッチ（2部の日は区画ごと）', async () => {
  const { plan } = await loadJulyPlan(1);
  const rank = new Map(FIXED_ORDER.map((b, i) => [b, i]));
  for (const day of plan.days) {
    // 区画（part）ごとに固定順を判定（単一セッションの日は part 無し＝区画0扱い）。
    const byPart = new Map();
    for (const b of day.blocks) {
      const p = Number.isInteger(b.part) ? b.part : 0;
      if (!byPart.has(p)) byPart.set(p, []);
      byPart.get(p).push(b.block);
    }
    for (const [p, keys] of byPart) {
      let prev = -1;
      for (const k of keys) {
        const r = rank.get(k);
        assert.ok(r !== undefined, `${day.day}[区画${p}]: 未知のブロック「${k}」`);
        assert.ok(r > prev, `${day.day}[区画${p}]: ブロック順が固定形に反する（${keys.join('→')}）`);
        prev = r;
      }
    }
    // 日全体の末尾は静的ストレッチ（最後の区画＝コート部の締め）。
    const dayKeys = day.blocks.map((b) => b.block);
    assert.equal(dayKeys[dayKeys.length - 1], '静的', `${day.day}: 末尾は静的ストレッチであるべき（実=${dayKeys[dayKeys.length - 1]}）`);
    // 各日が枠ぴったりに埋まる（時間消失なし）。
    assert.equal(day.total_minutes, day.minutes, `${day.day}: 配置 ${day.total_minutes}分 が枠 ${day.minutes}分 に一致するべき`);
  }
});

// A3. 対人は1on1とチーム守備(3on3)で構成。
test('A3: 対人ブロックは1on1とチーム守備(3on3)を中心に構成（刻まない）', async () => {
  const { plan } = await loadJulyPlan(2);
  const CONTESTED_OK = new Set([
    '1on1',
    'チームディフェンス(オールコートマンツー/ヘルプ/帰陣)',
    'チームオフェンス(アーリー/トランジション)',
    'リバウンド/ボックスアウト',
    GAME_CAT, // 末尾5on5（全面日のみ）
  ]);
  let inspected = 0;
  for (const day of plan.days) {
    const contested = day.blocks.find((b) => b.block === '対人');
    if (!contested) continue;
    inspected += 1;
    for (const it of contested.items) {
      assert.ok(CONTESTED_OK.has(it.category), `${day.day} 対人に場違いカテゴリ「${it.category}」(${it.name})`);
    }
    // 「刻まない」: 対人の非ゲームセグメントは多くても3本まで（1on1/3on3＋補助）。
    const nonGame = contested.items.filter((it) => it.category !== GAME_CAT);
    assert.ok(nonGame.length <= 3, `${day.day} 対人が刻まれすぎ（非ゲーム ${nonGame.length}本）`);
  }
  assert.ok(inspected > 0, '対人ブロックを持つ日が少なくとも1日あるべき');
});

// A4. 5on5は全面の対人末尾のみ・半面は無し。型づくり週(週1)でも全面日には5on5あり。
test('A4: 5on5は全面の対人末尾のみ、半面(水木)には無く、型づくり週(週1)でも全面日には出る', async () => {
  for (const wk of [1, 2]) {
    const { plan } = await loadJulyPlan(wk);
    let scrimFullCourtDays = 0;
    for (const day of plan.days) {
      const fullCourt = String(day.court).includes('全面');
      const dayHasGame = day.blocks.some((b) => b.items.some((it) => it.category === GAME_CAT));
      for (const b of day.blocks) {
        const games = b.items.filter((it) => it.category === GAME_CAT);
        if (games.length === 0) continue;
        assert.equal(b.block, '対人', `週${wk} ${day.day} の「${b.block}」に5on5が独立配置`);
        assert.ok(fullCourt, `週${wk} 半面日 ${day.day} に5on5が混入`);
        assert.equal(b.items[b.items.length - 1].category, GAME_CAT, `週${wk} ${day.day} の5on5が対人ブロック末尾でない`);
      }
      if (dayHasGame) scrimFullCourtDays += 1;
    }
    // 全面日（火・金・土）の対人末尾に5on5が出る（型づくり週でも）。
    assert.ok(scrimFullCourtDays > 0, `週${wk} は全面日の対人末尾に5on5が出るべき`);

    // 半面(水木)には5on5が一切出ない。
    for (const day of plan.days) {
      if (String(day.court).includes('全面')) continue;
      for (const b of day.blocks) {
        assert.ok(!b.items.some((it) => it.category === GAME_CAT), `週${wk} 半面日 ${day.day} に5on5が混入`);
      }
    }
  }
});

// A5. 撤去3点の不在。
test('A5: 撤去3点が不在（哲学フロアなし・独立ゲームブロックなし・長さ順選定でない）', async () => {
  const { plan, config, drills } = await loadJulyPlan(2);
  // ① 哲学フロア（毎週強制）が config から撤去されている。
  assert.equal(config.philosophy_floors, undefined, 'philosophy_floors（フロア強制）は撤去されているべき');

  // ② 独立ゲームブロックが存在しない（ゲーム形式は対人ブロック内のみ）。
  for (const day of plan.days) {
    for (const b of day.blocks) {
      assert.ok(FIXED_ORDER.includes(b.block), `${day.day} に固定6ブロック外の「${b.block}」が存在`);
      if (b.block !== '対人') {
        assert.ok(!b.items.some((it) => it.category === GAME_CAT), `${day.day} の「${b.block}」に独立ゲームが存在`);
      }
    }
  }

  // ③ 長さ順選定でない: 同一カテゴリで最長 duration_max のドリルが必ず選ばれているわけではない。
  //    少なくとも1つの配置ドリルが、そのカテゴリの最長 duration_max ドリルと異なることを示す。
  const idx = new Map(drills.map((d) => [d.id, d]));
  const maxDurByCat = {};
  for (const d of drills) {
    if (!maxDurByCat[d.category] || d.duration_max > maxDurByCat[d.category].duration_max) {
      maxDurByCat[d.category] = d;
    }
  }
  let foundNonLongest = false;
  for (const day of plan.days) {
    for (const b of day.blocks) {
      for (const it of b.items) {
        const longest = maxDurByCat[it.category];
        if (longest && it.drill_id !== longest.id) { foundNonLongest = true; }
      }
    }
  }
  assert.ok(foundNonLongest, '同一カテゴリ最長でないドリルが選ばれる（教育的フィット選定＝長さ順でない）');
});

// A6. 火＝2部構成（外トレ60＝走り込み・アジリティ ＋ 全面60＝アップ→走ってフィニッシュ→3on3→5on5→静的）。
test('A6: 火は2部構成（外トレ60＋全面60）で、各部がヘッダを分けられる', async () => {
  const { plan, drills } = await loadJulyPlan(1);
  const tue = plan.days.find((d) => d.day === '火');
  assert.ok(tue, '火曜が存在するべき');

  // 区画メタが2つ（外トレ／全面）出る。
  assert.ok(Array.isArray(tue.parts) && tue.parts.length === 2, '火は2区画（外トレ＋全面）を持つべき');
  assert.equal(tue.parts[0].minutes, 60, '外トレ区画は60分');
  assert.equal(tue.parts[1].minutes, 60, '全面区画は60分');

  // 区画0（外トレ）＝走り込み(ラン)のみで、外トレが60分。
  const part0 = tue.blocks.filter((b) => b.part === 0);
  const part0run = part0.filter((b) => b.block === 'ラン').reduce((s, b) => s + b.items.reduce((x, it) => x + it.minutes, 0), 0);
  assert.equal(part0run, 60, `外トレ区画は走り込み60分（実=${part0run}）`);
  assert.ok(part0.every((b) => b.block === 'ラン'), '外トレ区画はラン(走り込み・アジリティ)のみ');

  // 区画1（全面）＝アップ→シュート(走ってフィニッシュ)→対人(3on3→5on5)→静的。ファンダは無し。
  const part1Blocks = tue.blocks.filter((b) => b.part === 1).map((b) => b.block);
  assert.ok(part1Blocks.includes('アップ'), '全面区画はアップで始まる');
  assert.ok(part1Blocks.includes('対人'), '全面区画は対人を持つ');
  assert.equal(part1Blocks[part1Blocks.length - 1], '静的', '全面区画は静的で締める');
  assert.ok(!part1Blocks.includes('ファンダ'), '火の全面区画はファンダを持たない（走ってフィニッシュ起点）');

  // 全面区画の対人末尾に5on5（型づくり週でも）。
  const part1Contested = tue.blocks.find((b) => b.part === 1 && b.block === '対人');
  assert.ok(part1Contested, '火の全面区画は対人ブロックを持つ');
  const contestedItems = part1Contested.items;
  assert.equal(contestedItems[contestedItems.length - 1].category, GAME_CAT, '火の全面区画の対人末尾は5on5');

  // オーナー確定内訳: 対人＝3on3(チームディフェンス)→5on5。5on5の前にチーム守備(3on3)の
  // 非ゲーム対人が必ず1枠着席する（1on1だけ・3on3欠落の不具合の回帰）。
  const TEAM_D = 'チームディフェンス(オールコートマンツー/ヘルプ/帰陣)';
  const beforeTail = contestedItems.slice(0, -1);
  assert.ok(
    beforeTail.some((it) => it.category === TEAM_D),
    `火の全面対人は5on5の前にチーム守備(3on3)が着席するべき（実=${contestedItems.map((it) => `${it.name}:${it.category}`).join(' / ')}）`,
  );

  // オーナー確定内訳: ブックエンド（アップ・静的）は各10分固定（比率丸めで静的5分に痩せない）。
  const part1Up = tue.blocks.find((b) => b.part === 1 && b.block === 'アップ');
  const part1Static = tue.blocks.find((b) => b.part === 1 && b.block === '静的');
  const sumMin = (b) => b.items.reduce((s, it) => s + it.minutes, 0);
  assert.equal(sumMin(part1Up), 10, '火の全面区画のアップは10分');
  assert.equal(sumMin(part1Static), 10, '火の全面区画の静的ストレッチは10分');

  // オーナー確定: シュート枠＝走ってフィニッシュ＝トランジション/2on1速攻系（走る系）。主ドリルが
  // 静的な遊び系（philosophy_tags『遊び』）でないこと（FIN-010降格・FIN-014昇格の回帰）。
  const part1Shoot = tue.blocks.find((b) => b.part === 1 && b.block === 'シュート');
  assert.ok(part1Shoot && part1Shoot.items.length > 0, '火の全面区画はシュート（走ってフィニッシュ）枠を持つ');
  const shootPrimary = drills.find((d) => d.id === part1Shoot.items[0].drill_id);
  assert.ok(shootPrimary, '走ってフィニッシュの主ドリルがカタログに存在する');
  const playTagged = Array.isArray(shootPrimary.philosophy_tags) && shootPrimary.philosophy_tags.includes('遊び');
  assert.ok(!playTagged, `走ってフィニッシュの主ドリルは遊び系であってはならない（実=${shootPrimary.name}）`);
  const RUN_FINISH = /トランジション|速攻|走り|オールコート|合わせ|ツーメン/;
  const shootHay = `${shootPrimary.name} ${shootPrimary.sub_skill ?? ''} ${(shootPrimary.philosophy_tags ?? []).join(' ')}`;
  assert.ok(
    RUN_FINISH.test(shootHay),
    `走ってフィニッシュの主ドリルは走る系(トランジション/2on1速攻)であるべき（実=${shootPrimary.name}）`,
  );
});

// A7. 全面日の5on5は実体（5対5/オールコートゲーム）で、3on3/3対2の代替でない。
test('A7: 全面日の対人末尾の5on5は実体の5対5(オールコートゲーム)である', async () => {
  const REAL_5ON5 = /5対5|5on5|オールコートゲーム/;
  for (const wk of [1, 2]) {
    const { plan } = await loadJulyPlan(wk);
    const fullDaysWithGame = plan.days.filter(
      (d) => String(d.court).includes('全面') && d.blocks.some((b) => b.items.some((it) => it.category === GAME_CAT)),
    );
    assert.ok(fullDaysWithGame.length > 0, `週${wk} に5on5を持つ全面日があるべき`);
    for (const day of fullDaysWithGame) {
      const contested = day.blocks.filter((b) => b.block === '対人');
      // その日のどこかの対人末尾に実体5on5が乗る。
      const tail = contested.map((b) => b.items[b.items.length - 1]).filter((it) => it && it.category === GAME_CAT);
      assert.ok(tail.length > 0, `週${wk} ${day.day} の対人末尾に5on5が乗るべき`);
      assert.ok(
        tail.some((it) => REAL_5ON5.test(it.name)),
        `週${wk} ${day.day} の5on5が実体（5対5/オールコート）であるべき（実=${tail.map((it) => it.name).join('/')}）`,
      );
    }
  }
});

// A8. 土曜限定（シャトルラン）は土のみ・火金には出ない。
test('A8: 土曜限定ドリル（シャトルラン）は土のみで、火・金の走り込みに出ない', async () => {
  const SHUTTLE = /シャトルラン/;
  for (const wk of [1, 2]) {
    const { plan } = await loadJulyPlan(wk);
    for (const day of plan.days) {
      const hasShuttle = day.blocks.some((b) => b.items.some((it) => SHUTTLE.test(it.name)));
      if (day.day === '土') continue; // 土は出てよい
      assert.ok(!hasShuttle, `週${wk} ${day.day} に土曜限定のシャトルランが混入`);
    }
  }
});

// A9. 火の外トレ（走り込み・アジリティ）にラダー等のアジリティ系が並ぶ。
test('A9: 火の外トレ（走り込み・アジリティ）にアジリティ系（ラダー等）が含まれる', async () => {
  const AGILITY = /ラダー|アジリティ|ステップ|フットワーク|シャトル|切り返し/;
  const { plan } = await loadJulyPlan(1);
  const tue = plan.days.find((d) => d.day === '火');
  const part0run = tue.blocks.filter((b) => b.part === 0 && b.block === 'ラン').flatMap((b) => b.items);
  assert.ok(part0run.length > 0, '火の外トレに走り込みドリルが並ぶべき');
  assert.ok(
    part0run.some((it) => AGILITY.test(it.name) || AGILITY.test(it.category)),
    `火の外トレにアジリティ系（ラダー等）が含まれるべき（実=${part0run.map((it) => it.name).join('/')}）`,
  );
});
