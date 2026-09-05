/**
 * @file エミュレータ検証スクリプト（紅白戦チーム分け・Hosting→Function→Firestoreの実経路）。
 *
 * fetch-0623.mjs と同じ作法（`firebase emulators:exec` 配下で実行・PASS/FAILをstdoutに明示・
 * FAIL時はexit 1）。分担A（engine/src/scrimmage.js・roster.js）・B（functions/index.mjs・
 * roster-sheet.mjs）・C（ui/scrimmage-page.mjs）が動的importで実際に噛み合うかを、
 * エミュレータ上の実HTTPで通す（spec-20260905-scrimmage-split.md 7章・10章の統合確認）。
 *
 * 通す経路（既定テナント tenant-genchi・emulator既定のROSTER_FIXTURE_PATH=fixtures/roster-synthetic.json）:
 *   1) POST /api/roster/sync（合成名簿を同期）
 *   2) GET /scrimmage（HTMLに合成名が出る・Tier/役割/身長cm/学年の語が出ない）
 *   3) POST /api/scrimmage/split（seed固定・teamsが選手IDの配列・同seed同結果）
 *   4) POST /api/scrimmage/decide（scrimmagesに1件・選手IDのみ）
 *   5) 再 POST /api/scrimmage/split（直近履歴を渡す配線が生きている＝Firestore再読み取りが例外なく通る）
 *
 * 実行: `npm --prefix functions run build` 後に
 *   `npx -y firebase-tools@15.22.0 emulators:exec --only functions,firestore,hosting
 *     --project demo-basketball-strategy "node scripts/seed-firestore.mjs && node scripts/verify-scrimmage.mjs"`
 */

const HOST = process.env.HOSTING_HOST || 'http://127.0.0.1:8088';
const FN_BASE = process.env.FN_BASE || 'http://127.0.0.1:5021/demo-basketball-strategy/asia-northeast1/render';

async function fetchUntilReady(url, opts, tries = 40, waitMs = 3000) {
  let last = { status: 0, text: '' };
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, opts);
      const text = await res.text();
      last = { status: res.status, text };
      if (res.status < 500) return last; // 4xx/5xx以外は「起動済み」とみなす（テスト対象の応答そのもの）
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
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非JSON応答はそのまま status/text で判定 */ }
  return { status: res.status, json, text };
}

const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok, detail });
  console.log(`  [${ok ? 'OK' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

async function main() {
  console.log(`WARM GET ${FN_BASE}/healthz`);
  const warm = await fetchUntilReady(`${FN_BASE}/healthz`);
  console.log(`WARM status=${warm.status}`);

  // ── 1) 名簿同期 ──────────────────────────────────────────────────────────────
  console.log(`POST ${HOST}/api/roster/sync`);
  const sync = await postJson(`${HOST}/api/roster/sync`, { sheetId: 'x'.repeat(20) });
  check('sync: 200', sync.status === 200, `status=${sync.status} body=${sync.text.slice(0, 300)}`);
  check('sync: count>=5（fixture の在籍行数）', sync.json && sync.json.count >= 5, `count=${sync.json && sync.json.count}`);
  check('sync: skipped がフィールドとして存在', sync.json && typeof sync.json.skipped === 'number');

  // ── 2) 画面（GET /scrimmage）──────────────────────────────────────────────────
  console.log(`GET ${HOST}/scrimmage`);
  const page = await fetchUntilReady(`${HOST}/scrimmage`, undefined, 10, 1500);
  check('scrimmage page: 200', page.status === 200, `status=${page.status}`);
  const SYNTHETIC_NAMES = ['アオキ', 'イシダ', 'ウエダ', 'エガワ', 'オダギリ'];
  for (const name of SYNTHETIC_NAMES) {
    check(`scrimmage page: 合成名 "${name}" が出る`, page.text.includes(name));
  }
  // データ島（<script type="application/json" id="scrim-model">）だけを対象に、選手の実力系
  // フィールドが混入していないか確認する。HTML全体には design-system の説明コメント等で「役割」
  // という一般語が無関係な文脈（意味ロール層の解説）で出現しうるため対象を絞る（spec 8章）。
  const islandMatch = page.text.match(/<script type="application\/json" id="scrim-model">([\s\S]*?)<\/script>/);
  check('scrimmage page: データ島 script タグが存在する', !!islandMatch);
  const island = islandMatch ? islandMatch[1] : '';
  for (const term of ['tier', 'Tier', 'roles', 'heightCm', 'grade', '身長', '学年']) {
    check(`scrimmage page: データ島に "${term}" が出ない`, !island.includes(term));
  }
  check('scrimmage page: ホーム画面追加メタが出る', page.text.includes('apple-mobile-web-app-capable'));

  // ── 3) チーム分け（split）─────────────────────────────────────────────────────
  const attendees = ['M01', 'M02', 'M03'];
  console.log(`POST ${HOST}/api/scrimmage/split`);
  const split1 = await postJson(`${HOST}/api/scrimmage/split`, { gender: 'M', teamCount: 2, attendees, seed: 4242 });
  check('split: 200', split1.status === 200, `status=${split1.status} body=${split1.text.slice(0, 300)}`);
  const teams1 = split1.json && split1.json.teams;
  const flat1 = Array.isArray(teams1) ? teams1.flat().sort() : [];
  check('split: teams が attendees のちょうど分割', JSON.stringify(flat1) === JSON.stringify([...attendees].sort()), `teams=${JSON.stringify(teams1)}`);
  check('split: seed が応答にエコーされる', split1.json && split1.json.seed === 4242);

  const split2 = await postJson(`${HOST}/api/scrimmage/split`, { gender: 'M', teamCount: 2, attendees, seed: 4242 });
  check('split: 同じ seed は同じ teams（決定論）', JSON.stringify(split1.json && split1.json.teams) === JSON.stringify(split2.json && split2.json.teams));

  // ── 4) 確定（decide）─────────────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  console.log(`POST ${HOST}/api/scrimmage/decide`);
  const decide = await postJson(`${HOST}/api/scrimmage/decide`, {
    date: today, gender: 'M', teamCount: 2, attendees, teams: teams1, seed: split1.json.seed,
  });
  check('decide: 200', decide.status === 200, `status=${decide.status} body=${decide.text.slice(0, 300)}`);
  check('decide: id が date-1 形式', decide.json && decide.json.id === `${today}-1`, `id=${decide.json && decide.json.id}`);

  // ── 5) 履歴込みの再 split（配線が例外なく通ることを確認）──────────────────────────
  console.log(`POST ${HOST}/api/scrimmage/split (再実行・直近履歴あり)`);
  const split3 = await postJson(`${HOST}/api/scrimmage/split`, { gender: 'M', teamCount: 2, attendees, seed: 999 });
  check('split(履歴あり): 200（scrimmages 読み取り→history 配線が例外なく通る）', split3.status === 200, `status=${split3.status} body=${split3.text.slice(0, 300)}`);

  const failed = checks.filter((c) => !c.ok);
  if (failed.length === 0) {
    console.log(`SCRIMMAGE VERIFY PASS: ${checks.length}件すべて OK`);
    process.exit(0);
  } else {
    console.log(`SCRIMMAGE VERIFY FAIL: ${failed.length}/${checks.length}件 NG`);
    for (const f of failed) console.log(`  NG: ${f.label}${f.detail ? ` (${f.detail})` : ''}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.log('SCRIMMAGE VERIFY FAIL: 例外', e && e.stack ? e.stack : e);
  process.exit(1);
});
