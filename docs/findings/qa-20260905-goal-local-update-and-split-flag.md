# QA: 目標保存の局所更新と男女別フラグ split（2026-09-05）

> type=qa。対象: 未コミットの作業ツリー差分（`spec-20260905-goal-local-update-and-split-flag.md` 実装分）。
> 判定: **QA PASS**。

## 1. テスト全件実走

```
node --test ui/*.test.mjs functions/*.test.mjs
# tests 276 / pass 276 / fail 0
```
内訳: ui 215件（既存 + 新規 `goal-editor-no-reload.test.mjs` `pattern-timeline-split-flag.test.mjs` `split-flag-round-trip.test.mjs` `split-flag-save-pipeline.test.mjs` `toggle-both-split-flag.test.mjs` `two-col-together-split-flag.test.mjs` 含む）、functions 61件。

## 2. 実機通し確認（Playwright chromium、実IIFE駆動）

`.tmp/probe-3-4/probe-f-part1.mjs` の駆動方式を流用し、`.tmp/qa-20260905/verify.mjs` `verify2.mjs` を新規作成して実測（サーバ応答は `window.fetch` を差し替えて模擬し、`location.reload` に計数器を仕込んで検知）。

### ① 月/週目標＋練習メニューの同時編集・局所更新
月目標ボックスに新値を入れて保存。週目標ボックス（未保存）と練習メニュー編集パネル（未保存の「ねらい」）はそのまま残存。`location.reload` 呼び出し回数 = 0。
表示反映先を全実測: goalsBar `QA月目標・新値`／monthSection `.mc-aim` 同値／goalsSection `.gline[data-goal-view]` 同値／年タブ arccell の男子側 title・女子側 title とも同値に更新。

### ② 「自動に戻す」の局所更新
週目標ボックスに未保存入力を残したまま練習メニュー編集パネルで「自動生成に戻す」を実行。`location.reload` 回数 = 0。週目標ボックスの未保存値は保持。対象日は空状態（「入力する」「自動で叩き台を入れる」の2ボタン）へ局所再描画され、パネルは閉じ、article は表示状態を維持。

### ③ 男女別→合流→男女別（共通ON→入力→共通OFF）の3行目
実際のチェックボックス操作で行1=男女別／行2=共通ON入力／行3=共通ON→入力→共通OFFの順に作成。保存前に `buildOverride()` で行3が `split:true` を持つことを確認、保存実行後に再描画された article の `.spine-row` クラス列を実測 → 行3は `tc2-only tc2-split` のまま2列を維持（`tc2-runhead` 見出し数=2で一致）。

### ④ 旧データ（フラグ無し・同一内容）の畳み
`storage.getOverrides` に `split` キー無し・男女同一内容の行を差し込み、`buildPlanData → render` の実配線を通して描画 → `tc2-together`（1本）に畳まれることを確認（既存仕様どおり非回帰）。
対照として同じ内容に `split:true` を付けた行も同一配線で描画 → `tc2-split`（2列）を維持することを確認（③のUI操作結果と同じ配線であることの裏取り）。

### ⑤ 保存失敗時のfail-closed
`/api/tenant/goal` を 500 応答に差し替えて週目標を保存 → ボックスは消えず入力値 `QA週目標・未保存のまま残るはず` を保持、保存ボタンは再有効化（`disabled:false`）、フッタに `server-error` を表示。エラーを握りつぶして正常系に偽装する挙動は無い。

全シナリオで `pageerror` / コンソールエラー = 0件。

## 3. 差分点検（実装者報告の2点）

- **既存テスト2件の正規表現修正**（`ui/default-blank-autofill.test.mjs`・`ui/multiweek-day.test.mjs`）: `data-goal-val` 属性の追加に伴い `(?: data-goal-val)?` を許容する変更のみ。検証対象（「未入力」が `es-inline` で淡色表示される事実）は変えていない。業務意図の変更なし。
- **`ui/build.mjs` の副次修正**: (a) `pattern-*.mjs` 収集時に `.test.mjs` を除外（新規 `pattern-timeline-split-flag.test.mjs` を誤ってパターンとして読み込む状態だった）、(b) `import('./' + f)` を `pathToFileURL(resolve(...))` 化。`npm run build:static` を実走し「生成: 1パターン (timeline) ＋ index.html」で正常終了を確認。(a)の必要性は `ls ui/pattern-*.mjs` で実在ファイルが `pattern-timeline.mjs` と `pattern-timeline-split-flag.test.mjs` の2つだけであることから裏取り済み。スコープ外の変更混入なし。

## 4. functions/dist の再ビルド反映

`.gitignore:15` で `functions/dist/` は除外対象（`git check-ignore -v` で確認）。`npm --prefix functions run build` を再実行し、生成物 `functions/dist/index.mjs` に `rr.split === true` の分岐が反映されていることを確認（`grep -n "rr.split === true" functions/dist/index.mjs` → 6539行に存在）。報告どおり。

## 5. スコープ外の観察事項（合否に影響しないが記録）

`git diff` に `docs/sessions/term-kickoff.md` / `docs/sessions/term-kickoff.pdf` の変更が含まれている。内容はシーズン計画文書の書き直し（月別テーマの並び替え等）で、対象の不具合3・4とは無関係。この2ファイルの変更が今回のバグ修正作業由来か別セッションの持ち越しかは本QAの対象外だが、次にコミットする際は誤って同じコミットに含めないよう注意が要る。

## 6. 結論

不具合3（保存で他の未保存入力が消える）・不具合4（男女別フラグの畳み込み事故）とも、実装は spec の設計どおりに動作し、実機確認①〜⑤の全項目で期待挙動を満たす。fail-closed（保存失敗時に握りつぶさず入力保持＋エラー表示）も満たす。テスト276件全green。差分点検・functions/dist再ビルドともに実装者報告と一致。

QA PASS。
