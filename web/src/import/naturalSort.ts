const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * Compares names the way file managers do: digit runs compare by numeric value
 * ("img2" < "img10") and letter case is ignored. Ties fall back to a plain
 * code-unit comparison so the order is total and deterministic.
 */
export function naturalCompare(a: string, b: string): number {
  const primary = collator.compare(a, b)
  if (primary !== 0) return primary
  return a < b ? -1 : a > b ? 1 : 0
}

/** Stable natural sort by a string key; returns a new array. */
export function naturalSortBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  return items
    .map((item, index) => ({ item, index, key: key(item) }))
    .sort((x, y) => naturalCompare(x.key, y.key) || x.index - y.index)
    .map((entry) => entry.item)
}
