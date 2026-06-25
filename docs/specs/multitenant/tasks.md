# マルチテナント化 — タスク

> 1タスク=1検証可能な変更。Git は触らない（オーナー方針・作業ツリーのみ）。本番デプロイ・本番移行はオーナー Go まで保留。
> エンジン（engine/src の loadModel/allocate/gap/annualPlan）と描画（pattern-*.mjs・render-shared.mjs の描画ロジック）は無改変。変更はデータ境界・認証・配線に閉じる。

## A. データ境界（テナントスコープ）

- A1. `engine/src/storage.js`：`createFirestoreStorage({db, tenantId, teamId})` に変更。teams/input/annualPlan/overrides を `tenants/{tenantId}/...` 配下へ。drills は据え置き。先頭に `if(!tenantId) throw` を追加（空 tenantId 禁止）。コレクション規約コメントも更新。
- A2. `ui/plan-data.mjs`：`buildPlanData({storage, girlsStorage, school})` に `school` 引数追加。学校名ハードコード（`school:'南中野中'` 付近）を `school ?? <従来値>` に置換。下流（render/plainText/build.mjs/title）は無改変であることを確認。
- A3. `engine/test` と `ui/overrides.test.js` 等：storage 契約変更に追従するユニットテストの更新（業務意図の検証を保つ。tenantId スコープで読み書きが閉じることを検証）。

## B. 認証（セッション Cookie）

- B1. `functions/session-auth.mjs`（新規）：`createSession(idToken)`→cookie 文字列、`clearSession()`、`verifySession(cookie, {checkRevoked})`→{uid,email}、`parseCookies(header)`、`serializeCookie()`。素 firebase-admin（getAuth）で実装。HttpOnly/Secure/SameSite=Lax、TTL≈24h。
- B2. `functions/index.mjs`：`POST /api/session/login`（verifyIdToken checkRevoked→createSessionCookie→Set-Cookie）、`POST /api/session/logout`（revoke→クリア→/login）。
- B3. `ui/auth-client.mjs`：ログイン成功時に ID トークンを `/api/session/login` へ POST しセッションを確立する経路を追加（既存の __getIdToken/E2E override は維持）。ログアウトボタンは `/api/session/logout`。

## C. テナント解決・認可

- C1. `functions/tenant-resolve.mjs`（新規）：`resolveTenantContext(db, uid, requestedTenantId?)`→`{tenantId, role, isAdmin, isSuperAdmin}` or null。memberships（userId==uid・在籍中）→ 0件/1件/複数件の分岐。複数時は requestedTenantId を在籍照合。users.isSuperAdmin 解決。クライアント tenantId は信用しない。
- C2. `functions/index.mjs` 描画 GET：セッション（ローカル検証）→ resolveTenantContext → storage 2本（boys/girls）→ buildPlanData（school=tenant.name）。未ログイン→/login、未所有→/onboarding、未初期化→「準備中」。
- C3. `functions/index.mjs` 書き込み API：セッション（checkRevoked）→ resolveTenantContext → owner ロール確認 → `tenants/{tid}/overrides/{date}` に書く。`assertEditor`（単一許可リスト）をテナント所有者スコープに置換。

## D. 招待登録（register 一本）

- D1. `functions/invitations.mjs`（新規）：`generateToken()`（randomBytes32 base64url）、`hashToken()`（SHA-256 hex）、`mintInvitation(db, ctx, {role,grantAdmin})`（スーパー管理者のみ・tokenHash 保存・joinUrl 返却）、`lookupInvitation(db, token)`（公開・{valid,kind,expired}）、`acceptInvitation(db, uid, token)`（txn 最小：払い出し＋membership＋users upsert＋消費／テンプレは txn 外）。
- D2. `functions/tenant-template.mjs`（新規）：新テナント初期化テンプレ（汎用シーズン annualPlan＋男女2チーム config＋team-input）。実校名を含めない合成値。`initializeTenant(db, tenantId)`→投入後 `initialized=true`。
- D3. `functions/index.mjs`：`POST /api/invitations`（管理者）、`POST /api/invitations/lookup`（公開）、`POST /api/invitations/accept`、`GET /join`（承諾画面）、`GET /onboarding`（テナント未所有/選択）。

## E. UI（新規画面・hallmark 準拠）

- E1. `ui/login.mjs`（新規）：ログイン画面 HTML/CSS。Google でログインボタン。emoji 禁止・border-left/top 色帯禁止・既存デザイン言語に合わせる。
- E2. `ui/join.mjs`（新規）：招待承諾画面 HTML/CSS。token を読み lookup → sign-in → accept → 自テナントへ。全状態（有効/期限切れ/無効/承諾済み/処理中）を持つ。
- E3. `ui/tenant-picker.mjs`（新規・複数所属時のみ）：在籍テナント選択。MVP は1所属前提のため最小（無くても可・複数時のフォールバック）。
- E4. hallmark audit を E1-E3 に通し検出ゼロまで自己修正。

## F. シード・移行・設定

- F1. `scripts/seed-firestore.mjs`：テナント別シードに一般化。最低2テナント（現行校＋分離検証用テスト校）＋users/memberships を投入。drills は据え置き。ローカル退避をテナント別に。
- F2. `scripts/migrate-to-multitenant.mjs`（新規）：本番一度きり・冪等。既存トップレベル（teams/annualPlan/overrides）→ 最初のテナント配下へ移送、所有者を owner+superadmin、移送後に旧トップレベル削除。所有者 uid は環境変数。
- F3. `firestore.indexes.json`：memberships（userId・tenantId）、invitations（tokenHash）の複合/単一インデックスを追加。
- F4. `functions/index.mjs` のビルド（esbuild）に新規 mjs が取り込まれることを確認（`--packages=external` 維持・engine/ui/新規 functions モジュールは取り込み）。

## G. 検証

- G1. ユニット：storage テナントスコープ、tenant-resolve の分岐、invitations の token/accept、越境拒否。
- G2. エミュレータ E2E：2テナント分離（テナントAの保存がBに出ない）、未ログインで /login 誘導、招待 accept で空テナント払い出し＋叩き台表示、書き込みが所有者スコープに閉じる。
- G3. セキュリティレビュー（敵対的・テナント越境観点）：§8 セキュリティ不変条件を全項目突合。tenantId 取り違え経路の有無、所属照合を通さない経路の棚卸し。

## 実装順

A → B → C → D/E（並行可・E は契約だけで先行可）→ F → G。
A1 と C/D は storage 契約を共有するので A1 を先に確定する。
