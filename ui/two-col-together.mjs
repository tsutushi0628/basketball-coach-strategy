/** Shared one-column rule for authored two-column days. */
export function isAllTogetherTwoColRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return false;
  const sameCell = (boys, girls) => {
    if (!boys || !girls) return false;
    const normalized = (cell) => ({
      block: cell.block || '',
      label: cell.label || cell.block || '',
      items: (cell.items || []).map((item) => ({ name: item.name || '', note: item.note || '' })),
    });
    return JSON.stringify(normalized(boys)) === JSON.stringify(normalized(girls));
  };
  return rows.every((row) => row && (row.both || sameCell(row.boys || row['男子'], row.girls || row['女子'])));
}
