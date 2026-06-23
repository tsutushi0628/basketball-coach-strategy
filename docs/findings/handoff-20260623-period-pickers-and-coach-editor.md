# 引継資料: 週/月ピッカーの実切替・コーチ編集UI・保存のバックエンド移行（2026-06-23）

> 前資料 `docs/findings/handoff-20260623-practice-plan-ui-generalize.md` の続き。
> 前資料の「次セッション指示」のうち、今回は「レベルタブ等幅化」「push後 code-review」「週/月ピッカーの実切替（本丁場）」「配布PDFへの月/週目標表示」を完了し、「金曜(2026-06-26)のコーチ版作成」「クラウド公開」を未完として繰り越す。

---

## 概要

### このセッションで達成したこと（行動変容）
コーチが触れる範囲が「自動生成のたたき台を見る」から「特定日を画面上で編集し、バックエンドに保存して配る」まで広がった。週/月のピッカーが枠だけの飾りから実際の期間切替に変わり、クリックで別の週（型づくり→反復・強度）・別の月（準備始動→鍛錬）に表示が切り替わる。コーチが日ごとの狙い・時間割・男女別メニューを画面のフォームで編集すると、その上書きが Firestore に保存され、再描画に反映される。レベル切替タブは4等分の等幅になり、配布物（印刷）にも月/週の目標が細い1行帯で載るようになった。

### なぜやったか
前セッションで週/月ピッカーは「枠だけ・実選択は1期間」に留まっていた（エンジンが1期間分しか生成しないため）。これが汎用化の本丁場として残っていた。あわせて、コーチが配る前提なら自分で特定日を直せる編集手段が要る。当初その保存をブラウザ内（localStorage）で実装したが、既存のバックエンドが「読み取り＋HTML返却」しか持たず保存経路が無かっただけと判明し、オーナーの強い指摘を受けて保存を Firestore へ移す形に作り直した。

---

## 実装した機能（4本柱・すべて main に push 済み）

### 1. レベルタブの等幅化＋配布PDFに月/週目標の1行版（commit 22e7233）
- レベル切替タブ（日/週/月/年）を4等分グリッドの等幅に揃えた（`ui/render-shared.mjs` の `.levels` / `.lvtab`）。
- 配布物（印刷）に月/週の目標を細い1行帯で表示する（`render-shared.mjs` の `goalsBar()` に印刷専用クラス `.goalbar-pr` を追加し `@media print` で表示）。最も中身が密な火曜でも印刷1ページを維持する。

### 2. 週/月ピッカーの実切替＝複数期間生成（本丁場・commit c2d97f5・bb01733）
- 設計の核は、暦月とシーズン上の「アーク月」を定数オフセットで対応づける点。暦6月＝準備始動アークになる。`engine/src/annualPlan.js` の `arcMonthOf` が `arcMonth = wrap(current_month + 1)` で算出する。
- `ui/plan-data.mjs`: 1セッション分を組む `buildSession` を期間注入式に分離した（current_month / week_of_month / week_start_date を引数で受け取る）。`buildPlanData` を期間ループ化し、後方互換のため top-level の days / session は先頭週のまま残し、`weeks[]` / `months[]` を追加する。新ヘルパー `computeWeekPeriods`（現アーク月の週1〜4を暦日+7日/週番号+1で算出）・`computeMonthPeriods`（現月から半年・暦月ラベル＋アーク駆動の月を定数オフセットで算出）を追加。既習レクチャとロスター（introduced）を週送りで連鎖させる（週1で6件導入→週2〜4は土曜レクチャから既習分が消える）。
- `ui/pattern-timeline.mjs`: `weekPicker` / `monthPicker` を実選択ボタン（クラス `cal-go-week` / `cal-go-month`）に変更。`render()` を複数パネル化し、先頭以外のパネルを `[data-week]` / `[data-month]` で hidden にする。`weekLevel(data, days, focus)`・`render-shared.mjs` の `monthSection(data, m, displayMonth)` を期間引数化。月レベルの目標ブロックは現月パネルにのみ表示する。
- `ui/render-shared.mjs` の `clientScript`: 日切替と同型の `showWeek` / `showMonth` を追加。
- `engine/src/annualPlan.js`: `wrapMonth` を export し、plan-data 側の重複定義を解消。
- テスト: `ui/periods.test.js` を新規8件追加（業務意図: 週は+7日/週番号で進む・月はアーク進行する・後方互換が保たれる・上書きは各週の実日付にのみ当たる）。`ui/overrides.test.js` の旧「6/23」期待値を「2026/06/23」に修正（commit 9c40848）。
- 既知の限界: 週2〜4は年間計画（`engine/data/annual-plan.json` の weekly_focus）が「反復・強度」を週2〜4一律で定義しているため中身が同じになる。準備期（アーク8/9）以外の月だと週差はさらに小さい。

### 3. タイムライン画面にコーチ編集UI（commit 92584ec・fb9cddb）
- 新規 `ui/editor.mjs`（自己完結。`EDITOR_CSS` / `editorToolbar` / `editorDataIsland` / `editorScript` を持つ）。日ビューに「この日を編集／自動に戻す／入力を書き出し」のボタンを置く。
- 編集フォームは、狙い・コート＋時間行ごとに（男子/女子/男女共通）のセルを持つ。セルは見出し＋メニュー項目（216件のドリルカタログから datalist で選択するか自由記入＋メモ）で構成し、行・項目を増減できる。出力は `engine/data/overrides.json` と同型のスキーマ。
- `ui/pattern-timeline.mjs` に統合した（日記事に `data-date`、`EDITOR_CSS` 連結、ツールバー、データアイランド＋スクリプト）。
- code-review で7件のバグを検出し修正（commit fb9cddb）: テキストコピーが編集日でなく先頭日にフォールバックする／minutes が負値を許す／男女共通トグルでデータが消える／保存失敗を握りつぶす／編集可否のガード欠落／`#plan-top` 欠落／項目追加後のフォーカス飛び。

### 4. 保存をブラウザ（localStorage）からバックエンド（Firestore）へ移行（commit 75e8add・b7bcab6）
- 背景: localStorage 保存は逃げだった。元のバックエンドが「読み取り＋HTML返却」だけで保存APIを持たなかっただけで、書込エンドポイントを足せば済んだ。
- `functions/index.mjs`: 書込/削除API（`POST /api/override`・`POST /api/override/delete`）を `mountWriteApi(server, db)`（db 依存注入式・モックDBで検証できる）で追加。`sanitizeOverride` が date 形式・rows 型・上限件数・文字長を検証/サニタイズする（新オブジェクトを組み立てるためプロトタイプ汚染が起きない）。書込は Admin SDK 経由のみで、クライアント直書きは `firestore.rules` で全 deny のまま。
- `ui/editor.mjs`: 保存を `/api/override` への POST に変更（成功で即時再描画＋PREFILL 更新）。「自動に戻す」は削除API→再読込。「書き出し」はサーバ状態（prefill）から `overrides.json` 配列形でコピー。localStorage の適用・スナップショットを撤去（サーバを単一の真実源に統一）。
- レビュー反映（commit b7bcab6）: 検証失敗400／Firestore障害500の切り分け・null行ガード・`express.json` を `/api` 配下のみに限定・保存APIが正規化後の override を返しクライアント表示と一致させる・保存の並行操作ガード。

---

## 主要ファイル（変更箇所）

| ファイル | 役割・変更点 |
|---|---|
| `ui/editor.mjs` | 新規。コーチ編集UI一式（`EDITOR_CSS` / `editorToolbar` / `editorDataIsland` / `editorScript`）。保存/削除/書き出しのクライアント処理。client 側 `renderDay`（保存直後の即時再描画） |
| `functions/index.mjs` | `mountWriteApi(server, db)`（書込/削除API・依存注入式）、`sanitizeOverride`（検証/サニタイズ）、400/500切り分け、`express.json` を `/api` 配下限定、認証未実装のコメント明記 |
| `ui/plan-data.mjs` | `buildSession` を期間注入式に分離、`buildPlanData` を期間ループ化（`weeks[]` / `months[]` 追加・top-level は先頭週で後方互換）、`computeWeekPeriods` / `computeMonthPeriods` 追加、`toAuthoredCell` / `toTwoColDay`（上書き読み描画） |
| `ui/pattern-timeline.mjs` | `weekPicker` / `monthPicker` を実選択ボタン化、`render()` 複数パネル化（`[data-week]` / `[data-month]` で先頭以外hidden）、`weekLevel(data, days, focus)`、editor 統合（`data-date`・`EDITOR_CSS`・ツールバー・データアイランド＋スクリプト） |
| `ui/render-shared.mjs` | `.levels` / `.lvtab` 等幅グリッド、`goalsBar()` に印刷用 `.goalbar-pr`、`@media print` で月/週目標表示、`clientScript` に `showWeek` / `showMonth`、`monthSection(data, m, displayMonth)` 期間引数化 |
| `engine/src/annualPlan.js` | `arcMonthOf`（`arcMonth = wrap(current_month + 1)`）、`wrapMonth` を export（plan-data の重複定義解消） |
| `ui/periods.test.js` | 新規8件（週は+7日/週番号・月はアーク進行・後方互換・上書きは各週の実日付にのみ当たる） |
| `ui/overrides.test.js` | 旧「6/23」期待値を「2026/06/23」に修正 |

---

## コミット一覧（ブランチ main・全て origin/main に push 済み・完全同期）
| ハッシュ | 内容 |
|---|---|
| b7bcab6 | fix(app): バックエンド保存のレビュー反映（400/500切り分け・null行ガード・正規化返却・並行保全） |
| 75e8add | feat(app): コーチ編集の保存をブラウザ保存からバックエンド保存へ移行 |
| fb9cddb | fix(app): コーチ編集UIのレビュー指摘7件を修正 |
| 92584ec | feat(app): タイムライン画面にコーチ編集UIを追加（編集／自動に戻す／書き出し） |
| bb01733 | refactor(app): 複数期間のcode-review反映（月テストを業務意図化・wrapMonth重複解消） |
| c2d97f5 | feat(app): 週/月ピッカーを実切替化（複数期間生成・データ層汎用化） |
| 9c40848 | fix(test): 上書きマージtestの日付ラベル期待値をyyyy/mm/ddに更新 |
| 22e7233 | feat(app): レベルタブを等幅化し配布PDFに月/週目標の1行版を追加 |

参考: このセッションで前回分（609d81a / eb0e1c8 / bf42863）と前々回の Firestore バックエンド一式（2dcf2c4 / b36a6c6）も初めて push された。push は祖先コミットごと公開されるため、これらも一緒に公開された（教訓3参照）。

---

## 本番稼働状況
- 公開URL: **なし（未デプロイ）**。コードのみ main に公開。
- 静的ビルド: `node ui/build.mjs` → `ui/pattern-*.html`。プレビューは `ui/e2e/_serve.mjs`（gitignore・再生成可）で http://127.0.0.1:8088 に配信。
- バックエンド: Cloud Function `render`（HTML返却）＋ `mountWriteApi`（保存/削除API）。Firestore named DB `basketball-strategy-db`。ローカル起動は Firebase エミュレータ（`npm run emulate`）だが、**この Windows 機は Java 未導入のため Firestore エミュレータを起動できない**（Mac / CI / deploy で起動する）。

---

## 動作確認済み項目

### 形式整合層（機械検証）
- `node --test` 全件緑（`periods.test.js` 8件を含む）。`node ui/build.mjs` 成功。
- デザインのアンチパターン0（side-stripe色帯・gradient・汎用書体・絵文字・紫ピンク無し）。
- code-review（high）を本丁場・編集UI・バックエンド移行の各 push で実施。security-review をバックエンド移行で実施。

### 意味価値層（メイン直確認・Playwright 実機）
- 週/月ピッカー: クリックで別期間に実切替（週 06/22「型づくり」→06/29「反復・強度」、月 06「準備始動」→08「鍛錬」）。表示パネルは常に1枚。
- コーチ編集: 編集→保存→当該日の再描画、自動に戻す、書き出し、カタログ216件、コンソールエラー0。修正7件を実機で個別に再検証して合格。
- バックエンド保存: 本物の `mountWriteApi` ハンドラ＋モックDBで「保存→`overrides/{date}` への書込呼び出し・コーチ上書きスキーマ・削除・検証400/障害500」を実証。**実 Firestore デーモンの往復は Java 無しのため未実行**（Mac / deploy で要確認）。

---

## 未解決の判断点（オーナー側アクション待ち）
各「項目／待ち先／背景／決まったら次に」で記す。

1. **本番デプロイ（コーチが外から使う公開URL）** ／ 待ち先=オーナー ／ 背景=strategy 専用の Firebase プロジェクトが無い（`.firebaserc` はプレースホルダ `demo-basketball-strategy`）。既存 `ai-basketball-coach-15c78` 等はあるが同居は既存アプリと衝突リスク。Cloud Functions は Blaze 課金が要る ／ 決まったら: プロジェクトID差替＋vendoring＋デプロイをメインが実施。
2. **書込APIの認証（セキュリティ・本番前必須）** ／ 待ち先=オーナー ／ 背景=security-review の HIGH 指摘。`/api/override`・`/api/override/delete` に認証が無く、公開URLにすると第三者が上書きを書込/削除できる。未デプロイなので今は無害だがデプロイ前の必須対応 ／ 決まったら: Firebase Auth（コーチ認証）／App Check／共有シークレットのいずれかを実装。`functions/index.mjs` のコメントにも明記済み。
3. **金曜(2026-06-26)のコーチ版作成** ／ 待ち先=オーナー（内容） ／ 背景=前回からの繰り越し。今は自動生成のたたき台。編集UI（または `engine/data/overrides.json`）で火と同じ男女2列フォーマットで作成できる ／ 決まったら: 内容を受けて作成。
4. **vendoring（デプロイ前提作業）** ／ 待ち先=不要（メインが実施可） ／ 背景=`functions/index.mjs` が `../engine`・`../ui` を相対 import している。エミュレータは実FSで動くが実デプロイは functions 配下へ同梱が要る ／ デプロイ着手時にメインが実施。

---

## 既知の注意点・未対応項目
| 優先 | 内容 |
|---|---|
| 高 | 書込APIの認証（未解決2）。本番デプロイ前の必須。 |
| 高 | 実 Firestore デーモンでの編集→保存往復が未検証（Java 無し環境のため）。Mac / deploy で要実機確認。 |
| 中 | 編集UIの保存は Function 提供ページ前提。静的プレビュー（`ui/e2e/_serve.mjs`）では `/api/override` が無く保存できない（「バックエンド未接続」メッセージを表示）。 |
| 中 | 週2〜4が同一内容（`engine/data/annual-plan.json` の weekly_focus が週2〜4を一律定義しているため）。週差を増やすには weekly_focus の週割り定義の追加が要る。 |
| 低 | `ui/editor.mjs` の client `renderDay` は server `twoColTimeline` の手移植で二重描画になっている（クラス一致は検証済みだが将来ドリフトの余地）。save 直後は client 描画、revert は reload。 |
| 低 | `functions/index.mjs` の `sanitizeOverride` と `ui/plan-data.mjs` の `toAuthoredCell` / `toTwoColDay` が同じ上書きスキーマを別解釈する（書込検証 vs 読み描画）。スキーマ変更時は両方の更新が要る。 |

---

## 開発中に得た教訓
各「何が起きた／再発防止／反映先候補」で記す。

1. **既存リポにバックエンドがあるなら、クライアントだけの安直な保存（localStorage）に逃げない。**
   - 何が起きた: 保存を localStorage で実装してオーナーの強い指摘を受けた。バックエンドは「読み取り経路しか無かった」だけで、書込エンドポイントを足せば済んだ。
   - 再発防止: 永続化の要件が来たら、まず既存バックエンドの書込経路の有無を確認し、無ければ足す。クライアント保存は最後の手段。
   - 反映先候補: wasurenagusa。
2. **委譲したモジュールは「実出力」で検証する。**
   - 何が起きた: 編集UIをサブエージェントが自己E2E「PASS」で報告したが、その後の code-review で実バグ7件（テキストコピーの誤フォールバック等）が出た。
   - 再発防止: サブエージェントの自己検証PASS報告を受入判定にせず、メインが code-review＋実機で実出力を確認する。
   - 反映先候補: wasurenagusa（既存 pdm「成果物の物理裏取り」の具体例）。
3. **push は祖先コミットごと公開される。**
   - 何が起きた: オーナーが挙げた3コミットを push したら、未 push だった前々セッションの Firestore バックエンド一式（2dcf2c4 等）も祖先として一緒に公開された。
   - 再発防止: push 前に `git diff origin/main...HEAD` で真の公開範囲を確認し、オーナーに提示する。
   - 反映先候補: wasurenagusa。
4. **Java 無し環境では Firestore エミュレータが起動しない。依存注入でモックDB検証に切り替える。**
   - 何が起きた: Windows 機に Java が無く Firestore エミュレータ起動に失敗した。
   - 再発防止: 書込ハンドラを `mountWriteApi(server, db)` のように db 依存注入式にし、本物ハンドラ＋モックDBで Java 無しでも書込経路を実証する。実デーモン往復は Mac / CI / deploy で行う。
   - 反映先候補: wasurenagusa。

---

## 次セッションへの引継指示
優先順（上が高い）:

1. **本番デプロイ可否のオーナー判断を受ける**（未解決1・2）。GO なら: ①デプロイ先プロジェクト確定→`.firebaserc` / `functions/index.mjs` のID差替 ②書込API認証の実装（方式はオーナー決定） ③vendoring（engine / ui を functions 配下へ） ④デプロイ→実URLで編集→保存→Firestore往復を実確認。
2. **金曜(2026-06-26)のコーチ版を作成**（未解決3）。オーナーから内容を受け、編集UIまたは `engine/data/overrides.json` に火と同じ男女2列フォーマットで追加する。
3. **（Java を導入できる環境で）実 Firestore エミュレータ往復の実機確認**。`npm run emulate` → 編集→保存→reload でサーバ再描画にコーチ上書きが出ることを確認する（このセッション唯一の未検証層）。

### 前資料(20260623・practice-plan-ui-generalize)の「次セッション指示」の繰り越し状況
- レベルタブ等幅化 → **完了**（commit 22e7233）。
- push 後 code-review → **完了**（各 push で high・バックエンド移行で security-review も）。
- 週/月ピッカーの実切替（本丁場）→ **完了**（commit c2d97f5・bb01733）。
- 配布PDFへの月/週目標表示 → **完了**（1行版・commit 22e7233）。
- 金曜(2026-06-26)のコーチ版作成 → **未完**（本資料の引継指示2へ）。
- クラウド公開 → **未完**（本資料の引継指示1へ）。

---

## 議論再開ポイント（キャッチアップ手順）
- **5分**: 本資料。
- **10分**: `ui/editor.mjs`（編集UI全体）＋ `functions/index.mjs`（`mountWriteApi` / `sanitizeOverride`）＋ `ui/plan-data.mjs`（`buildPlanData` / `computeWeekPeriods` / `computeMonthPeriods`）。
- **実機**: Java 導入後に `npm run emulate` → http://127.0.0.1:8088/?p=timeline で編集→保存→Firestore 往復を実確認する（このセッション未実施の唯一の層）。
