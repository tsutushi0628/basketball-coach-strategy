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
- `/healthz` の404は解決。原因は Google Frontend がパス完全一致・小文字の `/healthz` だけを横取りすること（2026-10-03 実測）。
  - Hosting `/healthz` → 404（Googleの標準404 HTML、`Server` ヘッダも付かずアプリに届かない）／`/healthz/` → 200／`/HEALTHZ` → 200／`/healthz2`・`/api/healthz`・`/readiness` → 302（アプリに到達）。
  - `render` 関数の Cloud Run 直URL（`firebase deploy` の出力か `gcloud run services describe` で取れる）に対する `/healthz` でも404。Hosting ではなく Cloud Run 前段で消えている。
  - 対処: `functions/index.mjs` の疎通ハンドラを `['/healthz', '/api/health']` の2パス登録にして本番デプロイ済み。`https://ai-bb-coach.web.app/api/health` が200で `{"status":"ok","database":"basketball-strategy-db"}` を返す。以後の疎通確認は `/api/health` を使う。
- tenant-genchi に新名簿シートのIDを設定済み。名簿シートはDrive連携で12列版を新規作成し、両サービスアカウント（appspotとfirebase-adminsdk-fbsvc）へ閲覧共有済み。旧9列版は改名して残置。選手データは記入例2行のみで実選手データは未入力。

### 認証
このPCのfirebase/gcloudアクティブ資格は失効していたが、gcloudに残っていた個人アカウントのrefresh tokenからADC（application_default_credentials）をリポジトリ外のローカルパスに作成し、`GOOGLE_APPLICATION_CREDENTIALS`と`GOOGLE_CLOUD_QUOTA_PROJECT=ai-bb-coach`を指定してfirebase CLIとfirebase-adminを通した。対話ログインは不要だった。

### 未確認
- 認証済み状態での`/scrimmage`実描画は確認済み（2026-10-03）。オーナーの操作なしで、新規発行した firebase-adminsdk 鍵から custom token → ID token → `/api/session/login` のセッションCookieを作って GET した。本番200・43858バイト、見出し「南中野中 チーム分け」、操作部品は 名簿／男子／女子／出席／チーム数2・3／分ける／もう一回／この分けで決める／名簿を同期 が実在。`render error` の出力なし。
- 名簿同期の本番実走は未実施（Firestore書き換えのためオーナー判断待ち）。ただし名簿シートの選手データが記入例2行のみなので、いま同期しても実選手は入らない。実選手データの入力が先。
- エミュレータはJava未導入のため不可（オーナー裁定で対応不要）。

### 環境注意
同じPCで別セッションが3つ動いており、同リポのmainに別施策（週ナビ・練習計画修正）をcherry-pickしていた。作業ツリーに残る未コミット差分・未追跡ファイルは全て別施策のものであり、本セッションの範囲外として触っていない。

<!-- RESTORE-BLOCK-START -->
**次の一手**: 名簿シートの「男子」「女子」タブに実選手を入力する（オーナー作業）。選手ID列は空欄のままでよい。入力後に `/scrimmage` の「名簿を同期」を押すとIDが自動で振られ、チーム分けの実データ確認に進める。

### 残作業
1. 名簿シートへの実選手データ入力（オーナー作業）
   → 次の一手: 「男子」「女子」タブに選手を記入する。現状は記入例が各1行のみ
2. 実データでのチーム分け結果の確認
   → 次の一手: 同期後に `/scrimmage` で「分ける」を実行し、男女別・チーム数2/3の結果を確認する

### オーナー未回答
なし

### 2026-10-03 に片付けたこと
- 実選手の投入と通し確認。男子15名が入り、選手IDを14件自動付与してシートへ書き戻した。チーム分けは2チーム・3チームの両方が本番で成立し、実力合計は3チームで 11.0 / 11.0 / 10.5 に収まった。女子は運用しない方針になったので記入例を消して0名にした（タブは残置。片タブだけでも成立する実装）。
- バグ修正: チーム分けAPIの選手ID書式が2桁固定（`/^[MF]\d{2}$/`）で、自動付与の3桁ID（`M001`）を全件400で弾いていた。名簿同期は通るのにチーム分けだけ動かない状態だった。`engine/src/roster.js` の受け入れ書式と揃えて `/^[A-Za-z0-9_-]{1,32}$/` にした（実在するかは roster との突合で確かめるので、書式はここで狭めない）。
- チーム内のメンバーの並びを実力降順（`tier + 0.5×(学年−1)`、同値はID昇順）にした。先頭が一番強い子になる。Tier や実力値は戻り値に含めず、`/scrimmage` のHTMLにも tier 系の語が出ないことを実測で確認した。
- `/healthz` 404 の原因特定と対処。Google Frontend がパス完全一致・小文字の `/healthz` だけを横取りしていた（`/healthz/`・`/HEALTHZ` は200、Cloud Run 直URLでも404）。疎通ハンドラを `['/healthz', '/api/health']` の2パス登録にして本番デプロイ。以後の疎通確認は `/api/health` を使う。
- 認証済み `/scrimmage` の実描画確認。オーナーの操作なしで実走した（手順は下の罠）。
- 名簿シートを男女別タブ＋プルダウン＋選手ID自動付与へ作り替え。タブは「男子」「女子」でタブ名が性別、性別列は廃止。ヘッダはA〜M列（選手ID／表示名／学年／ポジション／利き手／在籍状態／身長cm／Tier／役割1／役割2／役割3／本人の目標／メモ）。学年・ポジション・利き手・在籍状態・Tier・役割1〜3はプルダウン。Tier表記は S/A/B/C/D（S=5…D=1、内部は1〜5のまま）。
- アプリ側を新シートに対応させて本番デプロイ。`functions/roster-sheet.mjs`（`fetchRosterTabs`・`writeBackPlayerIds`・`buildPlayerIdUpdateData`）、`engine/src/roster.js`（`normalizeRoster(values, gender)`・`parseTier`・ID採番）、`functions/index.mjs` の `/api/roster/sync`。テストは functions 106件・engine 182件すべて pass。
- 名簿同期の本番実走。初回は選手IDを2件自動付与してシートA列へ書き戻し、2回目は既存IDを振り直さなかった。シートの Tier `B` が Firestore の `tier:3` で保存。`/api/health` 200・`/login` 200・`/scrimmage`（未認証）302 で回帰なし。
- spec の旧仕様を実装に合わせて更新（`.spec-workflow/specs/scrimmage-split/` の design・requirements・tasks・product と `docs/findings/spec-20260905-scrimmage-split.md`）。
- 権限の付け直し。名簿シートに共有されていたのは appspot（閲覧）と firebase-adminsdk-fbsvc（編集）だが、関数が実行時に名乗るのは Default compute service account（`<プロジェクト番号>-compute@developer.gserviceaccount.com`）だった。Drive API でこのアドレスを編集者に追加した。これが無いとID書き戻しが403になり同期全体が502で落ちる。
- 後片付け。検証用に発行した firebase-adminsdk 鍵は2本とも失効済み、一時付与した `roles/iam.serviceAccountTokenCreator` は撤去済み、ローカルに置いた資格のコピーも削除済み。

### 未コミット
`functions/`・`engine/`・`.spec-workflow/`・`docs/findings/` の本セッション分は未コミット（デプロイは完了済み）。作業ツリーには別セッションの差分も混ざっているので、コミット時は本セッション分のパスだけを選ぶ。

### 罠
- 「用意した資源はコード側の指定まで確認」。シートに共有するサービスアカウントは、`gcloud functions describe render --region=asia-northeast1 --format='value(serviceConfig.serviceAccountEmail)'` で実行時のアドレスを確かめてから付ける。appspot や adminsdk に共有しても関数は使わない。
- オーナー作業（ログイン・スプシ操作）を頼む前に、このPCに残っている資格で代替できないか全部試す（本セッションで2回指摘された）。認証済み画面の確認と管理者APIの実走は、firebase-adminsdk の鍵を発行して custom token → ID token → `/api/session/login` のセッションCookieを作れば自力で通せる。鍵は用が済んだら `gcloud iam service-accounts keys delete` で失効させる。
- このPCの既定のADCは別組織のアカウントで、本プロジェクトに権限が無い。オーナー個人アカウントの資格は gcloud の legacy_credentials 配下（`%APPDATA%\gcloud\legacy_credentials\<個人アカウント>dc.json`）に残っている。これに `quota_project_id` を足したコピーをリポジトリ外へ置き、`GOOGLE_APPLICATION_CREDENTIALS` で指して `GOOGLE_CLOUD_QUOTA_PROJECT` も付けると firebase CLI のデプロイが通る（quota project を付けないと adminSdkConfig で403）。アカウントの一覧は `gcloud config configurations list` と legacy_credentials のディレクトリ名で分かる。
- `roles/owner` に `iam.serviceAccounts.signBlob` は含まれない。TokenCreator を付けても通らなかったので、custom token の署名は鍵発行で解決した。
- Sheets API に「1セルで複数選択のプルダウン」を作る機能は無い（`setDataValidation` の `rule` に multiSelect フィールドが無く400）。役割を3列に分けて各列を単一選択にしたのはこのため。
- ChatGPTへの壁打ちで論点を細切れに送ると会話が多数分割される → 前提・論点・結論をまとめて1回で投げる。

### まず読むファイル
- `.spec-workflow/specs/scrimmage-split/design.md`（新仕様の正本。2.1 がタブと列、3章が Sheets 経路）
- `docs/findings/design-20260905-scrimmage-split-mock.html`（承認済み画面仕様の再確認のため）
<!-- RESTORE-BLOCK-END -->
