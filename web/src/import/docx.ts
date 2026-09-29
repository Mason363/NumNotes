import mammoth from 'mammoth'

/**
 * Converts a Word document to HTML with mammoth: paragraphs, headings,
 * lists, tables, links, bold/italic/underline/strikethrough, and images as
 * data: URLs. The result still needs sanitizing.
 */
export async function docxToHtml(data: ArrayBuffer): Promise<string> {
  const result = await mammoth.convertToHtml(
    { arrayBuffer: data },
    {
      // mammoth drops underlines unless they're mapped explicitly.
      styleMap: ['u => u', 'strike => s'],
      convertImage: mammoth.images.dataUri,
    },
  )
  return result.value
}
