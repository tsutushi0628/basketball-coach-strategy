---
schema_version: 1
verified_at: 2026-09-16T13:09:04Z
verified_head: e5b91b3
source_worklog: handoff-20260531-play-diagrams.md
---
# basketball-coach-strategy

## 1. 目的と利用者
バスケットボールのコーチ業で蓄積した練習・戦術ナレッジを、Claude に相談しやすい形でまとめたリポジトリ。
利用者はオーナー本人（コーチ業務の相談相手としてClaudeを使う際の参照知識源）。
知識ベース本体は `docs/practice-knowledge/` にあり、sessions（日々のカリキュラム）／drills（練習種目）／tactics（戦術・哲学）／reference（ルール・データ）に分かれる。
選手・スタッフ・学校・対戦相手の実名は伏字化済み（同一人物は同一トークン、背番号・数値は保持）。

## 2. 稼働状態とURL
デプロイ対象ではない。バスケ知識ベースをMarkdown／PNGで管理するプライベートGitリポジトリ。
本番URL・ホスティング先はなし。

## 3. 構成マップ
- `docs/practice-knowledge/sessions/`: 日々の練習カリキュラム記録
- `docs/practice-knowledge/drills/`: 練習種目・ドリルカタログ
- `docs/practice-knowledge/tactics/`: 戦術・チーム哲学、プレー図PNG（`assets/`配下）
- `docs/practice-knowledge/reference/`: ルール・スタッツ等の参照資料
- `docs/findings/`: 引継資料（handoff-YYYYMMDD-topic.md）

## 4. 現在地
- 焦点: 戦術デッキのプレー図収録。伏字化PNG（合成円方式）で総体予選・春季・B支部の3デッキは収録済み。
- 次の一手: 残り3デッキ（2022練習試合戦術・20221226練習試合・作戦ボードテンプレート）の最新共有リンクをオーナーから受領し、同方式で収録する。
- 残作業: 上記3デッキの伏字化収録（元ファイルへアクセス不可のため保留中）。
- オーナー未回答: 伏字化前の画像が写り込んだ過去コミットについて、Git履歴パージの要否。

## 5. 制約と注意事項
- 選手・スタッフ・学校・対戦相手の実名は伏字化必須（同一人物は同一トークン、背番号・数値は保持）。新規取込素材も同方針を踏襲する。
- 伏字化ロジック（合成円方式PNG生成）の実行スクリプトはリポジトリ外のローカル環境にあり、再現手順は `docs/findings/handoff-20260531-play-diagrams.md` に文章化済み。
- 多バイト文字の一括置換はUnicode正対応ツール（デコード後のstr.replace等）で行う。バイトパターンとデコード済み文字列を混在させると文字化けする。
- Google Driveコネクタは資料の所在アカウント（個人アカウント）に接続すること。会社アカウントでは一部資料に到達不可。

## 6. 根拠となる最近の記録
- [handoff-20260531-play-diagrams](findings/handoff-20260531-play-diagrams.md)
- [handoff-20260530-practice-knowledge](findings/handoff-20260530-practice-knowledge.md)
