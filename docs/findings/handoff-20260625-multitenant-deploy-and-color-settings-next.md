# 引継資料: マルチテナント化の実装・本番デプロイ・移行完了／次はドリル絞り込みとカラーセット設定（2026-06-25）

> 前資料 `handoff-20260624-prod-deploy-and-auth-and-multitenant-next.md` の続き。
> 前資料の「次セッション指示」のうち、①マルチテナント化＝**完了（本番デプロイ・移行・push 済み）**、
> ②本番の実Googleログイン疎通＝**環境整備済み・オーナーの1クリック確認待ち（継続）**、
> ③ドリル候補の絞り込み＝**未着手（継続）**、④Git整備＝**完了**。
>
> 本セッションでは前資料と異なり Git を整備した（オーナー明示Go「ぜんぶやれ」）。作業ツリーの全差分を論理2コミットに分けて origin/main へ push 済み。

---

## 概要

### このセッションで達成したこと（行動変容）
練習計画ツールが単一テナント（1校・男女2チーム固定・閲覧公開・編集1名）からマルチテナントになった。本番（https://ai-bb-coach.web.app ）は「ログインしないと計画は見えない／各コーチは自分のチームだけ読み書き」に切り替わり、招待リンクを承諾した新規コーチには専用の空テナントが払い出されて即エンジンの叩き台が出る。既存の現行校データは最初のテナントへ移行し、オーナーのアカウントを所有者＋発行権限者として紐付けた。実装はエミュレータ実走20項目＋本番実機で検証し、敵対的セキュリティレビューと /code-review(high) を通して実バグ9件を修正してからデプロイ・push した。

### なぜやったか
オーナーから「全力でマルチテナント化して」→（実装完了後）「ぜんぶやれ」で本番反映・移行・Git整備まで明示Go。コーチ仲間に配布し、各自が自分のチームの計画を独立して作れるようにするのが目的。

---

## 実装した機能

### 1. データモデル（名前付き Firestore: basketball-strategy-db）
- **グローバル（フラット・テナント非依存）**: `drills/{drillId}`（共有カタログ216件・不変）、`users/{uid}`（authUid・isSuperAdmin）、`memberships/{id}`（tenantId・userId・role・isAdmin・leftAt?）、`invitations/{id}`（tokenHash・kind='register'・role・grantAdmin・expiresAt・status）。
- **テナント配下サブコレクション**: `tenants/{tid}`（name=学校名・status・initialized・createdBy）、`tenants/{tid}/teams/{boys|girls}`、`tenants/{tid}/teams/{teamId}/input/latest`、`tenants/{tid}/annualPlan/current`、`tenants/{tid}/overrides/{date}`。
- 業務データをサブコレクション化した理由: doc ID=date を保ったままテナント間の同日衝突を物理的に消すため。管理データをフラットにした理由: userId 横断クエリ（自分の所属一覧）とトークン照合のため。drills は普遍カタログなので共有。

### 2. データ境界（storage 層）— エンジン・描画は無改変
- `engine/src/storage.js` の `createFirestoreStorage({db, tenantId, teamId})` 化。teams/input/annualPlan/overrides を `tenants/{tenantId}/...` 配下から読む。drills はグローバル据え置き。**先頭で空 tenantId / teamId を throw**（全 deny rules では止められない越境事故の最後の砦）。
- `ui/plan-data.mjs` の `buildPlanData({storage, girlsStorage, school})` に school 引数追加。描画ロジックは無改変（school は tenant.name から流す。下流 render/plainText/build/title は data.school 経由で無改変）。

### 3. 認証（SSR・セッション Cookie 方式）
- Google sign-in → ID トークン → `POST /api/session/login` でサーバが verifyIdToken(checkRevoked=true)→createSessionCookie→`__session`（HttpOnly/Secure/SameSite=Lax/TTL≈24h）。Cookie 名は `__session` 固定（Firebase Hosting が Function へ転送する唯一の Cookie 名）。
- 描画 GET は verifySessionCookie(checkRevoked=false)＝ローカル署名検証のみ（毎回の Auth RPC を避け TTFB を守る）、書き込み・ログアウトは checkRevoked=true。
- テナント解決は `memberships` 照合が唯一のゲート（クライアント送信 `?t` は在籍照合を通った時だけ表示選択に使う）。ロール認可と管理者フラグ（isAdmin/isSuperAdmin）は直交2系統。
- ログイン中はページ読込時にセッションを自動再確立（約24h失効後の再読込でサイレント401を予防）。

### 4. 招待登録（register 一本・新規テナント払い出し）
- 発行（スーパー管理者のみ）: `POST /api/invitations` → 256bit乱数(base64url)生成・DBは SHA-256 の tokenHash のみ保存・joinUrl 返却。リンク基点は `APP_BASE_URL`（未設定時のみリクエストオリジン）。
- 照合（公開）: `POST /api/invitations/lookup`。承諾: `POST /api/invitations/accept`（最小 txn＝払い出し＋membership＋users upsert＋招待消費）。テンプレ初期化は txn 外。**初期化失敗は描画 GET が initialized:false を検知して冪等に自己修復**（accept ハンドラは try/catch で囲み応答ハングを防止）。

### 5. UI 画面（新規・hallmark 準拠）
- `ui/login.mjs`（ログイン）、`ui/join.mjs`（招待承諾・全状態）、`ui/tenant-picker.mjs`（複数所属時の選択・学校名表示）、`ui/auth-client.mjs`（本番ページに注入する認証UI＝ログイン状態表示＋ログアウト＋__establishSession＋__getIdToken）。
- 本番描画ページに `authClientHtml(WEB_CONFIG)` を注入（CSS だけでなく本体スクリプトも）。色は既存トークン（--orange-deep 系）のみ・emoji/border色帯/汎用AIっぽいデザインなし。

### 6. 移行・シード・設定
- `scripts/migrate-to-multitenant.mjs`（本番一度きり・冪等）: 旧トップレベル（teams/annualPlan/overrides）→ 最初のテナント配下へコピー、所有者を owner+superadmin、所有者 uid は環境変数（OWNER_UID か OWNER_EMAILS を Auth 解決・無ければ作成）。旧データ削除は `MIGRATE_DELETE_LEGACY=1` の二重ガード（config と input それぞれ移送先存在を確認してから削除）。
- `scripts/seed-firestore.mjs`: 最低2テナント（tenant-genchi/tenant-test）のエミュレータ用シード。**initialized 済みテナントは合成テンプレで上書きしない安全弁**（PROD_SEED 誤実行で移行済み実データを潰さない）。
- `firestore.indexes.json`: memberships(userId+tenantId) 複合インデックス。

### 主要ファイル
| ファイル | 役割 |
|---|---|
| `engine/src/storage.js` | テナントスコープ化したデータ境界・空 tenantId fail-fast |
| `ui/plan-data.mjs` | buildPlanData に school 引数 |
| `functions/index.mjs` | 配線（セッション・テナント解決・招待・描画自己修復・認証UI注入） |
| `functions/session-auth.mjs` | セッション Cookie 生成/検証/クリア |
| `functions/tenant-resolve.mjs` | memberships 照合でテナント・ロール解決 |
| `functions/invitations.mjs` | 招待 mint/lookup/accept（register） |
| `functions/tenant-template.mjs` | 新テナント初期化テンプレ（合成値・実校名なし） |
| `ui/login.mjs` `ui/join.mjs` `ui/tenant-picker.mjs` `ui/auth-client.mjs` | 認証系UI |
| `scripts/migrate-to-multitenant.mjs` `scripts/seed-firestore.mjs` | 移行・シード |
| `docs/specs/multitenant/{requirements,design,tasks}.md` | Spec三点 |
| `e2e/_verify-multitenant.mjs` | 2テナント分離のE2E検証（gitignored・ローカル助っ人） |

---

## コミット一覧（main・push 済み）
| ハッシュ | 内容 |
|---|---|
| 67ce363 | feat: 本番デプロイ基盤と出荷前の印刷レイアウト調整 |
| 0c7207c | feat(multitenant): テナント分離・閲覧ログイン必須・招待リンク登録 |

基準コミットは `e8303df`。本セッションの全差分はこの2コミットに含まれ origin/main へ反映済み（未マージなし）。

---

## 本番稼働状況
- **公開URL**: https://ai-bb-coach.web.app （未ログインは /login へ302）。
- **プロジェクト**: ai-bb-coach（専用）。関数 `render`（asia-northeast1・Node22 2nd Gen）を本セッションで2回 update デプロイ（初回＋レビュー修正後）。Hosting rewrite（**→render）・Firestore rules（全deny・不変）・indexes（memberships複合）も反映済み。
- **移行済みデータ**: `tenants/tenant-genchi`（name=現行校・initialized:true）配下に男女2チーム config＋input・annualPlan・overrides。所有者の実 uid を owner+isAdmin の membership ＋ users.isSuperAdmin で紐付け。drills216はグローバル共有。
- **旧トップレベルデータは温存**（コピー移行・未削除）＝旧コードへのロールバック余地を残してある。クリーンアップは `MIGRATE_DELETE_LEGACY=1` で別途実行可。
- **Secret Manager 変更なし**。移行時は firebase-adminsdk SA の一時鍵を作成・使用後即削除（IAM＋ローカル両方）。

---

## 動作確認済み
### 形式整合層（機械検証）
- ユニット全通過（storage テナントスコープ・tenant-resolve 分岐・invitations の mint/lookup/accept・session 検証・既存エンジン/描画）。
- esbuild バンドルに新規モジュール取り込み確認。静的ビルド成功。
- エミュレータ実走（無認証経路）で20項目: テナント別描画・書き込みのテナントスコープ・旧トップレベル経路不使用・削除のスコープ・drills 共有・未初期化テナントの自己修復（500でなく200・テンプレ投入・initialized:true化）。

### 意味価値層（メイン直の本番実機）
- 本番 GET `/`→302 `/login`、`/login`→200（Googleボタンあり）、`/join`→200、未認証 `POST /api/override`→401、未ログイン `/` に計画の漏れなし。
- 移行データを Admin SDK 直読みで実在確認（tenant-genchi 配下・membership・superadmin）。
- 認証・セッション・招待 accept は本番でのみ稼働するためエミュレータでは走らず、ユニット＋レビュー＋本番スモークで担保。

---

## 未解決の判断点
各項目「項目／待ち先／背景／決まったらやること」。

1. **本番の実Googleログイン疎通**（継続）。待ち先=オーナー。背景=Google popup はオーナー本人のアカウントでしか押せない（サーバの許可判定・移行紐付けはメイン確認済み）。決まったら=本番で1回ログインし自分の計画が出るか確認。無反応なら `ui/auth-client.mjs`/`ui/login.mjs`/`ui/join.mjs` の `FB_VERSION`（CDN の firebase 版）を差し替えて再デプロイ。
2. **ドリル候補の絞り込み（次セッション・別セッションで）**。待ち先=一部オーナー。背景=編集画面の大枠7種とドリルのカテゴリ12種が1対1でない。唯一の論点はフィニッシュ16件の分割（習得系8→ファンダ・反復系8→シュート）を編集候補でも踏襲するか。`engine/src/allocate.js` の `blockOf`（枠判定）を再利用すれば枠別候補に絞れる。
3. **カラーセット＝チームのメインカラー設定（次セッション・新規）**。待ち先=オーナー方針の具体化。背景=外部公開に向け、各テナントが自チームのメインカラーを選べるようにする。オーナーのメインカラーはオレンジ（既存 --orange-deep 系が既定）。UIは右上ログアウトの近くに歯車アイコンを置き「設定メニュー」を開いて色を選ぶ。決まったら=設定値を tenant doc に持たせ、描画のCSS変数（--orange 系）を tenant 設定で差し替える。マルチテナント基盤（tenants doc・本人ログイン必須・hallmark準拠UI）は実装済みなので、その上に乗せる。論点=選べる色のパレット（自由 or プリセット）・アクセント連動範囲。

---

## 既知の注意点・未対応項目
| 優先 | 内容 |
|---|---|
| 高 | 本番の実Googleログイン疎通が未確認（オーナーの1クリック確認待ち）。 |
| 中 | 旧トップレベルデータ（teams/annualPlan/overrides）が温存されている（ロールバック用）。安定確認後に `MIGRATE_DELETE_LEGACY=1` で掃除。 |
| 中 | セッション TTL 約24h・閲覧経路は失効確認なし（TTFB優先）。コーチ即時無効化は membership に退籍印（leftAt）を付けるのが一次手段（次リクエストで遮断）。 |
| 低 | `/healthz` が公開URL経由で404（縁で弾かれる・製品面に無関係。関数本体には経路あり）。 |
| 低 | 招待はレート制限・1ユーザーあたりテナント上限なし（256bitトークン消費で1:1。design §9 で将来強化と明記）。 |
| 低 | ローカル Java は可搬JRE（`~/tools/jre21/jdk-21.0.11+10-jre`・JAVA_HOME 要設定）。emulate はこの前提。 |

---

## 開発中に得た教訓
### 1. 不可逆な本番デプロイ前にも /code-review を通す（pushだけでなく）
- 何が起きた: 自前の2レンズレビュー（うち正確性レンズがプレースホルダ出力で実質空）だけで本番デプロイ＋移行したら、後から /code-review(high) が CONFIRMED の実バグを多数検出し、修正→再デプロイの手戻りになった。
- 再発防止: 本番反映の前に /code-review を通す。レビュー/finder成果が "test"・"a/b/c" 等のプレースホルダや空配列なら成果と見なさず即再実行する。
- 反映先候補: wasurenagusa（保存済み）。

### 2. Express 4 は async ルートハンドラの reject を拾わない
- 何が起きた: accept 後の `await initializeTenant(...)` を try/catch 外に置き、throw 時に応答が出ずクライアントがハングする設計だった。
- 再発防止: Express4 の async ハンドラ内の await は必ず try/catch で囲む（エラーミドルウェアが無い構成では特に）。
- 反映先候補: wasurenagusa（SSR型に含めて保存済み）。

### 3. firebase-kit の createSessionAuthGate は静的配信＋ドメイン許可用（CommonJS）
- 何が起きた: 動的SSR描画＋招待制マルチテナントには合わず、import せずセッションCookieの作法だけ踏襲して素 firebase-admin で自前実装した。
- 反映先候補: wasurenagusa（SSRマルチテナント認証の型として保存済み）。

---

## 次セッションへの引継指示
優先順（上が高い）:

1. **ドリル候補の絞り込み（最優先・オーナー指示「セッション変えてやって」）**
   - `engine/src/allocate.js` の `blockOf`（枠判定）を再利用して編集候補を枠別に絞る。フィニッシュ16件分割（習得系8→ファンダ・反復系8→シュート）の踏襲可否をオーナーに1問確認してから着手。経路Bか経路C（UI候補リストに触るなら ux/ui ゲート）。
2. **カラーセット＝チームのメインカラー設定メニュー（新規）**
   - 各テナントが自チームのメインカラーを設定でカスタマイズ。右上ログアウト付近に歯車アイコン→設定メニューを新設。設定値は tenant doc、描画CSS変数（--orange 系）を tenant 設定で差し替え。オーナーのメインカラーはオレンジ（既定）。emoji・border色帯・汎用AIっぽいデザイン禁止（design-hallmark 準拠）。経路C（UI追加・データ設計）。着手前に wasurenagusa「バスケ計画ツールのカラーセット設定」を引く。
3. **本番の実Googleログイン疎通**（オーナーが1回押す）。無反応なら `FB_VERSION` 差し替えて再デプロイ。
4. **旧トップレベルデータの掃除**（安定確認後）。`PROD_MIGRATE=1 MIGRATE_DELETE_LEGACY=1 ...` で旧 teams/annualPlan/overrides を削除。

> デプロイ手順メモ: `npx firebase-tools@15.22.0 deploy --only functions,hosting,firestore --project ai-bb-coach`（predeploy で esbuild バンドル自動生成）。本番Admin処理（移行等）は firebase-adminsdk SA の一時鍵（gcloud で会社アカウント `--account` 指定して作成・使用後即削除）。デプロイ成否はログ本文の Error 行で判定。ローカル検証は JAVA_HOME 設定の上で `emulators:exec ... "node scripts/seed-firestore.mjs && node e2e/_verify-multitenant.mjs"`。
