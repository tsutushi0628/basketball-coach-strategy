/**
 * @file 名簿スプレッドシートのヘッダ初期化（1行目の末尾に「身長cm」「Tier」「役割」を追加）。
 *
 * spec-20260905-scrimmage-split.md 2.1章: 既存列（選手ID／表示名／性別／学年／ポジション／
 * 利き手／本人の目標／在籍状態／メモ）に「身長cm」「Tier」「役割」の3列を足す。列順に依存せず
 * ヘッダ行の列名で引く実装（engine/src/roster.js）なので、末尾に追記するだけで安全に足せる。
 *
 * 既存セルは一切変更しない: 1行目の「既存の列数より後ろ」の3セルだけを values.update で書く
 * （values.append は行を丸ごと追記する用途で目的が違うため使わない。範囲を狭く指定した update
 * なら既存セル・他の行には触れない）。
 *
 * 冪等性: 既に3列とも存在する場合は書き込まず「既存」と報告して終える（再実行で重複追加しない）。
 *
 * 認証: GoogleAuth（google-auth-library・ADC）で `https://www.googleapis.com/auth/spreadsheets`
 * スコープを要求する。ADC が `cloud-platform` 等の別スコープしか持たない場合は
 * `gcloud auth application-default login --scopes=https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/spreadsheets`
 * の再ログインが要る（本スクリプトはログインを代行しない＝ACCESS_TOKEN_SCOPE_INSUFFICIENT を
 * そのまま表示して止まる）。
 *
 * 実スプシIDはこのファイルに書かない。呼び出し時に `--sheet` 引数で渡す。
 *
 * 使い方: node scripts/roster-sheet-init.mjs --sheet <スプレッドシートID>
 */

import { GoogleAuth } from 'google-auth-library';

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const NEW_COLUMNS = ['身長cm', 'Tier', '役割'];

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--sheet') out.sheet = argv[++i];
  }
  return out;
}

/** 1始まりの列インデックスを A1 記法の列文字へ変換する（27→AA 等）。 */
function colLetter(n) {
  let s = '';
  let x = n;
  while (x > 0) {
    const rem = (x - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

async function main() {
  const { sheet: sheetId } = parseArgs(process.argv.slice(2));
  if (!sheetId) {
    console.error('USAGE: node scripts/roster-sheet-init.mjs --sheet <spreadsheetId>');
    process.exit(1);
  }

  const auth = new GoogleAuth({ scopes: [SCOPE] });
  let token;
  try {
    token = await auth.getAccessToken();
  } catch (e) {
    console.error('ROSTER-SHEET-INIT FAIL: ADC からアクセストークンを取得できませんでした:', e && e.message ? e.message : e);
    process.exit(1);
  }
  if (!token) {
    console.error('ROSTER-SHEET-INIT FAIL: ADC からアクセストークンを取得できませんでした');
    process.exit(1);
  }

  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}`;
  const headers = { Authorization: `Bearer ${token}` };

  // 1行目（ヘッダ行）だけを読む。
  const getRes = await fetch(`${base}/values/1:1`, { headers });
  const getJson = await getRes.json();
  if (!getRes.ok) {
    console.error(`ROSTER-SHEET-INIT FAIL: ヘッダ読み取りに失敗（HTTP ${getRes.status}）:`, JSON.stringify(getJson));
    if (getJson?.error?.status === 'PERMISSION_DENIED' && getJson?.error?.details?.some((d) => d.reason === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT')) {
      console.error('  ADC に spreadsheets スコープが無い可能性。以下で再ログインしてから再実行してください:');
      console.error('  gcloud auth application-default login --scopes=https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/spreadsheets');
    }
    process.exit(1);
  }
  const header = (getJson.values && getJson.values[0]) || [];
  console.log('ROSTER-SHEET-INIT: 追加前のヘッダ =', JSON.stringify(header));

  const missing = NEW_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length === 0) {
    console.log('ROSTER-SHEET-INIT OK: 3列とも既に存在（変更なし）');
    return;
  }

  const startCol = header.length + 1;
  const endCol = header.length + missing.length;
  const range = `${colLetter(startCol)}1:${colLetter(endCol)}1`;

  const putRes = await fetch(`${base}/values/${range}?valueInputOption=RAW`, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ range, majorDimension: 'ROWS', values: [missing] }),
  });
  const putJson = await putRes.json();
  if (!putRes.ok) {
    console.error(`ROSTER-SHEET-INIT FAIL: ヘッダ追記に失敗（HTTP ${putRes.status}）:`, JSON.stringify(putJson));
    process.exit(1);
  }

  const verifyRes = await fetch(`${base}/values/1:1`, { headers });
  const verifyJson = await verifyRes.json();
  const afterHeader = (verifyJson.values && verifyJson.values[0]) || [];
  console.log('ROSTER-SHEET-INIT OK: 追加後のヘッダ =', JSON.stringify(afterHeader));
}

main().catch((e) => {
  console.error('ROSTER-SHEET-INIT FAIL:', e && e.stack ? e.stack : e);
  process.exit(1);
});
