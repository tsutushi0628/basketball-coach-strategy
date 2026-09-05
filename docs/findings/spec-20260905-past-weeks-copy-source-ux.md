# 過去の週への移動とコピー元選択のUIモックと行動分析

対象: 要望1「過去の週を選べるUX」と要望2「コピー元の履歴が多い」のUIモック承認ゲート用の成果物。
アプリ本体のコードは変更していない。

## 成果物

- docs/specs/past-weeks-and-copy-source/ux-analysis.md（行動分析。利用コンテキスト、身体動作フロー、B=MAT、エッジケース、文言表、設計文書との差分）
- docs/specs/past-weeks-and-copy-source/mock-week-nav.html（要望1、9状態）
- docs/specs/past-weeks-and-copy-source/mock-copy-source.html（要望2、6状態）
- ui/e2e/evidence/past-weeks-copy-source-mock-dom-2026-09-05T00-52-24-312Z.json（4幅のDOM実測。同名で時刻が前のものは判定の作り直し前の記録）

## 結論

- 週タブ（.pk 4枠）は実CSSをそのまま読み込み、寸法（118×42px、14px 600、padding 8px 14px、角丸999px）が4幅で不変であることを実測した。
- 一歩移動と「今週へ戻る」は component-spec.md の「移動」ロール（面なし、語つきピル、11px 700）で足した。414px未満は一歩移動を列の上段へ回す（320pxでは4枠が2段2枠なので左右端に置くと4段になるため）。414px以上は列の左右端。
- 「今週へ戻る」は表示中の週が今週でないときに出す（service-design.md 5.2節の「窓が過去側」と5.1節の状態2が両立しないため、状態2を満たす側に倒した。判断は PdM へ）。
- コピー元は「おすすめ」（最大3件、行全体が押せるラジオ。入力部品なので状態ロールを借りない）と「探す」（年月と日の select）に分け、取り込みボタンは1つのまま。
- 確認カードの実行の語は「取り込む」。「置き換えて取り込む」だと320pxと375pxで2行に折り返した（実測）。

## 監査の記録

- hallmark audit: Skill 一覧に hallmark が無く Skill 経由では起動できなかったため、audit verb の手順（.agents/skills/hallmark/references/verbs/audit.md）に沿って anti-pattern 9項目を grep で実体検査した。side-stripe、汎用書体、gradient、生hex、生font-family、独自:root、OKLCH、絵文字、偽chrome、全幅hero、border-left/top のすべてが両ファイルで0件。
- design-system audit: この製品は弁コム正本トークン非適用（docs/design-system/component-spec.md 冒頭）のため tokens.css の link 検査は対象外。憲法grep（生hex、生font-family、独自:root、side-stripe、禁止書体、gradient）は0件。未定義 var() 検査は、製品CSS（pattern-timeline.css）がインライン style で供給する4変数（--rh、--sh、--t、--wg-cols）のフォールバック付き警告だけで、モック由来の未定義は0件。
- 4幅（320/375/414/768）で横スクロール幅が視口幅と一致。新設部品のタップ寸法は全て44px以上。44px未満は既存の .ed-mini（32px）だけで、既存の意匠を変えない制約により据え置き。

## 次のアクション

- PdM が「今週へ戻る」の出現条件を裁定する（表示中の週が今週でないとき、または窓が過去側のとき）。
- モック承認後、architect が service-design.md 6章の技術設計に入る。
- 審美判定（refs/aesthetic-judge.md）は未通過。PdM 側で実施する。
