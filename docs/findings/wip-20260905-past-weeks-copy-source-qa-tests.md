# wip: 過去の週ナビとコピー元「おすすめ＋探す」のQA先行テスト（2026-09-05）

対象は `docs/findings/spec-20260905-past-weeks-and-copy-source-impl.md` の11章「qa-engineerが先行テストで固定する仕様」。
実装（Codex）に先立ち、純関数・SSR出力・実ブラウザ通しの3層でテストを先に用意した。
アプリ本体のコードは変更していない。

## 完了

新規テストファイルを5件作成した。

`ui/past-weeks.test.mjs` は `computePastWeekDefs`・`schoolYearOf`・`arcMonthOfWeek`・`computeJumpMonths` と、`buildPlanData` が返す `pastWeeks`・週ごとの `monthArcKey`・`monthGoal` を検証する。
`ui/copy-source.test.mjs` は新設予定の `ui/copy-source.mjs` の `copySourceCandidates`（おすすめ最大3件・探すの年月グルーピング・`searchable`・`initialYm`）を検証する。
`ui/week-nav-ssr.test.mjs` は `render()` が出す `.wknav`・過去週の `.daywk[data-past]`・過去週の空日文言・週ごとの月セルキーを、`clientScript()`・`editorScript()` の文字列注入とあわせて検証する。
`ui/week-nav-e2e.test.mjs` と `ui/copy-source-e2e.test.mjs` は Playwright(chromium) で、週送り・年月ジャンプ・今週へ戻る・過去週の記録入力と自動に戻す・コピー元のおすすめ／探すの実操作を通しで検証する。

既存ファイル `ui/multiweek-day.test.mjs` は設計メモ8章の指示どおり、`.daywk` グループ数・月目標バー件数の期待値を `data.weeks.length` から `data.pastWeeks.length + data.weeks.length` へ直した（3箇所）。
検証意図（各週に独立した日グループがある、各週グループに月目標バーがある）は変えていない。
同ファイルの他のテスト（「月目標は全週グループで不変」等）は指示の対象外のため触っていない。

## 現状（実走確認済み・2026-09-05）

`node --test ui/*.test.mjs` は 245件中 220件パス、25件失敗。
失敗25件の内訳と理由は次のとおりで、いずれも未実装に由来する。

`ui/past-weeks.test.mjs` と `ui/copy-source.test.mjs` はファイル単位で1件ずつ失敗する。
前者は `computePastWeekDefs`・`schoolYearOf`・`arcMonthOfWeek`・`computeJumpMonths` が `ui/plan-data.mjs` に未エクスポートで、ESMの名前付きインポート解決がモジュール読み込み時点で例外になるため。
後者は `ui/copy-source.mjs` 自体が未作成で `Cannot find module` になるため。

`ui/week-nav-ssr.test.mjs` は13件中9件が失敗する。
原因は `buildPlanData` の戻り値に `pastWeeks`・`jumpMonths`・週ごとの `monthArcKey` が無く、`render()` も `.wknav`・`data-past`・過去週の空日分岐・`.goalbar--week-only` を描かないため。
残り4件（週起点未設定で `.wknav` を出さない、初期可視日が1つ、今週・未来週の空日は現行の2導線のまま、先頭週の月キーが `goalKeys.monthArcKey` と一致）は現状の実装のまま既に成立している回帰ガードで、実装後も崩れないことを固定する目的で残した。

`ui/week-nav-e2e.test.mjs` は11件中7件が失敗する。
`.wknav`・`.wk-prev`・`.wk-next`・`.wk-today`・`.wk-jump-sel` が未実装のためセレクタ待ちがタイムアウトし、過去週の1導線空状態や月目標のその場更新も未実装で検証できない。
残り4件（320・375・414・768pxで横スクロールが出ない）は現行レイアウトで既に成立している回帰ガード。

`ui/copy-source-e2e.test.mjs` は4件とも失敗する。
`copyFromOptions()` が単一 `<select id="ed-copyfrom">` のままで、`.cf-radio`・`.cf-group`・`.cf-ym`・`.cf-day` のいずれも存在しないため。

`ui/multiweek-day.test.mjs` は10件中3件が、指示どおり直した期待値によって失敗する（`data.pastWeeks` が未定義のため件数比較が `TypeError` になる）。
それ以外の7件は非回帰のまま緑。

Playwright のブラウザ駆動は `goal-editor-no-reload.test.mjs`・`only-gender-render.test.mjs` と同じ方式（`buildPlanData`→`render`→`renderPage` で1枚のHTMLに焼き、実IIFEを直接駆動、`fetch`と`location.reload`をモック）を流用した。
`ui/copy-source-e2e.test.mjs` は種データの上書きが2026年6月の3件しかなく「探す」の複数月を再現できないため、`data.allCoachDays` に他月・前年の候補を複製・改変して補った（`only-gender-render.test.mjs` と同じ「実データを加工してrender」の作法）。

## 次のアクション

Codex が `docs/findings/spec-20260905-past-weeks-and-copy-source-impl.md` 12章の分割（4回）に沿って実装し、本ファイル群のRed状態をGreenへ倒す。
実装完了後は `node --test ui/*.test.mjs` を再実走し、245件全パスを確認する。
