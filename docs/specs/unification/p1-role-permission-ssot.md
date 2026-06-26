# P1-6 ロール権限の単一真実源化 — 実装スペック

> 統合 P0 設計（`docs/specs/unification/design.md` §2.2・§5・§7）の P1-6 を実装可能な粒度へ落とす。
> 本書は「認可の振る舞いを一切変えずに、ロール → 権限の真実源を1つにする」非破壊スキャフォールドに限定する。
> 引用するコード位置は両アプリの実ファイルを開いて再採番した（distill の座標は採らない。実座標は §0）。

---

## 0. 裏取りした実コード座標（本書の前提）

設計の細部は実コードの認可配線に従う。distill が参照した座標には誤りがあったため、両アプリの実ファイルを開いて再採番した。以下を本書の唯一の座標とする。

計画側（練習計画アプリ・`functions/`・ESM `.mjs`・firebase-kit 非依存）

- 目標テキスト編集の認可: `index.mjs:285`（`goalWriteDecision` 内 `ctx.role !== 'owner'`）。
- 上書き保存の認可: `index.mjs:425`（`/api/override` `ctx.role !== 'owner'`）。
- 上書き削除の認可: `index.mjs:455`（`/api/override/delete` `ctx.role !== 'owner'`）。
- テーマ設定の認可: `index.mjs:237`（`themeWriteDecision` `ctx.isAdmin !== true`）。
- 学校名設定の認可: `index.mjs:258`（`nameWriteDecision` `ctx.isAdmin !== true`）。
- 招待発行の認可: `invitations.mjs:89`（`mintInvitation` `ctx.isSuperAdmin !== true`）。
- テナント解決の返す文脈: `tenant-resolve.mjs:92-98`（`toContext` が `{uid, tenantId, role, isAdmin, isSuperAdmin}` を返す）。
- 招待承諾時の membership 書込: `invitations.mjs:183`（`role = inv.role || 'owner'`）・`:184`（`grantAdmin = inv.grantAdmin === true`）・`:204`（`isAdmin: grantAdmin`）。

記録側（試合記録アプリ・`functions/src/`・TypeScript・firebase-kit を `file:firebase-kit` submodule 依存）

- ロール語彙の定義: `types/index.ts:92`（`MemberRole = 'coach' | 'advisor' | 'player' | 'parent'`）。
- ロール別認可: `middleware/check-role-permission--authorize--by-role.ts`（`ALLOWED_OPERATIONS:27-34`・`checkRolePermission():43`・未許可 throw `:45`）。
- 管理者フラグ関門: `middleware/require-tenant-admin--authorize--by-flag.ts:23`（`requireTenantAdmin` = `isAdmin === true || isSuperAdmin === true`）。
- テナントゲート: `middleware/with-tenant--gate--from-memberships.ts:84`（`role: membership.role` をそのまま文脈へ載せる）。
- 自分スタッツ強制限定: `handlers/stats--resolve-allowed-player.ts:19/34`（role 文字列の完全一致で player/parent を判定）。
- スタッツハンドラの role 分岐: `handlers/match-stats--handler.ts:58`（`ctx.role === 'player' || ctx.role === 'parent'`）。
- ルーター: `routing/api-router--wire--master-crud.ts`。各操作の配線位置は §1 の由来欄に記す。

firebase-kit 配置（本書の最重要前提・§2/§4 の根拠）

- 計画アプリ参照先と記録アプリ参照先は別リポジトリである。計画側 cwd の firebase-kit は `tsutushi0628/firebase-kit`、記録側 submodule は `bengo4com/firebase-kit`（pin `c10a256` ＝ v1.0.1-243-gc10a256）。両者は別履歴で、共通コミットへ pin を揃えることはできない。
- `firebase-kit` の `exports` は `require`（CommonJS）条件のみで `import` 条件を持たない（`package.json` exports）。
- `firebase-kit/backend` のルート再エクスポートは secret-manager・genai・firebase-admin 等の重い依存を芋づるで引く（backend `index.ts` が config から全部を `export *`）。
- 認可モジュール（authz）はどちらの firebase-kit にも未存在で、これから新設する。

---

## 1. 統合ロール → 権限表（操作スコープ単位）

権限はロール名でなく操作スコープ（operation）単位で列挙する。これは「同一ロールがアプリをまたいでスコープ化けする」事故（design §2.2 失敗モード・プレモーテム P4）を防ぐためで、計画操作と記録操作を1つのユニオンに別建てで並べ、各ハンドラは自分の操作だけを述語に渡す。

表は実ルーターの operation 割当に1対1で対応させる。読み口のラベルは「コードが実際に何を gate しているか」で書く（distill が `read-team-stats` を「チーム全体集計」と誤記していた点をここで正す。実体はメンバー一覧・利用者一覧・プレーバイプレーの読取である）。

セルは ✓＝許可 / ✗＝拒否。`isSuperAdmin` は直交フラグで、ロール判定とは別の列で扱う。

| 操作スコープ（operation） | アプリ | coach＋isAdmin | coach | advisor | player | parent | isSuperAdmin の効き | 由来（実座標） |
|---|---|---|---|---|---|---|---|---|
| 計画閲覧（read-plan） | 計画 | ✓ | ✓ | ✓ | ✓ | ✓ | 影響なし | 計画は GET `*` が HTML を返し role 判定なし（`index.mjs` の描画経路）。§7 越境注記を参照 |
| 計画編集（edit-plan・週/月目標・上書き保存/削除） | 計画 | ✓ | ✗ | ✗ | ✗ | ✗ | 影響なし | `index.mjs:285/425/455`（現状 `role==='owner'` のみ・isAdmin 不問）。owner→`coach＋isAdmin`／旧 owner 語彙の両方を通す（§5 P1 で締めも緩めもしない） |
| テナント設定（manage-tenant・テーマ/学校名） | 計画 | ✓ | ✗ | ✗ | ✗ | ✗ | 影響なし | `index.mjs:237/258`（現状 `isAdmin` 単独ゲート） |
| 招待発行（mint-invitation） | 計画 | isSuperAdmin のみ | isSuperAdmin のみ | isSuperAdmin のみ | ✗ | ✗ | ✓（唯一の通過条件） | `invitations.mjs:89`（`isSuperAdmin` のみ・role 不問） |
| マスタCRUD（crud-master・試合/選手/チーム/利用者作成等） | 記録 | ✓ | ✓ | ✓ | ✗ | ✗ | 影響なし | `api-router:374/408/457/560`（`crud-master`）・`ALLOWED_OPERATIONS` の coach/advisor 集合 |
| イベント記録（record-event・記録/取消/挿入/交代） | 記録 | ✓ | ✓ | ✓ | ✗ | ✗ | 影響なし | `api-router:596-677`（`record-event`） |
| 一覧読取（read-members-list・メンバー/利用者一覧・プレーバイプレー） | 記録 | ✓ | ✓ | ✓ | ✗ | ✗ | 影響なし | `api-router:491/499/523/686`（実トークンは `read-team-stats`。本表ではラベルを実体へ改名） |
| 自分スタッツ（read-own-stats・試合/通算/CSV/PDF スタッツ） | 記録 | ✓ | ✓ | ✓ | ✓（自分の playerId に強制限定） | ✓（子の playerId に強制限定） | 影響なし | `api-router:449/698/713/781`（`read-own-stats`）＋ハンドラ内強制限定（`match-stats--handler.ts:58`） |
| メンバー管理（manage-members・メンバー作成/更新/削除） | 記録 | ✓ | ✗ | ✗ | ✗ | ✗ | ✓（フラグで通過・role 不問） | `api-router:492/505/513`（`withAuthAndTenantAdmin`＝`requireTenantAdmin`＝`isAdmin\|\|isSuperAdmin`）。`ALLOWED_OPERATIONS` の manage-members(coach) はどのルートからも呼ばれない死コード |

表の読み方で外してはならない3点を注記する。

メンバー管理（manage-members）の実ゲートはロールでなくフラグである。
記録側のメンバー作成・更新・削除は `requireTenantAdmin`（`isAdmin || isSuperAdmin`）を通り、`checkRolePermission` を通らない。
したがって isAdmin を持つ advisor も通り、isAdmin を持たない coach は通らない（role 不問・フラグのみ）。
`ALLOWED_OPERATIONS` の `manage-members`（coach のみ）は実ルートで使われない死コードで、これを正規表へ「coach のみ」で転記すると、誰かが後で `canPerform('manage-members')` へメンバー書込を寄せたとき、isAdmin で守られている経路が coach 全員に開く。死コードは正本化せず、述語の構造で「フラグ判定（role を引数に取らない別述語）」として固定する（§2・§5・§7）。

自分スタッツ（read-own-stats）の playerId 強制限定は述語の外にある。
limitation は `match-stats--handler.ts:58` の role 文字列分岐と `stats--resolve-allowed-player.ts` のハードコードにあり、`canPerform` には無い。
よって述語の正規化結果（CanonicalRole）と handler が見る role 文字列は、同じ語彙集合を共有しなければならない（共有しないと forced playerId が立たず全チーム分が漏れる・§5 P5・§6）。

isSuperAdmin の越境は作らない。
isSuperAdmin が与えるのは「招待発行」と「メンバー管理関門（requireTenantAdmin）の通過」だけで、read-own-stats の playerId 強制限定を解除しない（強制限定は role だけを見る）。
記録の一覧読取・スタッツをテナント横断で開く経路は P1-6 では作らない（テナントゲート `with-tenant:90` の tenantId 突合が isSuperAdmin でも止める）。

---

## 2. 述語モジュール API（正規表の唯一の母体）

正規表（ロール → できること）と述語を firebase-kit に新設し、両アプリがこれだけを参照する。配置は `firebase-kit/src/backend/authz/`、参照サブパスは `firebase-kit/backend/authz` を新設する（ルートの `./backend` ではない）。

### 2.1 配置と純粋性の条件（成立条件）

authz は純データ（正規表）と純関数（述語）だけで構成し、firebase-kit の重い依存に一切触れない。
`./backend` を参照すると config・secret-manager・genai・firebase-admin を芋づるで引き、計画側 esbuild がこれらを bundle 対象（または external 解決対象）に巻き込む。
authz が `getCollection`・`AuditLogger`・`firebaseKit.initialize` のいずれにも触れないことが、計画側からの軽量参照が成立する条件である。

- 正本ソース: `firebase-kit/src/backend/authz/role-permission--decide--by-operation.ts`（正規表＋述語本体）。
- 再エクスポート: `firebase-kit/src/backend/authz/index.ts`。
- exports 追加: `package.json` の `exports` に `"./backend/authz"` を追加（`types: ./dist/backend/authz/index.d.ts`・`require: ./dist/backend/authz/index.js`）。
- import 副作用ゼロ: authz の `index.ts` は authz 配下だけを再エクスポートし、backend の `index.ts` 経由にしない。

### 2.2 型

- `type CanonicalRole = 'coach' | 'advisor' | 'player' | 'parent'`（記録側 `MemberRole` と一致・`types/index.ts:92`）。
- `type AppOperation =`（計画）`'read-plan' | 'edit-plan' | 'manage-tenant' | 'mint-invitation'` ∪（記録）`'crud-master' | 'record-event' | 'read-members-list' | 'read-own-stats'`。計画操作と記録操作を1つのユニオンに別建て列挙する（同名衝突を作らない）。
- `interface AuthzPrincipal { role: CanonicalRole; isAdmin: boolean; isSuperAdmin: boolean }`。

`manage-members` を `AppOperation` に含めない。これはフラグ判定であって role 集合判定ではないからで、§2.3 の `canAdminister` が担う。

### 2.3 関数シグネチャ（すべて純関数・throw しない判定を上位が選べる形）

- `canPerform(principal: AuthzPrincipal, op: AppOperation): boolean`。正規表の唯一の参照点。内部に `ALLOWED: Record<CanonicalRole, ReadonlySet<AppOperation>>` を持つ。edit-plan と manage-tenant は `role === 'coach' && isAdmin` で判定し、mint-invitation は `isSuperAdmin`（role 不問）で判定する。read-plan は全 CanonicalRole に許可。
- `canEditPlan(rawRole: string, isAdmin: boolean): boolean`。計画編集の非破壊専用述語。`rawRole === 'owner'`（旧語彙・isAdmin 不問）または `(正規化後 role === 'coach' && isAdmin)` で true。現状の `role==='owner'` 判定（isAdmin 不問）と新語彙 `coach＋isAdmin` の両方を、isAdmin を捏造せずに通す（§5 P1 の核）。
- `canAdminister(principal: { isAdmin: boolean; isSuperAdmin: boolean }): boolean`。`requireTenantAdmin` と同値（`isAdmin || isSuperAdmin`）。role を引数に取らない。記録のメンバー管理関門をこれへ委譲し、role 条件の混入を構造的に禁じる。
- `normalizeRole(rawRole: string): CanonicalRole`。語彙正規化の唯一の母体。`'owner' → 'coach'`。既に正規語彙なら素通し。未知語彙は最小権限 `'player'` へ倒し（ロックアウトでなく最小化）、throw しない。未知語彙にヒットしたら warning ログと件数カウンタを出す（沈黙降格の禁止・§5 P5・§6）。
- `isScopedToOwnPlayer(role: CanonicalRole): boolean`。`role === 'player' || role === 'parent'`。記録のスタッツ強制限定の role 分岐をこの述語へ寄せ、handler 側の文字列直書き比較を全廃する（述語の正規化語彙と handler の参照語彙を1つに束ねる）。
- `assertCan(principal, op): void` と `assertCanEditPlan(rawRole, isAdmin): void` と `assertCanAdminister(...): void`。対応する述語が false なら throw。message に「権限がありません」を含め、記録ルーターの既存 `toRoleError`（`api-router:136`）の catch → 403 変換（`:160/195/226/259`）を壊さない。

`isAdmin` を写像時に捏造しない。distill の独断案（owner を `{coach, isAdmin:true}` へ写し isAdmin を強制付与）は採らない。理由は §8 と §5 P1 で詳述するが、要点は「`grantAdmin:false` で発行された招待を承諾した owner は `isAdmin:false` で実在する」（`invitations.mjs:184/204`）ため、写像で isAdmin を捏造すると DB 実態と乖離した値を作り、データ移行（P2）後に同じ owner が編集不可へ落ちる時限ロックアウトを生む。`canEditPlan` が旧 owner 語彙を isAdmin 不問で通すことで、捏造なしに非破壊を保つ。

### 2.4 両アプリの参照方法

- 記録（TypeScript・モジュール解決は CommonJS dist を読む既存実績あり）: `import { canPerform, assertCan, canAdminister, normalizeRole, isScopedToOwnPlayer, type AppOperation } from 'firebase-kit/backend/authz'`。型は dts から取得。
- 計画（ESM `.mjs`・esbuild）: `import { canEditPlan, canPerform } from 'firebase-kit/backend/authz'`。型は JSDoc で受ける。CommonJS dist を ESM から読む interop の取り回しは §4 で実走確認を必須にする（未検証範囲・§7）。

### 2.5 LLM 不使用

すべて決定論の集合所属判定とフラグ判定で、LLM は使わない（CLAUDE.md LLM設計原則①「厳密判定はコード側」に従う）。

---

## 3. 計画6箇所＋記録の置換マッピング

述語経由へ寄せる。挙動は現状と一致させる。

### 3.1 計画側（旧 `role==='owner'` / `isAdmin` 直書き → 述語経由）

| # | 実座標 | 現状の判定 | 置換後 |
|---|---|---|---|
| 1 | `index.mjs:285`（`goalWriteDecision`） | `ctx.role !== 'owner'` | `!canEditPlan(ctx.role, ctx.isAdmin === true)` |
| 2 | `index.mjs:425`（`/api/override`） | `ctx.role !== 'owner'` | `!canEditPlan(ctx.role, ctx.isAdmin === true)` |
| 3 | `index.mjs:455`（`/api/override/delete`） | `ctx.role !== 'owner'` | `!canEditPlan(ctx.role, ctx.isAdmin === true)` |
| 4 | `index.mjs:237`（`themeWriteDecision`） | `ctx.isAdmin !== true` | `!canPerform(toPrincipal(ctx), 'manage-tenant')` |
| 5 | `index.mjs:258`（`nameWriteDecision`） | `ctx.isAdmin !== true` | `!canPerform(toPrincipal(ctx), 'manage-tenant')` |
| 6 | `invitations.mjs:89`（`mintInvitation`） | `ctx.isSuperAdmin !== true` | `!canPerform(toPrincipal(ctx), 'mint-invitation')` |

`toPrincipal(ctx)` は `{ role: normalizeRole(ctx.role), isAdmin: ctx.isAdmin === true, isSuperAdmin: ctx.isSuperAdmin === true }`。`tenant-resolve.mjs:92-98` が返す文脈（role/isAdmin/isSuperAdmin）をそのまま食える。

edit-plan（#1〜#3）だけ `canEditPlan` を使い `toPrincipal` を通さない。manage-tenant は現状 isAdmin 単独で、正規化後 `coach && isAdmin` と等価になる（owner は coach へ正規化され、isAdmin 実値で判定）。edit-plan は現状 isAdmin 不問の owner 限定なので、isAdmin を見ずに旧 owner を通す専用述語が要る（§2.3）。

直呼びの単一障害点を作らない。
計画6箇所を個別に `canPerform`/`canEditPlan` 直呼びにするのでなく、計画側に薄いラッパ（`requireEditPlan(ctx)` 等）を1つ置き、6箇所はそれを通す。
これは「toPrincipal の通し忘れ・edit-plan を `canPerform('edit-plan')` で誤判定」を1箇所に閉じ込めるためで、漏れが出る面を狭める。

### 3.2 計画側で触らないもの

`invitations.mjs:183`（accept 時 `role = inv.role || 'owner'`）と `:204`（membership 書込 `isAdmin: grantAdmin`）はデータ語彙であって認可判定ではない。
P1-6 では触らない（旧語彙のまま owner を書き続ける＝旧2プロジェクト並走に無影響）。
ここを今書き換えると旧コードが読めず壊れる（expand-contract 違反）。正規語彙への書換は P2 移行スクリプトの責務（§7・design §5.1）。

### 3.3 記録側（既存述語 → 正規表へ相対化・意味不変）

- `check-role-permission--authorize--by-role.ts` の `checkRolePermission` を authz の `assertCan`（または `canPerform` ＋既存の throw 形）の薄いラッパに置換する。`ALLOWED_OPERATIONS` の操作集合は authz の正規表へ移設する。ただし `manage-members`（coach のみ）は実ルート未使用の死コードなので正規表へ転記しない（§1 注記・§7）。呼出側 `api-router:158/192` の `checkRolePermission(ctx.role, operation)` シグネチャは温存（ラッパが同名再エクスポート）。`operation` 文字列のうち `read-team-stats` は記録内では当面そのまま受け、authz の正規表で `read-members-list` 集合へ対応づける（ルート定義の第2引数は1文字も変えない＝非破壊不変条件）。
- `require-tenant-admin--authorize--by-flag.ts` の `requireTenantAdmin` を authz の `canAdminister`（`isAdmin || isSuperAdmin`）へ委譲する。`api-router:224/257` の呼出は温存。
- `with-tenant--gate--from-memberships.ts:84` の `role: membership.role` を `role: normalizeRole(membership.role)` に変える。これは記録側 memberships に旧語彙 owner が混入したとき（計画招待で作られた owner が統合後に記録 API へ来る経路）に、`ALLOWED_OPERATIONS` の未定義キーで TypeError か素通りになるのを防ぐ（§5 P5・§6）。あわせて `checkRolePermission:44` を `const allowed = ALLOWED_OPERATIONS[role] ?? EMPTY_SET` の null ガードにして、未知キーでも throw も素通りもさせず明示拒否に倒す。
- `stats--resolve-allowed-player.ts:19/34` と `match-stats--handler.ts:58` の role 文字列分岐を `isScopedToOwnPlayer(ctx.role)` 経由に置換する。`resolveAllowedPlayerId` が null を返したら handler は既存どおり 403（`match-stats--handler.ts:60-63`）に倒す＝強制限定を構造的に不能にしない。

記録ローカル表（`ALLOWED_OPERATIONS`）の物理削除は P1-6 でやらない。
相対化（参照差し替え）と物理削除を分け、削除は両アプリの dist 整合が確定した後（§7・P1-2/P2）へ送る。
submodule dist が未整合のまま記録側ローカル表を消すと記録側が即死しうるため、二重定義のドリフトは一時的に残す方が安全。

---

## 4. expand-contract 移行順序（各ステップ単独 revert 可・データ後行）

distill の S2「両アプリの submodule pin を同コミットへ揃える」は、別履歴の二remote では成立しない（§0）。これを成立条件付きの先行ステップ S0 へ置き換える。計画側のデプロイは「import を入れた瞬間に壊れる」不可逆経路なので、デプロイ実体検証を expand の完了条件へ格上げする。

S0（配線の現実化・着手前提）
記録と計画が読む firebase-kit を同一履歴へ統一する。
選べる手段は2つで、(a) 記録の submodule を `bengo4com/firebase-kit` から `tsutushi0628/firebase-kit` へ向け直して同 pin へ寄せる（クロスリポジトリ移送・要オーナー Go）か、(b) 当面は正本ソースを1ファイルに保ちつつ両 remote に同一 authz ソースを同期コミットし、CI で両 submodule 配下 authz の内容ハッシュ一致を検査する（沈黙ドリフト検知）。
どちらも「pin を揃える」では足りない。S0 が確定するまで S3/S4 に着手しない（着手すると S4 で計画本番が落ちる）。

S1（コード先行・expand・完全非破壊）
firebase-kit upstream に authz モジュールを新設する（正規表＋`canPerform`/`canEditPlan`/`canAdminister`/`normalizeRole`/`isScopedToOwnPlayer`/`assert*`）。両語彙受け（owner も正規語彙も食う）。この時点では誰も呼ばない。revert＝モジュール削除。

S2（公開・ビルド）
`exports` に `"./backend/authz"` を追加し、dist へ emit する。authz が backend の重い依存を引かないことをビルド出力で確認する（authz dist の依存グラフに secret-manager 等が現れない）。revert＝exports とソース戻し。

S3（記録の相対化・意味不変・S0 完了後のみ）
記録の `checkRolePermission`/`requireTenantAdmin`/`withTenant` の role 正規化/スタッツ role 分岐を authz へ差し替える（§3.3）。記録 build（`npm --prefix firebase-kit run build && tsc`）が authz import を含む状態で緑であることを着手前提にする。既存の by-role/by-flag テストがそのまま緑であること＝意味不変の証拠。revert＝ラッパ → 元実装。

S4（計画の述語経由化・両語彙受けで挙動不変・S0 完了後のみ）
S4 を「配線変更」と「コード変更」に分け、配線を先行・実走確認する。

1. 計画 `functions/package.json` に firebase-kit を `file:` 依存追加。
2. デプロイ経路を成立させる。`firebase.json` predeploy（現状 `npm run build` のみ）に install 段が無く、`ignore` が `node_modules` を含むため、`--packages=external` のまま import を入れると実行時に `firebase-kit` が見つからない。よって (i) predeploy に `npm --prefix "$RESOURCE_DIR" ci` を追加し `ignore` から `node_modules` を外す、または (ii) esbuild を `firebase-kit/backend/authz` だけ内包する設定（`--external:firebase-admin` 等は維持しつつ authz は bundle）にする、のどちらかを採る。authz が純モジュール（§2.1）であることが (ii) を可能にする。
3. エミュレータで1エンドポイントを実起動し、`import` 解決・named export・403/200 を実測する（CommonJS dist を ESM/esbuild から named import する interop の取り回しを実走で確認・§7 未検証範囲）。
4. それが緑になってから計画6箇所を述語経由へ置換する（§3.1）。

owner→coach は計画側メモリ上の正規化で、DB の role 値は `'owner'` のまま（旧2プロジェクト並走に無影響）。
expand 相の完了条件に「計画アプリが authz import を含む版でエミュレータ実起動して全エンドポイントが 200/403 を返す」を入れ、ビルド緑だけで非破壊と判定しない。revert＝6箇所を直書きへ戻し、依存・デプロイ設定を戻す。

S5（検証）
両アプリの全書込経路チェックリスト（§1 の operation 割当と §6 のテスト）で「各経路がどの operation 述語を通るか」を全件確認する。プレモーテム5点（§5）が表とテストで潰れているかを突合する。`normalizeRole` の未知語彙ヒット件数＝0 を確認する。

ここまでが P1-6 スコープ（非破壊・データ未移行）。

S6（データ後行・P2・別 Go ゲート）
移行スクリプトが memberships の role を owner → coach へ書き換える。
このとき「role='owner' かつ isAdmin:false の membership 件数」を必ずドライランで出力する（沈黙させない）。0件なら一律 isAdmin:true 確定で安全。1件以上あれば、その行が `grantAdmin:false` 由来（閲覧のみ owner）か招待外生成かを個別判定してから確定し、一律昇格を焼き込まない。
旧 owner 分岐（`canEditPlan` の owner 受け・`normalizeRole` の owner → coach）の除去は contract 相で、「移行ドライラン0件 or 全件個別確認済み」かつ「新規 accept が正規語彙で書く（`invitations.mjs:183/204` の owner 既定を coach へ）」の両方を満たした後にのみ行う。ロールバック窓（旧プロジェクト読取専用温存）の内側で行う。revert＝旧分岐を戻せば移行前の混在も再び扱える。

データ先行を採らない理由は、旧コード（`role==='owner'` 直書き）が残る間に role を coach へ移すと旧経路が全弾きになり、ロックアウトで戻せないため（プレモーテム P5）。

---

## 5. プレモーテムの対策（コードレベル）

各対策を「守るテスト」（§6）と1対1で対応づける。プレモーテムは Gemini 第二意見の5点に、敵対検証で追加された実コード起点の穴（owner 語彙の記録側混入・操作トークン取り違え・handler 語彙不一致・サイレント降格）を統合した。

P1（owner→coach 丸めで平コーチに edit-plan 露出・owner⟹isAdmin 非保証）
対策は `canEditPlan` が edit-plan を `rawRole==='owner' || (coach && isAdmin)` で判定すること。
素の coach（isAdmin:false）は edit-plan 不可、owner（isAdmin:false を含む）は edit-plan 可。
isAdmin を写像時に捏造しない（`grantAdmin:false` の owner が実在＝`invitations.mjs:184/204` のため、捏造すると P2 後に時限ロックアウト）。
守るテスト＝「素 coach は edit-plan 不可」「owner（isAdmin:false 含む）は edit-plan 可」「coach＋isAdmin は edit-plan 可」。

P2（playerId 限定を計画データに適用すると締めすぎ/漏れ）
対策は計画側に read-own-stats 相当の操作を作らず、player/parent を read-plan に丸めること。
計画データに個人粒度が無い（`engine/src/storage.js` は teamId='boys'|'girls' 粒度で選手個人を持たない）。`stats--resolve-allowed-player` は計画から呼ばない（記録専用）。
守るテスト＝「計画の read-plan は player/parent も可」「計画操作集合に playerId 限定が現れない」。

P3（isSuperAdmin 越境）
対策は isSuperAdmin の効きを mint-invitation と `canAdminister` 通過に限定すること。
read-own-stats の playerId 強制限定は role だけを見るので、isSuperAdmin を足しても解除されない。テナント横断の一覧読取・スタッツは作らない（テナントゲートの tenantId 突合が止める）。
守るテスト＝「player＋isSuperAdmin でも read-own-stats の強制限定は維持」「isSuperAdmin でも他テナントの一覧読取はテナントゲートで止まる」。

P4（同一ロールがアプリ間でスコープ化け）
対策は `AppOperation` を計画/記録で別建てユニオン列挙し、各ハンドラが自分の op だけを述語に渡すこと。
守るテスト＝「player に記録の read-members-list は ✗」「player に計画の read-plan は ✓」が同ロールで両立。

P5（データ先行ロックアウト・移行中のサイレント降格）
対策はコード先行（S1〜S5）、`normalizeRole` の両語彙受け、旧分岐除去を P2 移行検証後（S6）に置くこと。
記録側 withTenant でも `normalizeRole` を通し（§3.3）、owner 語彙の混入を吸収する。`normalizeRole` の未知語彙フォールバックは warning ログ＋件数カウンタを出し、未知ヒット0件を S6 のゲート条件にする（既存正規ロールの取りこぼしによる沈黙降格を防ぐ）。
守るテスト＝「role='owner'（旧）でも edit-plan/record-event が現状どおり通る」「role='coach'＋isAdmin（新）でも通る」が同時に緑。「未知語彙は最小権限へ倒れ throw しない」。

manage-members 二重ゲートの誤統合（敵対検証 H5）
対策はメンバー管理を `canAdminister`（role を引数に取らないフラグ述語）へ委譲し、`canPerform('manage-members')` を作らないこと。
死コード `ALLOWED_OPERATIONS.manage-members`（coach）は正規表へ転記しない。
守るテスト＝「player＋isSuperAdmin で manage-members は現状どおり通る（締めない）」「素 coach（isAdmin:false・isSuperAdmin:false）で manage-members は通らない」。

handler 語彙不一致による fail-open（敵対検証 穴3）
対策は `isScopedToOwnPlayer` を述語の CanonicalRole 集合と handler 参照語彙の唯一の橋にすること。
`normalizeRole` の未知語彙フォールバックを `'player'`（forced playerId 経路が必ず発火する最小権限）に固定し、null 解決不能なら 403 に倒す。
守るテスト＝「未知語彙 → 正規化後 isScopedToOwnPlayer が true かつ allowedId 解決不能なら 403（全チームスタッツが漏れない）」。

---

## 6. テストマトリクス（各対策を守るテスト）

各行は「この振る舞いを壊す変更で必ず落ちる」構造にする（CLAUDE.md 原則11）。配置は firebase-kit `src/backend/authz/__tests__/role-permission.test.ts`（正規表本体）と、各アプリの薄い結線テスト。

正規表（firebase-kit authz・純関数）

| ID | 検証する業務意図 | 壊れたら落ちる対策 |
|---|---|---|
| A1 | `canEditPlan('owner', false)` が true（旧 owner は isAdmin 不問で編集可） | P1 |
| A2 | `canEditPlan('coach', false)` が false（素 coach は編集不可） | P1・独断決定2 |
| A3 | `canEditPlan('coach', true)` が true・`canPerform({coach,isAdmin:true},'manage-tenant')` が true | P1 |
| A4 | `canPerform({advisor,...}, op)` が read-plan/read-members-list/read-own-stats/crud-master/record-event で true、manage-members 系は対象外（canAdminister で判定） | P4・H5 |
| A5 | `canPerform({player,...}, 'read-own-stats')` true・`'read-plan'` true・`'read-members-list'` false・`'edit-plan'` false | P2・P4 |
| A6 | parent が player と同集合 | P4 |
| A7 | `canPerform({coach,isAdmin:true,isSuperAdmin:false},'mint-invitation')` が false・`isSuperAdmin:true` で true（招待発行を isAdmin に化けさせない） | P3 |
| A8 | `canAdminister({isAdmin:false,isSuperAdmin:true})` true・`{isAdmin:true,...}` true・`{false,false}` false（role を引数に取らない） | H5 |
| A9 | `isScopedToOwnPlayer('player')` true・`'parent'` true・`'coach'` false・`'advisor'` false | 穴3 |
| A10 | `normalizeRole('owner')` = 'coach'・`normalizeRole('ghost')` = 'player' かつ例外を投げない | P5 |
| A11 | 非破壊同値: `owner+isAdmin:true` / `owner+isAdmin:false` / `coach（素）` の3ケースで、旧 `role==='owner'` 判定と `canEditPlan` が同一結果（旧=新の同値） | P1・P5 |

結線（記録）

| ID | 検証する業務意図 | 壊れたら落ちる対策 |
|---|---|---|
| B1 | 既存の by-role/by-flag テストがラッパ化後も同結果（意味不変の回帰ゲート） | P5・S3 |
| B2 | `POST/PUT/DELETE /memberships` は isAdmin:false の coach で 403・isAdmin:true で通過（実ゲートはフラグ） | H5 |
| B3 | `GET /matches/:id/stats` は player でも 200（handler で forced playerId）・`GET /matches/:id/events` は player で 403（read-members-list） | P2・H2/H3 |
| B4 | role='owner' の membership で record-event を呼ぶと、正規化後 coach として通る（owner 語彙混入で TypeError も素通りも起きない） | P5・穴1 |
| B5 | 未定義語彙で `ALLOWED_OPERATIONS[role]` 参照が TypeError を投げず明示拒否 | P5・穴1 |
| B6 | player＋isSuperAdmin でも read-own-stats の playerId 強制限定が維持（越境しない） | P3 |

結線（計画）

| ID | 検証する業務意図 | 壊れたら落ちる対策 |
|---|---|---|
| C1 | edit-plan の3エンドポイント（目標/上書き保存/上書き削除）が owner で 200・非 owner で 403（述語経由化後も同ステータス）。owner→任意 coach に緩めたら 403→200 で落ちる | P1・独断決定2 |
| C2 | manage-tenant の2エンドポイント（テーマ/学校名）が isAdmin で 200・非 isAdmin で 403 | 非破壊 |
| C3 | mint-invitation が isSuperAdmin で 200・非 isSuperAdmin で 403（role 不問） | P3 |

---

## 7. P1-6 / P1-2 / P2 のスコープ線引き

線引きの原則は「コード（述語）＝ P1-6 で先行・両語彙受け」「データ（role 値）＝ P2 で後行」「旧分岐除去＝ P2 の移行検証後」。これが expand-contract の戻せる順序の核である。

P1-6 内（このタスクで完遂）

- firebase-kit authz モジュール新設（正規表＋述語群・§2）。
- `exports` に `"./backend/authz"` サブパス追加・dist 反映・authz が重い依存を引かないことの確認（§4 S2）。
- 記録の `checkRolePermission`/`requireTenantAdmin`/`withTenant` role 正規化/スタッツ role 分岐を authz へ相対化（意味不変・§3.3）。
- 計画6箇所（`index.mjs:237/258/285/425/455`・`invitations.mjs:89`）を述語経由へ置換＋計画に firebase-kit 依存追加＋デプロイ経路の成立（§3.1・§4 S4）。
- 両語彙受け述語で旧2プロジェクト並走を不変に保つ。
- 全書込経路チェックリスト検証（§5 S5）。

この6つで認可の真実源は1つになり、振る舞いは現状と一致する。

P1-2 へ送る（記録 functions を home のコードベースとして追加する局面・design §5 P1）

- S0 の配線現実化（記録 submodule の履歴統一 or 両 remote の authz ハッシュ一致 CI）。これは P1-6 の着手前提だが、クロスリポジトリ移送はオーナー Go と重なるため、移送自体は P1-2 と連動する。
- 記録側ローカル表（`ALLOWED_OPERATIONS`）の物理削除（contract）。二重定義のドリフト解消は dist 整合が両アプリで確定した後（§3.3 安全弁）。
- 記録 functions の Firestore 接続先向け直し・SA・Secret・named DB 結線（design §4・§5 P1 の④）。authz の相対化自体は P1-6 で完了させるが、起動経路としての記録 functions ビルド・デプロイ配線は P1-2。

P2（オーナー Go・不可逆）

- memberships の role 値書換（owner → coach・isAdmin 確定・§4 S6）。
- `normalizeRole`/`canEditPlan` の owner 旧分岐除去（移行検証後・S6 contract）。
- `invitations.mjs:183/204` の書込語彙の正規化（accept が coach を書く）。
- DB の語彙変更とデータ移行は全部 P2。データ先行は旧コードロックアウトで戻せないため（P5）。

計画閲覧の越境（統合即時に生じる・要オーナー判断）

計画の閲覧（read-plan）は現状ロール無関係で、同テナントの全員が全チーム計画を閲覧できる（GET `*` に role/team 絞りが無い・`engine/src/storage.js` は team 粒度のみで個人粒度を持たない）。
統合後、記録アプリで自分のスタッツしか見られない player/parent が、計画アプリ経由で他選手込みのチーム計画を閲覧できる迂回路が即時に生じる。
これは現状仕様の据え置きだが、統合で記録の playerId 限定ポリシーと衝突する。閲覧範囲の変更は振る舞い変更で P1-6 スコープ外とし、§8 のオーナー判断1問として上げる。P1-6 では本書に「統合即時の越境」として明記し、絞り込みを入れる場合は P2 の移行項目（計画 GET に team 粒度の絞り）として確定する。

---

## 8. メインの独断決定への結論

決定1（配置・正規表を firebase-kit に置き両アプリが同一述語を import）＝採用・1点補正
両アプリが同一述語を参照する方針に同意する。
ただし「物理1ファイルの真実源」は現状の配線では成立しない。計画側 cwd は `tsutushi0628/firebase-kit`、記録側 submodule は `bengo4com/firebase-kit`（pin c10a256）で別 remote・別履歴であり、共通コミットへ pin を揃えられない（§0 で実確認）。
真実源は「upstream ソース1ファイル＋両アプリの履歴統一 or authz ハッシュ一致検査」で担保する（§4 S0）。あわせて、authz は `./backend` でなく純モジュール `./backend/authz` に置く（`./backend` は secret-manager・genai 等の重い依存を引き、計画側 esbuild が巻き込むため・§2.1 で実確認）。
両アプリへ JS 定義をコピーする代案は真実源2つ化で却下。→ 同意して反映（配線の現実差分とサブパス純粋性の2点を補正）。

決定2（計画の edit-plan を統合後も管理者コーチ限定＝現状 owner 限定を締めたまま統合）＝採用・実装条件を1点補正
現状 `index.mjs:285/425/455` は `role==='owner'` のみ通過し、design の表は素の coach に override 編集を許す緩み（design.md:81）がある。これを採ると平コーチが他人の計画を編集できる方向に現状より開く。P1-6 は非破壊なので、現状 owner 限定を締めたまま統合するのが正しい。→ 同意。
ただし実装は「写像時 isAdmin:true 強制付与」では行わない。
`grantAdmin:false` で発行された招待を承諾した owner は `isAdmin:false` で実在する（`invitations.mjs:184/204` で実確認）。isAdmin を見て edit-plan を判定すると、この owner が現状できている編集を失う（非破壊違反）。一方 isAdmin を捏造すると DB 実態と乖離し、P2 のデータ移行で実 isAdmin:false が確定書込された後に旧分岐を除去すると時限ロックアウトになる。
よって `canEditPlan` を `rawRole==='owner' || (coach && isAdmin)` の二条件 OR にし、旧 owner を isAdmin 不問で通す現挙動をそのまま述語へ転記する（捏造不要・非破壊・§2.3）。これが「現挙動を一切締めずに決定2を実装する」条件である。

---

## オーナー判断を要する1問

計画アプリの計画閲覧（read-plan）は現状ロール無関係で、同テナントの全員が全チーム計画を閲覧できる。
統合後、記録アプリで自分のスタッツしか見られない選手・保護者が、計画アプリ経由で他選手込みのチーム計画を閲覧できる迂回路が即時に生じる。
この閲覧範囲を、(A) 現状維持（計画は全員に開く）か、(B) 記録と同じく所属 team/自分粒度に絞る（P2 で計画 GET に絞りを追加）か、どちらで確定するか。
