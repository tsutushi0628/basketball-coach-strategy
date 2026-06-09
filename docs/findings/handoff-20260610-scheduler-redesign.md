# 引継資料: 練習計画UIをスケジューラー型に刷新（2026-06-10）

> この資料は `docs/findings/handoff-20260609-timeline-2col-spine.md` の続き。前資料の最優先「年の"いま"の男女ずれ」は本セッションで根治済み。前資料の積み残し（コーチ目線サインオフ／board・handout の扱い／push前レビュー＋push）のうち、本セッションでサインオフ準備・push前レビューまで完了し、**残るオーナー判断は2つ（push承認／board・handout 一本化）だけ**。

---

## 概要

### このセッションで達成したこと
コーチが配る練習計画UI（採用パターン＝タイムライン型）を、オーナーから「生成AI丸出しのゴミ」と酷評された状態から、世の中の優れたスケジューラー（Googleカレンダー／Notion Calendar 等）の作法を取り込んだ「本物のスケジューラー型」に作り直した。コーチが週を開くと、縦＝時刻・横＝曜日の見慣れたカレンダーで一週間を俯瞰でき、日を開くと中央の時計レールが男女どちらのカードも貫かない2列タイムラインで「誰がいつコーチ付きか」を読める。年タブの「男女の現在位置がずれる」論理矛盾も消えた。

### なぜやったか
オーナーが実画面を見て3点を具体的に酷評した: ①日タイムラインで中央の時計レールが男女同一メニュー（ダイナミックストレッチ等）のカードの真ん中を貫いていて不自然、②週ビューが非標準の「日別の縦積み棒」でカレンダーに見えない（「Googleカレンダーみたいにすべき・優れたスケジューラーを調査してパクれ」）、③年タブで「いま」が男子8月・女子9月とずれていて論理破綻。オーナーが就寝するため「チームでレビューを回して確認待ちせず完璧に」の指示（team-go）で自走した。

---

## 実装した機能

### A. 日タイムライン: 中央レールがカードを貫かない男女2列
- `ui/pattern-timeline.mjs` の `rotationTimeline` の `together` 行（WU/主自走/CD＝男女同一メニュー）と end 行を、左右2列ミラー（同一内容を男子列・女子列の両方に表示）に変更。中央の時計レールが必ずカードとカードの「間」を通る構造にした。
- 左右カードは中央向きの角だけ角丸を落として1本の帯に繋がって見せ、帯上端中央に「両チーム共通」マーカーを1つだけ置く（左右で2回ラベルしない）。
- 中央レールを 2px の濃い線 → 1px・不透明度9%の極薄罫線（新トークン `--hair`）に。時刻ピルに `tabular-nums`。練習時間帯のみ表示・印刷非表示の現在時刻ライン（`.nowline`/`.nowpill`）を追加（作法は Notion Calendar 系）。
- rotation 行（コーチ段の前後半swap）は不変。

### B. 週レベル: Googleカレンダー型の共通時刻軸グリッド（縦棒ガントを全廃）
- `ui/pattern-timeline.mjs` の `weekLevel` を全面置換。CSS Grid（`52px repeat(5,1fr)`）で「左に共通時刻ガター1本＋5練習日（火水木金土）列」。**全列が同じ px/分 スケールを共有**（＝カレンダーに見える識別特徴）。
- 時間軸はデータ導出（ハードコード禁止）: `buildWeekAxis(days)` が全曜日の `blocks[].from/to` から稼働帯の和集合をクランプ（土の午前帯 09:00〜11:43 ∪ 平日の夕帯 16:05〜17:45）し、最大未使用ギャップ（≈11:43〜16:05）を1本の「練習なし」ブレイクに畳む（BusyCal/The Events Calendar/Google カレンダー自身の inactive-hours collapse 作法）。
- イベントは `top=開始オフセット`・`height=所要px`（`axisY`/`blockRect`）。週グリッドの尺は overview 用に `PX_PER_MIN=2.0`（日タイムラインの 3.6 とは別物で良い・週は俯瞰なので低めが正）。
- 各列ヘッダにその日の開始〜終了と回し方（組違いローテ／コーチ不在／男女合同）を明示。組違い日（火・金）は週では男女共通の流れを1列で見せ、男女左右内訳は日タブ側に置く（週＝俯瞰／日＝精細）。

### C. 年「いま」の男女ずれ根治（最優先バグ）
- `ui/plan-data.mjs` の `year.currentBoys`/`currentGirls` を両方 `currentMonth`（=暦月そのまま・8月）に直指定。原因は `resolveMonth('女子')` が `_gender_offset`（女子1ヶ月前倒しモデル）で arcMonth=9 を返していたこと。`arcMonth` は「暦月+性別offsetを巻いた arc 上の位置」であって表示すべき暦月ではない、と確認。`_gender_offset`・engine データは残置（最小スコープ・「いま」表示から完全に消える）。
- 「女子1ヶ月先行」の未確認前提を全可視テキストから撤去（`ui/render-shared.mjs` の `yearSection` 注記・凡例、`monthSection` 注記、`plan-data.mjs` の assumptions）。男女2行は構造として残す（今は同内容）。大会の時期の男女差は未確定として表示に出さない。

### 主要ファイル
| ファイル | 役割 |
|---|---|
| `ui/pattern-timeline.mjs` | 採用パターン。`rotationTimeline`（together/end の2列ミラー＋bothmark）・`weekLevel`（週カレンダーグリッド全面置換）・`buildWeekAxis`/`axisY`/`blockRect`/`gutterTicks`（共通軸ユーティリティ・データ導出）・`PATTERN_CSS`（`.weekgrid`系・`.spine-together`系・`.nowline`）。 |
| `ui/plan-data.mjs` | 単一データソース。`year.currentBoys/currentGirls` を currentMonth 直指定（年いま根治）・assumptions の女子先行表現を中立化。 |
| `ui/render-shared.mjs` | 共通トークン/描画。`--hair` トークン追加・`yearSection`/`monthSection` の女子先行注記撤去・凡例を「いま（N月・男女共通）」1本に統合。 |
| `ui/rotation.mjs` / `ui/rotation.test.js` | 組違い導出（純関数）と回帰テスト。**本セッション不変**（時間不変条件 rows合計==窓 throw を維持）。 |
| `docs/findings/research-20260609-scheduler-ux.md` | UX調査（優れたスケジューラーの採用作法・出典18件）。 |
| `docs/findings/spec-20260609-scheduler-redesign.md` | 再設計仕様（週軸=案A確定・年いま根治・together確定・Code Reuse・タスクT1-T7）。 |
| `ui/pattern-board.mjs` / `ui/pattern-handout.mjs` | **未改修の旧デザイン**（border-left 色帯を含む）。下記「未解決の判断点」参照。 |

---

## コミット一覧（ブランチ main・全てローカル未push）
| ハッシュ | 内容 |
|---|---|
| 2dd4b05 | docs(findings): スケジューラーUX調査と練習計画UI再設計仕様 |
| 1057a90 | feat(ui): 練習計画を本物のスケジューラー型に刷新（中央線非貫通の男女2列・週Googleカレンダー型・年いま根治） |
| cb0538c | chore: QA足場（Playwright依存・QA検証スクリプト・スクショ用一時HTML）をgitignore |

> ブランチ `main` は origin/main より上記＋前セッション群（fbaa759 ほか）が大幅先行。**ブランチ全体がローカル未push**（このプロジェクトの既定運用）。push は本セッションでも未実施（オーナー承認待ち）。

---

## 本番稼働状況
- 本番デプロイ・Cloud Functions・Secret Manager 変更: **なし**（UIは静的HTML生成・エンジンはローカルCLI）。
- リモートpush: **なし**（ブランチ全体がローカルのみ）。

---

## 動作確認済み項目

**形式整合層（機械検証・メイン自身で再実行）**:
- `node ui/build.mjs` 成功。エンジンテスト 118/118 緑。`ui/rotation.test.js` 11/11 緑。
- hallmark 実体grep（`pattern-timeline.mjs`/`render-shared.mjs`）: side-stripe色帯・汎用書体(Inter/Roboto/Open Sans)・gradient・background-clip・emoji いずれも検出ゼロ（border-left は1pxの列罫線のみ・"inter"ヒットは全て `cursor:pointer`/`pointer-events` の部分一致誤検出）。
- 可視テキストの「女子先行」「専門語（アーク/主眼/原典等）」: 撤去済み（残存は非表示コードコメントと対象外の board/handout のみ）。
- push前レビュー: `/code-review high` 実施。致命バグゼロ。指摘4件のうち①週グリッドの曜日→列ハードコード（`DAY_COL`）を days 並び順導出へ修正・④週グリッドの coach 判定に lecture を含める修正を反映。②③（end行の死にCSS・時刻ユーティリティ重複）は無害につき記録のみ。`/security-review` は静的HTML生成・新たな認証/データ/通信/秘密値なし・全動的文字列esc済みのためスキップ。

**意味価値層（メイン自身の実画面目視＋QA独立検証）**:
- メイン（PdM）が headless Chrome で day/week/month/year の実画面を直接目視: ①中央線が together カードを貫かない②週が共通ガター1本のGoogleカレンダー型（土午前・平日夕・畳みブレイク）③年タブで男子いま・女子いまが同じ8月セルに揃い「女子先行」可視テキスト無し④月タブに女子先行注記無し、を確認。スクショ `e2e/screenshots/impl-day.png`/`impl-week-v2.png`/`impl-month.png`/`impl-year.png`（gitignored・再生成可）。
- qa-tester 独立QA PASS（タブ切替・組違いON/OFFトグル・印刷・コピー・端状態（火/水/木/金/土）・モバイル430/480px・hallmark回帰・年いま回帰、全項目PASS）。
- **オーナーの意味価値層サインオフは未取得**（オーナー就寝中につき report 済み・起床待ち）。

---

## 未解決の判断点（オーナー側アクション待ち）

### 1. push 承認
- **待ち先**: オーナー判断。
- **背景**: 本セッションの3コミット＋ブランチ全体がローカル未push。push前レビュー（コード品質）は完了済み。push は CLAUDE.md でオーナー承認案件。
- **決まったら**: `git push origin main`。CI/workflow 変更は無いので scope 問題は無し。

### 2. 見せ方を timeline 一本化するか、board/handout も残すか
- **待ち先**: オーナー判断。
- **背景**: 採用は timeline 型だが、`ui/pattern-board.mjs`・`ui/pattern-handout.mjs` は旧デザイン（border-left 色帯を含む＝オーナーが嫌うAIっぽい意匠）のまま `node ui/build.mjs` で `index.html` のチューザーに3つとも出る。timeline だけが今回刷新済み。
- **決まったら**: 一本化なら board/handout の `.mjs` 削除＋`index.html` チューザー文言調整（メイン推奨）。3つ残すなら board/handout も今回の作法（hallmark準拠・スケジューラー化）に合わせて再設計（別タスク・規模大）。

### 3. 大会の時期の男女差
- **待ち先**: コーチ（オーナー）確認。
- **背景**: 「女子1ヶ月先行」は未確認の思い込みだった。男女で大会日程が実際にずれるかは未確定。現状は「今は男女同じ」で安全側表示。
- **決まったら**: 実際の差が判明したら、年/月の表示にそれを反映する設計を入れる（`_gender_offset` を表示に効かせるか別モデルにするかを再設計）。

---

## 議論再開ポイント（次セッションのキャッチアップ）
1. 5分: 本資料を読む。
2. 10分: `node ui/build.mjs` → `ui/pattern-timeline.html` をブラウザで開き、日タブ（中央線がカードの間・現在時刻ライン）・週タブ（共通ガター1本のカレンダー・畳みブレイク）・年タブ（男女いまが同じ8月）を実画面で確認。スクショは `e2e/screenshots/impl-*.png`。
3. 設計詳細は `docs/findings/spec-20260609-scheduler-redesign.md`、UX調査の作法は `docs/findings/research-20260609-scheduler-ux.md`。

---

## 開発中に得た教訓
1. **週ビューは「Googleカレンダー型＝共通時刻ガター1本で全列が縦位置=時刻で揃う」が要件**。設計途中で「列ごと可変ミニ軸」案が出たが、これは"同じ見た目が違う量を表す"アンチパターンでカレンダーに見えない。土曜09:00と平日夜帯の窓差は「共通軸をクランプ＋未使用帯を畳む」（Googleカレンダー自身の作法）で解消するのが正。**再発防止**: スケジューラー系UIは見慣れた標準パターンに寄せる（独自軸を作らない）。**反映先**: ファイル記憶（basketball）。
2. **「左右に分ける」要求は既存デザインを保ったまま分割と解釈**。男女同一メニューでも2列に割れば中央線がカードを貫かない。核（比例タイムラインの雰囲気）は壊さず構造だけ直す。**反映先**: 既存記憶 `提案の核を制約発言で逆方向に倒さない` と同根（既反映）。
3. **静的モックは「コードで分数照合OK」だけで完了報告しない・実描画を必ず目視**。週モック初稿は top/height の算術は合っていたが、CSS Grid の自動配置バグ（fixed row + 列未指定）で全列が右端に潰れて崩れていた。メインが headless Chrome で撮って初めて発覚。**再発防止**: ビジュアル成果物は形式整合（算術/grep）と実描画目視を分け、後者を通すまで完了にしない（行動原則7と同根）。**反映先**: 行動原則7（既存・強化不要）。
4. **PowerShell の `Get-Content`/`Set-Content` は UTF-8（BOM無し）を cp932 で誤読し文字化けする**。HTML 等 UTF-8 ファイルを round-trip（タブ別スクショ用の一時HTML生成等）するときは `[System.IO.File]::ReadAllText`/`WriteAllText` を使う。**反映先**: ファイル記憶（Windows環境差分）。

---

## 次セッションへの引継指示（優先順）

### 1.【最優先・オーナー判断待ち】push 承認の確認 → push
オーナーに push 可否を1問確認 → 承認なら `git push origin main`。

### 2.【オーナー判断待ち】見せ方の一本化判断
timeline 一本化（board/handout 削除）か3つ維持かを1問確認。一本化なら board/handout の `.mjs` を削除して `node ui/build.mjs` で再生成・`index.html` 文言調整。

### 3. オーナーの意味価値層サインオフ受領
実画面（`ui/pattern-timeline.html` or スクショ）をオーナーに見せ、3点（線・週・年いま）が要求どおりかサインオフを取る。差し戻しがあれば該当箇所を直す。
