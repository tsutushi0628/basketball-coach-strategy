/**
 * @file 「他の日からコピー」のコピー元候補（おすすめ＋探す）の業務意図テスト（純関数）。
 *
 * 正本: docs/specs/past-weeks-and-copy-source/service-design.md（3.章）、
 *       docs/findings/spec-20260905-past-weeks-and-copy-source-impl.md（7.1章・11章）。
 *
 * 検証する業務意図（実装の途中値は写経しない）:
 *   - おすすめは最大3件、基準日（編集中の日）より前の候補だけから、直近の同じ曜日→前回の練習日→
 *     去年の同じ頃の順で選ぶ。重なる日は先の項目に寄せ、後の項目は出さない（代替を探さない）。
 *   - 去年の同じ頃は基準日の364日前を中心に前後21日、同じ曜日優先で最も近い日。
 *   - 探す（months）は基準日より後の候補も含めた全候補を年月で束ね、新しい順。各月内は日付昇順。
 *   - searchable はおすすめに載らない候補が1件でもあれば真。
 *   - initialYm は基準日の月に候補があればその月、無ければ最新月、候補ゼロなら null。
 *   - 入力ゼロ件は全項目が空・false・null。
 *
 * 対応前の現状（本ファイル作成時点で実走確認済み）: ui/copy-source.mjs 自体が未作成のため、
 * import 時点で "Cannot find module" として全テストが失敗する。
 *
 * テスト基盤: node --test。純関数のみ・外部依存無し。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { copySourceCandidates } from './copy-source.mjs';

/* ───────────────────────── おすすめ3件がすべて揃う典型ケース ───────────────────────── */

// baseDate=2026-06-25（木）。364日前=2025-06-26（木・完全一致）。
const BASE = '2026-06-25';
const TYPICAL_DATES = [
  '2026-06-18', // 木・直近の同じ曜日
  '2026-06-23', // 火・前回の練習日（基準日直前の最新）
  '2026-06-27', // 土・基準日より後（探すのみ）
  '2025-06-26', // 木・去年の同じ頃（364日前ちょうど）
  '2026-05-10', // 日・探す用の別月
  '2026-04-02', // 木・探す用のさらに別月
];

test('copySourceCandidates: おすすめ3件が順序どおり（直近の同曜日→前回→去年の同じ頃）', () => {
  const r = copySourceCandidates(TYPICAL_DATES, BASE);
  assert.equal(r.recommended.length, 3);
  assert.deepEqual(r.recommended[0], { date: '2026-06-18', relation: '直近の木曜' });
  assert.deepEqual(r.recommended[1], { date: '2026-06-23', relation: '前回の練習日' });
  assert.deepEqual(r.recommended[2], { date: '2025-06-26', relation: '去年の同じ頃' });
});

test('copySourceCandidates: 基準日より後の候補はおすすめに入らず探すのみに入る', () => {
  const r = copySourceCandidates(TYPICAL_DATES, BASE);
  assert.ok(!r.recommended.some((x) => x.date === '2026-06-27'), '基準日より後（2026-06-27）はおすすめに出ない');
  const juneMonth = r.months.find((m) => m.ym === '2026-06');
  assert.ok(juneMonth.dates.includes('2026-06-27'), '探すには含まれる');
});

test('copySourceCandidates: months は全候補を新しい順の年月で束ね、各月内は日付昇順', () => {
  const r = copySourceCandidates(TYPICAL_DATES, BASE);
  assert.deepEqual(r.months.map((m) => m.ym), ['2026-06', '2026-05', '2026-04', '2025-06'], '新しい順');
  const june = r.months.find((m) => m.ym === '2026-06');
  assert.deepEqual(june.dates, ['2026-06-18', '2026-06-23', '2026-06-27'], '月内は昇順');
  assert.equal(june.label, '2026年6月');
});

test('copySourceCandidates: searchable はおすすめに載らない候補があれば真、initialYm は基準日の月', () => {
  const r = copySourceCandidates(TYPICAL_DATES, BASE);
  assert.equal(r.searchable, true, '2026-06-27・2026-05-10・2026-04-02 がおすすめ外');
  assert.equal(r.initialYm, '2026-06', '基準日の月(2026-06)に候補があるのでその月');
});

/* ───────────────────────── 重なりの寄せ（直近の同曜日＝前回の練習日） ───────────────────────── */

test('copySourceCandidates: 直近の同曜日と前回の練習日が同じ日なら2件（後の項目を重複させない）', () => {
  // 2026-06-30（火）基準。直近の候補は2026-06-23（火）の1件だけ＝「直近の火曜」と「前回の練習日」が
  // 同一日に重なるので1件に畳む。去年の同じ頃（2025-07-01・364日前ちょうど・同曜日）は別枠で残る。
  const r = copySourceCandidates(['2026-06-23', '2025-07-01'], '2026-06-30');
  assert.equal(r.recommended.length, 2, '重なりは1件に畳み、去年の同じ頃を合わせて2件');
  assert.deepEqual(r.recommended[0], { date: '2026-06-23', relation: '直近の火曜' });
  assert.deepEqual(r.recommended[1], { date: '2025-07-01', relation: '去年の同じ頃' });
});

/* ───────────────────────── 去年の同じ頃が無い ───────────────────────── */

test('copySourceCandidates: 去年の同じ頃に該当が無ければおすすめは2件（空枠を出さない）', () => {
  const dates = ['2026-06-18', '2026-06-23', '2026-06-27', '2026-05-10', '2026-04-02']; // 2025年の候補なし
  const r = copySourceCandidates(dates, BASE);
  assert.equal(r.recommended.length, 2);
  assert.deepEqual(r.recommended[0], { date: '2026-06-18', relation: '直近の木曜' });
  assert.deepEqual(r.recommended[1], { date: '2026-06-23', relation: '前回の練習日' });
});

test('copySourceCandidates: 去年の同じ頃は364日前を中心に前後21日・範囲外なら該当なし', () => {
  // 中心(2025-06-26)から22日離れた候補だけ＝範囲外なので去年の同じ頃は無し。
  const farDate = '2025-07-18'; // 2025-06-26 から22日後
  const r = copySourceCandidates(['2026-06-23', farDate], BASE);
  assert.ok(!r.recommended.some((x) => x.relation === '去年の同じ頃'), '前後21日の範囲外は候補にしない');
});

/* ───────────────────────── initialYm の3分岐 ───────────────────────── */

test('copySourceCandidates: initialYm は基準日の月に候補が無ければ最も新しい月', () => {
  const r = copySourceCandidates(['2026-06-18', '2026-05-10'], '2026-08-01');
  assert.equal(r.initialYm, '2026-06', '基準日(8月)に候補が無いので最新月(6月)');
});

/* ───────────────────────── 入力ゼロ ───────────────────────── */

test('copySourceCandidates: 候補が空なら全項目が空・false・null', () => {
  const r = copySourceCandidates([], BASE);
  assert.deepEqual(r, { recommended: [], months: [], searchable: false, initialYm: null });
});
