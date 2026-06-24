# 引継資料: コーチ編集の保存バグ修正・実Firestore往復検証・デプロイ方針確定（2026-06-24）

> 前資料 `docs/findings/handoff-20260623-period-pickers-and-coach-editor.md` の続き。
> 前資料の「次セッション指示」のうち、(3) 実Firestoreエミュレータ往復検証＝**完了**、(1) 本番デプロイ＝**方針確定（専用プロジェクト＋Googleログイン）だが実行は未着手で継続**、(2) 金曜版作成＝**対象が明日(水6/24)版に変わって継続**。

---

## 概要

### このセッションで達成したこと（行動変容）
コーチが編集画面で保存した内容が、実際に残って画面に出るようになった（見出しだけ書いた行が保存で消える不具合を修正）。あわせて「画面で保存→バックエンド（Firestore）→再描画」の往復を、この開発機に Java を入れて初めて実機で確認し、前資料で唯一未検証だった層を解消した。本番デプロイは「専用プロジェクト＋Googleログイン認証」で進める方針がオーナー判断で確定した（実行は未着手）。明日(水)の練習メニュー作成を編集画面で開始し、その過程で保存バグと2件のUX課題（ドリル候補の絞り込み・項目削除ボタンの配置）が露見した。

### なぜやったか
前資料の最優先（デプロイ可否判断・コーチ版作成・実Firestore往復検証）を受領。デプロイ判断を仰ぐ前に、自分で潰せる層＝実機往復検証を先に完了させた（この機は Java 未導入だったが可搬 JRE をローカル展開して解消）。オーナーが「デプロイGO＋Google認証」を指示し専用プロジェクト方針が固まったが、その後「先に明日の予定を作りたい」に切替。編集画面を実際に使う中で保存バグが露見したため修正し、UX課題2件を次セッションへ引き継ぐ。

---

## 実装した機能

### 1. コーチ編集の保存バグ修正（commit 48cca9e）
- **症状**: 画面で保存しても内容が出てこない。
- **原因**: `ui/editor.mjs` のクライアント保存処理 `cleanCell` が、ドリル項目ゼロのセル（＝見出しだけ。例「男子に従う」「ゲーム」「アップ＆ラン」）を無条件で `null` にして破棄し、男女とも空になった行は `buildOverride` で行ごと捨てられて消えていた。
- **修正**: 見出し（label）とドリル項目がともに空のときだけ破棄するよう変更（`if(items.length===0&&!label)return null;`）。見出しだけのセルは保持する。
- **検証**: Playwright 実機で「見出しのみセル→保存→即時再描画→reload」で残ることを確認。サーバ `sanitizeOverride` と描画（`toAuthoredCell`/`cellInnerHtml`）は items 空配列を元から許容しており整合（code-reviewで確認）。

### 2. 書き経路往復の検証スクリプト（commit 28f394b）
- **新規 `scripts/verify-write-roundtrip.mjs`**。`firebase emulators:exec` 配下で seed → 保存API（`POST /api/override`）→ `GET /?p=timeline` 再描画への反映 → seed済みねらいの置換 → 削除APIでの自動生成復元、までを実機検証する。本文に `WRITE-ROUNDTRIP PASS/FAIL` を出し exit code で合否。
- **code-review(high) 反映**: 置換判定（③）が seed 文言ドリフトで無言スキップされ PASS を維持する事故を防ぐため、「baseline に seed済みねらいが描画されている」を硬い必須チェックに格上げし、置換判定を無条件化した。`title` は two-col では描画されない（保存スキーマ受理確認用）旨を明記。
- **未登録**: npm scripts には未登録（手動は `emulators:exec` 経由）。次セッションで `emulate:verify:write` 等として登録余地。

### 3. 実Firestoreエミュレータ往復の実機検証（コード変更なし・環境構築）
- この Windows 機は Java 未導入でエミュレータが起動できなかったため、可搬 JRE（Temurin 21・scratchpad に展開、システム非改変）を入れて `emulators:start`/`emulators:exec` を起動した。
- 「保存→Firestore→reload」の往復が実機で成立（前資料の唯一の未検証層を解消）。

---

## 主要ファイル（変更箇所）

| ファイル | 役割・変更点 |
|---|---|
| `ui/editor.mjs` | `cleanCell`: 見出しだけのセルを保持（保存バグ修正）。`if(items.length===0&&!label)return null;` |
| `scripts/verify-write-roundtrip.mjs` | 新規。書き経路往復（保存→Firestore→reload・置換・削除復元）の実機検証 |

---

## コミット一覧（ブランチ main・origin/main へ push 済み・同期）
| ハッシュ | 内容 |
|---|---|
| 28f394b | test(app): 書き経路往復（保存→Firestore→reload）の検証スクリプトを追加（code-review反映済み） |
| 48cca9e | fix(app): コーチ編集の保存で見出しだけの行が消えるバグを修正 |

（基準: 前資料コミット 2fcf107。本セッションは 48cca9e・28f394b の2本。）

---

## 本番稼働状況
- 公開URL: **なし（未デプロイ）**。コードのみ main。
- **デプロイ方針（確定・未実行）**: 専用 Firebase プロジェクトを新規作成し、コーチの **Googleログイン認証** 付きでデプロイ。既存案件 `ai-basketball-coach-15c78` への相乗りは却下（同案件は新規ユーザーのアカウント作成をブロックする設定があり、外部コーチの初回Googleログインが弾かれるため。証跡: `ai-basketball-coach/.spec-workflow/specs/access-control/design.md:555`）。利用可能な課金アカウントは2件確認済み。
- **認証の実装方針**: 兄弟プロジェクト greed-island の実績パターンに倣う。クライアントで Google sign-in（`GoogleAuthProvider`/`signInWithPopup`）→ ID トークンを `Authorization: Bearer` で送出 → サーバで `verifyIdToken` ＋プロバイダ強制（`google.com`）＋メール許可リスト。参照実装: `greed-island/functions/src/handlers/handler-utils.ts`（`assertAllowedProvider`/`requireSocialAuth`）、`greed-island/public/js/api.js`（クライアント Bearer 付与）。basketball-coach-strategy の functions は素の ESM express ＋ firebase-admin（firebase-kit 非依存）なので、`getAuth().verifyIdToken()` を使う薄いミドルウェアを自前で書くのが最小。
- **エミュレータ**: ローカル起動は Java 必須。この機は可搬 JRE（`<scratchpad>/jre/jdk-21.0.11+10-jre`・セッション限りで消える可能性）。次セッションは JAVA_HOME を通すか恒久導入（winget/choco 可）が要る。

---

## 動作確認済み項目

### 形式整合層（機械検証）
- `node --test` 全通過。`node ui/build.mjs` 成功。
- push 前に `/code-review`（high）実施。本番修正（editor.mjs）は指摘ゼロ。検証スクリプトに3指摘（いずれも「テストのカバレッジが静かに痩せる」系）→ ① 置換判定の前提を硬いチェック化＝反映、② title 非描画＝コメント明記、③ 常駐エミュレータ再実行時の dirty-state false-FAIL＝本テストの契約が `emulators:exec`（毎回 fresh+seed）であり①の硬いチェックで無言緑でなく明示FAILになるため対応不要、と判断。

### 意味価値層（メイン直確認・Playwright / エミュレータ実機）
- **保存バグ修正**: Playwright で「見出しのみセル（女子=ラベルのみ）→保存→即時再描画→別コンテキストreload」でラベルが残存することを確認。修正前は同操作でラベルが `—`（消失）になることも実機で確認済み。
- **書き経路往復**: `emulators:exec` 配下で seed→保存→再描画→置換→削除復元の全10チェック PASS（`WRITE-ROUNDTRIP PASS`）。

---

## 未解決の判断点（オーナー側アクション待ち）

1. **本番デプロイの実行** ／ 待ち先=オーナー（方針はGO確定済み） ／ 背景=「専用プロジェクト＋Google認証」確定後、オーナーが「明日の予定作り」優先に切替で実行を中断 ／ 決まったら: 専用プロジェクト作成→課金リンク→Googleログイン有効化（Console操作はオーナー1クリック）→認証実装→vendoring→デプロイ→実URLで往復確認。
2. **コーチ許可リストの実メンバー** ／ 待ち先=オーナー ／ 背景=Google認証はメール許可リスト方式を想定。まずオーナーのGoogleアカウントを許可し、追加コーチは未確定 ／ 決まったら: 許可リスト（環境変数 or Firestore）に追加。
3. **明日(水6/24)メニューの内容** ／ 待ち先=オーナー ／ 背景=編集画面で作成を開始したが、保存バグ修正の過程でエミュレータを再起動したため作りかけは残っていない ／ 決まったら: 編集UIで組み→「書き出し」→`engine/data/overrides.json` へ永続化→印刷プレビュー。

---

## 議論再開ポイント（キャッチアップ手順）
- **5分**: 本資料。
- **10分**: `ui/editor.mjs`（`cleanCell`/`buildOverride`/`editorScript` のフォーム）＋ `functions/index.mjs`（`mountWriteApi`/`sanitizeOverride`）。
- **実機**: 可搬JRE（または恒久Java）で `emulators:start` → `node scripts/seed-firestore.mjs`（要 `FIRESTORE_EMULATOR_HOST=127.0.0.1:8281`）→ http://127.0.0.1:8088/?p=timeline で編集→保存→reload。

---

## 既知の注意点・未対応項目
| 優先 | 内容 |
|---|---|
| 高 | 本番デプロイ未実行（方針のみ確定）。書込API認証（Google）も未実装＝公開前の必須対応。 |
| 高 | ドリル候補UXの絞り込み未実装（次セッション引継指示1）。大枠選択後も全216件がフラット表示で「UXゴミ」とオーナー指摘。 |
| 中 | 編集UIの「項目を削除」ボタンが行内に居て邪魔。右端のゴミ箱アイコン化の指摘（引継指示2）。 |
| 中 | 明日(水6/24)メニュー未確定（編集UIで再入力が要る）。 |
| 低 | `verify-write-roundtrip.mjs` は npm scripts 未登録（手動 `emulators:exec`）。 |
| 低 | この機の Java は可搬JRE（scratchpad・セッション限り）。CI/Mac/恒久導入で安定化を。 |

---

## 開発中に得た教訓
1. **編集フォームの「保存」は、見出しだけの入力も有効値として残す。**
   - 何が起きた: 項目ゼロのセルを無条件破棄し、コーチが見出しだけ書いた行（「男子に従う」等）が保存で消えた。
   - 再発防止: フォーム→保存スキーマの正規化で「空の定義」を厳密化（見出し or 項目のどちらかがあれば有効）。実ユーザーの素の操作（見出しだけ書く）を実機で通してから完了とする。
   - 反映先候補: wasurenagusa。
2. **「保存できない」報告は、HTTP層の往復成功で満足せず実ブラウザで同一操作を再現する。**
   - 何が起きた: curl での保存往復は PASS だったが、実ブラウザでは内容が消えた（入力の正規化段で落ちていた）。HTTP往復の成功＝UIの正しさ、ではなかった。
   - 再発防止: UI保存系の不具合は Playwright 実機で同一操作を再現してから原因特定する。
   - 反映先候補: wasurenagusa。
3. **firebase エミュレータの停止は子プロセス（Java/Node）が残りポートを占有する。**
   - 何が起きた: タスク停止後も旧プロセスがポートを掴み続け、新エミュレータが起動失敗。なのに旧プロセスが応答を返すため「古いコードのまま緑に見える」状態になった（ES module キャッシュで `ui/` 変更は再起動必須）。
   - 再発防止: 再起動前にポート占有プロセスを明示 kill（`Get-NetTCPConnection`→`Stop-Process`）。`ui/` を変えたら必ず再起動してから検証する。
   - 反映先候補: wasurenagusa。
4. **編集UIのドリル候補は「大枠」で絞る前提だが、データの category(12種) と editor の block(7種) が1対1でない。**
   - 何が起きた: 大枠（block）を選んでも候補が全216件フラットのままで「絞られていない」とオーナー指摘。
   - 再発防止: 絞り込みは block→category のマッピングを先に定義してから実装する（引継指示1）。
   - 反映先候補: wasurenagusa（プロジェクト固有の設計事項）。

---

## 次セッションへの引継指示
優先順（上が高い）:

1. **ドリル候補の絞り込み（最優先・UX）**。大枠（例「シュート」）を選んだら、その枠のドリルだけ候補に出す。**設計の肝**: editor の block は7種（アップ/ファンダ/シュート/対人/ラン/静的/ゲーム）、`drills.json` の `category` は12種（ハンドリング/ドリブル・シュート・フィニッシュ・パス&スペーシング・1on1・チームオフェンス・チームディフェンス・リバウンド・フットワーク・コンディショニング/ウォームアップ・傷害予防/NMT・意思決定/ゲーム形式）で**1対1でない**。まず block→category のマッピング表を定義（オーナー確認推奨）。実装は `editor.mjs` の `catalogNames` を block別 `{block:[names]}` に拡張し、セルの block select 変更で name の datalist（`ed-catalog`）を差し替える。
2. **項目削除ボタンのアイコン化（UX）**。`editor.mjs` の `itemHtml` の「項目を削除」ボタンを、行の右端のゴミ箱アイコンに変更する。
3. **明日(水6/24)メニュー作成**。編集UIで組み→「書き出し」→`engine/data/overrides.json` へ永続化→印刷プレビュー（火と同じ男女2列・月/週目標の帯付き）。保存バグは修正済み。
4. **本番デプロイ実行**。専用プロジェクト作成→課金リンク→Googleログイン有効化（Console・オーナー1クリック）→書込API認証実装（greed-island の `requireAuth`/`assertAllowedProvider` パターン＝クライアントGoogle sign-in→Bearer IDトークン→サーバ `verifyIdToken`＋provider強制＋メール許可リスト）→vendoring（engine/ui を functions 配下へ同梱）→デプロイ→実URLで往復確認。

（Java注記: 次セッションでエミュレータを使うなら JAVA_HOME を通す。この機の可搬JREは scratchpad 配下＝セッション限りで消える可能性。恒久導入は winget/choco 可。）
