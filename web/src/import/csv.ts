export type Delimiter = ',' | ';' | '\t'

const CANDIDATES: readonly Delimiter[] = [',', ';', '\t']
const SAMPLE_CHARS = 64 * 1024
const SAMPLE_RECORDS = 50

/**
 * Parses CSV/TSV text: quoted fields (which may contain delimiters and line
 * breaks), doubled-quote escapes, CRLF/LF/CR line endings, and a leading byte
 * order mark. The delimiter is detected when not given. Rows are padded to a
 * common width and trailing blank rows are dropped.
 */
export function parseDelimited(input: string, delimiter?: Delimiter): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const rows = parseRecords(text, delimiter ?? detectDelimiter(text), Infinity)

  while (rows.length > 0 && isBlankRow(rows[rows.length - 1])) rows.pop()

  const width = rows.reduce((max, row) => Math.max(max, row.length), 0)
  for (const row of rows) {
    while (row.length < width) row.push('')
  }
  return rows
}

/**
 * Picks the delimiter that splits the leading records into a consistent,
 * non-trivial number of fields. Tabs win ties because they rarely occur inside
 * data; a semicolon beats a comma when every comma sits between digits (the
 * decimal-comma convention that makes spreadsheets export semicolons).
 */
export function detectDelimiter(input: string): Delimiter {
  const sample = input.slice(0, SAMPLE_CHARS)
  const stats = CANDIDATES.map((delimiter) => {
    const records = parseRecords(sample, delimiter, SAMPLE_RECORDS).filter((row) => !isBlankRow(row))
    // The last record of a truncated sample may be cut short.
    if (sample.length < input.length && records.length > 1) records.pop()
    const counts = records.map((row) => row.length - 1)
    const { mode, frequency } = modeOf(counts)
    const consistency = counts.length > 0 ? frequency / counts.length : 0
    const total = counts.reduce((sum, count) => sum + count, 0)
    return { delimiter, mode, consistency, total }
  })

  const viable = stats.filter((s) => s.mode > 0 && s.consistency >= 0.8)
  if (viable.length === 0) {
    const best = stats.reduce((a, b) => (b.total > a.total ? b : a))
    return best.total > 0 ? best.delimiter : ','
  }
  if (viable.length === 1) return viable[0].delimiter

  const tab = viable.find((s) => s.delimiter === '\t')
  if (tab) return tab.delimiter

  const comma = viable.find((s) => s.delimiter === ',')
  const semicolon = viable.find((s) => s.delimiter === ';')
  if (comma && semicolon) {
    const commas = sample.match(/,/g)?.length ?? 0
    const decimalCommas = sample.match(/\d,(?=\d)/g)?.length ?? 0
    if (commas > 0 && decimalCommas === commas) return ';'
  }
  viable.sort((a, b) => b.consistency - a.consistency || b.mode - a.mode)
  return viable[0].delimiter
}

function parseRecords(text: string, delimiter: string, maxRecords: number): string[][] {
  const rows: string[][] = []
  const length = text.length
  let row: string[] = []
  let i = 0

  const endRecord = () => {
    rows.push(row)
    row = []
  }

  while (i < length && rows.length < maxRecords) {
    // Start of a field. Leading spaces before an opening quote are ignored.
    let j = i
    while (j < length && text[j] === ' ') j++
    if (text[j] === '"') {
      let value = ''
      i = j + 1
      for (;;) {
        const quote = text.indexOf('"', i)
        if (quote === -1) {
          // Unterminated quote: take the rest of the input verbatim.
          value += text.slice(i)
          i = length
          break
        }
        value += text.slice(i, quote)
        if (text[quote + 1] === '"') {
          value += '"'
          i = quote + 2
        } else {
          i = quote + 1
          break
        }
      }
      // Stray text between the closing quote and the next delimiter is kept,
      // minus the padding spaces people put around delimiters.
      const rest = i
      while (i < length && text[i] !== delimiter && text[i] !== '\n' && text[i] !== '\r') i++
      row.push(value + text.slice(rest, i).trim())
    } else {
      let end = i
      while (end < length) {
        const c = text[end]
        if (c === delimiter || c === '\n' || c === '\r') break
        end++
      }
      row.push(text.slice(i, end))
      i = end
    }

    if (i >= length) {
      endRecord()
      break
    }
    const c = text[i]
    if (c === delimiter) {
      i++
      if (i >= length) {
        row.push('')
        endRecord()
      }
    } else {
      // Line break: CRLF, LF or CR.
      i += c === '\r' && text[i + 1] === '\n' ? 2 : 1
      endRecord()
    }
  }
  return rows
}

function isBlankRow(row: readonly string[]): boolean {
  return row.every((cell) => cell.trim() === '')
}

function modeOf(values: readonly number[]): { mode: number; frequency: number } {
  const counts = new Map<number, number>()
  let mode = 0
  let frequency = 0
  for (const value of values) {
    const count = (counts.get(value) ?? 0) + 1
    counts.set(value, count)
    if (count > frequency || (count === frequency && value > mode)) {
      mode = value
      frequency = count
    }
  }
  return { mode, frequency }
}
