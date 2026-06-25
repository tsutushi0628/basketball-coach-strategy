# マルチテナント化 — 設計

> 兄弟プロジェクト（バスケ得点アプリ）の租户モデルを1対1で読み、データ境界の抽象（storage 層）に合わせて移植する。
> 不可逆な核（データモデル・認証・rules・招待）は Gemini 第二意見でプレモーテム済み。採用した補強は本文 §7 に明記する。

## 1. データモデル（名前付き Firestore：basketball-strategy-db）

クライアント直アクセスは rules で全 deny を維持する。テナント分離はサーバ（Admin SDK）コードだけが守る。

### グローバル（テナント非依存・フラット）

- `drills/{drillId}` ：共有ドリルカタログ（216件）。現状のまま。テナント識別子を持たない。
- `users/{uid}` ：グローバルアカウント。`{ authUid, email, isSuperAdmin?, createdAt }`。doc ID = Firebase Auth uid。
- `memberships/{id}` ：所属。`{ id, tenantId, userId(=authUid), role, isAdmin, joinedAt, leftAt? }`。フラット集合・コードでゲート。
- `invitations/{id}` ：登録招待。`{ id, tokenHash, kind:'register', role, grantAdmin, expiresAt, status:'pending'|'accepted'|'expired'|'revoked', createdBy, createdAt, acceptedAt? }`。

### テナント配下（サブコレクション）

- `tenants/{tenantId}` ：`{ id, name(=チーム/学校の表示名), status, initialized:boolean, createdBy, createdAt }`。
- `tenants/{tid}/teams/{teamId}` ：チーム config。teamId は `boys` / `girls`（テナント内で固定2チーム）。
- `tenants/{tid}/teams/{teamId}/input/latest` ：チーム指標（team-input）。
- `tenants/{tid}/annualPlan/current` ：年間計画。学校固有の大会名を含むためテナント専有。
- `tenants/{tid}/overrides/{date}` ：コーチ上書き。doc ID = date（^YYYY-MM-DD$）。テナント内は男女共有（override 本体の team セルで当てる現行仕様を維持）。

### なぜこの分け方か

- 業務データ（teams / annualPlan / overrides）はサブコレクションにする。doc ID=date を保ったままテナント間の同日衝突を物理的に消すため。フラット＋tenantId フィールドだと date を複合キーにする破壊的変更が要る。
- 管理データ（users / memberships / invitations）はフラットにする。`userId` 横断クエリ（自分の所属一覧）やトークン照合が要るため。
- drills は共有のまま。普遍的なカタログでテナント固有でない。

## 2. データ境界（storage 層）の変更 — エンジン・描画は無改変

`engine/src/storage.js` の `createFirestoreStorage` がデータの所在を隠す唯一の境界。ここだけ tenantId 対応にする。

- 変更前：`createFirestoreStorage({ db, teamId })`。teams/{teamId}・annualPlan/current・overrides 全件・drills 全件を読む。
- 変更後：`createFirestoreStorage({ db, tenantId, teamId })`。
  - `getConfig` → `tenants/{tenantId}/teams/{teamId}`
  - `getTeamInput` → `tenants/{tenantId}/teams/{teamId}/input/latest`
  - `getAnnualPlan` → `tenants/{tenantId}/annualPlan/current`
  - `getOverrides` → `tenants/{tenantId}/overrides`（全件・date 規約で濾す。現行のクロスチーム挙動を維持）
  - `getDrills` → `drills`（グローバル・不変）
- **fail-fast**：`if (!tenantId) throw` を `if (!teamId) throw` と並べて先頭に置く。空 tenantId でのパス組み立てを構造的に禁止し、越境事故の最後の砦にする（§7-d）。

`ui/plan-data.mjs` の `buildPlanData` は学校名 `'南中野中'` を直書きしている（現状の唯一のテナント名ハードコード）。`buildPlanData({ storage, girlsStorage, school })` に `school` 引数を足し、テナント doc の `name` を渡す。`data.school` の下流（render / plainText / build.mjs / function title）は無改変。

## 3. 認証（SSR・セッション Cookie 方式）

SSR では GET ナビゲーションに Bearer ヘッダを載せられないため、セッション Cookie で本人性を運ぶ。Bearer ヘッダ方式（兄弟の SPA）は採らない。firebase-kit の `createSessionAuthGate` は「静的配信＋ドメイン許可」モデルで本件（動的描画＋招待制＋テナント解決）に合わず CommonJS のため、セッション Cookie の作法だけ踏襲して素の firebase-admin で自前実装する。

### ログイン / ログアウト

- クライアント：Google sign-in（popup・既存 `ui/auth-client.mjs` の CDN 1コピー方式を踏襲）→ ID トークン取得 → `POST /api/session/login { idToken }`。
- サーバ：`verifyIdToken(idToken, true)`（checkRevoked=true・ここだけ）→ `createSessionCookie(idToken, { expiresIn })` → `Set-Cookie: __session=...; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=...`。
- `POST /api/session/logout`：`verifySessionCookie` で uid を引き `revokeRefreshTokens` → Cookie クリア → ログイン画面へ。
- セッション TTL は約1日（24h）。共有端末の取り違え・置き忘れリスクを抑える（§7-b）。

### リクエストごとのテナント・ロール解決

- GET 描画と POST 書き込みは `__session` Cookie を読む。
  - GET（描画・読み）：`verifySessionCookie(cookie, false)`（ローカル署名検証のみ・失効確認なし）。毎リクエストの Auth RPC を避け SSR の TTFB を守る（§7-a）。
  - POST（書き込み）：`verifySessionCookie(cookie, true)`（失効確認あり）。破壊操作だけ厳密化。
- uid → テナント解決：`memberships` を `where(userId==uid)` で引き、`leftAt` 無し（在籍中）に絞る。
  - 0件：テナント未所有。承諾待ち画面（/onboarding）へ誘導。
  - 1件：そのテナントを採用。
  - 複数件：`?t={tenantId}` が在籍と一致すれば採用。指定なしならテナント選択画面。
- ロール・isAdmin は membership から、isSuperAdmin は `users(uid).isSuperAdmin` から解決する（ロール認可と管理者フラグは直交2系統。混在表は全組合せで破綻するため分ける）。
- **クライアント送信の tenantId は信用しない**。所属照合（memberships）が唯一のテナントゲート。`?t` は「在籍テナントの中からどれを表示するか」の選択にのみ使い、未在籍なら 403。

### 認可

- 閲覧（GET 描画）：当該テナントの在籍メンバー。
- 書き込み（override 保存・削除）：当該テナントの編集ロール（owner）かつ対象 date がそのテナント配下。
- 招待発行（register）：スーパー管理者（プラットフォーム所有者）のみ。
- ロール（このツール固有・最小）：`owner`（テナント所有コーチ・編集可・isAdmin:true）。将来 `editor` / `viewer` を足せる形にする。MVP は owner のみ実装。

## 4. 招待登録フロー（register 一本）

新規払い出しと既存参加を1スキーマで混ぜると権限昇格の温床になるため、MVP は register（新規払い出し）だけを実装する。参加型は別コレクションで将来別途（§7-c）。

- **発行**（スーパー管理者）：`POST /api/invitations` → `randomBytes(32).toString('base64url')`（256bit）を生成、DB は SHA-256 の `tokenHash` のみ保存、`expiresAt`=7日後、`status='pending'`。応答に joinUrl `<BASE_URL>/join?token=<raw>` を返す（生トークンは応答とリンクにだけ載る）。
- **照合**（公開）：`POST /api/invitations/lookup { token }` → `tokenHash` で検索し `{ valid, kind, expired }` を返す。register なのでメール等の個人情報は返さない。
- **承諾**：`/join?token=...` を開く → 未ログインなら Google sign-in を促す → `POST /api/invitations/accept { token }`（ID トークン付き）。
  - サーバは `runTransaction` で最小限だけ行う：token 照合 → pending かつ未期限の確認 → 新 tenant doc 作成（`initialized:false`）→ 作成者を `owner / isAdmin:true` で membership 作成 → `users/{uid}` upsert → invitation を `accepted` に更新。
  - **テンプレ初期化はトランザクション外**：txn 完了後に、新テナント配下へテンプレ（汎用シーズンの annualPlan＋男女2チームの config＋team-input）を投入し、`tenants/{tid}.initialized=true` に更新する。txn 肥大化と競合を避ける（§7-e）。描画時に `initialized=false` なら「準備中」を表示する。
  - 承諾成功でセッション Cookie を張り、自テナントの計画へリダイレクト。

## 5. 移行（既存の現行校データ → 最初のテナント）

一度きり・冪等のスクリプト `scripts/migrate-to-multitenant.mjs`。

- `tenants/{firstTenantId}` を作成（name=現行校の表示名・`initialized:true`・createdBy=所有者 uid）。
- `teams/{minami-nakano-boys|girls}` → `tenants/{firstTenantId}/teams/{boys|girls}`（input サブコレクションも移送）。
- `annualPlan/current` → `tenants/{firstTenantId}/annualPlan/current`。
- `overrides/{date}` → `tenants/{firstTenantId}/overrides/{date}`。
- `users/{ownerUid}` を `isSuperAdmin:true` で作成、`memberships` に owner/isAdmin を作成。
- `drills` は触らない（共有）。
- 旧トップレベル（teams/annualPlan/overrides）は移送確認後に削除（冪等のため移送済みskip）。
- 所有者 uid は実値を本スクリプトに書かず、環境変数（OWNER_EMAILS から Auth で uid 解決、または OWNER_UID）で渡す。

## 6. エンドポイントと描画経路（functions/index.mjs）

Hosting は全リクエストを単一 `render` 関数へ rewrite する。関数内で経路を分ける。

- `GET /login`：ログイン画面（Google sign-in ボタン）。認証不要。
- `GET /join`：招待承諾画面。認証不要（クライアントが lookup → sign-in → accept）。
- `POST /api/session/login` / `POST /api/session/logout`：§3。
- `POST /api/invitations`（スーパー管理者）/ `POST /api/invitations/lookup`（公開）/ `POST /api/invitations/accept`：§4。
- `POST /api/override` / `POST /api/override/delete`：書き込み。セッション（checkRevoked）→ テナント・ロール解決 → そのテナント配下の overrides に書く。
- `GET *`（描画）：セッション（ローカル検証）→ テナント解決 → `createFirestoreStorage({db, tenantId, teamId:'boys'})` と `'girls'` で2 storage 生成 → `buildPlanData({storage, girlsStorage, school: tenant.name})` → 既存 `pattern-*.mjs` の render → HTML。未ログインは /login へ、テナント未所有は /onboarding へ、未初期化は「準備中」。

### ローカル / E2E（無認証の口を維持）

- 本番判定は既存どおり `K_SERVICE`（`ENFORCE_AUTH`）。エミュレータ（K_SERVICE 無し）では認証強制を素通りする。
- エミュレータではテナントを `?t={tenantId}` または既定テナントで解決し、無認証で読み書きできる（現行 E2E の口を維持）。
- エミュレータのシードは最低2テナント投入し、分離を E2E で検証する（あるテナントの保存が別テナントに混入しないこと）。
- ローカル永続退避（`.emulator-data/overrides-local.json`）はテナント別（`overrides-local-{tenantId}.json` か tenantId キー付き配列）にする。

## 7. Gemini 第二意見で採用した補強（不可逆点のプレモーテム）

- **(a) 失効確認のコスト**：描画 GET 毎回の `verifySessionCookie(checkRevoked=true)` は Auth への RPC で TTFB を 150〜300ms 悪化させる。読みはローカル署名検証のみ、書き込み・ログイン時だけ失効確認する。
- **(b) 共有端末**：14日セッションは部室の共用端末で取り違え・置き忘れを誘発する。TTL を約1日にし、ログアウトを明示する。
- **(c) 招待スキーマの混在**：register と join を1スキーマで扱うと条件分岐の漏れで権限昇格しうる。MVP は register 一本。join は将来、別コレクションで物理分離する。
- **(d) tenantId 取り違え＝全テナント越境**：全 deny rules では実装バグを止められない。tenantId を必須にし空なら即 throw するスコープ付き storage を唯一のデータ経路にする。フラット集合のクエリは必ず明示 where（tenantId / userId）を付け非空を検証する。
- **(e) テンプレ初期化のトランザクション肥大化**：承諾 txn にテンプレ投入まで入れると競合・タイムアウトしやすい。txn は払い出し＋membership＋招待消費に絞り、テンプレは txn 外＋`initialized` フラグで制御する。

## 8. セキュリティ不変条件（実装・レビューのチェック項目）

- withTenant 相当の所属照合を通さない経路は、login / logout / lookup / accept / 静的ログイン画面だけ。これ以外は必ずテナント解決を通す。
- 作成・更新で tenantId / userId はサーバが強制セットし、クライアント値は構造的に落とす（ホワイトリスト採用）。
- 対象ドキュメント操作（override 保存・削除）は、対象 date がリクエスト解決済み tenantId 配下であることをパスで担保する（越境チェック）。
- セッション Cookie は HttpOnly / Secure / SameSite=Lax。SameSite=Lax によりクロスサイト POST にクッキーが乗らず CSRF を緩和。書き込みは同一オリジン fetch のみ。
- 招待トークンは生値を DB に残さない（SHA-256 のみ）。生値は応答とリンクにだけ。
- スーパー管理者（招待発行権）はプラットフォーム所有者だけ。`users.isSuperAdmin` で判定し、移行スクリプトでのみ付与する。

## 9. レビュー結果と残課題（敵対的セキュリティ＋正確性レビュー）

越境（別テナントの読み/書き/権限奪取）に直結する critical/high は発見されなかった。memberships 照合が唯一のテナントゲート・クライアント tenantId 不採用・空 tenantId fail-fast・accept の楽観ロックと token 消費・SHA-256 のみ保管・superadmin 限定 mint・SameSite=Lax が実装で成立していることを実コードで確認した。

レビューで挙がった中位以下の指摘のうち、次の3点を修正した。

- 複数所属コーチの保存が「いま見ているテナント」を運ばず保存できない問題（fail-closed だが脆い）。編集画面の保存・削除が現在URLの選択テナントを書き込み先へ引き継ぐようにした（サーバは在籍照合してから採用するため越境にはならない）。
- 無認証フォールバックがランタイム判定1つに全依存していた点。フォールバックをエミュレータ実行時に限定し、本番でランタイム判定が外れても無認証で全テナントが開かないよう fail-secure にした。フォールバックの権限からスーパー管理者を外した。
- 招待発行の発行者記録が欠落していた点。テナント文脈に認証済み利用者の識別子を載せ、発行者が記録されるようにした。

設計どおりとして据え置いた点（運用・将来対応）。

- 招待は「登録権」モデル。リンクを持つ最初の利用者に新テナントを払い出す（毎回新規作成で既存テナントの奪取は起きない）。意図した相手に渡すことを運用前提にし、相手をメールで束縛する強化は将来。
- 閲覧経路は失効確認なし（描画速度優先）。コーチの即時無効化は所属に退籍印を付ける運用で次リクエストから遮断される（これが一次手段）。アカウント側失効の即時反映が要るときだけ閲覧経路の確認強化を検討する。
- 招待照合は公開で有効性の手掛かりを返すが、トークンが256bitで総当りは非現実的。応答の最小化とレート制限は将来の強化項目。

## 10. 検証状況

- エミュレータ実走（無認証経路）でテナント分離を16項目データ層検証（テナント別描画・書き込みのテナントスコープ・旧トップレベル経路不使用・削除のスコープ・drills 共有）。
- ユニット198件すべて通過（storage テナントスコープ・tenant-resolve 分岐・invitations の mint/lookup/accept・session 検証・既存エンジン/描画）。
- 認証・セッション・招待 accept は本番（K_SERVICE）でのみ稼働するためエミュレータでは走らない。ユニット＋コードレビューで担保し、本番疎通は本番デプロイ後の1クリック確認に寄せる（既存の未解決判断点と整合）。
- 静的ビルド・esbuild バンドル（新規モジュール取り込み）成功。
- 本番デプロイ・本番データ移行はオーナー Go まで未実行（不可逆・現公開URLの挙動が変わるため）。
