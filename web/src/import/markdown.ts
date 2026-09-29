import { Marked } from 'marked'

const marked = new Marked({ gfm: true, breaks: false })

/**
 * Renders Markdown (GitHub-flavored: tables, task lists, strikethrough,
 * autolinks) to HTML. The result still needs sanitizing: Markdown may embed
 * raw HTML. A leading YAML front-matter block is dropped.
 */
export function markdownToHtml(markdown: string): string {
  const body = markdown.replace(/^---[ \t]*\n[\s\S]*?\n(?:---|\.\.\.)[ \t]*(?:\n|$)/, '')
  return marked.parse(body, { async: false })
}
