# 紅白戦チーム分け タスク（tasks）

> 対象リポジトリ = basketball-coach-strategy（ブランチ feat/scrimmage-split）。完了印は 2026-09-05 のコミット 71d379a・a46e3e1 と、同日のテスト実走（`node --test`）の実測に基づく。
> 3分担（A engine・B functions・C ui）の境界は `design.md` 7 章。

## 0. 棚卸し

- [x] firebase-kit の棚卸し（`design.md` 8 章）。既存の自前セッション層・`resolveRequestTenant`・`mountWriteApi` を再利用し、firebase-kit 側は変更なし。

## A. エンジン（`engine/`）

- [x] テスト作成 `engine/test/scrimmage.test.js`（決定論・seed 差・人数配分・目的関数各項・履歴罰点・不正入力）。
- [x] テスト作成 `engine/test/roster.test.js`（区切り6種・未知語・補完・skipped・missing）。
- [x] 実装 `engine/src/scrimmage.js`（`splitTeams`・`scoreTeams`・`teamSizes`・`ROLE_GROUPS`・`ROLE_LABELS`・mulberry32・蛇行は目標人数到達チームを除外して継続）。
- [x] 実装 `engine/src/roster.js`（`normalizeRoster`）。
- [x] 実走：`node --test test/scrimmage.test.js test/roster.test.js` 20件 pass。

## B. サーバ（`functions/`・`firestore.indexes.json`・`scripts/`）

- [x] テスト作成 `functions/scrimmage-api.test.mjs`（純判定3本と実HTTP。403／400／採番／sync の 403・400・422・roster 不変）。
- [x] テスト作成 `functions/scrimmage-integration.test.mjs`（モック db で sync → split → decide の通し）。
- [x] 実装 `functions/index.mjs`（`GET /scrimmage`、`POST /api/scrimmage/split`・`/decide`、`POST /api/roster/sync`、純判定 `scrimmageSplitDecision`・`scrimmageDecideDecision`・`rosterSyncDecision`、差分 499 超の 422 ガード）。
- [x] 実装 `functions/roster-sheet.mjs`（`fetchSheetValues`。ADC と `spreadsheets.readonly`、エミュレータは `functions/fixtures/roster-synthetic.json`）。
- [x] `functions/package.json` に `google-auth-library` を明記、`firestore.indexes.json` に scrimmages（gender asc・createdAt desc）。
- [x] `scripts/set-roster-sheet.mjs`（初回の `rosterSheetId` 設定。`--sheet` 引数・`--prod` 安全弁・実IDはファイルに書かない）。
- [x] `scripts/verify-scrimmage.mjs`（エミュレータ実HTTPの通し確認。PASS/FAIL 明示）。
- [x] 実走：`node --test scrimmage-api.test.mjs` 29件 pass、`scrimmage-integration.test.mjs` 8件 pass。

## C. 画面（`ui/scrimmage-page.mjs`）

- [x] テスト作成 `ui/scrimmage-page.test.mjs`（面3つの描画・ホーム画面追加用メタ・データ島に Tier 等が無いこと）。
- [x] 実装 `renderScrimmagePage(model)`（ヘッダ、面1〜3、IIFE の fetch、`withTenantQ` 同型の `?t` 引き継ぎ）。
- [x] 実走：`node --test scrimmage-page.test.mjs` 11件 pass。

## D. 統合と出荷

- [ ] エミュレータ実走：`npm --prefix functions run build` 後に `scripts/verify-scrimmage.mjs` を `emulators:exec` 配下で通す（PASS の実出力を `docs/findings/` に残す）。
- [ ] オーナー作業：名簿シートの共有に Functions の実行サービスアカウントを閲覧者で追加し、`scripts/set-roster-sheet.mjs --prod --sheet <ID>` を1回実行する。
- [ ] 本番デプロイ（`firebase deploy`）と本番 `/scrimmage` の1クリック確認。y/n 確認の対象。
- [ ] モック `docs/findings/design-20260905-scrimmage-split-mock.html` の差し替え（道具列入口と面2b を外し、「この分けで決める」とヘッダの「名簿」を足す）。承認後に `design.md` 6 章へ見た目を追記する。
