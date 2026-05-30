# 引継資料: バスケ練習ナレッジベース構築（2026-05-30）

## 概要

### このセッションで達成したこと
コーチが Google Drive に分散して持っていた練習・戦術ドキュメント（約55ファイル）を Markdown 化し、Claude に相談しやすい知識ベースとして `docs/practice-knowledge/` に構築した。内容の性質ごとに **sessions（日々のカリキュラム）／drills（練習種目）／tactics（戦術・哲学）／reference（ルール・データ）** の4カテゴリへ整理し、選手・スタッフ・学校・対戦相手の実名を伏字化したうえで個人アカウントの GitHub リポジトリ（main）へ push 済み。

### なぜやったか
今は Google Drive で管理している練習知識を、まず Claude に相談しやすい形でインプットしておくため。フラットな一覧では「ドリル／タクティクス／セッション」の区別がつかず引きにくいため、カテゴリ別フォルダに構造化した。

## 構築物の構造

リポジトリルート: basketball-coach-strategy（このリポジトリ）。知識ベース本体は `docs/practice-knowledge/`。

| パス | 中身 |
|---|---|
| `practice-knowledge/README.md` | カテゴリ構成・相談例・ファイル索引・個人情報方針 |
| `practice-knowledge/sessions/練習メニュー集_2022-2023.md` | 週次練習メニュー13本（時間ブロック階層を忠実復元）＋末尾にチーム方針の変遷 |
| `practice-knowledge/sessions/練習メニュー集_2024-春.md` | 2024年3〜5月の練習9本（スライド/Word） |
| `practice-knowledge/sessions/練習メニュー集_2024後半-2025.md` | 2024年6月〜2025年2月の日次メニュー21本 |
| `practice-knowledge/sessions/練習計画.md` | 中期計画・木曜練習計画(KGI/KPI)・冬合宿目標・ヒアリングシート |
| `practice-knowledge/sessions/練習レポート.md` | 練習ごとの振り返り記録 |
| `practice-knowledge/drills/ドリルカタログ.md` | 練習種目を「カテゴリ→ドリル名(H3)→手順」で詳細収録（各ドリルの手順・バリエーション入り） |
| `practice-knowledge/drills/自主練メニュー.md` | 自主練PDF（図解中心のため見出し・キャッチのみ。図は原本参照） |
| `practice-knowledge/tactics/チーム哲学とセットオフェンス.md` | ディフェンス哲学＋セットオフェンス3種 |
| `practice-knowledge/tactics/オフェンス概説（ポストトリガー）.md` | ポストトリガー型コンビネーションの体系 |
| `practice-knowledge/tactics/PnR講座.md` | PnR講座（原本の箇条書き階層を忠実復元） |
| `practice-knowledge/tactics/試合戦術.md` | 各大会・練習試合のセットプレー・スカウティング・ゾーン（**プレー図は未取込み＝下記引継参照**） |
| `practice-knowledge/reference/ルール.md` | 中学バスケのルール（図解PDFのため骨子のみ。図は原本参照） |
| `practice-knowledge/reference/スタッツとシュート分析.md` | 試合スタッツ・FGデータ・シュートエリア分析・動画クリップ一覧 |
| `practice-knowledge/reference/バスケノート.md` | 試合前目標設定・Win/Try/Learn 振り返りフォーマット |
| `practice-knowledge/reference/その他メモ.md` | 申し伝え・アンケート |

### Google Drive 取り込みの技術メモ（次セッションが再開するため必須）
- Drive 連携は claude.ai の Google Drive コネクタ（MCP）経由。**資料は個人アカウント（オーナー個人 Gmail）側にある**。コネクタを会社アカウントに切り替えると資料が見えず `not connected`／空振りになる。再開前に Drive を個人アカウントに接続すること。
- テキスト抽出: `mcp__claude_ai_Google_Drive__read_file_content`（fileId 指定）。Word/PDF/スプレッドシート/スライドの自然言語表現が返る。
- 画像（プレー図）取り込み手順: `download_file_content`（exportMimeType=`application/pdf`）→ 大きい結果は自動でセッション配下のファイルにJSON保存される → `jq -r '.content' <保存パス> | base64 -d > out.pdf` で復号 → `Read` の `pages` 指定でページ画像として読む。**base64 はディスクに留まりコンテキストを汚さない**のが利点。

## コミット一覧（main、push済み）
| ハッシュ | 内容 |
|---|---|
| 73c7b2f | バスケ練習ナレッジベースを追加（sessions/drills/tactics/reference） |
| e770ed2 | 太字(**)を全ファイルから除去し、ドリルカタログを詳細化 |
| 31ed2e4 | 作成中の基本練習テンプレをignoreに追加 |

## 公開状況
- リモート: 個人アカウントの GitHub リポジトリ（SSH）。ブランチ main に push 済み。
- 本番デプロイ・Secret Manager 変更なし（ドキュメントのみのリポジトリ）。

## 動作確認済み項目
- 形式整合層: 全 Markdown の相対リンクが解決すること（リンク健全性チェックで壊れリンク0）。`**` 残存0。文字化け0。追跡ファイルへの実名残存0（grep検証）。
- 意味価値層: オーナーが PnR講座・ドリルカタログ・2024後半メニューを IDE で実閲覧し、構造・粒度の差し戻し→修正を反映済み。ドリルカタログはオーナー提示の粒度（ダイナミックストレッチの前半/後半まで）に合わせて再構築。

## 既知の注意点・未対応項目
1. **（最優先・未完）戦術デッキのプレー図が未取込み**: `tactics/試合戦術.md` のコート図・セット図は現状「原本参照」のまま。Drive を個人アカウントに接続後に画像取り込みで文章化する（下記引継指示1）。
2. **WIPファイルは gitignore 済み**: `practice-knowledge/drills/練習メニュー_基本.md`（オーナーが「基本の練習」テンプレを自作中。RAMP枠組み・ポゴジャンプ等を追加、シュート練習・対人セクションが未完）はローカル限定（`.gitignore` 登録済み）。オーナーが完成させたら知識ベースへの統合を検討。
3. **伏字化スキーム**: 選手・スタッフ・学校・対戦相手の実名はトークン（選手記号／コーチ記号／自校・相手校）に固定置換済み。同一人物は同一トークン。背番号・スタッツ数値は保持。新規にDriveから取り込む素材（特にプレー図中の選手名）も同じ方針で伏字化すること。
4. **図解中心PDFの限界**: 自主練・ルールは図解主体のため見出しのみ取得。完全版は原本参照と明記済み（捏造はしていない）。

## 開発中に得た教訓
1. **多バイト文字の一括置換は Unicode 正対応ツールで行う**。
   - 何が起きたか: 名前スクラブを `perl -CSD ... s/\Qpat\E/repl/g` で実施したところ、パターン＝バイト／入力＝デコード済み文字のズレで、ASCII名は文字化けトークン（二重エンコード）に、多バイト名は未置換のまま残った。
   - 再発防止: 多バイト文字の検索置換は Python の `str.replace`（UTF-8デコード後）か、バイトモードの sed/perl（`-CSD` を付けない）で行う。`-CSD` とバイトリテラルのパターンを混在させない。
   - 反映先候補: firebase-kit `.claude/CLAUDE.md`（データ変換の正当性）またはクロスセッション記憶。
2. **成果物は対象プロジェクトに置く**（行動原則5）。最初 `ai-basketball-coach` に置いてしまい、オーナー指摘で `basketball-coach-strategy` に移した。プロジェクト名が紛らわしいときは着手前に置き場を確認する。
3. **「まとめて」＝要約ではない**。ドリルカタログを初版で要約してしまい「手抜き」と差し戻し。原本に手順詳細がある項目は全手順を入れる（データ切り捨て禁止）。
4. **外部コネクタのアカウント切替に注意**。Drive コネクタを会社アカウントに切り替えると個人アカウントの資料が見えなくなる。資料の所在アカウントとコネクタの接続先を一致させる。

## 次セッションへの引継指示
優先順（上が高い）:

1. **戦術デッキのプレー図を画像取り込みで文章化（最優先・オーナー承認済みスコープ「全部」）**
   - 前提: Drive コネクタを**個人アカウント**に接続（会社アカウントだと不可）。`get_file_metadata` で疎通確認してから着手。
   - 対象（Googleスライド・fileId）: 総体予選戦術 `1fBIvttsZ3wFftLagPuwIt2uHj0s0jVre8RN9SgT2464` / 春季大会戦術 `1VzIxTFcGCk-3W8dHtAOWTUOLJa3StATzxbRe_T7052M` / B支部大会戦術 `1IGMt05KaieKpqv0WwEndkPSfLq4rAoRF-A0E9wn58-c` / 2022練習試合戦術(60MB) `1XqV7a-SQRHmM_QTlxPrPF6ieMmgcsWQUAR6190SO-sM` / 20221226練習試合(テキスト空＝図のみ) `1pef0kubIolmN1uPMxg6uydZZAHxlMGC4YS8jpo4T6Oo` / 作戦ボードテンプレ `1q8R7n7t3EBFvex2-CEE56xuSWF56TtdtSDtSV9_7hh0`
   - 手順: 各デッキを `download_file_content`(PDF) → `jq` で base64 復号 → `Read` でページ画像として読み → コート配置・スクリーン・カット・パス経路を散文化 → `tactics/試合戦術.md` の該当セクションへ追記。図中の選手名は伏字化（既存トークン方針に合わせる）。
   - 完了条件: 6デッキの「図解のみ／一部のみ」表記が、図の散文説明に置き換わっている。
   - 注意: サブエージェントは週次上限に当たる可能性。当たったらメイン直接で実施（画像はメインのコンテキストに載るが許容）。
2. **基本練習テンプレ（gitignored WIP）の扱い**
   - `drills/練習メニュー_基本.md` をオーナーが完成させたら、知識ベースへ正式統合するか確認。シュート練習・対人セクションが未完なので、依頼があればドリルカタログから補完。
