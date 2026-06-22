# 引継資料: Firestoreバックエンド化＋コーチ指定の上書き日（2026-06-22）

> 前資料 `docs/findings/handoff-20260614-plan-engine-rebuild.md` の続き。
> 本セッションは「**女子先行**（男子が大会で勝ち上がり新チーム始動が後ろ倒し→女子を 2026/06/23 から先行で始動）」のインプットから始まり、
> (1) 女子0623週の設計、(2) 練習計画サイトを **Firestore バックエンド本番同型構成**へ移行、
> (3) **コーチ指定の上書き日(06/23)** を男女2列タイムラインで実装、まで進んだ。

---

## 概要

### このセッションで達成したこと
コーチが「特定の日にこれをやる」と手で指定したメニューを、システムの正式データ(Firestore)として保存し、既存デザインのタイムラインに表示できるようになった。あわせて、これまで「git の JSON → 静的HTML生成」だった練習計画サイトを、firebase-kit 基盤の本番同型構成（**Firestore ＋ Cloud Functions ＋ Hosting**）に作り変え、Firebase エミュレータでローカルに実URLが立つ状態にした。第1号として **2026/06/23(火)** を、男子=オールコートゲーム／女子=アラウンドシュート の**男女2列・時間スロット別タイムライン**で出した。

### なぜやったか
オーナーが「練習メニューは Firestore に入れてアプリが引くべき（静的HTMLじゃなく）」「システムが自動生成するだけでなく、**コーチが指定した手書きメニューも表示できるようにしろ**」と要求。06/23 は男子が現チームの大会対応で全面を使う特別日で、エンジンの自動生成とは別物のため、手書き上書きの第1号になった。

---

## 実装した機能

### A. Firestore バックエンド化（firebase-kit 基盤）
練習データを Firestore に置き、Cloud Functions が Admin SDK で読んで**既存エンジン(engine/src)＋描画(ui/*.mjs)を無改変で再利用**して HTML を返す。Hosting が全リクエストを Function に rewrite。クライアント直 Firestore アクセスは rules で全 deny。

| ファイル | 役割 |
|---|---|
| `firebase.json` | hosting `**`→`render` 関数 rewrite ＋ emulators ブロック（functions5021/firestore8281/hosting8088/hub4420/ui4020） |
| `.firebaserc` | プロジェクトIDプレースホルダ `demo-basketball-strategy`（エミュレータ用・本番は要差替） |
| `firestore.rules` | クライアント直アクセス全 deny（Functions/Admin のみ） |
| `firestore.indexes.json` | 空（doc 直読みで複合クエリ不要） |
| `functions/index.mjs` | ESM JS・Express・HTTPS関数 `render`。Admin SDK で Firestore を読み、`buildPlanData`+`pattern-timeline.render`+`renderPage` で HTML を返す。`?p=<id>` は `^[a-z-]+$` 検証 |
| `functions/package.json` / `package-lock.json` | firebase-admin・firebase-functions 依存（node_modules は gitignore） |
| `engine/src/storage.js` | `createFirestoreStorage({db,teamId})` を実装（getDrills/getConfig/getTeamInput/getOverrides ＋ getAnnualPlan）。firebase-admin は import せず注入された db のみ使用 |
| `ui/plan-data.mjs` | `buildPlanData({storage,girlsStorage})` に注入化。`loadAnnualPlan` の fs 直読みを `storage.getAnnualPlan()` に、`buildDrillRegistry(rawDrills)` を引数化 |
| `ui/drill-detail.mjs` | `buildDrillRegistry(rawDrills)` 引数化（fs 直読み撤去） |
| `ui/build.mjs` | `renderPage()` export 化・`localStorages()` 追加・直接実行ガード（import 時に静的書出ししない） |
| `scripts/seed-firestore.mjs` | 現 JSON → Firestore(エミュレータ) シード。`FIRESTORE_EMULATOR_HOST` 必須・doc ID 文字種検証 |

**Firestore コレクション**: `drills/{drillId}`（216件）／`teams/{teamId}` config（男女）／`teams/{teamId}/input/latest`／`annualPlan/current`／`overrides/{YYYY-MM-DD}`。

**設計の出所**: firebase-kit 自体はデプロイ対象でなく `firebase-admin` ラッパの**ライブラリ**（テンプレ `firebase-kit/templates/`）。実働リファレンスは **`ai-basketball-coach/`**（同ドメインで本番稼働中・写経元）。

### B. コーチ指定の上書き日（男女2列タイムライン）
`overrides.json`(layout:`two-col`) を保存層 `getOverrides` で読み、`plan-data` の `applyOverrides`/`toTwoColDay` が**実日付一致**で当該日を置換。`pattern-timeline` の `twoColTimeline` が男女2列で描画。

| ファイル | 役割 |
|---|---|
| `engine/data/overrides.json` | コーチ指定の上書き日データ（行ベース・男女2列スキーマ `layout:"two-col"`/`rows`/`both`・`男子`・`女子`） |
| `engine/data/config.sample.json` | `week_start_date:"2026-06-22"` 追加（表示週の実日付起点。`current_month=7` はフェーズ用で不変） |
| `ui/plan-data.mjs` | `applyOverrides(days,overrides,weekStartDate)`（実日付一致・月guard廃止）／`toTwoColDay`・`toAuthoredDay`（layout分岐）／日付ヘルパー（weekStartDate＋曜日→実日付） |
| `ui/pattern-timeline.mjs` | `twoColTimeline()` 新設・`dayTimeline` を twoCol 分岐。日タブの「在席/不在」を**日付(火 6/23)**へ変更。`tll-lg`(見出し16px>項目14px) |
| `ui/render-shared.mjs` | `dayHeader` の coach 分岐（コーチ指定バッジ＋男女両チップ・狙い＝`ov.aim`）／`plainText` の coach・two-col 分岐 |
| `ui/overrides.test.js` | 上書き合流の業務意図テスト（two-col 置換／旧スキーマ互換／別週 bleed なし） |

**06/23 の確定内容（オーナーが対話で確定）**:
- 16:00–17:00 ラントレ（男女共通・全幅）
- 17:00–17:25 男子=**？**（TBD・未確定）／女子=アラウンドシュート（カールからゴール下／カールから正面／レイアップ／エルボー→ゴール下スキップ バウンズ・フロート→タップ／キャッチ&シュート 対面0°・45°／リバウンド→ゴール下、各「全体で10本」）
- 17:25–17:50 男子=オールコートゲーム（全面）／女子=ゲーム（予）※男子の休憩中
- 17:50 終了（18:00 なし）
- **この日のねらい** = 「既存の練習を正しく整理して、より上手くなれるようにする」（オーナー指定）

---

## コミット一覧（main・**ローカルのみ・未push**）
| ハッシュ | 内容 |
|---|---|
| 2dcf2c4 | feat(app): Firestoreバックエンド化とコーチ指定の上書き日を追加（19ファイル・+4050/-70） |

---

## 本番稼働状況
- **ローカル Firebase エミュレータで稼働確認済み**。クラウド本番デプロイ・公開URL: **なし**（プロジェクトID未確定）。
- **push: 未**。コード差分の main push は CLAUDE.md「push前レビュー」により `/code-review`(high) を回してから（未実施）。

### ローカルでの起動方法（再現手順）
要 Java（携帯JRE）＋ `firebase-tools@15.x`（npx）。プロジェクト直下で:
```
JAVA_HOME=<携帯JRE> PATH=<JRE>/bin:$PATH FUNCTIONS_DISCOVERY_TIMEOUT=60 \
  npx -y firebase-tools@15.22.0 emulators:exec --only functions,firestore,hosting \
  --project demo-basketball-strategy "node scripts/seed-firestore.mjs && <常駐>"
```
- 画面: **http://127.0.0.1:8088/?p=timeline**（06/23 は「火」タブ）。
- 一時ヘルパー `scripts/_serve-local.mjs`（seed＋常駐ハング）/`scripts/fetch-0623.mjs`（検証）は **gitignore**（再生成可）。
- ※本セッション終了時点でエミュレータがバックグラウンド起動中の可能性あり。落ちていたら立て直す。

---

## 動作確認済み項目
### 形式整合層（機械検証）
- engine `node --test` 128件緑／ui 31件緑（overrides 含む）。`node ui/build.mjs` 成功・警告0。
- エミュレータ実走: `SEED OK drills=216 overrides=1`、Hosting HTTP 200、**06/23 が Firestore 由来で描画**（Firestore の overrides を削ると画面から消える＝ハードコードでなく Firestore 依存と実証）。

### 意味価値層（メイン PdM の実出力直読）
- 生成HTML（およびエミュレータの実URL fetch）で火 6/23 を実読: 男女2列3スロット・女子アラウンドシュート8本・男子オールコートゲーム・男子17:00=「？」・狙い=「既存の練習を正しく整理して〜」・日タブ=「火 6/23」・逃げ語(余れば/押したら削る)0・「在席」表記0、を実HTMLで確認。
- **06/23 のメニュー内容・時刻・狙いはオーナーが対話で繰り返し差し戻し→確定**（下記教訓1）。

---

## 未解決の判断点（オーナー側アクション待ち）
1. **男子の 17:00–17:25 の中身** ／ 待ち先=オーナー ／ 背景=現在「？」(TBD) ／ 決まったら `overrides.json` の該当 `男子` セル(label/items)に記入→reseed。
2. **クラウド公開（本番URL）** ／ 待ち先=オーナー ／ 背景=Firebase プロジェクト未作成。残: ①実プロジェクトID(`.firebaserc`/`functions/index.mjs` の `demo-basketball-strategy` 差替) ②デプロイ認証 ③`functions/index.mjs` の `../engine ../ui` 相対 import を functions 配下へ vendoring ④名前付きDB `basketball-strategy-db` 実体作成。
3. **push 可否** ／ 待ち先=オーナー ／ 背景=コード差分の main push は `/code-review`(high) 後。レビュー未実施・ローカルコミットのみ。

---

## 既知の注意点・未対応項目
| 優先 | 内容 |
|---|---|
| 高 | クラウドデプロイには `functions/index.mjs` の `../engine ../ui` 相対 import の vendoring（functions 配下へコピー or ローカルパッケージ化）が必須。エミュレータは実FSを辿るので相対 import で動くが本番は同梱が要る |
| 中 | 06/23 以外の女子先行の他日(水木金)は未着手（通常の男女共通生成のまま）。作るなら同じ two-col 上書きスキーマで追加 |
| 中 | 前資料(20260614)の任意フォロー3点（週の焦点10月以降展開／コードレビュー潜在3点根治／配布doc④の曜日別同期）は本セッション未着手・引き続き任意 |
| 低 | エミュレータ運用前提: `firebase-tools@15.x` 必須（14系は functions v7 で functions emulator が落ちる）・Firestore emulator は JRE 必須・`FUNCTIONS_DISCOVERY_TIMEOUT=60`（firebase-admin cold import ~24s）・`public/` は空（index.html を置くと rewrite を食う） |

---

## 開発中に得た教訓
1. **オーナーしか知らない値（コーチング意図・狙い・実スケジュール）は推測で埋めず1問で聞く。逆に既に与えられた／導出可能な情報は聞かず実行する（この線引きが肝）。**
   - 何が起きたか: 06/23 の「狙い」を勝手に「シュートフォーム学習」と推測して激怒（実際は「既存の練習を正しく整理してより上手く」）。男子17:00 を「アップ」と推測して却下（実際は「？」）。時刻も推測で複数回外した。一方、確認しすぎても「聞くな・かんがえろ」と叱責された場面もあり、**線引きは「自分で導出できるか」**。
   - 再発防止: オーナーのドメイン値は推測で埋めない。導出可能・既出のものは聞かず実行。
   - 反映先候補: wasurenagusa（必要なら CLAUDE.md 査読）。
2. **コーチ指定（手書き）の日は、自動生成の枠をそのまま流用するとナンセンスになる。専用表示にする。**
   - 何が起きたか: 「この日のねらい」にスケジュール要約、日タブに「在席」、メニュー見出しが項目より小さい、女子だけ1列＝男子のゲームが見えない、等。
   - 再発防止: 手書き日は狙い=コーチ指定の目的・タブ=日付・男女2列で出す。
   - 反映先候補: 本引継書／wasurenagusa。
3. **テスト緑 ≠ 本番表示。** 月guard のユニットテストは緑だが、実ビルド(`current_month=7`)では 06/23 が出ていなかった（month guard が 6≠7 で弾く）。実出力HTMLを実読して発覚。
   - 再発防止: シミュ（テスト引数直渡し）でなく本番経路の実出力で判定。
   - 反映先候補: 既存 wasurenagusa（sim_patch_vs_prod）の補強。
4. **Firebase エミュレータ運用の落とし穴（再現用）**: firebase-tools 15.x 必須／Firestore emulator は JRE 必須／`FUNCTIONS_DISCOVERY_TIMEOUT=60`／`public` 空／**コード変更はエミュレータ再起動が必要（reseed だけでは render コードが反映されない）、データのみ変更なら reseed で足りる**。
   - 反映先候補: wasurenagusa。

---

## 次セッションへの引継指示
優先順（上が高い）:
1. **06/23 の男子 17:00–17:25 を確定** — オーナーから値を聞いて `overrides.json` の `男子` セルに記入→reseed→実URLで確認。
2. **オーナーが push を許可したら `/code-review`(high) を回してから push**（コード差分あり・未レビュー・ローカルコミット 2dcf2c4 のみ）。
3. **クラウド公開**するなら Firebase プロジェクト作成＋vendoring＋デプロイ（オーナー判断後）。
4. 女子先行の他日(水木金)を作るなら、同じ two-col 上書きスキーマで `overrides.json` に追加。
5. 前資料(20260614)の任意フォロー3点は引き続き任意。

## 議論再開ポイント（キャッチアップ手順）
- **5分**: 本資料。
- **10分**: ローカルでエミュレータ起動（上記手順）→ http://127.0.0.1:8088/?p=timeline の「火」タブで 06/23 を見る。
- **詳細**: `engine/src/storage.js`(createFirestoreStorage)・`ui/plan-data.mjs`(applyOverrides/toTwoColDay)・`ui/pattern-timeline.mjs`(twoColTimeline)・`functions/index.mjs`。リファレンスは `ai-basketball-coach/`。
