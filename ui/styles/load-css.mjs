/**
 * @file 各 UI モジュールが埋め込みCSSを .css ファイルから読み込むための共有ヘルパー。
 *
 * 呼び出し元の `import.meta.url` を明示的に受け取り、そのファイルの場所を基準に
 * 相対パスで .css を読む。esbuild でバンドルされると `import.meta.url` は出力ファイル
 * （functions/dist/index.mjs）自身を指すようになるため、`./styles/xxx.css` のような相対解決は
 * バンドル後は `functions/dist/styles/xxx.css` を指すことになる。そのため `functions/package.json`
 * の build スクリプトで `ui/styles/` の内容を `functions/dist/styles/` へコピーしている
 * （バンドル前のソース実行時は本来の `ui/styles/` がそのまま使われる）。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * @param {string} callerUrl 呼び出し元モジュールの import.meta.url
 * @param {string} relPath 呼び出し元ディレクトリからの相対パス（例: 'styles/base.css'）
 * @returns {string} ファイル内容（utf8・そのまま）
 */
export function loadCss(callerUrl, relPath) {
  const dir = dirname(fileURLToPath(callerUrl));
  return readFileSync(resolve(dir, relPath), 'utf8');
}
