# 練習計画エンジン MVP — データ形状と決定論ロジック仕様

このドキュメントは、後続実装者（gap.js / filter.js / loadModel.js / allocate.js /
gates.js / planWeek.js / format.js / llm.js / bin / test）が参照する確定仕様。
土台（types / storage / normalize / sample data）はこのエージェントが作成済み。

実装方針: 素の Node.js (ESM, `"type":"module"`)・外部依存ゼロ・テストは `node:test`。
計算・制約・配分・整形はすべて決定論コード。LLM は曖昧写像の口（`src/llm.js`）だけに
隔離し、MVP では実呼び出しせずキーワード写像のスタブ。

---

## 1. 確定データ形状

### 1.1 Drill（正規化後 / `normalizeDrill(raw)` の出力）

ソースは `docs/practice-knowledge/data/drills.json`（211 件・読むだけ）。自由文フィールドを
`src/normalize.js` で型に変換する。正規化後の全キー:

| キー | 型 | 説明 |
|---|---|---|
| `id` | string | 安定 ID（例 `"HND-001"`） |
| `name` | string | 表示名 |
| `category` | string | カテゴリ（Config の weight キーと一致） |
| `sub_skill` | string | サブスキル（FT 判定で参照） |
| `metric_meaning` | string | 何を動かすドリルか（自由文） |
| `court` | `"全面"\|"半面"\|"¼"\|"不問"` | 正規化した必要コート（**最小**フットプリント） |
| `requiresFull` | boolean | 最小要件が全面のときだけ true（半面日で除外する判定に使う） |
| `courtRaw` | string | 元の自由文 court（監査用） |
| `duration_min` | number | 分・最小（欠損時 10） |
| `duration_max` | number | 分・最大（欠損時 15） |
| `grades` | `"全"\|Array<1\|2\|3>` | 正規化した対象学年 |
| `gradesRaw` | string | 元の自由文 grades（監査用） |
| `intensity_class` | `"低"\|"中"\|"高"` | 正規化した強度 |
| `isHigh` | boolean | `intensity_class === "高"` の利便フラグ |
| `load_notes` | string | 負荷注意（自由文） |
| `mastery_stage` | string | 習熟段階（自由文） |
| `philosophy_tags` | string[] | 哲学/スキルタグ（キーワードフィルタで参照） |
| `notes` | string | 備考（zone/sets キーワードフィルタで参照） |
| `source_name` / `source_url` / `video_url` | string? | 出典 |
| `provenance` | string? | `"手持ち"` \| `"収集"` |
| `source_kind` | string? | `"external"` \| `"team_original"` |
| `searchText` | string | `name+category+sub_skill+notes+metric_meaning+tags+grades` を結合し小文字化した検索インデックス。zone/sets フィルタ用の広域インデックス |

#### court 正規化の意味論（重要）
- 元データは `¼ / 半面 / 全面 / 不問 / サークル / コート外階段 / 半面〜全面 / ¼〜半面 / 全面（…）`
  等の自由文。enum は「そのドリルが要求する**最小**フットプリント」を表す。
- レンジ（`半面〜全面`）は下限（半面）に解決 → **半面日でも使える**。
- `不問 / サークル / コート外` → `"不問"`（制約なし）。
- `requiresFull = true` になるのは「全面しか満たせない」ドリルのみ（211 件中 44 件）。
  **半面日フィルタは `requiresFull === true` を除外する**（`court === "全面"` 単独判定でも等価）。

#### grades 正規化の意味論
- 211 件すべてで検証済み。`"全"` または昇順の `Array<1|2|3>`（中学の学年）。
- 対応フォーム: `全`/`全。<注意>`→`"全"`、`中学N〜M年`/`中学N年`、`中N〜中M`/`中N`、
  `小X〜中Y`→`[1..Y]`、`中学全学年`/`中学生`/`中学(以上)`→`[1,2,3]`、先頭の素の `N〜M`/`N年`、
  年齢レンジや解析不能→`"全"`（全学年扱い）。
- 学年フィルタ: `grades === "全"` は常に適合。配列なら Config の対象学年と積集合が非空なら適合。

### 1.2 Config（`data/config.sample.json`）

チーム哲学はハードコードせず、すべてここで受ける（外販時に他チームが設定差し替えで使える）。

| キー | 型 | 説明 |
|---|---|---|
| `team_id` | string | テナント識別子（全データを team_id で引く前提） |
| `team_label` | string | 表示名 |
| `category` | string | 年代帯（例 `"中学"`）。zone フィルタの発火条件 |
| `grades` | `Array<1\|2\|3>` | この計画の対象学年 |
| `philosophy.df` | string | 守備アイデンティティ（自由文） |
| `philosophy.zone_forbidden` | boolean | true で zone 系ドリル除外 |
| `philosophy.sets_forbidden_in_year` | boolean | true で年内のセット系ドリル除外 |
| `philosophy.shot_clock_sec` | number | ショットクロック秒 |
| `current_month` | number | 1-12。年内セット系フィルタを駆動 |
| `phase` | string | マクロサイクルのフェーズ（例 `"準備"`） |
| `schedule[]` | `{day, minutes, court, coach_present?}[]` | 週スケジュール。`court` は当日利用可能な面。`coach_present`(bool) は指導者在席フラグ（省略時 true=在席）。不在日は選手自走内容に制限 |
| `coach_absent_allow` | `string[]?` | コーチ不在日に選手だけで回せる許可カテゴリ。省略時は既定リストにフォールバック |
| `philosophy_floors` | `Object<string, {min_minutes_per_week, place_on_coach_days?}>?` | カテゴリ別の週次最低分。守備・速攻のフロアをここで宣言（在席日に配置） |
| `phase_category_weights` | `Object<string, number>` | フェーズのカテゴリ基底重み |
| `load_caps.high_intensity_per_session` | number | 1 日の高強度本数上限 |
| `load_caps.high_intensity_per_week` | number | 週の高強度本数上限 |
| `load_caps.no_consecutive_high_days` | boolean | 高強度を連続日に置かない |

### 1.3 TeamInput（`data/team-input.sample.json`・合成値）

| キー | 型 | 説明 |
|---|---|---|
| `team_id` | string | テナント識別子 |
| `grades` | `Array<1\|2\|3>` | 対象学年 |
| `indicators[].id` | string | 指標名（例 `"FT率"`）。指標→カテゴリ写像のキー |
| `indicators[].good_direction` | `"up"\|"down"` | 高い方が良い(up)/低い方が良い(down) |
| `indicators[].baseline` | number | シーズン初期値 |
| `indicators[].latest` | number | 直近測定値 |
| `indicators[].target` | number | 目標値 |
| `indicators[].unit` | string | 表示単位（`"%"`, `"本"` 等） |

### 1.4 Plan（エンジン出力）

```
{
  team_id, month, phase,
  days: [{
    day, minutes, court, coach_present,
    blocks: [{ block, items: [{ drill_id, name, minutes, category, intensity_class }] }],
    total_minutes, high_intensity_count
  }],
  focus_summary, notes
}
```
- `block` ∈ `"WU" | "技術" | "対人" | "ゲーム" | "CD"`。
- `coach_present` = その日の指導者在席フラグ（schedule から伝播。省略時 true）。
- `total_minutes` = その日の全ブロックの item.minutes 合計。
- `high_intensity_count` = その日の `intensity_class === "高"` の item 数。
- `src/format.js` が日ごと（ブロックとドリル・分・合計）の人間可読テキストへ整形。
  日ヘッダーに「コーチ在席/不在」を併記する。

---

## 2. 指標 → カテゴリ写像（決定論・`src/gap.js`）

config やコードのハードコードではなく、この写像表を `gap.js` に定数として持つ。

| 指標 id | 写像先 |
|---|---|
| `"FT率"` | `[{category:"シュート", ft_only:true, w:1.0}]` |
| `"試合TO"` | `[{category:"ハンドリング/ドリブル",w:0.4}, {category:"パス&スペーシング",w:0.3}, {category:"意思決定/ゲーム形式",w:0.3}]` |
| `"ゴール下成功率"` | `[{category:"フィニッシュ(ゴール下/レイアップ)",w:1.0}]` |

- `ft_only: true` は **name / sub_skill に「フリースロー」または「FT」を含むドリルに限定**する
  フラグ。`gapWeights` はカテゴリ単位で集計するが、実際のプール選択（filter/allocate）で
  ft_only を尊重する。
- **FT 判定の実装注意**: 正規化後 Drill の `searchText` は広域インデックス
  （metric_meaning や sub_skill も含む）なので、`searchText` で FT 判定すると
  catalog 上 5 件ヒットして仕様より広くなる。ft_only 判定は **`name` と `sub_skill`
  の 2 フィールドに限定**して `/フリースロー|FT/i` を当てること（仕様準拠で 4 件）。

---

## 3. 差分 → 重み（`src/gap.js`）

```
gapRatio(指標) =
  good_direction == "up"   ? clamp((target - latest) / (target - baseline), 0, 1)
                           : clamp((latest - target) / (baseline - target), 0, 1)
```
- 各指標の写像先カテゴリに `gapRatio × w` を加算 → `gapWeights`（カテゴリ別）。
- 分母 0（target == baseline）はゼロ割回避（0 に丸める等）を実装側で担保。
- `clamp(x,0,1)` は `Math.min(1, Math.max(0, x))`。

```
finalWeights = normalize( phase_category_weights[c] + GAP_ALPHA × gapWeights[c] )   // GAP_ALPHA = 1.0
```
- gap で未達が大きいカテゴリほど時間が増える構造。
- `normalize` はカテゴリ重みの総和で割って和を 1 にする。
- **カテゴリ集合は `phase_category_weights` のキーと `gapWeights` のキーの和集合**で取る。
  gap 写像先に `phase_category_weights` に無いカテゴリ（例: `パス&スペーシング`）が出るので、
  `phase[c] || 0` で欠損を 0 補完してから加算する（gap 経由でのみ重みが付くカテゴリが正しく残る）。
- サンプル値での検算（known-good・テストの期待値に使える）:
  - gapRatio: FT率 (up) `(70-52)/(70-40)=0.6` / 試合TO (down) `(16-10)/(20-10)=0.6` / ゴール下 (up) `(70-55)/(70-45)=0.6`
  - gapWeights: シュート 0.6 / フィニッシュ 0.6 / ハンドリング/ドリブル 0.24 / パス&スペーシング 0.18 / 意思決定/ゲーム形式 0.18
  - finalWeights（和=1）: フィニッシュ 0.2857 / シュート 0.2679 / ハンドリング/ドリブル 0.1571 / 意思決定/ゲーム形式 0.1179 / パス&スペーシング 0.0643 / 1on1 0.0536 / チームディフェンス 0.0536
  - **最重要カテゴリ（`assertMainFocusPresent` 対象）= フィニッシュ(ゴール下/レイアップ) ≈ 0.286**

---

## 4. 1 日の組み立て（段モデル・`src/allocate.js`）

1 日は **少数の「持続する段（セグメント）」** で組む。固定比率ブロックを多数の短い
ドリルで埋める旧方式ではなく、コーチの実メニュー（「対人いずれか：15min」「リムアタック
いずれか：15min」）に倣い、ウォームアップ＋数段の主テーマ＋クールダウンで構成する。

### スイッチコスト境界（主段数）
切替が多いと選手の負荷が上がるため、**主段（カリキュラム段。WU/CD は除く）の数を尺で上限する**:
1h=2〜3／2h=3〜5／3h=4〜7。実装の帯は `[round(分/60)+1, round(分/30)+1]`（60/120/180 で
ちょうど 2-3 / 3-5 / 4-7）。目標値は `round(主予算 / PER_SEGMENT_TARGET=27)` を帯でクランプし、
**少なく・長く**側へ寄せる（持続段）。`computeSessionShape(分)` が WU/CD/主予算/帯/目標を返す。
WU/CD は「日尺×0.15／×0.06」を 5 分丸めで 10〜30／5〜10 にクランプ。WU・CD・主予算はすべて 5 の倍数。

### 段の中身
- **WU / CD は定型の束**（旧来どおり）: `category="コンディショニング/ウォームアップ"` から、
  WU は低→中→高、CD は `isCoolDownEligible`（`intensity_class="低"` かつ跳躍/追い込み/心肺系を除く）
  のみ。多数の短いストレッチを 1 ブロックにまとめる＝スイッチコスト対象外（準備運動・整理運動は習慣）。
  CD は WU と同一ドリルを避ける（日スコープ `daySeenIds` 共有）。空になる時のみ重複許容で非空を保証。
- **主段（技術/対人/ゲーム）はカテゴリ別の持続段**: 1 段＝1 カテゴリ。カテゴリは `CATEGORY_BLOCK` で
  3 ブロックのいずれかに限定する（**カテゴリ適合**）:
  - 技術＝個人技術（シュート/フィニッシュ/ハンドリング/パス/フットワーク）
  - 対人＝対人・チーム戦術（1on1/チームDF/チームOF/リバウンド）
  - ゲーム＝試合形式（意思決定/ゲーム形式）
  これにより、フィニッシュ系ソロ（マイカン/ツーメン）が試合ブロックに混入することはない。
- **持続尺**: 各主段の尺はそのドリルの自然長ではなく「割り当て分」で走らせる（≥15 分・5 分丸め・上限 40 分）。
  1 段＝主ドリル 1 本＋同カテゴリの「いずれか」候補（最大 2 本・表示のみ／負荷予算・週重複に算入しない）。

### 段の選び方・尺配分（`chooseMainSegments`）
1. **哲学フロア優先**（在席日のみ）: 守備（オールコートマンツー/ヘルプ/帰陣）と速攻（アーリー/
   トランジション）を `floorTracker`（週スコープ）の残り分まで予約。`FLOOR_SEGMENT=20` 分を単位に
   在席日へ分散して週次最低（`min_minutes_per_week`）を満たす。ゲーム＋ギャップ用に 2 枠は残す。
2. **試合形式を 1 段予約**（定石「最後は試合で締める」）: 重みだけでは上位に来ないため、枠が残れば
   `意思決定/ゲーム形式` を 1 段確保する（重みで尺配分）。
3. **残り枠をギャップ上位カテゴリで充填**: `finalWeights` 降順。尺は重み比例で配分（largest-remainder・
   5 分刻み・各 15〜40 分）。未達カテゴリほど尺が大きくなる（ギャップ駆動の重点）。
- **週内のドリル重複回避**: `usedIds`（週スコープ・全日共有）で主段の主ドリルが火水木金土で重複しない。
  新規が尽きた時のみ再利用。`daySeenIds`（日スコープ）で同日内の重複を禁止。
- **半面日は全面必須ドリル（`requiresFull === true`）を選ばない**（当日プールで事前除外）。
- **指導者在席によるプール制限**: `coach_present===false`（不在）の日は、主段プールを `isCoachAbsentEligible`
  （`coach_absent_allow` カテゴリ かつ `mastery_stage` が "反復"/"実戦化"）へ絞る。対人・チーム導入系は
  自走不可なので不在日の対人ブロックは空になりうる（正しい挙動）。WU/CD は不在日も毎日実施。
- **負荷予算**: 段の主ドリルが高強度のとき `budget.canPlaceHigh()` を尊重（連続日・本数上限が効く）。

---

## 5. フィルタ（プールから除外・`src/filter.js`）

| # | 除外条件 |
|---|---|
| F1 | court が利用可能面に収まらない（**全面必須=`requiresFull`を半面日に置かない**。`¼/不問/半面` は OK） |
| F2 | grades が対象学年に合わない（`"全"` は常に適合。配列は対象学年と積集合が非空なら適合） |
| F3 | `config.category === "中学"` かつ zone 系（`name/category/notes/philosophy_tags` に「ゾーン」または `zone`）→ 除外 |
| F4 | `sets_forbidden_in_year === true` かつ 年内（`current_month>=8 \|\| current_month<=12` を年内扱い）かつ セット系（`name/notes` に「セット」「セットオフェンス」）→ 除外 |
| F5 | `intensity_class === "高"` は残り負荷予算（load_caps）を超えるなら選ばない。高強度は `no_consecutive_high_days` を尊重し連続日に置かない |
| F6 | コーチ不在日（`coach_present===false`）は `isCoachAbsentEligible` 外を除外（`coach_absent_allow` 外カテゴリ・`mastery_stage` が「反復/実戦化」以外）。selection 直前に当日プールへ適用 |

### フィルタ実装の検証メモ（catalog 実データで確認済み）
- **F3 zone**: catalog で「ゾーン/zone」ヒットは 2 件 — `TDF-005`（ゾーンディフェンス概略・除外意図どおり）と
  `REB-001`（ゾーン時のリバウンドドリル）。仕様キーワード（`name/category/notes/philosophy_tags`）通りなら
  REB-001 も除外される。仕様が決定論キーワード判定を明示しているのでそれに従う（実装も仕様準拠で OK）。
- **F4 sets**: キーワード「セット」は過剰マッチに注意。catalog では `FIN-012`（"ゼロステップ理解とセット"）、
  `CND-013`（"プランクジャック…セット" 文脈）等で false positive 気味にヒットする。仕様は
  「`name/notes` に『セット』『セットオフェンス』」と明示しているので**仕様の文字通り**に実装する。
  過剰マッチが UX 上問題になる場合は後続で「セットオフェンス/セットプレー」に絞る改善余地あり（今回スコープ外）。
- **F5 高強度**: catalog 上 `intensity_class==="高"` は 1 件のみ（`isHigh` フラグで判定可）。負荷予算ロジック
  （`src/loadModel.js`）は週内の高強度本数・連続日を追跡する状態機械として実装する。

---

## 6. ハードゲート（`src/gates.js`・生成後に検査・違反は throw）

| ゲート | 検査内容 |
|---|---|
| `assertTimeFits` | 各日 Σitem.minutes <= その日の minutes |
| `assertNoZone` | 中学で zone 系ドリルが計画に無い |
| `assertNoSetsInYear` | 年内にセット系が無い |
| `assertLoadCap` | 各日の高強度本数 <= `high_intensity_per_session`、週合計 <= `high_intensity_per_week`、高強度が連続日に無い |
| `assertMainFocusPresent` | 当月 phase の最重要カテゴリ（`finalWeights` 最大）が週内に最低 1 回出る |
| `assertPhilosophyFloor` | 守備・速攻が各々 `min_minutes_per_week` 以上、週内に入っている（`place_on_coach_days` 指定時は在席日配置分のみ計上）。違反は throw |
| `assertCoachContext` | `coach_present===false` の日に `coach_absent_allow` 外カテゴリや `mastery「習得」`・チーム導入系が入っていない（`isCoachAbsentEligible` で再検査）。違反は throw |

ゲートはフィルタ（5 章）と同じ判定基準を「計画後の最終防衛線」として再検査する。
フィルタが正しければゲートは常に通るが、allocate のバグ・端数寄せ・予算管理ミスを
ここで throw して捕捉する。

---

## 7. LLM の隔離（`src/llm.js`・スタブ）

- LLM は「曖昧写像の口」だけに隔離。MVP では**実呼び出しせずキーワード写像のスタブ**。
- 計算・制約・配分・整形（gap/filter/loadModel/allocate/gates/format）はすべて決定論コード。
- スタブの責務範囲: 自由文の意図を既知カテゴリへ寄せる程度の写像のみ。閾値判定・件数集計・
  並び替え・重複除去・形式整形は LLM に渡さずコードで実装する。

---

## 8. 保存層の差し替え（`src/storage.js`）

- `createLocalStorage({drillsPath, configPath, inputPath})` → `getDrills()/getConfig()/getTeamInput()`。
- `getDrills()` は**生レコード**を返す（正規化は呼び出し側が `normalizeDrills` で行う）。
  storage は純粋な I/O 境界に保ち、ビジネスロジックを持たせない。
- Firestore 差し替えは同じ 3 つの async getter を team_id で実装する
  （`createFirestoreStorage` が swap-in 地点として定義済み・MVP 未実装）。
- マルチテナント前提: 全データは team_id で引ける形。Config/TeamInput/Plan すべてに team_id を持つ。

---

## 9. CLI（`bin/plan.js`）

config と input と drills を読み → `planWeek` → `format` 出力。
storage 経由で読み、`normalizeDrills` で正規化してから `planWeek(drills, config, teamInput)` に渡す。
