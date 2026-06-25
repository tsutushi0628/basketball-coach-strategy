# チームカラー設定 — 設計

各テナント（チーム）が自チームの主色を厳選16プリセットから選ぶ機能の設計。実装はしない（設計フェーズ）。本番コードの参照位置・カスケード方向・権限ゲートまでを確定させる。

- 既定色はオレンジ（現行トークンと同値）。
- 自由ピッカーは採用しない。プリセット集合（計16色）だけ許可する。
- スポーツのユニフォーム/チームカラーで一般的な色から、互いにぱっと見で別の色と分かるよう色相を散らして16色を選ぶ。
- クリーム地・本文インク・罫線・曜日色・ブロック種別色は据え置き、ブランドアクセント系（`--orange*`・`--boys`・`--girls`）だけを差し替える。
- 明色テーマ（ゴールド・スカイ・ライム）は主色面に白文字が乗らないため、`--orange-ink` をテーマ固有の暗インクにする（各テーマが自分のインクを持つ）。

モックHTML（全5状態・16テーマ適用済み）: `docs/specs/color-settings/color-settings-mock.html`

---

## 1. 厳選プリセット・パレット

### 1.1 方針 ―― なぜ主色だけ替えてニュートラルは残すのか

現行トークン（`ui/render-shared.mjs` の `TOKENS`）は2系統に分かれている。

- **構造色（固定）**: クリーム地 `--bg #fbf5ec` / `--surface` / 本文 `--ink` / `--mute`、罫線 `--line` `--line-2` `--hair`、土日色 `--sat` `--sun`、ブロック種別色 `--terra` `--gold` `--sage`（`BLOCK_TINT` がアップ/ファンダ/シュート等の弁別に使う）。これらは「読みやすさ」と「意味の弁別」を担う地。
- **ブランドアクセント（可変）**: `--orange` / `--orange-ink`（主色面上の文字）/ `--orange-soft`（淡い面・進捗バー地）/ `--orange-deep`（リンク・見出し・ラベル）、男女 `--boys` / `--girls`。

テナントが任意の主色を選んでも世界観と可読性が崩れないのは、地（クリーム）と意味色（曜日・ブロック種別）を固定したまま主役だけ差し替えるから。もしニュートラルまでテナント色で振ると、(a) ブロック種別6色がテナント主色と衝突して種別の弁別が壊れ、(b) 土日色とアクセントが近接して曜日の識別が落ち、(c) クリーム地という商品の地金が消える。よって差し替え対象はアクセント系に限定する。これが妥当な切り分け。

### 1.2 男女別 `--boys` / `--girls` の導き方

男女2列（`genderTwoColumn`）は左右に並ぶため、色相が近すぎると弁別が落ちる。各テーマで boys=主色、girls=主色から1段深い同系色（`--orange-deep` 近傍）とし、**面で隣り合っても弁別できる差**を取る。明度差だけの2段ではなく、現行 orange が採っている「主色＋既存 terra」と同型の「主色＋deep寄り第2色」で揃える。既定 orange だけは現行実値（boys `#ef7a32` / girls `#b8623b`）を厳守する（後方互換）。

**明色テーマの男女別とインク反転（設計前提の変更点）**: ゴールド・スカイ・ライムは主色が明るいので、`nowchip`（男女いまチップ）が主色面に暗インクを乗せる。girls も暗インクが読める明度に保つ必要があるため、これらのテーマでは girls を「主色より少し濃いが暗インクは読める」中明度色にする（例: ライム girls `#8aab2f` は暗インク `#222d08` で ink/girls 5.49・boys/girls 1.56）。`--orange-ink` は単一変数なので、テーマ単位で「明色＝暗インク／濃色＝淡インク」を切り替える。これは render-shared 側の構造変更を伴わない（テーマごとに `--orange-ink` の値が違うだけ）。

### 1.2.1 インク反転で変わる前提（1行報告）

明色テーマでは `--orange-ink` が暗色になる。`--orange-ink` の現行用途は (a) 主色塗りボタン/タブ/チップの文字、(b) `peakchip`（目標の大会チップ・`--orange-deep` 地）の文字。明色テーマで (b) は「暗インク on 濃い deep 地」になり読めなくなるリスクがある。→ 対策: `peakchip` の文字色は `--orange-ink` ではなく固定の淡色（クリーム系）に分離するか、明色テーマの `--orange-deep` を据え置く（deep は地色基準で別管理）。本設計では **`peakchip` の文字色トークンを `--orange-ink` から独立させる**ことを実装時の付帯修正として明記する（描画側の1箇所修正）。これがインク反転で生じる唯一の波及。

### 1.3 パレット表（テーマ／変数→hex／コントラスト比）

コントラスト比は WCAG 2.x 相対輝度で算出。判定基準は4つ（orange 既定だけ免除）。

- **ink/主色 ≥ 4.5:1**: 主色塗りのボタン・タブ・チップ（`.btn-primary` `.lvtab.on` `.nowchip` 等）の上に乗る文字 `--orange-ink` の可読性。最重要。明色テーマは暗インク、濃色テーマは淡インク。
- **deep/クリーム地 ≥ 4.5:1**: リンク・見出しラベルに使う `--orange-deep` が地 `#fbf5ec` の上で本文可読。
- **主色/クリーム地 の識別**: 主色スウォッチ・進捗バー・タブ塗りがクリーム地上で図地分離できるか。濃色は ≥ 2.6 を満たす。明色（スカイ/ライム/ゴールド）は主色そのものがクリーム地に近く図地比が 1.5〜2.0 になるが、(i) タブ/チップは主色塗り＋暗インク文字で内容が読め、(ii) スウォッチは 1px 罫線で縁取られ、(iii) リンク・見出しは別変数 `--orange-deep`（≥4.9）が担うため、明色主色の図地比が低くても実用上の可読性は確保される（明色を採るならこの割り切りは不可避で、暗インクと deep の分業で吸収する設計）。
- **boys/girls の弁別 ≥ 1.25**: 男女2列が左右で見分けられる。

16色を色相環に散らした（hue: red 4 / orange 23 / brown 27 / gold 43 / lime 77 / green 138 / teal 180 / sky 200 / blue 212 / charcoal 217 / navy 221 / indigo 239 / purple 275 / rose 336 / burgundy 347 / maroon 354）。近接色は明度・彩度・トーンで弁別差を付けた（例: charcoal は低彩度グレー寄り↔navy は高彩度、wine 3色は rose=ピンク寄り・burgundy=暗ワイン・maroon=中明度マルーンでトーンを分けた）。

| テーマ | `--orange`（主色） | `--orange-ink`（主色上の文字） | `--orange-soft`（淡面） | `--orange-deep`（リンク/見出し） | `--boys` | `--girls` | ink/主色 | 主色/地 | deep/地 | boys/girls |
|---|---|---|---|---|---|---|---|---|---|---|
| オレンジ（既定・暗インク免除） | `#ef7a32` | `#fffaf2` | `#ffd7b9` | `#c4521b` | `#ef7a32` | `#b8623b` | 2.69※ | 2.58※ | 4.24 | 1.55 |
| レッド | `#c63a31` | `#fff5f3` | `#f3c4bd` | `#9a2820` | `#c63a31` | `#8f342c` | 4.84 | 4.78 | 7.18 | 1.50 |
| マルーン | `#9c343f` | `#fbeef0` | `#e6c4ca` | `#6e222b` | `#9c343f` | `#6e222b` | 6.25 | 6.51 | 10.06 | 1.54 |
| ローズ | `#bb3b6e` | `#fff2f7` | `#f0c6d8` | `#8f2851` | `#bb3b6e` | `#8f2851` | 4.87 | 4.89 | 7.48 | 1.53 |
| バーガンディ | `#7a2336` | `#fbecef` | `#dfbcc4` | `#5a1827` | `#7a2336` | `#5a1827` | 8.65 | 9.13 | 12.15 | 1.33 |
| パープル | `#7a4b9c` | `#f8f4fb` | `#d8c6e6` | `#583271` | `#7a4b9c` | `#583271` | 5.83 | 5.85 | 9.18 | 1.57 |
| インディゴ | `#46479c` | `#f3f3fb` | `#cacbe8` | `#2f3072` | `#46479c` | `#2f3072` | 7.20 | 7.33 | 10.84 | 1.48 |
| ネイビー | `#34508c` | `#f2f5fb` | `#c3cfe6` | `#22356a` | `#34508c` | `#22356a` | 7.20 | 7.25 | 10.85 | 1.50 |
| ブルー | `#2f72bd` | `#f3f8fd` | `#c2dcf2` | `#1d4f8c` | `#2f72bd` | `#1d4f8c` | 4.61 | 4.55 | 7.60 | 1.67 |
| スカイ（明色・暗インク） | `#7fc7ea` | `#123040` | `#d7eef9` | `#1b6a8e` | `#7fc7ea` | `#a9dcf2` | 7.40 | 1.72△ | 5.54 | 1.26 |
| ティール | `#157f7f` | `#effafa` | `#bce4e4` | `#0e5a5a` | `#157f7f` | `#0e5a5a` | 4.51 | 4.43 | 7.37 | 1.66 |
| グリーン | `#2f7d46` | `#f3faf4` | `#bfe0c7` | `#1f5d33` | `#2f7d46` | `#1f5d33` | 4.78 | 4.68 | 7.25 | 1.55 |
| ライム（明色・暗インク） | `#a9d63b` | `#222d08` | `#e6f3c2` | `#52690f` | `#a9d63b` | `#8aab2f` | 8.55 | 1.57△ | 5.72 | 1.56 |
| ゴールド（明色・暗インク） | `#e0a91d` | `#352704` | `#f6e3ac` | `#7d5a0d` | `#e0a91d` | `#f0d27a` | 6.83 | 1.96△ | 5.80 | 1.44 |
| ブラウン | `#8a5a33` | `#fbf2ea` | `#e2cdba` | `#653f20` | `#8a5a33` | `#653f20` | 5.29 | 5.40 | 8.48 | 1.57 |
| チャコール | `#3a3f47` | `#f3f4f6` | `#c9ccd1` | `#23272d` | `#3a3f47` | `#23272d` | 9.63 | 9.78 | 13.84 | 1.42 |

**※ オレンジ（既定）の注記**: ink/主色 2.69・主色/地 2.58 は現行出荷値そのもの。設計判断として**既定だけは触らない**（互換維持・現UIの見た目を一切変えない）。明るいオレンジ面に白文字を乗せる現行の意匠は AA を満たさないが、これは既存仕様であり本タスクのスコープ外。新規15テーマはすべて ink/主色 ≥ 4.5・deep/地 ≥ 4.9 を満たす（基準割れゼロ）。

**△ 明色テーマ（スカイ/ライム/ゴールド）の主色/地について**: 主色そのものがクリーム地に近く図地比 1.57〜1.96 だが、上記「主色/クリーム地の識別」の (i)〜(iii) で吸収する設計（暗インク文字＋スウォッチ罫線＋deep が可読性を担う）。明色を「ぱっと見で別の色」として並べるための割り切りで、可読性は暗インクと deep の分業で確保している。

**初回案からの再調整**: ティールは初回 `#1f8a8a` で ink/主色 3.90 だったため `#157f7f` に濃くして 4.51 に。明色3色（スカイ/ライム/ゴールド）は白インクでは読めないため暗インクに反転し、girls も暗インクが読める明度に調整。マルーンは初回 burgundy と近接（hue gap 7・lum 1.22）だったため `#9c343f`（中明度マルーン）に分離して red/rose/burgundy のどれとも弁別（lum 1.36/1.33/1.40）。

**boys/girls 比（1.25〜1.67）について**: 同系2段なので比は穏やかだが、(a) 左右の面で隣り合うこと、(b) 男女チップは色付き四角＋日本語ラベル「男子/女子」が必ず併記されること、(c) `--orange-ink` が boys 面・girls 面の両方で読めることを全テーマで確認済み。色は補助で、テキストラベルが一次情報。

### 1.4 プリセット定義の集約（新規hexの単一の置き場）

新規hexは1箇所に集約し、コンポーネントへ散らさない。設計上の置き場は `ui/` 配下のプリセット定義モジュール（例: テーマキー → 上書きCSS変数の対応表を1ファイルに持つ）。サーバ描画とAPI検証が同じ定義を参照する。

```
PRESET_THEMES = {
  orange:   { '--orange':'#ef7a32', '--orange-ink':'#fffaf2', '--orange-soft':'#ffd7b9', '--orange-deep':'#c4521b', '--boys':'#ef7a32', '--girls':'#b8623b' },
  red:      { '--orange':'#c63a31', '--orange-ink':'#fff5f3', '--orange-soft':'#f3c4bd', '--orange-deep':'#9a2820', '--boys':'#c63a31', '--girls':'#8f342c' },
  maroon:   { '--orange':'#9c343f', '--orange-ink':'#fbeef0', '--orange-soft':'#e6c4ca', '--orange-deep':'#6e222b', '--boys':'#9c343f', '--girls':'#6e222b' },
  rose:     { '--orange':'#bb3b6e', '--orange-ink':'#fff2f7', '--orange-soft':'#f0c6d8', '--orange-deep':'#8f2851', '--boys':'#bb3b6e', '--girls':'#8f2851' },
  burgundy: { '--orange':'#7a2336', '--orange-ink':'#fbecef', '--orange-soft':'#dfbcc4', '--orange-deep':'#5a1827', '--boys':'#7a2336', '--girls':'#5a1827' },
  purple:   { '--orange':'#7a4b9c', '--orange-ink':'#f8f4fb', '--orange-soft':'#d8c6e6', '--orange-deep':'#583271', '--boys':'#7a4b9c', '--girls':'#583271' },
  indigo:   { '--orange':'#46479c', '--orange-ink':'#f3f3fb', '--orange-soft':'#cacbe8', '--orange-deep':'#2f3072', '--boys':'#46479c', '--girls':'#2f3072' },
  navy:     { '--orange':'#34508c', '--orange-ink':'#f2f5fb', '--orange-soft':'#c3cfe6', '--orange-deep':'#22356a', '--boys':'#34508c', '--girls':'#22356a' },
  blue:     { '--orange':'#2f72bd', '--orange-ink':'#f3f8fd', '--orange-soft':'#c2dcf2', '--orange-deep':'#1d4f8c', '--boys':'#2f72bd', '--girls':'#1d4f8c' },
  sky:      { '--orange':'#7fc7ea', '--orange-ink':'#123040', '--orange-soft':'#d7eef9', '--orange-deep':'#1b6a8e', '--boys':'#7fc7ea', '--girls':'#a9dcf2' },  // 明色: 暗インク
  teal:     { '--orange':'#157f7f', '--orange-ink':'#effafa', '--orange-soft':'#bce4e4', '--orange-deep':'#0e5a5a', '--boys':'#157f7f', '--girls':'#0e5a5a' },
  green:    { '--orange':'#2f7d46', '--orange-ink':'#f3faf4', '--orange-soft':'#bfe0c7', '--orange-deep':'#1f5d33', '--boys':'#2f7d46', '--girls':'#1f5d33' },
  lime:     { '--orange':'#a9d63b', '--orange-ink':'#222d08', '--orange-soft':'#e6f3c2', '--orange-deep':'#52690f', '--boys':'#a9d63b', '--girls':'#8aab2f' },  // 明色: 暗インク
  gold:     { '--orange':'#e0a91d', '--orange-ink':'#352704', '--orange-soft':'#f6e3ac', '--orange-deep':'#7d5a0d', '--boys':'#e0a91d', '--girls':'#f0d27a' },  // 明色: 暗インク
  brown:    { '--orange':'#8a5a33', '--orange-ink':'#fbf2ea', '--orange-soft':'#e2cdba', '--orange-deep':'#653f20', '--boys':'#8a5a33', '--girls':'#653f20' },
  charcoal: { '--orange':'#3a3f47', '--orange-ink':'#f3f4f6', '--orange-soft':'#c9ccd1', '--orange-deep':'#23272d', '--boys':'#3a3f47', '--girls':'#23272d' },
}
THEME_KEYS = Object.keys(PRESET_THEMES)   // API 検証の許可集合（16キー）・既定 'orange'
```

---

## 2. 設定メニューUIモック

配置パス: **`docs/specs/color-settings/color-settings-mock.html`**（単体でブラウザに開ける）

含む状態（全5状態）と、16テーマを実際に当てたスウォッチ一覧:

1. **閉（既定）** — 右上にメール・歯車（SVG線画）・ログアウトが横並び。歯車は `.btn` と同系の surface+hair、円形。
2. **開** — 歯車直下に幅272pxのポップオーバー。タイトル「チームカラー」・閉じる×（SVG線画）・1行説明・16スウォッチ格子（**4列×4行**）・現在テーマに選択中マーク（主色の太縁＋チェックSVG）。色名は短縮しつつ折り返しを禁止（`white-space:nowrap`）し列幅内に収める。
3. **保存中** — スウォッチを淡色＋操作抑止、フッタに回転スピナー＋「○○に変更しています…」。
4. **保存エラー** — フッタに `--terra` で「保存できませんでした。色は元のままです。」＋「もう一度」ボタン。選択中は元テーマのまま（楽観適用しない＝失敗時に色が暴れない）。
5. **非管理者** — 歯車自体を描かない（メール＋ログアウトのみ）。入口が見えないので誤操作・問い合わせが起きない。

デザイン言語の遵守: warmトークンのみ（インライン色・書体なし、テーマ別 `:root` 上書きで色だけ差し替え）／1px hair罫線／角丸999・カード面の濃淡2値／SVG線画（歯車・閉じる×・チェック・Googleと同列の意匠）／Hiragino／タイポ5段（27/22/17/14/12）・見出し>本文。禁止項目（emoji・border色帯・gradient・汎用AIナビ・紫ピンク・全幅centered hero）は不使用。

**16色パネルのレイアウト判断（1行）**: 6色（3列）から **4列×4行の格子**へ変更し、272px 幅に16スウォッチを縦に伸ばしすぎず収めた（スウォッチを丸ドット＋短縮色名・nowrap・12pxに詰め、列幅内で折り返さない）。狭幅は既存の左右シート型（`left/right:14px`）を維持。下部プレビューも16枚に増やし各カードに `:root` 上書きを実適用。

---

## 3. データ・配線設計（実装はしない・設計のみ）

### 3.1 スキーマ: `tenants/{tid}.themeKey`

- `tenants/{tid}` doc に文字列フィールド `themeKey` を追加。既定 `'orange'`。
- **新規テナント生成時の既定埋め**: `functions/invitations.mjs` の tenant `txn.set(tenantRef, {...})`（現在 `id/name/status/initialized/createdBy/createdAt` を書く箇所、index時点で 187〜194 行）に `themeKey: 'orange'` を1行足す。
- **既存テナントの後方互換**: `themeKey` 未設定の doc は描画・API とも `'orange'` として扱う（読み出し時に既定へ解決。fail-fast方針との両立として、ここは「未設定＝既定テーマ」という業務既定が明確なので既定解決でよい。不正キーは別扱い＝3.4）。

### 3.2 描画注入: テーマCSSは css 引数の末尾に足す（カスケード方向が要）

`functions/index.mjs` の `server.get('*')` 描画経路（index時点で 459〜465 行）。現在:

```
const { css, body } = mod.render(data);
const html = renderPage({
  title: ...,
  css: css + (ENFORCE_AUTH ? AUTH_CSS : ''),
  body: body + (ENFORCE_AUTH ? authClientHtml(WEB_CONFIG) : ''),
});
```

`renderPage`（`ui/render-shared.mjs` 616〜632行）は `<style>${BASE_CSS}${css || ''}</style>` の順で結合する。`BASE_CSS` の先頭は `:root{${TOKENS}}`＝既定オレンジ。

**テーマ上書きCSSは css 引数の末尾に連結する。**

```
const themeCss = themeOverrideCss(tenant.themeKey);   // 例: ":root{--orange:#2f72bd;--orange-ink:#f3f8fd;...}"
css: css + themeCss + (ENFORCE_AUTH ? AUTH_CSS : '')
```

結合後の順序は `BASE_CSS(:root既定) → pattern css → themeCss(:root上書き) → AUTH_CSS`。**同一詳細度（`:root` 同士）では後勝ち**なので、末尾の themeCss が既定オレンジに勝つ。

- **先頭に入れると負ける**（`BASE_CSS` の `:root{TOKENS}` が後から上書きし返す）。だから必ず末尾。
- `themeKey === 'orange'`（既定）のときは空文字を返してよい（既定値は `BASE_CSS` が既に持つため上書き不要・ペイロード削減）。
- 上書きするのはアクセント系6変数（`--orange` `--orange-ink` `--orange-soft` `--orange-deep` `--boys` `--girls`）のみ。ニュートラル・曜日・ブロック種別は出力しない。
- `themeOverrideCss` は `PRESET_THEMES` の許可キーだけを受け、未知キーは既定（空＝オレンジ）に解決する。

### 3.3 色変更API: `POST /api/tenant/theme`

`functions/index.mjs` の `mountWriteApi` 内に、既存の `/api/override`（index時点で 322行〜）と同型で追加する。

- **認証**: セッション必須。`resolveRequestTenant(db, req, { forWrite: true })` を通し、`kind!=='context'` は 401/403/400 に振る（既存ハンドラと同じ分岐）。
- **認可**: `ctx.isAdmin === true` を要求する。各コーチは自テナントの管理者（accept 時 `isAdmin:grantAdmin`）。`isAdmin` 偽は 403。
  - 既存の `/api/override` は `ctx.role === 'owner'` で書き込みを通している。テーマ変更は「テナント設定」なので、ロールでなく**管理者フラグ `isAdmin`** をゲートにする（招待発行が `isSuperAdmin`、上書き保存が `role==='owner'`、テナント設定が `isAdmin` ＝ 直交2系統の認可方針に沿う）。
- **入力検証**: body の `themeKey` を `THEME_KEYS`（プリセット集合）に**含まれるかコード側で厳密判定**してから書く。集合外は 400（LLM不要・単純な集合所属判定）。
- **書き込み**: `db.collection('tenants').doc(ctx.tenantId).set({ themeKey }, { merge: true })`。対象は必ず解決済み `ctx.tenantId` 配下（越境はパスで担保＝`/api/override` と同じ作法）。
- **応答**: `{ ok:true, themeKey }`。クライアントは成功時にページを再読込（SSR再描画でテーマ適用）。

```
appServer.post('/api/tenant/theme', json, async (req, res) => {
  let ctx;
  try {
    const r = await resolveRequestTenant(db, req, { forWrite: true });
    if (r.kind === 'auth') { res.status(401).json({ ok:false, error:'サインインが必要です' }); return; }
    if (r.kind === 'none') { res.status(403).json({ ok:false, error:'テナントがありません' }); return; }
    if (r.kind !== 'context') { res.status(r.status || 400).json({ ok:false, error:'テナントを選択してください' }); return; }
    ctx = r.context;
  } catch { res.status(500).json({ ok:false, error:'resolve failed' }); return; }
  if (!ctx.isAdmin) { res.status(403).json({ ok:false, error:'設定の変更権限がありません' }); return; }
  const themeKey = typeof req.body?.themeKey === 'string' ? req.body.themeKey : '';
  if (!THEME_KEYS.includes(themeKey)) { res.status(400).json({ ok:false, error:'themeKey が不正です' }); return; }
  try {
    await db.collection('tenants').doc(ctx.tenantId).set({ themeKey }, { merge: true });
    res.json({ ok:true, themeKey });
  } catch { res.status(500).json({ ok:false, error:'save failed' }); }
});
```

### 3.4 歯車描画ゲート: `authClientHtml` に `isAdmin` と現 `themeKey` を渡す

`ui/auth-client.mjs` の `authClientHtml(cfg)` 署名を拡張し、`isAdmin` と現在の `themeKey` を受け取る案。

- `functions/index.mjs` の差し込み（464行）で `authClientHtml(WEB_CONFIG, { isAdmin: ctx.isAdmin, themeKey: tenant.themeKey || 'orange' })` を渡す。
- `render()` の `current`（ログイン中）分岐で、`isAdmin === true` のときだけメール・ログアウトに加えて歯車ボタン＋パネルを描く。`isAdmin` 偽は現状どおりメール＋ログアウトのみ（モック状態5）。
- パネルの選択中マークは渡された `themeKey` を初期選択にする。
- スウォッチ押下 → `POST /api/tenant/theme`（Bearer/Cookie は既存セッション経路）→ 成功で `location.reload()`、失敗でフッタにエラー（モック状態4）。AUTH_CSS（`ui/auth-client.mjs` 末尾）に歯車・パネルのCSSを足す。

### 3.5 不正・既定の解決まとめ（fail-fast との両立）

| 入力 | 描画 | API |
|---|---|---|
| `themeKey` 未設定（既存doc） | 既定オレンジ（空上書き） | 読み出し時に既定解決 |
| `themeKey === 'orange'` | 空上書き（`BASE_CSS` 既定を使う） | 集合内なので保存可 |
| 集合内キー | 末尾 `:root` 上書き | 保存可 |
| 集合外キー（壊れデータ／改ざん） | 描画は既定オレンジに解決（生500にしない） | API は 400 で拒否（書かせない＝壊れデータを増やさない） |

描画は「未設定/不正＝既定で出す」（ユーザー体験を止めない）、APIは「不正＝書かせない」（壊れデータを作らせない）。書き込み口を厳格に閉じるので、描画側の既定解決は防御的フォールバックであって沈黙の握りつぶしではない。

---

## 4. UX行動分析（最小）

- **誰が**: 各テナントの管理者コーチ（`isAdmin`）。非管理者・未ログインは入口（歯車）が見えない。
- **いつ**: 主に初期セットアップ直後（チーム発足・招待accept直後に「うちの色」に合わせる1回）。以降はほぼ変えない（ユニフォーム色・学校カラーに合わせる固定設定）。シーズン替わりやチーム改称時にまれに再設定。
- **B=MAT（行動の成立条件）**:
  - Motivation: 「自分のチームの色で計画を見たい」帰属感。低頻度・低緊急だが満足度に効く。
  - Ability: 歯車を押す→16色から1つ選ぶ、の2タップ。自由ピッカーの色選び負荷（無限の選択・コントラスト事故）を排除し、厳選16色で迷いを最小化（自チームのユニフォーム色に近い1色を選びやすい）。
  - Trigger: 右上の歯車（常設・ログアウト隣）。設定への動線が1つに固定。
- **エッジ（期待挙動）**:
  - 未設定 → オレンジで表示（既定）。
  - 不正キー → 描画はオレンジに解決、API は 400 で拒否。
  - 非管理者 → 歯車非表示（操作不能）。
  - 保存失敗 → 元の色を維持し、エラー＋再試行を出す（楽観適用しない＝失敗時に色が暴れない）。成功するまで現テーマのまま。

---

## 5. コントラスト・hallmark再監査結果（16色）

### 5.1 コントラスト再計算（16色・基準割れゼロ）

16色全テーマを WCAG 相対輝度で再計算した（パレット表 1.3 に全数値）。新規15テーマ（orange 既定を除く）は**全て** ink/主色 ≥ 4.5・deep/地 ≥ 4.9・boys/girls ≥ 1.25 を満たす。**基準割れゼロ**。初回案で割れた色（ティール 3.90→4.51、明色3色の白インク→暗インク反転、マルーンの burgundy 近接→分離）は再調整して掲載。

明色3色（スカイ/ライム/ゴールド）の主色/地は 1.57〜1.96 と低いが、これは「明色を別の色として並べる」ための割り切りで、暗インク文字＋スウォッチ罫線＋deep（≥4.9）の分業で可読性を確保する設計（1.3 の (i)〜(iii)）。

### 5.2 固定トークンとの衝突チェック（暗インク・新テーマ色 × ブロック種別/曜日/クリーム地）

新テーマ主色を固定構造色（ブロック種別 `--terra/--gold/--sage`・曜日 `--sat/--sun`・クリーム地）と色距離（dHue/dL/dS）で照合した。

- **大半は非衝突**。曜日色 `--sat/--sun` は BASE_CSS で**素の色としては描かれず**（10%不透明度の `-soft` 背景としてのみ使用）、ブランド主色（タブ・チップ・リンク）とは役割・彩度が別。
- **ブラウン主色 `#8a5a33` のみ、ブロック種別「対人」の `--terra #b8623b` と同じ暖色ブラウン族**（dHue 8・dL 11）。`--terra` は「対人」ブロックの種別タグ色・レクチャタグ色に使う。ブラウンテーマを選ぶと、計画本文の対人/レクチャタグ（terra）とクロムのブラウン主色が同系で並ぶ。terra の方が明るく彩度が高いので弁別は可能だが、16色中で最も近い組。→ **1行報告**（下記 5.4）。
- 明色テーマの暗インクは主色面の文字専用で、クリーム地・ブロック種別・曜日色には触れない（インク反転の影響は主色塗り面に限局）。

### 5.3 hallmark再監査（16色モック・検出ゼロ）

更新後モック `color-settings-mock.html`（16スウォッチ×3パネル＋16プレビュー）に `anti-patterns.md` の各named tellを grep + Python絵文字走査で実体検査した。

- side-stripe card（border帯）: **0**。罫線は全て `1px solid var(--hair|--line)` の hairline 区切り。
- 汎用書体（Inter/Roboto/Open Sans/Helvetica）: **0**。本文 Hiragino のみ（font-family 宣言は1箇所）。
- gradient（linear/radial/conic）・background-clip:text 見出し: **0**。
- emoji（絵文字・記号アイコン）: **0**（Python 絵文字レンジ走査で確認）。歯車・閉じる・チェックは全てSVG線画。
- 全幅centered hero・bare 100vw/100vh: **0**（狭幅パネルは `left/right:14px` のシート型）。
- 紫ピンクgradient・aurora blob・floating orb・偽chrome・AIナビ・AIフッタ・icon-tile grid: **0**。
- pure black/white 面・z-index:9999・transition:all・hover scale-105・bouncy easing: **0**。

**Summary — 0 critical · 0 major · 0 minor／Verdict — clean（検出ゼロ）。** stamp の存在だけでなく、上記を実 grep + 目視で実体検証した。

### 5.4 インク反転で変わった前提（1行報告）

- **明色テーマは `--orange-ink` が暗色になる**。波及は `peakchip`（目標の大会チップ・`--orange-deep` 地に `--orange-ink` 文字）1箇所のみ。明色テーマで「暗インク on 濃い deep 地」になり読めなくなるため、実装時に `peakchip` の文字色トークンを `--orange-ink` から独立させる（1.2.1・描画側1箇所の付帯修正）。これがインク反転の唯一の波及。
- **ブラウンテーマは唯一、固定ブロック種別色 `--terra`（対人/レクチャ）と同じ暖色ブラウン族**で並ぶ（弁別は可能だが16色中で最も近い）。気になる場合はブラウンを外すか、`--terra` をやや赤寄りに振る選択肢がある（ニュートラル据え置き方針の例外になるので既定では触らない）。
