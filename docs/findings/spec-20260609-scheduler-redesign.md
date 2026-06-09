# 設計仕様: 採用UI スケジューラー再設計（中央時計貫通の根治・週カレンダー型・年いま男女ずれ根治）（2026-06-09）

> 前提資料: `docs/findings/handoff-20260609-timeline-2col-spine.md`（最優先=年いま男女ずれ・未解決）／`docs/findings/spec-20260609-kumichigai-2col-rotation.md`（組違い2列ローテの確定仕様）。
> 対象リポジトリ: basketball-coach-strategy（このリポジトリのルート）。
> 本仕様は frontend-engineer が着手できる粒度で、採用UI（`ui/pattern-timeline.mjs`）を「優れたスケジューラー型」に作り直す設計を確定する。LLM不使用・完全決定論。
>
> **実データ基準（本仕様の数値はすべて実出力で確認した）**: `current_month=8`。平日（火金=コーチ在席・水木=不在）は **16:05開始・17:45終了・窓100分**。土は **09:00開始・11:43終了・163分**。年いまは現状 `currentBoys=8`／`currentGirls=9`（=直す対象のずれ）。前資料 spec の「窓95分・17:40」は実装に取り込まれなかった旧ドラフトであり、**実装の真実源は窓100分・17:45**（`engine/data/config.sample.json` の平日 `schedule[].minutes=100`、`ui/rotation.test.js` の E2E が 16:05/17:45/100分 を緑で固定）。本仕様は実装の真実源（100分・17:45）に揃える。config の minutes 変更は本スコープに含めない。

---

## 0. 結論（オーナー酷評3点の確定回答）

| 酷評点 | 確定回答 | 根拠節 |
|---|---|---|
| (1) 中央時計スパインが男女同一メニュー（together/end 行）を**カードで貫く** | メイン投入済みの「together/end を左右2列ミラー化（grid `1fr 54px 1fr`・中央54px列に時計だけ）」を**正として固定**する。中央線（`.spine::before`）が必ずカードの「間（中央54px列の中）」を通り、左右どちらのカード矩形も横断しないことを構造不変条件にする。 | §3・§5 |
| (2) 週レベルが**非標準の週ビュー**（高さ＝時間の縦棒ガント） | 週レベルを **Googleカレンダー型の時間グリッド（縦=時刻軸・横=曜日5列）** に作り直す。要件の核は「見た瞬間カレンダーと認識できる」こと。時間軸は **案A確定【ロック】=共通の縦時刻ガター1本（全列同一 px/分）＋稼働帯の和集合にクランプ＋中間の最大未使用ギャップを細い「空き」ブレイク1本に畳む**。範囲・畳み境界とも実データ（`data.days[].blocks[].from`/`to`）から導出（ハードコード禁止）。案B（列ごとミニ軸）は却下（共通ガターが消えカレンダー認識が崩れる）。 | §4 |
| (3) 年「いま」が**男女でずれる**（同じ時間に生きる男女の現在位置が1ヶ月ずれる論理矛盾） | `year.currentBoys`／`currentGirls` を**両方とも暦月（`currentMonth`）に固定**し、男女の「いま」が必ず同じ arc セルを指すようにする。「女子先行」表現を可視テキストから全撤去。男女2行は構造として残す（今は同内容）。大会の男女差は未確定として表示に出さない。 | §6 |

---

## 1. 概要

### 1.1 何を作るか
コーチが配る練習計画UI（採用済み「タイムライン型」）の3レベルを、スケジューラーとして筋の通った見せ方に作り直す。

- **日レベル**: 中央時計スパインの2列（男子左・女子右）を維持しつつ、**男女同一メニューの行（together/end）が中央線で貫かれない**ことを構造で保証する。
- **週レベル**: 縦棒ガントを廃し、**Googleカレンダー型の時間グリッド**（縦=時刻・横=曜日）に置換。曜日ごとに開始時刻・窓長が違う（平日16:05/100分・土09:00/163分）のを、共通の縦時刻ガター1本＋中間の最大未使用ギャップを「空き」ブレイクに畳む（案A確定）ことで、カレンダー認識を保ったまま破綻なく表現する。
- **年レベル**: 男女の「いま」が同じ暦月セルを指すよう根治し、「女子先行」の可視表現を撤去する。

### 1.2 設計の単一方向依存（再掲・不変）
```
engine/ (PlanDay・coaching_mode 真実源)        ← 触らない
   ↓ buildSession（共通メニュー1本・HH:MM付与・displayMode解決）
ui/plan-data.mjs（presentation day = pd.blocks / pd.rotation / year）
   ↓ data
ui/render-shared.mjs（共通部品）／ui/pattern-timeline.mjs（採用パターンの日/週ビジュアル）
```
週グリッド・中央スパインは presentation 派生。engine ロジック（`computeSessionShape`・配分）・`coachingMode`・config は触らない。年いま根治のみ `plan-data.mjs` の2行（`year.currentBoys`/`currentGirls`）を変える。

### 1.3 本スコープ外（明示）
- `engine/` 一式（ロジック・config の `schedule[].minutes`）は不変。
- `ui/pattern-board.mjs`／`pattern-handout.mjs` の日レベルは本スコープ外（採用はタイムライン1本・前資料3で確認待ち）。ただし §6 の年いま根治は `render-shared.mjs` の共通部品（`yearSection`/`monthSection`）に入るため board/handout の年・月表示にも自動で波及する（これは根治の正しい波及であり、UI個性には触れない）。
- 組違いローテの導出ロジック（`ui/rotation.mjs`）・不変条件・テストは不変（§7で非破壊を確認）。

---

## 2. 変更ファイル別の差分方針

| ファイル | 変更の核 | スコープ |
|---|---|---|
| `ui/pattern-timeline.mjs` | ①together/end 行の左右2列ミラー化を「正」として固定（メイン投入分の確認と恒久化）。②`weekLevel()` を縦棒ガント→**週カレンダー型時間グリッド**に全面置換。③付随CSS（週グリッド）を追加、旧 `.weekcols`/`.wcol`/`.wstack`/`.wseg` 系を削除。 | 日レベル(together/end のみ)・週レベル全面 |
| `ui/render-shared.mjs` | ①`yearSection` の注記（L325「女子は男子より約1ヶ月先行…」）・凡例（L334-335 の男女いま月併記）を「今は男女同じ流れ」系へ。②`monthSection` の注記（L356「目標の大会の時期だけ男女でずれます（女子先行）」）を撤去/「今は男女同じ予定」へ。③`yearSection` の `buildRow` 呼び出しは `currentBoys`/`currentGirls`（=同じ値になる）を受ける形のまま不変。 | 年・月の可視注記のみ |
| `ui/plan-data.mjs` | ①`year.currentBoys`/`currentGirls`（L373-374）を**両方 `currentMonth` 直指定**に変更。②assumptions（L390）の「女子先行1ヶ月」前提を「今は男女同じ／大会の男女差は未確定」へ。③L362-363 コメント（女子先行記述）を実態へ更新。 | 年いま根治のみ |

**rotation.mjs / rotation.test.js は変更なし**（§7）。

---

## 3. together分割の確定（中央線貫通の根治）

### 3.1 確定する構造（メイン投入済みを正とする）
`ui/pattern-timeline.mjs` の `rotationTimeline()` で、男女同一メニュー行（`type==='together'` と末尾 end 行）は **同じ内容を左右2列に複製し、中央の54px列には時計だけを置く** 形を採る（現状コードがこれ）。

- レイアウト: `.spine-together { display:grid; grid-template-columns:1fr 54px 1fr; gap:7px; align-items:stretch }`。左=バンド複製・中央=`.spine-clk`（時刻＋dot）・右=バンド複製。
- rotation 行（`.spine-rotation`）も**同一の3列グリッド**（`1fr 54px 1fr`・gap:7px）。together/end/rotation の全行で列境界が一致するので、中央の時計列が縦に通る。
- 中央線 `.spine::before` は `left:calc(50% - 1px)`。3列が `1fr 54px 1fr`＋左右対称gapで構成される限り、幾何的中央（50%）は中央54px列の内側に落ちる。**左右の `1fr` カードは中央線に触れない**。

### 3.2 不変条件（再発を断つ・構造で固定）
以下を spec の構造不変条件として固定し、frontend-engineer は実画面で確認する。

1. **列整合**: together・end・rotation の3種すべてが `grid-template-columns:1fr 54px 1fr`＋`gap:7px`（狭幅は `1fr 44px 1fr`＋同gap）で揃う。1種でも列幅が違うと中央線が斜めにカードを掠める。
2. **中央線はカードの間に来る**: `.spine::before` の `left` は中央54px列の中心（`calc(50% - 1px)`）。中央列幅（54/44px）の範囲内に線が収まり、左右 `1fr` セルの矩形に重ならない。
3. **比例高さ（segH）維持**: together 行は `--sh:${segH(minutes)}px` をバンドの `min-height` に渡し、実尺の高さを保つ（`.spine-band{min-height:var(--sh,36px)}`）。rotation 行は `min-height:${segH(minutes)}px`。`segH = (m)=>Math.max(34, Math.round(m*3.6))` は不変。
4. **同一内容の左右ミラー**: together/end は左右に**同じ**内容（合同自走＝男女一緒）を出す。これは「冗長」ではなく「中央線がカードを割かない」ための構造的選択であり、左右同一であることが together の意味（男女合同）と一致する。rotation 行のみ左右が異なる内容（組違いスワップ）。

### 3.3 なぜ左右ミラーが正解か（代替案の棄却理由）
- **代替案A: together を全幅1枚カードにし中央線を消す** → rotation 行では中央線が必要（時計レール・dot）。together 行だけ中央線を消すと、行ごとに中央レールが途切れて「時計が通っている」スケジューラーの一貫性が壊れる。
- **代替案B: 中央線を全幅カードの「上」に重ねる（z-index）** → まさにオーナー酷評の「Divを線が貫く」状態そのもの。棄却。
- **採用: 左右2列ミラー＋中央列に時計** → 中央線は常にカードの「間（中央列）」を通り、together でも rotation でも時計レールが一貫して縦に通る。これが「貫かない」と「時計が通る」を両立する唯一の構造。

---

## 4. 週グリッド設計（Googleカレンダー型・時間軸はデータ導出）

### 4.1 時間軸トポロジー: 案A（共通ガター＋空白畳み込み）で確定【ロック】

**要件の核（オーナー明示）**: 「週カレンダーはGoogleカレンダーみたいに」。つまり**見た瞬間にカレンダーと認識できる**ことが第一要件。過去に非標準の週ビュー（縦棒ガント）で差し戻し済み。

**前提（実データの窓差）**:
- 平日（火水木金）: 16:05〜17:45（100分）。
- 土: 09:00〜11:43（163分）。
- 全列共通の連続軸を素のまま（09:00〜17:45）にすると、平日4列は 09:00〜16:05 の**約7時間が空白**になり、土1列だけに中身が寄る（空白の海）。

**確定トポロジー（team-lead 裁定でロック確定・ux-researcher 裏取り完了）**:
1. **共通の縦時刻ガター1本**。全曜日列が**同じ px/分スケール**で揃う（＝Googleカレンダーの識別特徴）。ガターは1本だけ（左端）。
2. **軸範囲は実データの稼働帯の和集合にクランプ**: 土の午前帯（09:00〜11:43）＋平日の夕帯（16:05〜17:45）。両端とも `data.days[].blocks[].from`/`to` から導出（ハードコード禁止）。誰も使わない 09:00 より前・17:45 より後は軸に含めない。
3. **中間の長い未使用帯（≈11:43〜16:05）は細い「空き」ブレイク1本に畳む**。畳み境界も実データから検出する＝**最終活動終了〜次活動開始の最大ギャップ**を1つ選び、そこを1本のブレイクにする（リテラル時刻で畳まない）。
4. **各曜日列ヘッダーにその日の開始〜終了を明示**（開始が曜日で違うことを正面から見せる。例: 火「16:05〜17:45」・土「09:00〜11:43」）。
5. **イベントブロックは 開始時刻=top・所要=height**。px/分スケールは日レベルの `segH` の精神（分→比例px）と整合させる（後述§4.2で `PX_PER_MIN` を共通定数化し、日スパインの比例感と週グリッドの比例感を揃える）。
6. **組違い日は週グリッドでは男女共通の流れ（共通メニュー時間帯）を1列で見せる**。男女左右内訳は日タブに置く（§4.4・既定どおり）。

**裏取りの出典（ux-researcher・完了）**:
- **共通ガター1本＝カレンダー認識の核**: 一級カレンダー（Google Calendar・Outlook・Notion Calendar）は例外なく左に共通時刻ガター1本・全曜日列が同じ縦軸を共有する。出典: Google Calendar 週ビュー（support.google.com/calendar/answer/6110849）・Justinmind カレンダーUI指針（justinmind.com/ui-design/best-calendar-app-designs-how-prototype）・Notion Calendar の等幅ガター（blakecrosley.com/guides/design/notion-calendar）。
- **未使用時間帯の畳み込み＝Googleカレンダー自身の作法（決定的）**: オーナー名指しの認識ベンチマークである Google Calendar 自身が「朝/夜の時間帯を隠す」機能を持ち、**共通時刻軸を保ったまま隠した帯を灰色シェード＋"time–time" の時刻レンジ表示で残し、クリックで展開**できる（隠した帯のイベントも condensed で消えない）。共通軸1本を保って未使用帯を畳むのは「カレンダーに見える」どころか Google カレンダーの標準挙動。出典: gilsmethod.com/hide-morning-night-hours-google-calendar・support.google.com/calendar/thread/12594571・cio.com/article/2395284。週ビュー（多列）でも共通の左ルーラー1本・曜日列構造を保ったまま稼働外を畳めることは BusyCal Week View（busymac.com/docs/busycal/70588-week-view）・The Events Calendar（theeventscalendar.com/extensions/schedule-day-view）が裏付け（畳み中は subtle overlay hint で示す）。軸を週の実最小開始〜最大終了にクランプするのは FullCalendar `slotMinTime`/`slotMaxTime`（fullcalendar.io/docs/timegrid-view）。
- **案B（可変尺）は不採用の出典**: 「セクションごとに独立スケール＝同じ見た目が違う量を表す」のは認識を壊すアンチパターン（Domo calendar chart 指針・domo.com/learn/charts/calendar-chart「set a consistent scale across all」）。時間軸でも同型。

**畳んだ帯の視覚規約（researcher 確定・実プロダクト規約準拠・実装の真実源）**:
- 畳んだ未使用帯（実データ ≈11:43〜16:05・7時間超）は共通ガター上の**1本の「空き」ブレイク**（全列横断・固定低背）。見せ方は実プロダクト規約に倣う:
  1. **薄い面**: Google の灰色シェード相当＝本アプリは `--bg` の inset 帯（色帯・強調にしない）。
  2. **時刻レンジ＋ラベル**: 「11:43〜16:05（練習なし）」＝Google の "time–time" 表示相当。ガターは午前帯最終時刻→ブレイク→夕帯開始時刻を連続表示（時刻の飛びで畳みが分かる）。
  3. **さりげない目印**: BusyCal の overlay hint 相当の mute 文字で「畳まれている」と分かる程度に留める。
- **強い装飾を使わない**: 破線・斜線・太線・色帯は使わない（Hallmark「いかにもAI」を避ける）。薄い面＋mute 文字のみ。
- ブレイク帯は固定低背・全列横断（特定列だけに出さない＝共通軸の一部）。

**researcher の作法（Notion Calendar 系・採用）**:
- 罫線は **1px・不透明度9%**（`rgba`の薄罫。色帯・太線にしない）。時刻ガターは **tabular-nums の等幅**（既存 BASE_CSS が `font-variant-numeric:tabular-nums` を全体に効かせているので、ガターの数字は自動で等幅・追加指定不要）。
- 階層は**色や枠でなくタイポグラフィで**（時刻=小・薄、ブロック名=主、分数=従。border帯で強調しない＝Hallmark とも一致）。
- 配置は **CSS Grid の名前付きグリッド線**（`grid-template-rows` に時刻区画の名前付きライン）でブロックを置く。`position:absolute` の手計算 top/height も可だが、名前付きグリッド線のほうが軸とブロックがズレず保守しやすい（researcher 推奨）。

**案B（却下・記録のみ）**: 列ごと可変ミニ軸（各列が自窓を100%正規化）。**却下理由: 共通ガター喪失でカレンダー非認識＋可変尺は「同じ見た目が違う量」の誤読を生む**（オーナー第一要件と衝突・Domo 指針のアンチパターン）。**フォールバックとしても不要**（researcher 確定: 案Aは視覚的に破綻せず、むしろ Google カレンダー自身の作法なので案Aで完結する）。設計判断の記録としてのみ残す。

### 4.2 時間軸導出ロジック（案A確定・疑似コード・ハードコード禁止）

実データから共通軸を導出する。`data.days[].blocks[].from`/`to`（`"HH:MM"`）が唯一の入力。`16*60+5` や `9*60`・`11:43`・`16:05` を週グリッド側にリテラルで書かない（plan-data が既に正しい `from`/`to` を持つので、それを読むだけ）。

```
// 'HH:MM' → 分（既存 plan-data の timeToMin2 と同型・週グリッド用にローカル定義）
const toMin = (hm) => { const [h,m] = String(hm).split(':').map(Number); return (h||0)*60 + (m||0); };

// px/分スケール（日レベル segH の比例精神と整合させる共通定数。segH=Math.max(34, m*3.6) と
// 同オーダーの比例感。週は俯瞰なので段の最小高さ制約は外し、純比例の係数だけ合わせる）。
const PX_PER_MIN = 3.6;     // 日スパイン segH と同係数（比例感の一貫性）
const BREAK_PX   = 22;      // 畳んだ未使用帯（「空き」ブレイク）の固定高さ（細い1本）

// 列に出すブロック（0件列は null で上位が明示扱い・沈黙フォールバック禁止）
function dayBlocks(day) {
  const blocks = day.blocks.filter(b => b.items.length > 0);
  return blocks.length ? blocks : null;
}

// ── 共通軸の導出（案A確定）──────────────────────────────────────────────
// 全曜日の稼働帯の和集合にクランプし、最大の未使用ギャップ1本を畳む軸を作る。
function buildWeekAxis(days) {
  const present = days.map(dayBlocks).filter(Boolean);
  if (present.length === 0) return null;                 // 週に1日も練習が無い＝上位で明示
  const axisStart = Math.min(...present.map(bs => toMin(bs[0].from)));        // 例: 540（09:00・土）
  const axisEnd   = Math.max(...present.map(bs => toMin(bs[bs.length-1].to)));// 例: 1065（17:45・平日）

  // 稼働帯の和集合（隣接/重複を結合）。例: [[540,703],[965,1065]]（午前帯・夕帯の2区画）。
  const used = mergeRanges(present.map(bs => [toMin(bs[0].from), toMin(bs[bs.length-1].to)]));

  // 畳む未使用帯＝使用区画間の「最大ギャップ」を1つ検出（実データから・リテラル禁止）。
  // 例: 703(11:43)〜965(16:05) の 262分が最大ギャップ→ここを1本のブレイクに畳む。
  let collapse = null;            // {from,to} 畳む区間（無ければ null＝畳まない）
  let maxGap = 0;
  for (let i = 1; i < used.length; i++) {
    const gap = used[i][0] - used[i-1][1];
    if (gap > maxGap) { maxGap = gap; collapse = { from: used[i-1][1], to: used[i][0] }; }
  }
  return { axisStart, axisEnd, used, collapse };
}

// 共通軸上の絶対時刻(min) → 縦px。畳む区間より後ろは BREAK_PX 分だけ詰める（実スケールは保つ）。
function axisY(min, axis) {
  if (axis.collapse && min >= axis.collapse.to) {
    // 畳む区間を通過: 畳む前の実分 + ブレイク固定 + 畳む後の実分
    const before = (axis.collapse.from - axis.axisStart) * PX_PER_MIN;
    const after  = (min - axis.collapse.to) * PX_PER_MIN;
    return before + BREAK_PX + after;
  }
  return (min - axis.axisStart) * PX_PER_MIN;            // 畳む区間より前はそのまま実スケール
}

// 各ブロックの矩形（共通軸・開始=top・所要=height）。全曜日列が同じ axisY を使う＝px/分が揃う。
function blockRect(block, axis) {
  const top    = axisY(toMin(block.from), axis);
  const height = (toMin(block.to) - toMin(block.from)) * PX_PER_MIN;   // 所要はブレイクを跨がない前提（稼働帯内）
  return { top, height };
}

// 時刻ガター（左端1本・全列共通）: 稼働帯の各区画の境界時刻を刻む。畳む区間は「空き」ブレイク1本で、
// ガターは畳み前後を連続表示（午前帯の最終時刻→ブレイク→夕帯の開始時刻）＝時刻の飛びで畳みが分かる。
// CSS Grid の名前付きグリッド線（grid-template-rows に区画名ライン）で配置するのが researcher 推奨。
```

- **min/max はデータ導出**: `axisStart`/`axisEnd` は全曜日の `blocks[0].from`/`blocks[last].to` の最小/最大。畳み境界 `collapse` は使用区画間の**最大ギャップ**を実データから検出（`11:43`/`16:05` をリテラルで書かない）。
- **px/分スケール共通**: `PX_PER_MIN=3.6` を日レベル `segH`（`m*3.6`）と同係数にし、日スパインと週グリッドの比例感を揃える（researcher 指示「day の segH 精神と一致」）。
- **空配列フォールバック禁止**: ブロック0件の曜日は列に出さず「この曜日は練習なし」を明示。週全体0件は週レベルで明示（黙って空グリッドを出さない）。
- **`mergeRanges`**: 区間配列を昇順ソート→隣接/重複を結合する決定論ユーティリティ（新規10行程度）。稼働帯の和集合に使う。
- **配置は CSS Grid 名前付きグリッド線**（researcher 推奨）: `grid-template-rows` に「午前帯／空きブレイク／夕帯」の名前付きラインを引き、各ブロックを `grid-row` で区画にスナップ。手計算 `position:absolute` の top/height（上記 `blockRect`）はフォールバック。どちらも軸とブロックが同じ `axisY` 由来なのでズレない。
- **罫線・ガター**: 罫線は 1px・不透明度9%（薄罫）。ガター数字は tabular-nums（既存 BASE_CSS の `font-variant-numeric:tabular-nums` で自動）。階層はタイポで（border帯禁止）。

### 4.3 列ヘッダと中身（曜日ごとの段取り）

**列は5練習日（火・水・木・金・土）＝1日1列**。`data.days` をそのまま左→右に並べる（曜日順）。各曜日列のヘッダに「曜日・開始〜終了・回し方」を出す。開始〜終了は §4.2 の `dayBlocks` から（火/水/木/金=16:05〜17:45・土=09:00〜11:43）。回し方は `day.sharedKind` から決定論で文言化（既存 `weekLevel` の `share` ロジックを流用）。

| `sharedKind` | 列ヘッダ回し方ラベル | 列内の中身 |
|---|---|---|
| `rotation`（火金） | 「組違いローテ」 | 共通メニューのブロックを時間グリッドに配置。組違いの左右内訳は出さない（後述4.4）。 |
| `together`（土） | 「男女合同」 | 同上（合同なので元々左右差なし）。 |
| `independent`（水木） | 「コーチ不在（各自）」 | 同上（全自走）。 |

- 各ブロックは `BLOCK_TINT[b.block]` で色付け（既存トークン・warm系・border帯にしない）。
- ブロックカードの中身は「ブロックラベル＋代表ドリル名＋分数」（既存 `weekLevel` の `main` 抽出ロジック流用）。
- 縦位置・高さは §4.2 の `axisY`（共通軸・全列同一スケール）で配置（CSS Grid 名前付きグリッド線にスナップ、または `position:absolute` の top/height）。

### 4.4 組違い日の週グリッドでの見せ方（既定起点を確定）

**設計判断**: 週グリッドは**男女共通の流れ（共通メニュー1本）を時間グリッドで見せる**。組違いの左右内訳（誰がいつコーチ付きか）は週グリッドに出さず、**日タブ（中央スパイン2列）に置く**。

**理由**: (a) 週は「1週間のリズム＝どの曜日にどのブロックがどれだけあるか」を俯瞰する場で、共通メニューは男女同一なので週レベルで左右に割る意味が薄い。(b) 週グリッドの1列をさらに左右2分割すると、5曜日×2列=10サブ列になり時間グリッドが過密で潰れる（特に印刷・狭幅）。(c) 組違いの「ずれ」は時刻精度で見るもの（前半/後半swap）で、それは日レベルの中央スパインが既に担っている。週は俯瞰、日は精細、という役割分担。

- 週グリッドの rotation 列ヘッダに「組違いローテ（左右の段取りは日タブ）」と1行で誘導する（既存 `weekLevel` の note と同趣旨）。
- これは前資料 spec の「全パターン2列で統一」（§5）と矛盾しない: あれは**日レベル**の本体を2列にする規定で、週レベルの俯瞰グリッドは対象外（日=2列、週=曜日カレンダー）。

### 4.5 週グリッドCSS方針（Hallmark厳守）
- 既存トークン（`TOKENS`・`BLOCK_TINT`・`--surface`・`--inset`・`--shadow-soft`）のみ使用。
- **border-left/top の色帯カード禁止**（Hallmark）。ブロックの種別色は背景tint（薄warm）＋inset shadowで示す。
- 汎用書体（Inter/Roboto/Open Sans/Helvetica）・purple/pink gradient・background-clip:text 見出し・emoji を新規に持ち込まない（既存 BASE_CSS の Hiragino・SVG）。
- **「空き」ブレイク帯**: 全列横断の細い横バンド1本（固定低背・`BREAK_PX`）。`--bg` の薄い inset 面（Google の灰色シェード相当）＋mute 文字の時刻レンジ「11:43〜16:05（練習なし）」（Google の "time–time" 表示相当）。**破線・斜線・太線・色帯は使わない**（薄面＋mute 文字のみ・Hallmark「いかにもAI」回避）。ガターはブレイクの上に午前帯最終時刻・下に夕帯開始時刻を連続表示。
- 狭幅（`@media max-width:680px`）: 5列横並びが潰れるので、曜日カレンダーを縦積み（1日=1ミニカレンダー）にフォールバック。各ミニカレンダー上部に共通の時刻ヘッダを付け、共通px/分スケールは保つ（列ごと可変尺にはしない）。
- 印刷（`@media print`）: 5列を維持（A4横 or 縮小）。box-shadow を border に置換（既存 print ルールに準拠）。

---

## 5. 年いま根治（arcMonth 確認結果＋確定コード片）

### 5.1 arcMonth の意味（engine 確認結果）
`engine/src/annualPlan.js` を読んで確認した：

- `resolveMonth(annual, gender, calendarMonth)` は `arcMonth = wrapMonth(calendarMonth + offset)` を返す。
- `offset` は `GENDER_OFFSET_MONTHS = { 男子: 0, 女子: 1 }`（女子1ヶ月先行モデル）。
- したがって `currentMonth=8` のとき、`resolveMonth('男子',8).arcMonth = 8`、`resolveMonth('女子',8).arcMonth = 9`。**これが年いまが1ヶ月ずれる直接原因**（実出力で `currentBoys=8`/`currentGirls=9` を確認済み）。
- `arcMonth` は「暦月にその性別の先行offsetを足して12で巻いた値」＝**arc 上の位置**であって、表示すべき「いまの暦月」ではない。年いまマーカーは**暦月**（男女とも同じ8月）に立てるのが正。

### 5.2 確定修正（`ui/plan-data.mjs` L371-376）

**現状**:
```js
const year = {
  arc,
  currentBoys: resolveMonth(annual, '男子', currentMonth).arcMonth,
  currentGirls: resolveMonth(annual, '女子', currentMonth).arcMonth,
  peaks: annualPeaks(annual),
};
```

**確定後**:
```js
const year = {
  arc,
  // 年の「いま」は男女とも同じ暦月。女子先行offset（_gender_offset）は arc 構造の遠因であり、
  // 「いま」の位置には効かせない（男女は同じ時間に生きているので現在位置はずれない）。
  currentBoys: currentMonth,
  currentGirls: currentMonth,
  peaks: annualPeaks(annual),
};
```

- これで `currentBoys === currentGirls === 8`。`render-shared.mjs` の `buildRow('boys', y.currentBoys)`／`buildRow('girls', y.currentGirls)` は同じ月セルに「いま」を立てる。
- `arc` 自体（`yearArc(annual,'男子',currentMonth)`）は男子基準の12ヶ月並びで不変（arc は男女共通の流れを1本で見せる土台。`buildRow` の `current` 判定だけ currentMonth で揃える）。
- **`_gender_offset`（annual-plan.json）と `resolveMonth('女子')` 経路は残置**（共通メニューは `resolveMonth('男子')` ベース・girlsGoals は girlsInput なので、女子offsetは年いまにしか効いていなかった。currentGirls を currentMonth 直指定にすれば offset は表示に一切効かなくなる）。engine データは触らない（最小スコープ）。

### 5.3 「女子先行」可視表現の全撤去（4箇所）
年いまを揃えても、注記に「女子先行」が残ると論理矛盾（同じ月にいまが立つのに「女子が1ヶ月先」と書いてある）が残る。以下を撤去/中立化する。

| 箇所 | 現状 | 確定後 |
|---|---|---|
| `render-shared.mjs` L325（yearSection 注記） | 「…女子は男子より約1ヶ月先行するので、2行のズレが組み方の参考になります。」 | 「男子・女子それぞれの『今月の位置』と『目標の大会の時期』を2行で並べています。今は男女とも同じ流れです（大会の男女差はコーチ確認で確定）。」 |
| `render-shared.mjs` L334-335（凡例） | 「男子いま（${y.currentBoys}月）」「女子いま（${y.currentGirls}月）」の2チップ | 男女とも同月なので「いま（${currentMonth}月・男女共通）」の1表現に統合、または2チップとも同月表示（どちらでも可。frontend判断・ただし「1ヶ月ずれ」の含意を消す）。 |
| `render-shared.mjs` L356（monthSection 注記） | 「…目標の大会の時期だけ男女でずれます（女子先行）。」 | 「…今月のテーマ・フェーズ・確認したい数字は年間予定どおり。練習メニューは男女共通です。」（「女子先行」削除） |
| `plan-data.mjs` L390（assumptions） | 「目標の大会の時期は男女で約1ヶ月ずれる（女子が先）ため『いま』の位置も1ヶ月ずれる。ずれ幅はコーチ確認で確定。」 | 「今は男女とも同じ年間の流れにいる。大会の時期に男女差があるかは未確定（コーチ確認）。確認が取れるまで男女差は表示に出さない。」 |

- コメント（`plan-data.mjs` L362-363 の女子先行記述）も実態へ更新（可視テキストではないが、次の編集者の誤誘導を断つ）。
- **男女2行は構造として残す**（オーナーは「分けるんだよ男女に」と2行化自体は要求）。今は2行が同内容（同じ月に「いま」、同じ大会時期）。将来コーチ確認で男女差が確定したら、`year.currentBoys`/`currentGirls` に確定値を入れるだけで2行のずれが復活する拡張点を残す。

### 5.4 大会の男女差は出さない
`arc` のピーク（`peakLevel`・`peakChip`「目標の大会」）は男女共通の1本arcに乗る（男子基準）。女子のピークを別月に出す処理は**追加しない**（未確定を偽の精度で見せない・行動原則3）。

---

## 6. Code Reuse Analysis（既存資産の再利用可否）

### 6.1 そのまま再利用（変更なし）
| 資産 | 所在 | 再利用 |
|---|---|---|
| `genderTwoColumn(pd, renderCell)` | `render-shared.mjs:235` | **日レベルの2列基盤として維持**。ただし採用パターンの日ビジュアルは `pattern-timeline.mjs` の中央スパイン3列（`rotationTimeline`）を使っており、`genderTwoColumn`（twocol grid版）は board/handout 経路。timeline は中央スパイン版を継続。 |
| `BLOCK_TINT` | `render-shared.mjs:174` | 週グリッドのブロック色・日スパインの行色にそのまま使う。新色を足さない。 |
| `TOKENS`/`BASE_CSS` | `render-shared.mjs:13,25` | 週グリッド新CSSは TOKENS の変数のみ参照。新トークン追加なし。 |
| `clientScript()` | `render-shared.mjs:373` | レベル切替（lvtab）・日タブ・組違いON/OFF・印刷・コピーの挙動は不変。週グリッドは `data-level="week"` の中身を差し替えるだけでスクリプト変更不要。 |
| `segH(minutes)` | `pattern-timeline.mjs:17` | 日スパインの比例高さに継続使用（不変）。 |
| `esc`/`modeTag`/`altLine`/`videoLink`/`genderChip`/`BLOCK_TINT` | `render-shared.mjs` | 週グリッドのブロックカード・列ヘッダで流用。 |
| `dayHeader`/`goalsSection`/`monthSection`/`assumptionsNote` | `render-shared.mjs` | 不変（monthSection は §5.3 の注記文言のみ変更）。 |
| `yearSection` の `buildRow` 構造 | `render-shared.mjs:302` | 不変（注記・凡例の文言のみ §5.3 で変更、ロジックは currentBoys/currentGirls が同値になるだけ）。 |
| `rotation.mjs`（`buildRotation`/`findRotationViolations`/`coveredColumnNames`） | `ui/rotation.mjs` | **完全不変**（§7）。 |

### 6.2 作り替え（置換）
| 資産 | 所在 | 置換内容 |
|---|---|---|
| `weekLevel(data)` | `pattern-timeline.mjs:170` | 縦棒ガント（`.weekcols`/`.wcol`/`.wstack`/`.wseg`）を**週カレンダー型時間グリッド**（§4）に全面置換。 |
| 週グリッドCSS | `pattern-timeline.mjs:224-242` の `.weekcols`系 | 削除し、週カレンダー時間グリッドCSS（案A確定: 共通の縦時刻ガター1本＋曜日5列・CSS Grid 名前付きグリッド線でブロック配置・「空き」ブレイク1本・罫線1px/不透明度9%・ガターtabular-nums）に置換。 |

### 6.3 微修正（既存を活かして一部変更）
| 資産 | 所在 | 変更 |
|---|---|---|
| `rotationTimeline` の together/end 行 | `pattern-timeline.mjs:86-147` | メイン投入済みの左右2列ミラーを「正」として確認・恒久化（§3）。列幅 `1fr 54px 1fr`・gap統一・`--sh` 比例高さを固定。 |
| year注記・凡例 | `render-shared.mjs:325,334-335,356` | §5.3 の文言へ。 |
| `year.currentBoys`/`currentGirls`・assumptions・コメント | `plan-data.mjs:373-374,390,362-363` | §5.2/§5.3。 |

### 6.4 兄弟プロジェクト確認
同一workspace（`ai-basketball-coach`）に類似の練習計画/スケジューラーUIがあるか確認した。`ai-basketball-coach` は別系統（コーチング戦略の別アプリ）で、本件の「コーチ1人・男女2チーム同体育館・組違いローテ」を解いている稼働実装は本リポジトリの `ui/` のみ。週カレンダー型グリッドの既存実装は本workspace内に無いことを確認したため、§4を新規設計する（既存があれば流用するが、無い）。

---

## 7. 不変条件の非破壊確認（rotation.mjs を壊さない）

本再設計は **`ui/rotation.mjs` と `ui/rotation.test.js` を一切変更しない**。確認した非破壊性：

1. **時計不変（rows合計==窓 throw）**: `buildRotation` 末尾の `if (rowsTotal !== pd.totalMinutes) throw` は不変。本件は `pd.rotation.rows` の**消費（描画）**のみ変更し、`buildRotation` の**生成**は触らない。together 行の描画を左右2列ミラーにしても、`row.minutes` も `pd.totalMinutes` も変わらない（描画は分数を表示するだけ）。
2. **不変2/3/4（`findRotationViolations`・`coveredColumnNames`）**: rotation 行の `boys`/`girls`/`coachSide` の**データ**は不変。描画の列割りだけ変える。テストはデータ層（buildRotation 出力）を検査するので、描画変更の影響を受けない。
3. **年いま根治の波及**: `year.currentBoys`/`currentGirls` を `currentMonth` に変えても、`buildSession`（共通メニュー・`resolveMonth('男子')`ベース）・rotation 導出・週グリッド（`day.blocks` 消費）には一切影響しない。年いまは `render-shared.mjs:yearSection` の `current` 判定にのみ効く。
4. **週グリッドのデータ源**: 週グリッドは `data.days[].blocks[].from`/`to`/`minutes`/`block`/`items`／`day.sharedKind` のみ読む（既存 `weekLevel` と同じ入力集合）。`pd.rotation` は読まない（組違い内訳は日タブ・§4.4）。新たなデータ要求が plan-data に発生しない。
5. **E2E テスト（rotation.test.js の火曜 16:05/17:45/100分）**: config・START_CLOCK・engine ロジックを触らないので緑のまま。

→ **rotation の不変条件・既存テストは全て非破壊**。週グリッド・日スパイン・年いまの変更は presentation 消費層に閉じる。

---

## 8. 実装タスク分割（1タスク=1検証可能な変更）

> コミット粒度は行動原則8（main直接・1論理変更=1コミット・revert単位）に従う。各タスクは単独で検証可能。

| # | タスク | 変更ファイル | 検証（業務意図） |
|---|---|---|---|
| T1 | **年いま根治（データ層）**: `year.currentBoys`/`currentGirls` を `currentMonth` 直指定に。L362-363 コメント更新。 | `plan-data.mjs` | `node -e` で buildPlanData → `year.currentBoys===year.currentGirls===8` を確認（実出力）。 |
| T2 | **女子先行表現の撤去（可視テキスト）**: yearSection 注記・凡例・monthSection 注記・assumptions を §5.3 の文言へ。 | `render-shared.mjs`・`plan-data.mjs` | grep で「女子先行」「女子が先」「約1ヶ月」が可視テキストから検出ゼロ。年タブ実画面で男女いまが同月。 |
| T3 | **together/end 行の左右2列ミラー恒久化**: メイン投入分を確認し、列幅 `1fr 54px 1fr`・gap・`--sh` 比例高さを §3.2 不変条件どおりに固定。 | `pattern-timeline.mjs` | 日タブ（火/金=rotation）実画面で、中央線が together/end/rotation 全行でカードの「間」を通り、左右カードを横断しないことを目視。比例高さ維持。 |
| T4 | **週グリッド: 共通軸導出ユーティリティ追加**（§4.2・案A確定）: `toMin`/`dayBlocks`/`mergeRanges`/`buildWeekAxis`/`axisY`/`blockRect`、定数 `PX_PER_MIN=3.6`（segH係数と整合）・`BREAK_PX`。範囲・畳み境界はデータ導出・ハードコードなし・空日はnull。 | `pattern-timeline.mjs` | `buildWeekAxis` で axisStart=540(09:00)・axisEnd=1065(17:45)・used が {[540,703],[965,1065]} の2区画・collapse が {703,965}（最大ギャップ）になることを実出力で確認。 |
| T5 | **週グリッド: `weekLevel` を週カレンダー型に全面置換**: 縦棒ガント削除→共通の縦時刻ガター1本＋曜日5列＋「空き」ブレイク1本の時間グリッド（CSS Grid 名前付きグリッド線で配置・列ヘッダに開始〜終了＋回し方・組違いは日タブ誘導）。 | `pattern-timeline.mjs` | 週タブ実画面で、**見た瞬間カレンダーと認識できる**（左端時刻ガター1本・全列同一スケール）／7時間の空白が「空き」ブレイク1本に畳まれている／土が午前帯・平日が夕帯に乗る／組違い列は「左右は日タブ」誘導。 |
| T6 | **週グリッドCSS**: 旧 `.weekcols`系削除、案A確定CSS（共通ガター＋曜日5列・名前付きグリッド線・「空き」ブレイク・罫線1px/不透明度9%・ガターtabular-nums・階層はタイポ）追加。狭幅は縦積みミニカレンダー、印刷は5列維持。Hallmark厳守（border帯/汎用書体/gradient/emoji なし）。 | `pattern-timeline.mjs` | hallmark audit 検出ゼロ。狭幅・印刷プレビューで崩れない。 |
| T7 | **通し確認・ビルド**: `node ui/build.mjs` 成功、日→週→月→年を実画面通し目視（時間が窓を埋める・週が見た瞬間カレンダー・中央線がカードを割かない・年いま男女同月・普通の日本語）。 | （生成物） | build成功・全レベル目視・QA緑（既存 rotation.test 緑維持＝§7非破壊）。 |

- T1→T2 は年いま根治（順序依存: データ→表示）。T3 は日レベル独立。T4→T5→T6 は週グリッド（順序依存: ユーティリティ→描画→CSS）。T7 は最終統合。**週軸は案A確定済みなので researcher 待ちはなく、T1〜T6 は依存順に着手可**。
- 各タスクは frontend-engineer（Sonnet）が指示通り実行。デザイン領域（T3/T5/T6）は完了報告前に hallmark audit 自走（検出ゼロ）を必須にする。

---

## 9. リスク・懸念（先出し）

1. **「空き」ブレイクの境界がデータで動く**: 畳み境界を最大ギャップから検出するので、将来カタログ/曜日が変わると畳む区間が変わる。→ 正しい挙動（実データ追従・リテラル禁止の意図どおり）。畳むギャップが無い週（全曜日が連続帯）なら `collapse=null` で畳まず素の共通軸になる（`axisY` が分岐済み）。畳む区間が複数ある稀ケースは最大1本だけ畳む（残りは実スケール・過圧縮で誤読しないため）。
2. **ブロックが「空き」ブレイクを跨ぐ異常**: `blockRect` の height は稼働帯内前提（ブレイクを跨がない）。万一ブロックの from/to が畳む区間をまたぐ入力（＝稼働帯導出と矛盾）なら、それは upstream の `from`/`to` 異常なので黙って潰さず検出する（height計算前に from/to が同一稼働区画内かをアサート）。
3. **土の163分が平日100分より縦に長いことの表現**: 共通軸（実スケール・PX_PER_MIN一定）なので土の午前帯が実分数で長く描かれ「土が長い」が自然に縦長さで伝わる（案Aの利点）。列ヘッダに開始〜終了も明示。
4. **together 左右ミラーの「同じ内容が2回」見え方**: 左右に同一内容が出るのを「冗長」とオーナーが感じる懸念。→ §3.3 のとおり中央線非貫通のための構造的選択であり、together=男女合同の意味と一致する（左右が同じ＝一緒にやる）ことを日ヘッダ/凡例で1行補足してもよい（frontend判断）。
5. **狭幅での週5列カレンダー潰れ**: 5列×時間グリッドは狭幅で過密。→ 縦積みミニカレンダー（1曜日=1ミニカレンダー・共通ガターは各ミニカレンダー上部に時刻ヘッダ）にフォールバック（§4.5）。
6. **px/分スケールの絶対高さ**: `PX_PER_MIN=3.6` だと稼働帯合計263分（163+100）×3.6≒947px＋ブレイク。縦に長すぎる場合は係数を下げる調整余地（segHとの比例感は保つ）。frontend が実画面で高さ感を確認。

---

## 10. 注意・PII
- 本仕様の参照は全てリポジトリ相対パス。個人ホーム配下の絶対パス・本名・実選手値は書いていない。
- LLM不使用・完全決定論（週グリッド配置・年いま・組違い導出すべてコード）。
- 実選手データは未接続・合成値（既存どおり）。
- 生成HTML（`ui/*.html`）・QAスクショ（`e2e/screenshots/`）は `.gitignore` 済み（再生成= `node ui/build.mjs` / headless Chrome）。
