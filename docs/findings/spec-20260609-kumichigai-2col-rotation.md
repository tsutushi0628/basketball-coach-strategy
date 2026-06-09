# 設計仕様: 組違い 男女左右2列 ローテーションモデル（2026-06-09）

> 前提資料: `docs/findings/handoff-20260609-kumichigai-2col-redo.md`（最終差し戻し＝未完了の唯一タスク）。
> 本仕様は frontend-engineer が着手できる粒度で「日レベルを男女左右2列のローテーション表示に作り直す」設計を確定する。
> 確定済みの組違い像（オーナー合意・火曜の実例）は前提資料末尾の表のとおり。左右に**違う**ドリルが並ぶのが正、同じドリルが左右に並んだら差し戻し再発。

---

## 0. 結論（4判断点の確定回答）

| 判断点 | 確定回答 |
|---|---|
| (1) rotation導出の置き場 | **退役 `groups.js` の不変条件（要監督を無監督にしない・左右別ドリル・両列被覆）とテスト観点を presentation 純モジュール `ui/rotation.mjs` に移植**（engine復活でも全再実装でもない第三案）。ただし groups.js の self 配分（Pass A/B）は wall-clock 崩壊の元なので**移植せず逐次レイアウトに置換**。理由は §2。 |
| (2)・時間モデル | **主自走（ツーメン等）は together で実尺占有・裏埋めに溶かさない。コーチ段（11メン・4対4）だけ前後半 swap し、裏は短い自走（selfFillPool）。** これで日合計尺＝窓に一致（5巡目の時間消失を根治）。理由は §3。 |
| (3) 2列描画コントラクト | plan-data が各 rotation 日に `pd.rotation.rows`（実尺順送り・主自走/WU/CD は `together` 行・コーチ段だけ前後半swap）を持たせる。**各パターンの日ビジュアル自体を2列に作り替える**（1列を下に積まない）。`genderTwoColumn(pd, renderCell)` は行ループのみ・セル描画は各パターン注入。データ形は §4。 |
| (4) ON/OFF・土・コーチ不在日 | ON=2列rotation、OFF=別時間に同一メニュー各自フル（1列）、土=合同 together（1列）、水木=コーチ不在（2列・左右同一・全自走）。§5。 |
| (追加#2) 開始・終了 | 平日 **16:05開始・17:40終了固定・窓=95分**。`START_CLOCK`（16:05）＋ config `schedule[].minutes` 100→95（火水木金）の設定値変更のみ・配分アルゴリズム不変。§5a。 |
| (追加#3) WU構成 | **WUは「ダイナミックストレッチ」1本に集約・micro動作は内訳**。presentation 集約（engine データ不変）。§5b。 |

---

## 1. 設計方針

### 1.1 中核モデル（差し戻しの根を断つ）
コーチは1人。練習メニューは男女共通（1本）。組違い＝**同じメニューの「要監督ドリル」を男女でずらして回す**。要監督ドリルにコーチが付く間、相方は**別の自走ドリル**をやる。次の段で左右入れ替え。これにより (a) 要監督ドリルが無監督で走ることは構造的にあり得ず、(b) 左右に**違うドリル**が並ぶ（＝組違いが一目で分かる）。

現状UIの誤り（差し戻し済み）は2つ重なっている:
- **見せ方**: 「共通メニュー1列＋別枠の組違い説明パネル」で、左右2列になっていない（`render-shared.mjs:237` `interactionPanel`、`pattern-*.mjs` の `dayHeader → interactionPanel → menu` の縦積み）。
- **モデル**: `deriveCoachSplit`（`plan-data.mjs:224-243`）が「片方コーチ付き・もう片方は**同じ段を自走**」を出す（`coachSplitBody` の「${r.second}は同じ段を自走」`render-shared.mjs:222`）。これは「要監督ドリルを無監督で自走させる」矛盾。

→ **両方を捨てる**。`deriveCoachSplit` を rotation 導出に置換し、`interactionPanel`/`coachSplitBody` を左右2列部品に再設計する。

### 1.2 レイヤー責務（単一方向の依存）
```
engine/ (PlanDay・coaching_mode 真実源)  ← 触らない
   ↓ buildSession（共通メニュー1本・HH:MM付与・displayMode解決）
ui/plan-data.mjs（presentation day = pd.blocks）
   ↓ buildRotation(pd, selfFillPool)   ← 新規 ui/rotation.mjs
ui/plan-data.mjs（各 day に pd.rotation を付与）
   ↓ data
ui/render-shared.mjs（genderTwoColumn 共通部品）／pattern-*.mjs（日ビジュアル）
```
依存は一方向。rotation 導出は presentation day（`pd.blocks` の items: `{name, minutes, category, mode, video, alternatives}`）だけを入力にする純関数。engine の `PlanDay`/`coaching_mode` には依存しない（plan-data が既に `displayMode` で吸収済み）。

---

## 2. 判断点(1): rotation導出の置き場 ＝ presentation層に純モジュール移植

### 2.1 結論
退役 `groups.js`（`git show 0bf06ac:engine/src/groups.js`）の **不変条件（要監督を無監督にしない・左右別ドリル・両列被覆）とテスト** を新規 `ui/rotation.mjs` に移植する。engine 復活はしない。**ただし groups.js の self 配分アルゴリズム（Pass A/B＝主自走を practice バンドルへ分配）は移植しない**——この分配こそが5巡目で発覚した wall-clock 崩壊の元（主自走を practice 窓に重ねて時間消失・§3冒頭）。新 `buildRotation` は「ブロックを実尺で順送り＋コーチ段だけ前後半 swap」の**逐次レイアウト**にする（分配ではない）。不変条件は概念として守り、実装はより単純で時計安全な形にする。

### 2.2 なぜ engine 復活ではないのか（退役理由の尊重）
- 退役の方針（前提資料 D）は「組違いはUIプレゼン層で導出に一本化」。engine に戻すとこの一本化が崩れ、`planWeek.js` post-pass・`format.js` 組違い週次表・`types.js` weekday_groups を再導入することになり、退役で消した結合を全部復活させる（前提資料 D の削除一覧の巻き戻し）。
- engine の `groups.js` は **engine の `PlanDay`（`day.blocks[].items[].coaching_mode`・`day.coach_present`・`plan.saturday_lecture`）** を入力にする（`buildWeekdayGroups` `0bf06ac:groups.js` の `host = plan.saturday_lecture?.day`、`day.coach_present === false` 分岐）。UIが必要とするのは presentation day（`pd.blocks`・`pd.mode`・`pd.sharedKind`）で、両者は形が違う。engine版をそのまま消費するには presentation→engine形の逆変換アダプタが要り、二重の真実源になる。

### 2.3 なぜ presentation 再実装（ゼロから）ではないのか（資産の尊重）
`groups.js` は単なる配分ループではなく、**証明済みの不変条件と15本のテスト**を持つ（`0bf06ac:engine/test/groups.test.js`）:
- 不変1: 各 rotation round の practice はちょうど1本（同時刻に両方 practice は構造的に不可能）。
- 不変2: practice-mode ドリルは `rotation.practice` にしか現れない（self_fill/both_self に practice が混入しない＝要監督ドリルを無監督にしない）。
- 不変3: self_fill のドリルは対の practice と**別ドリル**（drill_id 不一致を構築で保証）＝左右に違うドリルが並ぶことの保証。
- 不変4: 両グループが全メニューを被覆（swap で保証）。
- （新）日合計尺＝窓: 5巡目で追加する時計不変。groups.js には無い（むしろ groups.js の分配がこれを破っていた）ので presentation で新設。

これらの不変条件（1〜4・新時計不変）と15本テストの**検証観点**を移植する。ただし groups.js の self **配分**ロジック（Pass A/B・shortfall_minutes）は移植しない——主自走を practice 窓へ分配する設計が wall-clock 崩壊の原因だったため。新 `buildRotation` は分配せず、主自走を together 行で実尺占有・コーチ段だけ swap する逐次レイアウト。**不変条件の検証観点とテストは資産として活かし、時間を壊す配分アルゴリズムは捨てる**のが正しい線引き。

### 2.4 中身（`ui/rotation.mjs`）— 逐次レイアウト（分配しない）
`pd.blocks`（presentation day・`it.mode` 解決済み）を入力に、**ブロックを実尺で順送りしつつコーチ段だけ swap する逐次レイアウト**を組む。識別子は presentation 形（`mode`/`name`/`minutes`、同一性キーは `name`）。

`buildRotation(pd, selfFillPool, { startMin })` の手順:
1. `pd.blocks` を順に走査し、各ブロックを実尺で rows に積む（`from` を順送り）。
2. WU/CD（`isBundle`）・**主自走ブロック（items が全て mode self）** → `type:'together'` 行（左右同一・実尺占有）。
3. **コーチ段（item が mode practice/lecture）** → `type:'rotation'` 行を前後半2行に分割。前半 coachSide 側=practice／相方=`selfFillPool` の短い自走（別 name）、後半は左右入替。coachSide は practice 段ごとに男女交互。
4. 末尾で **全 rows.minutes 合計 === day.minutes** をアサート（不一致 throw＝時計不変・§3.3）。

移植する検証ヘルパ（groups.js 由来・概念のみ）:
| 移植元（groups.js） | 移植先（rotation.mjs） | 変更点 |
|---|---|---|
| `findRotationViolations` の観点 | `findRotationViolations(rows)` | rows 版に。practice が `rotation` 行の coachSide 側にしか無い（不変2）・同時刻 `boys.name!==girls.name`（不変3）を検査。export しテスト/開発アサートで使用。 |
| `coveredDrillIds` の観点 | `coveredColumnNames(rows, 'boys'|'girls')` | 列ごとの被覆集合。`boys列==girls列`（不変4）を検査するため。 |
| **配分（Pass A/B・shortfall）** | **移植しない** | wall-clock 崩壊の原因（§2.1）。逐次レイアウトに置換。 |
| `buildWeekdayRotation`/`buildSelfParallel`/`buildTogether` | **移植しない** | engine PlanDay 入力・分配前提。presentation の逐次レイアウトで代替。 |

`ui/rotation.test.js`（業務意図を検証・実装をなぞらない）:
- **時計**: 全 rows.minutes 合計 == day.minutes（窓一致・時間消失の回帰テスト）。together 行が主自走の実尺を保持（practice 窓に溶けない）。
- **不変2**: practice は `rotation` 行の coachSide 側にしか出ない（裏埋めは必ず self の短いドリル）。
- **不変3**: 各 `rotation` 行で `boys.name !== girls.name`。
- **不変4**: `coveredColumnNames(boys) == coveredColumnNames(girls)`（両列同一被覆）。
- **swap**: 各コーチ段が前後半2行・後半は前半の左右入替・coachSide が段ごと交互。
- **E2E**: 火曜の実出力で start=16:05・end=17:40・合計95分・主自走ツーメンが together 行で実尺保持・コーチ段2つが swap。

> **保守性の判断**: rotation.mjs は `ui/`（presentation）に置く。組違いは「見せ方の都合」であり engine の計画生成（何を何分やるか）とは別関心。plan-data.mjs（単一データソース）の隣に rotation.mjs を置くことで「presentation の派生はすべて ui/ 配下」という退役後の一本化方針を保つ。

---

## 3. 判断点(2)・時間モデル: 主自走は together で実尺占有・コーチ段だけ rotate・短い自走で裏埋め

> **5巡目オーナー差し戻しの核**（実測で確認）: 旧モデルは wall-clock を壊していた。主自走ドリル（コーチ不要の技術/対人の主ドリル＝ツーメン）を practice 段の「裏埋め」に溶かし、コーチ段の窓に重ねたので **主自走の尺が時計から消えた**（実拘束65分・早く終了 vs 窓）。実測: `pd.blocks`（共通メニュー本体）は実尺を保持して正しく、時間消失は**旧 rotation 導出**（groups.js の self 配分＝主自走を practice バンドルへ分配する設計）で起きていた。engine ではなく presentation の導出バグ。**あわせて窓を95分に締める**（終了17:40固定・§5a）。

### 3.1 正しい時間モデル（バスケ実態・コーチ1人）
日の時計は**共通メニューのブロックを実尺で順に並べたもの**＝時間消失ゼロ。組違いは「各コーチ段の窓の中で誰が何をやるか」だけを左右で変える（ブロックを時計から消さない）。

| 種別 | wall-clock の扱い | 左右の扱い |
|---|---|---|
| WU（together） | 実尺（15分）を占有 | 左右同一・全幅（合同自走） |
| **主自走ドリル（self mode の主ドリル＝ツーメン等）** | **together で実尺を占有** | **左右同一・全幅（合同自走）**。コーチ不要なので半面ずつ両チーム同時にでき、これが wall-clock の本体。**裏埋めに使わない**。 |
| コーチ段（practice＝11メン・4対4） | その段の実尺を占有 | **swap rotation**: 前半=coachSide側がpractice／裏でもう片方は**短い**自走（selfFillPool の小ドリル＝キャッチ&シュート等）→後半で左右入替 |
| both_self（残り自走があれば） | 実尺占有 | 左右同一・全幅 |
| CD（together） | 実尺（5分）を占有 | 左右同一・全幅 |

**窓は16:05〜17:40＝95分固定**（§5a）。各ブロックの実尺は engine が95分の中で配分（WU15・CD5・main75＝合計95・`computeSessionShape(95)` 実測）。火曜の構成は WU15(16:05〜)→主自走 together→コーチ段 rot→コーチ段 rot→CD5＝**95分・16:05〜17:40 で窓と一致**。個別ドリルの分数は engine 出力をそのまま使う（spec で固定しない）。オーナー当初例（裏はキャッチ&シュート＝短い自走）と一致。

> **開始＝16:05・終了＝17:40固定・窓＝95分**（§5a）を真とし、個別ドリルの分数は engine 出力（`computeSessionShape(95)`=WU15/CD5/main75 の中での配分）をそのまま使う（spec で固定しない）。オーナー例「ツーメン30・17:40着」は95分窓に収まる。

### 3.2 selfFillPool の役割は「短い裏埋め自走」だけに限定（旧定義から縮小）
plan-data の `buildSession` が共通メニュー生成時に **selfFillPool（コーチ段の裏で回す"短い"自走ドリル）** を用意する。主自走ドリルは selfFillPool に**使わない**（主自走は together で実尺占有）。

- **短いドリルを選ぶ**: selfFillPool は「短時間（duration_min が小さい・キャッチ&シュート/フォーム反復/ハンドリング等）で、コーチ不要（needsCoach=false→self）」なドリル。コーチ段の窓（20〜25分）の中で前半/後半の各半分（10〜13分）に収まる尺。
- **供給は十分**: catalog 214件中、短い自走系（シュート23・ハンドリング18・フットワーク18・フィニッシュ16等）に多数。各コーチ段の裏に短い自走を1つ充てる供給は確実。
- **選定は決定論**: その日の主眼に近い（同 sub_skill 主眼トークン共有 or 同 category）短い自走を affinity 降順→id 安定順で上位。`allocate.js:alternativeAffinity`（前セッションB追加）流用。LLM不使用。
- **共通メニューには足さない**: selfFillPool は組違いON・rotation 日のコーチ段裏でのみ使う追加候補。共通メニュー本体（together で出す中身）には追加しない。OFF・土・水木では使わない。

### 3.3 なぜ他案を採らないか
- **alternatives は使えない**: practice 段の alternatives は同 category（戦術系）なので mode も practice（実測: 11メン速攻の alts はドラッグスクリーン・3対2トランジション＝いずれも要監督）。裏埋めには使えない。
- **allocate.js で比を均す**: engine の段割当を触ると計画本体（QA済み・真実源）に波及。組違い・時間レイアウトは presentation 派生なので presentation で吸収（最小スコープ・行動原則10）。
- **主自走を裏埋めに使う（旧モデル）**: wall-clock を壊す（本節冒頭の実測バグ）。主自走は together で実尺占有が正。

> **新・不変条件（時間消失の再発防止）**: **日の rows 合計尺 = 日ヘッダの窓（start〜end・day.minutes）と一致**。平日は95分（16:05〜17:40）でアサート。rotation 行は前後半に分割しても合計は元のコーチ段尺に一致、together 行は実尺占有。これを `buildRotation` の事後アサート＋回帰テストに加える（§2.4）。一致しなければ throw（壊れたら即わかる・エラーハンドリング方針）。

---

## 4. 判断点(3): 2列描画コントラクト

### 4.1 データ形（plan-data が各 rotation 日に持たせる `pd.rotation`）

**核心＝時計を壊さない2層モデル**: rows は共通メニューのブロックを**実尺で順に**並べる（together 行）。そのうち**コーチ段（practice）だけ**を前後半2行に展開して左右 swap する。主自走ドリル（ツーメン等）は **together 行で実尺占有**し、裏埋めに溶かさない（§3.1）。コーチ段内の swap で off側は **短い裏埋め自走（selfFillPool）** を回す。これで日合計尺＝窓に一致（§3.3 新不変）かつ「要監督を無監督にしない／左右別ドリル」を満たす。

```
pd.rotation = {
  kind: 'rotation',
  start:'16:05', end:'17:40',   // 平日は16:05開始（準備5分）・終了17:40固定・窓=95分（§5a）
  rows: [
    // WU: together・実尺占有・左右同一（合同自走）。WUは「ダイナミックストレッチ」1本に集約し
    //     micro動作を内訳に（§後述WU節）。
    { type:'together', from:'16:05', label:'ウォームアップ', minutes:15,
      drill:{ name:'ダイナミックストレッチ', mode:'self',
              components:['パワーウォーク…','ランジウォーク','肩甲骨スキップ','肩回し','ヒップローテーション'] } },

    // 主自走ドリル: together・実尺占有・左右同一（半面ずつ両チーム同時・合同自走）
    // ※分数は engine が95分内で配分。下は95分例（主自走30）。実値は engine 出力。
    { type:'together', from:'16:20', label:'技術', minutes:30,
      drill:{ name:'ツーメン（半面/オールコート）', mode:'self', alternatives:[…] } },

    // ── コーチ段R0（practice=11メン速攻20分）だけ swap。裏は"短い"裏埋め自走 ──
    // 前半: 男子=コーチ付き practice、女子=短い裏埋め自走（別ドリル）
    { type:'rotation', round:0, half:'前半', from:'16:50', minutes:10,
      coachSide:'男子',
      boys: { name:'11メン速攻', mode:'practice', alternatives:[…] },
      girls:{ name:'キャッチ&シュート', mode:'self', alternatives:[…] } },   // selfFillPoolの小ドリル
    // 後半: 入れ替え（女子=コーチ付き practice、男子=同じ短い裏埋め自走）
    { type:'rotation', round:0, half:'後半', from:'17:00', minutes:10,
      coachSide:'女子',
      boys: { name:'キャッチ&シュート', mode:'self', alternatives:[…] },
      girls:{ name:'11メン速攻', mode:'practice', alternatives:[…] } },

    // ── コーチ段R1（practice=4対4 25分）。先攻は round ごと交互（女子先攻）──
    { type:'rotation', round:1, half:'前半', from:'17:10', minutes:12,
      coachSide:'女子',
      boys: { name:'（短い裏埋め自走）', mode:'self', alternatives:[…] },
      girls:{ name:'4対4 ゲーム', mode:'practice', alternatives:[…] } },
    { type:'rotation', round:1, half:'後半', from:'17:22', minutes:13,
      coachSide:'男子',
      boys: { name:'4対4 ゲーム', mode:'practice', alternatives:[…] },
      girls:{ name:'（短い裏埋め自走）', mode:'self', alternatives:[…] } },

    // CD: together・実尺占有・左右同一
    { type:'together', from:'17:35', label:'ダウン', minutes:5, drill:{ name:'整理運動…', mode:'self' } },
  ],
}
// 日合計 = 15+30+(10+10)+(12+13)+5 = 95分 → 16:05〜17:40（窓と一致・§3.3不変）
// ※分数は95分例。実分数は engine 出力（computeSessionShape(95)=WU15/CD5/main75）。
```
- **行の決定論**: rows の順序・時刻（16:05開始・各ブロック実尺を順送り）・コーチ段の前後半2行分割・coachSide の round ごと交互は rotation.mjs が決定論で出す。
- **時計の保証（新不変・最重要）**: `together` 行は実尺占有、`rotation` 行は前後半合計＝元コーチ段尺。**全 rows の minutes 合計 = day.minutes（窓）**。`buildRotation` 末尾でアサートし、不一致なら throw（時間消失の再発を即検出）。
- **被覆（不変4）**: コーチ段は前半・後半で左右入替なので boys列・girls列とも {practice, 裏埋め自走} を両方やる。主自走（ツーメン）・WU・CD は together で男女が同時に同じものをやる。両列の被覆は同一。
- **左右が違うドリル（不変3）**: `rotation` 行は同時刻に `boys.name !== girls.name`（一方 practice・他方 裏埋め自走）。`together` 行は左右同一（合同自走）でこれは適用外。
- **要監督を無監督にしない（不変2）**: practice は `rotation` 行の coachSide 側にしか出ない。裏埋めは必ず self の短いドリル。
- **時間分割の端数**: コーチ段 minutes が奇数なら前半 floor・後半 ceil（合計＝元尺）。

### 4.2 2列描画は各パターンの「日そのもの」（1列を下に重ねない）
オーナー差し戻しの核は「1列は見づらい」＋「左右に並べろ」。したがって **`pd.rotation.rows` の2列描画を各パターンの日ビジュアル本体にする**。「2列＋その下に従来の1列メニュー」は積まない（見づらさ・重複の再発を断つ）。共通部品 `genderTwoColumn(pd)` は薄く（行ループのみ）、各パターンは「行セルの描き方」をパターン色（タイムライン／チップ／文書）で差し替える。

- 左列ヘッダ=男子チップ（`genderChip('男子')`・既存）、右列ヘッダ=女子チップ。色帯ではなく既存 `.gchip`（12px角ブロック）で識別。
- 各 `type='rotation'` 行は2セル（boys/girls）。同時刻に coach 側セル＝`modeTag('practice')`（既存「コーチ付き」橙タグ）、相方セル＝`modeTag('self')`（既存「自走」インセットタグ）。前半→後半で左右タグが入れ替わるのが視覚的な「組違い＝ずれ」。
- `type='together'` 行（WU・主自走・CD・both_self）は左右結合の全幅セル1つで「男女一緒に自走」を示す（左右に同じ内容を2回出さない）。主自走（ツーメン等）はここに実尺で出る＝時計の本体。
- 動画リンク（`videoLink`）・いずれか候補（`altLine`）はセル内に従来どおり差す。
- **Hallmark**: border-left/top の色帯カードは使わない（既存 TOKENS・`.gchip`・`modeTag`・inset shadow のみ）。emoji不使用（既存 `VIDEO_SVG`）。汎用書体・gradient不使用（既存 BASE_CSS の Hiragino 系）。新規CSSは2列grid（`.twocol`/`.tcrow`/`.tccell`、coach/self セルの面分け、together 行の全幅化）のみ。
- **再設計対象**: 既存 `interactionPanel`（`render-shared.mjs:237`）・`coachSplitBody`（`:216`）を撤去。`genderTwoColumn(pd, renderCell)` を新設（`renderCell` で各パターンがセル描画を注入）。`modeToggle`/`dayHeader`/`goalsSection`/`yearSection`/`monthSection`/`genderChip`/`modeTag`/`altLine`/`videoLink` は維持。`plainText` は2列スワップの段取り（前半 男子コーチ・女子別自走→後半入替）を文章で表現する形に書き換える。

### 4.3 3パターンの消費契約（日ビジュアルを2列に作り替える）
従来の1列 day メニュー関数（`menuTimeline`／`ratioBar`+`detailBlock`／`menuDoc`+`blockSection`）は **2列版に作り替える**（残して下に積むのではなく**置換**）。各パターンの個性は「2列の行セルをどう描くか」に出す。week/month/year レベルと共通メニューの中身（男女同一の何を何分やるか）は変えない。日レベルの構成は「①日ヘッダ（`dayHeader`）→ ②2列の本体（`pd.rotation.rows` を描く）」に統一する。

| パターン | 日ビジュアルの2列化（置換） |
|---|---|
| timeline（採用案） | `menuTimeline`（`pattern-timeline.mjs:44`）を **左右2本の比例タイムライン**に作り替える。行は時刻で揃え、左=男子ドリル／右=女子ドリル、要監督段は●コーチタグ。前半・後半で左右の●が入れ替わる縦の流れがそのまま「組違い」。`together` 行（WU・主自走・CD）は全幅バンドで実尺の高さを占有（主自走35分が時計の本体）。`dayTimeline`（`:61`）の `interactionPanel(pd)` 呼び出しは削除し、新2列タイムラインを日本体にする。 |
| board | `ratioBar`+`detailBlock`（`pattern-board.mjs:20,33`）を **2列の段リスト**に作り替える。各 rotation 行を左右2チップ（左=男子・右=女子、coach 側にコーチタグ）、`together` 行は全幅チップ（主自走は実尺で大きく）。比率バーは左右各列の時間比で2本出すか、共通1本＋2列リストでもよい（frontend 判断）。`dayPanel`（`:54`）の `interactionPanel(pd)` は削除。 |
| handout | `menuDoc`+`blockSection`（`pattern-handout.mjs:15,33`）を **左右2列の文書**に作り替える。行＝時刻見出し＋左右2カラム（左=男子・右=女子のドリル行）。`together` 行は全幅行。`dayDoc`（`:40`）の `interactionPanel(pd)` は削除。`@media print` で2列gridを維持し、A4幅で左右が潰れないようにする。 |

> **「2列＝日の本体」の徹底**: 別枠の1列メニューは作らない。同じドリル名が「左列の某行」と「右列の別の半行」に出るのは**スワップの正しい表現**（冗長ではなく、誰がいつコーチ付きかのずれを示す）。frontend-engineer は実装後、実画面・実印刷で「左右2列だけで日が完結し、別枠1列が無いこと」を確認する。

---

## 5. 判断点(4): ON/OFF・土・コーチ不在日の2列での扱い

| 日 | sharedKind | 組違いON | 組違いOFF |
|---|---|---|---|
| 火金（コーチ在席・土以外） | `rotation` | **2列・左右ずらしrotation**（§4。要監督段で左右が違うドリル・coachSide交互・shortfall注記） | **1列・男女別時間に同一メニューを各自フル**（全段コーチ付き。`genderTwoColumn` を出さず共通メニュー1列＋「別時間に各自フル」注記） |
| 土（コーチ在席・最長） | `together` | **1列・男女合同**（コーチが両方同時に見る。`genderTwoColumn` を出さず合同注記＋共通メニュー） | 1列・各自独立（OFF時も合同日は分離しない＝合同が土の本義。注記のみ差し替え） |
| 水木（コーチ不在） | `independent` | **2列・左右同一・全自走で統一**（コーチ不在で組分け不要。左右に同じ自走メニューを並べ「男女とも各自で自走」を示す。1列版は作らず2列で揃える） | 同左（コーチ不在日は ON/OFF で変わらない） |

- **ON/OFF トグルの責務**: 既存 `modeToggle`（`render-shared.mjs:199`）と `clientScript` の `setMode`（`:367`）を維持。`data-interact="on"/"off"` の出し分けに `genderTwoColumn`（ON・rotation日）と1列注記（OFF）を割り当てる。
- **水木の2列（統一）**: コーチ不在日は要監督ドリルを upstream で除外済み（全段 self）。左右2列で中身は同一なので、`type='together'` 行だけの rows（coachSide なし・左右に同一ドリル・各ブロック実尺占有）として `genderTwoColumn` で描き「男女が同時に各自自走」を2列で表現する。1列版は作らず**全パターン2列で統一**する（rotation 日・independent 日とも日の本体は2列）。
- **土の together**: 1列のまま（合同なので左右に分ける概念がない）。`genderTwoColumn` は出さない。

---

## 5a. 開始16:05・終了17:40固定・平日の窓=95分

**指示#2＋5巡目是正**: 平日は **16:05 開始**（最初の5分は準備）、**終了は17:40固定**（オーナーが「1740まで」を明示の基準にしている）。よって **平日メニューの窓 = 16:05〜17:40 = 95分**（開始・終了を両方リテラルに満たす）。土は従来どおり（09:00開始）。

### 2つの変更（どちらも設定値のみ・配分アルゴリズム不変）
1. **開始時刻（16:05）**: `plan-data.mjs:60-61` の `START_CLOCK`／`DEFAULT_START_MIN`。平日既定を `16*60`（16:00）→ `16*60+5`（16:05・965分）に変更。土日は `START_CLOCK['土']=9*60` を維持。`buildSession`（`:148` `startMin = START_CLOCK[day.day] ?? DEFAULT_START_MIN`）が各ブロックの `from`/`to` を順送りするので、開始を5分ずらすだけで全 HH:MM が連動。
2. **session 長（100→95分）= 終了17:40の本体**: **session 長パラメータは engine config の `schedule[].minutes`**（`engine/data/config.sample.json` と `config.girls.sample.json` の各曜日エントリ。現在 火水木金=100・土=165）。**平日4日（火水木金）を 100→95 に変更**する。これは `allocate.js:587` `computeSessionShape(minutes)` に渡る session 長で、設定値の変更のみ・配分アルゴリズムは不変。土（165）は触らない（土は別開始・別窓）。
   - **検証済み（実測）**: `computeSessionShape(95)` = WU15・CD5・main75・targetMain3（100分時と同じ段数）。95は5の倍数なので5分丸めグリッドが綺麗に保たれる（`allocate.js:160-161` の前提を満たす）。主の中身が5分減るだけで段構成は不変。
   - **なぜ config 変更を選ぶか（保守的）**: クリーンな session 長パラメータ（`schedule[].minutes`）が既に存在し、5の倍数制約も満たす。WU実尺を15→10に削る代替案より、source-of-truth（config）を直すほうが正しい（WUを削ると「ダイナミックストレッチ10-20分」の下限に寄り、WU集約の主見出し尺と整合しにくい）。WU削り案はクリーンなパラメータが無い場合のフォールバックだが、本件は config に在るので不要。
- **「日合計==窓」不変条件は 95分（16:05〜17:40）でアサート**（§3.3）。
- **他曜日の整合**: 金（rotation）も平日なので 100→95・16:05開始・17:40終了で同じ。水木（independent・コーチ不在）も平日 95分・16:05〜17:40。土（together）は 165分・従来開始で「日合計==窓」を満たす（終了が早く切れないことを各曜日で確認）。
- **「準備5分」の見せ方**: 16:05＝練習開始。準備（着替え・ボール出し）は16:00〜16:05に各自で、と日ヘッダ注記に1行（任意）。窓計算は16:05起点で統一。

---

## 5b. WU構成: 「ダイナミックストレッチ」1本に集約・micro動作は内訳

**指示#3**: パワーウォーク/ランジウォーク/肩甲骨スキップ/肩回し/ヒップローテーション（CND-002〜006・各1-2分）は「ダイナミックストレッチ（CND-001・10-20分）」の**中身**。WU は「ダイナミックストレッチ」1本（実尺15分）にまとめ、これら動作は**内訳（サブ表示）**にする。分刻みの別ドリルで横並びにしない。

### 結論: presentation 集約（engine データ・engine ロジックは触らない）
WU ブロック描画時に、**CND-001（ダイナミックストレッチ）を主見出し・CND-002〜006 を内訳（components）として畳む**。catalog 構造変更（CND-002〜006 を CND-001 の `components` フィールドに移す）は採らない。

- **なぜ presentation 集約か（保守性）**: engine の `fillCondBlock`（`allocate.js:529`）は WU プールを `duration_min` で時間予算まで詰める正しいロジック。CND-002〜006 を catalog で CND-001 の子要素にすると、(a) `fillCondBlock` の詰め込み（個別 `duration_min` 前提）・(b) WU プールの低→中→高 強度順（`:599`）・(c) 週次 floor 等が個別レコード前提なので影響が engine 全体に波及する（engine データ変更＝影響範囲大）。presentation で「CND-001 が WU に在れば CND-002〜006 をその内訳として畳む」だけなら engine 不変・blast radius 最小。
- **集約ロジック（決定論・presentation）**: `buildSession` の WU ブロック整形で、items に CND-001（`name==='ダイナミックストレッチ'` or `philosophy_tags` に「RAMP」）が在れば、同ブロックの mobility micro 動作（CND-002〜006＝`philosophy_tags` に「可動域」かつ `duration_max<=2`）をその `components` 配列に畳む。主見出し=「ダイナミックストレッチ（15分）」、内訳=micro動作名の列挙。WU ブロックの実尺（15分）は不変。
- **データ形**: WU together 行の drill に `components:[…]`（§4.1 のWU行例）。`render-shared`／各パターンの WU 描画は「主見出し＋内訳の小さな列挙」で出す（既存 `altLine` に近い従属表示）。
- **CD も同様**: ダウン（整理運動 CND-026〜028）が複数並ぶなら「整理運動（5分）」主見出し＋内訳に畳んでよい（任意・WU と同型）。
- **engine データを触る場合（不採用だが明記）**: もし将来 catalog 集約するなら、CND-001 に `components:['CND-002',…]` を持たせ、`fillCondBlock` を「CND-001 を置いたら components を内訳として保持・micro を個別に詰めない」に変更する。影響は WU/CD 配分・強度順・floor 計算に及ぶため、今回スコープ外（presentation 集約で要件は満たせる）。

---

## 6. 既存資産の再利用棚卸し（何を残し・何を変えるか）

### 残す（変更なし）
- **engine の*ソース/ロジック*一式**（`planWeek.js`/`allocate.js`/`filter.js`/`normalize.js`/`types.js`/`format.js`）。組違い・時間レイアウトは presentation 派生なので engine ロジックは触らない。`coachingMode`（`filter.js:312`）の3分類はそのまま真実源。`computeSessionShape`・`fillCondBlock`・配分アルゴリズムも不変。
  - 例外: engine *config データ* `schedule[].minutes` の平日値だけ 100→95 に変更（§5a・終了17:40の設定値・ロジック不変）。WU集約は engine データ（catalog）を触らず presentation 集約（§5b）。
- `ui/plan-data.mjs` の `buildSession`（`:78`・男女共通メニュー1本生成）・`teamGoals`（`:198`）・`buildPlanData`（`:279`・年/月/目標の組み立て）。
- `render-shared.mjs` の `TOKENS`/`BASE_CSS`/`BLOCK_TINT`/`esc`/`VIDEO_SVG`/`modeTag`/`videoLink`/`altLine`/`genderChip`/`modeToggle`/`dayHeader`/`goalsSection`/`yearSection`/`monthSection`/`assumptionsNote`/`clientScript`。
- 3パターンの **week/month/year レベル**（各 weekLevel・month/year は共通部品経由）。共通メニューの中身（男女同一の何を何分やるか）も変えない。
- `ui/build.mjs`（pattern-*.mjs 自動発見ビルダー・変更不要）。

> 注: 各パターンの **日レベル1列ビジュアル**（`menuTimeline`／`ratioBar`+`detailBlock`／`menuDoc`+`blockSection`）は「残す」ではなく **2列版に作り替える**（§4.3・下表）。週レベルの段チップ等は流用してよい。

### 変える
| ファイル:箇所 | 変更 |
|---|---|
| 新規 `ui/rotation.mjs` | §2.4。逐次レイアウト `buildRotation(pd, selfFillPool, {startMin})`：ブロックを実尺で順送り・主自走/WU/CD/both_self→`together` 行・コーチ段だけ前後半 swap・末尾で合計尺==window をアサート。検証ヘルパ `findRotationViolations(rows)`/`coveredColumnNames` を groups.js の観点から移植。**groups.js の Pass A/B 配分・shortfall は移植しない**（wall-clock 崩壊の元・§2.1）。 |
| 新規 `ui/rotation.test.js` | §2.4。業務意図テスト: 合計尺==window（時間消失回帰）・主自走 together 実尺保持・practice は rotation の coachSide 側のみ（不変2）・各 rotation 行で boys≠girls（不変3）・boys列==girls列被覆（不変4）・swap 構造・E2E火曜（16:05〜17:40・95分・主自走 together）。 |
| `engine/data/config.sample.json`・`config.girls.sample.json` `schedule[].minutes` | 平日4日（火水木金）の `minutes` を **100→95**（§5a・終了17:40固定の本体）。土（165）は不変。**設定値変更のみ・engine ロジック/配分アルゴリズムは不変**。 |
| `ui/plan-data.mjs:60-61` `START_CLOCK`/`DEFAULT_START_MIN` | 平日既定を 16:00→**16:05**（`16*60+5`）に変更（§5a）。土日 09:00 維持。 |
| `ui/plan-data.mjs:224-243` `deriveCoachSplit` | **撤去**。`buildSession` で selfFillPool（短い裏埋め自走）を用意（§3.2）し、`buildDays`（`:255`）で rotation 日に `pd.rotation = buildRotation(day, selfFillPool, {startMin})` を付与。`coachSplit` 廃止し `rotation` に置換。 |
| `ui/plan-data.mjs:78` `buildSession` | ①selfFillPool 生成（短い自走を affinity 順で数本）②WU 集約（CND-001 主見出し＋CND-002〜006 を components に畳む・§5b）を追加。共通メニュー本体（何を何分）は不変。 |
| `render-shared.mjs:216-258` `coachSplitBody`/`interactionPanel` | **撤去し `genderTwoColumn(pd, renderCell)` に置換**（§4.2・行ループのみの薄い共通部品。セル描画は各パターンが注入）。2列grid CSS（`.twocol`/`.tcrow`/`.tccell`・coach/self セル面分け・together 行全幅・WU内訳の従属表示）を BASE_CSS に追加。`@media print` に2列維持を追加。 |
| `render-shared.mjs:383` `plainText` | 2列スワップの段取り（前半=男子コーチ・女子別自走→後半入替）を文章で表現する形に書き換え。コピー文の正しさを保つ。 |
| `pattern-timeline.mjs` `menuTimeline`（`:44`）・`dayTimeline`（`:61`） | 日ビジュアルを **左右2本の比例タイムライン** に作り替える（§4.3）。`interactionPanel(pd)` 呼び出しは削除し2列タイムラインを日本体に。週/月/年は不変。 |
| `pattern-board.mjs` `ratioBar`（`:20`）・`detailBlock`（`:33`）・`dayPanel`（`:54`） | 日ビジュアルを **2列の段リスト** に作り替える（§4.3）。`interactionPanel(pd)` 削除。週5列ボードは不変。 |
| `pattern-handout.mjs` `menuDoc`/`blockSection`（`:15,33`）・`dayDoc`（`:40`） | 日ビジュアルを **左右2列の文書** に作り替える（§4.3）。`interactionPanel(pd)` 削除。`@media print` で2列維持。週/月/年は不変。 |

---

## 7. 非機能要件

- **保守性**: rotation 導出を1モジュール（`ui/rotation.mjs`）に閉じ込め、3パターンは行ループ部品（`genderTwoColumn`）＋各パターンのセル描画注入で2列を消費する。将来 SLOB/BLOB 等で男女メニューが分岐したら（〜2026年8月以降）、`buildSession` を男女2本生成に拡張し、rotation 行の boys/girls に各々別メニューを入れる（スワップなしの「左=男子メニュー・右=女子メニュー」並走）だけで2列骨格を再利用できる。`pd.rotation.rows` の `{type, boys, girls, coachSide}` 形は、スワップあり（共通メニュー期）もスワップなし（メニュー分岐後）も同一構造で表現できる。
- **拡張性**: rotation の rows は `{type, boys, girls, coachSide}` の汎用形。コート割り（左/右半面）が原典で確定したら row に `court` を足すだけ。
- **テスト容易性**: rotation.mjs は純関数（入力=presentation day＋selfFillPool、出力=rows）。`@swc/jest` 標準（`_common-rules` テスト基盤標準）で `ui/rotation.test.js` を業務意図（不変1〜5・左右別ドリル）で検証。実装をなぞらない（不変条件＝業務要件をアサート）。
- **決定論**: LLM不使用（plan-data は元々決定論）。selfFillPool 選定も affinity スコアの決定的ソート。

---

## 8. リスク・懸念（先出し）

1. **スワップ展開で行数が増える**: 各要監督段が前後半2行になるため日の行数が増える（火曜は practice 2段→4行）。比例タイムラインなら高さで自然に収まるが、文書/チップでは縦に長くなる。前後半を1つのカード内で上下2行に束ねる（round 単位でグルーピング）と読みやすい。frontend-engineer が実画面で確認。
2. **selfFillPool の主眼ズレ**: 裏埋め自走が要監督段の主眼と無関係だと「なぜこの自走？」になる。affinity 順で同主眼を最優先し、無ければ同 category→その日の重点カテゴリの順でフォールバック。`alternativeAffinity` 流用で実形態（peopleShape）も合わせる。短い尺（コーチ段窓の半分に収まる）を優先。
3. **時計不変の破れを即検出**: `buildRotation` 末尾で合計尺==window をアサートし throw（§3.3）。万一 engine 出力が想定外（コーチ段が0本・主自走が0本等）でも、時間消失を黙って通さず即エラーにする。
4. **水木2列の要否**: コーチ不在日は組違いの主対象でない。2列にこだわらず1列＋注記でも確定像を損なわない（§5・frontend-engineer 判断可）。
5. **印刷時の2列崩れ**: handout は紙配布が本義。`@media print` で2列gridを維持し、A4幅で左右が潰れないか実印刷プレビューで確認。
6. **drill_id 非保持**: presentation day には drill_id が無いため rotation.mjs は `name` を同一性キーにする。同名ドリルが同日に2回出る可能性は低いが、万一の衝突に備え plan-data 側で `name` 一意を確認（同名なら index 付与）。

---

## 9. 既存コードとの整合性

- 退役後の「組違いは presentation 派生に一本化」方針を維持（engine に戻さない・§2.2）。
- `coachingMode` 3分類（self/practice/lecture）・`displayMode`（コーチ不在日→self、平日の既習lecture→self）は真実源のまま消費（rotation.mjs は practice/lecture→practice、それ以外→self に畳むだけ）。
- Hallmark準拠基盤（TOKENS・gchip・modeTag・inset shadow・SVGアイコン）を流用し、新規CSSは2列gridのみ。border帯・emoji・汎用書体・gradient を新規に持ち込まない。
- 時間モデルは engine *ロジック*を触らず presentation＋config値で完結（主自走 together・コーチ段だけ swap・16:05開始・WU集約は plan-data/rotation.mjs/render-shared）。engine ロジック（`computeSessionShape`・配分）・`coachingMode`・ブロック構成は真実源のまま。唯一の engine データ変更は config `schedule[].minutes` 平日 100→95（終了17:40の設定値・§5a）。
- コミット粒度（行動原則8・main直接）: ①config の平日 minutes 100→95、②rotation.mjs（逐次レイアウト・時計不変アサート）＋test、③plan-data（16:05開始・deriveCoachSplit→buildRotation・selfFillPool・WU集約）、④render-shared の2列部品化、⑤3パターンの2列作り替え、の5論理コミットに分けると revert 単位が綺麗。
