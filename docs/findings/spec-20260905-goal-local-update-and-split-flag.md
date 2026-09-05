# spec: 目標保存の局所更新と男女別フラグ split の技術設計（2026-09-05）

> type=spec。対象リポジトリ = basketball-coach-strategy（バスケ練習計画Webツール）。
> 実装者（Codex）向けの変更点の単一真実源。行番号は 2026-09-05 時点の main。
> 土台となる出荷済み機能は `docs/findings/handoff-20260626-plan-goal-edit-and-unification.md`（目標編集）と
> `docs/findings/spec-20260701-gender-day-modes.md`（男女共通トグルとオンリーモード）。

## 0. 結論

不具合3（目標を保存すると別の未保存入力が消える）は、目標保存の成功時に `location.reload()` する設計そのものが原因である。
再読込をやめ、保存した scope と key に一致する表示ノードだけを書き換えて編集ボックスを閉じる（完全独立）。
「自動に戻す」も同じ再読込を持つので、同時に局所更新へ置き換える。

不具合4（共通ON→入力→共通OFFで男女が1本に畳まれる）は、描画側が「男女セルの内容が同一なら合流」と推定していることが原因である。
保存行に明示フラグ `split: true` を持たせ、フラグのある行は内容が同一でも2セルで描く。
同一内容の畳みは「フラグの無い旧データ」だけに残す。

## 1. 現行の事実

### 1.1 不具合3

- 月/週目標の保存は `ui/goal-editor.mjs:144` で成功時に `location.reload()` する。同じページで開いていた別の目標ボックスの未保存入力と、練習メニューの入力パネル（`section.ed-panel`、未保存）が丸ごと消える。
- `ui/editor.mjs:1245`（自動に戻す）にも同じ `location.reload()` がある。
- 練習メニューの保存は `ui/editor.mjs:1160-1166` で `renderDay`＋`closePanel` の局所更新であり、目標ボックスは消さない。オーナーが感じた「月の目標の編集が反映されないのに修正モードが終わる」は、目標保存の再読込で入力パネルが消える現象の裏返しである。
- 保存先は `overrides/{date}`（丸ごと set）と `goalOverrides/current`（merge）で独立しており、相互にキーを巻き込まない（`functions/index.mjs:534-561`）。
- 目標の表示は複数箇所に複製されている。月目標は週ごとの goalsBar（`ui/render-shared.mjs:272`、日タブの各 `.daywk` に1つ）、月タブの monthSection（同 `:376`）、月タブの goalsSection（同 `:294`、編集導線なし）、年タブの arccell（同 `:335`、男子行のみ編集導線あり、女子行は title 属性のみ）、印刷用の日ヘッダ `.dh-goals`（同 `:155`）に出る。週目標は goalsBar の週セル（週キーごと）、週タブの weekLevel（`ui/pattern-timeline.mjs:597`）、goalsSection、`.dh-goals` に出る。
- 空文字保存は該当キーの削除であり、表示は「未入力」に戻る（`ui/plan-data.mjs:877` applyGoalOverridesWithEmpty が上書きの無い目標を空にする）。したがって保存後の表示値はサーバ応答の `text` だけで決まり、エンジン既定値をクライアントが知る必要はない。
- 保存API `POST /api/tenant/goal` は成功時に `{ok:true, scope, key, text}` を返す（`functions/index.mjs:558`）。`text` は trim 済み。
- `ui/editor.mjs:271` の印刷用 `.dh-goals` はページ読込時の `ED.goals`（`GOALS`）から描く。再読込をやめると、目標保存の後に練習メニューを保存したとき古い目標で描き直す。

### 1.2 不具合4

- 共通OFFの `splitFromBoth`（`ui/editor.mjs:1001-1013`）は、共通セルを編集していれば同一内容を男女両側へ複製する。
- 描画側の `isTogetherRow`（`ui/two-col-together.mjs:32-36`）は `row.both` があるか、男女セルが同一内容なら真を返し、1本の全幅行に畳む。`ui/pattern-timeline.mjs:284`、`ui/editor.mjs:355,391`、`ui/render-shared.mjs:703,726` の4系統が同じ関数を使う。
- 編集モデルには「男女別として保存した」情報が無い。新規行（`blankRow`）は男女別2ボックスで始まるので、手入力で同一内容にしても同じく畳まれる。
- 同一内容の畳みは `ui/two-col-duplicate-collapse.test.mjs` で固めた仕様であり、旧データ（フラグ無し）の互換として残す。
- `ui/plan-data.mjs:629-645` の `toTwoColDay` は行を `from/to/minutes/both/boys/girls` に写し替える。ここに無いキーは描画側へ届かない。
- 組違い（自動生成のローテーション）でコーチ付き側と自走側に別ドリルが並ぶ話と、コーチが手で同一内容を左右に入れた行を2本で描く話は別物である。本書は後者だけを扱う。

## 2. 不具合3の設計

### 2.1 表示ノードの統一

局所更新が一意に書けるよう、目標の表示値を持つ要素に2種類の属性を導入する。

- `data-goal-val`：表示値そのものを持つ要素。空のときは `es-inline` クラスを持ち、空時文言を表示する。空時文言は既定「未入力」、例外は `data-goal-empty` 属性で指定する。
- `data-goal-view="<scope>:<key>"`：編集導線を持たないが同じ目標を表示する要素。局所更新の対象に含める。

付与先は次の6箇所である。

| 描画関数 | 変更 |
|---|---|
| `ui/render-shared.mjs:272` goalsBar | `.gb-val` に `data-goal-val` を付ける（月・週の両セル）。 |
| `ui/render-shared.mjs:294` goalsSection | 今月の `.gline` に `data-goal-view="month:<goalKeys.monthArcKey>"`、今週の `.gline` に `data-goal-view="week:<goalKeys.weekKey>"`、それぞれの `.txt` に `data-goal-val`。キーが無ければ属性を付けない。 |
| `ui/render-shared.mjs:376` monthSection | `.mc-aim` の中身を `<span data-goal-val data-goal-empty="今月の目標は未入力">` で包む。`es-inline` は div ではなく span に付ける（`.es-inline` は要素に依存しないスタイルなので見え方は変わらない）。 |
| `ui/render-shared.mjs:335` yearSection | 女子行の arccell に `data-goal-view="month:<a.month>"` を付ける（title 属性の更新用）。男子行は `data-goal-edit` が既にあるので変更しない。 |
| `ui/pattern-timeline.mjs:597` weekLevel | `focusNote` の値部分を `<span data-goal-val>` で包む。空時は `<span class="es-inline" data-goal-val>未入力</span>`。 |
| `ui/render-shared.mjs:155` dayHeader | 変更しない（2.4 で editor 側から丸ごと差し替える）。 |

CSS は変更しない。

### 2.2 クライアントの更新手順

`ui/goal-editor.mjs` の `doSave` 成功分岐（`:144`）を次に置き換える。

1. サーバ応答の `res.text`（無ければ送信値 `text`）を確定値とする。
2. `[data-goal-edit][data-goal-scope="S"][data-goal-key="K"]` と `[data-goal-view="S:K"]` の全要素を集める。
3. 各要素について、`data-goal-edit` を持つなら `data-goal-text` を確定値に更新する。`title` 属性を持つなら `title` を確定値に更新する（年タブの arccell）。要素自身または子孫の `[data-goal-val]` について、確定値が非空なら `textContent` を確定値にして `es-inline` を外し、空なら `data-goal-empty` の文言（既定「未入力」）にして `es-inline` を付ける。
4. `document` に `CustomEvent('bcs:goal-saved', {detail:{scope,key,text}})` を発火する。イベント名は `ui/goal-editor.mjs` が `export const GOAL_SAVED_EVENT` として持ち、`ui/editor.mjs` が import して IIFE 文字列へ埋め込む（依存方向は editor → goal-editor の一方向。goal-editor は editor を import しない）。
5. 自分の編集ボックスを `close()` で閉じる。

他の開いている編集ボックスは触らない。同じ scope と key の別ノードでボックスが開いている場合も、その input の値は触らない（コーチの入力を優先し、`data-goal-text` だけ新値になる）。

ファイル冒頭コメント（`:7`）と関数コメント（`:47`）の「再読込」の記述を局所更新へ書き換える。

### 2.3 失敗時の挙動

現行どおり変更しない。ボックスは閉じず、input と各ボタンを再有効化し、`goalSaveErrorText` の文言をフッタに出す（`:145-152`）。ネットワーク断も同じ。局所更新はサーバが `ok:true` を返した後にしか走らないので、失敗時に表示が先行して変わることはない。

### 2.4 印刷用ヘッダと editor 側の GOALS

`ui/editor.mjs` に次を加える。

- `editorDataIsland`（`:150-198`）の island に `goalKeys: data.goalKeys || null` を追加する。
- `dayHeaderHtml`（`:267-284`）の `goalsPr` 生成を `goalsPrHtml()` に切り出す。
- `bcs:goal-saved` を `document` で listen する。`scope==='month' && key===String(goalKeys.monthArcKey)` なら `GOALS.monthMain=text`、`scope==='week' && key===goalKeys.weekKey` なら `GOALS.week=text` にする（`GOALS` が null なら `{monthMain:'',week:''}` で初期化する）。一致しないキーは何もしない（`.dh-goals` はアンカー週とアンカー月の値だけを出す既存仕様のまま）。
- 更新後、`document.querySelectorAll('.day .dayhead')` を回して既存の `.dh-goals` を取り除き、`goalsPrHtml()` が非空なら `.dayhead` の末尾へ挿入する。

これで「目標保存→練習メニュー保存→印刷」で古い目標が刷られる退行を作らない。

### 2.5 自動に戻すの局所更新

`ui/editor.mjs:1245` の成功分岐を次に置き換える。

1. `delete PREFILL[date]`。
2. `renderEmptyDay(article, date, weekday)` で対象 article の中身を空状態日に描き替える。構造はサーバ描画 `ui/pattern-timeline.mjs:745-753` の空状態分岐と同一クラスで移植する（`dayHeaderHtml` と同じ移植パターン）。日付見出しは `dateLabelISO(date, weekday)`、`dh-court` は `SEEDPREFILL[date]` があればその `court`、無ければ出さない。本文は `.emptystate` に `.es-text`「まだ入力がありません。この日の練習を入力してください。」と `.es-actions` の2ボタン（`data-empty-act="blank"` と `"seed"`、`data-print-hide`）、末尾に `<pre class="plain" hidden></pre>`。空状態導線のクリックは `document` 委譲（`:1410-1414`）なので再描画後もそのまま動く。
3. `if(panel===myPanel)closePanel()` で入力パネルを閉じ、article を再表示する。
4. `flash('自動生成に戻しました')`。

サーバ描画との差は、テンプレ由来の「コーチ不在」表記を空状態ヘッダに出さない点だけである（叩き台島に無い情報のため。次回読込でサーバ描画に揃う）。

## 3. 不具合4の設計

### 3.1 スキーマ

保存スキーマ（`overrides/{date}` の `rows[]`）に任意フィールド `split` を追加する。

- 型：boolean。値は `true` のみ意味を持つ。省略時 `undefined`。
- 意味：この行はコーチが男女別として保存した。内容が同一でも2セルで描く。
- 現れる場所：`男子`/`女子` キーを持つ行だけ。`both` 行と onlyGender 保存時の行には出さない。
- 旧データ：`split` 未指定の行は従来どおり「男女同一内容なら合流」で描く。種データ `engine/data/overrides.json` は書き換えない。

### 3.2 判定規則

`ui/two-col-together.mjs:32` の `isTogetherRow` を次の順序にする。

1. `row` が無ければ false。
2. `row.both` があれば true。
3. `row.split === true` なら false。
4. それ以外は `isSameGenderCell(row.boys || row['男子'], row.girls || row['女子'])`。

関数は `editor.mjs:213` が `.toString()` で注入するので、外部 helper を呼ばない自己完結のまま保つ。ファイル冒頭コメントに `split` の規則を1文足す。

### 3.3 フラグの通り道

「男女別」は編集モデル上で `both` が無い状態そのものなので、`split` は別の状態として持たず、保存時に `both` の有無から導出する。

| 経路 | 場所 | 変更 |
|---|---|---|
| 保存ペイロード生成 | `ui/editor.mjs:1105-1108`（`buildOverride` `:1086` 内）の男女別分岐 | `out.split=true` を出す。onlyGender 分岐と both 分岐は出さない。 |
| サーバ白リスト | `functions/index.mjs:160-165` sanitizeOverride の男女別分岐 | `if (rr.split === true) row.split = true;` を足す（`onlyGender` の前例 `:175-177` と同じ白リスト方式）。 |
| 表示日への変換 | `ui/plan-data.mjs:629-645` toTwoColDay | 行に `split: r.split === true` を足す。ここを落とすと描画側へ届かない。 |
| 再編集用 prefill | `ui/editor.mjs:84-101` dayToPrefill の男女別分岐 | `if (r.split === true) row.split = true;` を足す。`renderDay` と `exportJson` が prefill をそのまま使うため。 |
| 編集モデル | `normalizeModel`（`:429`）、`mergeToBoth`（`:978`）、`splitFromBoth`（`:1001`） | 変更しない。共通ONは `both` を作り、OFFは `both` を消す。この有無が保存時の `split` を決める。 |

司令塔決定の「splitFromBoth で立て mergeToBoth で消す」は、この導出で同じ結果になる。加えて、新規行に手入力で同一内容を入れた場合も2列で保存される（フラグ方式だと `splitFromBoth` を通らない行は畳まれたままになる）。

`ui/editor.mjs:355`（timelineHtml）、`:391`（plainTextOf）、`ui/render-shared.mjs:703,726`（plainText の見出しと行）は `isTogetherRow` 経由なので変更しない。

## 4. 変更ファイル一覧

| ファイル | 関数と行 | 変更点 |
|---|---|---|
| `ui/goal-editor.mjs` | `doSave` `:141-148`、冒頭コメント `:7` `:47` | 再読込を廃止し、2.2 の局所更新とイベント発火に置き換える。`GOAL_SAVED_EVENT` を export する。 |
| `ui/render-shared.mjs` | `goalsBar` `:272-296`、`goalsSection` `:294-312`、`yearSection` `:335`、`monthSection` `:376-380` | 2.1 の属性付与。 |
| `ui/pattern-timeline.mjs` | `weekLevel` `:597-600` | 2.1 の属性付与。 |
| `ui/editor.mjs` | `editorDataIsland` `:150-198`、`dayHeaderHtml` `:267-284`、`revertAuto` `:1245`、IIFE 末尾 `:1405-1416`、`dayToPrefill` `:84-101`、`buildOverride` `:1105-1108` | 2.4 の GOALS 更新と `.dh-goals` 差し替え、2.5 の `renderEmptyDay`、3.3 の `split` 出力と保持。 |
| `ui/two-col-together.mjs` | `isTogetherRow` `:32-36` | 3.2 の判定順序。 |
| `ui/plan-data.mjs` | `toTwoColDay` `:629-645` | `split` を表示日の行へ写す。 |
| `functions/index.mjs` | `sanitizeOverride` `:160-165` | `split` を白リストで通す。 |
| `functions/dist/index.mjs` | 生成物 | `npm --prefix functions run build` で再生成する。手で編集しない。 |

## 5. 影響範囲

- サーバ描画（Cloud Function）：`functions/index.mjs` は `ui/*` を import して esbuild でバンドルする。上記の ui 側変更は `functions/dist/index.mjs` の再生成で反映される。
- 静的ビルド（`ui/build.mjs`）：`render` 経由で同じ描画関数を使うので変更不要。`npm run build:static` で `ui/pattern-timeline.html` に属性付与が反映される。
- エミュレータのローカル退避（`.emulator-data/overrides-local-<tenant>.json`）：`localUpsert` は sanitize 後の上書きを書くので `split` が残る。読み側はそのまま `getOverrides` 相当で返すので描画に届く。
- Firestore 読み（`engine/src/storage.js:172`）：`doc.data()` をそのまま返すので `split` を落とさない。
- 種データ投入（`scripts/seed-firestore.mjs`）：`engine/data/overrides.json` をそのまま書く。`split` 無し＝旧データ扱いで、既存の畳み表示は変わらない。
- 既存テスト：`ui/two-col-duplicate-collapse.test.mjs` と `ui/editor-together-preview.test.mjs` は `split` 未指定の行を扱うので現行の期待値のまま通る。`ui/toggle-both-no-loss.test.mjs` と `ui/only-gender-render.test.mjs` は items やキーの有無を見ており `split` の追加で落ちない。`functions/override-sanitize.test.mjs` に `split` の白リスト検証を足す。
- 週タブの日セル（weekLevel のグリッド）は、練習メニュー保存でも現行から更新していない。本書でも扱わない（次回読込で揃う、既存挙動）。

## 6. やらないこと

- 目標の楽観適用（サーバ応答前に表示を変えること）。
- goalsSection やヘッダへの編集導線の追加。表示専用ノードは `data-goal-view` で更新するだけ。
- 編集モデルへの `split` 状態の追加、`mergeToBoth`/`splitFromBoth` の変更。
- 種データ `engine/data/overrides.json` の書き換え、既存 Firestore データの移行。
- 週タブの日セルの局所更新、CSS の変更、他機能（反転コピー・オンリーモード・叩き台）の変更。
- 組違いローテーション（自動生成）の描画変更。

## 7. 先行テストとの整合

qa-engineer が並行して書くテストは次の仕様を固定する。実装はこれを満たす。

- `isTogetherRow`：`{both}` は true。`{split:true, 男子, 女子}` は内容が同一でも false。`{男子, 女子}`（split 無し）は同一内容なら true、相違なら false。片側欠けは false。
- 描画（`render` の出力）：`split:true` で同一内容の行は `spine-row spine-rotation tc2-only tc2-split` で描かれ、`tc2-runhead` の見出しが出る。`split` 無しの同一内容行は `tc2-together` の1本のまま。
- `buildOverride`：共通OFFの行は `split:true` を持つ。`both` 行と onlyGender 保存の行は `split` を持たない。
- `sanitizeOverride`：`split:true` を通す。`split:'yes'` や `1` は落とす。`both` 行の `split` は落とす。
- `dayToPrefill` 相当（`renderDay` に prefill を渡す経路）：`split:true` の同一内容行が2セルで描かれる。
- goal-editor（実ブラウザ）：目標保存の成功後に `location.reload` が呼ばれない（`window` に印を置いて残ることで確認）。同じ scope と key の全 `[data-goal-edit]` の `data-goal-text` と `[data-goal-val]` の表示値が新値になる。別の目標ボックスの未保存入力と `section.ed-panel` が残る。空文字保存で表示が「未入力」と `es-inline` に戻る。失敗応答ではボックスが残りエラー文言が出る。

## 8. 実装者が実走で確認する手順

前提：`node --test ui functions`（Playwright を使うテストは `npm run build:static` 後）。

1. `npm run emulate` で起動し、表示された `http://127.0.0.1:8088/?p=timeline` を開く（テナントは `?t=tenant-genchi`、seed 済み）。
2. 不具合3の再現経路：日タブで「週の目標」の編集を開いて文字を入れたまま、「月の目標」の編集を開いて保存する。期待は、月の値が更新されボックスが閉じる、週のボックスは入力を保ったまま残る、ページが再読込されない（DevTools の Network でドキュメント再取得が無い）。
3. 月タブ・年タブ・週タブに切り替え、同じ月キーの表示（monthSection、goalsSection の今月、年アークの男子セルと女子セルの title）が新値になっていることを確認する。
4. 練習メニューの「この日を編集」を開いて途中まで入力し、その状態で月の目標を保存する。入力パネルが残ることを確認する。
5. 月の目標を保存した後に練習メニューを保存し、印刷プレビュー（`Ctrl+P`）の日ヘッダ右側の月目標が新値であることを確認する。
6. 月の目標を空文字で保存し、表示が「未入力」に戻ることを確認する。
7. 不具合4の再現経路：練習メニューの編集で行を追加し、男女共通をONにして項目を入れ、OFFにして保存する。日タブで男子と女子の2セルに分かれて描かれることを確認する。次に「この日を編集」で開き直し、2ボックスのまま prefill されることを確認する。`.emulator-data/overrides-local-tenant-genchi.json` の該当行に `"split": true` があることを確認する。
8. 種データの日（2026-06-23 など `split` 無しの行）が現行どおり描かれることを確認する。
9. 編集パネルの「自動に戻す」を実行し、再読込なしで空状態日（「入力する」「自動で叩き台を入れる」の2ボタン）に変わり、パネルが閉じることを確認する。
10. `npm --prefix functions run build` 後の `functions/dist/index.mjs` に `split` の判定が入っていることを grep で確認する。

## 9. Code Reuse Analysis

- そのまま使う：`isTogetherRow`/`isSameGenderCell` の `.toString()` 注入方式、`goalSaveErrorText`、`withAuth`/`withTenantQ`/401 再送、`renderDay`/`closePanel`/`flash`、`emptyState`/`emptyDayActions` の DOM 構造、`sanitizeOverride` の白リスト方式、`data-goal-edit` 属性群、`.es-inline` クラス。
- 拡張する：`isTogetherRow`（判定順序に `split` を挟む）、`sanitizeOverride`/`toTwoColDay`/`dayToPrefill`/`buildOverride`（`split` の通り道）、`goalsBar`/`goalsSection`/`monthSection`/`yearSection`/`weekLevel`（表示値ノードの属性）、`editorDataIsland`（`goalKeys`）。
- 新規：`ui/goal-editor.mjs` の局所更新関数と `GOAL_SAVED_EVENT`、`ui/editor.mjs` の `goalsPrHtml`/`renderEmptyDay`/イベント listener。firebase-kit 側の変更は無い。
