# 2アプリ統合 — 設計

> 製品方針が「1製品」に確定。差別化の核は「試合スタッツ → 練習計画エンジンの指標入力（team-input）へ流し込み、弱点カテゴリに練習時間が自動で寄る」接合。現状は計画側（ai-bb-coach）と記録側（ai-basketball-coach-15c78）が別 GCP プロジェクト・別 Firestore named DB に分かれ、接合は「別DB同期」になっている。これを home＝計画側プロジェクトへ1本化し、接合を「同一プロジェクト内のクエリ/書き込み」で成立させる。
>
> 本書は計画側の既存設計書 `docs/specs/multitenant/design.md` の §番号体系・データ境界（storage 層）・全 deny rules・fail-fast の作法を踏襲する。引用時は `multitenant §N` と書く。
> 接合入口（`engine/src/gap.js` の METRIC_TO_CATEGORY ／ `engine/src/types.js` の Indicator・TeamInput ／ `tenants/{tid}/teams/{teamId}/input/latest`）は **エンジン本体・指標表とも無改造** で成立させる。記録側がこの doc へ Indicator[] を書くだけで弱点カテゴリに時間が寄る。

---

## 0. 用語と既存事実（裏取り済み）

| 略号 | 指すもの | 裏取り |
|---|---|---|
| 計画側 | 練習計画エンジン＋SSR描画＋マルチテナント | `.firebaserc` prod=ai-bb-coach ／ `firebase.json` database=basketball-strategy-db |
| 記録側 | 試合スコアリング＋スタッツ集計＋SPA | `ai-basketball-coach/.firebaserc` default=ai-basketball-coach-15c78 ／ database=ai-basketball-coach-db |
| 接合 doc | エンジンが弱点を読む指標入力 | `tenants/{tid}/teams/{teamId}/input/latest`（`engine/src/storage.js` getTeamInput） |
| home | 統合後の単一 GCP プロジェクト | ai-bb-coach（オーナー確定） |

両側とも `tenants` / `users` / `memberships` / `teams` を各自の named DB に重複保有する。Firebase project ID = GCP project ID は1:1（別 DB は同一プロジェクト内に複数置けるが、別プロジェクトの DB は跨いでクエリできない）。

---

## 1. 決定とその理由

### 1.1 決定 — 1プロジェクトへ統合する（別プロジェクト維持を採らない）

接合（試合スタッツ → team-input）は「ある団体（tenant）の、あるチーム（own）の最新試合集計を、同じ団体・同じチームの計画入力に渡す」操作で、両端が **同一の identity（tenant・team・membership）に属する**。identity が2プロジェクトに分裂していると、接合のたびに「どの tenant が向こうのどの tenant か」「どの own team が boys/girls のどちらか」を**プロジェクト境界を跨いで突合**し続けることになる。これは恒久的な同期基盤（双方向 ID マッピング表・整合監視・再送）を製品の心臓部に抱える設計で、差別化の核そのものを最も脆い場所に置く。

1プロジェクトに統合すると、接合は「同じ DB の別 doc を読む／書く」だけになり、同期基盤が**消える**。identity（users/tenants/memberships/teams）を1つにすれば、突合は1回（移行時）で終わり、運用時は発生しない。

### 1.2 別プロジェクト維持が正当化される条件（現状いずれも非該当）

別プロジェクトを正当化するのは次のいずれかが成り立つときだけ。

- **別課金主体**：2アプリの請求先・原価管理を法人レベルで分離する必要 → 非該当（同一プロダクト・同一事業）。
- **別所有/別組織**：データ所有者・運営主体が別法人で、相互にデータを見せられない → 非該当（同一オーナー）。
- **別コンプラ境界**：規制・データ所在地要件が2系統で異なる → 非該当（同一国内・同一要件）。
- **桁違いスケール**：一方が他方の容量/QPS を律速し物理分離が要る → 非該当（部活単位のテナント数・1テナント数チーム）。

現状どれも満たさない。よって統合が正しい。

### 1.3 home＝ai-bb-coach（計画側）の根拠

- **identity・テナント・認証・招待が実装済みなのは計画側**：`functions/tenant-resolve.mjs`（uid→在籍テナント解決）・`functions/tenant-template.mjs`（テナント初期化）・multitenant §3〜§4（セッション Cookie・register 招待）が稼働している。記録側にも `with-tenant--gate--from-memberships.ts`・`invitations--crud--handlers.ts` があるが、**移行コスト訂正（§6）**のとおり「テナント基盤を新規に立てる」必要は計画側に無い。identity の真実源が既にある側を home にすれば、もう一方は「データを持ち込む」だけで済む。
- **接合 doc（team-input）の所有者が計画側**：エンジンが読む `input/latest` は計画側 named DB（basketball-strategy-db）にある。home を計画側にすれば接合は「自 DB 内 write」になる。記録側を home にすると、エンジンの読み口を別プロジェクトへ向け直す不可逆改修が要る。
- **差別化の核（計画自動調整）が計画側にある**：核を動かさず、周辺（記録）を寄せる方が破壊範囲が小さい。

記録側は「現状データを home へ移送して持ってくる」（オーナー確定）。

---

## 2. データモデル統合

home は単一 GCP プロジェクト ai-bb-coach。Firestore は §4 のとおり接合面と高頻度生データで named DB を分ける。クライアント直アクセスは全 deny を維持し（multitenant §1・§8）、分離はサーバ（Admin SDK）コードだけが守る。

### 2.1 identity 系（users / tenants / memberships）の突合

両側の identity は構造が一致しており、**統合は「片側を正本にし、もう片側を写像して取り込む」**で足りる（新スキーマ発明は不要）。

| コレクション | 計画側（正本候補） | 記録側 | 突合方針 |
|---|---|---|---|
| `users/{uid}` | doc ID=uid・`{authUid,email,isSuperAdmin?}` | doc ID=uid・`{authUid,displayName,email,status,isSuperAdmin?}` | doc ID（=Firebase Auth uid）で自然キー突合。**両アプリは同一 Firebase Auth（同一 GCP プロジェクト化後）を共有**するため、同一人物は同一 uid。記録側の `displayName`/`status` を計画側 user に**追加マージ**（上書きでなく欠損補完）。|
| `tenants/{tid}` | `{id,name,status,initialized,createdBy}` | `{id,name,category,plan,status}` | doc ID は移行時に**計画側採番を正本**にし、記録側 tenant は §5 移行表で計画側 tid へ写像。`category`/`plan` は記録側から取り込む（計画側に無い属性は追加）。|
| `memberships/{id}` | `{tenantId,userId,role:'owner',isAdmin?,joinedAt,leftAt?}` | `{tenantId,teamId,userId,role:coach\|advisor\|player\|parent,isAdmin?,linkedPlayerId?,joinedAt,leftAt?}` | フラット集合・コードでゲート（multitenant §1）。**ロール語彙の統一が最大リスク（§2.2）**。記録側の `teamId`/`linkedPlayerId` を保持したまま取り込む。|

`users`/`memberships`/`tenants`（管理データ）はフラットのまま（横断クエリ `where(userId==uid)`・トークン照合のため。multitenant §1「なぜこの分け方か」）。

### 2.2 ロール語彙の統一（最大の実装リスク＝認可漏れ防止）

計画側は `role:'owner'` の1値のみ（multitenant §3「MVP は owner のみ」）。記録側は `coach | advisor | player | parent` の4値＋`isAdmin`/`isSuperAdmin`（`with-tenant--gate--from-memberships.ts`・`check-role-permission--authorize--by-role.ts`）。**2つの語彙が無調整で1つの DB に同居すると、ある経路は owner を期待し別経路は coach を期待して、片方が認可を素通りさせる**。これが統合の最大事故源。

**対策：単一の「ロール → 権限」真実源を1つだけ置き、両アプリの認可をそこに集約する。**

- 統合後の正規ロール語彙は**記録側の4値を採用**する（計画側の owner より表現力が広く、player/parent の閲覧限定が既に実装済み。`stats--resolve-allowed-player.ts` が player/parent を自分の playerId に強制限定している）。
- 計画側の `owner` は**「coach かつ isAdmin:true」へ写像**する（計画側 owner ＝「テナント所有コーチ・編集可・isAdmin:true」multitenant §3 と意味一致）。
- 「ロール → できること」の対応表を**1ファイル（権限決定の単一真実源）**に置き、計画側の編集系（override 保存・削除）と記録側の全ハンドラがこの表だけを参照する。計画側に散っている `role==='owner'` 直書き判定は、この表経由（例：「編集権限を持つか」述語）に置換する。

| 正規ロール | 計画（練習計画）側でできること | 記録（スコアリング）側でできること | 由来 |
|---|---|---|---|
| coach + isAdmin | 計画閲覧・override 編集・招待発行（テナント管理者なら） | 全試合の記録・編集・スタッツ閲覧・名簿管理 | 計画 owner ＝ ここへ写像 |
| coach | 計画閲覧・override 編集 | 試合記録・編集・スタッツ閲覧 | 記録側 coach |
| advisor | 計画閲覧 | スタッツ閲覧（記録は coach 権限に準ずる運用） | 記録側 advisor |
| player | 自分の計画閲覧 | 自分の playerId のスタッツのみ | 記録側 player |
| parent | 子の計画閲覧 | 子の playerId のスタッツのみ | 記録側 parent |
| isSuperAdmin（直交フラグ） | 招待発行（プラットフォーム所有者） | 同左 | 両側共通・`users.isSuperAdmin` |

ロール認可（membership.role / isAdmin）と管理者フラグ（users.isSuperAdmin）は**直交2系統**で解決する（混在表は全組合せで破綻するため分ける。両側とも既にこの作法。multitenant §3 ／ 記録側 `TenantContext`）。統合はこの2系統を**そのまま**1つの権限表に束ねるだけで、新しい軸を増やさない。

> 失敗モード（§7）：写像の取りこぼし1箇所で認可が緩む／きつくなる。実装時は「両アプリの全書き込み経路を列挙し、各経路が権限表のどの述語を通るか」をチェックリスト化して全件確認する（multitenant §8 のセキュリティ不変条件を統合版に拡張）。

### 2.3 チーム粒度の写像（計画 boys/girls ⇄ 記録 own/opponent）

- 計画側：テナント内**固定2チーム** `tenants/{tid}/teams/{boys|girls}`（`tenant-template.mjs`・`storage.js` teamId='boys'|'girls'）。
- 記録側：**任意件数**の `teams/{teamId}`・`kind:'own'|'opponent'`・`season?`（`types/index.ts` Team）。コーチの自チームは `kind:'own'`、対戦相手は `kind:'opponent'`。

**写像方針：接合に必要なのは「記録側 own チーム → 計画側 boys/girls」だけ。**

- 計画側の `boys`/`girls` は**接合の宛先キー**として維持する（エンジンが `teamId` を 'boys'|'girls' で読むため。無改造前提を守る）。
- 記録側の各 `own` チームに、**どの計画スロット（boys/girls）に流すか**を表す対応フィールドを1つ持たせる（記録側 Team に `planTeamSlot?: 'boys'|'girls'` を追加、または membership/tenant 設定に写像表を1つ置く）。男女別運用なら男子 own→boys・女子 own→girls。男女別でない単一チーム運用なら own→boys 固定（girls は空テンプレのまま）。
- `opponent` チームは**接合の対象外**（自チームの弱点に相手の集計は流さない）。記録のためだけに存在し続ける。
- 計画側の固定2チーム制約は当面維持する（エンジンの単独チーム前提・`shared_gym` 男女ローテ仕様が boys/girls に依存。MEMORY「組違い」「シーズン構造」参照）。将来 own チームが3つ以上になる運用が出たら、スロットを増やすのではなく「どの own を主計画対象にするか」を選ばせる（スコープ外・§7 未決）。

### 2.4 players（記録側専有・接合の臨界パス外）

`players/{id}`（`types/index.ts` Player・`tenantId`/`teamId`/`linkedUserId`）は記録側専有。接合（team-input への集計書き込み）は**チーム単位の集計値**で成立し、選手個人を跨がない（§3）。よって players は移送して持ち込むが、**統合の臨界パス外**。

- 学年（grades）↔ 個人（player）のマッピングは**将来**（エンジンの `grades` は現状チーム config の固定値。選手個人の学年を計画に効かせるのは別スコープ）。
- `membership.linkedPlayerId` / `player.linkedUserId` は記録側の本人紐付け。移送時にそのまま保持する（player/parent 認可が依存）。

### 2.5 drills（計画側グローバル台帳を唯一のカタログに）

`drills/{drillId}`（計画側グローバル・テナント非依存・216件・multitenant §1）を**統合後の唯一のドリルカタログ**にする。

- 両アプリが同一 `drillId` を参照する（計画側はプラン生成で、記録側は将来「この弱点にこのドリル」提示で参照しうる）。
- 記録側に独自ドリル台帳があれば（現状の探索範囲では未確認）、移送時に drillId を計画側採番へ突合・統一する。無ければ計画側台帳をそのまま唯一の正本にする。
- drills はグローバル共有のまま named DB は接合面（§4）に置く。

---

## 3. 接合の契約（記録 → 計画 team-input）

**エンジン無改造。記録側が「試合終了 → 集計 → Indicator[] へ変換 → team-input へ Admin SDK で書込」する。** エンジンは `input/latest` を読むだけ（`storage.js` getTeamInput → `gap.js` computeGapWeights）。

### 3.1 トリガと集計

- **トリガ**：記録側で対象 own チームの試合が `finished` に確定したとき（`matches--validate-status-transition.ts` の finished 遷移後）。または期間集計の再計算時。
- **集計の出所**：新規計算は不要。記録側に既存の `handleGetTeamRangeStats`（`team-range-stats--handler.ts`）が、`tenantId`+`ownTeamId`+期間で `aggregateBoxScore` のチーム合計（`ftPct`/`to`/`fga`/`ftm`/`fta` 等）を**既に算出**している。接合 writer はこのチーム合計を Indicator[] に整形して書くだけ（決定論・LLM 不使用）。

### 3.2 指標 ID 対応表（記録の集計項目 → 計画の指標 id）

エンジンの `METRIC_TO_CATEGORY`（`gap.js`）が解釈できる指標 id は **`'FT率'` / `'試合TO'` / `'ゴール下成功率'`** の3つ。これ以外の id を書いても `gap.js` は「unknown indicator → no contribution」で安全に無視する（前方互換）。よって接合 writer はまずこの3つを満たす。

| 計画の指標 id | good_direction | 記録側の集計ソース（裏取り） | latest 算出 | unit |
|---|---|---|---|---|
| `FT率` | up | チーム合計 `ftm`/`fta`（`stats--aggregate-box-score` → `calcFtPct`） | `ftm/fta×100`（fta=0 は no-signal→欠損で送る） | `%` |
| `試合TO` | down | チーム合計 `to`（box-score の team.to） | 直近 N 試合平均 TO（試合あたり本数） | `本` |
| `ゴール下成功率` | up | `shot` イベントの `zone='under-basket'` made/attempt（`stats--aggregate-shot-chart.ts` ／ ShotZone='under-basket'） | under-basket の made/attempt×100 | `%` |

- `baseline`：シーズン開始時点の同集計（移行/シーズン切替時に確定し固定）。
- `target`：コーチ設定の目標値（計画側 team-input テンプレの target を維持／コーチが上書き）。writer は latest だけ更新し、baseline/target は既存値を保持する（上書きしない）。
- **欠損の扱い**：分母0（fta=0 等）は `gap.js` が non-finite を no-signal として弾く設計（`gapRatio`・`computeGapWeights`）。writer は代理数字で埋めず、欠損は欠損のまま（latest を非有限/未設定）で送る。これで「計測できていない指標は弱点判定に効かない」が自然に成立する（CLAUDE.md 行動原則3「未計測は明示」と一致）。

### 3.3 書込タイミング・冪等性・上書き方針

- **宛先**：`tenants/{tid}/teams/{boys|girls}/input/latest`（§2.3 の写像で own→slot を解決）。doc ID は決定論（`latest`）。
- **冪等**：同じ試合確定で2回走っても同じ latest になる（集計は matchEvents の純関数）。`set`（merge）で `indicators` 配列と `team_id`/`grades` を上書き、baseline/target は既存値を残すため `merge:true` で indicator 単位の再構成は writer 側で行う（latest だけ差し替え）。
- **上書き方針**：latest のみ writer が所有。baseline/target はコーチ（計画側 UI）が所有。両者の所有境界を分けることで、試合のたびに目標が動く事故を防ぐ。
- **観測可能性**：writer は start/end・対象 tenant/team・書いた指標数を構造化ログに出す（_common-rules「観察可能性は最初から仕込む」）。沈黙書き込みにしない。

> 失敗モード（§7）：記録側の own→slot 写像が未設定だと書込先が解決できない。writer は写像未設定なら**書かずに警告ログ**（throw でなく warning。エンジンは旧 latest で動き続ける）。これは接合の業務整合検査であり LLM 出力ガードと同じ warning 設計の方針（CLAUDE.md LLM設計原則③に準ずる思想）。

---

## 4. Firestore 構成（named DB・rules・IAM）

home＝ai-bb-coach の単一プロジェクト内に、**named DB を2つ**置く折衷を採る。

### 4.1 named DB の配置

| named DB | 置くもの | 理由 |
|---|---|---|
| 接合面 DB（基点候補 `basketball-strategy-db`） | identity（users/tenants/memberships/invitations）＋ teams（boys/girls config）＋ team-input（`input/latest`）＋ drills ＋ annualPlan ＋ overrides ＋ players | 接合（write）と計画読みが**同一 DB 内**で閉じる。エンジンの読み口（既存 basketball-strategy-db）を動かさず済む |
| 記録生データ DB（記録側 `ai-basketball-coach-db` を移送先に） | matches ＋ matchEvents（高頻度・大量の試合イベントログ） | 試合中の高頻度 write が接合面 DB の読みレイテンシ/コストを汚さない。スタッツ集計はこの DB 内で完結 |

- **クロス named-DB クエリは不可**だが、**接合は write 方式**なので両立する。記録側ハンドラは「記録生データ DB を読んで集計 → 接合面 DB の team-input へ書く」。両 DB に Admin SDK で接続するのは1プロセス内で可能（named DB ごとに Firestore インスタンスを取る）。
- identity を接合面 DB に置くのは、計画側の `tenant-resolve.mjs`・記録側の `with-tenant--gate` が**同じ memberships を引く**必要があるため。identity を2 DB に割ると統合の意味が消える。記録側ハンドラのテナントゲートは接合面 DB の memberships を引くよう向け直す。
- **基点 vs 新設**：接合面 DB を既存 `basketball-strategy-db` にすれば計画側エンジンの読み口は無改造。ただし「basketball-strategy」という名が統合後の全 identity を含む実態と乖離する。命名の乖離は許容し**既存 DB を基点に据える**（DB リネームは不可逆・高コストで、名前の意味ずれより実害が小さい）。これは設計判断であり、新規 named DB を切って全部移す代替案より破壊範囲が小さいことを理由に選んだ。

### 4.2 Security Rules / IAM / サービスアカウント境界

- **Rules**：両 DB とも**全 deny を維持**（multitenant §1・§8）。クライアントは Firestore へ直アクセスせず、すべて Cloud Functions（Admin SDK）経由。統合で rules は緩めない。
- **IAM**：両 functions コードベース（§5 でアプリ別に分離）のサービスアカウントは、**両 named DB への Firestore アクセス権**が要る（記録側 functions が接合面 DB へ書くため）。最小権限で「この2 DB のみ」に絞る。
- **サービスアカウント境界**：計画 functions と記録 functions を別 SA にし、各 SA のロールを必要な DB・Secret（Gemini キー等）に限定する。記録側の AI 機能（`ai-review--handler`）の Gemini キーは Secret Manager 管理（記録側 `config.ts` 準拠）を home の Secret Manager に移す。
- **越境チェック**：tenantId を必須にし空なら即 throw するスコープ付き storage を唯一のデータ経路にする作法（multitenant §7-d）を、接合 writer にも適用する（書込先 path に tenantId/teamId を構造的に強制）。

---

## 5. 段階移行計画

各フェーズの可逆性とロールバックを明記する。**P2 のみオーナー Go ゲート**（本番不可逆）。P0・P1 は非破壊でオーナー Go 不要（コミット/デプロイは別途承認）。

| フェーズ | 内容 | 可逆性 | ロールバック |
|---|---|---|---|
| **P0 設計** | 本書。識別子対応表・接合契約・ロール権限表の確定 | 完全可逆（文書のみ） | 破棄 |
| **P1 非破壊スキャフォールド** | ①home に記録生データ用 named DB を新設（空）②home（ai-bb-coach）に記録 functions を**別コードベース**として追加（`firebase.json` の functions 配列に2つ目を追加・codebase 名を分ける）③マルチサイト Hosting 設定（計画 SSR サイト＋記録 SPA サイトの2サイト・`firebase.json` hosting を配列化、各サイト rewrites 維持）④識別子整合（記録側 functions の Firestore 接続先を home の2 DB に向ける設定・SA・Secret 整備）⑤接合 writer 実装（§3・記録生データ DB 読み→接合面 DB team-input 書き・新規 writer モジュール）⑥ロール権限表の単一真実源化（§2.2・両アプリの認可を集約） | 可逆（旧2プロジェクトは無傷で並走。home 側は空 DB＋未配線で本番影響なし） | home 側の新設リソースを削除。旧プロジェクトはそのまま稼働 |
| **P2 本番不可逆（オーナー Go ゲート）** | ①記録側の**本番データ**（tenants/users/memberships/teams/players/matches/matchEvents）を ai-bb-coach の2 DB へ移送（一度きり・冪等スクリプト・§5.1）②記録フロント（SPA）と記録 functions の向け先を home へ切替③identity の突合確定（記録 tenant→計画 tid 写像・uid 突合・ロール写像）④旧プロジェクト（ai-basketball-coach-15c78）を退役（読み取り専用化→停止） | **不可逆**（本番データ移送・公開 URL 切替） | 移送前スナップショット保持。切替直後は旧プロジェクトを読み取り専用で温存し、不整合検知で DNS/Hosting を旧へ戻す窓を設ける |

### 5.1 P2 移送スクリプト（一度きり・冪等）

計画側 `scripts/migrate-to-multitenant.mjs`（multitenant §5）の作法を踏襲した別スクリプト。

- 記録 tenant ごとに計画側 tid を割当（新規 or 既存テナントへ合流）。割当表は環境変数/設定で渡し実値を埋め込まない（multitenant §5「所有者 uid は実値を書かない」）。
- users：uid 自然キーで突合・欠損補完マージ（§2.1）。
- memberships：ロール写像（owner→coach+isAdmin 等・§2.2）を通して再構成。
- teams：記録 own→計画 boys/girls スロット写像（§2.3）。opponent はそのまま記録生データ DB へ。
- players/matches/matchEvents：記録生データ DB へ移送（tenantId を新 tid へ書換）。
- drills：計画側を正本に統一（§2.5）。
- 冪等：移送済み doc は skip（決定論 doc ID への set）。途中失敗で再実行可能。
- **インサイダー級データの作法**：実値を会話・サブエージェント報告に出さず件数・成否・桁感で検証（CLAUDE.md 機密原則）。

---

## 6. 移行コスト見積り（前提訂正を含む）

**前提訂正：計画側はテナント・認証・招待を実装済み（`tenant-resolve.mjs`・multitenant §3〜§4 が稼働）。よって「統合のためにテナント基盤を新規に立てる」作業は不要。** 記録側にもテナントゲート（`with-tenant--gate`）・招待（`invitations--crud`）があり、両側ともマルチテナントは既存。統合コストの主は「2つの既存 identity を1つに突合・写像する」ことであって、基盤の新規構築ではない。

| 作業 | 規模感 | 主因 |
|---|---|---|
| ロール権限表の単一真実源化（§2.2） | 中〜大 | 計画側の `role==='owner'` 直書きを述語経由に置換・全書込経路の認可確認。**最大リスク** |
| 接合 writer（§3） | 小〜中 | 集計は既存（`team-range-stats--handler`）。Indicator 整形＋2 DB 接続＋写像解決のみ |
| named DB 2本・SA・Secret・マルチサイト Hosting（P1） | 中 | 設定作業中心。記録 functions の接続先向け直し |
| 本番データ移送スクリプト（P2） | 中 | 冪等・写像・件数検証。識別子書換が中心 |
| 記録フロント/functions の向け直し（P2） | 中 | SPA の API ベース URL・functions の DB 接続先 |
| エンジン本体・指標表・計画 UI | **ゼロ** | 接合は無改造で成立（接合入口が既に Indicator 契約） |

統合の節約点：同期基盤（双方向 ID マッピング・整合監視・再送）を**作らずに済む**（§1.1）。これが別プロジェクト維持に対する恒久的コスト差。

---

## 7. 失敗モード・未決事項（自己敵対的）

### 7.1 失敗モード

- **ロール写像の取りこぼし（最大）**：owner→coach+isAdmin 写像が1経路でも漏れると、計画側の編集が誰でも通る／逆に正規コーチが弾かれる。→ 全書込経路チェックリスト＋統合版セキュリティ不変条件（§2.2・§4.2）で全件確認。Gemini 第二意見でのプレモーテムを P1 着手前に行う（不可逆な認可設計のため・multitenant §7 の前例に倣う）。
- **own→slot 写像未設定で接合が無音停止**：writer が warning ログで書かずに済ませると、コーチは「試合を記録したのに計画が動かない」を気づけない。→ 写像未設定を計画側 UI に「接合先未設定」として顕在化（沈黙成功にしない・_common-rules）。
- **matchEvents 量の移送コスト**：高頻度生データの総量が大きいと P2 移送が長時間化・タイムアウト。→ チャンク移送・件数桁感で進捗検証（`fetch-trends` が既に30件チャンク取得の前例）。`team-range-stats--handler` に既存の TODO（期間内全イベント O(全件)・上限なし）があり、移送後も集計コストは残課題。
- **スキーマ結合の協調コスト**：両アプリが同じ identity コレクションを共有すると、片方のスキーマ変更が他方を壊しうる。→ identity スキーマを「共有契約」として固定し、変更は両アプリ同時レビュー必須にする（型の単一真実源を1箇所に）。
- **既存本番データの整合**：記録側 tenant と計画側 tenant が「同じ学校」なのに別 doc で並走していた場合、移送時の合流先取り違えで他校データ混入。→ 移送は合流でなく原則新 tid 払い出し、合流は明示割当表のみ（§5.1）。

### 7.2 未決事項（オーナー判断 or 別スコープ）

- **own チーム3つ以上の運用**（§2.3）：固定2スロット（boys/girls）を超える運用が出たときの主計画対象選択。現状スコープ外。
- **学年↔個人マッピング**（§2.4）：選手個人の学年を計画に効かせるか。将来。
- **記録側の追加指標を接合に増やすか**：現状 `METRIC_TO_CATEGORY` の3指標のみ接合。被リバウンド・被FG% 等を弱点判定に足すなら `gap.js` の table 拡張（エンジン改造）が要る。差別化を深めるなら検討（別スコープ）。
- **接合面 DB 名の意味ずれ**（§4.1）：`basketball-strategy-db` が全 identity を含む実態と乖離。リネームしない判断は採ったが、新規プロジェクト名/DB 名の整理を将来やるか。
- **記録 SPA と計画 SSR の体験統合**：マルチサイトで2フロント並存は P1 で成立するが、ユーザーから見て1製品に見せる導線（共通ナビ）は別スコープ。MEMORY「ナビ chrome 分裂」の論点と接続する。

---

## 識別子対応表（統合の単一参照）

| 観点 | 記録側（ai-basketball-coach-15c78） | 計画側（ai-bb-coach・home） | 統合後 |
|---|---|---|---|
| GCP プロジェクト | ai-basketball-coach-15c78 | ai-bb-coach | **ai-bb-coach**（記録は退役） |
| named DB | ai-basketball-coach-db | basketball-strategy-db | 接合面=basketball-strategy-db ／ 生データ=記録 DB を移送 |
| identity コレクション | users/tenants/memberships（各自 DB） | users/tenants/memberships（各自 DB） | 接合面 DB に1本化・uid 自然キー突合 |
| ロール | coach / advisor / player / parent（+isAdmin/isSuperAdmin） | owner（+isAdmin/isSuperAdmin） | **coach/advisor/player/parent** を正規・owner→coach+isAdmin 写像 |
| teamId | 任意・kind:own/opponent | 固定 boys/girls | own→boys/girls 写像・opponent は記録専有 |
| drillId | （未確認・あれば突合） | drills/{drillId}（216件・グローバル） | 計画側を唯一カタログに統一 |
| 接合 doc | （無し・新規 writer の書込先） | tenants/{tid}/teams/{teamId}/input/latest | 同左（無改造） |
| 指標 id | 集計値（ftPct/to/under-basket）→変換 | FT率 / 試合TO / ゴール下成功率 | writer が記録集計→計画 id へ変換して書込 |

---

## 段階計画表（再掲・要点）

| フェーズ | Go ゲート | 非破壊 | 主作業 |
|---|---|---|---|
| P0 | 不要 | ○ | 本設計の確定 |
| P1 | 不要（コミット/デプロイは承認） | ○ | named DB 新設・記録 functions 別コードベース追加・マルチサイト Hosting・接合 writer・ロール権限表の単一真実源化 |
| P2 | **オーナー Go 必須** | ✕（不可逆） | 本番データ移送・記録フロント/functions 向け直し・identity 突合確定・旧プロジェクト退役 |
