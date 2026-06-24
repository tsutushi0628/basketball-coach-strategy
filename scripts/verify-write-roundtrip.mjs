/**
 * @file 書き込み経路の往復検証（編集→保存→reload でサーバ再描画にコーチ上書きが出る）。
 *
 * 既存の fetch-0623.mjs は「seed 済みデータの読み」しか確認しない。本スクリプトは
 * 実際の保存API（POST /api/override）を Hosting 経由で叩き、Firestore へ書いた上書きが
 * 次の GET（サーバ再描画）に反映されることを実機で確認する＝引継書の唯一の未検証層。
 *
 * 検証する業務意図（すべて Hosting → Function → Firestore の実経路）:
 *   ① 保存: POST /api/override が 200 / ok:true を返す（コーチが画面で保存できる）。
 *   ② 反映: 直後の GET /?p=timeline の HTML に保存した上書き内容（マーカー）が出る。
 *   ③ 上書き: seed 済み 06/23 の固有ねらい文が、保存後に消える（追記でなく置換）。
 *   ④ 復元: POST /api/override/delete 後の GET でマーカーが消え自動生成に戻る。
 *
 * emulators:exec は exit code を握りうるため、PASS/FAIL を stdout に明示し FAIL 時 exit 1。
 * 呼び出し側は本文の "WRITE-ROUNDTRIP PASS" / "WRITE-ROUNDTRIP FAIL" で判定すること。
 */

const HOST = process.env.HOSTING_HOST || 'http://127.0.0.1:8088';
const FN_BASE = process.env.FN_BASE
  || 'http://127.0.0.1:5021/demo-basketball-strategy/asia-northeast1/render';
const PAGE = `${HOST}/?p=timeline`;
const API = `${HOST}/api/override`;
const API_DELETE = `${HOST}/api/override/delete`;

// テスト対象日（現在週にレンダされる火曜＝seed 済み 06/23 上書きがある日）。
const TARGET_DATE = '2026-06-23';
// 通常コンテンツと衝突しない一意マーカー。保存した自分の上書きが描画に出たかの目印。
const MARK = 'RTMARK7K3';
// seed 済み 06/23 上書きの固有ねらい文（保存後に消えれば「追記でなく置換」を実証）。
const SEEDED_AIM = '既存の練習を正しく整理して、より上手くなれるようにする';

const overrideBody = {
  date: TARGET_DATE,
  weekday: '火',
  layout: 'two-col',
  court: `往復検証コート ${MARK}`,
  // title は two-col では描画されない（保存スキーマ受理の確認用）。②反映の判定は
  // 実際に描画される court/aim/label/item name に乗った MARK で行う。
  title: `往復検証タイトル ${MARK}`,
  aim: `往復検証ねらい ${MARK}`,
  rows: [
    {
      from: '16:00', to: '16:30', minutes: 30,
      '男子': { block: '対人', label: `男子ラベル ${MARK}`, items: [{ name: `男子ドリル ${MARK}`, note: 'roundtrip' }] },
      '女子': { block: 'ラン', label: `女子ラベル ${MARK}`, items: [{ name: `女子ドリル ${MARK}` }] },
    },
  ],
};

async function getUntilReady(url, tries = 40, waitMs = 3000) {
  let last = { status: 0, text: '' };
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      const text = await res.text();
      last = { status: res.status, text };
      if (res.status === 200) return last;
      console.log(`  warming… try ${i + 1}/${tries} status=${res.status}`);
    } catch (e) {
      console.log(`  warming… try ${i + 1}/${tries} err=${e && e.message ? e.message : e}`);
    }
    await new Promise((r) => setTimeout(r, waitMs));
  }
  return last;
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let json = null;
  const text = await res.text();
  try { json = JSON.parse(text); } catch { /* 非JSON応答はそのまま下で扱う */ }
  return { status: res.status, json, text };
}

async function getPage() {
  const res = await fetch(PAGE);
  return { status: res.status, text: await res.text() };
}

async function main() {
  const checks = [];
  const ok = (label, cond, extra = '') => {
    checks.push(cond);
    console.log(`  [${cond ? 'OK' : 'NG'}] ${label}${extra ? ` — ${extra}` : ''}`);
  };

  // 0) Function ウォームアップ（初回 worker ロードは数十秒かかりうる）。
  console.log(`WARM GET ${FN_BASE}/healthz`);
  const warm = await getUntilReady(`${FN_BASE}/healthz`);
  console.log(`WARM status=${warm.status}`);
  if (warm.status !== 200) {
    console.log('WRITE-ROUNDTRIP FAIL: Function が起動しない（/healthz 非200）');
    process.exit(1);
  }

  // 1) ベースライン: seed 済み 06/23 がページに出ているか（テスト対象日がレンダ対象である確認）。
  console.log(`BASELINE GET ${PAGE}`);
  const base = await getUntilReady(PAGE);
  console.log(`BASELINE status=${base.status} bytes=${base.text.length}`);
  const baseHadSeededAim = base.text.includes(SEEDED_AIM);
  const baseHadMark = base.text.includes(MARK);
  console.log(`  baseline: seededAim=${baseHadSeededAim} mark=${baseHadMark}`);
  ok('対象日がレンダ対象（baseline 非200でない）', base.status === 200);
  ok('保存前はマーカー未出現（前提クリーン）', !baseHadMark);
  // ③置換判定の前提を硬いチェックに格上げ。seed の aim 文言が overrides.json でずれると
  // ここが NG になり、置換検証が無言で消えたまま PASS する事故（カバレッジ痩せ）を防ぐ。
  ok('baseline に seed済みねらいが描画されている（③の前提・seed整合）', baseHadSeededAim);

  // 2) 保存: 実際の保存API（Hosting 経由）に POST。
  console.log(`SAVE POST ${API}`);
  const save = await postJson(API, overrideBody);
  console.log(`  save status=${save.status} body=${save.text.slice(0, 200)}`);
  ok('保存API 200', save.status === 200);
  ok('保存API ok:true', !!(save.json && save.json.ok === true));
  ok('保存API が正規化後の上書きを返す（date 一致）',
    !!(save.json && save.json.override && save.json.override.date === TARGET_DATE));

  // 3) 反映: 直後の GET にマーカーが出る＝保存→Firestore→reload 往復。
  const after = await getPage();
  const afterHasMark = after.text.includes(MARK);
  const afterHasSeededAim = after.text.includes(SEEDED_AIM);
  console.log(`AFTER-SAVE status=${after.status} mark=${afterHasMark} seededAim=${afterHasSeededAim}`);
  ok('保存した上書きが再描画に出る（マーカー出現）', after.status === 200 && afterHasMark);
  // 置換（追記でない）を無条件で判定する。前提（baseHadSeededAim）は上で硬くチェック済み。
  ok('seed 済みねらいが消える（追記でなく置換）', !afterHasSeededAim);

  // 4) 復元: 削除APIでマーカーが消え自動生成へ戻る。
  console.log(`REVERT POST ${API_DELETE}`);
  const del = await postJson(API_DELETE, { date: TARGET_DATE });
  console.log(`  delete status=${del.status} body=${del.text.slice(0, 200)}`);
  ok('削除API 200 / ok:true', del.status === 200 && !!(del.json && del.json.ok === true));
  const reverted = await getPage();
  const revertedHasMark = reverted.text.includes(MARK);
  console.log(`AFTER-REVERT status=${reverted.status} mark=${revertedHasMark}`);
  ok('削除後はマーカーが消える（自動生成へ復元）', reverted.status === 200 && !revertedHasMark);

  const allOk = checks.every(Boolean);
  if (allOk) {
    console.log('WRITE-ROUNDTRIP PASS: 保存→Firestore→reload の往復が実機で成立した');
    process.exit(0);
  }
  console.log('WRITE-ROUNDTRIP FAIL: いずれかの観点が未達（上の NG を参照）');
  console.log('----- after-save body head -----');
  console.log((typeof after !== 'undefined' ? after.text : '').slice(0, 800));
  process.exit(1);
}

main().catch((e) => {
  console.log('WRITE-ROUNDTRIP FAIL: 例外', e && e.stack ? e.stack : e);
  process.exit(1);
});
