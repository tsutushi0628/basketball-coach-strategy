/**
 * @file チームカラー・プリセット定義（新規hexの単一の置き場）。
 *
 * 各テナント（チーム）が自チームの主色を厳選16プリセットから選ぶ機能の色の真実源。
 * サーバ描画注入（functions/index.mjs）・色変更API検証（functions/index.mjs）・
 * 設定パネル描画（ui/auth-client.mjs）の3者がこの1モジュールだけを参照する。
 * payload 項目名・キー集合のズレを物理的に消すため、hex はここにしか書かない。
 *
 * 差し替え対象はブランドアクセント系6変数のみ:
 *   --orange / --orange-ink / --orange-soft / --orange-deep / --boys / --girls
 * クリーム地・本文インク・罫線・曜日色・ブロック種別色（render-shared.mjs TOKENS の構造色）は
 * 据え置く（読みやすさと意味の弁別を担う地のため）。design §1.1。
 */

/**
 * テーマキー → アクセント6変数の上書き値。design §1.4 の確定パレット（16色・コントラスト検証済み）。
 * 明色テーマ（sky/lime/gold）は主色面に白文字が乗らないため --orange-ink を暗インクにしている。
 * @type {Record<string, {'--orange':string,'--orange-ink':string,'--orange-soft':string,'--orange-deep':string,'--boys':string,'--girls':string}>}
 */
export const PRESET_THEMES = {
  orange:   { '--orange': '#ef7a32', '--orange-ink': '#fffaf2', '--orange-soft': '#ffd7b9', '--orange-deep': '#c4521b', '--boys': '#ef7a32', '--girls': '#b8623b' },
  red:      { '--orange': '#c63a31', '--orange-ink': '#fff5f3', '--orange-soft': '#f3c4bd', '--orange-deep': '#9a2820', '--boys': '#c63a31', '--girls': '#8f342c' },
  maroon:   { '--orange': '#9c343f', '--orange-ink': '#fbeef0', '--orange-soft': '#e6c4ca', '--orange-deep': '#6e222b', '--boys': '#9c343f', '--girls': '#6e222b' },
  rose:     { '--orange': '#bb3b6e', '--orange-ink': '#fff2f7', '--orange-soft': '#f0c6d8', '--orange-deep': '#8f2851', '--boys': '#bb3b6e', '--girls': '#8f2851' },
  burgundy: { '--orange': '#7a2336', '--orange-ink': '#fbecef', '--orange-soft': '#dfbcc4', '--orange-deep': '#5a1827', '--boys': '#7a2336', '--girls': '#5a1827' },
  purple:   { '--orange': '#7a4b9c', '--orange-ink': '#f8f4fb', '--orange-soft': '#d8c6e6', '--orange-deep': '#583271', '--boys': '#7a4b9c', '--girls': '#583271' },
  indigo:   { '--orange': '#46479c', '--orange-ink': '#f3f3fb', '--orange-soft': '#cacbe8', '--orange-deep': '#2f3072', '--boys': '#46479c', '--girls': '#2f3072' },
  navy:     { '--orange': '#34508c', '--orange-ink': '#f2f5fb', '--orange-soft': '#c3cfe6', '--orange-deep': '#22356a', '--boys': '#34508c', '--girls': '#22356a' },
  blue:     { '--orange': '#2f72bd', '--orange-ink': '#f3f8fd', '--orange-soft': '#c2dcf2', '--orange-deep': '#1d4f8c', '--boys': '#2f72bd', '--girls': '#1d4f8c' },
  sky:      { '--orange': '#7fc7ea', '--orange-ink': '#123040', '--orange-soft': '#d7eef9', '--orange-deep': '#1b6a8e', '--boys': '#7fc7ea', '--girls': '#a9dcf2' },
  teal:     { '--orange': '#157f7f', '--orange-ink': '#effafa', '--orange-soft': '#bce4e4', '--orange-deep': '#0e5a5a', '--boys': '#157f7f', '--girls': '#0e5a5a' },
  green:    { '--orange': '#2f7d46', '--orange-ink': '#f3faf4', '--orange-soft': '#bfe0c7', '--orange-deep': '#1f5d33', '--boys': '#2f7d46', '--girls': '#1f5d33' },
  lime:     { '--orange': '#a9d63b', '--orange-ink': '#222d08', '--orange-soft': '#e6f3c2', '--orange-deep': '#52690f', '--boys': '#a9d63b', '--girls': '#8aab2f' },
  gold:     { '--orange': '#e0a91d', '--orange-ink': '#352704', '--orange-soft': '#f6e3ac', '--orange-deep': '#7d5a0d', '--boys': '#e0a91d', '--girls': '#f0d27a' },
  brown:    { '--orange': '#8a5a33', '--orange-ink': '#fbf2ea', '--orange-soft': '#e2cdba', '--orange-deep': '#653f20', '--boys': '#8a5a33', '--girls': '#653f20' },
  charcoal: { '--orange': '#3a3f47', '--orange-ink': '#f3f4f6', '--orange-soft': '#c9ccd1', '--orange-deep': '#23272d', '--boys': '#3a3f47', '--girls': '#23272d' },
};

/** API 検証の許可集合（16キー・orange を含む）。挿入順＝パネルのスウォッチ表示順。 */
export const THEME_KEYS = Object.keys(PRESET_THEMES);

/** 既定テーマ（現行トークンと同値＝orange）。未設定・未知キーはここへ解決する。 */
export const DEFAULT_THEME_KEY = 'orange';

/** アクセント6変数の並び（上書きCSSの出力順を決定論にするため固定）。 */
const ACCENT_VARS = ['--orange', '--orange-ink', '--orange-soft', '--orange-deep', '--boys', '--girls'];

/**
 * パネルのスウォッチ用一覧（キー・表示名・主色・第2色）。表示名は短縮しつつ折り返さない短語。
 * design §2 のモック .sw-name / --sw-main / --sw-2nd に対応。THEME_KEYS と同順。
 * @type {Array<{key:string,label:string,main:string,second:string}>}
 */
export const PRESET_SWATCHES = [
  { key: 'orange',   label: 'オレンジ' },
  { key: 'red',      label: 'レッド' },
  { key: 'maroon',   label: 'マルーン' },
  { key: 'rose',     label: 'ローズ' },
  { key: 'burgundy', label: 'バーガンディ' },
  { key: 'purple',   label: 'パープル' },
  { key: 'indigo',   label: 'インディゴ' },
  { key: 'navy',     label: 'ネイビー' },
  { key: 'blue',     label: 'ブルー' },
  { key: 'sky',      label: 'スカイ' },
  { key: 'teal',     label: 'ティール' },
  { key: 'green',    label: 'グリーン' },
  { key: 'lime',     label: 'ライム' },
  { key: 'gold',     label: 'ゴールド' },
  { key: 'brown',    label: 'ブラウン' },
  { key: 'charcoal', label: 'チャコール' },
].map((s) => ({
  ...s,
  main: PRESET_THEMES[s.key]['--orange'],
  second: PRESET_THEMES[s.key]['--girls'],
}));

/**
 * テーマキーをアクセント6変数だけの :root 上書きCSSに変換する。
 *
 * 描画注入で renderPage の css 引数の末尾に連結して使う（BASE_CSS の :root より後に置いて勝たせる）。
 * design §3.2 のカスケード方向。
 *
 *   - orange（既定）・未知キー・未設定 → 空文字（BASE_CSS が既に既定オレンジを持つため上書き不要）。
 *   - 既知の非orangeキー → `:root{--orange:…;--orange-ink:…;--orange-soft:…;--orange-deep:…;--boys:…;--girls:…}`。
 *
 * ニュートラル・曜日・ブロック種別色は出力しない（アクセント6変数だけ）。
 * @param {string} themeKey
 * @returns {string}
 */
export function themeOverrideCss(themeKey) {
  if (themeKey === DEFAULT_THEME_KEY) return '';
  // 所属判定は許可集合(THEME_KEYS)で行う。PRESET_THEMES[key] の truthy 判定だけだと
  // '__proto__'/'constructor' 等の継承プロパティで Object.prototype を拾い、`:root{--orange:undefined…}`
  // の壊れCSSを返してしまう。THEME_KEYS は own-key 集合なので継承プロパティを除外でき、API検証と同じ
  // allowlist に揃う（描画側も自己防御＝API検証の一層だけに依存しない）。未設定・未知キーは空文字＝既定オレンジ。
  if (!THEME_KEYS.includes(themeKey)) return '';
  const theme = PRESET_THEMES[themeKey];
  const decls = ACCENT_VARS.map((v) => `${v}:${theme[v]}`).join(';');
  return `:root{${decls}}`;
}
