# spec: 過去の週への移動とコピー元の「おすすめ＋探す」の技術設計（2026-09-05）

> type=spec。対象リポジトリ = basketball-coach-strategy（このリポジトリのルート）。
> 実装者（Codex）向けの変更点の単一真実源。行番号は 2026-09-05 時点の作業ツリー（不具合3・4の対応 `docs/findings/spec-20260905-goal-local-update-and-split-flag.md` が入った状態）。
> サービス設計は `docs/specs/past-weeks-and-copy-source/service-design.md`、行動分析と文言は同 `ux-analysis.md`、承認済みモックは同 `mock-week-nav.html` と `mock-copy-source.html`。

## 0. 結論

週の移動はクライアント側の「窓」で実現し、URL クエリによる再 SSR は採らない。
サーバは今週を先頭とする4週（`weeks`）に加えて過去週の配列（`pastWeeks`）を作り、SSR で全週の `.daywk` グループとタブを描き、クライアントが4枠の窓と `hidden` を動かす。
`weeks[0]`、`anchorWeek`、`goalKeys`、既習レクチャの週送り連鎖はすべて不変で、過去週はこの連鎖を通らない（叩き台を作らない）。

月の目標セルは週ごとに「その週の月曜の暦月をアーク月へ写したキー」を持ち、先頭週のキーは `goalKeys.monthArcKey` と同値になる。今日と別の学校年度に入る週では月セルを描かない。

コピー元は新設の純関数 `copySourceCandidates`（`ui/copy-source.mjs`）が「おすすめ」最大3件と年月ツリーを決定論で返し、`editor.mjs` の `copyFromOptions` がモックのクラス名で描く。
既存の取り込み分岐（`data-act="copy-from"`）は hidden input `#ed-copyfrom` の値を読む形のまま変えない。

サーバ API と Firestore のデータ形は変えない。

## 1. 現行の事実（設計の土台）

- `ui/plan-data.mjs:143-158` `computeWeekPeriods` はアンカー週から +7日ずつ4週を作る。`:955-976` `resolveDisplayAnchor` が表示アンカーを今日を含む週の月曜へ寄せる。`buildPlanData`（`:996`）は `weekDefs` を `:1038-1040` で作り、`:1042-1046` で既習レクチャ `introducedSoFar` を先頭週から週送りで連鎖させ、`:1060` で `anchorWeek = weeks[0]` を `session`・`days`・`seedDays` に展開する。`goalKeys` は `:1123-1126` で `weeks[0].weekStartDate` と `session.month.arcMonth` から作る。
- `:1149-1176` は `weeks[].seedDays` から曜日別テンプレ `templateByWeekday` を作り、テナント全件の上書き（`overrides`、`storage.getOverrides()` の契約でテナント全件）を `toTwoColDay` で表示日形に変換した `allCoachDays` を返す。
- `:791-799` `applyOverridesWithEmpty` は上書きのある日を `toAuthoredDay`、無い日を `toEmptyDay`（`:761-776`、`source:'empty'`）に倒す。`:580-600` `padToFullWeek` は日曜始まり7曜日へ埋める。
- `:878-927` `applyGoalOverridesWithEmpty` は `weeks[]` の `focus` と `session.goals` を週キーで、`months[]`・`year.arc[]`・`session.month` をアーク月キーで上書きする。
- `ui/pattern-timeline.mjs:838-908` `render` は `dayWeeks = data.weeks` の全週について `.daywk-picker[data-week]`（`:856-858`）と `.daywk[data-week]`（`:860-869`、中に `goalsBar` とその週の全日 `dayTimeline`）を描き、先頭週以外は `hidden`。初期可視の `.day` は `wi === 0 && di === 0` の1つ。週レベルは `:897` で `.wkpanel[data-week]` を同様に描く。週タブは `dayWeekSelector`（`:810-817`、`.cal-go-dayweek`、`i === 0` が `on`）と `weekPicker`（`:819-826`、`.cal-go-week`）の2箇所。
- `:736-753` `dayTimeline` の空状態分岐は文言「まだ入力がありません。この日の練習を入力してください。」と `emptyDayActions()`（`ui/render-shared.mjs:142-145`、`data-empty-act="blank"` と `"seed"` の2ボタン）を出す。
- `ui/render-shared.mjs:272-292` `goalsBar(data, week)` は月セルを `keys.monthArcKey` と `g.monthMain`（アンカー値固定）で、週セルを引数 `week` の `{text, key}` で描く。呼び出しは `ui/pattern-timeline.mjs:866` の1箇所。
- `ui/render-shared.mjs:462-600` `clientScript`: `selectWeek`（`:488-497`）が日レベルと週レベルの選択状態を1箇所で揃え、`showDayByDate`（`:499-509`）が単一可視日を保ち、`defaultDateOfWeek`（`:531-537`）は今日がその週内なら今日、無ければその週の先頭の `.day`、`goToWeek`（`:541-544`）が週切替の単一入口。初期表示は `:569-580` で今日に最も近い練習日へ寄せる。
- `ui/styles/pattern-timeline.css:283` `.picker`、`:286` `.pk` は `display:flex`。`.pk[hidden]` の規則は無いので、`hidden` 属性だけではタブを隠せない。
- `ui/editor.mjs:152-211` `editorDataIsland` は `allCoachDays` から `prefill`（実日付キー）、`weeks[].seedDays` から `seedPrefill` を作る。`:506-528` `copyFromOptions` は `PREFILL` の全日付を1つの `<select id="ed-copyfrom">` に並べ、`:802-811` の `copy-from` 分岐が `#ed-copyfrom` の値で `PREFILL[srcDate]` を取り込む。`:427-435` `renderEmptyDay` は「自動生成に戻す」後に2導線の空状態を描く。`:866` `onPanelChange` はパネル内の `change` を委譲で受ける。`:696` `renderPanel` はパネルを丸ごと差し替える。
- `ui/goal-editor.mjs:184` は `document.querySelectorAll('[data-goal-edit]')` の全要素に編集導線を付け、保存成功時（`:148-170`）は同じ scope と key の全ノードを局所更新する。過去週の月セルに新しい JS は要らない。
- `functions/index.mjs:634` と `ui/build.mjs:64` はどちらも `buildPlanData` を `today` 省略（サーバ時計）で呼ぶ。リクエストのクエリを `buildPlanData` へ渡す経路は無い。
- ローカル種データ `engine/data/overrides.json` の上書きは 2026-06-23 から 06-25 の3件で、`LOCAL_FIXTURE_TODAY = '2026-06-22'`（`ui/build.mjs:32`）では最古の上書き週が今週に一致する。

## 2. 週の表示アンカーの持ち方

### 2.1 判断

クライアント側の窓を採る。
URL クエリ `?week=` で `displayAnchor` を差し替えて再 SSR する案は採らない。理由は3つで、いずれも先頭固定の前提（`weeks[0]` が今週、既習連鎖が `config.introduced` から前進する）に反する。
第一に、過去週をアンカーにすると `weeks[0]` が過去週になり `goalKeys`・`session`・`seedDays` の意味が変わる。
第二に、「今週へ戻る」や「前の週」のたびにページ遷移が起き、不具合3で廃止した再読込と同じ理由で編集パネルと目標ボックスの未保存入力が消える。
第三に、静的ビルド（`ui/build.mjs`）はクエリを持てず、`node --test` の SSR テストが過去週へ届かない。

窓方式では SSR の HTML が上書き日数に比例して増える。到達下限（3章）が「最古の上書き週」か「4週前」なので、上限は運用年数で決まる。空状態日の記事は数行で、上書き日だけがタイムライン本体を持つ。実装者は実走確認（10章）で本番相当データの HTML サイズを1回測り、findings に残す。遅延読込はこの設計に含めない。

### 2.2 データ構造（`buildPlanData` の戻り値に足すもの）

| フィールド | 型 | 意味 |
|---|---|---|
| `pastWeeks` | `Array<week>` 古い順 | 到達下限の週から今週の前週まで。各要素は `weeks[]` と同じ形（`key`、`label`、`weekStartDate`、`focus`、`days`、`seedDays: []`、`goals: null`、`month: null`、`warnings: []`）に `past: true` を足す |
| `weeks[i].monthArcKey` | `number\|null` | その週の月セルのアーク月キー。年度外は `null`。`pastWeeks[]` にも同じく持つ |
| `weeks[i].monthGoal` | `string` | そのキーの月目標テキスト（上書きが無ければ `''`）。`pastWeeks[]` にも持つ |
| `jumpMonths` | `Array<{ym:string,label:string,weekKey:string}>` 新しい順 | 「年月で飛ぶ」の選択肢。`ym` は `YYYY-MM`、`label` は「2025年11月」、`weekKey` はその月の第1週（月曜の暦月がその月になる最初の週）の `key` |

`weeks`、`days`、`seedDays`、`session`、`goalKeys`、`months`、`year` の値と意味は変えない。

### 2.3 DOM の並びと窓

`render` は `.daywk-picker`、`.daywk`、`.wkpanel` を `[...weeks, ...pastWeeks]` の順で描く（`weeks` を先に置く）。
これらは `hidden` で切り替える要素なので DOM 順は表示に効かず、先頭グループが今週のままなので既存テストの `groups[0]`（`ui/week-start-sunday.test.mjs:96` など）の前提が保たれ、JS 無効時の初期可視も今週先頭日のままになる。
タブ列（`weekNav`、4章）だけは古い順（`[...pastWeeks, ...weeks]`）に描く。タブの DOM 順がそのまま時系列であり、クライアントはこの順を週の順序配列 `ORDER` として読む（順序の単一真実源は SSR のタブ列）。

窓の状態はクライアントの変数 `winStart`（`ORDER` 上の先頭インデックス）1つで持つ。`WIN = 4`。初期値は今週のインデックス `TODAY_IDX`（`.wknav` の `data-today-week` から引く）。

| 操作 | `winStart` | 選択週 |
|---|---|---|
| タブ押下 | 不変 | 押したタブ |
| 前の週 | `-1`（`0` なら押せない） | 窓の先頭 |
| 次の週 | `+1`（`winStart + WIN >= ORDER.length` なら押せない） | 窓の先頭 |
| 年月で飛ぶ | `min(idx, ORDER.length - WIN)`（`idx` は選んだ月の第1週） | 第1週 |
| 今週へ戻る | `TODAY_IDX` | 今週（既定日は `goToWeek` の規則で今日） |

「今週へ戻る」は選択週のキーが今週のキーと違うときに出す（未来週でも出す。司令塔裁定）。`applyWindow()` が両ナビのタブ `hidden`、`prev`/`next` の `disabled`、`.wk-today[data-shown]`、`.wk-jump-sel` の値を1回で揃える。`selectWeek` の末尾で `applyWindow()` を呼ぶことで、日レベルと週レベルのどちらから動かしても両ナビが揃う（既存の単一持ち場をそのまま使う）。

`selectWeek` に渡された週が窓の外にあるとき（週レベルグリッドの `data-jumpdate` 経由など）は、その週が窓に入るよう `winStart` を寄せてから描く。この安全網が無いと「選択中なのにタブが見えない」状態が作れる。

未来の上限は今週+3週のままなので、初期状態（`winStart === TODAY_IDX`）で「次の週」は押せない。これはモックの状態6と一致する。

週起点未設定テナント（`weeks` が1件で `weekStartDate: null`）は `pastWeeks` を空にし、`weekNav` を描かない（現行の「単一週ならピッカー非表示」と同じ判定を `pastWeeks.length + weeks.length <= 1` にする）。

## 3. 過去週の生成と叩き台の抑止

### 3.1 到達下限と週の定義

`ui/plan-data.mjs` に純関数 `computePastWeekDefs(todayMonday, oldestCoachDateISO)` を export で足す。

- 下限の月曜 = `min(mondayOfISO(oldestCoachDateISO), addDaysISO(todayMonday, -28))`。`oldestCoachDateISO` が `null`（上書きゼロ）なら後者。
- 下限から `todayMonday - 7` まで +7日ずつ並べ、`key`・`label` は `computeWeekPeriods` と同じ規則（表示開始は日曜、`label` は「yyyy/mm/dd〜」）で作る。`currentMonth`・`weekOfMonth` は持たない（叩き台を作らないため不要）。
- `oldestCoachDateISO` は `buildPlanData` 内で `overrides` から `source === 'coach'` かつ `typeof date === 'string'` の最小値を取る。`/^\d{4}-\d{2}-\d{2}$/` に合わない `date` があれば `Error` を投げる（黙って除外しない。エラーハンドリング方針「壊れたら即座にわかる」）。

### 3.2 過去週の日の組み立て

`buildPlanData` の処理順を「`weeks` 生成 → `templateByWeekday` 作成 → `pastWeeks` 生成 → `allCoachDays`」にする（現行は `allCoachDays` の直前で `templateByWeekday` を作っている。`:1149-1154` を前へ動かすだけで、内容は変えない）。

過去週1週の `days` は `buildOneWeek` を通さず、次の手順で作る。

1. `FULL_WEEK_DAYS` の各曜日について `templateByWeekday[w]` を土台に `{...template, date: dayDateISO(weekStartDate, w), dateLabel}` を作る（テンプレの無い曜日は `padToFullWeek` の空曜日と同じ最小土台）。`blocks`、`parts`、`rotation` は土台のものが残るが、次の手順で全日が `toAuthoredDay` か `toEmptyDay` に置き換わるので表示に出ない。
2. `applyOverridesWithEmpty(days, overrides, weekStartDate)` を当てる。上書きのある日は現行と同じ `toAuthoredDay`、無い日は `toEmptyDay`。
3. `source === 'empty'` の日に `noRecord: true` を付ける。これが「記録なし」の描画分岐キー。

`seedDays` は空配列にする。`editorDataIsland` の `seedPrefill` は `weeks[].seedDays` だけから作るので、過去週の日付は `SEEDPREFILL` に入らず、編集パネルの「自動の叩き台」欄（`seedLoadOptions`、`:529-536`）は過去週で自然に出ない。既習連鎖 `introducedSoFar`（`:1042-1046`）は `weeks` だけを回すので不変。

`allCoachDays` の `coachDayByDate` は `weeks` と `pastWeeks` の両方の coach 日から作る。過去週の coach 日は `applyOverridesWithEmpty` で作られた表示日そのものになり、`prefill` と画面が一致する（現行の「表示中の週の日は表示と完全一致」の原則を過去週にも延ばす）。

### 3.3 「記録なし」の描画

`ui/render-shared.mjs` に `noRecordDayActions()` を足す。中身は `data-empty-act="blank"` の `.btn` 1つ、文言「この日の記録を入力する」、`data-print-hide`。

`ui/pattern-timeline.mjs` `dayTimeline` の空状態分岐（`:745-753`）で `pd.noRecord` なら文言を「この日の記録はありません。」、導線を `noRecordDayActions()` にする。`pd.date` が無い日は現行どおり導線なし。それ以外（今週と未来週）は現行のまま。クリックは `ui/editor.mjs:1447-1451` の `document` 委譲で拾うので新しい配線は不要。

`.daywk` に `data-past=""` 属性を付ける（`pastWeeks` のグループだけ）。`ui/editor.mjs` `renderEmptyDay`（`:427-435`、「自動生成に戻す」後の空状態）は `article.closest('.daywk[data-past]')` が真なら「記録なし」文言と1導線で描き、偽なら現行の2導線で描く。過去週で「自動生成に戻す」を押した後に叩き台の導線が現れない。

## 4. 週ナビの SSR と CSS

`ui/pattern-timeline.mjs` に `weekNav({ allWeeks, todayKey, jumpMonths, tabClass, tabAttr, idSuffix })` を新設し、`dayWeekSelector` と `weekPicker` の中身をこれに置き換える。DOM はモック `mock-week-nav.html:109-124` と同じ構造にする。

```
<div class="wknav" data-print-hide data-today-week="{今週のkey}">
  <div class="wk-jump">
    <label class="wk-jump-lab" for="wk-jump-{suffix}">年月で飛ぶ</label>
    <select class="ed-sel wk-jump-sel" id="wk-jump-{suffix}" aria-label="年月で飛ぶ">
      <option value="{ym}" data-week="{weekKey}">2026年9月</option> …新しい順
    </select>
    <button class="wk-today" type="button" data-shown="false">今週へ戻る</button>
  </div>
  <div class="wk-row">
    <button class="wk-step wk-prev" type="button" aria-label="前の週"><svg …/>前の週</button>
    <div class="picker">
      <button class="pk cal-go-dayweek" data-dayweek="{key}" type="button" hidden>2026/08/23〜</button> …古い順、窓内は hidden 無し、今週は on
    </button></div>
    <button class="wk-step wk-next" type="button" aria-label="次の週" disabled>次の週<svg …/></button>
  </div>
</div>
```

- 日レベルは `tabClass='cal-go-dayweek'`、`tabAttr='data-dayweek'`、`idSuffix='day'`。週レベルは `cal-go-week`、`data-go`、`week`。既存のボタンクラスと属性名を変えないので、`clientScript` の `dws`/`wts` 収集と `selectWeek` の `on` 切替はそのまま効く。
- SSR 時点の初期窓は今週から4週で、`prev` は `pastWeeks.length === 0` のとき、`next` は常に `disabled`（2.3節）。`data-shown="false"`。
- SVG のパスはモックの `M15 6l-6 6 6 6` と `M9 6l6 6-6 6` をそのまま使う。
- `ui/styles/pattern-timeline.css` にモック `mock-week-nav.html:43-85` の `.wknav` から `.goalbar--week-only` までの規則を移す（トークン名 `--on-label-accent`、`--action-move-fill`、`--action-move-fill-hover`、`--on-action-move`、`--on-action-move-hover`、`--on-action-disabled`、`--focus-ring` は `ui/styles/tokens.css` に実在することを確認済み）。`.wk-jump-sel[size]` の2行はモックの展示用なので移さない。加えて `.pk[hidden]{display:none}` を足す（1.章の事実）。
- `.ed-sel` は `ui/styles/editor.css` の部品で、`EDITOR_CSS` は `render` の `css` に連結済み（`:872`）なので日レベル・週レベルの両方で効く。

`clientScript`（`ui/render-shared.mjs`）に足す関数は `applyWindow`、`stepWeek(delta)`、`jumpToMonth(select)`、`goToday` の4つ。`ORDER` は `.wknav` のうち最初のもののタブ列から `tabAttr` の値を DOM 順に集めて作る。両ナビの部品は `document.querySelectorAll('.wknav')` で全部に同じ状態を書く。

## 5. 週ごとの月目標キー

### 5.1 キーの算出

`ui/plan-data.mjs` に純関数を2つ export で足す。

- `schoolYearOf(iso)`: 月が4以上ならその年、3以下なら前年。学校年度は4月1日から翌3月31日。
- `arcMonthOfWeek(weekStartDate, displayCalendarMonth, displayArcMonth, todayIso)`: `schoolYearOf(weekStartDate) !== schoolYearOf(todayIso)` なら `null`。それ以外は `wrapMonth(month(weekStartDate) + (displayArcMonth - displayCalendarMonth))`。

暦月とアーク月の差を定数オフセットで写す規則は `computeMonthPeriods`（`:167-183`）が月タブに使っているものと同じで、月タブでその暦月を見たときのアーク月キーと一致する。先頭週は `month(weeks[0].weekStartDate) === displayCalendarMonth`（`:1067-1069` の定義から）なので、結果は `displayAnchor.currentMonth = session.month.arcMonth = goalKeys.monthArcKey` に一致する。テストで固定する。

`resolveDisplayAnchor` の「4週=1アーク月」の歩幅で遡る方式は採らない。5週ある暦月でキーが暦月からずれ、コーチが「8月の目標」のつもりで書いたものが7月のキーに乗る。

未来週（`weeks[1..3]`）にも同じ規則を当てる。現行は `computeWeekPeriods` が `currentMonth` を固定するので、月をまたぐ未来週（例: 9/28 の週）の月セルは現行「9月」、この設計では「10月」のキーになる。規則を1つにするための挙動変更で、11章の判断要求に挙げる。

### 5.2 テキストの合流

`applyGoalOverridesWithEmpty` の `parts` に `pastWeeks` を足し、週ループを `[...weeks, ...pastWeeks]` で回す。各週について `w.monthArcKey != null` なら `w.monthGoal = authored(arcMap[String(w.monthArcKey)]) ? text : ''`、`null` なら `''`。`session.goals` は `weeks[0]` を見る現行のまま。`w.goals` が `null` の過去週は既存の `if (w.goals)` ガードで通る。

### 5.3 goalsBar

`ui/render-shared.mjs` `goalsBar(data, week)` の `week` を `{text, key, month}` にする。`month` は `{key, text}` か `null`。

- `week` 省略時は現行どおりアンカー値（後方互換。呼び出しは `ui/pattern-timeline.mjs:866` の1箇所で、そこは新形で渡す）。
- `month` が `null` なら月セルを描かず、`<div class="goalbar goalbar--week-only">` で週セルだけを全幅にする（モック状態9）。
- `month` があれば月セルの `data-goal-key` を `month.key`、`data-goal-text` と表示値を `month.text` にする。

`render` の呼び出しは `goalsBar(data, { text: w.focus || '', key: w.weekStartDate || '', month: w.monthArcKey == null ? null : { key: w.monthArcKey, text: w.monthGoal } })`。

`ui/goal-editor.mjs` の局所更新は同じ scope と key の全ノードを更新するので、同じ月キーを持つ複数週のセルが一斉に揃う。`ui/editor.mjs` の `bcs:goal-saved` listener は `goalKeys.monthArcKey` と一致するときだけ印刷ヘッダの `GOALS` を更新する現行のままでよい（印刷ヘッダはアンカー月の値、9章）。

## 6. 到達下限のデータの取り方

到達下限に必要な「最古の上書き日」は `buildPlanData` が既に持つ `overrides`（テナント全件）から取る（3.1節）。新しい読み取り、API、Firestore クエリは無い。SSR へは `pastWeeks` と `jumpMonths` として渡り、クライアントは `.wknav` のタブ列と `<option data-week>` から読む。クライアントに別途 JSON を渡さない。

`jumpMonths` は `buildPlanData` が `[...pastWeeks, ...weeks]` の `weekStartDate` から作る純関数 `computeJumpMonths(allWeeks)` の結果。各週の月曜の `YYYY-MM` をユニークにし、各月の第1週（その月に属する最初の週）の `key` を持たせ、新しい順に並べる。範囲外の月は含まれない（モック状態7）。

## 7. コピー元候補

### 7.1 純関数 `ui/copy-source.mjs`（新規）

```js
/**
 * @param {string[]} dates 候補日のISO（編集中の日を除いたもの）
 * @param {string} baseDate 基準日＝編集中の日のISO
 * @returns {{recommended:Array<{date:string,relation:string}>,
 *            months:Array<{ym:string,label:string,dates:string[]}>,
 *            searchable:boolean, initialYm:string|null}}
 */
export function copySourceCandidates(dates, baseDate)
```

- 外部 import を持たない自己完結の関数にする。`ui/editor.mjs` が `isTogetherRow` と同じ `.toString()` 注入（`:215-216`）でクライアントへ埋め込む。日付演算は `Date.UTC` で、曜日名は関数内の配列 `['日','月','火','水','木','金','土']`。
- `recommended` は次の順で最大3件。重なる日は先の項目に寄せ、後の項目は空ける（代替を探さない）。
  1. `直近の{曜}曜`: `baseDate` より前で同じ曜日の最も新しい日。
  2. `前回の練習日`: `baseDate` より前の最も新しい日。
  3. `去年の同じ頃`: `baseDate` の364日前を中心に前後21日の範囲で、同じ曜日があればその中で最も近い日、無ければ範囲内で最も近い日。
- `months` は全候補（`baseDate` より後の日も含む）を `YYYY-MM` で束ね、新しい順。各月の `dates` は昇順。`label` は「2026年9月」。
- `searchable` は `recommended` に載らない日が1件でもあれば真。
- `initialYm` は `baseDate` の月に候補があればその月、無ければ最も新しい月、候補ゼロなら `null`。
- `dates` が空なら `{recommended:[], months:[], searchable:false, initialYm:null}`。

### 7.2 `ui/editor.mjs` の描画と配線

`copyFromOptions()`（`:506-528`）を書き換える。候補ゼロの2分岐（案内文、沈黙）は現行のまま。候補があれば `copySourceCandidates(dates, model.date)` の結果で次を描く（クラス名はモック `mock-copy-source.html` の状態3）。

```
<div class="ed-field"><span class="ed-lab">他の日からコピー</span>
  <input type="hidden" id="ed-copyfrom" value="">
  <fieldset class="cf-group"><legend class="cf-legend">おすすめ</legend>
    <div class="cf-list">
      <label class="cf-pick"><input class="cf-radio" type="radio" name="cf-pick" value="{date}">
        <span class="cf-head"><span class="cf-rel">{relation}</span><span class="cf-date">{YYYY/MM/DD（曜）}</span></span>
        <span class="cf-title">{title || aim}</span></label> …最大3
    </div></fieldset>
  <div class="cf-group">（searchable のときだけ）<span class="cf-legend">探す</span>
    <div class="cf-search-row">
      <select class="ed-sel cf-ym" aria-label="年月"><option value="{ym}">2026年9月</option>…</select>
      <select class="ed-sel cf-day" aria-label="日"><option value="">日を選んでください…</option><option value="{date}">18日（火）：タイトル</option>…</select>
    </div></div>
  <div class="ed-copyfrom"><button type="button" class="ed-mini" data-act="copy-from">この日を取り込む</button></div>
</div>
```

- 日付ラベルは既存の `dateLabelISO(k, PREFILL[k].weekday)`、タイトルは `PREFILL[k].title || PREFILL[k].aim || ''`（既存のラベル規則）。`cf-title` が空なら要素を出さない。
- 「探す」の日のラベルは `D日（曜）：タイトル`（タイトルが無ければ `D日（曜）`）。
- 選択の単一持ち場は `#ed-copyfrom`（hidden）。`onPanelChange`（`:866`）に3分岐を足す。`cf-radio` の変更で hidden にその日付を書き、`cf-day` を空に戻す。`cf-day` の変更で hidden にその日付を書き、`cf-radio` を全部外す。`cf-ym` の変更で `cf-day` の option をその月の日に差し替え、hidden を空にする。年月ごとの日リストは `copySourceCandidates` の `months` を `renderPanel` 時に変数へ保持して引く（再計算しない）。
- `copy-from` 分岐（`:802-811`）は `#ed-copyfrom` の値を読む現行のままで、`select` が `input[type=hidden]` に変わっても `.value` の読み方は同じ。確認の文言だけ「いまの内容を、{YYYY/MM/DD（曜）}の内容で置き換えます。よろしいですか？」に変える（`window.confirm` のまま。カード化は範囲外）。
- `ui/styles/editor.css` にモック `mock-copy-source.html:45-69` の `.cf-*` 規則を移す（`--surface-ground`、`--on-surface-muted`、`--focus-ring` は `tokens.css` に実在）。既存の `.ed-copyfrom` は取り込みボタンの器として残す。

## 8. 変更ファイル一覧

| ファイル | 関数と行 | 変更点 |
|---|---|---|
| `ui/plan-data.mjs` | `computePastWeekDefs`（新規）、`schoolYearOf`・`arcMonthOfWeek`・`computeJumpMonths`（新規、export）、`applyGoalOverridesWithEmpty` `:878-927`、`buildPlanData` `:1027-1176` | 3.1・3.2・5.1・5.2・6章。`templateByWeekday` の作成を `pastWeeks` 生成の前へ移す。戻り値に `pastWeeks`・`jumpMonths`、各週に `monthArcKey`・`monthGoal` |
| `ui/pattern-timeline.mjs` | `weekNav`（新規）、`dayWeekSelector` `:810-817`、`weekPicker` `:819-826`、`dayTimeline` `:736-753`、`render` `:838-908` | 4章・3.3章・2.3章。`dayWeeks = [...weeks, ...pastWeeks]`、`.daywk` に `data-past`、`goalsBar` へ `month` を渡す |
| `ui/render-shared.mjs` | `noRecordDayActions`（新規）、`goalsBar` `:272-292`、`clientScript` `:462-600` | 3.3・5.3・2.3章。`applyWindow`・`stepWeek`・`jumpToMonth`・`goToday` と `selectWeek` 末尾の `applyWindow()` |
| `ui/styles/pattern-timeline.css` | `.picker` 付近 `:283-296` | `.pk[hidden]`、`.wknav` 系、`.goalbar--week-only` |
| `ui/copy-source.mjs` | 新規 | 7.1章 |
| `ui/editor.mjs` | `editorScript` 冒頭 `:213-216`（注入）、`renderEmptyDay` `:427-435`、`copyFromOptions` `:506-528`、`onPanelClick` の `copy-from` `:802-811`（文言）、`onPanelChange` `:866` | 7.2章・3.3章 |
| `ui/styles/editor.css` | 末尾 | `.cf-*` |
| `ui/multiweek-day.test.mjs` | `:94`・`:201`・`:223` | `.daywk` 数の期待を `data.pastWeeks.length + data.weeks.length` に直す（`data.weeks.length` の検証意図は「各週に独立した日グループ」で、過去週を足しても同じ意図） |
| `functions/dist/index.mjs` | 生成物 | `npm --prefix functions run build` で再生成。手で編集しない |

データと API の変更: 無し。`functions/index.mjs`、`engine/`、Firestore のスキーマ、`overrides/{date}`、`goalOverrides/current` はそのまま。

## 9. 影響範囲とやらないこと

影響範囲:

- SSR の HTML が過去週ぶん増える。上書き日だけがタイムライン本体を持ち、空状態日は数行。到達下限で上限がつく。
- `ui/build.mjs` の静的ビルドは同じ `buildPlanData` を通るので `ui/pattern-timeline.html` にも過去週が入る（ローカル種データでは4週）。
- 印刷: `.daywk[hidden]` は現行どおり印刷でも隠れる。表示中の週の日だけが刷られる。
- 既存テストで「先頭タブが `on`」や「`.daywk` 数 = `data.weeks.length`」を前提にするものは、`data.weeks[0].key` を `data-week`・`data-dayweek` で引く形に直す。`ui/multiweek-day.test.mjs` の3箇所は8章に挙げた。他に落ちるものがあれば同じ方針で直し、期待値の意図（先頭固定・単一可視日・週数）は変えない。
- `ui/only-gender-render.test.mjs` などの `allCoachDays` 経由テストは、`coachDayByDate` の対象が広がるだけで種データの範囲では結果が同じ。

やらないこと:

- URL やストレージに窓や選択週を持たせること（中断後の復帰は今日に最も近い練習日のまま）。
- 過去週の遅延読込。
- 過去週の既定日を「記録のある最初の日」にすること。`defaultDateOfWeek` は現行どおり今日か先頭の `.day`。
- 印刷用日ヘッダ `.dh-goals` の月目標を週ごとにすること（現行どおりアンカー月の値）。
- 月タブ・年タブへの過去月の追加。
- 上書き確認の `window.confirm` を確認カードにすること（文言だけ変える）。
- コピー元のプレビュー、全文検索、曜日の絞り込み。
- 種データ、既存 Firestore データの移行。

失敗時の挙動:

- `overrides` に ISO 形式でない `date` があれば `buildPlanData` が `Error` を投げ、`functions/index.mjs:661` の `render error` として 500 になる（現行の失敗経路と同じ）。黙って除外しない。
- クライアントで年月ジャンプの `data-week` が `ORDER` に無いときは `throw new Error(...)`（SSR とクライアントの不整合はバグなので隠さない）。
- 過去週の日の保存・削除の失敗は現行の `flash` 文言のまま。
- 過去週の月目標の保存失敗は現行の `goal-editor` の脚の文言のまま。

## 10. 実装者が実走で確認する手順

前提: `node --test ui functions` が緑、`npm run build:static` 後に Playwright を使うテストが緑。

1. `npm run emulate` で起動し、`http://127.0.0.1:8088/?p=timeline&t=tenant-genchi` を開く。DevTools の Network でドキュメントサイズを控え、上書き日数とともに findings に書く。
2. 日タブで「前の週」を1回押す。先頭タブが1週前になり `on`、曜日帯の日付が前週、「今週へ戻る」が現れ、年月の選択がその月になる。週タブへ切り替えて同じタブ列と選択になっている。
3. 「前の週」を到達下限まで連打し、押せなくなる。年月の選択肢がその月まで。
4. 初期状態で「次の週」が押せない。「前の週」を押した後は押せる。
5. 「年月で飛ぶ」で最古の月を選ぶ。窓の先頭がその月の第1週、選択もその週。
6. 「今週へ戻る」で今日に最も近い練習日が見え、ボタンが消える（枠は残り、他の要素が動かない）。
7. 過去週の上書きの無い日に「この日の記録はありません。」と「この日の記録を入力する」の1導線が出る。押して入力し保存すると、再読込なしで同じ日が描き替わる。「自動生成に戻す」を実行すると1導線の空状態に戻る。
8. 過去週（今日と同じ年度）の月の目標を編集して保存する。`POST /api/tenant/goal` の `key` がその週の月のアーク月であること、同じキーを持つ他の週のセルも更新されること、今週の月セルの値が変わらないこと（別キーの場合）を確認する。
9. 前年度の週（`?t` のテナントに前年度の上書きが無ければ、`.emulator-data` に前年度の日付の上書きを1件足す）へ飛び、目標バーが週セルだけで、月セルが無いことを確認する。
10. 編集パネルの「他の日からコピー」: おすすめの行を押して「この日を取り込む」で内容が入る。「探す」で年月を変えると日の選択肢が入れ替わり、日を選ぶとおすすめの印が消え、その後おすすめを押すと日が「日を選んでください…」に戻る。中身がある状態で取り込むと新しい文言の確認が出る。
11. 320・375・414・768px で横スクロールが出ない。414px未満で一歩移動が列の上段、414px以上で列の左右端。
12. `npm --prefix functions run build` 後の `functions/dist/index.mjs` に `computePastWeekDefs` と `copySourceCandidates` が入っていることを grep で確認する。

## 11. qa-engineer が先行テストで固定する仕様

純関数（`node --test`）:

- `computePastWeekDefs`: 上書き無しで4週。最古が10週前なら10週。最古が今週内なら4週。最古がちょうど4週前の週なら4週。末尾の `weekStartDate` が今週の月曜の7日前。`key`・`label` の形式が `computeWeekPeriods` と同じ（日曜始まりの表示日）。
- `schoolYearOf`: `2026-03-30` は 2025 年度、`2026-04-06` は 2026 年度、`2026-04-01` は 2026 年度、`2026-03-31` は 2025 年度。
- `arcMonthOfWeek`: 先頭週の結果が `goalKeys.monthArcKey` と一致する（`buildPlanData` の実データで）。年度外の週は `null`。月をまたぐ未来週はその月曜の暦月のアーク月。
- `computeJumpMonths`: 新しい順、各月の `weekKey` がその月の第1週、範囲外の月を含まない。
- `buildPlanData`（`localStorages`、`today: LOCAL_FIXTURE_TODAY`）: `data.weeks` の `key` 配列が現行と同一。`pastWeeks.length === 4`。各過去週の `days` が7日で全日 `date` を持つ。上書きの無い日が `source:'empty'` かつ `noRecord:true`。`seedDays` が空。`pastWeeks` の coach 日が `allCoachDays` の同日と同一参照。`goalKeys` が現行と同一。
- `copySourceCandidates`: 直近の同曜日が1件目で関係語が「直近の火曜」のように実曜日。前回の練習日が2件目。去年の同じ頃が 364 日前を中心に前後21日で同曜日優先、範囲外なら無し。直近の同曜日と前回の練習日が同じ日なら2件。基準日より後の日は `recommended` に入らず `months` に入る。`months` が新しい順で各月の `dates` が昇順。`searchable` の真偽。`initialYm` の3分岐。空入力。

SSR（`render` の出力）:

- `.wknav` が日レベルと週レベルに1つずつあり、`.wk-prev`・`.wk-next[disabled]`・`.wk-today[data-shown="false"]`・`.wk-jump-sel` を持つ。`option` の数と順が `jumpMonths` と同じで各 `option` が `data-week` を持つ。
- 日レベルのタブ総数が `pastWeeks.length + weeks.length`、`hidden` でないタブが `weeks` の4件、`on` が `weeks[0].key`。週レベルも同じ。
- `.daywk` の数が合計と同じ、`pastWeeks` のグループが `hidden` かつ `data-past`、初期可視の `.day` が1つで `weeks[0]` の先頭日。
- 過去週の空日が「この日の記録はありません。」と `data-empty-act="blank"` 1個で `"seed"` 無し。`weeks` の空日は現行の2導線のまま。
- 各 `.daywk` の月セルの `data-goal-key` がその週の `monthArcKey`、先頭週は `goalKeys.monthArcKey`。年度外の週（`today` を `2026-04-13` にして3月の過去週を作る）は `.goalbar--week-only` で月セルが無い。
- 週起点未設定の fixture では `.wknav` が無い。
- `clientScript()` の文字列に `applyWindow`・`stepWeek`・`jumpToMonth`・`goToday` と `.wk-prev`・`.wk-next`・`.wk-today`・`.wk-jump-sel` の配線が含まれる（既存の配線テストと同じ様式）。
- `editorScript()` の文字列に `copySourceCandidates` の定義が注入されている。

Playwright 通し（`npm run build:static` の `ui/pattern-timeline.html`、保存を伴う項目はエミュレータ）:

- 10章の 2〜7、10、11 を自動化する。証跡 JSON は `ui/e2e/evidence/` に置く。
- 過去週の月目標保存が `location.reload` を呼ばないこと（`ui/goal-editor-no-reload.test.mjs` の印の方式）。

## 12. Codex への分割（1回1変更）

| 回 | 変更 | 完了条件 |
|---|---|---|
| 1 | `ui/plan-data.mjs` のみ（3.1・3.2・5.1・5.2・6章）と純関数テスト | 既存テスト全緑、`data.weeks`・`goalKeys` が不変、`pastWeeks`・`jumpMonths`・`monthArcKey`・`monthGoal` が11章の純関数テストを満たす |
| 2 | `ui/pattern-timeline.mjs`・`ui/render-shared.mjs`・`ui/styles/pattern-timeline.css`・`ui/editor.mjs` の `renderEmptyDay`・`ui/multiweek-day.test.mjs` の期待値（2.3・3.3・4・5.3章） | 11章の SSR テストと Playwright の週ナビ項目が緑、`functions/dist` 再生成 |
| 3 | `ui/copy-source.mjs` 新規と純関数テスト | 11章の `copySourceCandidates` テストが緑 |
| 4 | `ui/editor.mjs` の `copyFromOptions`・`onPanelChange`・確認文言・注入、`ui/styles/editor.css`（7章） | Playwright のコピー元項目が緑、`functions/dist` 再生成 |

1回目と3回目は互いに独立で、順序を入れ替えてよい。2回目は1回目の後、4回目は3回目の後。

## 13. Code Reuse Analysis

- そのまま使う: `computeWeekPeriods` のキー・ラベル規則、`mondayOfISO`・`addDaysISO`・`dayDateISO`・`dateLabelYMD`、`applyOverridesWithEmpty`・`toAuthoredDay`・`toEmptyDay`・`padToFullWeek` の土台、`templateByWeekday`、`wrapMonth`、`selectWeek`・`goToWeek`・`defaultDateOfWeek`・`showDayByDate`、`emptyState`、`.ed-sel`・`.pk`・`.picker`・`.btn`・`.ed-mini` の意匠、`goal-editor` の `[data-goal-edit]` 一括 attach と局所更新、`isTogetherRow` の `.toString()` 注入方式、`dateLabelISO`、`data-empty-act` の `document` 委譲、`onPanelChange` の委譲。
- 拡張する: `buildPlanData`（`pastWeeks`・`jumpMonths`・週ごとの月キー）、`applyGoalOverridesWithEmpty`（`pastWeeks` と `monthGoal`）、`goalsBar`（`month` 引数）、`dayTimeline`（`noRecord` 分岐）、`dayWeekSelector`・`weekPicker`（`weekNav` へ）、`clientScript`（窓制御）、`renderEmptyDay`（`data-past` 分岐）、`copyFromOptions`・`onPanelChange`。
- 新規: `computePastWeekDefs`・`schoolYearOf`・`arcMonthOfWeek`・`computeJumpMonths`、`weekNav`、`noRecordDayActions`、`ui/copy-source.mjs`。firebase-kit 側の変更は無い。
