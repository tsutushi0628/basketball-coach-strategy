# worklog 20260905 紅白戦チーム分け（scrimmage-split）

前セッション名: firebase-kit-bb

## 経緯

### 要求
バスケ部コーチアプリに紅白戦の5対5チーム分け機能を追加する。スマホ前提、名簿はスプレッドシート管理、身長・ポジション・Tierを使い、2〜3チームへの分割を一発で出し、過去3回の履歴から偏りを防ぐ。

### 裁定の変遷
- 置き場は既存のバスケコーチアプリ本体でなく練習計画ツール basketball-coach-strategy 側とし、独立URL `/scrimmage` に置く。練習計画の既存画面は触らない。
- 結果画面に評価に読める数値・語（Tier・役割・身長・学年）を出さない。表示はチームA/B/Cと選手名だけに絞る。差し戻し1回を経て確定。
- ポジションでなく役割の複数選択制にする（ハンドラー・パサー・シューター・スラッシャー(ドライブ)・リムアタッカー(ポストアップ)・エリートディフェンダー・リムプロテクター・リバウンダー）。
- 学年を実力変数に組み込む（実力 = Tier + 0.5 × (学年 − 1)）。
- 入れ替え機能は不要と裁定。もう一回ボタン＝再抽選でよい。
- ブランチを作らず main 直接コミットで進める（個人プロジェクトの既定運用として確定）。

### 実装
- モック `docs/findings/design-20260905-scrimmage-split-mock.html` を承認済み。
- spec は `.spec-workflow/specs/scrimmage-split/`（product/requirements/design/tasks）。旧spec `docs/findings/spec-20260905-scrimmage-split.md`。
- 実装ファイル: `engine/src/scrimmage.js`・`engine/src/roster.js`、`functions/index.mjs`（GET `/scrimmage`、POST `/api/scrimmage/split`・`/api/scrimmage/decide`、POST `/api/roster/sync`）、`functions/roster-sheet.mjs`、`ui/scrimmage-page.mjs`、`scripts/serve-local.mjs`・`scripts/set-roster-sheet.mjs`。
- テスト: engine 167件・functions 98件・ui 277件、全pass。QAサインオフ可。
- コミット: `71d379a`（独立ページ・エンジン・名簿同期）、`a46e3e1`（名簿スプシID設定CLI）、`0ebccb5`（spec配置）、`385d6ad`（ADC標準経路への統一）、`a130018`（feat/scrimmage-split を main へマージ）。

### 外部レビュー
- Codexは認証切れで利用不可。ChatGPT（chappy経由）で壁打ちし2点を採用: 蛇行初期解と人数規則の矛盾、Firestore batched writeの500件上限対応。
- chappyスクリプトにWindows分岐と`type()`改行送信バグの修正を入れた（firebase-kit側、未コミット）。
- ChatGPT側に議論を13分割してしまった会話が1本残っている（次回の壁打ちでは分割回避を意識する）。

### 本番反映
- main `a130018` を本番デプロイ済み（functions render・hosting・indexes）。
- `https://ai-bb-coach.web.app/scrimmage` は未認証で302→`/login`を確認。
- `/healthz` は本番で404（インフラ側の予約パスの可能性、未解決）。
- tenant-genchi に新名簿シートのIDを設定済み。名簿シートはDrive連携で12列版を新規作成し、両サービスアカウント（appspotとfirebase-adminsdk-fbsvc）へ閲覧共有済み。旧9列版は改名して残置。選手データは記入例2行のみで実選手データは未入力。

### 認証
このPCのfirebase/gcloudアクティブ資格は失効していたが、gcloudに残っていた個人アカウントのrefresh tokenからADC（application_default_credentials）をリポジトリ外のローカルパスに作成し、`GOOGLE_APPLICATION_CREDENTIALS`と`GOOGLE_CLOUD_QUOTA_PROJECT=ai-bb-coach`を指定してfirebase CLIとfirebase-adminを通した。対話ログインは不要だった。

### 未確認
- 認証済み状態での`/scrimmage`実描画。
- 名簿同期の本番実走（オーナーがログインして「名簿を同期」を押す操作）。
- エミュレータはJava未導入のため不可（オーナー裁定で対応不要）。

### 環境注意
同じPCで別セッションが3つ動いており、同リポのmainに別施策（週ナビ・練習計画修正）をcherry-pickしていた。作業ツリーに残る未コミット差分・未追跡ファイルは全て別施策のものであり、本セッションの範囲外として触っていない。

<!-- RESTORE-BLOCK-START -->
**次の一手**: オーナーがログインした状態で `https://ai-bb-coach.web.app/scrimmage` の実描画と「名簿を同期」操作の本番実走を確認する。

### 残作業
1. `/scrimmage` の認証済み実描画確認
   → 次の一手: オーナーにログインのうえ画面を開いてもらい、チーム分け結果が表示されるか確認する
2. 名簿同期の本番実走確認
   → 次の一手: オーナーに「名簿を同期」ボタンを押してもらい、Firestoreへの反映件数を確認する
3. `/healthz` が本番で404になる原因調査
   → 次の一手: `functions/index.mjs` のルーティング定義とインフラ側の予約パス一覧を突き合わせる
### オーナー未回答
なし
### 罠
- ChatGPTへの壁打ちで論点を細切れに送ると会話が多数分割される → 前提・論点・結論をまとめて1回で投げる。
- オーナー作業（ログイン・スプシ操作）を頼む前に、このPCに残っている資格やコネクタで代替できないか全部試してから頼む（本セッションで2回指摘された）。
### まず読むファイル
- `.spec-workflow/specs/scrimmage-split/tasks.md`（実装タスクの完了状況を確認するため）
- `functions/index.mjs`（`/healthz`調査のためルーティング定義を確認するため）
- `docs/findings/design-20260905-scrimmage-split-mock.html`（承認済み画面仕様の再確認のため）
<!-- RESTORE-BLOCK-END -->
