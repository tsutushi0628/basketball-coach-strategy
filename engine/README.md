# 練習計画エンジン MVP

中学バスケ部の週次練習計画を、チームの哲学・指標ギャップ・負荷上限から決定論的に生成するエンジン。外部依存ゼロ・素の Node.js (ESM, Node v22)・テストは組込 `node:test`。

## アーキテクチャ（決定論 / LLM 境界）

このエンジンの設計上の中核は「LLM 境界」を1点に絞り込むこと。

- **決定論コード（エンジンの本体）**: ギャップ計算・カテゴリ重み付け・プールのフィルタ・負荷予算・ブロック配分・ハードゲート・整形。同じ入力からは必ず同じ計画が出る（再現性100%）。閾値判定・件数集計・並び替え・重複除去・形式整形はすべてコード側。
- **LLM 境界（`src/llm.js` の1モジュールのみ）**: 「コーチの自由記述コメントを既知カテゴリに振り分ける」という、定量化できない曖昧写像だけが LLM の責務。LLM には閾値・カウント・ソート・整形を一切渡さない。MVP では実呼び出しせずキーワード写像のスタブで代替するため、ネットワーク/API 依存ゼロ。実モデルを繋ぐ時は `mapCoachCommentToCategory` の本体だけ差し替え、`(string in → category string|null out)` の契約は不変。コメントは助言的で、計画の根拠（load-bearing）には決してしない。

## 実行

```sh
node bin/plan.js                                  # サンプルconfig/input + 211件ドリルカタログで週次計画を出力
node --test                                       # node:test 全テスト
node bin/plan.js <configPath> <inputPath> <drillsPath>  # 任意のconfig/input/drillsを差し込む
# npm スクリプト経由でも可: npm run plan / npm test
```

## パイプライン（すべて決定論）

| 段 | ファイル | 役割 |
|---|---|---|
| 1 | `src/gap.js` | 指標→カテゴリ写像とギャップ比から `finalWeights`（重点配分）と最重要カテゴリを算出 |
| 2 | `src/filter.js` | 日ごとにプールを除外（コート/学年/ゾーン/年内セット） |
| 3 | `src/loadModel.js` | 高強度の本数上限（日/週）・連続日回避を追跡する負荷予算の状態機械 |
| 4 | `src/allocate.js` | 1日をブロック分割し、重点順にプールから充填。半面日は全面必須を除外 |
| 5 | `src/gates.js` | 生成後に全制約を再検査。違反は throw（最終防衛線） |
| - | `src/planWeek.js` | 上記を束ねるオーケストレーション |
| - | `src/format.js` | plan を人間可読テキストへ整形 |
| - | `src/llm.js` | 唯一の LLM 差し込み口（MVPはキーワード写像スタブ） |

土台（`src/types.js` / `src/storage.js` / `src/normalize.js` / `data/*.sample.json`）は仕様 `DESIGN.md` 参照。

## マルチテナント・チーム哲学パラメータ

全データは `team_id` で引ける形を前提にしており、チーム固有の方針はエンジンにハードコードせず **すべて config で受ける**。他チームは config を差し替えるだけで自分の哲学・スケジュール・負荷上限で使える（外販前提）。

- `category`（例: 中学）— ゾーンフィルタの発火条件
- `grades` — 対象学年（プールの学年フィルタ）
- `philosophy.zone_forbidden` — ゾーン系ドリルを排除するか
- `philosophy.sets_forbidden_in_year` — 年内のセットオフェンスを排除するか
- `philosophy.df` / `philosophy.shot_clock_sec` — 守備方針・ショットクロック（計画ノートに反映）
- `current_month` / `phase` — マクロサイクル位置（年内セット判定・重点ベース）
- `schedule` — 曜日ごとの枠尺と利用可能コート（全面/半面）
- `phase_category_weights` — フェーズのカテゴリ重点ベース（ギャップ信号と合算）
- `load_caps` — 高強度の日/週上限・連続日回避（負荷予算が尊重）

指標（`team-input.*.json` の `indicators`）の達成ギャップが大きいカテゴリほど時間配分が増える。例: FT率が未達ならシュート(フリースロー)に時間が回り、目標到達すると配分が他へ移る。

## 保存層の差し替え（Firestore 後差し替え）

`src/storage.js` は I/O 境界を抽象化しており、エンジン本体は「返ってくる形」だけに依存する。`createLocalStorage` は今ローカル JSON を読むが、Firestore へ移す場合は同じ 3 つの async getter（`getDrills` / `getConfig` / `getTeamInput`）を `team_id` で実装するだけでよい（`createFirestoreStorage` が未実装の swap-in 地点。`teams/{teamId}/config/current` 等のコレクション構成案を同ファイルに記載）。

## テスト（業務意図の検証）

`test/business-intent.test.js` が「コーチが期待する振る舞い」を8シナリオで検証する（FT率が低い→フリースロー/シュートが入る・試合TOが悪い→ハンドリング/パス/意思決定が入る・中学でゾーン系が出ない・年内にセット系が出ない・各日の合計が枠尺以下・高強度の日/週上限と連続日回避・入力を変えると配分が変わる＝固定値でない・故意に違反する計画は対応ゲートが throw）。実シナリオは211件カタログで実パイプラインを通すため、実装をなぞるだけのテストにはなっていない。各層の単体テスト（gap/filter/allocate/loadModel/gates/llm/planWeek）も `test/` にある。

## 負荷モデルの既定値の出典種別

`src/loadModel.js` は数値をハードコードせず config の `load_caps` を尊重するのみ。既定値の考え方（週/日の高強度上限、連続高強度日の回避）は、若年アスリート向けのレジスタンス/プライオメトリクス指導の一般知見（NSCA 系のユース指針・プライオの48h間隔慣行）に基づく。実数はチームごとに config で設定する。
