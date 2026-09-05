# worklog: 練習計画4件修正と本番差し戻し（2026-09-05）

前セッション名: なし（custom-title・sessions/*.json とも該当なし）。

対象リポジトリ: basketball-coach-strategy（このリポジトリのルート）。

## 概要

オーナーから4件の要求を受けた。

1. 過去週へのナビゲーション追加。
2. 「他の日からコピー」のおすすめ＋探すへの再設計。
3. 目標保存を局所更新にし、別の未保存入力を消さない完全独立にする。
4. 男女共通OFFで複製した行に、内容が同一でも2列表示を保つ明示フラグを持たせる。

経路は fable-advisor（異見出し）→ service-designer（サービス設計）→ ux-designer（モック・行動分析）→ architect（技術設計）→ 実装 → qa-engineer（QA）→ scm-engineer（コミット）で進めた。

## 経緯

- 不具合3（目標保存の再読込で別の未保存入力が消える）と不具合4（男女別行の畳み込み）の設計は `docs/findings/spec-20260905-goal-local-update-and-split-flag.md`。実装はコミット 3b3546a。QAは `docs/findings/qa-20260905-goal-local-update-and-split-flag.md` で PASS（テスト276件全緑）。
- 過去週ナビとコピー元の設計は `docs/specs/past-weeks-and-copy-source/service-design.md`・`ux-analysis.md`（行動分析・全状態パターン・モック2点）と `docs/findings/spec-20260905-past-weeks-and-copy-source-impl.md`（技術設計）。実装はコミット c3f1826。
- QA（`docs/findings/qa-20260905-past-weeks-and-copy-source.md`）は初回 FAIL（`modelHasContent()` がねらい入力を見ず無警告上書き）、1回目修正後も再FAIL（`revert-auto`・`load-seed` が `collectInputs()` を呼ばず判定していた）、2回目修正で再々QA PASS（テスト372件全緑）。
- ここまでの状態を本番（Firebase project ai-bb-coach）へ gcloud ADC 認証でデプロイした。作業開始時点で通常の `firebase login` の refresh token が失効していたため、ADC 経路に切り替えて対応した。
- 本番を見たオーナーが2点を差し戻した。年月セレクトの削除と、「前の週」到達下限（最古のコーチ上書き週）の廃止（`?week=` クエリでの再SSR方式に変更）。差し戻し内容は `docs/findings/fix-20260905-week-nav-past-limit-and-jump-removal.md`。
- 差し戻し修正は Codex ラッパーが使用量上限で中断したため、Sonnet による直修正に切り替えた。修正後の再々々QA（`qa-20260905-past-weeks-and-copy-source.md` 13章）は PASS（テスト372件全緑、hallmark実体検査ゼロ件）。コミット 46bb6e4。
- 再デプロイを実施した。

## 決めたこと

- 不具合3は「完全独立」（別ボックスの未保存入力に一切触らない局所更新）を選ぶ。再読込の全廃が前提。
- `split` フラグは `buildOverride`（保存ペイロード生成）と描画モデルの両方に通す。共通OFFの複製行だけに付け、`both` 行・onlyGender 保存行には付けない。
- 月目標は週ごとにアーク月キーを持たせる。先頭週（今週）は現行の `goalKeys.monthArcKey` と同値、未来週も含めて一律にこの規則を適用する（月をまたぐ未来週で暦月が変わる挙動変更を伴う）。
- 「今週へ戻る」は「表示中の週が今週以外」のときに出す（窓の位置基準ではなく選択週基準。service-design.md と ux-analysis.md の齟齬をこちらへ統一）。
- 到達下限は撤廃し、下限を超えた「前の週」は `?week=` 付きURLへの再SSR遷移に倒す。

## 罠

- Codex CLI の使用量上限で中断が発生した（`docs/findings/fix-20260905-week-nav-past-limit-and-jump-removal.md` に記録）。以降は Sonnet による直修正に切替えた。
- 作業開始時点の HEAD がブランチ `feat/scrimmage-split` 上にあったため、対象3コミットを cherry-pick で `main` へ移した。
- サブエージェント招聘 hook は、必読ブロックを先頭に置く・読み取り専用の指示は独立行にする・UI語と生成語が揃った依頼はデザイン役経路を必須にする、の3点を要求する。踏み外すと招聘が弾かれる。
- `firebase login` の refresh token 失効時は、gcloud ADC 認証で代替できる（オーナー確認は不要）。
- `modelHasContent()`（`ui/editor.mjs`）は当初 `model.rows` だけを見ており `aim`・`title` を見ていなかった。加えて `revert-auto`・`load-seed` の2分岐が `collectInputs()`（DOM入力値の取り込み）より前に `modelHasContent()` を呼んでいたため、修正後も無警告上書きが再現した。両方の修正（判定対象の拡張＋呼び出し順の是正）で解消した。
- hallmark スキルは Skill 一覧に登録されておらず、Skill 経由では起動できなかった。`.agents/skills/hallmark/references/verbs/audit.md` の手順を直接参照し、grep による実体検査で代替した。

## 残作業

未完了は次のとおり。

1. push（main が origin/main から1コミット先行。オーナー未承認のため未実施）
   → 次の一手: オーナー承認後 `git push origin main`
2. 審美判定（`refs/aesthetic-judge.md` の全体論判定。機械監査は通過済みだが全体論判定は未通過）
   → 次の一手: オーナー承認後、審美判定役→3社合議の手順を回す
3. `docs/sessions/term-kickoff.md`・`docs/sessions/term-kickoff.pdf` の未コミット差分の扱い（本セッションの4件修正とは無関係な内容で、`codex-worklog.md` にも複数回混入が記録されている）
   → 次の一手: オーナーに「別セッションの持ち越しか」を確認してから commit か revert かを決める
4. `.tmp/` 配下の掃除（`probe-3-4`・`qa-20260905`・`codex-task-*` 等、セッション中の一時ファイル）
   → 次の一手: `rm -rf .tmp/probe-3-4 .tmp/qa-20260905 .tmp/codex-task-*`（内容が今後の調査で要らないことを確認してから）

<!-- RESTORE-BLOCK-START -->
**次の一手**: オーナーに「次セッションで確認すること」欄の4項目をすり合わせてから着手する。

### 残作業
1. push
   → 次の一手: オーナー承認後 `git push origin main`
2. 審美判定（全体論判定）
   → 次の一手: オーナー承認後、審美判定役→3社合議の手順を回す
3. `docs/sessions/term-kickoff.md`・`.pdf` の無関係な未コミット差分
   → 次の一手: オーナーに持ち越しか確認後、commit か revert
4. `.tmp/` 配下の掃除（`probe-3-4`・`qa-20260905`・`codex-task-*` 等）
   → 次の一手: 内容確認後 `rm -rf`

### オーナー未回答
- push可否
- 審美判定の実施可否
- `docs/sessions/term-kickoff.*` 差分の扱い

### 罠
- Codex 使用量上限中断 → Sonnet 直修正に切替。
- HEAD が `feat/scrimmage-split` だった → cherry-pick で main へ移す。
- `firebase login` の refresh token 失効 → gcloud ADC で代替。
- `modelHasContent()` は `model.rows` だけでなく `aim`・`title` も見る必要があり、かつ `revert-auto`・`load-seed` は `collectInputs()` の後に判定する必要がある（順序を誤ると無警告上書きが再現する）。

### まず読むファイル
1. `docs/findings/fix-20260905-week-nav-past-limit-and-jump-removal.md`（オーナー差し戻しの最新内容と検証結果）
2. `docs/findings/qa-20260905-past-weeks-and-copy-source.md` 13章（最終QA結論と実測項目）
3. `docs/specs/past-weeks-and-copy-source/service-design.md`（過去週・コピー元の設計判断の根拠）
<!-- RESTORE-BLOCK-END -->
