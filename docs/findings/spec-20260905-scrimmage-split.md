# spec: 紅白戦チーム分けのデータ・同期・エンジン・API設計（2026-09-05）

> type=spec。対象リポジトリ = basketball-coach-strategy（バスケ練習計画Webツール）。
> 実装者向けの変更点の単一真実源。行番号は 2026-09-05 時点の main。
> 面の見た目は `docs/findings/design-20260905-scrimmage-split-mock.html` が正本で、本書は面の一覧と操作だけを書く。モックの「入口: 日ビューの道具列」と「面2b 入れ替え中」は本書の 6 章で廃止した。
> 土台は `docs/specs/multitenant/design.md`（tenants/{tid} 配下・全 deny rules・Functions 経由）と `engine/DESIGN.md`（外部依存ゼロ・node:test）。
> 改訂: 2026-09-05 外部レビュー反映（蛇行初期解を人数規則に一致させる、同期の batch 上限ガード、10 章の実装契約を追加）。

## 1. 目的と対象

コーチがスマホで独立URL `/scrimmage`（アプリ名「チーム分け」）を開き、その日の出席者を男女別に2〜3チームへ分け、結果を選手名だけで子に見せる。
練習計画の画面は変更せず、認証・テナント解決・Firestore・名簿シートだけを共有する（別 Firebase プロジェクトにしない）。
名簿の正本は Google スプレッドシート「バスケ_選手名簿」で、アプリは同期した写し（Firestore）だけを読む。
分け方は `engine/src/scrimmage.js` の純関数が決め、同じ入力と同じ seed なら同じ出力を返す。
Tier・役割・身長・平均・警告・評価は、画面にもHTMLのデータ島にも出さない。

## 2. データ

### 2.1 スプレッドシートの列

既存列は 選手ID／表示名／性別／学年／ポジション／利き手／本人の目標／在籍状態／メモ。ここに 身長cm／Tier／役割 の3列を足す。
読むのは 選手ID・表示名・性別・学年・在籍状態・身長cm・Tier・役割 の8列で、ヘッダ行（1行目）の列名で引く（列順に依存しない）。
ポジション・利き手・本人の目標・メモは読まず、Firestore にも置かない。
正規化は `engine/src/roster.js`（新規・純関数 `normalizeRoster(values)`）に閉じる。

| 列 | 規則 | 不正時 |
|---|---|---|
| 選手ID | `^[MF]\d{2}$` | 行を取り込まず `skipped` に数える |
| 表示名 | trim・1〜30文字 | 空なら行を取り込まず `skipped` |
| 性別 | 先頭1文字が「男」→ `M`、「女」→ `F` | 行を取り込まず `skipped`（性別が無いと出席一覧に出せない） |
| 学年 | 整数 1〜3 | 1 に補完し `missing` に `grade` |
| 在籍状態 | 「在籍」を含めば `active:true`、それ以外は `false` | 空は `false` |
| 身長cm | 整数 100〜220 | 同性別の有効値の中央値（偶数個は小さい側）に補完し `missing` に `heightCm`。有効値0件なら 160 |
| Tier | 整数 1〜5 | 3 に補完し `missing` に `tier` |
| 役割 | 2.2 の語彙 | 有効語0件なら `missing` に `roles`（`roles:[]`） |

役割セルは、半角カンマ・全角カンマ（，）・読点（、）・改行・半角空白・全角空白のいずれかで分割し、各語を trim して語彙表で引く。
未知語は捨てる（`missing` には数えない）。重複語は1つにする。

### 2.2 役割の語彙と3群

語彙表は `engine/src/scrimmage.js` が `ROLE_GROUPS` として持ち、`roster.js` はそれを import する（語彙の正本は1箇所）。

- 創造 `creation`：ハンドラー `handler`、パサー `passer`
- 得点手段 `scoring`：シューター `shooter`、スラッシャー `slasher`、リムアタッカー `rimAttacker`
- 守備 `defense`：エリートディフェンダー `eliteDefender`、リムプロテクター `rimProtector`、リバウンダー `rebounder`

### 2.3 Firestore

- `tenants/{tid}` に3フィールドを足す：`rosterSheetId`（string）、`rosterSyncedAt`（Timestamp）、`rosterSkipped`（number）。
- `tenants/{tid}/roster/{playerId}`：`{ playerId, name, gender:'M'|'F', grade, active, heightCm, tier, roles:string[], missing:string[], syncedAt }`。`name` は表示名をそのまま置く。同期はコレクション全体をシートの内容に揃える（シートから消えた選手は削除する）。
- `tenants/{tid}/scrimmages/{YYYY-MM-DD-n}`：`{ date, gender, teamCount, attendees:string[], teams:string[][], seed:number, createdAt, createdBy }`。`n` は同日内の連番（1始まり・サーバ採番）。選手IDだけを置き、名前は置かない。
- `firestore.indexes.json` に `scrimmages` の複合インデックス（`gender` asc・`createdAt` desc）を足す。履歴は gender で絞って直近3件を読む。

実名の線引き：実名が置かれるのは本番 Firestore の `roster/{playerId}.name` だけ。`scripts/seed-firestore.mjs`、テストの fixture、`functions/fixtures/`、`.emulator-data/` の退避には合成名（モックの「アオキ」「イシダ」等）と合成IDしか置かない。`.emulator-data/` は gitignored 済み。

## 3. 同期

- オーナー作業（1行）：スプレッドシートの共有に、Functions の実行サービスアカウント（GCP コンソールの IAM で「Default compute service account」と表示されるアドレス）を閲覧者で追加する。
- `functions/package.json` の dependencies に `google-auth-library` を明記する（firebase-admin の推移依存として `functions/node_modules` に 10.7.0 が既にあるが、直接使う依存は直接書く）。`googleapis` は足さない。
- `functions/roster-sheet.mjs`（新規）：`new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] })` で ADC を解決し、`getAccessToken()` の Bearer で `https://sheets.googleapis.com/v4/spreadsheets/{sheetId}/values/A1:Z300?majorDimension=ROWS` を `fetch` する。先頭シートを読む（範囲にシート名を付けない）。応答の `values` を `normalizeRoster` に渡す。
- 取得失敗（HTTP 4xx/5xx・ネットワーク断・`values` 欠落）は原因（HTTP 状態・sheetId の有無）を message に添えて throw し、ハンドラが 502 を返す。Firestore は触らない。
- 書き込みの上限ガード：既存 `roster` を読み、set（追加・更新）と delete の件数を先に数える。合計が 499（tenant doc の merge 1件を含めて batched write 上限 500）を超えるなら書き込まずに 422 `{ ok:false, error:'名簿の変更が500件を超えています' }` で終える。上限内なら1つの batch で書く。
- エミュレータ（`IS_EMULATOR`）では ADC が無いので、環境変数 `ROSTER_FIXTURE_PATH` の JSON（`values` 応答と同形・合成名）を読む。既定は `functions/fixtures/roster-synthetic.json`。
- 失敗時の見え方：分割は常に Firestore の `roster` を読み、Sheets を都度読まない。同期が失敗しても前回同期の名簿で分割は動き、面3は前回の `rosterSyncedAt` を出したまま失敗の一文を出す。

## 4. エンジン `engine/src/scrimmage.js`

外部依存ゼロ・ESM・純関数。`Math.random` と `Date` を使わない。関数の形は 10 章 A。

### 4.1 入力と人数

入力はまず `attendees` を id 昇順にソートし、`roster` に無い id・重複 id・`teamCount` が 2 と 3 以外・出席者が `teamCount` 未満なら throw する。
人数は `teamSizes(n, teamCount)` が決める。`teamCount` で割り、余りは A から順に1人ずつ足す（13人3チームは 5・4・4、5人3チームは 2・2・1）。

### 4.2 実力と目的関数

実力 `s = tier + 0.5 × (grade − 1)`。上限は置かない。

```
J = 100·ΔS + 40·R + 2·ΔH + 5·G + 1·P
```

| 項 | 定義 |
|---|---|
| ΔS | チーム別の実力合計の最大 − 最小 |
| R | 役割群の欠けの総数。各チームで、`handler` 保持者が0なら +1、`shooter` 保持者が0なら +1、リム守備（`rimProtector` 保持者、または出席者の身長上位 `teamCount` 名のいずれか）が0なら +1 |
| ΔH | チーム別の身長平均（cm）の最大 − 最小 |
| G | 学年散らし。3年生の人数の最大 − 最小 が 1 を超えた分 と、2年生で同じ計算 の和 |
| P | 過去3回で同チームだったペアの延べ数。いまのチーム内の各ペアについて、`history` の各回で同じチームに居た回数を足す |

重みは「実力差 0.5（Tier の半分）= 50 > 役割欠け1つ = 40 > 身長差 10cm = 20 > 学年1人超過 = 5 > 過去ペア1件 = 1」の序列で置いた。
身長上位 `teamCount` 名は、身長降順（同値は id 昇順）の先頭 `teamCount` 人で、出席者の中から取る。

### 4.3 解法

1. 出席者を実力降順（同点は id 昇順）に並べ、蛇行（A B C C B A A B C …）で配る。`teamSizes` の目標人数に達したチームは候補から除外して蛇行を続ける（5人3チームなら A B C C B で 2・2・1）。
2. PRNG で出席者数と同じ回数だけ、異なるチームの2人をランダムに選んで交換する（初期解の摂動。seed が結果に効くのはここと 3 の候補順）。人数は変わらない。
3. 局所探索。異なるチームの全2人組を PRNG で並べ替えた順に試し、交換で J が下がるなら採用する。1周で改善が無ければ停止。上限 200 周。
4. `teams` の各配列を id 昇順に整えて返す（表示順の決定論）。

PRNG は mulberry32（同ファイル内に定義・seed は `>>> 0` で uint32 に丸める）。「もう一回」はクライアントが `seed + 1` を送る。

## 5. API

`functions/index.mjs` の `mountWriteApi`（`:316`）へ3本足す。作法は `/api/tenant/goal`（`:534-561`）と同型で、`resolveRequestTenant(dbInstance, req, { forWrite: true })` → `kind` 分岐（auth 401・none 403・choose 400・例外 500）→ 純判定関数（10 章 B）→ Firestore。

| 経路 | 認可 | 入力 | 応答 |
|---|---|---|---|
| `POST /api/scrimmage/split` | `ctx.role === 'owner'` | `{ gender:'M'\|'F', teamCount:2\|3, attendees:string[], seed?:number }` | `{ ok, seed, teams:string[][] }` |
| `POST /api/scrimmage/decide` | owner | `{ date:'YYYY-MM-DD', gender, teamCount, attendees, teams, seed }` | `{ ok, id }`（`YYYY-MM-DD-n`） |
| `POST /api/roster/sync` | `ctx.isAdmin === true` | `{ sheetId?:string }` | `{ ok, syncedAt, count, skipped, missing:[{playerId,name,count}] }` |

- split は `tenants/{tid}/roster` から `gender` 一致かつ `active:true` の選手を読み、`attendees` がその部分集合でなければ 400。`seed` 省略時はサーバが `Date.now() >>> 0` で決めて応答に返す（「もう一回」はこの seed をクライアントが持ち回る）。履歴は `scrimmages` を `gender` で絞り `createdAt` 降順3件。
- decide は `teams` が `attendees` の分割（全員がちょうど1回）であることと、各要素が同性別の在籍選手であることを検証し、違えば 400。`n` は同日・同 tenant の件数 + 1 を `runTransaction` で採番する。
- sync は `sheetId` が `^[A-Za-z0-9_-]{20,}$` のときだけ `tenants/{tid}.rosterSheetId` を更新してから読む。`sheetId` 省略時は保存済みを使い、未設定なら 400。Sheets 取得失敗は 502 `{ ok:false, error:'名簿シートを読めませんでした' }`、変更件数超過は 3 章の 422。書き込みは `roster` の差分 set/delete と `rosterSyncedAt`・`rosterSkipped` の merge を1つの batch で行う。
- エラー本文は既存と同じ `{ ok:false, error }`。400 の文言は入力名を含める（`attendees が不正です` など）。500 は `'save failed'`。

## 6. 画面

面の見た目と部品はモックが正本。操作語彙は `docs/design-system/component-spec.md` の「状態ピル」「主の操作」「副の操作」「下線の付いた文字」に揃える。

- 入口：独立URL `/scrimmage` をスマホのホーム画面に追加して直接開く。練習計画の画面（`ui/pattern-timeline.mjs`・道具列）は変更しない。ホーム画面追加用に `<meta name="viewport">`、`apple-mobile-web-app-capable`、`apple-mobile-web-app-title`（「チーム分け」）、`theme-color` を `/scrimmage` の head に出す（manifest・Service Worker は持たない）。
- 面の配信：`server.get('/scrimmage')` を `/onboarding`（`:578`）と `GET '*'`（`:591`）の間に置き、`resolveRequestTenant(db, req, { forWrite:false })` の `kind` 分岐（auth→/login、none→/onboarding、choose→選択画面）を `GET '*'` と同じにする。`buildPlanData` は呼ばず、10 章 B の model を組んで `renderScrimmagePage(model)` に渡す。Tier・役割・身長・学年は model に載せない。
- ヘッダ：アプリ名「チーム分け」、男子／女子の状態ピル、`isAdmin` のときだけ右端に下線の文字「名簿」（面3へ）。
- 面1 出欠とチーム数：在籍中を全員チェック済みで並べたチェック行（入力部品）、チーム数 2／3 の状態ピル、人数と割り方の一文、主の操作「分ける」。
- 面2 結果：A／B／C の状態ピル（人数付き）、そのチームの名前の縦一列、副の操作「もう一回」（`seed + 1` で split）と主の操作「この分けで決める」（`decide`）。`decide` は「分ける」「もう一回」の直後には呼ばない（呼ぶと試行のたびに履歴が増え、過去3回の罰点が試行で汚れる）。
- 面3 名簿同期：ヘッダの「名簿」から開く。最終同期時刻、未入力がある子の一覧（選手ID・名前・「未入力 n列」）、下線の文字「名簿シートを開く」（`https://docs.google.com/spreadsheets/d/{rosterSheetId}`）、主の操作「名簿を同期」。

## 7. テスト

- `engine/test/scrimmage.test.js`（node:test・合成名簿）：同じ入力と seed で `teams` が一致する／seed を変えると異なる分けが出る入力例が1つ以上ある／`n = teamCount〜20` の全人数と `teamCount = 2, 3` の全組合せで `splitTeams` の人数配分が `teamSizes` と一致する／`scoreTeams` の各項を、意図した欠け（handler 0人のチーム）を持つ手組みの teams で検証する／`history` に同チームペアを置くと P が増え J が上がる／不正入力（未知 id・重複・人数不足）で throw する。
- `engine/test/roster.test.js`：役割セルの区切り6種と未知語・重複、Tier 範囲外→3、身長欠損→同性別中央値、性別欠落→skipped、`missing` の列名。fixture は合成名。
- `functions/scrimmage-api.test.mjs`：`tenant-theme-api.test.mjs` と同じくモック db で `mountWriteApi` を実HTTPで叩く。owner でない 403、`attendees` 越境 400、decide の分割検証 400、採番 `-1`・`-2`、sync の isAdmin 403 と `sheetId` 書式 400、差分 500 超で 422 かつ `roster` 不変。
- E2E：`e2e/` の作法（Playwright・PASS/FAIL 配列・証跡は `e2e/evidence/`）で、エミュレータ起動後に `/scrimmage` を開き、面1→分ける→面2→もう一回→決める の通し、面2の DOM テキストに数値（Tier・身長）が含まれないこと、`/scrimmage` の head にホーム画面追加用メタがあることを実測する。練習計画の既存 E2E（`ui/toolbar-reorg.test.mjs` を含む）は変更せずそのまま通す。

## 8. 受け入れ条件

- 同じ `roster`・`attendees`・`teamCount`・`history`・`seed` で `splitTeams` が同じ `teams` を返す。
- 13人・3チームで 5・4・4、13人・2チームで 7・6、5人・3チームで 2・2・1 になる。
- 実力合計差が 0.5 縮む交換は、役割欠けが1つ増えても採用される（100·0.5 = 50 > 40）。
- 過去3回同チームだったペアを含む分けは、それ以外が同点なら選ばれない。
- 面2の HTML と データ島に Tier・役割・身長・学年・平均・警告・評価が含まれない。
- 当日欠席をチェックで外した選手が `teams` に現れない。
- 「もう一回」は `seed + 1` を送り、応答の `seed` が +1 されている。
- 履歴には「この分けで決める」を押した分けだけが保存される。
- 練習計画の既存画面の DOM と E2E に差分が出ない（`ui/pattern-timeline.mjs` と `ui/styles/` は無変更）。
- 名簿同期は管理者以外が 403、Sheets 失敗時は 502、差分 500 超は 422 で、いずれも `roster` が前回のまま残る。
- 同期後の `roster` に 利き手・本人の目標・メモ・ポジション が無い。
- seed・fixture・エミュレータ退避に実名が無い。
- `node --test engine functions` が通り、E2E の通しが PASS する。

## 9. やらないこと

- スプレッドシートへの書き戻し（欠席・チーム分け結果をシートに戻さない）。
- 名簿編集画面（名簿の直しはシート側で行う）。
- OAuth（コーチ個人の Google 認可）。ADC とサービスアカウント共有だけ。
- ウェブ公開CSV での読み取り。
- 学年による実力の上限、上級生の散らしを禁止事項にすること（いずれも重み付き罰点で扱う）。
- 1人入れ替え（相手を選んで交換する操作。「もう一回」だけで足りる）。
- 面の見た目の記述（モック承認後に本書へ追記する）。

## 10. 実装契約（3分担の境界）

依存の向きは C → なし、B → A と C、A → なし。A と C は firebase-admin・express を import しない。

### A. `engine/src/scrimmage.js`・`engine/src/roster.js`

- `splitTeams({ roster, attendees, teamCount, history, seed }) → { teams: string[][], seed: number }`。`teams[0]` が A。
- `roster: Array<{ id:string, grade:1|2|3, tier:number, heightCm:number, roles:string[] }>`（性別で絞った後。`name` は不要）、`attendees: string[]`、`teamCount: 2|3`、`history: string[][][]`（新しい順・最大3件・空配列可）、`seed: number`。
- `scoreTeams({ roster, teams, history }) → number`（J）。`teamSizes(n, teamCount) → number[]`。`ROLE_GROUPS: { creation:string[], scoring:string[], defense:string[] }`。
- `normalizeRoster(values: string[][]) → { players: Array<{ playerId, name, gender:'M'|'F', grade, active, heightCm, tier, roles, missing:string[] }>, skipped: number }`（`values[0]` がヘッダ行）。
- 不正入力はすべて throw（戻り値で握らない）。

### B. `functions/index.mjs`・`functions/roster-sheet.mjs`

- ルート：`GET /scrimmage`、`POST /api/scrimmage/split`、`POST /api/scrimmage/decide`、`POST /api/roster/sync`（入出力は 5 章の表）。
- 純判定 export：`scrimmageSplitDecision(ctx, body)`、`scrimmageDecideDecision(ctx, body)`、`rosterSyncDecision(ctx, body)`。戻りは `{ ok:true, ...正規化済み入力 } | { ok:false, status, error }`。
- `fetchSheetValues({ sheetId }) → Promise<string[][]>`（`roster-sheet.mjs`。エミュレータでは fixture）。
- Firestore パス：`tenants/{tid}`（`rosterSheetId`・`rosterSyncedAt`・`rosterSkipped`）、`tenants/{tid}/roster/{playerId}`、`tenants/{tid}/scrimmages/{YYYY-MM-DD-n}`。
- `GET /scrimmage` が C へ渡す `model`：`{ school:string, isAdmin:boolean, themeKey:string, tenantId:string, players: Array<{ playerId, name, gender:'M'|'F', active:boolean }>, sync: { syncedAt:string|null, sheetUrl:string|null, missing: Array<{ playerId, name, count:number }> } | null }`。`sync` は `isAdmin` のときだけ組み、それ以外は `null`。

### C. `ui/scrimmage-page.mjs`

- `export function renderScrimmagePage(model) → string`（完全な HTML。`renderPage`（`ui/render-shared.mjs`）を使い、head に 6 章のメタを出す）。
- ブラウザ側 JS は同ファイル内の IIFE 文字列（`ui/editor.mjs` と同じ作法）。fetch は `credentials:'same-origin'`、URL の `?t` を `/api/...?t=` に引き継ぐ（`ui/editor.mjs` の `withTenantQ` と同型）。
- fetch 先と形：`POST /api/scrimmage/split` → `{ ok, seed, teams }`、`POST /api/scrimmage/decide` → `{ ok, id }`、`POST /api/roster/sync` → `{ ok, syncedAt, count, skipped, missing }`。失敗は `{ ok:false, error }` の `error` を面の下部に一文で出し、面は変えない。
- `model.players` の `playerId → name` 対応でチームの名前を描く。`model` に無い情報（Tier 等）を描画も島も持たない。
