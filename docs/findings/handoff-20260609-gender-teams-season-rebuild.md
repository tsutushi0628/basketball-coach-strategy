# 引継資料: 男女別チーム化＋シーズン構造の原典接続・全面作り直し（2026-06-09・継続）

> この資料は `docs/findings/handoff-20260609-segment-model-ui.md`（段モデル化とUI3見せ方）の**続き**です。前資料の「未解決＝年/月のシーズン構造が誤り」へのオーナー強い差し戻しを受けて、根本から作り直しに着手したセッションの引き継ぎ。前資料のコミット（212c25d / 60b37dd / 370e4bb）はローカル未pushのまま継続します。

---

## 1. 概要（このセッションで何が起きたか）

前セッションの年/月レベル（シーズン構造）に対してオーナーから強い差し戻し（「全然だめ」「コーチの立場で使い物になるか考えろ」）を受け、3点の根本欠陥（①年/月が原典未接続のでっち上げで山も逆 ②男女が「1チーム内2レーン」で同一メニュー＝別チーム別計画になっていない ③組違いが前提固定でモード化されていない）を直すため、**原典（年間計画.md／チーム基本情報.md）を真実源に据え直す土台**を作った。完了したのはエンジン側の土台（年間計画の原典 encode＋解決用純関数＋女子チーム用サンプル）まで。**UIとプレゼン層（`ui/` 配下）は旧版のまま未着手**で、メイン側のツール形式不具合により実装が途中で止まっている。次セッションは `ui/` の全面書き換えが最重要対象。

---

## 2. オーナーの差し戻しと確定要件（最重要・先に読む）

前セッション成果に対するオーナーの差し戻しは以下の4点。これは**確定要件**として全実装の判断基準にする。

1. **年/月が原典未接続のでっち上げで、山が逆だった**
   旧 `ui/plan-data.mjs` の `buildYearBands()` は「夏の大会（6〜7月）を peak=true」として山に置いていた（同ファイル現行L73-83 を参照）。原典では夏の大会（中野区選手権→都選手権）は**前の代＝現3年の集大成で、本計画の対象外＝新チームにとっては山ではなく出発点**。新チームの山は「冬の新人大会」と「翌夏の中体連」の2つ。**山の置き方が逆**だった。`current_month`＋一般論で仮置きしたのが原因。

2. **男女は別チーム＝別計画。常に男子分・女子分を両方出力すべき**
   旧実装は **1つの男子チーム（`config.sample.json` の `team_id: minami-nakano-boys`）の中に `groups: ["男子","女子"]` を持たせ、同一の日次メニューを男女2レーンに割っていた**（`engine/src/groups.js` の rotation モデル・`config.sample.json` の `shared_gym:true`/`groups` を参照）。これは致命的欠陥。男女は部員構成も実力も大会時期も違う別チームで、**それぞれ独立に計画を生成して常に両方を並べて出す**のが正しい。

3. **組違いは「前提」ではなく「モード」。ON＝共有ローテ／OFF＝独立 の両方が要る**
   旧実装は体育館共有・コーチ1人を**常時前提**にして組違いローテを必ず噛ませていた（`shared_gym` 既定 true）。正しくは**トグルで切り替える**: ON＝男女が体育館を共有しコーチ1人を分けて回す共有ローテ、OFF＝男女それぞれが独立にフルメニューを実施。両方を表示できること。

4. **コーチの立場で使い物になるか自己レビューしてから出す**
   形式（テスト緑・Hallmark grep ゼロ）だけで合格にせず、**実際にコーチがこの計画で部活を回せるか**を自分で目視レビューしてから提示する。

---

## 3. 原典に確定したシーズン構造（裏取り済み）

出典: `docs/practice-knowledge/sessions/年間計画.md` ／ `docs/practice-knowledge/reference/チーム基本情報.md`。以下は両ファイルから裏取りした確定事実。

- **新チームの12ヶ月アーク**: 計画の主体は「夏の代替わりで発足する新チーム（1〜2年）」。学校年度は4月始まりだが、**計画のアークは夏発足が起点**（`年間計画.md` L12-14・「月ごとの計画」表は8月始まり〜翌7月）。
  - **出発点（夏・7〜8月）**: 現3年が夏の大会で引退 → 新チーム発足。これは**山ではなく起点**。
  - **第1の山（冬）**: 中野区新人大会（11〜12月）＝新チーム最初の山。勝ち上がれば東京都新人大会（1〜2月）まで伸びる。
  - **第2の山＝集大成（翌6〜7月）**: 翌4月に新1年加入→4〜5月で仕上げ→中野区選手権→（勝ち上がれば）都選手権。**この代が3年として迎える集大成・最大の山**。
- **夏の大会（6〜7月）＝現チーム＝計画対象外＝山ではない**: `年間計画.md` L3・L21、`チーム基本情報.md`「シーズン構造と代替わり」L59-67 で明記。前セッションが peak=true にしていたのは原典に反する。
- **男女で時期がズレる（女子が約1ヶ月先行）**: `年間計画.md` L35「基準は男子＝8月始動。女子は約1ヶ月前倒しで7月から始める」。`チーム基本情報.md` L69-73「男子は都選手権（7月下旬）まで進む見込み＝新チーム始動が後ろ倒し／女子は早く代替わり／体育館を共有しながらも2チームの山が別々」。
- **2つの山は男女で別々に立つ**（体育館は共有するが計画の山は独立）。
- **部員構成（`チーム基本情報.md` L20-26）**: 男子 1年9/2年6/3年7＝22名、女子 1年3/2年7/3年5＝15名。男女は別チーム・体育館共有。
- **活動日（`チーム基本情報.md` L30-43）**: 火・金＝全面（コーチ在席想定）、水・木＝半面、月＝オフ、土日祝＝調整。男女どちらがいつコートを使うか（合同/分離）は原典に明記なし＝**要コーチ確認**（暫定でサンプルに置いている）。

---

## 4. 今セッションの完了分（新規4ファイル・実物確認済み）

すべて `engine/` 配下に作成済み（UIは未着手）。役割は実ファイルを読んで確認した。

| ファイルパス | 役割（確認済み） |
|---|---|
| `engine/data/annual-plan.json` | **原典の真実源 encode**。新チーム12ヶ月アーク（8月〜翌7月）の各月に phase・headline（主眼）・focus_weights（エンジン正準カテゴリ・和1.0）・kpi_hints・peak/peak_level を持つ。2つの山を `peaks`（winter_shinjin = 区/都新人 11/12/1/2、summer_chutairen = 中体連 6/7）として定義。先頭の `_model`/`_two_peaks`/`_gender_offset` コメントで「夏の大会は山ではない」「女子は+1ヶ月先行」を明記。山の重みは新人大会・中体連の月だけ `意思決定/ゲーム形式` を 0.3〜0.35 に上げ、夏の大会月（6/7）は中体連の山として扱う。 |
| `engine/src/annualPlan.js` | **原典を解決する純関数群**（LLM不使用・決定論）。`loadAnnualPlan(path?)`／`resolveMonth(annual, gender, calendarMonth)`＝性別＋暦月から phase/headline/focus_weights/kpi_hints/peak を解決（女子は `GENDER_OFFSET_MONTHS` で+1ヶ月先行＝アークを1つ進めて引く・暦表示はそのまま）／`yearArc(annual, gender, calendarMonth)`＝`ARC_ORDER`（8始まり）で12ヶ月を返し「今」マークを性別ごとの arcMonth に立てる（男女で1ヶ月ズレる）／`peaks(annual)`＝山定義をそのまま返す。**スモークテスト確認済み**: 男子8月→arc 8（準備始動）、女子8月→arc 9（準備積み上げ）、「今」マークが男女で1ヶ月ズレる、peaks 2件解決。 |
| `engine/data/config.girls.sample.json` | **女子チーム用の独立 config**（`team_id: minami-nakano-girls`／`team_label: 南中野中 女子`）。`phase`/`phase_category_weights` は静的に持たず annualPlan で解決して上書きする旨を `_phase_note` に明記。`_shared_gym_note` に「エンジンへは単独チームとして渡す（shared_gym=false 相当）・組違いは生成後のプレゼン層で噛み合わせる」と明記。スケジュール・フロア・負荷上限は男子サンプルと同型。 |
| `engine/data/team-input.girls.sample.json` | 女子チーム用の指標サンプル（合成値・PII回避）。`FT率`/`試合TO`/`ゴール下成功率` のベースライン/最新/目標を男子と差をつけて設定（女子計画が別物として出ることを確認できる値）。 |

補足:
- エンジン CLI は `node engine/bin/plan.js [configPath] [inputPath] [drillsPath]` で config を差し替え可能（`engine/bin/plan.js` L9-34）。**女子チームは既に `node engine/bin/plan.js engine/data/config.girls.sample.json engine/data/team-input.girls.sample.json` で生成可能**（plan.js 自体は今日 green）。
- 既存の男子 `engine/data/config.sample.json` は**旧モデルのまま**（`shared_gym:true`／`groups:["男子","女子"]`／静的 `phase:"準備"`）。新モデルでは男子も「単独チーム・annualで phase 解決」に揃える必要がある（§5・§6で整理）。

---

## 5. 未完了分（次セッションの実装対象）

### 5-1. `ui/plan-data.mjs` を「2チーム両方生成＋annual上書き＋本物の年アーク＋組違いモード」へ全面書き換え（最重要）

現状 `ui/plan-data.mjs` は**旧版のまま**（男子1チームを `config.sample.json` で1回だけ planWeek し、`buildYearBands()`/`buildMonthWeeks()` が仮置き＝§2-1の誤り。L73-97 がでっち上げ箇所、L15 の冒頭コメントが「年/月レベルはエンジン未実装のため仮置き」と自認）。これを次の契約に置換する:

- **2チームを両方生成**: 男子（`config.sample.json` ＋ `team-input.sample.json`）と女子（`config.girls.sample.json` ＋ `team-input.girls.sample.json`）をそれぞれ `planWeek` で生成する。
- **各チームは独立チームとして渡す**: planWeek へは `shared_gym:false`・`groups` 未指定で渡す（1チーム内2レーンのローテを発生させない）。
- **annualで phase / weights を上書き**: 各チームの `phase` と `phase_category_weights`(focus_weights) を `annualPlan.resolveMonth(gender, current_month)` の結果で上書きしてから（または planWeek 入力に注入してから）生成する。男子＝gender"男子"、女子＝gender"女子"（女子は+1ヶ月先行が自動で効く）。
- **本物の年アーク**: `buildYearBands()` を廃し、`annualPlan.yearArc(gender, current_month)` をデータに載せる（男女別の12ヶ月アーク＋2山＋「今」マーク）。
- **組違いモードを2チームの同日プランから導出**: `groups.js` の「1チーム内2レーン」ではなく、生成済みの男子プラン日と女子プラン日を突き合わせてプレゼン層で噛み合わせる:
  - **コーチ在席平日（火・金）＝ON時**: 実践段を男女交互（片方が実践中、もう片方は自走）＝共有ローテ。
  - **コーチ不在日（水・木）**: 両チームが各自フルメニューを自走（ローテ不要）。
  - **土**: 男女合同（together）。
  - **OFF時**: 男女それぞれが独立にフルメニュー（共有なし）。
- 旧 `buildMonthWeeks()` の「仮置き週（第2〜4週を反復で水増し）」は廃止し、月レベルは**原典のフェーズ＋主眼（headline）＋KPI（kpi_hints）**を annual から出す。

### 5-2. プレゼン層（`ui/pattern-*.mjs` ＋ `render-shared.mjs` ＋ `build.mjs`）を新データ契約へ作り直し

採用案は **`ui/pattern-timeline.mjs`**（前セッションでオーナー採用表明）。`ui/render-shared.mjs`（共通部品・トンマナ）／`ui/pattern-handout.mjs`／`ui/pattern-board.mjs`／`ui/build.mjs` も新契約に合わせる。

- **日レベル**: 男子列・女子列を**両方表示**＋組違いON/OFFトグル。
- **年レベル**: 新チーム12ヶ月アーク（8→7月順）で**2山を強調**、男女で「今」マーカーが1ヶ月ズレる。
- **月レベル**: 原典のフェーズ＋主眼＋KPI（仮置き週は出さない）。

### 5-3. `engine/src/groups.js` の扱いを整理

`groups.js` は現状「1チーム内（男子/女子）2レーン」の rotation 実装（`buildWeekdayRotation`/`buildSelfParallel`/`buildTogether`/`buildWeekdayGroups`）。これを **(a) 2チーム間ローテへ作り替える** か、**(b) plan-data 側の組違い導出（5-1）に一本化して groups.js を退役/縮小する** かを決めて整理する。`buildWeekdayGroups` は `shared_gym !== false` 前提なので、各チームを `shared_gym:false` で生成すると空配列を返す（=単一列フォールバック）点に注意——組違いはプレゼン層導出に寄せるのが新モデルと整合する。

### 5-4. 完了条件

- `node ui/build.mjs` と `node engine/bin/plan.js`（男女両config）が通る。
- **男子分・女子分が両方出る**。
- 年/月が**原典どおり**（夏の大会は山でない・2山が冬の新人と翌夏の中体連・女子が1ヶ月先行）。
- **組違いON/OFF両方**が表示できる。
- **Hallmark audit 検出ゼロ**（grep だけでなく headless Chrome 目視。前回 `::before` 左色帯で grep を回避した事故あり＝目視必須）。

---

## 6. 設計判断と理由（確定／要確認の別を明記）

**確定（原典と既存マルチテナント設計に沿う）**:
- **男女を別 team_id の独立チームとして両方 planWeek する**。エンジンは元々 team_id 単位のマルチテナント（`storage.js`/`planWeek.js`）なので、男女2チームを別 config で2回回すのが設計に沿う。1チーム内2レーン（旧 `groups.js`）は男女の別実力・別大会時期を表現できず誤り。
- **女子の先行（+1ヶ月）は annualPlan で解決**。`resolveMonth`/`yearArc` が gender を見てアークを進めるので、UIは暦月をそのまま渡せば男女の山ズレが自動で出る。
- **組違いは2チーム生成後のプレゼン層で噛み合わせる**。エンジンは各チームを独立生成し、共有ローテ（ON）は描画段で男女の同日プランを突き合わせて作る。これにより OFF（独立）も同じ2チームデータから無加工で出せる。

**要確認（暫定前提として明記）**:
- **女子の先行向き＝「+1ヶ月（女子が先）」はオーナー要確認**。原典 `年間計画.md` L35「女子は約1ヶ月前倒しで7月から始める」を根拠に女子先行＝+1ヶ月で実装したが、向き・幅（女子が早い/遅い・1ヶ月でよいか）はコーチ確認で確定したい。現状は暫定前提。
- **体育館の男女コート割り（合同/分離の曜日）は原典に明記なし**（`チーム基本情報.md` L43 が「要確認」と自認）。サンプルの火金=全面在席/水木=半面不在/土=在席は暫定。組違いON/OFFの曜日判定はこれに依存するので、確定後に config を更新する。

---

## 7. 注意・PII

- **実選手データは未接続・合成値で実装**。実選手の指標は Drive「バスケ_選手名簿」（PII＝実名・個人成績）にあり、UI・サンプルは合成値（`team-input.*.sample.json` の `_note` 参照）。Drive 接続はオーナー受領後。
- 公開ドキュメント（findings/spec/handoff/README）に**個人ホーム配下の絶対パス・本名・実選手値を書かない**。本資料の参照は全てリポジトリ相対パス。
- 生成HTML（`ui/*.html`）は `.gitignore` 済み（再生成＝`node ui/build.mjs`）。ソースは `.mjs`/`.json` のみ追跡。

---

## 8. コミット一覧

| ハッシュ | 内容 | 状態 |
|---|---|---|
| （本セッション） | feat(engine): 年間計画を原典接続＋男女別チーム化の土台（annual-plan.json/annualPlan.js/女子サンプル）＋本引継資料 | ローカルcommit（push しない） |
| 370e4bb | docs(handoff): 段モデル化とUI3見せ方の引継資料（前セッション） | ローカル・未push |
| 60b37dd | feat(ui): 練習計画UIを配布ドキュメント型の3見せ方x4レベルで再構築（前セッション） | ローカル・未push |
| 212c25d | feat(engine): 練習計画を段モデルに再設計（前セッション） | ローカル・未push |

前セッションの 212c25d / 60b37dd / 370e4bb は**ローカル未pushのまま継続**。push は §5 完了＋push前レビュー（`/security-review`＋`/code-review` high）＋オーナー承認の後にまとめて行う。本セッションのコミットSHAはこの資料を含めて確定後に追記する（下記コミット結果参照）。

---

## 9. 次セッション貼付用テキスト（コピペで次セッションへ渡す）

```
あなたは basketball-coach-strategy（中学バスケ部の練習計画エンジン＋配布UI）の継続担当です。会話文脈はゼロ。まず以下を Read で読んでから着手:
- docs/findings/handoff-20260609-gender-teams-season-rebuild.md（この引き継ぎ＝出発点）
- docs/practice-knowledge/sessions/年間計画.md（原典＝真実源）
- docs/practice-knowledge/reference/チーム基本情報.md（シーズン構造・男女別・体育館共有の原典）
- engine/data/annual-plan.json と engine/src/annualPlan.js（原典 encode＋解決用純関数。完成済み）
- ui/plan-data.mjs（旧版のまま＝最重要の書き換え対象）
- engine/src/groups.js（旧「1チーム内2レーン」ローテ。退役 or 2チーム間化を判断）

【確定要件（オーナー差し戻し）】
1. 年/月は原典どおり: 夏の大会(6〜7月)は前の代＝現3年の集大成で本計画の対象外＝山ではない。新チームの山は2つ＝冬の新人大会(区11〜12月→都1〜2月)と翌夏の中体連(6〜7月・集大成・最大の山)。前実装は夏を山に置く誤り。
2. 男女は別チーム＝別計画。常に男子分・女子分を両方出力。前実装は1男子チーム内に男女2レーンで同一メニューを割っていた致命的欠陥。
3. 組違いはモード: ON＝体育館共有・コーチ1人を分ける共有ローテ / OFF＝男女独立。両方表示できること。
4. コーチの立場で実際に部活を回せるか自分で目視レビューしてから出す（テスト緑/Hallmark grepゼロだけで合格にしない）。

【実装対象】
A) ui/plan-data.mjs を全面書き換え: 男子(config.sample.json＋team-input.sample.json)と女子(config.girls.sample.json＋team-input.girls.sample.json)を両方 planWeek。各チームは shared_gym:false・groups未指定で独立生成。phase と phase_category_weights を annualPlan.resolveMonth(gender, current_month) で上書き。年アークは annualPlan.yearArc(gender, current_month)。buildYearBands/buildMonthWeeks の仮置きは廃止。組違いは2チームの同日プランをプレゼン層で噛み合わせて導出(在席平日=実践段を男女交互・片方実践中もう片方自走／不在日=両チーム各自自走／土=男女合同／OFF=各自独立)。
B) ui/pattern-timeline.mjs(採用案)＋render-shared.mjs＋pattern-handout.mjs＋pattern-board.mjs＋build.mjs を新契約へ: 日=男子列・女子列を両方＋組違いON/OFFトグル、年=新チーム12ヶ月アーク(8→7月順)で2山強調・男女で「今」マーカーが1ヶ月ズレる、月=原典のフェーズ＋主眼＋KPI(仮置き週は廃止)。
C) groups.js は2チーム間ローテへ作り替えるか plan-data側の導出に一本化するか整理(各チーム shared_gym:false だと buildWeekdayGroups は空配列を返すので、組違いはプレゼン層導出に寄せるのが整合的)。
D) 既存の男子 config.sample.json は旧モデル(shared_gym:true/groups/静的phase)のままなので、男子も「単独チーム・annualでphase解決」に揃える。

【完了条件】 node ui/build.mjs と node engine/bin/plan.js(男女両config)が通る／男子分・女子分が両方出る／年・月が原典どおり(夏は山でない・2山が冬の新人と翌夏の中体連・女子が1ヶ月先行)／組違いON/OFF両方表示できる／Hallmark audit検出ゼロ(grepだけでなくheadless Chrome目視。前回::before左色帯でgrep回避した事故あり)。

【要確認(暫定前提)】 女子の先行向き＝「+1ヶ月(女子が先)」はオーナー要確認。体育館の男女コート割り(合同/分離の曜日)は原典に明記なしで暫定。実選手データはDrive「バスケ_選手名簿」のPIIで未接続＝UIは合成値のまま。

【運用】 mainで直接作業(派生ブランチ禁止)。push前に /security-review＋/code-review(high)→反映→main push(オーナー承認後)。公開ドキュメントは相対パスのみ・個人ホーム配下の絶対パス/本名/実選手値を書かない。
```
