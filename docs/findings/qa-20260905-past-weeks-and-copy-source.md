# QA: 過去の週への移動とコピー元の「おすすめ＋探す」（2026-09-05）

> type=qa。対象: 未コミットの作業ツリー差分（`spec-20260905-past-weeks-and-copy-source-impl.md` 実装分。
> 不具合3・4対応 `spec-20260905-goal-local-update-and-split-flag.md` の上に乗っている）。
> 初回判定: QA FAIL（6章）。1回目修正後の再QA: QA FAIL（9〜10章）。2回目修正後の再々QAは11章。
> **最終判定: QA PASS**（11章）。

## 1. テスト全件実走

```
node --test ui/*.test.mjs
# 実装者報告のまま実走した結果: tests 277 / pass 274 / fail 3
node --test functions/*.test.mjs
# tests 98 / pass 98 / fail 0
```

## 2. 先行テスト3件の検証

実装者が「先行テスト側の不備」と報告した3件を、正本（spec §4・§7.2、ux-analysis.md）に照らして検証した。

### ①② `ui/week-nav-ssr.test.mjs`（テスト不備・修正済み）

- `:72` `assert.match(nav, /class="wk-prev"/, ...)` は完全文字列一致の正規表現で、実装の出力 `class="wk-step wk-prev"`（spec §4のDOM定義どおり）に一致しない。`wk-next` も同型。
- `:86` はキャプチャ群の取り違えで、`data-week` 属性値（`o[2]`）をラベル文字列（`m.label`）と比較していた。正しくは `o[3]` がラベル。`data-week` 自体（`o[2]`）を `jumpMonths[].weekKey` と突き合わせる検証が欠落していたため追加した。
- 修正: `ui/week-nav-ssr.test.mjs:72-73` を `wk-step wk-prev`／`wk-step wk-next` に、`:85-87` に `weekKey` 突合を追加しラベル比較を `o[3]` に直した。修正後、該当2件を含む13件全緑（`node --test ui/week-nav-ssr.test.mjs`）。

### ③ `ui/copy-source-e2e.test.mjs:144`（製品側の問題・FAIL理由に計上）

- テストは `#ed-aim`（ねらい）に値をセットして「中身がある」状態を作り、他日取り込みで確認ダイアログが出ることを期待する。
- 実装の `modelHasContent()`（`ui/editor.mjs:570-580`）は `model.rows` の見出し・項目名だけを見ており、`ed-aim` の値を見ない。この関数は今回の差分で変更されていない既存関数（`git diff HEAD -- ui/editor.mjs` で確認、文言変更のみ `:838`）。
- spec §7.2 は「`copy-from` 分岐は現行のままで、確認の文言だけ変える」とし、`modelHasContent()` をそのまま使う前提で書かれている。ux-analysis.md 2.4節は「中身があるところへ取り込む」→「確認で止める」とし、「中身」を rows に限定していない。
- 実害: ねらいだけ入力して保存前の日に、他日を「この日を取り込む」で取り込むと、確認なしでねらい・コート・時間割が無警告で上書きされる。fail-closed 方針（保存失敗は入力を残しエラー文）とは別軸だが、破壊的操作の確認漏れであり、テストは製品側の穴を正しく検出している。テストは修正しない。

## 3. Playwright実機通し

`node --test` 経由の既存e2e（`week-nav-e2e.test.mjs`・`copy-source-e2e.test.mjs`、buildPlanData→render実駆動）に加えて、独自スクリプト（`.tmp/qa-20260905/verify3〜8.mjs`、セッション終了時に削除）で招聘の①〜⑨を実測した。

| # | 項目 | 結果 |
|---|---|---|
| ① | 前の週で過去週表示・週タブ4枠の見た目不変 | 4枠とも `font-size:14px` `font-weight:600` `border-radius:999px` で押下前後不変。幅は115〜118pxで数px出入りするが、これはラベル文字列の数字グリフ幅差によるもので `.pk` のCSS定義（`ui/styles/pattern-timeline.css:286`、min-width指定のみで固定widthなし）は今回差分で不変。既存仕様どおり |
| ② | 過去週: 叩き台なし・上書き日は編集可・空日は「記録なし」＋1導線 | `week-nav-e2e.test.mjs` で緑（保存後の再描画・自動に戻す後の1導線維持を含む） |
| ③ | 「今週へ戻る」は今週以外で出現 | 同上で緑 |
| ④ | 年月で飛ぶ | 同上で緑（最古月選択で窓移動を確認） |
| ⑤ | 到達下限で「前の週」停止 | 同上で緑 |
| ⑥ | 過去週の月目標: 同年度はその週の月キーで表示・編集、年度外は非表示 | SSR側は `week-nav-ssr.test.mjs` で緑。実編集も独自検証: 過去週（`monthArcKey=8`）の月目標を編集・保存し、POST の `key` が `8` と一致、今週側の月セル表示は無関係のまま。年度外週は `.goalbar--week-only` で月セル無し（SSRテストで確認済み） |
| ⑦ | コピー元「おすすめ」最大3件・「探す」・取込ボタン・3択の並び | 独自検証: fabricated候補で「直近の金曜／前回の練習日／去年の同じ頃」の順で3件描画を確認。3択トグルは「女子のみ→男子のみ→男女両方」で既存順のまま |
| ⑧ | 候補0件の空状態 | 独自検証: `allCoachDays=[]` で `.ed-hint` に案内文「コピーできる保存済みの日がまだありません。他の日を保存すると、ここから選べるようになります。」が出て `.cf-group` は描かれない |
| ⑨ | 320/375/414/768pxで横スクロールなし | 週ナビ込みは `week-nav-e2e.test.mjs` で4幅とも緑（`document.documentElement` の overflow差分 ≤1px）。編集パネル（コピー元込み）でも4幅とも document レベルの横スクロールは無し（375/414/768pxは panel 内部も overflow 0）。320pxのみ `.ed-panel` 内部の scrollWidth が clientWidth を8px超過（原因は既存の男女3択トグル `.modetoggle .mt` 3ボタンで、`base.css:32-40` は今回差分で無変更・documentレベルの横スクロールには現れない・スコープ外として6章に記載） |

## 4. 不具合3・4の非回帰確認

`.tmp/qa-20260905/verify.mjs`（`docs/findings/qa-20260905-goal-local-update-and-split-flag.md` 作成時のスクリプトをそのまま流用）を現差分に対して再実行し、同ファイルの①〜⑤の期待値と全一致することを確認した。目標保存の局所更新（月保存で週目標・練習メニュー未保存入力が残る、`location.reload`呼び出し0）、男女別フラグ split の2列維持、保存失敗時の fail-closed（入力保持・エラー文表示）はいずれも退行なし。

## 5. ビルド

- `node ui/build.mjs` → `生成: 1パターン (timeline) ＋ index.html` で正常終了。
- `npm --prefix functions run build` → 正常終了。生成物 `functions/dist/index.mjs` に `computePastWeekDefs`・`copySourceCandidates` の参照が入っていることを grep で確認（5件ヒット）。

## 6. hallmark実体検査

変更されたCSS（`ui/styles/pattern-timeline.css`・`ui/styles/editor.css`）の差分を全件確認した。

- side-stripe（border-left 2-6px solid）: 0件（`.cf-pick`・`.mt` とも全周1pxのborder）
- 汎用書体（Inter/Roboto/Open Sans/Helvetica）: 0件
- purple/pink/violet gradient、background-clip:text: 0件
- 全幅centered hero、定型ナビ、icon-grid、re-drawn chrome: 該当なし（部品追加のみ）
- 絵文字: 0件
- 色・書体は全て `var(--*)` 経由（`--on-label-accent`・`--action-move-fill`・`--action-move-fill-hover`・`--on-action-move`・`--on-action-move-hover`・`--on-action-disabled`・`--focus-ring`・`--surface-card`・`--line-hairline`・`--surface-ground`・`--on-surface`・`--on-surface-muted` は全て `ui/styles/tokens.css` に実在確認済み）、独自hexなし

検出ゼロ。

## スコープ外の観察事項（合否に影響しないが記録）

320px幅でコピー元パネルを開いた際、`.ed-panel` 内部の `scrollWidth` が `clientWidth` を8px超過する（3.表⑨参照）。原因は既存の男女3択トグル（`.modetoggle .mt`、3ボタンの合計幅がコンテナ幅を超える）で、`ui/styles/base.css` の当該定義は今回の差分に含まれていない（`git diff HEAD -- ui/editor.mjs` に3択トグル生成部分の変更なし）。document レベルの横スクロールには現れず、招聘の検証項目⑨（320/375pxで横スクロールが出ない）の直接の合否対象ではないが、320px幅での既存の潜在的な見切れとして別途調査に値する。

## 7. 結論

週ナビ・コピー元機能の実装自体（buildPlanData の `pastWeeks`・`monthArcKey`・`copySourceCandidates`、SSR描画、クライアント窓制御）は spec どおりに動作し、実機確認①〜⑨のうち①〜⑨全項目で期待挙動を満たす。不具合3・4の非回帰も確認した。

先行テストの不備1件（week-nav-ssr.test.mjs、修正済み）とは別に、コピー元の上書き確認（`modelHasContent()`）が「ねらい」フィールドを見ない既存の穴があり、コピー機能の利用機会が増える本改修によって実害の顕在化機会も増える。この1点により **QA FAIL**。

## 8. FAIL理由

- `ui/editor.mjs:570-580` `modelHasContent()` が `model.rows` のみを見て `#ed-aim`（ねらい）を見ないため、ねらいだけ入力した未保存の日に他日を「この日を取り込む」で取り込むと、確認なしで無警告上書きされる（`ui/copy-source-e2e.test.mjs:144` が検出）。

## 9. 再QA（`ui/editor.mjs:570-582` の修正後）

実装者が `modelHasContent()` に `model.aim`・`model.title` の非空チェックを追加した（コメントも「ねらい・タイトル・見出し or 名前のある項目」に更新）。この修正に対して以下を実走した。

### 9.1 テスト全件・ビルド

```
node --test ui/*.test.mjs      # tests 277 / pass 277 / fail 0（copy-source-e2e.test.mjs:144 含め全緑）
node --test functions/*.test.mjs  # tests 98 / pass 98 / fail 0
node ui/build.mjs                 # 生成: 1パターン (timeline) ＋ index.html
npm --prefix functions run build  # 正常終了
```

### 9.2 差分範囲の確認

`git diff HEAD -- ui/editor.mjs` は114行追加・17行削除だが、大半（`GOAL_SAVED_EVENT` 購読・`copySourceCandidates` 注入・`goalKeys` island化等）は本セッション開始前から存在した週ナビ・コピー元・不具合3対応の既存差分（spec §5.3「`bcs:goal-saved` listener は現行のまま」と一致、`ui/goal-editor.mjs:20` の `GOAL_SAVED_EVENT` export も既存）。今回の増分は `ui/editor.mjs:569-582` `modelHasContent()` の本文とコメントのみで、他の業務ロジックへの混入はない。

### 9.3 Playwright実機確認（独自スクリプト、`.tmp/qa-20260905/verify-refix*.mjs`）

| # | 操作 | 結果 |
|---|---|---|
| 1 | ねらいだけ入力 → おすすめ行を選び「この日を取り込む」 | `window.confirm` が「いまの内容を、2026/06/25（木）の内容で置き換えます。よろしいですか？」で発火。キャンセルで元のねらいが残る |
| 2 | 同上、確認をacceptで実行 | 内容が取り込み元に置き換わる |
| 3 | ねらいだけ入力 →「自動生成に戻す」 | **確認カードが出ない**（`cardShown:false`）。キャンセル操作なしで即実行可能な状態のまま |
| 4 | ねらいだけ入力 →「叩き台を読み込む」（`load-seed`、SEEDPREFILLがある日） | **確認ダイアログが出ない**（`dialogAppeared:false`）。ねらいが即座に叩き台の内容へ上書きされた |
| 5 | 中身が本当に空 →「自動生成に戻す」 | 確認なし即実行（非回帰、想定どおり） |
| 6 | ねらいだけ入力 →「キャンセル」 | 確認カードが出る（想定どおり） |

### 9.4 原因

`ui/editor.mjs` の `onPanelClick` は `collectInputs()`（DOM入力値を `model` へ取り込む関数）を `act==='cancel'` の分岐内（:789）と、`only-gender`/`add-row`/`copy-from` 等の分岐に共通で入る手前（:811）の2箇所でしか呼んでいない。`revert-auto`（:801）と `load-seed`（:802-809）はどちらも `collectInputs()` を呼ぶ**前**に `revertAuto()` を実行するか `modelHasContent()` を判定してリターンする分岐にあるため、テキストエリアへ入力した最新の「ねらい」が `model.aim` に反映されないまま判定される。結果、`modelHasContent()` 自体の修正は正しくても、この2経路では修正前と同じ実害（無警告上書き）が残る。

`copy-from` が正しく動くのは、その分岐が :811 の `collectInputs()` より後にあるため。

### 9.5 不具合3・4・週ナビの非回帰

`.tmp/qa-20260905/verify.mjs`（前回同様）は再実行していないが、`node --test` 全緑（`goal-editor-no-reload.test.mjs`・`pattern-timeline-split-flag.test.mjs`・`split-flag-*.test.mjs`・`week-nav-*.test.mjs` を含む）により機械的な非回帰は確認済み。

## 10. 最終結論

`modelHasContent()` 自体の修正は正しいが、`revert-auto`・`load-seed` の2経路が `collectInputs()` を呼ばずに判定するため、「ねらいだけ入力した日」で無警告上書きが起きる実害が形を変えて残っている。**QA FAIL**。

### 最終FAIL理由（1回目修正後時点）

- `ui/editor.mjs:801` `revert-auto` 分岐が `collectInputs()` を呼ばずに `revertAuto()`（内部で `modelHasContent()` を判定）を実行するため、ねらいだけ入力した状態で「自動生成に戻す」を押しても確認カードが出ず、無警告で内容が消える。
- `ui/editor.mjs:802-809` `load-seed` 分岐も同様に `collectInputs()` を呼ばずに `modelHasContent()` を判定するため、ねらいだけ入力した状態で「叩き台を読み込む」を押しても確認なしで無警告上書きされる。

## 11. 再々QA（`ui/editor.mjs:801-806` の `collectInputs()` 先行修正後）

実装者が `revert-auto` 分岐（`:801`）を `collectInputs();revertAuto(btn);` に、`load-seed` 分岐（`:802-806`）の先頭に `collectInputs();` を追加した。

### 11.1 テスト全件・ビルド

```
node --test ui/*.test.mjs         # tests 277 / pass 277 / fail 0
node --test functions/*.test.mjs  # tests 98 / pass 98 / fail 0
node ui/build.mjs                 # 生成: 1パターン (timeline) ＋ index.html
npm --prefix functions run build  # 正常終了
```

### 11.2 差分範囲の確認

```diff
     if(act==='export'){exportJson();return;}
-    if(act==='revert-auto'){revertAuto(btn);return;}
+    if(act==='revert-auto'){collectInputs();revertAuto(btn);return;}
     if(act==='load-seed'){
+      collectInputs(); // DOMの最新入力値を取り込んでから「空」を判定する（change未発火の入力欄も拾う）
       var seed=SEEDPREFILL[model.date];
```

差分は当該2分岐（`collectInputs()` の呼び出し追加）のみ。他の業務ロジックへの混入なし。

### 11.3 Playwright実機確認（`.tmp/qa-20260905/verify-refix5.mjs`）

「ねらいだけ入力」した状態で3経路すべてを確認した。

| # | 操作 | 結果 |
|---|---|---|
| 1 | ねらいだけ入力 →「この日を取り込む」 | `window.confirm` 発火、キャンセルで元のねらいが残る（既存回帰なし） |
| 2 | ねらいだけ入力 →「自動生成に戻す」 | 確認カードが出る（`cardShown:true`）。キャンセルで元のねらいが残る |
| 3 | ねらいだけ入力 →「叩き台を読み込む」 | `window.confirm` が出る（`dialogAppeared:true`）。キャンセルで元のねらいが残る |
| 4 | 中身が本当に空 →「自動生成に戻す」（非回帰） | 確認なし即実行（`cardShownEmpty:false`、想定どおり） |

3経路すべてで「ねらいだけ入力」が「中身あり」と正しく判定され、無警告上書きは解消された。真に空の場合の即実行（非回帰）も維持されている。

### 11.4 主要通しの非回帰

`node --test` 全緑（277/277・98/98）により、週ナビ（`week-nav-*.test.mjs`）・コピー元（`copy-source*.test.mjs`）・不具合3・4対応（`goal-editor-no-reload.test.mjs`・`split-flag-*.test.mjs`）を含め退行なし。

## 12. 最終結論

`modelHasContent()` の判定ロジック修正（9章）と、呼び出し元2分岐の `collectInputs()` 先行修正（11章）により、「ねらいだけ入力した日」への無警告上書きは3経路（他日を取り込む・自動生成に戻す・叩き台を読み込む）すべてで解消された。テスト277+98件全緑、両ビルド正常、差分は指摘範囲のみ、主要機能（過去週ナビ・コピー元・不具合3・4対応）の非回帰も確認した。

**QA PASS**。
