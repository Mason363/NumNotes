/**
 * HTML sanitizer for imported rich text (pasted HTML, HTML files, and the
 * output of the Markdown and DOCX converters).
 *
 * The source is parsed by the browser (DOMParser, inert: no scripts run and no
 * resources load), walked, and re-serialized from scratch, so the output only
 * ever contains markup this module generates itself:
 *
 *   p h1 h2 h3 strong em u s code pre blockquote ul ol li
 *   table thead tbody tr th td img br hr a span
 *
 * Attributes: img[src] (data:image/* and blob: only) and img[alt], a[href]
 * (http, https, mailto, tel), td/th[colspan, rowspan], and span/td/th[style]
 * restricted to `color` and `background-color`. Presentational markup that
 * commonly carries meaning is translated: bold/italic/underline/strike inline
 * styles become strong/em/u/s, <font color> becomes a styled span, h4-h6
 * become h3, and layout containers (div, section, ...) become paragraphs.
 *
 * The tree walk only needs the small `DomLikeNode` surface, so it can be
 * exercised without a browser.
 */

export interface DomLikeNode {
  readonly nodeType: number
  readonly nodeName: string
  readonly nodeValue: string | null
  readonly childNodes: ArrayLike<DomLikeNode>
  getAttribute?(name: string): string | null
}

const ELEMENT_NODE = 1
const TEXT_NODE = 3
const CDATA_SECTION_NODE = 4
const MAX_DEPTH = 200

type BlockTag = 'p' | 'h1' | 'h2' | 'h3' | 'pre' | 'blockquote' | 'ul' | 'ol' | 'table' | 'hr'
type InlineTag = 'strong' | 'em' | 'u' | 's' | 'code' | 'a' | 'span' | 'br' | 'img'
type TableTag = 'thead' | 'tbody' | 'tr' | 'th' | 'td'
/** Internal-only: layout containers (div and friends) and table captions, flattened during normalization. */
type ContainerTag = '#container' | '#caption'
type Tag = BlockTag | InlineTag | TableTag | 'li' | ContainerTag

interface TextNode {
  type: 'text'
  text: string
}

interface ElementNode {
  type: 'element'
  tag: Tag
  attrs: [string, string][]
  children: TreeNode[]
}

type TreeNode = TextNode | ElementNode

const BLOCK_TAGS: ReadonlySet<string> = new Set<BlockTag>(['p', 'h1', 'h2', 'h3', 'pre', 'blockquote', 'ul', 'ol', 'table', 'hr'])
const VOID_TAGS: ReadonlySet<string> = new Set(['br', 'hr', 'img'])
const FORMAT_TAGS: ReadonlySet<string> = new Set(['strong', 'em', 'u', 's', 'code'])

/** Elements dropped together with everything inside them. */
const DROPPED = new Set([
  'script', 'style', 'template', 'noscript', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'param',
  'svg', 'canvas', 'audio', 'video', 'source', 'track', 'map', 'area', 'head', 'title', 'meta', 'link', 'base',
  'select', 'datalist', 'option', 'optgroup', 'textarea', 'button', 'colgroup', 'col', 'rt', 'rp', 'annotation',
  'annotation-xml', 'dialog',
])

/** Source tags that map directly onto an output tag. */
const TAG_MAP: Record<string, Tag> = {
  p: 'p',
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  h4: 'h3',
  h5: 'h3',
  h6: 'h3',
  strong: 'strong',
  b: 'strong',
  em: 'em',
  i: 'em',
  cite: 'em',
  dfn: 'em',
  var: 'em',
  u: 'u',
  ins: 'u',
  s: 's',
  strike: 's',
  del: 's',
  code: 'code',
  tt: 'code',
  kbd: 'code',
  samp: 'code',
  pre: 'pre',
  listing: 'pre',
  xmp: 'pre',
  plaintext: 'pre',
  blockquote: 'blockquote',
  ul: 'ul',
  ol: 'ol',
  dir: 'ul',
  menu: 'ul',
  li: 'li',
  table: 'table',
  thead: 'thead',
  tbody: 'tbody',
  tfoot: 'tbody',
  tr: 'tr',
  th: 'th',
  td: 'td',
  a: 'a',
  caption: '#caption',
  br: 'br',
  hr: 'hr',
  img: 'img',
}

/** Layout containers: flattened, with their inline content becoming paragraphs. */
const CONTAINERS = new Set([
  'div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'nav', 'figure', 'figcaption', 'address',
  'details', 'summary', 'dl', 'dt', 'dd', 'center', 'fieldset', 'legend', 'form', 'hgroup', 'search',
  'body', 'html', 'multicol',
])

const IGNORED_COLORS = new Set(['inherit', 'initial', 'unset', 'revert', 'currentcolor', 'auto', 'none', 'windowtext', 'window'])
const DEFAULT_TEXT_COLORS = new Set(['black', '#000', '#000000', 'rgb(0,0,0)', 'windowtext'])
const DEFAULT_BACKGROUNDS = new Set(['transparent', 'white', '#fff', '#ffffff', 'rgb(255,255,255)', 'rgba(0,0,0,0)', 'window'])
const SAFE_IMAGE_TYPES = new Set(['png', 'jpeg', 'jpg', 'pjpeg', 'gif', 'webp', 'avif', 'bmp', 'svg+xml', 'x-icon', 'vnd.microsoft.icon'])

/** Parses `html` with the browser's DOMParser and returns sanitized HTML. */
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return doc.body ? sanitizeDom(doc.body) : ''
}

/** Sanitizes the children of `root` (typically a document body). */
export function sanitizeDom(root: DomLikeNode): string {
  const converted = convertChildren(root, 0)
  return serialize(normalizeFlow(converted, 'root'))
}

// ---------------------------------------------------------------------------
// Step 1: DOM -> intermediate tree of allowed (or internal) tags.

function convertChildren(node: DomLikeNode, depth: number): TreeNode[] {
  const out: TreeNode[] = []
  const children = node.childNodes
  for (let i = 0; i < children.length; i++) out.push(...convertNode(children[i], depth + 1))
  return out
}

function convertNode(node: DomLikeNode, depth: number): TreeNode[] {
  if (node.nodeType === TEXT_NODE || node.nodeType === CDATA_SECTION_NODE) {
    const text = node.nodeValue ?? ''
    return text ? [{ type: 'text', text }] : []
  }
  if (node.nodeType !== ELEMENT_NODE) return [] // comments, processing instructions, doctypes
  if (depth > MAX_DEPTH) return textOf(node) ? [{ type: 'text', text: textOf(node) }] : []

  const name = node.nodeName.toLowerCase()
  if (DROPPED.has(name)) return []
  const attr = (key: string) => node.getAttribute?.(key) ?? null

  switch (name) {
    case 'input': {
      if ((attr('type') ?? '').toLowerCase() !== 'checkbox') return []
      return [{ type: 'text', text: attr('checked') !== null ? '\u2611 ' : '\u2610 ' }]
    }
    case 'br':
      return [element('br')]
    case 'hr':
      return [element('hr')]
    case 'img': {
      const src = safeImageSrc(attr('src'))
      if (!src) return []
      const attrs: [string, string][] = [['src', src]]
      const alt = attr('alt')
      if (alt) attrs.push(['alt', alt])
      return [element('img', attrs)]
    }
    case 'wbr':
      return []
  }

  const style = parseStyle(attr('style'))
  // Code copied from editors (VS Code and others) arrives as <div>s styled
  // white-space: pre; keep it verbatim like a <pre>.
  if (TAG_MAP[name] === 'pre' || (style.preformatted && CONTAINERS.has(name))) {
    return [element('pre', [], [element('code', [], [{ type: 'text', text: preformattedText(node) }])])]
  }

  const children = convertChildren(node, depth)
  let tag: Tag | null = TAG_MAP[name] ?? (CONTAINERS.has(name) ? '#container' : null)

  // Google Docs wraps whole pastes in <b style="font-weight:normal">.
  if (tag === 'strong' && style.weight === 'normal') tag = null
  if (tag === 'em' && style.italic === false) tag = null

  const fontColor = name === 'font' ? attr('color') : null
  // Formatting implied by inline styles, plus colors, wraps the content.
  const decorate = (content: TreeNode[]) =>
    wrapInlineRuns(content, (inline) => wrapColors(applyFormatting(inline, style, tag), style, fontColor))

  switch (tag) {
    case null:
      // Unknown or purely presentational element (span, font, small, sub,
      // custom elements, Office namespaces...): keep the content only.
      return decorate(children)
    case 'a': {
      const href = safeHref(attr('href'))
      return href ? [element('a', [['href', href]], decorate(children))] : decorate(children)
    }
    case 'td':
    case 'th': {
      const attrs: [string, string][] = []
      for (const key of ['colspan', 'rowspan']) {
        const value = attr(key)
        if (value && /^\s*\d+\s*$/.test(value)) {
          const span = Math.min(1000, parseInt(value, 10))
          if (span > 1) attrs.push([key, String(span)])
        }
      }
      // Cell colors live on the cell itself rather than on a wrapping span.
      const colorStyle = colorDeclarations(style, attr('bgcolor'))
      if (colorStyle) attrs.push(['style', colorStyle])
      return [element(tag, attrs, wrapInlineRuns(children, (inline) => applyFormatting(inline, style, tag)))]
    }
    default:
      return [element(tag, [], decorate(children))]
  }
}

function element(tag: Tag, attrs: [string, string][] = [], children: TreeNode[] = []): ElementNode {
  return { type: 'element', tag, attrs, children }
}

/**
 * Applies `wrap` to each run of inline content. Blocks are descended into
 * instead of being wrapped, so a styled <div> around paragraphs styles the
 * paragraphs' text rather than turning the paragraphs into inline content.
 */
function wrapInlineRuns(nodes: TreeNode[], wrap: (inline: TreeNode[]) => TreeNode[]): TreeNode[] {
  const out: TreeNode[] = []
  let run: TreeNode[] = []
  const flush = () => {
    if (run.length > 0) out.push(...(hasContent(run) ? wrap(run) : run))
    run = []
  }
  for (const node of nodes) {
    if (isInline(node)) {
      run.push(node)
      continue
    }
    flush()
    const el = node as ElementNode
    out.push(el.tag === 'pre' || el.tag === 'hr' ? el : { ...el, children: wrapInlineRuns(el.children, wrap) })
  }
  flush()
  return out
}

export interface ParsedStyle {
  weight?: 'bold' | 'normal'
  italic?: boolean
  underline?: boolean
  strike?: boolean
  color?: string
  background?: string
  /** white-space: pre or pre-wrap */
  preformatted?: boolean
}

export function parseStyle(style: string | null): ParsedStyle {
  const parsed: ParsedStyle = {}
  if (!style) return parsed
  for (const declaration of style.split(';')) {
    const colon = declaration.indexOf(':')
    if (colon === -1) continue
    const property = declaration.slice(0, colon).trim().toLowerCase()
    const value = declaration.slice(colon + 1).replace(/!important/i, '').trim().toLowerCase()
    switch (property) {
      case 'font-weight':
        if (/^(bold|bolder|[6-9]00)$/.test(value)) parsed.weight = 'bold'
        else if (/^(normal|lighter|[1-5]00)$/.test(value)) parsed.weight = 'normal'
        break
      case 'font-style':
        if (value === 'italic' || value.startsWith('oblique')) parsed.italic = true
        else if (value === 'normal') parsed.italic = false
        break
      case 'text-decoration':
      case 'text-decoration-line':
        if (value.includes('underline')) parsed.underline = true
        if (value.includes('line-through')) parsed.strike = true
        break
      case 'color':
        if (isSafeColor(value)) parsed.color = value
        break
      case 'background-color':
      case 'background':
        if (isSafeColor(value)) parsed.background = value
        break
      case 'white-space':
        if (value === 'pre' || value === 'pre-wrap') parsed.preformatted = true
        break
    }
  }
  return parsed
}

function isSafeColor(value: string): boolean {
  if (IGNORED_COLORS.has(value)) return false
  return /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla)\([\d\s.,%/+-]*(deg)?[\d\s.,%/+-]*\)|[a-z]{3,30})$/.test(value)
}

function applyFormatting(children: TreeNode[], style: ParsedStyle, tag: Tag | null): TreeNode[] {
  let out = children
  if (style.strike) out = [element('s', [], out)]
  if (style.underline) out = [element('u', [], out)]
  if (style.italic) out = [element('em', [], out)]
  // Headings and header cells are already bold.
  if (style.weight === 'bold' && tag !== 'h1' && tag !== 'h2' && tag !== 'h3' && tag !== 'th') {
    out = [element('strong', [], out)]
  }
  return out
}

function wrapColors(children: TreeNode[], style: ParsedStyle, fontColor: string | null): TreeNode[] {
  const declarations = colorDeclarations(style, null, fontColor)
  return declarations ? [element('span', [['style', declarations]], children)] : children
}

function colorDeclarations(style: ParsedStyle, bgcolorAttr: string | null, colorAttr: string | null = null): string {
  const parts: string[] = []
  const attrColor = colorAttr?.trim().toLowerCase()
  const color = style.color ?? (attrColor && isSafeColor(attrColor) ? attrColor : undefined)
  if (color && !DEFAULT_TEXT_COLORS.has(color.replace(/\s+/g, ''))) parts.push(`color: ${color}`)
  const attrBackground = bgcolorAttr?.trim().toLowerCase()
  const background = style.background ?? (attrBackground && isSafeColor(attrBackground) ? attrBackground : undefined)
  if (background && !DEFAULT_BACKGROUNDS.has(background.replace(/\s+/g, ''))) parts.push(`background-color: ${background}`)
  return parts.join('; ')
}

/** Text of a <pre>, with <br> and nested block boundaries turned into newlines. */
function preformattedText(node: DomLikeNode): string {
  let out = ''
  const walk = (current: DomLikeNode, depth: number) => {
    const children = current.childNodes
    for (let i = 0; i < children.length; i++) {
      const child = children[i]
      if (child.nodeType === TEXT_NODE || child.nodeType === CDATA_SECTION_NODE) {
        out += child.nodeValue ?? ''
      } else if (child.nodeType === ELEMENT_NODE && depth < MAX_DEPTH) {
        const name = child.nodeName.toLowerCase()
        if (DROPPED.has(name)) continue
        if (name === 'br') {
          out += '\n'
          continue
        }
        const isBlock = name === 'div' || name === 'p' || name === 'li'
        if (isBlock && out !== '' && !out.endsWith('\n')) out += '\n'
        walk(child, depth + 1)
        if (isBlock && !out.endsWith('\n')) out += '\n'
      }
    }
  }
  walk(node, 0)
  return out.replace(/\n$/, '')
}

function textOf(node: DomLikeNode): string {
  if (node.nodeType === TEXT_NODE) return node.nodeValue ?? ''
  let out = ''
  const children = node.childNodes
  for (let i = 0; i < children.length; i++) out += textOf(children[i])
  return out
}

export function safeHref(value: string | null): string | null {
  if (!value) return null
  // Browsers ignore control characters and whitespace inside schemes ("java\tscript:").
  const compact = value.replace(/[\u0000-\u0020\u007f-\u009f]/g, '')
  if (!/^(https?:\/\/|mailto:|tel:)/i.test(compact)) return null
  return value.trim()
}

export function safeImageSrc(value: string | null): string | null {
  if (!value) return null
  const src = value.trim()
  if (/^blob:/i.test(src)) return src
  const match = /^data:image\/([a-z0-9.+-]+)[;,]/i.exec(src)
  return match && SAFE_IMAGE_TYPES.has(match[1].toLowerCase()) ? src : null
}

// ---------------------------------------------------------------------------
// Step 2: normalize structure (block/inline nesting, lists, tables).

type FlowContext = 'root' | 'blockquote' | 'li' | 'cell'

function isInline(node: TreeNode): boolean {
  return node.type === 'text' || !(BLOCK_TAGS.has(node.tag) || isContainer(node.tag) || node.tag === 'li' || isTablePart(node.tag))
}

function isContainer(tag: Tag): boolean {
  return tag === '#container' || tag === '#caption'
}

function isTablePart(tag: Tag): boolean {
  return tag === 'thead' || tag === 'tbody' || tag === 'tr' || tag === 'td' || tag === 'th'
}

/**
 * Normalizes content that may mix blocks and inline nodes. Runs of inline
 * content become paragraphs whenever the container also holds blocks (or at
 * the root / in blockquotes, which only take blocks); containers are flattened.
 */
function normalizeFlow(nodes: TreeNode[], context: FlowContext): TreeNode[] {
  const pieces: Array<{ inline: TreeNode[] } | { block: TreeNode }> = []
  let run: TreeNode[] = []
  let sawBlock = false

  const flush = () => {
    if (run.length > 0) pieces.push({ inline: run })
    run = []
  }

  const visit = (list: TreeNode[]) => {
    for (const node of list) {
      if (isInline(node)) {
        run.push(node)
        continue
      }
      const el = node as ElementNode
      flush()
      // A nested list alone doesn't make a list item "loose": keep <li>text<ul>...</ul></li>.
      if (!(context === 'li' && (el.tag === 'ul' || el.tag === 'ol'))) sawBlock = true
      if (isContainer(el.tag) || el.tag === 'li') {
        // Containers, and list items outside of a list, are flattened.
        visit(el.children)
        flush()
      } else if (isTablePart(el.tag)) {
        for (const block of normalizeTable(element('table', [], [el]))) pieces.push({ block })
      } else {
        for (const block of normalizeBlock(el)) pieces.push({ block })
      }
    }
  }
  visit(nodes)
  flush()

  const wrapInParagraphs = sawBlock || context === 'root' || context === 'blockquote'
  const out: TreeNode[] = []
  for (const piece of pieces) {
    if ('block' in piece) {
      out.push(piece.block)
      continue
    }
    const inline = normalizeInline(piece.inline, new Set())
    if (!hasContent(inline)) continue
    if (wrapInParagraphs) out.push(element('p', [], trimEdges(inline)))
    else out.push(...trimEdges(inline))
  }
  return out
}

function normalizeBlock(node: ElementNode): TreeNode[] {
  switch (node.tag) {
    case 'p':
    case 'h1':
    case 'h2':
    case 'h3': {
      const inline = trimEdges(normalizeInline(flattenToInline(node.children), new Set()))
      if (!hasContent(inline) && !isEmptyLine(inline)) return []
      return [element(node.tag, [], inline)]
    }
    case 'blockquote': {
      const children = normalizeFlow(node.children, 'blockquote')
      return children.length > 0 ? [element('blockquote', [], children)] : []
    }
    case 'ul':
    case 'ol':
      return normalizeList(node)
    case 'table':
      return normalizeTable(node)
    case 'pre':
    case 'hr':
      return [node]
    default:
      return []
  }
}

function normalizeList(list: ElementNode): TreeNode[] {
  const items: ElementNode[] = []
  let loose: TreeNode[] = []
  const flushLoose = () => {
    if (loose.some((n) => n.type === 'element' || n.text.trim() !== '')) {
      items.push(element('li', [], loose))
    }
    loose = []
  }
  for (const child of list.children) {
    if (child.type === 'text' && child.text.trim() === '') continue
    if (child.type === 'element' && child.tag === 'li') {
      flushLoose()
      items.push(child)
    } else if (child.type === 'element' && (child.tag === 'ul' || child.tag === 'ol') && items.length > 0 && loose.length === 0) {
      // A nested list placed directly inside a list belongs to the previous item.
      items[items.length - 1].children.push(child)
    } else {
      loose.push(child)
    }
  }
  flushLoose()

  const normalized: TreeNode[] = []
  for (const item of items) {
    const children = normalizeFlow(item.children, 'li')
    normalized.push(element('li', [], children))
  }
  return normalized.length > 0 ? [element(list.tag, [], normalized)] : []
}

/** Returns the table (with thead/tbody sections), preceded by its caption as a paragraph. */
function normalizeTable(table: ElementNode): TreeNode[] {
  const head: ElementNode[] = []
  const body: ElementNode[] = []
  const captions: TreeNode[] = []
  let pendingCells: TreeNode[] = []

  const addRow = (row: ElementNode, target: ElementNode[]) => {
    const cells: TreeNode[] = []
    for (const child of row.children) {
      if (child.type === 'element' && (child.tag === 'td' || child.tag === 'th')) {
        cells.push(element(child.tag, child.attrs, normalizeFlow(child.children, 'cell')))
      } else if (child.type === 'element' || child.text.trim() !== '') {
        // Stray content in a row: give it a cell of its own.
        cells.push(element('td', [], normalizeFlow([child], 'cell')))
      }
    }
    if (cells.length > 0) target.push(element('tr', [], cells))
  }
  const flushCells = (target: ElementNode[]) => {
    if (pendingCells.length > 0) addRow(element('tr', [], pendingCells), target)
    pendingCells = []
  }

  const visit = (children: TreeNode[], target: ElementNode[]) => {
    for (const child of children) {
      if (child.type === 'text') {
        if (child.text.trim() !== '') pendingCells.push(element('td', [], [child]))
        continue
      }
      switch (child.tag) {
        case '#caption':
          captions.push(...normalizeFlow(child.children, 'root'))
          break
        case 'thead':
          flushCells(target)
          visit(child.children, head)
          flushCells(head)
          break
        case 'tbody':
        case '#container':
          flushCells(target)
          visit(child.children, body)
          flushCells(body)
          break
        case 'tr':
          flushCells(target)
          addRow(child, target)
          break
        case 'td':
        case 'th':
          pendingCells.push(child)
          break
        default:
          pendingCells.push(element('td', [], [child]))
      }
    }
  }
  visit(table.children, body)
  flushCells(body)

  if (head.length === 0 && body.length === 0) return captions
  const sections: TreeNode[] = []
  if (head.length > 0) sections.push(element('thead', [], head))
  if (body.length > 0) sections.push(element('tbody', [], body))
  return [...captions, element('table', [], sections)]
}

/**
 * Converts any block structure inside inline-only content into line breaks.
 * Breaks are only inserted between pieces of content, never at the edges, so
 * genuine <br>s (like the one in an intentional `<p><br></p>`) survive intact.
 */
function flattenToInline(nodes: TreeNode[]): TreeNode[] {
  const out: TreeNode[] = []
  let pendingBreak = false
  const breakLine = () => {
    pendingBreak = out.length > 0
  }
  const push = (...items: TreeNode[]) => {
    if (items.length === 0) return
    if (pendingBreak) {
      const last = out[out.length - 1]
      if (!(last?.type === 'element' && last.tag === 'br')) out.push(element('br'))
      pendingBreak = false
    }
    out.push(...items)
  }
  for (const node of nodes) {
    if (node.type === 'text') {
      push(node)
      continue
    }
    switch (node.tag) {
      case 'p':
      case 'h1':
      case 'h2':
      case 'h3':
      case 'blockquote':
      case 'li':
      case '#container':
      case '#caption':
      case 'ul':
      case 'ol':
      case 'tr':
      case 'thead':
      case 'tbody':
      case 'table':
        breakLine()
        push(...flattenToInline(node.children))
        breakLine()
        break
      case 'td':
      case 'th':
        push(...flattenToInline(node.children), { type: 'text', text: ' ' })
        break
      case 'hr':
        breakLine()
        break
      case 'pre':
        breakLine()
        push(...node.children)
        breakLine()
        break
      default:
        push({ ...node, children: flattenToInline(node.children) })
    }
  }
  return out
}

/**
 * Cleans inline content: collapses whitespace, drops empty formatting and
 * formatting nested inside itself, and flattens stray blocks.
 */
function normalizeInline(nodes: TreeNode[], active: ReadonlySet<Tag>): TreeNode[] {
  const out: TreeNode[] = []
  const pushText = (raw: string) => {
    const text = raw.replace(/[ \t\n\r\f]+/g, ' ')
    if (!text) return
    const last = out[out.length - 1]
    if (last?.type === 'text') last.text = (last.text + text).replace(/ {2,}/g, ' ')
    else out.push({ type: 'text', text })
  }
  for (const node of flattenToInline(nodes)) {
    if (node.type === 'text') {
      pushText(node.text)
      continue
    }
    if (node.tag === 'br' || node.tag === 'img') {
      out.push(node)
      continue
    }
    const redundant = (FORMAT_TAGS.has(node.tag) || node.tag === 'a') && active.has(node.tag)
    const nextActive = redundant ? active : new Set([...active, node.tag])
    const children = normalizeInline(node.children, nextActive)
    if (redundant || (node.tag === 'span' && node.attrs.length === 0)) {
      for (const child of children) {
        if (child.type === 'text') pushText(child.text)
        else out.push(child)
      }
      continue
    }
    if (!hasContent(children)) {
      // Formatting around nothing but a space: keep the space, drop the tag.
      if (children.some((c) => c.type === 'text')) pushText(' ')
      continue
    }
    out.push({ ...node, children })
  }
  return out
}

function hasContent(nodes: TreeNode[]): boolean {
  return nodes.some((n) => (n.type === 'text' ? /[^ \t\n\r\f]/.test(n.text) : n.tag === 'img' || hasContent(n.children)))
}

/** A paragraph holding only line breaks: an intentional blank line. */
function isEmptyLine(nodes: TreeNode[]): boolean {
  return nodes.length > 0 && nodes.every((n) => (n.type === 'element' && n.tag === 'br') || (n.type === 'text' && n.text.trim() === ''))
}

/** Removes leading/trailing spaces (and trailing line breaks) inside a block. */
function trimEdges(nodes: TreeNode[]): TreeNode[] {
  const out = nodes.slice()
  const trim = (list: TreeNode[], fromStart: boolean): void => {
    const index = fromStart ? 0 : list.length - 1
    const node = list[index]
    if (!node) return
    if (node.type === 'text') {
      const text = fromStart ? node.text.replace(/^ +/, '') : node.text.replace(/ +$/, '')
      if (text === '') {
        list.splice(index, 1)
        trim(list, fromStart)
      } else {
        list[index] = { type: 'text', text }
      }
    } else if (node.tag !== 'br' && node.tag !== 'img') {
      const children = node.children.slice()
      trim(children, fromStart)
      if (hasContent(children)) {
        list[index] = { ...node, children }
      } else {
        list.splice(index, 1)
        trim(list, fromStart)
      }
    }
  }
  trim(out, true)
  if (hasContent(out)) {
    while (out.length > 0) {
      const last = out[out.length - 1]
      if (last.type === 'element' && last.tag === 'br') out.pop()
      else break
    }
  }
  trim(out, false)
  return out
}

// ---------------------------------------------------------------------------
// Step 3: serialize.

function serialize(nodes: TreeNode[]): string {
  let out = ''
  for (const node of nodes) {
    if (node.type === 'text') {
      out += escapeText(node.text)
      continue
    }
    if (isContainer(node.tag)) {
      out += serialize(node.children)
      continue
    }
    out += `<${node.tag}`
    for (const [name, value] of node.attrs) out += ` ${name}="${escapeAttribute(value)}"`
    out += '>'
    if (VOID_TAGS.has(node.tag)) continue
    out += serialize(node.children)
    out += `</${node.tag}>`
  }
  return out
}

export function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\u00a0/g, '&nbsp;')
}

export function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
