/**
 * Development page for the importers (served by Vite at /import-test.html).
 * Shows what each dropped, picked or pasted file turns into.
 */
import {
  ImportError,
  acceptedTypes,
  disposeImported,
  importClipboard,
  importDataTransfer,
  importFile,
  importFiles,
  type Imported,
  type ImportOptions,
} from './index'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const picker = $<HTMLInputElement>('picker')
const results = $<HTMLDivElement>('results')
const errors = $<HTMLUListElement>('errors')
const status = $<HTMLDivElement>('status')
const progress = $<HTMLProgressElement>('progress')
const label = $<HTMLSpanElement>('label')
const lenient = $<HTMLInputElement>('lenient')

picker.accept = acceptedTypes()

let controller: AbortController | null = null
let imported: Imported[] = []

async function run(task: (options: ImportOptions) => Promise<Imported[]>): Promise<Imported[]> {
  controller?.abort()
  const current = new AbortController()
  controller = current
  status.hidden = false
  const started = performance.now()
  try {
    const items = await task({
      signal: current.signal,
      onProgress: (fraction, text) => {
        progress.value = fraction
        label.textContent = `${Math.round(fraction * 100)}% ${text}`
      },
      onFileError: lenient.checked ? reportError : undefined,
    })
    imported.push(...items)
    for (const item of items) results.append(await renderItem(item))
    label.textContent = `Imported ${items.length} item(s) in ${Math.round(performance.now() - started)} ms`
    return items
  } catch (error) {
    if (current.signal.aborted) label.textContent = 'Cancelled'
    else reportError(error)
    return []
  } finally {
    if (controller === current) controller = null
    progress.value = 1
  }
}

function reportError(error: unknown) {
  const li = document.createElement('li')
  li.textContent =
    error instanceof ImportError
      ? `${error.file ?? 'Import'}: ${error.message}${error.cause ? ` (${String(error.cause)})` : ''}`
      : String(error)
  errors.append(li)
  console.error(error)
}

// Drop anywhere.
document.addEventListener('dragover', (event) => {
  event.preventDefault()
  document.body.classList.add('dragging')
})
document.addEventListener('dragleave', (event) => {
  if (event.relatedTarget === null) document.body.classList.remove('dragging')
})
document.addEventListener('drop', (event) => {
  event.preventDefault()
  document.body.classList.remove('dragging')
  const data = event.dataTransfer
  // importDataTransfer reads the DataTransfer synchronously before its first await.
  if (data) void run((options) => importDataTransfer(data, options))
})

document.addEventListener('paste', (event) => {
  const data = event.clipboardData
  if (!data) return
  event.preventDefault()
  void run((options) => importClipboard(data, options))
})

picker.addEventListener('change', () => {
  const files = Array.from(picker.files ?? [])
  picker.value = ''
  if (files.length > 0) void run((options) => importFiles(files, options))
})

$('cancel').addEventListener('click', () => controller?.abort())
$('clear').addEventListener('click', () => {
  disposeImported(imported)
  imported = []
  results.replaceChildren()
  errors.replaceChildren()
  status.hidden = true
})

const fixtureUrls = import.meta.glob('./fixtures/*', { query: '?url', import: 'default', eager: true }) as Record<string, string>

async function loadFixture(path: string): Promise<File> {
  const response = await fetch(fixtureUrls[path])
  const name = path.slice(path.lastIndexOf('/') + 1)
  // Leave the type empty, as browsers often do for dropped files, so sniffing is exercised.
  return new File([await response.blob()], name)
}

$('fixtures').addEventListener('click', async () => {
  const files = await Promise.all(Object.keys(fixtureUrls).map(loadFixture))
  await run((options) => importFiles(files, options))
})

// Hooks for automated checks from the browser console.
Object.assign(window, {
  importTest: {
    fixtures: () => Object.keys(fixtureUrls),
    loadFixture,
    importFile,
    run,
    summary: () => imported.map(summarize),
  },
})

function summarize(item: Imported): Record<string, unknown> {
  switch (item.kind) {
    case 'image':
      return { kind: item.kind, name: item.name, width: item.width, height: item.height, hasAlpha: item.hasAlpha }
    case 'animation':
      return {
        kind: item.kind,
        name: item.name,
        width: item.width,
        height: item.height,
        frames: item.frames.length,
        delays: [...new Set(item.frames.map((f) => f.delayMs))],
        loops: item.loops,
      }
    case 'pages':
      return { kind: item.kind, name: item.name, pageCount: item.pageCount }
    case 'rich':
      return { kind: item.kind, name: item.name, html: item.html.slice(0, 400) }
    case 'text':
      return { kind: item.kind, name: item.name, text: item.text.slice(0, 200) }
    case 'table':
      return { kind: item.kind, name: item.name, rows: item.rows.slice(0, 5) }
  }
}

// ---------------------------------------------------------------------------
// Rendering

async function renderItem(item: Imported): Promise<HTMLElement> {
  const card = document.createElement('section')
  card.className = 'card'
  const title = document.createElement('h2')
  title.textContent = item.name
  const meta = document.createElement('div')
  meta.className = 'meta'
  card.append(title, meta)

  switch (item.kind) {
    case 'image': {
      meta.textContent = `image · ${item.width}×${item.height} · ${item.hasAlpha ? 'has alpha' : 'opaque'}`
      card.append(checker(bitmapCanvas(item.bitmap, 320)))
      break
    }
    case 'animation': {
      const total = item.frames.reduce((sum, frame) => sum + frame.delayMs, 0)
      meta.textContent = `animation · ${item.width}×${item.height} · ${item.frames.length} frames · ${(total / 1000).toFixed(2)} s · loops ${item.loops === 0 ? '∞' : item.loops}`
      const canvas = bitmapCanvas(item.frames[0].bitmap, 320)
      card.append(checker(canvas))
      animate(canvas, item.frames)
      const strip = document.createElement('div')
      strip.className = 'strip'
      for (const frame of item.frames.slice(0, 12)) strip.append(checker(bitmapCanvas(frame.bitmap, 48)))
      card.append(strip)
      break
    }
    case 'pages': {
      const size = await item.pageSize(0)
      meta.textContent = `pages · ${item.pageCount} page(s) · first page ${Math.round(size.width)}×${Math.round(size.height)} pt`
      const strip = document.createElement('div')
      strip.className = 'strip'
      for (let index = 0; index < Math.min(item.pageCount, 3); index++) {
        const bitmap = await item.renderPage(index, 300)
        const canvas = bitmapCanvas(bitmap, 150)
        canvas.title = `Page ${index + 1}: rendered ${bitmap.width}×${bitmap.height}`
        strip.append(canvas)
        bitmap.close()
      }
      const text = document.createElement('pre')
      text.textContent = await item.pageText(0)
      card.append(strip, text)
      break
    }
    case 'rich': {
      meta.textContent = `rich · ${item.html.length} chars of HTML`
      const view = document.createElement('div')
      view.className = 'rich'
      view.innerHTML = item.html // sanitized by the importer
      const details = document.createElement('details')
      const summary = document.createElement('summary')
      summary.textContent = 'HTML'
      const source = document.createElement('pre')
      source.textContent = item.html
      details.append(summary, source)
      card.append(view, details)
      break
    }
    case 'text': {
      meta.textContent = `text · ${item.text.length} chars`
      const pre = document.createElement('pre')
      pre.textContent = item.text
      card.append(pre)
      break
    }
    case 'table': {
      meta.textContent = `table · ${item.rows.length} rows × ${item.rows[0]?.length ?? 0} columns`
      const table = document.createElement('table')
      table.className = 'data'
      for (const row of item.rows.slice(0, 50)) {
        const tr = table.insertRow()
        for (const cell of row) tr.insertCell().textContent = cell
      }
      card.append(table)
      break
    }
  }
  return card
}

function bitmapCanvas(bitmap: ImageBitmap, maxSide: number): HTMLCanvasElement {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return canvas
}

function checker(child: HTMLElement): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.className = 'checker'
  wrapper.append(child)
  return wrapper
}

function animate(canvas: HTMLCanvasElement, frames: { bitmap: ImageBitmap; delayMs: number }[]) {
  const context = canvas.getContext('2d')
  if (!context) return
  let index = 0
  const step = () => {
    if (!canvas.isConnected && index > 0) return
    const frame = frames[index]
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(frame.bitmap, 0, 0, canvas.width, canvas.height)
    index = (index + 1) % frames.length
    setTimeout(step, frame.delayMs)
  }
  step()
}
