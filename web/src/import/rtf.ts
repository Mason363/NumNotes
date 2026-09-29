import { escapeText } from './sanitize'

/**
 * Converts RTF (as written by TextEdit, WordPad, Word, LibreOffice...) into
 * the basic HTML subset used for rich imports: paragraphs, line breaks, and
 * bold/italic/underline/strikethrough runs. Everything else (fonts, colors,
 * tables, pictures, fields' instructions) is dropped, keeping the text.
 */
export function rtfToHtml(rtf: string): string {
  return renderParagraphs(parseRtf(rtf))
}

interface CharFormat {
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
}

interface GroupState extends CharFormat {
  /** Inside a destination whose content isn't document text. */
  skip: boolean
  /** Fallback characters that follow each \uN (the \ucN setting). */
  uc: number
}

interface Run extends CharFormat {
  text: string
}

/** Destinations whose content is metadata rather than document text. */
const SKIPPED_DESTINATIONS = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'nonshppict', 'shp', 'shpinst', 'shppict',
  'header', 'headerl', 'headerr', 'headerf', 'footer', 'footerl', 'footerr', 'footerf', 'footnote', 'annotation',
  'xmlnstbl', 'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'themedata', 'colorschememapping',
  'latentstyles', 'datastore', 'filetbl', 'revtbl', 'userprops', 'pgdsctbl', 'fldinst', 'bkmkstart', 'bkmkend',
  'docvar', 'ftnsep', 'ftnsepc', 'aftnsep', 'aftnsepc', 'template', 'wgrffmtfilter', 'private', 'pn', 'mmathPr',
  'expandedcolortbl', 'operator', 'author', 'title', 'subject', 'keywords', 'comment', 'company', 'doccomm',
  'passwordhash', 'protusertbl', 'sp', 'sn', 'sv', 'txe', 'atnid', 'atnauthor', 'atntime', 'atnref',
])

const SYMBOL_WORDS: Record<string, string> = {
  emdash: '\u2014',
  endash: '\u2013',
  bullet: '\u2022',
  lquote: '\u2018',
  rquote: '\u2019',
  ldblquote: '\u201c',
  rdblquote: '\u201d',
  emspace: '\u2003',
  enspace: '\u2002',
  qmspace: '\u2005',
}

const CODEPAGE_LABELS: Record<number, string> = {
  437: 'ibm866',
  866: 'ibm866',
  874: 'windows-874',
  932: 'shift_jis',
  936: 'gbk',
  949: 'euc-kr',
  950: 'big5',
  10000: 'macintosh',
}

const CONTROL_WORD = /([a-zA-Z]{1,32})(-?\d{1,10})? ?/y

function parseRtf(rtf: string): Run[][] {
  const paragraphs: Run[][] = []
  const stack: GroupState[] = []
  let runs: Run[] = []
  let state: GroupState = { bold: false, italic: false, underline: false, strike: false, skip: false, uc: 1 }
  let codepage = 1252
  let pendingBytes: number[] = []
  let fallbackToSkip = 0
  let atGroupStart = false

  const appendText = (text: string) => {
    if (state.skip || text === '') return
    const last = runs[runs.length - 1]
    if (last && last.bold === state.bold && last.italic === state.italic && last.underline === state.underline && last.strike === state.strike) {
      last.text += text
    } else {
      runs.push({ text, bold: state.bold, italic: state.italic, underline: state.underline, strike: state.strike })
    }
  }
  const flushBytes = () => {
    if (pendingBytes.length === 0) return
    const bytes = pendingBytes
    pendingBytes = []
    appendText(decodeCodepage(bytes, codepage))
  }
  const endParagraph = () => {
    flushBytes()
    if (state.skip) return
    paragraphs.push(runs)
    runs = []
  }

  const length = rtf.length
  let i = 0
  while (i < length) {
    const c = rtf[i]

    if (c === '{') {
      flushBytes()
      stack.push(state)
      state = { ...state }
      atGroupStart = true
      fallbackToSkip = 0
      i++
      continue
    }
    if (c === '}') {
      flushBytes()
      state = stack.pop() ?? state
      atGroupStart = false
      fallbackToSkip = 0
      i++
      continue
    }
    if (c === '\r' || c === '\n') {
      i++ // raw line breaks are not content in RTF
      continue
    }

    if (c === '\\') {
      const next = rtf[i + 1]
      if (next === undefined) break
      const groupStart = atGroupStart
      atGroupStart = false

      CONTROL_WORD.lastIndex = i + 1
      const match = CONTROL_WORD.exec(rtf)
      if (match) {
        i = CONTROL_WORD.lastIndex
        const word = match[1]
        const param = match[2] === undefined ? undefined : parseInt(match[2], 10)
        if (word === 'bin') {
          i += Math.max(0, param ?? 0) // raw binary payload
          continue
        }
        if (state.skip) continue
        if (groupStart && SKIPPED_DESTINATIONS.has(word)) {
          flushBytes()
          state.skip = true
          continue
        }
        flushBytes()
        switch (word) {
          case 'par':
          case 'sect':
          case 'page':
          case 'row':
            endParagraph()
            break
          case 'line':
            appendText('\n')
            break
          case 'tab':
          case 'cell':
            appendText('\t')
            break
          case 'b':
            state.bold = param !== 0
            break
          case 'i':
            state.italic = param !== 0
            break
          case 'ul':
          case 'uld':
          case 'uldb':
          case 'uldash':
          case 'ulth':
          case 'ulw':
          case 'ulwave':
            state.underline = param !== 0
            break
          case 'ulnone':
            state.underline = false
            break
          case 'strike':
          case 'striked':
            state.strike = param !== 0
            break
          case 'plain':
            state.bold = state.italic = state.underline = state.strike = false
            break
          case 'uc':
            state.uc = Math.max(0, param ?? 1)
            break
          case 'u': {
            let code = param ?? 0
            if (code < 0) code += 65536
            appendText(String.fromCharCode(code))
            fallbackToSkip = state.uc
            break
          }
          case 'ansicpg':
            codepage = param ?? 1252
            break
          default:
            if (word in SYMBOL_WORDS) appendText(SYMBOL_WORDS[word])
        }
        continue
      }

      // Control symbols.
      if (next === "'") {
        const byte = parseInt(rtf.slice(i + 2, i + 4), 16)
        i += 4
        if (fallbackToSkip > 0) {
          fallbackToSkip--
        } else if (!Number.isNaN(byte) && !state.skip) {
          pendingBytes.push(byte)
        }
        continue
      }
      i += 2
      if (next === '*') {
        if (groupStart) state.skip = true
        continue
      }
      if (state.skip) continue
      flushBytes()
      switch (next) {
        case '\\':
        case '{':
        case '}':
          appendText(next)
          break
        case '~':
          appendText('\u00a0')
          break
        case '_':
          appendText('\u2011')
          break
        case '\n':
        case '\r':
          endParagraph()
          break
        // '\-' (optional hyphen), '\|', '\:' and unknown symbols produce nothing.
      }
      continue
    }

    // Plain text up to the next special character.
    atGroupStart = false
    if (fallbackToSkip > 0) {
      fallbackToSkip--
      i++
      continue
    }
    let end = i + 1
    while (end < length) {
      const d = rtf[end]
      if (d === '\\' || d === '{' || d === '}' || d === '\r' || d === '\n') break
      end++
    }
    flushBytes()
    appendText(rtf.slice(i, end))
    i = end
  }

  flushBytes()
  if (runs.length > 0) paragraphs.push(runs)
  return paragraphs
}

function decodeCodepage(bytes: number[], codepage: number): string {
  const label = CODEPAGE_LABELS[codepage] ?? (codepage >= 1250 && codepage <= 1258 ? `windows-${codepage}` : 'windows-1252')
  try {
    return new TextDecoder(label).decode(new Uint8Array(bytes))
  } catch {
    return new TextDecoder('windows-1252').decode(new Uint8Array(bytes))
  }
}

function renderParagraphs(paragraphs: Run[][]): string {
  const isEmpty = (runs: Run[]) => runs.every((run) => run.text.trim() === '')
  let start = 0
  let end = paragraphs.length
  while (start < end && isEmpty(paragraphs[start])) start++
  while (end > start && isEmpty(paragraphs[end - 1])) end--

  let html = ''
  for (const runs of paragraphs.slice(start, end)) {
    const inner = isEmpty(runs) ? '' : runs.map(renderRun).join('').replace(/^\s+|(?:\s|<br>)+$/g, '')
    html += `<p>${inner || '<br>'}</p>`
  }
  return html
}

function renderRun(run: Run): string {
  let html = escapeText(run.text).replace(/\t/g, ' ').replace(/\n/g, '<br>')
  if (run.text.trim() === '') return html
  if (run.strike) html = `<s>${html}</s>`
  if (run.underline) html = `<u>${html}</u>`
  if (run.italic) html = `<em>${html}</em>`
  if (run.bold) html = `<strong>${html}</strong>`
  return html
}
