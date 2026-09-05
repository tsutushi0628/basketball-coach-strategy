/**
 * @file 名簿シート取得（Google Sheets values.get・ADC 経由・spec §3）。
 *
 * 本番: `GoogleAuth`（google-auth-library・既存サービスアカウントの ADC）で
 * `spreadsheets.readonly` スコープを解決し、`getAccessToken()` の Bearer で
 * `https://sheets.googleapis.com/v4/spreadsheets/{sheetId}/values/A1:Z300` を fetch する。
 * 先頭シートを読む（範囲にシート名を付けない）。googleapis は使わない（直接 fetch）。
 *
 * エミュレータ（IS_EMULATOR）: ADC が無いので `ROSTER_FIXTURE_PATH`（既定
 * `functions/fixtures/roster-synthetic.json`）の JSON（`values` 応答と同形・合成名のみ）を読む。
 *
 * 取得失敗（HTTP 4xx/5xx・ネットワーク断・`values` 欠落）は原因を message に添えて throw する
 * （呼び出し側 = functions/index.mjs のハンドラが 502 に丸める）。Firestore には触れない。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { GoogleAuth } from 'google-auth-library';

const IS_EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST;
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const VALUES_RANGE = 'A1:Z300';

function defaultFixturePath() {
  const dir = dirname(fileURLToPath(import.meta.url));
  return resolve(dir, 'fixtures', 'roster-synthetic.json');
}

/**
 * エミュレータ用: fixture JSON（`{ values: string[][] }`）を読む。
 * @returns {string[][]}
 */
function readFixtureValues() {
  const path = process.env.ROSTER_FIXTURE_PATH || defaultFixturePath();
  let json;
  try {
    json = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`名簿 fixture を読めませんでした（${path}）: ${e && e.message ? e.message : String(e)}`);
  }
  if (!Array.isArray(json?.values)) {
    throw new Error(`名簿 fixture の values が配列ではありません（${path}）`);
  }
  return json.values;
}

/**
 * 名簿シートの値（ヘッダ行を含む生の2次元配列）を取得する。
 * @param {{sheetId:string}} params
 * @returns {Promise<string[][]>}
 */
export async function fetchSheetValues({ sheetId }) {
  if (!sheetId || typeof sheetId !== 'string') {
    throw new Error('fetchSheetValues: sheetId は必須です');
  }
  if (IS_EMULATOR) {
    return readFixtureValues();
  }

  const auth = new GoogleAuth({ scopes: [SHEETS_SCOPE] });
  let token;
  try {
    token = await auth.getAccessToken();
  } catch (e) {
    throw new Error(`sheetId=${sheetId}: ADC からアクセストークンを取得できませんでした（${e && e.message ? e.message : String(e)}）`);
  }
  if (!token) {
    throw new Error(`sheetId=${sheetId}: ADC からアクセストークンを取得できませんでした`);
  }

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${VALUES_RANGE}?majorDimension=ROWS`;
  let res;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch (e) {
    throw new Error(`sheetId=${sheetId}: Sheets API への接続に失敗しました（${e && e.message ? e.message : String(e)}）`);
  }
  if (!res.ok) {
    throw new Error(`sheetId=${sheetId}: Sheets API が HTTP ${res.status} を返しました`);
  }
  const body = await res.json();
  if (!Array.isArray(body?.values)) {
    throw new Error(`sheetId=${sheetId}: Sheets API 応答に values がありません`);
  }
  return body.values;
}
