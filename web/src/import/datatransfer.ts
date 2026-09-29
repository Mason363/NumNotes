import { ImportError } from './errors'
import { naturalSortBy } from './naturalSort'
import { PACKAGE_EXTENSIONS, extensionOf } from './sniff'

export interface SourceFile {
  file: File
  /** Found by walking a dropped folder (rather than dropped or picked directly). */
  fromFolder: boolean
}

export interface TransferSnapshot {
  /** Top-level files and folders, in the order the browser reports them. */
  items: Array<{ entry: FileSystemEntry | null; file: File | null }>
  html: string
  text: string
}

/** Upper bound on files collected from dropped folders. */
export const MAX_FOLDER_FILES = 2000
const MAX_FOLDER_DEPTH = 32
const JUNK_NAMES = new Set(['thumbs.db', 'desktop.ini', '__macosx', 'icon\r', '$recycle.bin'])

/**
 * Captures everything needed from a DataTransfer. Must be called
 * synchronously inside the paste/drop event handler: browsers empty the
 * DataTransfer once the handler returns (the file entries stay usable).
 */
export function snapshotTransfer(data: DataTransfer): TransferSnapshot {
  const items: TransferSnapshot['items'] = []
  const list = data.items
  if (list) {
    for (let i = 0; i < list.length; i++) {
      const item = list[i]
      if (item.kind !== 'file') continue
      const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null
      const file = item.getAsFile()
      if (entry || file) items.push({ entry, file })
    }
  }
  if (items.length === 0) {
    for (const file of Array.from(data.files ?? [])) items.push({ entry: null, file })
  }
  return { items, html: readData(data, 'text/html'), text: readData(data, 'text/plain') }
}

function readData(data: DataTransfer, type: string): string {
  try {
    return data.getData(type)
  } catch {
    return ''
  }
}

/** Hidden files and OS clutter, skipped when walking folders. */
export function isHiddenName(name: string): boolean {
  return name.startsWith('.') || JUNK_NAMES.has(name.toLowerCase())
}

/**
 * Resolves a snapshot into files: top-level items keep their order, folders
 * are walked recursively with their entries in natural name order and hidden
 * files skipped. macOS document packages (.pages, .key...) are passed on as
 * empty placeholder files so they get reported as unsupported.
 */
export async function collectFiles(snapshot: TransferSnapshot, signal?: AbortSignal): Promise<SourceFile[]> {
  const out: SourceFile[] = []
  for (const { entry, file } of snapshot.items) {
    signal?.throwIfAborted()
    if (entry?.isDirectory) {
      if (isOpaquePackage(entry.name)) out.push({ file: new File([], entry.name), fromFolder: false })
      else await walkDirectory(entry as FileSystemDirectoryEntry, out, signal, 0)
    } else if (file) {
      out.push({ file, fromFolder: false })
    } else if (entry?.isFile) {
      out.push({ file: await fileOf(entry as FileSystemFileEntry), fromFolder: false })
    }
  }
  return out
}

function isOpaquePackage(name: string): boolean {
  const ext = extensionOf(name)
  // An .rtfd package is a folder holding TXT.rtf plus its images: walk it.
  return PACKAGE_EXTENSIONS.has(ext) && ext !== 'rtfd'
}

async function walkDirectory(
  directory: FileSystemDirectoryEntry,
  out: SourceFile[],
  signal: AbortSignal | undefined,
  depth: number,
): Promise<void> {
  if (depth > MAX_FOLDER_DEPTH) return
  const entries = naturalSortBy(await readAllEntries(directory.createReader()), (entry) => entry.name)
  for (const entry of entries) {
    signal?.throwIfAborted()
    if (isHiddenName(entry.name)) continue
    if (entry.isDirectory) {
      if (isOpaquePackage(entry.name)) out.push({ file: new File([], entry.name), fromFolder: true })
      else await walkDirectory(entry as FileSystemDirectoryEntry, out, signal, depth + 1)
    } else if (entry.isFile) {
      out.push({ file: await fileOf(entry as FileSystemFileEntry), fromFolder: true })
      if (out.length > MAX_FOLDER_FILES) {
        throw new ImportError(`That folder has more than ${MAX_FOLDER_FILES} files. Try a smaller folder.`)
      }
    }
  }
}

/** readEntries() returns entries in batches (100 at a time in Chrome) until an empty batch. */
async function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  const all: FileSystemEntry[] = []
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
    if (batch.length === 0) return all
    all.push(...batch)
  }
}

function fileOf(entry: FileSystemFileEntry): Promise<File> {
  return new Promise<File>((resolve, reject) => entry.file(resolve, reject))
}
