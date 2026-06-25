# 引継資料: 本番デプロイ・編集ログイン（Google）・E2E認証口／次はマルチテナント化（2026-06-24）

> 同日付の前資料 `handoff-20260624-editor-dnd-and-today-default.md` の続き。前資料の引継指示のうち、今日(水6/24)メニュー復元＝**ローカル永続化で恒久解決**（再作成不要）、ローカル保存・復元ツール導入＝**完了（恒久解決）**、本番デプロイ＝**完了**。ドリル候補の絞り込み＝**未着手のまま継続**（本資料にも残す）。
>
> ⚠️ このリポジトリはオーナー方針で **Git を触らない（commit/push しない）**。本セッションのコード変更はすべて作業ツリーのみ（git 未反映）。本番へは作業ツリーから直接デプロイ済み。

---

## 概要

### このセッションで達成したこと（行動変容）
コーチの練習計画ツールが**本番公開**され、どこからでも開いて印刷でき、編集内容は本番DBに恒久保存されるようになった（公開URL: https://ai-bb-coach.web.app ）。編集は本番ではコーチのGoogleログインを通した人だけが可能で、閲覧・印刷は誰でもできる。あわせてローカル開発の「再起動でコーチ編集が消える」問題を根本解決し、編集UIの4つの不具合と印刷レイアウト2点も直した。

### なぜやったか
オーナーから、編集UIのバグ修正→印刷レイアウト調整→「再起動で消える仕組みを直せ」→「本番DBを使え＝本番デプロイ」→「コーチは ai-bb-coach に」→「E2E用にAuthを使わない口を作れ」と段階的に要求が出た。本番DBを使う＝デプロイなので、専用プロジェクト ai-bb-coach に隔離デプロイし、編集の安全のためGoogleログインを付けた。

---

## 実装した機能

### 1. 編集UIの4バグ修正（`ui/editor.mjs`）
- **編集中の別日移動を無効化**: 編集パネルを開くと日/週/月の移動ボタン（`.cal-go`/`.cal-go-week`/`.cal-go-month`/`.lvtab`）を `disabled` にし、保存・キャンセルで戻す。元から無効な物は触らない（`navLocked` に自分が止めた物だけ記録）。二重で開かないガードも追加。
- **時間帯追加で開始=直前の終了**: `add-row` で直前行の `to` を新行の `from`/`to` の既定にする。
- **開始入力で終了を追従**: `onPanelChange` で `[data-k="from"]` 変更時、終了が空 or 開始より前のときだけ `to=from`（妥当な終了は壊さない）。
- **他の日からコピー**: `copyFromOptions()` で既存コーチ日（PREFILL）を選び `copy-from` で丸ごと取り込み（上書き前 `confirm`、日付・曜日はこの日のまま）。

### 2. 印刷レイアウト2点（`ui/render-shared.mjs`）
- 日ヘッダを `dh-main`（日付＋狙い）と `dh-goals`（月/週目標）に分割。**印刷時のみ** `.dayhead` を flex 横2分割にし、右に月/週目標を出して縦の行を稼ぐ。日付↔狙いの間隔も詰めた（`dh-aim` margin 5px）。
- 月/週目標の間に1行空け（`.dh-goals` gap 14px）。タイムライン終了行のサブ文言「今日の振り返りひとことで解散」を全箇所（`pattern-timeline.mjs` 3種・`editor.mjs` 複製・`render-shared.mjs` plainText 5箇所）から削除し「終了」だけに。
- `goalsBar()` の旧印刷帯（`goalbar-pr`）は撤去。`dayHeader(pd, month, goals)` に第3引数 `goals` を追加（`pattern-timeline.mjs` の呼び出し2箇所も更新）。編集側の再描画 `dayHeaderHtml` も同構造＋データアイランドに `goals` を追加。

### 3. ローカル永続化の根本解決（再起動でも消えない）
- **背景**: エミュレータの名前付きDB（basketball-strategy-db）は組み込み export/import で永続化できない（今回 `emulators:export` がメタデータのみ・中身空で確定）。
- **解決**: 保存・削除API（`functions/index.mjs`）が、エミュレータ実行時だけ `.emulator-data/overrides-local.json` へ書き写し（write-through）、起動シード（`scripts/seed-firestore.mjs`）が git 種データの上にそのファイルを上書き復元（restore overlay）する。これで保存のたびに即ファイル化＋再起動で復元。
- `.emulator-data/` は gitignore 済み。`LOCAL_STORE` はソース/バンドルどちらから起動しても repo 直下を指すよう上方探索（`resolveLocalStore()`）。本番（`FIRESTORE_EMULATOR_HOST` 未設定）では write-through は no-op（本番Firestoreは元から永続）。
- `package.json`（ローカル足場・gitignore）の `emulate` を「バンドルビルド→ emulators:exec → seed＋restore → 常駐」に更新。

### 4. 本番デプロイ（専用プロジェクト ai-bb-coach・隔離）
- **同梱（vendoring）**: `functions/index.mjs` は `../engine ../ui` と外部の firebase-kit vendor（SortableJS）を相対 import する。デプロイ用に esbuild で単一バンドル `functions/dist/index.mjs` を生成（`--packages=external` で engine/ui/sortable だけ取り込み、firebase-admin/express等は外部）。`firebase.json` の predeploy が毎回ビルド（stale配信防止）。
- **build.mjs の罠回避**: 静的ビルド専用の総なめ動的 import（`import('./'+f)`）を esbuild が非JSまで束ねようとして失敗するため、純関数 `renderPage` を glob を持たない `render-shared.mjs` へ移設し、functions の取り込みグラフから build.mjs を外した。
- **Firestore**: 本番に名前付きDB basketball-strategy-db（asia-northeast1）を作成。rules はクライアント直全deny（Admin SDK経由のみ）。drills 216・teams 2・annualPlan 1・コーチの現メニュー（火6/23・水6/24・木6/25=8ブロック）を投入済み。
- **デプロイ済み資産**: HTTPS関数 `render`（asia-northeast1・Node22 2nd Gen）／Hosting（`**`→render rewrite）／Firestore rules。`.firebaserc` に prod エイリアス（ai-bb-coach）追加（default は引き続き demo-… でエミュ用）。

### 5. 編集ログイン（Google）＋E2E認証不要口
- **本番のみ認証**: サーバ（`functions/index.mjs` の `assertEditor`）は **`K_SERVICE` がある本番実行時だけ** Bearer の Firebase ID トークンを検証し、許可アカウント（`ALLOWED_EDITORS` 既定=オーナーのGoogleアカウント1名・コード内定数）以外を 403。emulator・単体テストは `ENFORCE_AUTH=false` で素通り。
- **クライアント**: 新規 `ui/auth-client.mjs`。本番ページのみ Google ログインUIを右上に注入（firebase は CDN から1コピーだけ＝二重ロード回避）。`window.__getIdToken()` を公開し、`editor.mjs` の保存・削除が `withAuth()` で Bearer を付ける（ローカルは未定義＝ヘッダ無し）。
- **E2Eの口**: ローカル/emulator はログイン不要で書き込み可（兄弟スコアアプリと同型）。本番に対する E2E は `window.__e2eAuthOverride = { idToken }` を仕込めば Google ポップアップ無しで書き込み経路を試せる。

---

## 主要ファイル（変更箇所）

| ファイル | 役割・変更点 |
|---|---|
| `ui/editor.mjs` | 4バグ修正（ナビ無効化・新行既定・終了追従・日付コピー）／印刷ヘッダ複製を同構造化＋goals追加／保存・削除に `withAuth` で Bearer 付与／終了サブ文言削除 |
| `ui/render-shared.mjs` | `dayHeader` に goals 引数＋印刷横2分割CSS／`renderPage` を本ファイルへ移設／`goalsBar` の旧印刷帯撤去／plainText の終了文言削除 |
| `ui/pattern-timeline.mjs` | `dayHeader(pd, month, goals)` 呼び出し更新／終了サブ文言削除 |
| `ui/build.mjs` | `renderPage` を render-shared から import に変更（定義は移設） |
| `ui/auth-client.mjs`（新規） | 本番限定Googleログインクライアント＋`__getIdToken`＋E2E override口＋AUTH_CSS |
| `functions/index.mjs` | write-through/restore 用ローカル退避／本番のみ `assertEditor`（ID トークン＋許可リスト）／本番のみログインUI注入／renderPage を render-shared から取得 |
| `functions/package.json` | main=dist/index.mjs・build=esbuild バンドル |
| `scripts/seed-firestore.mjs` | ローカル退避ファイルからの復元オーバーレイ／`PROD_SEED=1` で本番シード許可 |
| `firebase.json` / `.firebaserc` | （既存）predeploy ビルド・Hosting rewrite／prod エイリアス ai-bb-coach 追加 |
| `package.json`（ルート・gitignore） | `emulate` をビルド→seed→restore→常駐に |

---

## コミット一覧
本セッションの変更は**すべて git 未コミット**（オーナー方針「Git を触らない」）。基準コミットは `e8303df`（前資料）。作業ツリーの差分一覧は上の主要ファイル表のとおり。本番へは作業ツリーから直接デプロイ済み。

> 次セッションで Git を整備する場合、論理単位の目安: ①編集UIの4バグ ②印刷レイアウト2点 ③ローカル永続化（write-through＋restore） ④本番デプロイ基盤（vendoring/firebase設定） ⑤編集ログイン（auth-client＋サーバゲート）。

---

## 本番稼働状況
- **公開URL**: https://ai-bb-coach.web.app （`?p=timeline`・今日始まりで開く）
- **プロジェクト**: ai-bb-coach（専用・Blaze課金リンク済み）。スコアアプリ ai-basketball-coach-15c78 には一切触れていない。
- **関数**: `render`（asia-northeast1・2nd Gen）。Hosting が全パスを render に rewrite。
- **Firestore**: 名前付きDB basketball-strategy-db（asia-northeast1）。drills/teams/annualPlan＋コーチの現メニュー3日を投入済み。
- **認証**: Firebase Auth の Google ログインはオーナーがコンソールで有効化済み。許可アカウントは1名（コード内 `ALLOWED_EDITORS` 既定値）。
- **Web公開設定（apiKey/authDomain/projectId）**: コード内に定数で保持（apiKey はクライアント用の公開値＝秘密ではない）。

---

## 動作確認済み（2層）

### 形式整合層（機械検証）
- `node --test` 全通過・`node ui/build.mjs` 成功・esbuild バンドルの構文OK・engine/ui/sortable/認証コードがバンドルに取り込まれていることを実数確認。
- 印刷修正は Playwright（media=print）で実機確認（日ヘッダ横2分割・月/週の改行・「終了」のみ・日付↔狙いの詰め）。

### 意味価値層（メイン直の実機・本番URL）
- 本番 GET 200・印刷修正反映・コーチ実データ表示・**認証なし書き込みは 401**（誰でも書ける状態でないことを確認）。
- ローカルは**ログインUIを出さない**・**認証なし書き込みが 200**（E2Eの口）・**再起動後に木6/25=8ブロックが復元**することを確認。
- 一時作成した管理用SAキーは使用後すぐ削除済み。

---

## 未解決の判断点

各項目「項目／待ち先／背景／決まったらやること」。

1. **本番の実Googleログイン疎通（最終確認）**
   - 待ち先=オーナー。背景=ログインのポップアップ実行はオーナーのアカウントでしか試せない（サーバの許可判定・401ゲートはメイン確認済み）。決まったら=本番ページ右上「Googleでログイン」を押して編集・保存できるか1回確認。無反応なら CDN の Firebase 版（`ui/auth-client.mjs` の `FB_VERSION='12.0.0'`）を差し替える。
2. **マルチテナント化の方針詳細**（下記「次セッション指示」で着手）
   - 待ち先=一部オーナー（後述の設計判断）。背景=現状は単一チーム（南中野中）の共有データで、コーチ仲間が各自のチーム計画を作れない。
3. **ドリル候補の絞り込み**（前資料からの未着手）
   - 待ち先=オーナー。背景=編集画面の大枠7種とドリルのカテゴリ12種が1対1でない。エンジンの枠判定（`engine/src/allocate.js` の `blockOf`）を再利用すれば枠別候補に絞れる。唯一の論点はフィニッシュ16件の分割（習得系8→ファンダ・反復系8→シュート）を編集候補でも踏襲するか。

---

## 既知の注意点・未対応項目

| 優先 | 内容 |
|---|---|
| 高 | 本番の実Googleログイン疎通が未確認（オーナーの1クリック確認待ち）。 |
| 高 | データは単一テナント（コーチ仲間への配布＝マルチテナント化が必要）。 |
| 中 | 本セッションの変更は git 未コミット（オーナー方針）。Git整備時は本番デプロイ済み内容と作業ツリーが一致している前提で論理単位コミットする。 |
| 中 | 本番デプロイは作業ツリーから直接。`firebase deploy` は一過性の「Internal error」を返すことがある（リトライで成功）。**exit code でなくログ本文の Error 行で成否判定**する。 |
| 低 | ドリル候補の絞り込み未実装。 |
| 低 | ローカル Java は可搬JRE（`~/tools/jre21/jdk-21.0.11+10-jre`・JAVA_HOME 要設定）。emulate はこの JAVA_HOME 前提。 |

---

## 開発中に得た教訓

### 1. functions が repo 外/上位の共有コードを import するなら esbuild 単一バンドル＋main=dist
- 何が起きた: functions が `../engine ../ui` と外部 firebase-kit を相対 import。デプロイは functions/ しか上げないため実行時に解決不能。esbuild バンドルで根治したが、build.mjs の静的ビルド専用 `import('./'+f)` を esbuild が非JSまで束ねようとして失敗した。
- 再発防止: Cloud Function から再利用する純関数は、総なめ動的 import を持つモジュールから切り出し、glob の無いモジュールに置く。同梱はバンドルで、`--packages=external` で node_modules を外部化、predeploy で必ずビルド。
- 反映先候補: wasurenagusa（firebase 横断）。

### 2. 認証は本番だけ・ローカル/E2Eは無認証の口を最初から用意
- 何が起きた: オーナーが「E2EでAuthを使わない口を作れ、Authは本番だけ」と明示。兄弟スコアアプリと同型。
- 再発防止: 認証ゲートは `K_SERVICE`（本番ランタイム）でのみ強制し、emulator/テストは素通り。クライアントのログインUIも本番のみ注入。E2E は override 口（`window.__e2eAuthOverride`）でポップアップ回避。
- 反映先候補: wasurenagusa（firebase 横断）。

### 3. 名前付きFirestore（emulator）は組み込みexport/importで永続化できない→保存時ファイル書き写し＋起動時復元
- 何が起きた: 名前付きDBは `emulators:export` がメタデータのみ・中身空。再起動でコーチ編集が消える事故の温床。
- 再発防止: 保存APIで gitignore 済みローカルファイルへ write-through、起動シードで restore overlay。本番（実Firestore）では no-op。
- 反映先候補: wasurenagusa（firebase 横断）。

---

## 次セッションへの引継指示

優先順（上が高い）:

1. **マルチテナント化（最優先・オーナー指示）**
   - 目的: コーチ仲間に配布し、各自が自分のチームの計画を作れるようにする。
   - 現状（単一テナント）: `functions/index.mjs` が `BOYS_TEAM='minami-nakano-boys'`/`GIRLS_TEAM='minami-nakano-girls'` をハードコード。`overrides` は日付キーの単一コレクション。`teams` は2ドキュメント。ユーザー単位の分離なし・閲覧は公開・書き込みは1名許可リスト。
   - **着手前に必ず**: 兄弟プロジェクト ai-basketball-coach（スコアアプリ）が**マルチテナント実装済み**（E2E に `E2E_TENANT_ID`/`tenantRole`、`functions/src/routing/api-router--wire--master-crud.ts` の `getAuthInfo` が `{uid, tenantId}` を返す）。行動原則9に従い、その租户モデル（テナント作成・所属・権限）を1対1で読んでから設計する。
   - やること（設計→合意→実装）: ①データをテナント（コーチ/チーム）単位に分離（`tenants/{tenantId}/...` か teamId 前缀）②サインアップ＝任意のGoogleユーザーが自分のテナントを作成③Firestore rules と read/write をテナント所有者にスコープ（現状は read 公開・write 1名許可）④エンジン/描画/編集画面を tenantId でパラメタ化⑤既存の南中野中データを最初のテナントへ移行。
   - 経路C（新機能・横断改修・認証/権限・データ設計）。service-designer→architect→実装→QA→SCM＋security-engineer を招聘し、Spec三点を作る。データ設計とrulesは不可逆性が高いので Gemini融合パネルにかける。

2. **本番の実Googleログイン疎通確認**（オーナーが1回押す）。無反応なら `ui/auth-client.mjs` の `FB_VERSION` を差し替えて再デプロイ。

3. **ドリル候補の絞り込み**。`engine/src/allocate.js` の `blockOf` 再利用、フィニッシュ16件の分割踏襲の可否確認から。

4. **Git整備（オーナーがGoを出したら）**。本セッションの作業ツリー差分（本番デプロイ済み内容）を上記「コミット一覧」の論理単位でコミット。push 前に `/code-review`（high）。

> デプロイ手順メモ（次セッター用）: `npx firebase-tools@15.22.0 deploy --only functions,hosting,firestore --project ai-bb-coach`（predeploy で esbuild バンドル自動生成）。本番シードは一時SAキー＋`PROD_SEED=1 GCLOUD_PROJECT=ai-bb-coach GOOGLE_APPLICATION_CREDENTIALS=<key> node scripts/seed-firestore.mjs`（使用後キー削除）。デプロイ成否はログ本文の Error 行で判定。
