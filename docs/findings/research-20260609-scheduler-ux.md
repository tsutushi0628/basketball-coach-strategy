# UXリサーチ: 優れたスケジューラー/カレンダーUIから「パクるべきパターン」（2026-06-09）

## このドキュメントの目的と読み方
コーチが配る練習計画UI（年/月/週/日）を「生成AI丸出し」から脱却させるための、世の中の一級スケジューラー（Google Calendar 週ビュー・Notion Calendar〔旧Cron〕・Fantastical・Sunsama・BusyCal・FullCalendar 等）のUI/UXパターンを実調査した結果。各パターンは **何を / なぜ効く / 本アプリのどのレベル（日 or 週）にどう適用するか** の3点で書く。

### 本アプリの前提（適用判断の土台）
- **トンマナ**: ST-labo warm（`st-labo/public/css/style.css` 実値）。`--bg:#fbf5ec`／`--surface:#fffaf2`／`--ink:#2a201a`／`--mute:#7a6a5c`／`--orange:#ef7a32`／`--orange-soft:#ffd7b9`／大角丸（14〜32px）／柔らかい影＋inset影（ニューモーフィズム）／書体 Hiragino。**新パレットは提案しない。既存トーンを「壊さず洗練」が目的。**
- **時間構造の実態**（`ui/plan-data.mjs`・引継書 `handoff-20260609-timeline-2col-spine.md`）: 平日は **16:05開始〜17:45終了の100分** に密集。土曜だけ09:00開始で長い（「まばら＆開始時刻ばらつき」の核心）。
- **日レベル**は採用済みの「縦の比例タイムライン」（組違い時は中央時計スパイン3列＝左男子・中央時刻・右女子）。**週レベル**は現状「日ごとの縦積みバー（高さ=総分数）」で、**まだ時刻軸×曜日列の真の時間グリッドになっていない**（`ui/pattern-timeline.mjs` weekLevel）。本リサーチの①②は主にこの週レベルの作り直しに効く。
- Hallmark NG厳守: border-left/top の色帯カード・汎用書体（Inter/Roboto/Open Sans/Helvetica）・紫ピンクgradient・background-clip:text の gradient見出し・emoji・偽ブラウザchrome・全幅centered hero。

---

## ① 週グリッドの推奨レイアウト（名指し推奨＋理由）

### 推奨: 「縦=時刻軸 / 横=曜日5列」の time-grid を、**Notion Calendar〔旧Cron〕の時間グリッド作法**で組む

**名指しの第一推奨は Notion Calendar（旧 Cron）の週ビュー作法**。理由は次の3点で、すべて本アプリの「装飾なしで上質」「Hallmark NG回避」という制約と一致するから。

1. **罫線が極限まで控えめ（1px・不透明度9%）**で、グリッドが「枠」として主張せずイベント内容を主役にする。本アプリのニューモーフィズム（柔らかい影で面を浮かせる）と相性が良く、border-left色帯のような「いかにもAI」な強い線を一切使わずに時刻軸を引ける。
   - 具体値: グリッド線 `rgba(0,0,0,0.09)` 相当（本アプリでは `--line-2` をこの濃度域に合わせる）。出典: [Notion Calendar デザイン解説](https://blakecrosley.com/guides/design/notion-calendar)
2. **時刻ガター（左端の時刻数字）が等幅数字（monospaced numerals）**で、桁数が違っても数字が縦に綺麗に揃う（`16:05`／`9:00` が左揃えで列を成す）。本アプリは Hiragino のみだが、時刻だけ `font-variant-numeric: tabular-nums` を当てれば等幅書体を新規導入せずに同じ「数字が揃う気持ちよさ」が出る（汎用書体導入＝Hallmark NGを避けられる）。出典: [同上](https://blakecrosley.com/guides/design/notion-calendar)
3. **色・枠・背景に頼らず、タイポの極端なコントラストだけで階層を立てる**設計思想（H1:H2 比 5.3:1）。本アプリの「練習ブロック見出し＝小さく強い／ドリル名＝大きめ本文／時刻＝小さく等幅」の3層に転用でき、装飾を足さずに密度の高い情報を整理できる。出典: [同上](https://blakecrosley.com/guides/design/notion-calendar)

**Google Calendar 週ビュー**は「時刻軸を左に1本・曜日を横に7列・イベントは開始時刻オフセットに置き所要分で縦伸びする」という業界標準の骨格として参照する（[Calendar UI Examples・Eleken](https://www.eleken.co/blog-posts/calendar-ui)／[Justinmind 比較](https://www.justinmind.com/ui-design/best-calendar-app-designs-how-prototype)）。ただし**本アプリでは曜日は7列ではなく平日5列（＋土曜は別扱い、③参照）**。

**適用（週レベル）**: 現状の「日ごとの縦積みバー」を、左端に時刻ガター（等幅数字）・横に平日5列の time-grid に作り替える。罫線は `--line-2` を不透明度9%域の極薄に。セル＝練習ブロックは `--surface` の面＋柔らかい影で浮かせ、border-left色帯は使わない。階層はタイポのコントラスト（時刻=11〜12px等幅mute／ブロック名=12px太字／ドリル=14〜15px）で立てる。

---

## ② イベント配置の原則（開始時刻=top・所要=height）

### パターンA: 「名前付きグリッド線」方式（CSS Grid・推奨／週レベル）

**何を**: 時刻ごとにグリッド行を作り、イベントは「開始時刻の線 / 終了時刻の線」で `grid-row` を指定して配置する。

**なぜ効く**: 計算（top=開始オフセットpx・height=所要px）を書かずに、`grid-row: time-1605 / time-1645;` のように**時刻名がそのままレイアウトになる**ため、コードが「読める」=保守事故が起きにくい。CSS-Tricks のカンファレンス・スケジュール手法がこれで、複数トラック（＝本アプリの男女2列やブロック並走）にも `grid-column` で素直に拡張できる。出典: [Building a Conference Schedule with CSS Grid・CSS-Tricks](https://css-tricks.com/building-a-conference-schedule-with-css-grid/)

**適用（週レベル）**: 平日帯（16:05〜17:45）を5分刻み（引継書の「最小単位5分」と一致）でグリッド行に割り、各曜日列で練習ブロックを `grid-row: 開始 / 終了` で置く。所要が長いブロックは自動で縦に伸びる＝高さがそのまま時間量になる。

### パターンB: 「1分あたりpx」方式（絶対配置・日レベルの比例タイムラインで既採用）

**何を**: `top = (開始 − 窓開始) × pxPerMin`・`height = 所要 × pxPerMin` でブロックを絶対配置する。本アプリの日レベルは既にこれ（`ui/pattern-timeline.mjs` の `segH = minutes × 3.6`）。

**なぜ効く**: 「高さ＝時間量」が一目で伝わる比例タイムラインに最適。グリッド線名を全部用意せずに連続的な時刻に置ける。出典の実装群: [Snook.ca CSS Grid Calendar](https://snook.ca/archives/html_and_css/calendar-css-grid)／[Zell Liew・CSS Gridでカレンダー](https://zellwk.com/blog/calendar-with-css-grid/)

**適用**: 日レベルは現行の比例方式を維持（既にオーナーが気に入っている＝壊さない）。週レベルは①②パターンAのグリッド線方式が、5分刻みの密集と男女/ブロック並走の表現に向く。

### 共通原則: 最小タップ/視認高さの確保
所要が極端に短いブロック（5分の給水等）でも潰れないよう **min-height を確保**する（本アプリ実装も `Math.max(34, …)` で下限34pxを敷いており、この発想は正しい）。出典: 列高さを content auto にして短い枠も読める高さを保つ手法（[CSS-Tricks](https://css-tricks.com/building-a-conference-schedule-with-css-grid/)）。

---

## ③ まばら/開始時刻ばらつきの扱い（土曜09:00 × 平日夜帯 の混在）— 必須推奨

### 推奨: 案A「**共通の縦時刻軸1本（尺＝px/分を全列で固定）＋未使用時間帯の畳み込み（圧縮）**」を採る。案B（曜日列ごとに自前の時刻尺）は採らない。

オーナー最重視の要件は「Googleカレンダーみたいに＝見た瞬間カレンダーと認識できる」こと。**この認識可能性の要件が、まばら由来の空白を消したい都合より優先される**ので、共通軸を維持したまま空白を畳む案Aが正解。判定の根拠は次の2点。

1. **認識可能性で案Aが必須**: 一級カレンダー（Google Calendar／Outlook／Notion Calendar）は例外なく「左に共通の時刻ガター1本・全曜日列が同じ縦軸を共有」。**縦位置＝時刻が全列共通**であることがカレンダーの大前提で、これがあるから「一目でカレンダーと分かる」。出典: [Google Calendar 週/日ビュー](https://support.google.com/calendar/answer/6110849?hl=en&co=GENIE.Platform%3DDesktop)／[Justinmind・各社週ビュー骨格](https://www.justinmind.com/ui-design/best-calendar-app-designs-how-prototype)／[Notion Calendar の共通等幅ガター](https://blakecrosley.com/guides/design/notion-calendar)。
2. **案Bは認識を壊す既知のアンチパターン**: セクションごとに独立スケールさせると「同じ見た目が違う量を表す」ため誤読を生む（＝列ごとに尺を変えると、同じ縦位置が列によって違う時刻になり、時刻照合が壊れる）。出典: [Domo・Calendar Chart（"if each month auto-scales independently…set a consistent color scale across all"）](https://www.domo.com/learn/charts/calendar-chart)。時間軸でも同型で、列ごと可変尺＝px/分のばらつきは読み手の時刻照合を破壊する。

### まばら問題（平日午前〜午後の大空白）の処理＝案Aの実在パターン

共通軸を保ったまま空白を破綻させない手段が、優れたカレンダーに実在する。

1. **共通軸を稼働帯の和集合にクランプ（slotMinTime/slotMaxTime + scrollTime）**: 一級カレンダーは「表示する最初/最後の時刻」を設定でき、最初のイベントまで自動スクロールする。深夜・早朝の空白は最初から描かない。出典: [FullCalendar TimeGrid View（slotMinTime/slotMaxTime）](https://fullcalendar.io/docs/timegrid-view)／[FullCalendar Date & Time Display（scrollTime）](https://fullcalendar.io/docs/date-display)。
   - **本アプリ適用（週レベル）**: **左の共通時刻ガターは1本のまま**（全曜日列が同じ px/分スケールで揃う）。その共通軸を24hではなく「その週の全曜日の稼働帯の**和集合**」にクランプする。本アプリなら土の午前帯（09:00〜11:43）∪ 平日の夕帯（16:05〜17:45）を1本の軸でカバーする（列ごとに別軸を持たせない）。
2. **未使用帯の圧縮は Google カレンダー自身の確立パターン（最重要・認識性の直接根拠）**: **Google カレンダーは「朝/夜の時間帯を隠す（hide morning/night hours）」機能を持ち、隠した時間帯を共通時刻軸の上下に「灰色シェードの帯＋"time–time"の時刻レンジ表示」で残し、クリックで展開できる**。隠した帯にイベントがあっても「condensed（圧縮）表示で残り消えない」。＝**共通の縦時刻軸1本を保ったまま未使用帯を畳むのは、オーナーが名指しした Google カレンダーそのものの作法**。出典: [Google Calendar・朝/夜の時間帯を隠す（灰色シェード帯＋クリック展開）・gilsmethod](https://gilsmethod.com/hide-morning-night-hours-google-calendar)／[Google Calendar Community・hide morning and night hours](https://support.google.com/calendar/thread/12594571/how-do-i-hide-morning-and-night-hours-cant-find-the-labs-section-in-settings-is-it-removed?hl=en)／[CIO・Google Calendar power tips（時間帯非表示）](https://www.cio.com/article/2395284/5-google-calendar-tips-and-tricks-for-power-users.html)。
   - **週ビュー（多列）でも共通軸を保ったまま畳めることの裏付け**: BusyCal の Working Hours collapse は **週ビューでも左の統一時刻ルーラー1本・曜日列のカラム構造を保ったまま**、稼働外の時間帯を畳む。畳んでいる間は「subtle overlay hint（さりげない目印）」で「いま稼働時間に絞った表示」だと示す。出典: [BusyCal Week View（週ビューで統一ルーラー維持のまま collapse）](https://www.busymac.com/docs/busycal/70588-week-view/)／[BusyCal Day View](https://www.busymac.com/docs/busycal/70587-day-view/)／[The Events Calendar・inactive slot collapse](https://theeventscalendar.com/extensions/schedule-day-view/)。
   - **本アプリ適用 ＝ 畳んだ帯の視覚規約**: 和集合軸の中間にできる長い未使用帯（≈11:43〜16:05 の7時間超）を、共通ガター上で **1本の「空き」ブレイク**に畳む。見せ方は上記実プロダクトの規約に倣う＝①薄い面（Google の灰色シェード相当→本アプリは `--bg` のinset帯）＋②「11:43〜16:05（練習なし）」の時刻レンジ＋「空き」ラベル（Google の "time–time" 表示相当）＋③さりげない目印（BusyCal の overlay hint 相当）。破線・斜線等の強い装飾は使わず（Hallmarkの「いかにもなAI装飾」を避ける）、薄い面＋mute文字で「畳まれている」と分かる程度に留める。これで7時間超の空白が消え、土曜の午前帯と平日の夕帯が同じ尺の同じ軸上に近接して並ぶ。共通軸・同一尺は最後まで保つ。
3. **疎なら密度に応じてグリッド高さを与える（grid/timeline の使い分けの精神）**: イベントが疎なとき時刻グリッドが間延びしやすいのは事実。ただし対処は「列ごとに尺を変える」ではなく「②の圧縮で未使用帯を畳む」で行う。出典: [Stratifi Creative・カレンダービューのUX問題](https://stratificreative.com/blog/the-problem-with-calendar-views-how-to-improve-ux-on-your-events-page/)／[ui-patterns・Event Calendar](https://ui-patterns.com/patterns/EventCalendar)。

**土曜対応の最終推奨（必ず含める指定への回答）= 共通クランプ軸＋空白畳み**:
> 週ビューは **左の共通縦時刻ガター1本・尺（px/分）を全列で固定** を守る（＝案A。これが「見た瞬間カレンダー」の識別特徴）。軸は**全曜日の稼働帯の和集合**＝土の午前帯（09:00〜11:43）∪ 平日の夕帯（16:05〜17:45）をカバーし、中間の長い空白（≈11:43〜16:05）を共通ガター上の **1本の「空き」ブレイク（細い帯＋「午前〜午後（練習なし）」）** に畳む。これで7時間超の空白も土曜のはみ出しも消え、かつ全列が同じガターに揃うのでカレンダーとして認識される。開始時刻が日で違うことは各列ヘッダーに `16:05` / `09:00` と明示して正面から見せる。**「全日24h均等割り」も「各日の列を活動窓だけ描く＝列ごと独立窓／可変尺の案B」も採らない**（前者は空白で破綻・後者は共通ガターが消えてカレンダー認識性を壊す）。

---

## ④ 情報密度の階層（狭い列での見せ分け・省略）

**何を / なぜ効く**: 一級カレンダーはイベントブロック内で「時刻 → タイトル → 補足」を**サイズ・太さ・色（mute）だけ**で階層化し、狭い列ではタイトル1行＋時刻に省略、ホバー/展開で詳細を出す。Notion Calendar は色や枠を足さずタイポのコントラストだけでこれを実現（H1:H2=5.3:1）。出典: [Notion Calendar デザイン解説](https://blakecrosley.com/guides/design/notion-calendar)／[Calendar UI Examples・Eleken（色＋長さ＋アイコンで category/duration/status を伝える）](https://www.eleken.co/blog-posts/calendar-ui)。

**狭い列での具体作法**（出典: 上記Eleken＋[setproduct・Calendar UI](https://www.setproduct.com/blog/calendar-ui-design)）:
- ブロック見出し（カテゴリ）= 10〜12px・太字・`--mute` か `--orange`、`letter-spacing` わずか広げ。
- ドリル名（主役）= 14〜15px・semibold・`--ink`。`text-overflow: ellipsis` で1行省略。
- 補足/代替/動画リンク = 11px・`--mute`、必要時のみ折り返す（`flex-basis:100%`）。
- 分数 = 11px・`--mute`・右寄せ（`margin-left:auto`）。本アプリは既にこの並びを実装済み（`.tlh`／`.tlm`）＝この方向で正しい。

**適用（日・週両方）**: 「色を増やして区別」ではなく「サイズ・太さ・mute差で区別」を徹底する。これがそのまま Hallmark NG（border-left色帯・gradient見出し）回避になる。category 区別が要るときも色面（薄tint背景）＋テキストラベルにとどめ、アイコングリッドや色帯は使わない。

---

## ⑤ 色・余白・タイポの洗練手法（過度な装飾なしで上質）

**何を / なぜ効く**: 上質に見えるカレンダーの共通項は「①純黒を使わず透明度付きの近黒 ②面は影で浮かせ枠線を細く薄く ③数字を等幅で揃える ④余白で区切る（罫線で区切らない）」。

- **純黒を避ける**: Notion Calendar は本文 `rgba(0,0,0,0.9)`・2次 `0.54`・3次 `0.35` と階層を黒の不透明度で作る。本アプリは `--ink:#2a201a`（既に純黒でない暖色寄り黒）＝この原則を既に満たす。2次情報は `--mute:#7a6a5c` を使い、それ以下はさらに `opacity` を落とす（実装の `.tbl-comp{opacity:.8}` がこの発想）。出典: [Notion Calendar デザイン解説](https://blakecrosley.com/guides/design/notion-calendar)。
- **暖かいサーフェス**: Notion Calendar のサーフェスは `rgb(247,247,245)`（冷たい灰ではなく暖色寄り灰）。本アプリは `--surface:#fffaf2`＝もっと暖かいクリームで、ST-labo の温かみとして強み。**この暖色サーフェスを週グリッドのセル面にも一貫適用**する。出典: [同上](https://blakecrosley.com/guides/design/notion-calendar)。
- **影で深さ、枠で区切らない**: Fantastical は subtle shadow と控えめ border で「散らからない深さ」を作る。本アプリのニューモーフィズム（`--shadow-soft`＋`--inset`）はこれと同系統で、border-left色帯のような強い線を足さずに面を立てられる。出典: [Notion Calendar vs Fantastical・bricxlabs](https://bricxlabs.com/blogs/calendar-ui-examples)。
- **数字を揃える**: 時刻・分数・KPI数値に `font-variant-numeric: tabular-nums` を当て、桁ぶれの「ガタつき」を消す（Notion Calendarの等幅ガターと同効果を、書体を増やさず実現）。出典: [Notion Calendar デザイン解説（monospaced numerals）](https://blakecrosley.com/guides/design/notion-calendar)。
- **余白で階層**: タイポのスケール差（極端なH1:H2）＋whitespace だけで階層を立て、色・枠・背景の装飾を引く。本アプリの見出し（`clamp(20px,3.4vw,26px)`）と本文（13〜15px）の差を保ち、間延びは余白で詰める。出典: [同上](https://blakecrosley.com/guides/design/notion-calendar)。

**適用**: 新しい色は足さない。`--orange` はアクセント1点（今いる位置・主役の強調）に限定し、面は `--surface`、文字階層は `--ink`→`--mute`→opacity で作る。グリッド線は極薄（9%域）。これで「生成AI丸出し（強い色帯・gradient・アイコン散乱）」の真逆＝「ピッキーに整えられた」印象に寄る。

---

## ⑥ 日タイムラインの洗練（現在時刻ライン・時刻ラベル・カード間リズム）

**何を / なぜ効く**: 縦の比例タイムライン（日レベル・採用済み）をさらに上質にする要素。

- **現在時刻ライン（"now" インジケータ）**: 一級カレンダーは細い線（多くは赤・1〜2px）で「今ここ」を示す。**丸い点だけ・太い帯は読み取り精度が落ちる＝細い線が正解**というユーザーフィードバックがある。出典: [FullCalendar Now Indicator](https://fullcalendar.io/docs/now-indicator)／[DayPilot 現在時刻ハイライト](https://doc.daypilot.org/calendar/highlighting-current-time/)／[Eleken（type sizing・color contrast・visual weight で現在を立てる）](https://www.eleken.co/blog-posts/calendar-ui)。
  - **本アプリ適用**: 練習中（16:05〜17:45）に開くと「今この瞬間どのブロックか」が分かる細い `--orange` の水平ライン＋小さな時刻ピルを引く。太い帯・大きな丸は使わない。配布PDF/印刷時は非表示（`data-print-hide` 同様）。これは「コーチが体育館でスマホを見て今どこか分かる」という行動変容に直結。
- **時刻ラベルの作法**: 等幅数字（tabular-nums）でガターに `16:05` を縦に揃える（①③で既述）。本アプリは既に時刻ピル（`.tk`）を inset影のピルで出している＝ニューモーフィズムとして良い。等幅数字を足すと桁揃いが完成する。出典: [Notion Calendar（等幅ガター）](https://blakecrosley.com/guides/design/notion-calendar)。
- **カード間のリズム**: イベントブロックは「高さ＝時間量」を保ちつつ、ブロック間に一定の縦ギャップ（本アプリ `margin-bottom:9px`／`gap:6px`）でリズムを作る。Sunsama の「calm な余白多めの timeline」が示すとおり、**詰め込みすぎず・空けすぎず**が上質さの肝。出典: [Sunsama レビュー（calm minimalist timeline）・davidlykhim](https://davidlykhim.com/sunsama-review/)／[Sunsama Daily Planning](https://www.sunsama.com/daily-planning)。
  - **本アプリ適用**: 比例高さは維持しつつ、給水・ダウン等の短い枠は min-height で潰さず、主役ブロックとの「大小のリズム」を作る。中央時計スパインのdot＋クロックレールは現行の良さなので保持。
- **「今日の山」を一目で**: 週から日へ降りる導線で、type sizing と color weight で当日/重要ブロックを立てる（過度な装飾なし）。出典: [Eleken](https://www.eleken.co/blog-posts/calendar-ui)。

---

## まとめ（実装着手者への要点）
- **週レベル**は「縦=時刻軸（等幅数字ガター）/ 横=平日5列」の time-grid に作り替え、**Notion Calendar 作法**（1px・9%罫線／等幅数字／タイポのコントラストで階層／純黒を避ける）で組む。配置は **CSS Grid の名前付きグリッド線方式**（`grid-row: time-1605 / time-1645`）。
- **土曜×平日の混在**は **案A（共通の縦時刻軸1本・尺を全列固定）＋未使用帯の圧縮バンド畳み込み**で扱う。「全日24h均等割り」も「列ごとに尺を変える案B」も採らない（前者は空白で破綻・後者はGoogleカレンダー的な認識性を壊す）。開始時刻が日で違うことは列ヘッダーに明示して正面から見せる。
- **日レベル**は採用済みの比例タイムラインを維持し、細い `--orange` の現在時刻ライン・等幅時刻・カード間リズムで洗練。
- 色は足さない。`--orange` はアクセント1点。階層は size/weight/mute/opacity と余白で作る。これがそのまま Hallmark NG 回避になる。

---

## 出典一覧
- [Notion Calendar〔旧Cron〕デザイン解説（タイポ比5.3:1・1px9%罫線・等幅ガター・純黒回避・暖色サーフェス）・blakecrosley.com](https://blakecrosley.com/guides/design/notion-calendar)
- [Google Calendar 日/週/月ビュー（共通左ガター方式の標準形）](https://support.google.com/calendar/answer/6110849?hl=en&co=GENIE.Platform%3DDesktop)
- [Domo・Calendar Chart（セクション独立スケールは誤読を生む＝案Bを退ける根拠）](https://www.domo.com/learn/charts/calendar-chart)
- [Building a Conference Schedule with CSS Grid（名前付きグリッド線でのイベント配置）・CSS-Tricks](https://css-tricks.com/building-a-conference-schedule-with-css-grid/)
- [FullCalendar TimeGrid View（slotMinTime/slotMaxTime・活動窓クランプ）](https://fullcalendar.io/docs/timegrid-view)
- [FullCalendar Date & Time Display（scrollTime・最初のイベントへスクロール）](https://fullcalendar.io/docs/date-display)
- [FullCalendar Now Indicator（現在時刻ライン）](https://fullcalendar.io/docs/now-indicator)
- [DayPilot 現在時刻ハイライト](https://doc.daypilot.org/calendar/highlighting-current-time/)
- [Google Calendar・朝/夜の時間帯を隠す（灰色シェード帯＋"time–time"表示＋クリック展開＝共通軸のまま collapse）・gilsmethod](https://gilsmethod.com/hide-morning-night-hours-google-calendar)
- [Google Calendar Community・hide morning and night hours](https://support.google.com/calendar/thread/12594571/how-do-i-hide-morning-and-night-hours-cant-find-the-labs-section-in-settings-is-it-removed?hl=en)
- [CIO・Google Calendar power tips（時間帯非表示）](https://www.cio.com/article/2395284/5-google-calendar-tips-and-tricks-for-power-users.html)
- [BusyCal Week View（週ビューで統一時刻ルーラー1本維持のまま collapse・overlay hint）](https://www.busymac.com/docs/busycal/70588-week-view/)
- [BusyCal Day View（Working Hours collapse・空白時間の畳み）](https://www.busymac.com/docs/busycal/70587-day-view/)
- [The Events Calendar Schedule Day View（inactive slot collapse）](https://theeventscalendar.com/extensions/schedule-day-view/)
- [Stratifi Creative・カレンダービューのUX問題（疎ならグリッドに固執しない）](https://stratificreative.com/blog/the-problem-with-calendar-views-how-to-improve-ux-on-your-events-page/)
- [ui-patterns・Event Calendar パターン](https://ui-patterns.com/patterns/EventCalendar)
- [Calendar UI Examples: 33 Inspiring Designs・Eleken（色＋長さ＋アイコンで category/duration/status／現在を立てる）](https://www.eleken.co/blog-posts/calendar-ui)
- [Calendar UI design best practices・setproduct](https://www.setproduct.com/blog/calendar-ui-design)
- [Best calendar app designs・Justinmind（Google Calendar 週ビュー骨格）](https://www.justinmind.com/ui-design/best-calendar-app-designs-how-prototype)
- [Notion Calendar vs Fantastical・bricxlabs（Fantastical の subtle shadow/border で深さ）](https://bricxlabs.com/blogs/calendar-ui-examples)
- [Sunsama Daily Planning（calm な timeline・余白）](https://www.sunsama.com/daily-planning)
- [Sunsama レビュー・davidlykhim（minimalist calm UI）](https://davidlykhim.com/sunsama-review/)
- [Snook.ca・Calendar with CSS Grid（比例配置の実装参考）](https://snook.ca/archives/html_and_css/calendar-css-grid)
- [Zell Liew・How to build a calendar with CSS Grid](https://zellwk.com/blog/calendar-with-css-grid/)
