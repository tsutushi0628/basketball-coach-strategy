# 引継資料: 週/月/年の目標編集・週ビューへのコーチ編集反映・学校名変更を本番出荷／2アプリ統合の設計のみ（2026-06-26）

> 前資料 `handoff-20260625-candidate-narrowing-and-color-theme.md` の続き。
> 前資料の「次セッション指示」の継承状況は本書「未解決の判断点」に記す。
>
> 本セッションは計画ページのコーチ編集系3機能を実装して本番（https://ai-bb-coach.web.app ）へデプロイ・push まで完了し、
> 別タスクとして試合記録アプリと計画アプリの1プロジェクト統合の設計書を1本追加した（統合は設計のみ・未実行）。

---

## 概要

### このセッションで達成したこと（行動変容）

コーチが計画ページの目標テキスト（月の目標／週の焦点／今月やること／年アークの各月見出し）をその場で編集して保存できるようになった。
保存後はページ再読込で週・月・年の全タブが同じ内容に整う。
月タブで月の目標を直すと、年タブの同じ月のセルにも同時に反映される（両者は同一の源を見ているため）。
コーチが日単位で組んだ予定（コーチ指定日）が、これまで週ビューで空欄になっていたのを、時間ブロックとして週グリッドに出るよう直した。
右上の歯車を「チーム設定」に広げ、管理者が学校・チーム名をその場で変更できるようにした。
3機能とも本番へ反映済みで、敵対的セキュリティレビューを兄弟リポ差分に対して実走してから出荷した。

### なぜやったか

外部公開（コーチ仲間への配布）に向けて、各テナントが叩き台の計画を自分の言葉に直し、コーチ自身が組んだ日が週ビューでも見え、自チーム名で使える状態にするため。
統合設計は、製品方針が「試合記録アプリと計画アプリを1製品に統合する」に確定したことを受け、移行の全体像と最大リスクを先に文書で固めるため。

---

## 実装した機能

### A. 週/月/年の目標編集

計画ページの目標テキストを表示位置のままインライン編集し、保存APIへ送ってバックエンド（Firestore・Admin SDK経由）に保存する。
クライアントからのFirestore直書きはrulesで全denyのまま。
保存後はページ再読込で、サーバがFirestoreから読んだ同じ内容に全タブが整合する。

データモデルの要点（設計確定済み）:

- **週の焦点**は週起点日キー（`YYYY-MM-DD`）の `weeks` マップ。各週だけに効く。
- **月の目標と年アークの各月見出しは同一源**（`annual.months[arcMonth].headline`）。だから両者はarc月キー（`"1"`〜`"12"`）の同一マップ `arcMonths` で扱う。月タブで月の目標を編集すると、年タブの同じarc月セルにも反映される（単一真実源・正しい挙動）。
- **空文字保存で該当キーを削除**＝叩き台（エンジン値）へ戻す。マップに残る値は必ず非空。

保存先は `tenants/{tid}/goalOverrides/current`（`weeks` / `arcMonths` の2マップフィールド）。
保存API `POST /api/tenant/goal {scope:'week'|'month', key, text}` は `owner` ロール認可。
`scope`/`key`/`text` の厳密判定（enum・キー文字種・200字上限）はすべてコード側の純判定（`goalWriteDecision`）に閉じ、`text` 空文字のときだけ `FieldValue.delete()` で該当キーを消す（mergeで他キーを壊さない）。
描画側は対象要素に `data-goal-edit` / `data-goal-scope` / `data-goal-key` 属性を埋め、`ui/goal-editor.mjs` のクライアントIIFEが編集ボックスを差し込む。
年タブのarc月セルは狭いので、セル内インライン展開（行が崩れる）ではなく画面下のオーバーレイで編集する。
年タブのarc月は男子・女子の2行に出るが、編集導線は男子行にだけ付ける（同一arc月キーが左右2セルに重複すると保存導線が二重になるため）。

#### データフロー（A）

**保存**: コーチが目標セルの編集ボタンを押す → 編集ボックスで保存 → `POST /api/tenant/goal`（owner認可・enum/キー/字数検証）→ `tenants/{tid}/goalOverrides/current` の `weeks`（週）/`arcMonths`（月）マップへ merge（空文字なら該当キー削除）。
**描画**: GET で `storage.getGoalOverrides()` が `weeks`/`arcMonths` を読み（string値だけ採用＝型汚染除去）→ `applyGoalOverrides` が `weeks`/`months`/`year`/`session` を同時に整合させる（週は週起点日キー、月/年はarc月キーで同一見出しに効く）→ 全タブが同じ目標で描かれる。

#### 主要ファイル（A）

| ファイル | 役割 |
|---|---|
| `engine/src/storage.js` | `getGoalOverrides()` 追加（Firestore版＝`goalOverrides/current` の `weeks`/`arcMonths` を string値だけ正規化して返す・doc無しは空マップ／ローカル版＝常に空マップ）。`stringMap()` で型汚染除去 |
| `functions/index.mjs` | `goalWriteDecision`（owner認可＋scope/key/text純判定）・`nameWriteDecision`・`sanitizeOverride` の時刻ガード追加。`POST /api/tenant/goal`（空文字で `FieldValue.delete()`）・`POST /api/tenant/name` をマウント |
| `ui/plan-data.mjs` | `buildSession`/`buildPlanData` が `arcMonth` を各月に持たせる。`applyGoalOverrides(parts, goalOverrides)` 新設（決定論・空文字は上書きしない二重防御）。戻り値に `goalKeys`（`weekKey`/`monthArcKey`＝編集導線が保存APIへ渡すキーの単一真実源） |
| `ui/render-shared.mjs` | `goalsBar`/`monthSection`/`yearSection` が `data-goal-edit` 属性を出力（月＝arc月キー・週＝週起点ISO・年arc月セルは男子行のみ＋オーバーレイ指定） |
| `ui/pattern-timeline.mjs` | 「今週の焦点」に週起点ISOキーで編集属性を付与。`GOAL_EDITOR_CSS`/`goalEditorScript()` をページに注入 |
| `ui/goal-editor.mjs`（新規） | 目標編集UI（クライアントIIFE・LLM不使用）。`goalSaveErrorText`（401/403/汎用の出し分け）。インライン編集とオーバーレイ編集の両経路。401で1回だけセッション張り直して再送・成功でreload・失敗時は元の値へ巻き戻し |
| `engine/test/storage.test.js` | `getGoalOverrides` の正規化・欠損→空マップ検証 |
| `functions/tenant-name-goal-api.test.mjs` | 目標API・学校名APIの認可・enum/キー検証・保存・空文字削除 |
| `functions/override-sanitize.test.mjs` | 時刻ガード（終了<開始の拒否・終了=開始の許容・空欄行の許容） |
| `ui/goal-overrides.test.mjs` | `applyGoalOverrides` の週/月/年整合（月編集が年に波及・空文字は上書きしない） |
| `ui/goal-name-error-text.test.mjs` | `goalSaveErrorText`/`nameSaveErrorText` の出し分け |

### B. 週scheduleへのコーチ編集反映

コーチが上書きした日（2列スキーマ）が、これまで週ビューで一律に空欄になっていた不具合を直し、各行を時間ブロックに合成して週グリッドへ載せる。

- これまで週グリッドの曜日ブロック生成は、コーチ上書き日（`source==='coach'`）を一律 `null` 除外していた（時間割を持たない前提だった）。
- コーチ上書き日の各行（`from`/`to` が両方非空）を「1行＝1時間ブロック」に合成する（`coachTwoColBlocks`）。both/男子/女子セルの items を集約し、ブロック種別は both>男子>女子 の順で拾う。
- 時刻欄が空の行・中身ゼロの行・`HH:MM` 妥当でない行・終了<開始の行は除外する（0:00潰れ・負の高さ・軸破壊を防ぐ）。
- 週ヘッダのコーチ指定日ラベルを空文字から「コーチ指定」に変えて見えるようにした。

#### 主要ファイル（B）

| ファイル | 役割 |
|---|---|
| `ui/pattern-timeline.mjs` | `coachTwoColBlocks(d)` 新設・`dayBlocks` がコーチ上書き日でも時間ブロックを返すよう変更（描画段の時刻ガード `HM_RE`＋終了>開始）。`SHARE_LABEL.authored='コーチ指定'` |
| `ui/week-dayblocks.test.mjs` | コーチ上書き日の週ブロック合成・空欄行/時刻逆転行の除外検証 |

### C. 学校名変更

右上の歯車パネル（管理者のみ）を「チームカラー」から「チーム設定」に広げ、16色スウォッチの上に学校・チーム名フィールドを置く。

- 保存API `POST /api/tenant/name {name}` は管理者（`isAdmin`）認可。文字数判定（1〜60字）はコード側の純判定（`nameWriteDecision`）に閉じ、通れば `tenants/{tid}.name` を merge 保存する。
- クライアントはテーマ保存と同じ経路（Bearer＋Cookie・`?t` 引き継ぎ・401で1回だけセッション張り直して再送）。成功でreload、失敗時は `nameSaveErrorText` で401/403/汎用を出し分ける。
- GET描画で学校名が未設定・空白のみのときのフォールバックを「マイチーム」にし、静的ビルド経路の既定（別テナントの現行校名定数）に落ちないよう封鎖した。空文字名で空表示にしない。

#### 主要ファイル（C）

| ファイル | 役割 |
|---|---|
| `functions/index.mjs` | `nameWriteDecision`（isAdmin認可＋1〜60字検証）・`POST /api/tenant/name`（`tenants/{tid}.name` merge）。GET描画の学校名フォールバックを「マイチーム」に変更（静的既定の他テナント実校名へ落とさない）。`authClientHtml` へ `schoolName` 受け渡し |
| `ui/auth-client.mjs` | 歯車パネルを「チーム設定」に改称・学校チーム名フィールド追加（`mountNameField` で配線）・`nameSaveErrorText` で失敗文言出し分け・関連CSS |

### D. 付帯（時刻逆転ガードの二重化）

コーチ入力の時刻ペアで終了<開始（打ち間違い）を、描画段（`dayBlocks`: `HM_RE`＋終了>開始）と保存段（`sanitizeOverride`: `HM_TIME`＋終了≥開始）の二重で弾く。
終了=開始（0分・編集UIが未完成行で作りうる）は許容する。
片方/両方が空の行は時間割を持たない指定として許容（描画側が時刻なし・0分行を除外する）。
認可は目標=owner・学校名=isAdmin、書き込みは解決済み `tenantId` 配下パスで越境を担保する。

---

## 統合（別タスク・設計のみ・未実行）

`docs/specs/unification/design.md` を1本追加した。要旨:

- 試合記録アプリ（`ai-basketball-coach-15c78`）と計画アプリ（`ai-bb-coach`）を1プロジェクトへ統合する。home＝計画側（`ai-bb-coach`）。記録側の本番データを home へ移送する。
- 接合（試合スタッツ→計画の指標入力）は、記録側が試合集計を指標配列（`Indicator[]`）へ変換して `tenants/{tid}/teams/{boys|girls}/input/latest` へ書くだけで成立する。エンジン本体・指標表は無改造。
- 高頻度の試合イベントログは別のnamed DBに置き、接合面DB（identity＋計画＋接合doc）と分ける。
- 段階移行: P0設計（本書）／P1非破壊スキャフォールド（home側に空DB・記録functions別コードベース・マルチサイトHosting・接合writer・ロール権限表の単一真実源化）／P2本番移送（オーナーGoゲート・不可逆）。
- **最大リスク＝ロール語彙の統一**。計画側は `owner` 1値、記録側は `coach`/`advisor`/`player`/`parent` の4値。2語彙が無調整で同居すると、ある経路は片方を期待し別経路がもう片方を期待して認可を素通りさせうる。対策は「ロール→権限」の単一真実源表を1つだけ置き、両アプリの認可をそこへ集約する（計画 `owner` は `coach`＋`isAdmin` へ写像）。

統合はP0（設計）まで。実装は未着手。

---

## コミット一覧（main・push 済み・未マージなし）

| ハッシュ | 内容 |
|---|---|
| `7e02415` | feat: 週/月/年の目標編集・週ビューへのコーチ編集反映・学校名変更を追加 |
| `241cc82` | docs(unification): 試合記録アプリと計画アプリの1プロジェクト統合の設計書を追加 |

基準コミットは `9a719fc`。HEAD==origin/main（push済み）。
本セッション差分は14ファイル・1570挿入（コード11・テスト含む・設計書1）。

---

## 本番稼働状況

- **公開URL**: https://ai-bb-coach.web.app （未ログインは `/login` へ302）。
- **デプロイ**: `ai-bb-coach` に functions（render・asia-northeast1 更新成功）・hosting（release complete）・firestore（rules/indexes 反映）をデプロイ。Deploy complete!・ログ本文に Error 行なし。
- **スモーク**: GET `/`→302 `/login`、`/login`→200（「Googleでログイン」を含む）、`/join`→200。
- **Secret Manager 変更なし**。
- 旧トップレベルデータ（teams/annualPlan/overrides）の温存・掃除状況は前資料のまま（本セッションで変更なし）。

---

## 動作確認

### 形式整合層（機械検証）

- ユニット全通過（280件）。`ui/build.mjs` 緑・functions の esbuild バンドル緑。
- 契約QA: クライアントが送る `scope`/`key`/`text`・`name` の項目名・enum・キー形式を、サーバ純判定（`goalWriteDecision`/`nameWriteDecision`）と機械突合して一致を確認。
- Hallmark 違反なし。
- 敵対的レビュー（越境・認可・正当性・契約）を兄弟リポ差分（`git -C <repo> diff`）に対してworkflowで実走。確認済み4指摘中3修正・1許容。
- 本番デプロイ成功・スモーク緑。

### 意味価値層（未検証＝オーナーの初回ログイン待ち）

本番認証下の実機通し（実Googleログイン→編集→保存→reload）はローカル不可で未検証。
Google popup はオーナー本人のアカウントでしか押せない（サーバの認可判定・描画はメイン確認済み）。
デプロイ後にオーナーが1回ログインして、次の3点が初検証になる:

1. 目標編集（月の目標／週の焦点／今月やること／年アーク各月）が週・月・年で効くか。特に月タブの編集が年タブの同じ月へ反映されるか。
2. コーチ指定日の編集が週ビューに時間ブロックとして出るか。
3. 歯車→チーム設定→学校名変更が効くか。

---

## 未解決の判断点

各項目「項目／待ち先／背景／決まったらやること」。前資料の継承分と今回分を併記する。

1. **本番の実Googleログイン疎通＋新3機能の実機確認**（前資料から継続・最優先）。待ち先=オーナー。背景=Google popup はオーナー本人のアカウントでしか押せない。決まったら=上記「意味価値層」の3点を通しで確認。無反応なら `ui/auth-client.mjs` 等の `FB_VERSION`（CDNのfirebase版）を差し替えて再デプロイ。
2. **統合のP1着手可否**（今回新規）。待ち先=オーナー。背景=`docs/specs/unification/design.md` のP1（非破壊スキャフォールド・home側に空DB・記録functions別コードベース・接合writer・ロール権限表の単一真実源化）は旧2プロジェクトを無傷で並走させたまま進められる。P2本番移送はオーナーGoゲート（不可逆）。決まったら=P1をタスク分割して着手（ロール権限表の単一真実源化が最大リスクなので最初に固める）。
3. **旧トップレベルデータの掃除**（前資料から継続）。待ち先=オーナー（安定確認後）。決まったら=`PROD_MIGRATE=1 MIGRATE_DELETE_LEGACY=1 ...` で旧 teams/annualPlan/overrides を削除。
4. **日付コピー機能の扱い**（前資料から継続・今回未着手）。待ち先=オーナー。背景=既存の「他の日からコピー」（`ui/editor.mjs` の `copyFromOptions`/`copy-from`）は実装済み。決まったら=新規の日付コピー改修が要るのか、既存機能の確認だけでよいのかを確定。
5. **ブラウンテーマと固定の対人タグ色（`--terra`）の近さ**（前資料から継続・任意）。待ち先=オーナー。背景=16色中でブラウンが固定の対人タグ色に最も近い（弁別可・実害なし）。決まったら=気になる場合のみブラウン側を差し替える。

---

## 既知の注意点・未対応項目

| 優先 | 内容 |
|---|---|
| 高 | 本番認証下の実機通し（新3機能）はローカル不可。オーナーの初回ログインが初検証になる。 |
| 中 | 統合（`docs/specs/unification/design.md`）は設計のみ・実装未着手。最大リスクはロール語彙統一（認可漏れ）で、P1着手前にGemini第二意見でのプレモーテムを設計書が推奨している。 |
| 低 | ブラウンテーマと固定の対人タグ色（`--terra`）が16色中で最も近い（弁別可・実害なし）。 |
| - | 前資料の注意点（セッションTTL約24h・`/healthz` の縁404・招待のレート制限なし・「他の日からコピー」は既存機能で実機通し未検証）は本セッションで変更なし。継続有効。 |

### 沈黙成功の兆候（明示）

- 学校名・目標の `getGoalOverrides`/`getOverrides` は doc 無し（コーチ未編集の正常状態）を空マップ・空配列で返す設計。これは正常な欠損表現で例外握りつぶしではないが、「保存したのに空で返る」事象が出たら書き込み経路（`POST /api/tenant/goal`・`POST /api/tenant/name`）の認可弾きを先に疑うこと。
- 静的ビルド経路（ローカルJSON）の `getGoalOverrides` は常に空マップを返す（目標編集はマルチテナント＝Firestore経路だけの機能）。ローカル検証では目標編集の保存結果が反映されないのは仕様。

---

## 開発中に得た教訓

各項目「何が起きたか／再発防止／反映先候補」。

### 1. 時刻ベース描画はコーチ入力の時刻ペアを描画＋保存の二重ガードで弾く

- 何が起きた: 週グリッドなど時刻ベースの描画は、コーチ入力の時刻ペアで終了<開始だと軸・高さが負になりレイアウトを壊す。空欄行は0:00へ潰れる。
- 再発防止: `HH:MM` 妥当性＋終了>開始を、描画段（`dayBlocks`）と保存段（`sanitizeOverride`）の二重で弾く。終了=開始（0分）は許容、空欄行は時間割なしとして除外する。
- 反映先候補: wasurenagusa。

### 2. 兄弟リポのpush前レビューは workflow で対象リポの diff を明示する

- 何が起きた: `/code-review`・`/security-review` は cwd（firebase-kit）の git 差分を自動取得し、兄弟プロジェクトの差分を拾わない。
- 再発防止: 兄弟プロジェクトのレビューは `git -C <repo> diff` で対象リポの差分を明示してworkflowに渡す。
- 反映先候補: 既に wasurenagusa 既知。

### 3. 並列実装の契約QAは項目名・enum・キー形式まで機械突合する

- 何が起きた: クライアントとサーバを並列実装すると、送信ペイロードの項目名・enum・キー形式のズレはパス一致だけのQAでは漏れる。
- 再発防止: `scope`/`key`/`text`・`name` の項目名・enum・キー文字種まで、クライアント送信とサーバ純判定（`goalWriteDecision`/`nameWriteDecision`）を機械突合する。
- 反映先候補: 既に wasurenagusa 既知。

---

## 次セッションへの引継指示

優先順（上が高い）:

1. **本番の実Googleログイン疎通＋新3機能の実機確認**（オーナーが1回押す）。https://ai-bb-coach.web.app で①目標編集が週月年で効くか（特に月タブ編集が年タブの同じ月へ反映されるか）②コーチ指定日の編集が週ビューに時間ブロックで出るか③歯車→チーム設定→学校名変更が効くか、を通しで確認。無反応なら `FB_VERSION` 差し替えて再デプロイ。
2. **統合のP1着手可否をオーナーに1問確認**。`docs/specs/unification/design.md` のP1（非破壊・旧2プロジェクト並走）に着手するか。着手する場合はロール権限表の単一真実源化（最大リスク・認可漏れ）を最初に固め、P1着手前にGemini第二意見でのプレモーテムを通す。P2本番移送はオーナーGoゲート。
3. **旧トップレベルデータの掃除**（安定確認後）。`PROD_MIGRATE=1 MIGRATE_DELETE_LEGACY=1 ...` で旧 teams/annualPlan/overrides を削除。
4. **日付コピー機能の扱いを確定**。既存「他の日からコピー」は実装済み・今回スコープ外。新規改修が要るのか確認だけでよいのかをオーナーに1問確認してから着手。
5. **ブラウンテーマの色味**（任意）。固定の対人タグ色（`--terra`）と近いのが気になる場合のみ差し替える。

> デプロイ手順メモ: `npx firebase-tools@15.22.0 deploy --only functions,hosting,firestore --project ai-bb-coach`（predeploy で esbuild バンドル自動生成）。デプロイ成否はログ本文の Error 行で判定。ローカル検証は JAVA_HOME 設定の上でエミュレータ実走（認証・目標保存・学校名保存の本番経路は本番でのみ稼働するためユニット＋レビュー＋本番スモークで担保）。
