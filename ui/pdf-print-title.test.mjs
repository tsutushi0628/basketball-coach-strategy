/**
 * @file 練習計画PDF保存時のファイル名（印刷タイトル差替・復元）の業務意図テスト。
 *
 * オーナー要望: PDF保存時のファイル名を選択中の日付で yyyymmdd.pdf にする（現状はブラウザ既定名＝
 * <title> 由来で、学校名＋月＋パターン名の固定文字列のため日付が入らない）。
 *
 * 検証する業務意図:
 *   - pdfPrintTitle: 選択中日付(ISO yyyy-mm-dd)が妥当なら yyyymmdd。未設定・不正形式・実在しない日
 *     （2/30等）は null（呼び出し側が現行タイトル維持・throwしない）。
 *   - createPrintTitleSwap（実行時挙動の状態遷移を純関数で検証）:
 *       beforeprint→afterprint で日付タイトル→元タイトルに遷移・復元する。
 *       beforeprint→focus（afterprint不発環境の保険）でも復元する。
 *       連打相当（beforeprint多重発火）でも元タイトルを日付で誤捕捉しない。
 *       復元の多重呼び出し（afterprint→focus）は冪等で無害。
 *       日付未選択時はタイトル不変（現行挙動のまま印刷）。
 *   - clientScript: 差替は window の beforeprint/afterprint に初期化時登録（Ctrl+P等も対象）、
 *     focus 復元の保険があり、printBtn は window.print() を呼ぶだけ。
 *
 * テスト基盤: node --test。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pdfPrintTitle, createPrintTitleSwap, clientScript } from './render-shared.mjs';

// ── pdfPrintTitle（日付→タイトル文字列の規則） ─────────────────────────────────
test('pdfPrintTitle: 選択中日付があれば yyyymmdd を返す', () => {
  assert.equal(pdfPrintTitle('2026-07-16'), '20260716');
  assert.equal(pdfPrintTitle('2026-01-05'), '20260105');
  assert.equal(pdfPrintTitle('2024-02-29'), '20240229', '閏年の2/29は実在日');
});

test('pdfPrintTitle: 未設定(null/undefined/空文字)は null（現行タイトル維持）', () => {
  assert.equal(pdfPrintTitle(null), null);
  assert.equal(pdfPrintTitle(undefined), null);
  assert.equal(pdfPrintTitle(''), null);
});

test('pdfPrintTitle: 不正形式（yyyy-mm-dd以外の書式）は null（throwしない）', () => {
  assert.equal(pdfPrintTitle('invalid'), null);
  assert.equal(pdfPrintTitle('2026/07/16'), null);
  assert.equal(pdfPrintTitle('2026-7-16'), null, '0埋めなし(桁不足)は書式不一致');
});

test('pdfPrintTitle: 実在しない日（Date往復で成分不一致）は null', () => {
  assert.equal(pdfPrintTitle('2026-02-30'), null, '2月30日は存在しない');
  assert.equal(pdfPrintTitle('2026-02-29'), null, '2026年は閏年でない');
  assert.equal(pdfPrintTitle('2026-13-01'), null, '13月は存在しない');
  assert.equal(pdfPrintTitle('2026-00-10'), null, '0月は存在しない');
  assert.equal(pdfPrintTitle('2026-04-31'), null, '4月31日は存在しない');
});

// ── createPrintTitleSwap（差替・復元の状態遷移＝実行時挙動） ─────────────────────
const ORIG = '港北中 7月 練習メニュー（男子・女子） — 標準';

/** document.title 相当の擬似ホスト。curDate は差し替え可能。 */
function fakeHost(curDate) {
  const state = { title: ORIG, curDate };
  return {
    state,
    getTitle: () => state.title,
    setTitle: (t) => { state.title = t; },
    getCurDate: () => state.curDate,
  };
}

test('状態遷移: beforeprint→afterprint で日付タイトル→元タイトルに復元する', () => {
  const host = fakeHost('2026-07-16');
  const swap = createPrintTitleSwap(host);
  swap.beforeprint();
  assert.equal(host.state.title, '20260716', '印刷中は日付タイトル');
  swap.restore(); // afterprint
  assert.equal(host.state.title, ORIG, '印刷後は元タイトルへ復元');
});

test('状態遷移: beforeprint→focus（afterprint不発環境の保険）でも復元する', () => {
  const host = fakeHost('2026-07-16');
  const swap = createPrintTitleSwap(host);
  swap.beforeprint();
  assert.equal(host.state.title, '20260716');
  swap.restore(); // focus（afterprint が来なかった環境）
  assert.equal(host.state.title, ORIG, 'focus 経由でも復元される');
});

test('状態遷移: 連打相当（beforeprint多重発火）でも元タイトルを日付で誤捕捉しない', () => {
  const host = fakeHost('2026-07-16');
  const swap = createPrintTitleSwap(host);
  swap.beforeprint();
  swap.beforeprint(); // 復元前の再発火（連打・多重発火）
  assert.equal(host.state.title, '20260716', '差替中の再入は無視（二重差替しない）');
  swap.restore();
  assert.equal(host.state.title, ORIG, '復元先は日付でなく本来の元タイトル');
});

test('状態遷移: 復元の多重呼び出し（afterprint→focus）は冪等で元タイトルのまま', () => {
  const host = fakeHost('2026-07-16');
  const swap = createPrintTitleSwap(host);
  swap.beforeprint();
  swap.restore(); // afterprint
  swap.restore(); // focus（保険の多重発火）
  swap.restore(); // さらに focus
  assert.equal(host.state.title, ORIG, '多重復元でもタイトルは元のまま（無害）');
});

test('状態遷移: 未差替での restore（印刷前の focus 等）は何もしない', () => {
  const host = fakeHost('2026-07-16');
  const swap = createPrintTitleSwap(host);
  swap.restore(); // 印刷していないのに focus が発火
  assert.equal(host.state.title, ORIG, 'タイトル不変');
});

test('状態遷移: 日付未選択（__curDate なし）はタイトル不変のまま印刷（現行挙動維持）', () => {
  const host = fakeHost(null);
  const swap = createPrintTitleSwap(host);
  swap.beforeprint();
  assert.equal(host.state.title, ORIG, '差替しない');
  swap.restore();
  assert.equal(host.state.title, ORIG, '復元も no-op');
});

test('状態遷移: 印刷→復元→日付を変えて再印刷、が正しく遷移する（2回目も新日付）', () => {
  const host = fakeHost('2026-07-16');
  const swap = createPrintTitleSwap(host);
  swap.beforeprint();
  swap.restore();
  host.state.curDate = '2026-07-18'; // 日ピッカーで別日へ切替
  swap.beforeprint();
  assert.equal(host.state.title, '20260718', '2回目の印刷は新しい選択日');
  swap.restore();
  assert.equal(host.state.title, ORIG);
});

// ── clientScript（配線の構造検査） ──────────────────────────────────────────────
test('clientScript: 差替は beforeprint/afterprint に初期化時登録・focus保険あり・printBtnはprint()のみ', () => {
  const js = clientScript();
  assert.match(js, /var pdfPrintTitle=function/, 'pdfPrintTitle（node側でテスト済み）が埋め込まれている');
  assert.match(js, /var createPrintTitleSwap=function/, 'createPrintTitleSwap（状態遷移）が埋め込まれている');
  assert.match(js, /addEventListener\('beforeprint',titleSwap\.beforeprint\)/, 'beforeprint で差替（Ctrl+P・メニュー印刷も対象）');
  assert.match(js, /addEventListener\('afterprint',titleSwap\.restore\)/, 'afterprint で復元');
  assert.match(js, /addEventListener\('focus',titleSwap\.restore\)/, 'focus 復元の保険（afterprint不発環境）');
  assert.match(js, /getCurDate:function\(\)\{return window\.__curDate;\}/, '選択中日付は window.__curDate を読む');
  // printBtn はタイトル操作を持たず window.print() を呼ぶだけ（差替はイベント側の単一経路）。
  assert.match(js, /getElementById\('printBtn'\); if\(p\)p\.addEventListener\('click',function\(\)\{window\.print\(\);\}\);/,
    'printBtn ハンドラは window.print() のみ');
});
