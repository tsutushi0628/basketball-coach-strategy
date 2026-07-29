/**
 * @file コーチ手書き上書き日（layout:"two-col"）の男女セル比較ルール（行単位・正本）。
 *
 * 紙面・画面・コピー用テキストの3系統（pattern-timeline.mjs / editor.mjs / render-shared.mjs）が
 * 同じ実体を使う。判定の単位は「行」。日単位の isAllTogetherTwoColRows は行単位の isTogetherRow の
 * 上に載る薄いラッパーとして残す（コピー用テキストの見出し分岐「全行共通／一部男女別／男女2列」で使う）。
 * 描画側（pattern-timeline.mjs の twoColTimeline・editor.mjs の timelineHtml）はもう日単位判定を
 * ゲートに使わず、各行で isTogetherRow を呼んで「共通行を1本・相違行を左右2列」に振り分ける。
 */

/**
 * 男女2セルが完全に同一内容か（どちらか欠けていれば false）。
 * 正規化（block/label/items のみ比較・退避キー等の付随情報は無視）を内側に持つ自己完結の関数にする
 * （editor.mjs がクライアント側スクリプトへ `.toString()` で本体だけを注入する制約があり、外部の
 * private helper を呼ぶ形にすると注入先で参照解決できずに壊れるため）。
 */
export function isSameGenderCell(boys, girls) {
  if (!boys || !girls) return false;
  const normalize = (cell) => ({
    block: cell.block || '',
    label: cell.label || cell.block || '',
    items: (cell.items || []).map((item) => ({ name: item.name || '', note: item.note || '' })),
  });
  return JSON.stringify(normalize(boys)) === JSON.stringify(normalize(girls));
}

/**
 * 1行が「男女同一（= 1本で表示してよい）」か。
 * row.both（明示の男女共通セル）を持つか、男女別セル（boys/girls または 男子/女子 キー・
 * 呼び出し元のデータ系統差を吸収）が内容一致するかのいずれかで true。
 */
export function isTogetherRow(row) {
  if (!row) return false;
  if (row.both) return true;
  return isSameGenderCell(row.boys || row['男子'], row.girls || row['女子']);
}

/** 日単位ルール（行単位判定の上に載る）: 全行が isTogetherRow なら true。 */
export function isAllTogetherTwoColRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return false;
  return rows.every((row) => isTogetherRow(row));
}
