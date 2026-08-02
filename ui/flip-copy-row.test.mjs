/**
 * @file 「反転コピー」（1ブロック→男女入替の後半ブロックを1個だけ追加）の業務意図を実ブラウザで固定する退行テスト。
 *
 * 背景（オーナー確定挙動・2026-07-01）: コーチが「男女を時間でずらして回す日」を組むとき、前半の
 * 1ブロック（男子セル＋女子セル）を作ったら、反転コピーボタン1つで「男女の中身を入れ替えた後半ブロック」
 * を直後の時間帯に1個だけ追加してほしい。前半ブロックは一切変更しない（純粋な追加操作）。
 * 3ブロック以上への連鎖はしない（1回の追加限定）。追加位置が既存ブロックと時間重複する場合は追加しない。
 *
 * 検証する業務意図（実装の途中値は写経しない）:
 *   (a) 前半ブロックに男子/女子とも中身がある状態で反転コピー→ 行が1つ増え、新しい行の
 *       男子＝元の女子内容・女子＝元の男子内容（入替）、時刻は開始=前半の終了・長さ=前半と同じ。
 *   (b) 反転コピー後も前半ブロック（起点行）自体は一切変更されない（不変）。
 *   (c) 追加位置が既存の別ブロックと時間重複する場合は追加せず、model が変化しない（warning表示）。
 *   (d) 前半ブロックが空（男女とも中身なし）なら反転コピーしない（コピー元が無い）。
 *   (e) 反転コピーは1回の呼び出しで1行だけ増える（3ブロック以上への連鎖をしない）。
 *
 * テスト基盤: node --test ＋ Playwright(chromium)。対象は build.mjs が出力する pattern-timeline.html の
 * 実DOM・実IIFE（editor.mjs の flip-copy ハンドラ本体）を直接駆動する。
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';

import { buildPlanData } from './plan-data.mjs';
import { localStorages, LOCAL_FIXTURE_TODAY } from './build.mjs';
import { render } from './pattern-timeline.mjs';
import { renderPage } from './render-shared.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// このテスト専用の使い捨てビルド（他テストファイルと共有しない・並列実行での競合を避ける）。
// today を種データのアンカー週に固定し、実行時刻に関わらず overrides.json の上書き日
// （2026-06-23等）が表示範囲に入るようにする（Part C の今日基準シフトは実運用のみが対象）。
const HTML = resolve(__dirname, 'pattern-timeline.flip-copy-row.tmp.html');
const DATE = '2026-06-23'; // overrides.json のコーチ上書き日（twoCol・編集可能）

let browser;
let page;

before(async () => {
  const data = await buildPlanData({ ...localStorages(), today: LOCAL_FIXTURE_TODAY });
  const { css, body } = render(data);
  writeFileSync(HTML, renderPage({ title: 'flip-copy-row fixture', css, body }), 'utf8');
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.goto(pathToFileURL(HTML).href);
});

after(async () => {
  if (browser) await browser.close();
  if (existsSync(HTML)) unlinkSync(HTML);
});

/** 対象日の編集パネルを開く（curDay＝hidden でない最初の .day に揃える）。
 * 対象日が属する週グループ（.daywk）も合わせて可視にする（多週描画は表示中の週グループだけが
 * 可視という不変条件を持つため、日を可視にしても所属週グループが隠れたままだと描画されない）。 */
async function openPanel() {
  await page.evaluate((d) => {
    document.querySelectorAll('.day[data-date]').forEach((p) => { p.hidden = p.getAttribute('data-date') !== d; });
    const target = document.querySelector(`.day[data-date="${d}"]`);
    const wk = target && target.closest('.daywk');
    if (wk) document.querySelectorAll('.daywk[data-week]').forEach((g) => { g.hidden = g !== wk; });
  }, DATE);
  await page.evaluate(() => window.__bcsEditor.openPanel());
  await page.waitForSelector('.ed-panel .ed-row', { timeout: 5000 });
}

/** パネルを閉じる（次シナリオを独立させる）。 */
async function closePanel() {
  await page.evaluate(() => { const c = document.querySelector('.ed-panel [data-act="cancel"]'); if (c) c.click(); });
  // キャンセルは中身がある日では確認カードを出す（決定書3.2節）。テスト用クリーンアップとして
  // カードが出ていれば「実行」を押して閉じ切る（中身が無ければカードは出ず、次の evaluate は無害）。
  await page.evaluate(() => {
    const dlg = document.getElementById('ed-cd');
    if (dlg && !dlg.hidden) { const exec = document.getElementById('ed-cd-exec'); if (exec) exec.click(); }
  });
}

/** 末尾に新規の空行を1つ足し、その行インデックスを返す。 */
async function addRow() {
  await page.click('.ed-panel [data-act="add-row"]');
  await page.waitForFunction(() => document.querySelectorAll('.ed-panel .ed-row').length > 0);
  await page.waitForTimeout(50);
  return page.$$eval('.ed-panel .ed-row', (rs) => rs.length - 1);
}

/** 行 ri / side のセルへ見出し＋項目名を実タイピング。 */
async function fillCell(ri, side, label, names) {
  const base = `.ed-panel .ed-cell[data-ri="${ri}"][data-side="${side}"]`;
  if (label != null) await (await page.$(`${base} [data-k="label"]`)).fill(label);
  for (let k = 0; k < names.length; k++) {
    const ns = `${base} .ed-item[data-ii="${k}"] [data-k="name"]`;
    let el = await page.$(ns);
    if (!el) { await page.click(`${base} [data-act="add-item"]`); await page.waitForSelector(ns); el = await page.$(ns); }
    await el.fill(names[k]);
  }
}

/** 行 ri の時刻（from/to）を設定。 */
async function setTimes(ri, from, to) {
  const rowSel = `.ed-panel .ed-row[data-ri="${ri}"]`;
  await page.fill(`${rowSel} [data-k="from"]`, from);
  await page.fill(`${rowSel} [data-k="to"]`, to);
  await page.evaluate((r) => {
    const rowEl = document.querySelector(`.ed-panel .ed-row[data-ri="${r}"]`);
    rowEl.dispatchEvent(new Event('change', { bubbles: true }));
  }, ri);
}

/** 現在の行数。 */
async function rowCount() {
  return page.$$eval('.ed-panel .ed-row', (rs) => rs.length);
}

/** 行 ri の現状（時刻・各セルの見出し・項目名）を実DOMから読む。 */
async function readRow(ri) {
  return page.evaluate((ri) => {
    const row = document.querySelector(`.ed-panel .ed-row[data-ri="${ri}"]`);
    const from = row.querySelector('[data-k="from"]')?.value ?? '';
    const to = row.querySelector('[data-k="to"]')?.value ?? '';
    const rc = (s) => {
      const c = row.querySelector(`.ed-cell[data-side="${s}"]`);
      if (!c) return null;
      return {
        label: c.querySelector('[data-k="label"]')?.value ?? '',
        items: [...c.querySelectorAll('.ed-item [data-k="name"]')].map((n) => n.value).filter(Boolean),
      };
    };
    return { from, to, 男子: rc('男子'), 女子: rc('女子') };
  }, ri);
}

/** 行 ri の「反転コピー」ボタンを押す。confirm ダイアログが出れば want で応答。 */
async function clickFlipCopy(ri, { confirmWith } = {}) {
  if (confirmWith != null) {
    page.once('dialog', (d) => (confirmWith ? d.accept() : d.dismiss()));
  }
  await page.click(`.ed-panel .ed-row[data-ri="${ri}"] [data-act="flip-copy"]`);
  await page.waitForTimeout(80);
}

/** model.rows のスナップショット（from/to のみ・軽量比較用）。 */
async function modelTimes() {
  return page.evaluate(() => window.__bcsEditor.model().rows.map((r) => [r.from, r.to]));
}

/**
 * 行 ri の近くに出る結果・中断理由メッセージ（.ed-row-msg）の実テキストを読む。
 * コーチが「押した行のすぐそば」で読める場所に文言が出ているかを一次情報で確認するための入口
 * （model の変化だけでなく、実際に画面へ出る文言と出る場所を検証する）。
 */
async function rowMsgText(ri) {
  return page.locator(`.ed-panel .ed-row[data-ri="${ri}"] .ed-row-msg`).textContent();
}

/** 行メッセージ欄(.ed-row-msg)が読み上げにも届く仕組み（role=status/aria-live）を持つか。 */
async function rowMsgIsLive(ri) {
  const el = page.locator(`.ed-panel .ed-row[data-ri="${ri}"] .ed-row-msg`);
  return { role: await el.getAttribute('role'), ariaLive: await el.getAttribute('aria-live') };
}

test('(a) 前半ブロックに男女とも中身→反転コピーで後半行が1つ増え、男女入替・時刻は直後', async () => {
  await openPanel();
  const ri = await addRow();
  await setTimes(ri, '18:00', '18:20');
  await fillCell(ri, '男子', 'ゲーム', ['5対5 ゲーム形式']);
  await fillCell(ri, '女子', '外', ['走り込み・アジリティ']);
  const before = await rowCount();

  await clickFlipCopy(ri);

  const after = await rowCount();
  assert.equal(after, before + 1, '行が1つだけ増える');

  const added = await readRow(ri + 1);
  assert.equal(added.from, '18:20', '新しい行の開始＝前半の終了時刻');
  assert.equal(added.to, '18:40', '新しい行の長さ＝前半と同じ（20分）');
  assert.equal(added.男子.label, '外', '新しい行の男子＝元の女子内容（入替）');
  assert.deepEqual(added.男子.items, ['走り込み・アジリティ'], '新しい行の男子項目＝元の女子項目');
  assert.equal(added.女子.label, 'ゲーム', '新しい行の女子＝元の男子内容（入替）');
  assert.deepEqual(added.女子.items, ['5対5 ゲーム形式'], '新しい行の女子項目＝元の男子項目');

  // コーチに何が伝わるか（model の変化だけでなく、押した行の近くに出る実文言・置き場所を検証）。
  const msg = await rowMsgText(ri);
  assert.match(msg, /追加しました/, '成功時は「追加しました」と結果が押した行の近くに出る');
  assert.match(msg, /18:20.*18:40/, '成功時のメッセージに追加された後半ブロックの時間帯が含まれる（何がどこに増えたか分かる）');
  const live = await rowMsgIsLive(ri);
  assert.equal(live.role, 'status', '結果メッセージは role="status" を持つ（読み上げにも届く）');
  assert.equal(live.ariaLive, 'polite', '結果メッセージは aria-live="polite" を持つ（読み上げにも届く）');
  await closePanel();
});

test('(b) 反転コピー後も前半ブロック（起点行）自体は変更されない', async () => {
  await openPanel();
  const ri = await addRow();
  await setTimes(ri, '19:00', '19:15');
  await fillCell(ri, '男子', 'アップ', ['ダイナミックストレッチ']);
  await fillCell(ri, '女子', 'シュート', ['アラウンドシュート']);

  await clickFlipCopy(ri);

  const src = await readRow(ri);
  assert.equal(src.from, '19:00', '起点行の開始時刻は不変');
  assert.equal(src.to, '19:15', '起点行の終了時刻は不変');
  assert.equal(src.男子.label, 'アップ', '起点行の男子内容は不変');
  assert.deepEqual(src.男子.items, ['ダイナミックストレッチ'], '起点行の男子項目は不変');
  assert.equal(src.女子.label, 'シュート', '起点行の女子内容は不変');
  assert.deepEqual(src.女子.items, ['アラウンドシュート'], '起点行の女子項目は不変');
  await closePanel();
});

test('(c) 追加位置が既存ブロックと時間重複する場合は追加しない（modelが変化しない）', async () => {
  await openPanel();
  // overrides.json 実データ: 行0=16:00〜16:25（男女とも中身あり）、行1=16:25〜17:00（既存ブロック）。
  // 行0を反転コピーすると新行は16:25〜16:50になり、既存の行1（16:25〜17:00）と重複する。
  const before = await modelTimes();
  const beforeCount = await rowCount();

  await clickFlipCopy(0);

  const after = await modelTimes();
  const afterCount = await rowCount();
  assert.equal(afterCount, beforeCount, '重複時は行数が変化しない（追加しない）');
  assert.deepEqual(after, before, '重複時は model の時刻配列が不変');

  const msg = await rowMsgText(0);
  assert.match(msg, /時間帯.*既存のブロックと重なる/, '中断理由「時間帯が既存のブロックと重なる」が押した行(行0)の近くに出る');
  assert.match(msg, /16:25.*16:50/, '重なった具体的な時間帯がメッセージに含まれる');
  await closePanel();
});

test('(d) 前半ブロックが空（男女とも中身なし）なら反転コピーしない', async () => {
  await openPanel();
  const ri = await addRow();
  await setTimes(ri, '20:00', '20:10');
  const before = await rowCount();

  await clickFlipCopy(ri);

  const after = await rowCount();
  assert.equal(after, before, '中身が無い行は反転コピーしない（行数不変）');

  const msg = await rowMsgText(ri);
  assert.match(msg, /元になる中身がありません/, '中断理由「元になる中身がない」が押した行の近くに出る');
  assert.match(msg, /ドリルを入れて/, 'コーチが次にすべきこと（ドリルを入れる）が文言に含まれる');
  await closePanel();
});

test('(e) 反転コピーは1回の呼び出しで1行だけ増える（3ブロック以上へ連鎖しない）', async () => {
  await openPanel();
  const ri = await addRow();
  await setTimes(ri, '21:00', '21:10');
  await fillCell(ri, '男子', 'ラン', ['流し']);
  await fillCell(ri, '女子', '静的', ['ストレッチ']);
  const before = await rowCount();

  await clickFlipCopy(ri);

  const afterFirst = await rowCount();
  assert.equal(afterFirst, before + 1, '1回目: 1行だけ増える');

  // 新しく増えた行（起点の直後）を対象に再度反転コピーしても、連鎖して自動的に3個目が増えたりしない
  // （呼び出し自体は独立操作として成立するが、1回の押下では1行しか増えないことを固定する）。
  await clickFlipCopy(ri);
  const afterSecond = await rowCount();
  assert.equal(afterSecond, afterFirst, '同じ起点行への2回目押下は、対象2枠が中身ありのため確認なしでは増えない（安全策で中断）');

  const msg = await rowMsgText(ri);
  assert.match(msg, /時間帯.*既存のブロックと重なる/, '2回目押下の中断理由（直前に追加した行との重複）が押した行の近くに出る');
  await closePanel();
});

// 【D】反転コピー先が24:00を跨ぐ端の時刻で不正値('24:20'等)を作らないことを固定する。
test('(D) 24:00跨ぎ: 23:40始まりの前半で反転コピーは追加されず、行数が変わらない', async () => {
  await openPanel();
  const ri = await addRow();
  // 前半 23:40〜23:50（10分）→ 後半は 23:50〜24:00（=1440分・24:00以上）で不正時刻になる。
  await setTimes(ri, '23:40', '23:50');
  await fillCell(ri, '男子', 'ゲーム', ['5対5']);
  await fillCell(ri, '女子', '外', ['走り込み']);
  const before = await rowCount();

  await clickFlipCopy(ri);

  const after = await rowCount();
  assert.equal(after, before, '24:00を跨ぐ反転コピーは追加されない（行数不変）');
  // 不正な '24:00' 等が model に混入していないことも確認（保存前ドラフトの健全性）。
  const times = await modelTimes();
  for (const [f, t] of times) {
    assert.doesNotMatch(String(t), /^2[4-9]:|^[3-9]\d:/, `終了時刻に24:00以上の不正値が無い（${t}）`);
  }

  const msg = await rowMsgText(ri);
  assert.match(msg, /24:00を跨ぐ/, '中断理由「24:00を跨ぐ」が押した行の近くに出る');
  assert.match(msg, /早い時間帯にしてください/, 'コーチが次にすべきこと（前半を早い時間帯にする）が文言に含まれる');
  await closePanel();
});

// 【F】前半ブロックの時刻が未入力/不正（終了が開始以前）なら反転コピーしない。
test('(F) 前半ブロックの時刻が未入力なら反転コピーしない（時刻必須の中断理由が行の近くに出る）', async () => {
  await openPanel();
  const ri = await addRow();
  await setTimes(ri, '', ''); // 明示的に時刻を空にする（add-row の既定引き継ぎを打ち消す）
  await fillCell(ri, '男子', 'ラン', ['流し']);
  await fillCell(ri, '女子', '静的', ['ストレッチ']);
  const before = await rowCount();

  await clickFlipCopy(ri);

  const after = await rowCount();
  assert.equal(after, before, '前半ブロックの時刻が無い行は反転コピーしない（行数不変）');

  const msg = await rowMsgText(ri);
  assert.match(msg, /開始・終了時刻が必要/, '中断理由「開始・終了時刻が必要」が押した行の近くに出る');
  assert.match(msg, /時刻を入力してから押して/, 'コーチが次にすべきこと（時刻を入力する）が文言に含まれる');
  await closePanel();
});

// 【I】前半ブロックの時刻が「入力されてはいるが逆転している」ケース（終了<開始）。(F)の「未入力」とは
// 同じ分岐（fm==null||tm==null||!(tm>fm)）を通るが、コーチから見た状況は別物（打ち間違いで終了を
// 開始より前に置いてしまった）。開始欄を変えたときの自動補正（終了を開始に合わせる）を経由せず、
// 終了欄だけを開始より前の時刻へ直接書き換えて、補正が効かない逆転状態を作る。
test('(I) 前半ブロックの時刻が入力済みだが逆転している(終了<開始)なら反転コピーしない', async () => {
  await openPanel();
  const ri = await addRow();
  await setTimes(ri, '19:00', '18:30'); // 終了(18:30)が開始(19:00)より前＝逆転
  await fillCell(ri, '男子', 'ラン', ['流し']);
  await fillCell(ri, '女子', '静的', ['ストレッチ']);
  const rowBefore = await readRow(ri);
  assert.equal(rowBefore.from, '19:00', '前提: 開始時刻は入力されている（未入力ではない）');
  assert.equal(rowBefore.to, '18:30', '前提: 終了時刻も入力されているが開始より前（逆転）');
  const before = await rowCount();

  await clickFlipCopy(ri);

  const after = await rowCount();
  assert.equal(after, before, '時刻が逆転している行は反転コピーしない（行数不変）');

  const msg = await rowMsgText(ri);
  assert.match(msg, /開始・終了時刻が必要/, '中断理由が押した行の近くに出る（未入力と同じ分岐だが、逆転ケースでも正しく中断する）');
  await closePanel();
});

// 【G】対象行が model 上に実在しない防御分岐（対象行がありません）。通常のUI操作では起きないが、
// model と DOM がズレた場合の安全策として実装されている分岐を、実際にそのズレを作って固定する。
// DOM側の行（ボタン・メッセージの入れ物）自体は残っているため、メッセージは押した行の近くに出る。
test('(G) 対象行が model 上に無い防御分岐: 中断理由「対象の行が見つかりません」が押した行の近くに出る', async () => {
  await openPanel();
  const ri = await addRow();
  await setTimes(ri, '22:00', '22:10');
  await fillCell(ri, '男子', 'アップ', ['ジョグ']);
  await fillCell(ri, '女子', 'シュート', ['フリースロー']);

  // 反転コピーの実処理（flipCopyRow）が参照する model.rows だけを、DOM を再描画せずに空にする
  // （model と、既に画面に出ている反転コピーボタンの data-ri が指す行がズレた状態を作る）。
  await page.evaluate(() => { window.__bcsEditor.model().rows.length = 0; });

  await page.click(`.ed-panel .ed-row[data-ri="${ri}"] [data-act="flip-copy"]`);
  await page.waitForTimeout(80);

  const msg = await rowMsgText(ri);
  assert.match(msg, /対象の行が見つかりませんでした/, '中断理由「対象の行が見つからない」が、押した行のDOMが残っている限りその行の近くに出る');
  await closePanel();
});

// 【H】行メッセージの入れ物自体がDOM上に無い防御時は、文言を取りこぼさず画面上部の共有欄(#ed-msg)へ
// フォールバックする（flashRow のフォールバック経路そのものを固定する）。
test('(H) 行メッセージの入れ物がDOM上に見つからない防御時: 共有欄(#ed-msg)へフォールバックし、文言を取りこぼさない', async () => {
  await openPanel();
  const ri = await addRow();
  await setTimes(ri, '23:00', '23:10'); // 中身は入れないので B2（元になる中身がない）の分岐を使う

  // 行メッセージの入れ物だけを取り除く（対象行のDOM・ボタン自体は残す＝入れ物が無い状況の再現）。
  await page.evaluate((r) => {
    const el = document.querySelector(`.ed-panel .ed-row[data-ri="${r}"] .ed-row-msg`);
    if (el) el.remove();
  }, ri);
  await page.evaluate(() => { const el = document.getElementById('ed-msg'); if (el) el.textContent = ''; });

  await clickFlipCopy(ri);

  const sharedMsg = await page.locator('#ed-msg').textContent();
  assert.match(sharedMsg, /元になる中身がありません/, '行メッセージの入れ物が見つからない防御時は、文言を取りこぼさず共有欄(#ed-msg)へフォールバックする');
  await closePanel();
});
