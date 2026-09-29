/** The subset of pdf.js's `TextItem` used to rebuild lines of text. */
export interface PdfTextItem {
  str: string
  /** Text matrix [a, b, c, d, e, f]; (e, f) is the baseline origin in PDF units (y grows upwards). */
  transform: number[]
  width: number
  height: number
  hasEOL?: boolean
}

/**
 * Joins pdf.js text items into plain text. A change of baseline starts a new
 * line, a vertical jump of well over a line height starts a new paragraph
 * (blank line), and a horizontal gap between items on one line becomes a space.
 */
export function assemblePageText(items: readonly PdfTextItem[]): string {
  let out = ''
  let lastY: number | null = null
  let lastEndX: number | null = null
  let lastHeight = 0

  const newline = () => {
    out = out.replace(/[ \t]+$/, '')
    if (out !== '' && !out.endsWith('\n')) out += '\n'
  }

  for (const item of items) {
    const x = item.transform[4] ?? 0
    const y = item.transform[5] ?? 0
    const height = item.height || Math.hypot(item.transform[2] ?? 0, item.transform[3] ?? 0) || lastHeight || 10

    if (item.str !== '') {
      if (lastY !== null) {
        const dy = Math.abs(y - lastY)
        const lineHeight = Math.max(height, lastHeight)
        if (dy > lineHeight * 0.5) {
          newline()
          if (dy > lineHeight * 1.8 && out !== '' && !out.endsWith('\n\n')) out += '\n'
        } else if (
          lastEndX !== null &&
          x - lastEndX > height * 0.15 &&
          !/\s$/.test(out) &&
          !/^\s/.test(item.str)
        ) {
          out += ' '
        }
      }
      out += item.str
      lastY = y
      lastEndX = x + item.width
      lastHeight = height
    }

    if (item.hasEOL) {
      newline()
      lastEndX = null
    }
  }

  return out
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
