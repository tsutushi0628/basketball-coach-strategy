/**
 * @file 名簿シート取得・選手IDの書き戻し（Google Sheets values API・ADC 経由・spec §3）。
 *
 * シートは「男子」「女子」の2タブで、タブ名が性別（男子→'M'・女子→'F'）を決める。
 * 性別の列は無い。ヘッダは A〜M 列（選手ID / 表示名 / 学年 / ポジション / 利き手 /
 * 在籍状態 / 身長cm / Tier / 役割1 / 役割2 / 役割3 / 本人の目標 / メモ）。Tier 列の表記は S/A/B/C/D。
 *
 * 本番: `GoogleAuth`（google-auth-library・既存サービスアカウントの ADC）で
 * `https://www.googleapis.com/auth/spreadsheets`（読み書き）スコープを解決し、
 * `getAccessToken()` の Bearer で
 *   - タブ一覧: `GET /v4/spreadsheets/{sheetId}?fields=sheets(properties(title))`
 *   - 値の取得: `GET /v4/spreadsheets/{sheetId}/values:batchGet?ranges='男子'!A1:M300&…`
 *   - 選手IDの書き戻し: `POST /v4/spreadsheets/{sheetId}/values:batchUpdate`
 * を fetch する（googleapis は使わない）。書き戻しは該当セル（選手ID列の1マス）だけを更新し、
 * 行全体は上書きしない。
 *
 * エミュレータ（IS_EMULATOR）: ADC が無いので `ROSTER_FIXTURE_PATH`（既定
 * `functions/fixtures/roster-synthetic.json`）の JSON（`{ tabs: [{ title, values }] }`・合成名のみ）を読む。
 * 書き戻しは `ROSTER_FIXTURE_WRITEBACK_PATH`（既定: `ROSTER_FIXTURE_PATH` が明示されていれば同じパス、
 * 既定 fixture のときは書かない）へ同じ形で保存する。
 *
 * 取得失敗（HTTP 4xx/5xx・ネットワーク断・`values` 欠落・両タブとも無い）は原因を message に添えて
 * throw する（呼び出し側 = functions/index.mjs のハンドラが 502 に丸める）。Firestore には触れない。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { GoogleAuth } from 'google-auth-library';

const IS_EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST;
// 選手IDの書き戻しがあるため読み取り専用スコープでは足りない。
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const VALUES_RANGE = 'A1:M300';

/** タブ名 → 性別。この2枚だけを読む（タブ名が性別の正本）。 */
export const ROSTER_TABS = [
  { title: '男子', gender: 'M' },
  { title: '女子', gender: 'F' },
];

function defaultFixturePath() {
  const dir = dirname(fileURLToPath(import.meta.url));
  return resolve(dir, 'fixtures', 'roster-synthetic.json');
}

function fixturePath() {
  return process.env.ROSTER_FIXTURE_PATH || defaultFixturePath();
}

/** エミュレータでの書き戻し先（既定 fixture のままなら null = 書かない）。 */
function fixtureWriteBackPath() {
  if (process.env.ROSTER_FIXTURE_WRITEBACK_PATH) return process.env.ROSTER_FIXTURE_WRITEBACK_PATH;
  if (process.env.ROSTER_FIXTURE_PATH) return process.env.ROSTER_FIXTURE_PATH;
  return null;
}

/**
 * エミュレータ用: fixture JSON（`{ tabs: [{ title, values }] }`）を読む。
 * @returns {Array<{gender:'M'|'F', title:string, values:string[][]}>}
 */
function readFixtureTabs() {
  const path = fixturePath();
  let json;
  try {
    json = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`名簿 fixture を読めませんでした（${path}）: ${e && e.message ? e.message : String(e)}`);
  }
  if (!Array.isArray(json?.tabs)) {
    throw new Error(`名簿 fixture の tabs が配列ではありません（${path}）`);
  }
  const out = [];
  for (const { title, gender } of ROSTER_TABS) {
    const tab = json.tabs.find((t) => t && t.title === title);
    if (!tab) continue; // 片方だけの fixture も成立させる。
    if (!Array.isArray(tab.values)) {
      throw new Error(`名簿 fixture の tabs["${title}"].values が配列ではありません（${path}）`);
    }
    out.push({ gender, title, values: tab.values });
  }
  if (out.length === 0) {
    throw new Error(`名簿 fixture に「男子」「女子」のタブがありません（${path}）`);
  }
  return out;
}

async function accessToken(sheetId) {
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
  return token;
}

/** シート名は引用符で囲む（全角名・空白混じりでも範囲式が壊れないように）。 */
function quoteTitle(title) {
  return `'${String(title).replace(/'/g, "''")}'`;
}

/**
 * 選手IDの書き戻し用 `values:batchUpdate` の data 配列を組む（純関数・テスト対象）。
 * 行指定の1セル（選手ID列）だけを更新し、行全体は触らない。
 * @param {Array<{title:string, row:number, playerId:string}>} updates
 * @param {string} [idColumn] 選手ID列の列記号（既定 'A'）。
 * @returns {Array<{range:string, values:string[][]}>}
 */
export function buildPlayerIdUpdateData(updates, idColumn = 'A') {
  return (updates ?? []).map(({ title, row, playerId }) => {
    if (!Number.isInteger(row) || row < 2) {
      throw new Error(`選手IDの書き戻し行が不正です（row=${row}）`);
    }
    return {
      range: `${quoteTitle(title)}!${idColumn}${row}`,
      values: [[String(playerId)]],
    };
  });
}

/**
 * 名簿シートの「男子」「女子」タブを読む（ヘッダ行を含む生の2次元配列をタブごとに返す）。
 * 片方のタブしか無ければ、あるタブだけで成立させる（両方無いときだけ throw）。
 * @param {{sheetId:string}} params
 * @returns {Promise<Array<{gender:'M'|'F', title:string, values:string[][]}>>}
 */
export async function fetchRosterTabs({ sheetId }) {
  if (!sheetId || typeof sheetId !== 'string') {
    throw new Error('fetchRosterTabs: sheetId は必須です');
  }
  if (IS_EMULATOR) {
    return readFixtureTabs();
  }

  const token = await accessToken(sheetId);
  const headers = { Authorization: `Bearer ${token}` };

  // 1) 実在するタブ名を先に調べる（存在しない範囲を batchGet に混ぜると全体が 400 になる）。
  const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}?fields=sheets(properties(title))`;
  let metaRes;
  try {
    metaRes = await fetch(metaUrl, { headers });
  } catch (e) {
    throw new Error(`sheetId=${sheetId}: Sheets API への接続に失敗しました（${e && e.message ? e.message : String(e)}）`);
  }
  if (!metaRes.ok) {
    throw new Error(`sheetId=${sheetId}: Sheets API（メタ情報）が HTTP ${metaRes.status} を返しました`);
  }
  const meta = await metaRes.json();
  const titles = new Set(
    (Array.isArray(meta?.sheets) ? meta.sheets : [])
      .map((s) => s?.properties?.title)
      .filter((t) => typeof t === 'string'),
  );
  const wanted = ROSTER_TABS.filter((t) => titles.has(t.title));
  if (wanted.length === 0) {
    throw new Error(`sheetId=${sheetId}: 「男子」「女子」のタブがありません`);
  }

  // 2) あるタブだけを batchGet で1回読む。
  const query = wanted
    .map((t) => `ranges=${encodeURIComponent(`${quoteTitle(t.title)}!${VALUES_RANGE}`)}`)
    .join('&');
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values:batchGet?${query}&majorDimension=ROWS`;
  let res;
  try {
    res = await fetch(url, { headers });
  } catch (e) {
    throw new Error(`sheetId=${sheetId}: Sheets API への接続に失敗しました（${e && e.message ? e.message : String(e)}）`);
  }
  if (!res.ok) {
    throw new Error(`sheetId=${sheetId}: Sheets API が HTTP ${res.status} を返しました`);
  }
  const body = await res.json();
  if (!Array.isArray(body?.valueRanges) || body.valueRanges.length !== wanted.length) {
    throw new Error(`sheetId=${sheetId}: Sheets API 応答に valueRanges がありません`);
  }
  return wanted.map((t, i) => ({
    gender: t.gender,
    title: t.title,
    values: Array.isArray(body.valueRanges[i]?.values) ? body.valueRanges[i].values : [],
  }));
}

/**
 * 自動付与した選手IDをシートの選手ID列（A列）へ書き戻す。
 * 更新は行ごとの1セルだけ（行全体は上書きしない）。失敗は throw する。
 * @param {{sheetId:string, updates:Array<{title:string, row:number, playerId:string}>}} params
 * @returns {Promise<number>} 書き戻したセル数
 */
export async function writeBackPlayerIds({ sheetId, updates }) {
  if (!sheetId || typeof sheetId !== 'string') {
    throw new Error('writeBackPlayerIds: sheetId は必須です');
  }
  const data = buildPlayerIdUpdateData(updates);
  if (data.length === 0) return 0;

  if (IS_EMULATOR) {
    const path = fixtureWriteBackPath();
    if (!path) return 0; // 既定 fixture（リポジトリ同梱）は書き換えない。
    let json;
    try {
      json = JSON.parse(readFileSync(fixturePath(), 'utf8'));
    } catch (e) {
      throw new Error(`名簿 fixture を読めませんでした（書き戻し・${fixturePath()}）: ${e && e.message ? e.message : String(e)}`);
    }
    for (const u of updates) {
      const tab = (json.tabs ?? []).find((t) => t && t.title === u.title);
      if (!tab || !Array.isArray(tab.values)) continue;
      const row = tab.values[u.row - 1];
      if (!Array.isArray(row)) continue;
      row[0] = u.playerId;
    }
    try {
      writeFileSync(path, JSON.stringify(json, null, 2), 'utf8');
    } catch (e) {
      throw new Error(`名簿 fixture へ選手IDを書き戻せませんでした（${path}）: ${e && e.message ? e.message : String(e)}`);
    }
    return data.length;
  }

  const token = await accessToken(sheetId);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values:batchUpdate`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ valueInputOption: 'RAW', data }),
    });
  } catch (e) {
    throw new Error(`sheetId=${sheetId}: Sheets API への接続に失敗しました（選手IDの書き戻し・${e && e.message ? e.message : String(e)}）`);
  }
  if (!res.ok) {
    throw new Error(`sheetId=${sheetId}: Sheets API が HTTP ${res.status} を返しました（選手IDの書き戻し）`);
  }
  return data.length;
}
