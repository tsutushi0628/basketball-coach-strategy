# wip: 紅白戦チーム分けエンジン実装（分担A・engine）（2026-09-05）

正本: `docs/findings/spec-20260905-scrimmage-split.md` §4・§10-A。

## 完了

- `engine/src/scrimmage.js`（341行）: `splitTeams`・`scoreTeams`・`teamSizes`・`ROLE_GROUPS`・`ROLE_LABELS`（役割の日本語ラベル→canonical id。`roster.js` から import させる正本1箇所として追加）。外部依存ゼロ・`Math.random`/`Date` 不使用。mulberry32 PRNG。初期解は蛇行（`serpentineOrder` ジェネレータで目標人数到達チームを除外しつつ継続）、2人交換の摂動、局所探索（PRNGで並べ替えた全異チーム2人組を最大200周）。
- `engine/src/roster.js`（189行）: `normalizeRoster(values)`。ヘッダ行の列名で8列を引き、選手ID・表示名・性別の不正は行スキップ、学年・Tier・身長・役割は補完し `missing` に積む。役割セルは6種の区切り文字で分割し `ROLE_LABELS` で日本語→canonical idへ解決、未知語は捨てる。
- `engine/test/scrimmage.test.js`（202行・14ケース）、`engine/test/roster.test.js`（111行・8ケース）: いずれも合成ID（M01等）・合成名（アオキ等）のみ。
- `cd engine && npm test`: 167件中167件 pass（既存147件＋新規20件）。

## 契約からの逸脱

なし。§10-A の関数シグネチャ・戻り値形をそのまま実装。

## 次のアクション

分担B（`functions/index.mjs`・`functions/roster-sheet.mjs`）・分担C（`ui/scrimmage-page.mjs`）が本エンジンをそのまま import して使う想定。`engine/` 以外は無変更（`functions/`・`ui/` に触っていない）。コミットはしていない。
