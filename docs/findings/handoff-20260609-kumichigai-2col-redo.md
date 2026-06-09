# 引継資料: 組違い表示の作り直し（男女左右2列＋コーチ付き左右ずれ）（2026-06-09）

> この資料は `docs/findings/handoff-20260609-gender-teams-season-rebuild.md` の続き。前資料の「年/月シーズン構造の作り直し」は本セッションで完了済み（年=2山・夏は山でない・女子1ヶ月先行は実装済み）。本セッションはエンジンの正しさ修正（ダウン誤分類・代替候補）と、組違いモデルの作り直しを進めたが、**UIの「日」レベルの見せ方がオーナー差し戻し（最終）で未完了**。次セッションの最優先は1つだけ：**日レベルを「男子＝左列・女子＝右列の2カラム」にして、組違い＝コーチ付き段が左右でずれるのをメニュー上で直接見せる**。

---

## 概要

### このセッションで達成したこと
コーチが配る練習メニューの「中身の正しさ」を3点根治した：①ダウン（クールダウン）に動的ウォームアップ系ドリルが混入する誤分類、②「いずれか」代替候補に実形態の違うドリル（走る2人組ドリルの代替に1人その場ドリル）が出る粗さ、③男女で練習メニューが別物になっていた問題（コーチ1人の負担を増やす逆方向の実装）。あわせて組違い（体育館共有・コーチ1人で男女2チームを回す段取り）を「同じメニューのコーチ付き段だけ男女でずらす」モデルに作り直した。

### なぜやったか
オーナー差し戻しが本セッション中に連続した。差し戻しの核は「コーチは1人。だから男女は同じメニューで、違うのは『いつコーチが付くか』だけ。組違い＝コーチ付きの時間帯を男女でずらすこと（同時刻にコーチ付きが両方に付くのは物理的にあり得ない）」という運用実態。エンジン側の正しさ（ダウン・代替）も同じ差し戻しターンで指摘された。

### 最終差し戻し（未対応・次セッション最優先）
オーナー最終指摘（原文の趣旨）：「ふつう左と右に男女するだろうが」「これのどこが組違い表現してるの」「（1列メニューは）見づらい」。
→ 現状UIは「男女共通メニューを1列で表示＋別枠に組違いの説明パネル」。これがオーナーの想定（男女を左右2列に並べ、同じ時刻の行で左右どちらか片方だけコーチ付き＝組違いが一目で分かる）と違う。**次セッションは現状の1列＋別枠パネルを捨て、男女左右2列でコーチ付きの左右ずれを直接見せる形に作り直す。** 詳細仕様は「次セッションへの引継指示」に記載。

---

## 実装した機能

### A. ダウン誤分類の根治（コミット 1ee50d4・確定資産）
**問題**: ダウン（CDブロック）にキャリオカステップ・フロントキック（動的ウォームアップ可動）が入っていた。
**根因**: カタログ（`docs/practice-knowledge/data/drills.json`）に整理運動（静的ストレッチ・呼吸・リカバリ）専用ドリルが1件も無く、CD適格判定 `isCoolDownEligible` が「動的WUを除外しきれない消去法」だったため、ウォームアップ用ドリルがCDに残っていた。
**修正**:
- カタログに整理運動ドリル3件追加（CND-026 静的全身ストレッチ／CND-027 深呼吸・心拍鎮静／CND-028 フォームローラー リカバリ）。`philosophy_tags` に「クールダウン」「整理運動」、`sub_skill` を静的語、`intensity_class` 低、`duration_min` 2〜3、`source_kind` team_original。
- `engine/src/allocate.js` の `isCoolDownEligible` を消去法→**肯定判定**へ反転（クールダウンタグ または 静的リカバリ系 sub_skill `/静的|整理|鎮静|呼吸|クールダウン|筋温|リカバリ|筋膜/` を持つものだけ適格）。
- WUプール生成に `&& !isCoolDownEligible(d)` を追加し、整理運動をウォームアップから除外（WU/CDを分離）。
- 実機確認: 火・土とも CD=整理運動のみ（キャリオカ/フロントキックは WU へ正しく移動）。

### B. 代替候補の形態考慮（コミット 1ee50d4・確定資産）
**問題**: ツーメン（2人組で走るフィニッシュ）の「いずれか」代替にマイカンドリル（1人その場のゴール下連続）が出ていた。
**根因**: 代替候補が「同一category の兄弟をフラットに並べた次の項目」で、人数・コート・狙いを見ていなかった。正規化後の Drill は people/balls を捨てていた。
**修正**:
- `engine/src/normalize.js` に `normalizePeopleShape(raw)` 純関数を新設し、Drill に `peopleShape`（solo/pair/small/team/group）と `peopleRaw`・`needs_helper` を追加。`engine/src/types.js` の Drill typedef も更新。
- `engine/src/allocate.js` に `alternativeAffinity(primary, cand)` 純関数（peopleShape一致+3／court一致+2／sub_skill主眼トークン共有+1／needs_helper一致+1）を追加し、`pickSegmentDrill` の alternatives を affinity 降順→既存安定順で並べ替えてから上位2件採用。
- 実機確認: ツーメンの代替がコンタクトスルー フィニッシュ等（pair・フィニッシュ）になり、マイカン（solo）は外れた。

### C. 男女共通メニュー＋組違い（コーチ付き段ずらし）（コミット d7ae2b4・UIは要作り直し）
**問題（差し戻し）**: ①男女でドリルが別物だった（コーチの負担増）。②組違いが「同時刻に男女両方コーチ付き」になっていた（コーチ1人なのに矛盾）。
**修正（ロジックは正しい・見せ方が未完了）**:
- 一度入れた「男女別ドリル選定（team_id シードで categoryCandidates のソートを割る）」を**撤回**し、`allocate.js` のソートを元の `duration_max desc → id` に戻した。これで男女は同じ catalog・同じ重みなら同じメニュー。
- `ui/plan-data.mjs` を全面書き換え：練習メニューは**男女共通の1本**（`buildSession`、暦月基準で1回 planWeek）。組違いは `deriveCoachSplit(day)` で「コーチ付き段を前半=片方/後半=入れ替え、自走段は男女同時」に導出（同時刻にコーチ付きは必ず片方・先攻は段ごと男女交互）。
- `ui/render-shared.mjs`：組違いパネル（`interactionPanel`/`coachSplitBody`）・目標（共通＋男女別KPI）・年（2山＋男女いまマーカー）・月（共通主眼）を共通部品化。
- コーチ不在日（水木）は全段を自走表示（`displayMode` で `coach_present===false → 'self'`）。
- **未完了**: 日レベルが「1列メニュー＋別枠の組違いパネル」。オーナーは「男女左右2列＋コーチ付き左右ずれ」を要求。→ 次セッション最優先。

### D. 組違いエンジンの退役（コミット d7ae2b4）
旧「1コーチ・2グループ・同一メニュー・コーチ付き段ローテ」を engine の `weekday_groups`（`engine/src/groups.js`・`planWeek.js` の post-pass・`format.js` の組違い週次表）として持っていたが、組違いはUIプレゼン層で導出する方針に一本化したため engine から退役（`groups.js`・`groups.test.js` 削除、`planWeek.js`/`format.js`/`types.js` から weekday_groups 除去、`lecture-timeline.test.js` の weekday_groups 参照を day ブロック検証に置換）。
**注（次セッション要検討）**: しんたろうさんの最終的な組違い像（同一メニュー・コーチ付き段ずらし・男女2グループ）は、退役させた groups.js の rotation モデルと本質が同じ。UI で2列ずらしを実装する際、groups.js のローテ知見（要監督ドリルを無監督でやらせない不変条件）を参照してよい（git で `engine/src/groups.js` の旧版を `git show 0bf06ac:engine/src/groups.js` で復元参照可能）。

### 主要ファイル
| ファイル | 役割 |
|---|---|
| `engine/src/allocate.js` | 段割当。`isCoolDownEligible`（肯定判定）・`alternativeAffinity`・`categoryCandidates`（seed撤回済み）。 |
| `engine/src/normalize.js` | `normalizePeopleShape` ＋ Drill に peopleShape/peopleRaw/needs_helper 追加。 |
| `engine/src/types.js` | Drill typedef に peopleShape 等追加、Plan から weekday_groups 削除。 |
| `engine/src/planWeek.js` / `format.js` | 組違い（weekday_groups）退役。 |
| `docs/practice-knowledge/data/drills.json` | 整理運動ドリル3件追加（全214件）。 |
| `engine/data/config.sample.json` / `config.girls.sample.json` | 単独チーム（shared_gym:false）・CLIフォールバックphase。 |
| `ui/plan-data.mjs` | **単一データソース**。男女共通メニュー1本＋組違い導出（`buildSession`/`deriveCoachSplit`/`buildDays`）。**次セッションの主改修対象**。 |
| `ui/render-shared.mjs` | 共通描画基盤（組違いパネル・目標・年/月・トグル・トンマナ）。**2列化で改修**。 |
| `ui/pattern-{timeline,board,handout}.mjs` | 3つの見せ方。timeline が採用案。**日レベルを2列化で改修**。 |
| `ui/build.mjs` | ビルダー。`node ui/build.mjs` で `ui/*.html` 生成（.gitignore済み）。 |

---

## コミット一覧（main・全てローカル未push）
| ハッシュ | 内容 | 状態 |
|---|---|---|
| d7ae2b4 | refactor: 練習メニューを男女共通1本＋組違い(コーチ付き段ずらし)へ・組違いエンジン退役 | 本セッション・未push |
| 1ee50d4 | feat(engine): ダウン誤分類を根治・代替候補を形態考慮に | 本セッション・未push |
| 0bf06ac | feat(engine): 年間計画を原典接続・男女別チーム化の土台 | 前セッション・未push |
| 370e4bb | docs(handoff): 段モデル化とUI3見せ方の引継資料 | 前セッション・未push |
| 60b37dd | feat(ui): 練習計画UIを配布ドキュメント型の3見せ方で再構築 | 前セッション・未push |
| 212c25d | feat(engine): 練習計画を段モデルに再設計 | 前セッション・未push |

ブランチ `main` は origin/main より上記6コミット先行（全てローカル未push）。push は push前レビュー（`/security-review`＋`/code-review` high）＋オーナー承認の後にまとめて行う。

---

## 本番稼働状況
- 本番デプロイ・Function・Secret Manager 変更: **なし**（UIは静的HTML生成のみ・エンジンはローカルCLI）。
- リモートpush: なし（ブランチ全体がローカルのみ）。

## 動作確認済み項目
**形式整合層（機械検証）**:
- engine 全テスト 118 PASS（`engine/` で `node --test`）。
- `node ui/build.mjs` 成功（3パターン＋index.html 生成）。
- `node engine/bin/plan.js`（男子・女子両config）成功。
- Hallmark grep（border-left色帯・gradient・background-clip・汎用書体 Inter/Roboto/Open Sans）実体検出ゼロ。

**意味価値層（主体の実画面目視）**:
- ダウン=整理運動のみ・代替が形態近い・コーチ不在日は全自走・組違いONでコーチ付きが同時刻に重ならない・メニューが男女共通、を headless Chrome（`chrome.exe --headless=new --screenshot`）で目視確認済み。
- **ただしUIの日レベルの見せ方（1列＋別枠パネル）はオーナー差し戻しで不合格**。意味価値層の最終サインオフは未取得。

---

## 既知の注意点・未対応項目
1. **【最優先・差し戻し】日レベルが男女左右2列でない**。下記「次セッションへの引継指示」参照。
2. コート割り（男女どちらが左/右半面・どの曜日に合同/分離）は原典（`docs/practice-knowledge/reference/チーム基本情報.md` L43）に明記なし＝暫定。2列化でも「片面A/B」等の中立表記か、オーナー確認で確定。
3. 土曜=全面・合同（together）・コーチ在席は仮置き。組違いONの土曜を「合同」のままにするか要確認。
4. ドキュメントの「211件」表記（`engine/DESIGN.md` L17/50/54・`README.md`・`engine/src/normalize.js` コメント・各testコメント）はカタログ214件に未更新（テストのアサーションは更新済み）。push前に一掃推奨。
5. 実選手データ未接続（合成値）。Drive「バスケ_選手名簿」はPIIでオーナー受領後。

---

## 開発中に得た教訓
1. **組違いの中核UI概念を3回連続で外した**（①男女別メニュー→「メニュー変えるな」②同時刻コーチ付き2つ→「コーチ1人だろ」③1列＋別枠→「左右2列にしろ」）。
   - **何が起きたか**: オーナーの「組違い」要求の全体像（男女2列・同一メニュー・コーチ付きが左右でずれる）を、毎回部分的にしか捉えず、実装してから差し戻された。
   - **再発防止**: 中核UI概念は、コードを書く前に「1例の具体表（行＝時刻、左列＝男子のmode、右列＝女子のmode）」をオーナーに見せて挙動を確定してから実装する。前回 handoff-20260606 の教訓「中核概念は実装前に1例で挙動を確定してから渡す」の再発であり、UX前提（ふつう男女は左右に並べる）も独断で省略しないこと。
   - **反映先候補**: Wasurenagusa（プロジェクト固有寄り）＋ 既存記憶 `提案の核を制約発言で逆方向に倒さない` の強化候補。
2. **「ちゃんとしたデータ＝中身の業務妥当性」を都度自分で実出力目視する**（feedback_practice_planner_redo 教訓3の再確認）。ダウン・代替の誤りは headless Chrome 目視で初めて確証できた。テスト緑・grepゼロだけでは中身の妥当性は担保されない。

---

## 次セッションへの引継指示

優先順（上が高い）:

### 1.【最優先】日レベルを「男女左右2列＋コーチ付き左右ずれ」に作り直す
オーナー差し戻しの本丸。**現状の「1列メニュー＋別枠の組違いパネル」を捨てる。**

**確定仕様（オーナー指示から確定）**:
- 日レベルは **男子＝左列・女子＝右列の2カラム**。
- メニューは **男女共通**（同じドリル・同じ時刻・同じ段が両列に並ぶ）。
- 各段の「コーチ付き／自走」タグを **左右で出し分ける**:
  - 自走段（baseMode self）・WU/CD（bundle）: 両列とも自走。
  - **コーチ付き段（baseMode practice/lecture）: 段ごとに男女交互**。i番目のコーチ付き段 → i偶数: 男子=コーチ付き・女子=自走／i奇数: 男子=自走・女子=コーチ付き。
  - これで「同じ時刻の行で、左がコーチ付きなら右は自走」＝組違いが2列で一目。コーチ付きは同時刻に必ず片方だけ。
- 組違いON: 上記の左右ずらし。組違いOFF: 両列とも baseMode（別時間想定でコーチが全段に付く）。

**実装の進め方（着手済みの方向）**:
- `ui/plan-data.mjs`: 各 day の各 item に `boysMode`/`girlsMode`（組違いON時の左右mode）を付与する。`deriveCoachSplit` の交互割当ロジック（コーチ付き段に通し番号 ci を振り ci%2 で先攻を男女交互）をそのまま「item へのmode付与」に転用する。`baseMode`（=現 `mode`）はOFF時の両列共通。
- `ui/render-shared.mjs`: 2列ラッパ（男子/女子の `teamColumns` 相当）を復活させる。各段の mode タグを ON/OFF・列ごとに出し分ける（`<span data-interact="on">…boys/girlsMode…</span><span data-interact="off" hidden>…baseMode…</span>` を既存 setMode 機構で切替）。別枠の組違いパネル（`interactionPanel` の rotation 部分）は2列が表現するので簡素化または廃止し、上部には短い説明1行（「同じ時刻で左右どちらか片方がコーチ付き＝組違い」）に留める。
- `ui/pattern-{timeline,board,handout}.mjs`: 日レベルを2列に。各パターンの段描画スタイル（timeline=比例タイムライン、board=比率バー+段、handout=文書行）は維持しつつ、左右2列に並べる。timeline が採用案なので最優先で仕上げる。
- 参考: git に2列teamColumnsの旧版がある（`git show 0bf06ac:ui/render-shared.mjs` の `teamColumns`、`git show 0bf06ac:ui/pattern-timeline.mjs`）。ただし旧版は「男女で別メニュー」だったので、**メニューは共通・modeだけ左右で出し分け**に読み替えること。

**完了条件**:
- 日レベルが男子左・女子右の2列で、同じメニュー（同じドリル）が並ぶ。
- コーチ付き段が同じ時刻の行で左右どちらか片方だけに付き、次のコーチ付き段で左右が入れ替わる（コーチ付きが同時刻に両列同時に出ない）。
- 組違いON/OFFトグルで、ON=左右ずれ／OFF=両列コーチ付き（別時間）に切り替わる。
- 3パターンとも `node ui/build.mjs` が通り、headless Chrome で2列・左右ずれを目視確認（テスト緑・grepゼロだけで合格にしない）。
- **着手前に**、火曜の1例を「行＝時刻、左列=男子mode、右列=女子mode」の表でオーナーに見せて挙動合意を取ってからコードを書く（教訓1）。

### 2. push前レビュー＋main push（オーナー承認後）
タスク1完了・オーナー意味価値層サインオフ後に、`/security-review`＋`/code-review`（high）→指摘反映→`git push origin main`（push はオーナー確認）。ドキュメントの「211件→214件」表記一掃もこのタイミングで。

---

## 注意・PII
- 本資料の参照は全てリポジトリ相対パス。個人ホーム配下の絶対パス・本名・実選手値は書いていない。
- 生成HTML（`ui/*.html`）は `.gitignore` 済み（再生成=`node ui/build.mjs`）。
- 実選手データは未接続・合成値。
