export type AttachmentKind = 'pdf' | 'docx' | 'pptx' | 'xlsx' | 'text' | 'image'

export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024 // 15 MB
export const MAX_FILES_PER_MESSAGE = 3

const MIME_KIND: Record<string, AttachmentKind> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/plain': 'text',
  'text/markdown': 'text',
  'text/csv': 'text',
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/webp': 'image',
  'image/gif': 'image',
}

const EXT_KIND: Record<string, AttachmentKind> = {
  pdf: 'pdf',
  docx: 'docx',
  pptx: 'pptx',
  xlsx: 'xlsx',
  txt: 'text',
  md: 'text',
  markdown: 'text',
  csv: 'text',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  webp: 'image',
  gif: 'image',
}

// Accept attribute for the <input type="file">, derived from the allowlist.
export const ACCEPT_ATTR = '.pdf,.docx,.pptx,.xlsx,.txt,.md,.csv,.png,.jpg,.jpeg,.webp,.gif'

export function kindFor(filename: string, mimeType: string): AttachmentKind | null {
  const byMime = MIME_KIND[mimeType]
  if (byMime) return byMime
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return EXT_KIND[ext] ?? null
}

export function validateUpload(args: {
  filename: string
  mimeType: string
  sizeBytes: number
}): { ok: true; kind: AttachmentKind } | { ok: false; error: string } {
  if (!args.filename || typeof args.filename !== 'string') return { ok: false, error: 'filename required' }
  if (!Number.isInteger(args.sizeBytes) || args.sizeBytes <= 0) return { ok: false, error: 'invalid size' }
  if (args.sizeBytes > MAX_ATTACHMENT_BYTES) return { ok: false, error: 'file too large (max 15MB)' }
  const kind = kindFor(args.filename, args.mimeType)
  if (!kind) return { ok: false, error: 'unsupported file type' }
  return { ok: true, kind }
}
