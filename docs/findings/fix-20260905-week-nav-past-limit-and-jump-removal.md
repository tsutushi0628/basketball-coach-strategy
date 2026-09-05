# fix: 週ナビの「年月で飛ぶ」削除と到達下限の廃止（2026-09-05）

> 対象: basketball-coach-strategy（HEAD時点 a130018 から作業）。
> 背景: 過去週ナビ機能（`docs/findings/spec-20260905-past-weeks-and-copy-source-impl.md` 準拠）は実装済みだった。
> 本番を見たオーナーが2点を差し戻した。本ファイルはその修正の記録。
> Codexラッパー（`.claude/fusion/codex-task--run--with-rules-and-worklog.sh`）を先に試行したが
> 「使用量上限枯渇」で中断（`[codex] Codex error: You've hit your usage limit.`）。以降はSonnet直修正。

## 差し戻し内容と対応

1. 「年月で飛ぶ」（ラベル・select・関連CSS・`jumpToMonth`・`computeJumpMonths`・SSRでの`jumpMonths`出力）を全削除。
   「今週へ戻る」は独立行から「次の週」と同じ行の右端（次の週の隣）へ移動。表示中週が今週なら
   非表示（既存の`data-shown="false"` + `visibility:hidden`のまま）。
2. 到達下限を廃止。「前の週」は常に押せる（`disabled`属性の付与ロジックを削除）。
   - `computePastWeekDefs`の下限を「今週の4週前」から「今日と同じ学校年度の4月1日を含む週」に変更
     （最古のコーチ上書きがそれより古ければそちらを優先する規則は維持）。
   - 窓の先頭（`ORDER[0]`）よりさらに「前の週」を押すと、その週の1週前の月曜ISOを`?week=`クエリに
     付けて同一URLへページ遷移する（既存クエリは保持）。サーバ（`functions/index.mjs`）は`?week`を
     `buildPlanData`の新オプション`weekQuery`へ渡し、`pastWeeks`の学校年度アンカーを差し替えて
     その年度の4月1日週まで下限を広げる。`weeks`（今週+3週）・`goalKeys`・`session`・既習連鎖は不変。

## 実データ実測（設計判断の裏付け）

`LOCAL_FIXTURE_TODAY=2026-06-22`の種データで検証:
- 通常時: `pastWeeks.length=12`、先頭週`weekStartDate=2026-03-30`（学校年度2026の4/1週）。
- `weekQuery='2026-03-23'`（学校年度2025の週）を渡すと: `pastWeeks.length=64`、先頭週`weekStartDate=2025-03-31`
  （前年度の4/1週まで拡張）。この間`weeks`のkey配列と`goalKeys`は完全一致（不変）。
- 不正な`weekQuery`（ISO形式でない）は`buildPlanData`が`Error`を投げる（サーバ側では500 `render error: ...`）。

Playwright実測（`ui/week-nav-e2e.test.mjs`）:
- `pastWeeks`の先頭週まで「前の週」を12回連打しても`disabled`にならず押せたまま。
- そこからもう1回押すと`location.href`に`?week=<先頭週の1週前の月曜ISO>`が付いて実際にページ遷移する
  （`page.waitForNavigation`で検知）。
- `.wk-row`内で`.wk-prev`・`.wk-next`・`.wk-today`が同じ行（`top`一致）・`left`昇順（prev<next<today）
  であることを320/375/414/768pxの全幅で実測（別途書き捨てスクリプトで確認、リポジトリには残さない）。

## 変更ファイル

- `ui/plan-data.mjs`: `computeJumpMonths`削除、`computePastWeekDefs`のシグネチャに`schoolYearAnchorMonday`
  （第3引数・省略可）を追加し下限計算を学校年度基準に変更、`buildPlanData`に`weekQuery`オプション追加
  （ISO形式チェック・`pastWeeks`計算にのみ反映）。
- `ui/pattern-timeline.mjs`: `weekNav`から`jumpMonths`引数・`.wk-jump`ブロックを削除、`.wk-today`を
  `.wk-row`内`.wk-next`直後へ移動、`.wk-prev`の`disabled`分岐を削除、週タブに`data-monday`属性を追加。
- `ui/render-shared.mjs`: `clientScript()`から`selectedMonthValue`・`jumpToMonth`を削除、`applyWindow()`の
  `.wk-prev`disabled制御を削除、`stepWeek`に窓外遷移時の`?week`ページ遷移（`goToPastBeyondWindow`）を追加。
- `ui/styles/pattern-timeline.css`: `.wk-jump`系3ルール削除、`.wk-today`の配置をorderで`.wk-row`の
  右端（`.wk-next`の隣）に固定。
- `functions/index.mjs`: `?week`クエリの読み取り・形式検証・`buildPlanData`への受け渡し。
- `ui/past-weeks.test.mjs`・`ui/week-nav-ssr.test.mjs`・`ui/week-nav-e2e.test.mjs`: 「年月で飛ぶ」
  「到達下限」に関する期待を新仕様へ書き換え（他のテストは変更なし）。
- 生成物（`functions/dist/index.mjs`・`ui/index.html`・`ui/pattern-timeline.html`、いずれも.gitignore対象）
  は各ビルドコマンドで再生成済み。

## 検証結果

- `node --test ui/*.test.mjs`: 274件全緑。
- `node --test functions/*.test.mjs`: 98件全緑。
- `npm run build:static`・`npm --prefix functions run build`: いずれも成功。
- hallmark実体検査（border-left side-stripe・汎用書体・purple/pink gradient・絵文字）: 変更ファイルに
  ゼロ件（grep実測）。

## 未コミット

commitはしていない（招聘条件どおり）。`git status`は`ui/plan-data.mjs`ほか対象8ファイルが`M`。
