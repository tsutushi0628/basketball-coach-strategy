# spec: 反転コピー（1反転単位）と男女オンリーモードの技術設計（2026-07-01）

> type=spec。対象リポジトリ = basketball-coach-strategy（バスケ練習計画Webツール）。
>
> 起点となる出荷済みの土台は `docs/findings/handoff-20260630-editor-blank-default-and-drill-master.md`
> （既定空白化＋オプトイン叩き台／男女共通トグルの無損失集約・復元／週起点日なしテナントの曜日
> フォールバック／単一可視日制御／多週ナビ）。本書はその上に2機能を積む。
>
> 中核UI概念は、コードを書く前に「1例の具体表（行＝時刻・左右＝男女）」でオーナー合意を取ってから
> 実装する（`handoff-20260609-kumichigai-2col-redo.md` 教訓1・組違い像を3回外した事故の再発防止）。
> 第7章の1例表がその合意素材である。
>
> **改訂（2026-07-01）**: 反転コピーの章（第2.1章・第6.1章・第7.1章）は初稿時点で「ソース列の2スロットを
> 時間入替でもう片方の列に埋める」方式として書いたが、これは誤りだった。確定挙動は
> **「前半ブロック1個（男子セル＋女子セル）を複製し、男女の中身を入れ替えた後半ブロックを直後の
> 時間帯へ1個だけ追加する（前半ブロックは不変・純粋な追加操作）」**。該当3章は確定挙動へ書き換え済み。
> 実装は `ui/editor.mjs` の `flipCopyRow`（反転コピー）・`setOnlyGender`（オンリーモード）。

---

## 用語（本書内の定義）

- **反転コピー（1ブロック追加・確定挙動）**: コーチが組んだ「前半ブロック」（男子セル＋女子セルを
  持つ1時間行）を複製し、男女の中身を入れ替えた「後半ブロック」を直後の時間帯（開始＝前半の終了
  時刻・長さ＝前半と同じ）へ1個だけ追加する操作。前半ブロックは一切変更しない（純粋な追加）。
  1回の押下で1ブロックだけ増える（3ブロック以上の連鎖はしない）。追加位置が既存ブロックと時間
  重複する場合は追加しない。
- **オンリーモード**: その日を「女子のみ／男子のみ／男女両方」で切り替える設定。
- **セル**: 保存スキーマ上の `both`／`男子`／`女子` の1つ。`{block,label,items:[{name,note}]}`。
- **叩き台読込方式**: 既存の「自動で叩き台を入れる」と同じ、**保存前の編集ドラフト（`model`）へ
  決定論で流し込む方式**（`editor.mjs` の `openPanel(fromSeed)` → `initModelFromSeed`）。反転コピーも
  この方式に相乗りし、サーバ保存やLLMを介さない。

---

## 1. 現行データモデルの要約と、2機能で変わる点・変えない点

### 1.1 日＝時間ブロックの並び（表示日 `pd`）

- 1週 = 曜日ごとの表示日 `days[]`。各表示日は `source` で描画分岐する
  （`ui/plan-data.mjs`／`ui/pattern-timeline.mjs:dayTimeline`）:
  - `source:'empty'`（既定空白・未入力）→ 空状態UI（`emptyState`＋`emptyDayActions`）。
  - `source:'coach'` かつ `twoCol:true` → 男女2列タイムライン（`twoColTimeline`）。
  - `source:'coach'` かつ `twoCol:false` → 旧スキーマ単一blocks（`toAuthoredDay` 内 else 経路）。
  - `source` なし（エンジン叩き台）→ 表示しない（既定空白化で `toEmptyDay` に倒れる。叩き台は
    `seedDays` に温存＝自動入力ソース）。
- 実日付ISO（`date`）が編集・保存・単一可視日制御の一次キー。週起点日が無いテナントは全日 `date:null`
  で曜日キー（`data-go`）にフォールバック（`render-shared.mjs:showDayByDay`）。

### 1.2 各ブロックの both/男子/女子 セル（`twoCol` の行スキーマ）

コーチ上書き日（`layout:"two-col"`）の1行 `row` は次のいずれかを持つ（`plan-data.mjs:toTwoColDay`／
`editor.mjs:dayToPrefill`）:

- `both`: 男女共通の全幅バンド（1本）。`男子`/`女子` は持たない。
- `男子`・`女子`: 男女2列の各セル（片方だけ・両方いずれも可）。

`row` 共通フィールド: `from`（HH:MM）・`to`（HH:MM）・`minutes`。

### 1.3 保存スキーマ（サーバ正本）

`functions/index.mjs:sanitizeOverride` が受理・正規化する形（**これが真実源**）:

```
{ date:"YYYY-MM-DD", source:"coach", layout:"two-col",
  weekday?, court?, title?, aim?,
  rows:[ { from, to, minutes?,
           both?:{block,label,items:[{name,note?}]}
           | 男子?:{...}, 女子?:{...} } ] }
```

サーバ側の既存ガード（本設計が守るべき前提）:
- `rows` は配列・上限50行。`items` は上限50・`name` 空は落とす。
- 時刻ペアが両方非空なら HH:MM 妥当かつ「終了≥開始」を要求（終了<開始は throw で 400）。
- **`sanitizeOverride` はホワイトリスト方式**。列挙した以外のキー（新フィールド）は黙って落ちる。
  → オンリーモード用の新フィールドを保存に載せるなら、サーバ側の許可リスト追加が必須（第2.2章）。

### 1.4 seedPrefill・空状態

- `editorDataIsland` が全週のコーチ上書き日から `PREFILL[date]`、全週の `seedDays` から
  `SEEDPREFILL[date]`（エンジン叩き台を twoCol prefill 形へ変換）をデータ島に埋める。
- 「自動で叩き台を入れる」= `openPanel(true)` → `initModelFromSeed(date)` が `SEEDPREFILL[date]` を
  編集ドラフト `model` に流し込む（保存前）。反転コピーはこの相乗り点を使う。

### 1.5 2機能で「変える点／変えない点」

| 対象 | 反転コピー | オンリーモード |
|---|---|---|
| 保存スキーマ（`sanitizeOverride`） | **変えない**（`twoCol` の `男子`/`女子` セルにそのまま収まる） | **1フィールド追加**（`onlyGender`）＝サーバ許可リストへ1行追加 |
| 表示日の描画分岐（`source`/`twoCol`） | 変えない（既存 `twoColTimeline` がそのまま描く） | 追加（`onlyGender` 時は1列描画の分岐を1つ足す） |
| 編集ドラフト `model` の構造 | 変えない（`row.男子`/`row.女子` を書き換えるだけ） | 1フィールド追加（`model.onlyGender`）＋列の見せ方切替 |
| 既定空白・叩き台・多週ナビ・曜日フォールバック | 変えない（第4章 非回帰マトリクス） | 変えない（同） |
| 男女共通トグル（`mergeToBoth`/`splitFromBoth`） | 変えない（別軸の操作） | **オンリー時は無効化**（両方モードでのみ有効・第3章） |

---

## 2. 決定論アルゴリズム（入力→出力の疑似コード）

LLMは使わない。両機能とも `editor.mjs` クライアント側の決定論コードで完結する
（`CLAUDE.md` LLM設計原則①：分岐・整形・写像はすべてコード側）。

### 2.1 反転コピー（確定挙動・1ブロック追加限定）

**狙い**: コーチが組んだ「前半ブロック」（男子セル＋女子セルを持つ1時間行）を複製し、男女の中身を
入れ替えた「後半ブロック」を直後の時間帯へ1個だけ追加する。前半ブロックは一切変更しない（純粋な
追加操作）。例: 前半（16:00〜16:20）男子=ゲーム／女子=外 → 反転コピー後、後半（16:20〜16:40）
男子=外／女子=ゲーム が新規追加される（前半は不変）。

**入力**:
- `model.rows`: 現在の編集ドラフト（保存前）。
- `unitStartRi`: コーチが反転コピーを押した行インデックス（前半ブロック＝起点行）。

**アルゴリズム**（実装 = `editor.mjs:flipCopyRow`）:

```
function flipCopyRow(model, unitStartRi):
    src = model.rows[unitStartRi]                // 前半ブロック（起点行）
    boys = cellOf(src, '男子') ; girls = cellOf(src, '女子')
    if not cellHasContent(boys) and not cellHasContent(girls):
        flash("反転コピーの元になる中身がありません"); return   // コピー元が空なら中断

    fm = toMin(src.from) ; tm = toMin(src.to)
    if fm is null or tm is null or not (tm > fm):
        flash("前半ブロックの時刻が必要です"); return           // 時刻不正なら中断

    dur = tm - fm
    newFrom = src.to
    newTo   = minToHm(tm + dur)                   // 開始=前半の終了・長さ=前半と同じ

    // 追加位置が既存の他ブロックと時間重複しないか確認する（起点行自身は対象外）。
    overlap = model.rows.some(r, i => i != unitStartRi and rangesOverlap(newFrom, newTo, r.from, r.to))
    if overlap:
        flash("既存のブロックと重なるため追加できません"); return   // 重複時は追加しない（model不変）

    added = {
      from: newFrom, to: newTo, both: null,
      '男子': deepClone(girls) || blankCell(),    // 入替: 新ブロックの男子 ← 元の女子
      '女子': deepClone(boys)  || blankCell(),    // 入替: 新ブロックの女子 ← 元の男子
    }
    model.rows.splice(unitStartRi + 1, 0, added)  // 起点行の直後に1個だけ挿入（前半ブロックは不変）
    renderPanel()
    flash("男女の中身を入れ替えた後半ブロックを追加しました。確認して保存してください")
```

補助関数はすべて既存を再利用（新設は `rangesOverlap`／`minToHm` の2つのみ・いずれも純粋な時刻計算）:
- `cellOf(row, side)`／`cellHasContent(cell)`／`deepClone`／`toMin(hm)`（既存・`editor.mjs`）。
- `rangesOverlap(aFrom, aTo, bFrom, bTo)`：2時刻区間が重なるかの純関数（新設・時刻計算のみ）。
- `minToHm(min)`：分→`'HH:MM'`（新設・`toMin` の逆変換のみ）。

**安全策**: コーチ手入力の破壊経路が無い（追加のみで上書きしない）ため confirm は不要。安全策は
「重複時は追加しない」（既存ブロックを踏み潰さない）と「コピー元が空なら中断」（無意味な空行を
作らない）の2つ（第3章）。

**スコープ限定（重要）**: 1回の押下で**ちょうど1ブロック**だけ増える。3ブロック以上への連鎖は
しない（第9章 将来拡張に1行）。挿入後の行（`unitStartRi+1`）を起点に再度押せば追加できるが、
直前の反転コピーで作られた行が既にその時間帯を占めているため通常は重複扱いで中断される
（自動連鎖ではなく、コーチの独立した操作としてのみ成立する）。

**出力**: `model.rows` に後半ブロックが1行追加された編集ドラフト（前半ブロックは不変）。保存すると
既存の `buildOverride`→`sanitizeOverride` 経路で `twoCol` の `男子`/`女子` セルとして保存される
（スキーマ不変）。

### 2.2 オンリーモード（女子のみ／男子のみ／男女両方）

**狙い**: その日を「女子のみ／男子のみ／男女両方」で切替。オンリー時はその性別のみ1列で表示し、
その性別が体育館を独占する（組違い・反転コピー不要）。

**保存スキーマ拡張**（`sanitizeOverride` に1フィールド追加）:

```
out.onlyGender = (body.onlyGender === '男子' || body.onlyGender === '女子') ? body.onlyGender : undefined
// 未指定/不正値なら undefined（= 男女両方）。ホワイトリスト方式なのでこの1行が無いと黙って落ちる。
```

**編集ドラフト（クライアント）**:

```
model.onlyGender = null | '男子' | '女子'    // null = 男女両方

function setOnlyGender(model, g):            // g ∈ {null,'男子','女子'}
    model.onlyGender = g
    if g != null:
        // オンリー時は反対列・both を編集ドラフトから畳む（保存に載せない）。
        for row in model.rows:
            row.both = null
            // 反対列は退避してから空にする（両方へ戻したとき復元するため・第3章）。
            row._onlyMemo = row._onlyMemo || { '男子': deepClone(row['男子']), '女子': deepClone(row['女子']) }
            keep = row[g]
            row['男子'] = (g === '男子') ? keep : blankCell()
            row['女子'] = (g === '女子') ? keep : blankCell()
    else:
        // 両方へ戻す: 退避があれば復元（オンリー中に編集していなければ元の男女別が戻る）。
        for row in model.rows:
            if row._onlyMemo and not editedSinceOnly(row):
                row['男子'] = row._onlyMemo['男子']; row['女子'] = row._onlyMemo['女子']
            row._onlyMemo = null
    renderPanel()
```

**保存時（`buildOverride`）**: `model.onlyGender != null` なら各行はその性別セルだけを載せる
（反対列は出さない）。`ov.onlyGender = model.onlyGender` を付与。

**描画時（表示日）**: `pd.onlyGender` があれば、`twoColTimeline` の代わりに**1列タイムライン**で描く
（その性別チップ1つ＋1列のセル列）。既存の単一性別1列描画（`toAuthoredDay` の
`isSingleGender→sharedKind:'authored'`・`dayHeader` の `pd.team` チップ）と**同じ土台**を使えるので、
`pd.onlyGender` を `pd.team` にマップして既存1列経路へ流すのが最小改修
（新規1列レンダラーを作らない・第9原則「書く前に既存資産」）。

**もう片方の性別は「その日は練習なし」で列ごと出さない**（暫定・PdMがオーナー確認中）。
本設計では「オンリー日は1列のみ描画・反対性別の空列は出さない」を既定とし、確認結果で
「反対性別に別メニューを出す」に転ぶ場合は第9章の拡張点で受ける（`onlyGender` を性別ごとの
独立日データに拡張）。**現時点の不確定はこの1点に閉じ込める**。

---

## 3. コーチ手入力を黙って壊さない安全策

過去事故（男女共通トグルで非採用側を捨て、往復で男女別が壊れた＝`handoff-20260630` 教訓2／
`MEMORY.md:feedback_practice_planner_redo`「気に入ったデザインを変えない」）と同型を踏まない。

原則: **空セルのみ無確認で流し込む／中身のあるセルは上書き前に必ず確認を挟む／
モード切替は非採用側を退避して復元可能にする**。

| 操作 | 破壊リスク | 安全策 |
|---|---|---|
| 反転コピー（起点行は不変・追加のみ） | なし（既存行を一切書き換えない） | 純粋な追加操作として設計（`splice` で挿入するだけ・既存行への代入をしない）。 |
| 反転コピー（追加位置が既存ブロックと重複） | 既存ブロックの上書き | 追加前に `rangesOverlap` で重複検査し、重複時は追加しない（confirmではなく機械的に中断）。 |
| オンリー切替 → 反対列を畳む | 反対列手入力の消失 | `row._onlyMemo` に男女別を退避。両方へ戻すと未編集なら完全復元（`mergeToBoth`/`splitFromBoth` の `_memo`/`_mergeBase` と同じ退避復元パターン）。 |
| オンリー中に共通トグル押下 | 概念衝突 | オンリー時は共通トグルを無効化（`disabled`）。両方モードでのみ有効。 |
| 退避フィールド（`_onlyMemo`）の保存混入 | スキーマ汚染 | 退避は `model` 上のみ。`buildOverride` は退避キーを載せない（`_memo`/`_mergeBase` が保存に載らないのと同型）。`sanitizeOverride` のホワイトリストが最後の砦。 |

追加の決定論ガード:
- 反転コピーは**前半ブロックが空（男女とも中身なし）なら中断**（flash警告で何もしない）。無意味な空行を作らない。
- 反転コピーは**時刻不正（from/toが無い・終了≦開始）なら中断**。負の時間帯を作らない。
- 空セル判定は既存 `cellHasContent`（見出し or 名前ありの項目で true）を唯一の判定に使う（判定を二重定義しない）。

---

## 4. 直近出荷済み機能との非回帰マトリクス

各項目「壊れない理由／壊れうる経路と防ぎ方」を1行ずつ。

| 出荷済み機能 | 壊れない理由 | 壊れうる経路と防ぎ方 |
|---|---|---|
| 既定空白化＋オプトイン叩き台 | 両機能とも `source:'coach'` の編集ドラフト上の操作で、`toEmptyDay`/`seedDays` 経路に触れない | 反転コピーは編集パネル内の行操作のため、パネルを開いていない（＝`model` 未生成の）空状態日からは呼べない |
| 男女共通トグルの無損失集約/復元 | 反転コピーは別軸（`both`を作らず男女別を保つ）／オンリーは共通トグルを無効化 | オンリー中に共通トグルが押せると `mergeToBoth` と `onlyGender` が競合 → オンリー時トグル `disabled` で防ぐ |
| 週起点日が無いテナントの曜日フォールバック | 両機能とも実日付キーに依存せず `model`（曜日 `weekday` 保持）上で動く | オンリー保存は `date` doc IDに載る＝日付なしテナントは既存どおり保存不可のまま（挙動不変） |
| 単一可視日制御 | 両機能とも表示日の hidden 制御に触れない（`showDayByDate` 不変） | オンリー1列描画が `.day[data-date]` 構造を崩すと単一可視が壊れる → `article.day` の外殻は既存と同一に保つ |
| 多週ナビ | `PREFILL`/`SEEDPREFILL` は date キーで全週一意・反転/オンリーは1日内で閉じる | オンリーの `onlyGender` を全週共有マップに入れると別週へ漏れる → `onlyGender` は override 1件（=1日）に持たせ、date キーで週跨ぎ一意にする |

---

## 5. 「コート1面・コーチ1人」不変条件を破らない保証

不変条件（`plan-data.mjs` 冒頭・`rotation.mjs:findRotationViolations`・
`MEMORY.md:project_basketball_kumichigai_2col`）: **同時刻にコーチ付きは必ず片方だけ／
両方が同時にゲーム（コーチ付き）や体育館独占にならない**。

生成しない保証:

- **反転コピー**: 追加ブロックは前半ブロックと**別の時間帯**（開始=前半の終了）にしか作られないため、
  同時刻に男女両方がコーチ付きになる操作経路が存在しない。前半（例: 男子=ゲーム／女子=外）と
  後半（男子=外／女子=ゲーム、時刻は入替）は時間帯そのものが違うので、同時刻同種（両方ゲーム）を
  作ることはできない。既存ブロックとの時間重複は追加前に機械検査で弾く（第3章）。
- **決定論チェック（warning設計）**: 反転コピー後、同時刻行の男女セルの `block` が両方コーチ付き種別
  （`ゲーム`/`対人` 等の要監督枠）で一致したら**warningを1行出す**（throwしない＝`CLAUDE.md` LLM原則③・
  `findRotationViolations` が violations 配列を返すのと同じ非破壊検査）。コーチの意図的な同時運用
  （体育館2面が取れた日など）を禁止はしない＝警告に留める。
- **オンリーモード**: 1性別が体育館を独占する日なので、そもそも同時刻の男女衝突が発生しない
  （反対列が存在しない）。組違い・反転コピーはオンリー時に無効化（UIから導線を出さない）。

不変条件検査は既存 `rotation.mjs:findRotationViolations`（rows版）を素材にできるが、twoCol 手入力日は
rotation rows を持たないため、twoCol 用の軽量チェック（同時刻2セルの block 一致検出）を1つ足す
（`findRotationViolations` と同じ「violations配列を返す純関数・throwしない」契約に揃える）。

---

## 6. コーチ初見UX（ボタン置き場・押下後の見え方・取り消し）

既存の自動入力導線（`editorToolbar` の「自動で叩き台を入れる」／空状態日の `emptyDayActions`）と
一貫させる。既存 `.btn`／`.ed-mini` 作法のみ（emoji・色帯・gradient なし＝`design-hallmark`）。

### 6.1 反転コピー

- **置き場**: 編集パネル（`ed-panel`）内の各時間行（`ed-row-top`）に、既存の `ed-mini` 作法で
  「反転コピー」ボタンを1つ（男女共通トグルの隣・削除ボタンの手前）。押した行が前半ブロック（起点行）。
  男女共通（both）行・オンリーモード時は概念が衝突するため出さない。
- **押下後の見え方**: 起点行の直後に後半ブロックが1行だけ追加され（`renderPanel` で丸ごと再描画）、
  `flash` で「男女の中身を入れ替えた後半ブロックを追加しました。確認して保存してください」。
  起点行（前半ブロック）自体は表示・値ともに変わらない。追加位置が既存ブロックと時間重複する場合は
  何も増えず「既存のブロックと重なるため追加できません」と表示する。保存するまでサーバには出ない
  （叩き台読込方式と同じ＝保存前ドラフト）。
- **取り消し手段**: (a) パネルの「キャンセル」で編集ごと破棄（`closePanel`・既存）。(b) 保存前なら
  追加された行を既存の「この時間を削除」（`del-row`）で消せる（純粋な追加操作なので削除だけで
  完全に取り消せる）。(c) 保存後は既存「自動に戻す」（`revertAuto`）で上書き削除。

### 6.2 オンリーモード

- **置き場**: 編集パネル冒頭（ねらい・コートの近く）に3択トグル（女子のみ／男子のみ／男女両方）。
  既存 `modetoggle` 作法（`render-shared.mjs` の組違いON/OFF）と同じ見た目のセグメント。
- **押下後の見え方**: 「女子のみ」を選ぶと編集パネルが女子1列だけになり、男子列と男女共通トグルが
  消える（`disabled`＝押せない）。保存すると日画面もその性別1列で描かれ、ヘッダに女子チップ1つ。
- **取り消し手段**: 「男女両方」に戻すと退避（`_onlyMemo`）から男女別が復元（未編集時）。保存後は
  「自動に戻す」で上書き削除→既定空白へ。

---

## 7. 「行=時刻・左右=男女」の具体1例表（実際に画面に出る文言）

> オーナー合意用。コードを書く前にこの2表で挙動を確定する（教訓1）。文言は実画面のセル見出し／
> ドリル名で書く。反転コピーの表は「前半ブロックが不変のまま後半ブロックが1個増える」ことが一目
> でわかること。

### 7.1 反転コピー（火曜・前半ブロックを組んで反転コピーで後半ブロックを追加）

コーチが前半ブロック（16:05〜16:35）だけ組んだ状態（反転コピー前）:

| 時刻 | 男子（左列） | 女子（右列） |
|---|---|---|
| 16:05〜16:35 | ゲーム：5対5 ゲーム形式 | 外：コート外 走り込み・アジリティ |

反転コピー実行後（前半ブロックは**不変**・後半ブロックが1個**追加**され男女の中身が入替）:

| 時刻 | 男子（左列） | 女子（右列） |
|---|---|---|
| 16:05〜16:35 | ゲーム：5対5 ゲーム形式（不変） | 外：コート外 走り込み・アジリティ（不変） |
| 16:35〜17:05（新規追加） | 外：コート外 走り込み・アジリティ | ゲーム：5対5 ゲーム形式 |

→ 前半（16:05〜16:35）は元のまま「男子=ゲーム／女子=外」。後半（16:35〜17:05）は新規追加され、
男女が入れ替わって「男子=外／女子=ゲーム」。追加ブロックの時間帯（16:35〜17:05）は前半ブロックの
長さ（30分）と同じで、開始は前半の終了時刻（16:35）。同時刻に体育館（ゲーム）を使うのは常に
片方だけ＝コート1面・コーチ1人の不変条件を満たす。

### 7.2 オンリーモード（水曜・女子のみ）

「女子のみ」を選んだ日（男子列は出ない・女子1列）:

| 時刻 | 女子（1列・体育館独占） |
|---|---|
| 16:05〜16:20 | アップ：ダイナミックストレッチ |
| 16:20〜17:00 | シュート：アラウンドシュート |
| 17:00〜17:40 | ゲーム：5対5 ゲーム形式 |

日ヘッダは「7/1（水）女子」チップ1つ。男子は「この日は練習なし」で列ごと出さない（暫定・確認中）。

---

## 8. 実装タスク分解（TDD: テスト→実装→リファクタ／1タスク=1検証可能変更）

> テストは業務意図を検証する（`CLAUDE.md` 原則11）。実装の途中計算の写経はしない。
> 既存標準（`node --test`・Playwright実DOM駆動）を踏襲（新規テスト基盤は作らない）。
>
> **実装済み（2026-07-01）**: 反転コピーは確定挙動（第2.1章）へ差し替えて実装完了。以下は実装後の
> 実タスク記録（初稿の見積りタスクではなく、実際に行った変更点）。

### 反転コピー（実装済み）

1. **[test]** `ui/flip-copy-row.test.mjs`（Playwright実DOM）: 前半ブロック（男女とも中身）→反転コピーで
   後半行が1つ増え男女入替・前半ブロック自体は不変・追加位置が重複時は追加しない・コピー元が空なら
   中断・1回の押下で1行だけ増える、の5業務意図。
2. **[impl]** `editor.mjs` に `flipCopyRow(unitStartRi)`・`rangesOverlap`・`minToHm` を追加（`cellOf`/
   `cellHasContent`/`deepClone`/`toMin` を再利用）。
3. **[impl]** UIボタン結線（`ed-row-top` に `ed-mini`「反転コピー」・`onPanelClick` に
   `data-act="flip-copy"`）＋ `renderPanel`/`flash`。both行・オンリーモード時はボタン非表示。

### オンリーモード（実装済み）

4. **[test]** `functions/override-sanitize.test.mjs`: `onlyGender:'女子'/'男子'` を通す／不正値・未指定は
   落として `undefined`（=両方）。
5. **[impl]** `functions/index.mjs:sanitizeOverride` にホワイトリスト1行追加。
6. **[test]** `ui/only-gender-render.test.mjs`（Playwright実DOM）: `setOnlyGender` で反対列が
   `_onlyMemo` に退避・両方復帰で未編集なら完全復元・`buildOverride` で対象性別セルだけ載り退避キーは
   保存ペイロードに出ない。
7. **[impl]** `editor.mjs` に `setOnlyGender(g)`（`_memo`/`_mergeBase` の退避復元と同型の `_onlyMemo`）・
   `buildOverride` に `onlyGender` 分岐と付与を追加。
8. **[test]** `ui/overrides.test.js`⑦・`ui/only-gender-render.test.mjs`(a)(b): `onlyGender` が表示日
   （`pd.onlyGender`）へ伝わる／未指定の日は従来どおり男女2列（非回帰）。
9. **[impl]** `plan-data.mjs:toTwoColDay` に `onlyGender` を追加、`pattern-timeline.mjs:twoColTimeline`
   に1列描画分岐（既存の全幅バンド`.spine-together`/`.spine-band`を1性別で流用・新規レンダラーは
   作らない）、`render-shared.mjs:dayHeader` にオンリー時のチップ表示を追加。
10. **[impl]** UI: 編集パネル冒頭に3択トグル（`modetoggle` 作法）＋オンリー時に共通トグルを `disabled`
    ＋反対列に手入力があればオンリー切替前に確認（`window.confirm`）。
11. **[test]** 非回帰: 既存189テスト全緑（オンリー保存が既定空白・多週ナビ・曜日フォールバック・
    単一可視日を壊さない・第4章の各経路）。

### 合意ゲート

22. **[done]** 第7章の2表は確定挙動（第2.1章・反転コピー＝1ブロック追加）に合わせて書き換え済み。
    オンリー時「反対性別を出さない」は本実装でもそのまま採用（1列描画・反対列は出さない）。

---

## 9. 将来拡張（本設計のスコープ外・各1行）

- **3ブロック以上の連鎖追加**: 反転コピーを複数回・自動連鎖で足す拡張。今回は1回の押下=1ブロック限定。
- **男女で内容分岐する将来運用**: 大会時期の男女差が確定したら、男女で別メニューを生成する運用。今回は男女共通のまま。
- **オンリー日に反対性別の別メニュー**: オーナー確認で「反対性別も別内容を出す」に決まった場合、`onlyGender` を性別ごと独立日データへ拡張する。今回は「1列のみ・反対列は出さない」。

---

## 10. Code Reuse Analysis（新設せず再利用した既存資産・実装後の確定版）

| 使う既存資産（ファイル） | 用途 | 新設可否 |
|---|---|---|
| `editor.mjs`: `cellOf`/`cellHasContent`/`deepClone`/`blankCell`/`toMin`/`normalizeModel`/`renderPanel`/`flash` | 反転・オンリーのドラフト操作・再描画・確認表示 | 再利用（新設不要） |
| `editor.mjs`: `mergeToBoth`/`splitFromBoth` の退避復元パターン（`_memo`/`_mergeBase`） | オンリーの退避復元の設計手本 | パターン再利用（`_onlyMemo` を同型で追加） |
| `editor.mjs`: `openPanel(fromSeed)`/`initModelFromSeed` | 「保存前ドラフトへ流し込む方式」の相乗り点 | 再利用 |
| `render-shared.mjs`: `dayHeader`（`pd.team` チップの分岐に `pd.onlyGender` を合流）・`genderChip`・`modetoggle`（`.mt`/`.on` CSSをそのまま流用） | オンリーのヘッダチップ・3択トグルの見た目 | 既存トークン再利用（新規CSSクラス無し） |
| `pattern-timeline.mjs`: `twoColTimeline` 内の全幅バンド描画（`.spine-together`/`.spine-band`、both行と同型） | オンリー1列描画（新規レンダラーを作らず既存の全幅バンドを1性別で流用） | 既存DOM構造の再利用（分岐追加のみ・新規クラス無し） |
| `functions/index.mjs`: `sanitizeOverride` | 保存スキーマ（反転は不変・オンリーは `onlyGender` 1行追加） | 反転=不変／オンリー=1行追加 |
| 新設した最小要素 | `flipCopyRow`/`rangesOverlap`/`minToHm`（`editor.mjs`）・`setOnlyGender`（`editor.mjs`）・`onlyGender` フィールド（保存スキーマ・編集モデル・表示日） | 既存資産に同等機能が無いことを確認した上での最小新設 |

**「無いことを確認した」**: 反転コピー専用の既存関数・オンリーモード専用の既存フィールドは
現行コードに存在しない（`editor.mjs`/`plan-data.mjs`/`index.mjs` を確認）。よって上表の再利用資産の上に
最小の新設（`flipCopyUnit`／`setOnlyGender`／`onlyGender` フィールド／twoCol衝突検査）を積む。
