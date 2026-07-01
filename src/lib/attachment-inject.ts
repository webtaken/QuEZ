import type { AttachmentKind } from './attachment-kind'

export type ReadyAttachment = {
  id: string
  filename: string
  kind: AttachmentKind
  extractedText: string
}

// ~4 chars/token heuristic: ~12k tokens/file, ~30k tokens total across files.
const PER_FILE_CHAR_CAP = 48_000
const TOTAL_CHAR_CAP = 120_000
const TRUNCATION_MARK = '\n…[truncated]'

// Scan the whole conversation (current turn + history) for attachment references,
// so later turns ("add more from the doc") keep access without re-uploading.
export function collectAttachmentIds(messages: { parts?: unknown[] }[]): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const m of messages ?? []) {
    for (const part of m.parts ?? []) {
      const p = part as { type?: string; id?: string }
      if (p.type === 'data-attachment' && typeof p.id === 'string' && !seen.has(p.id)) {
        seen.add(p.id)
        ids.push(p.id)
      }
    }
  }
  return ids
}

export function buildAttachmentSystemBlock(attachments: ReadyAttachment[]): string {
  if (!attachments.length) return ''
  let total = 0
  const sections: string[] = []
  for (const a of attachments) {
    if (total >= TOTAL_CHAR_CAP) break
    let text = a.extractedText ?? ''
    if (text.length > PER_FILE_CHAR_CAP) text = text.slice(0, PER_FILE_CHAR_CAP) + TRUNCATION_MARK
    if (total + text.length > TOTAL_CHAR_CAP) {
      text = text.slice(0, Math.max(0, TOTAL_CHAR_CAP - total)) + TRUNCATION_MARK
    }
    total += text.length
    sections.push(`--- ${a.filename} (${a.kind}) ---\n${text}`)
  }
  return (
    'The user attached these materials. Use them as the primary source for building or updating the quiz.\n\n' +
    sections.join('\n\n')
  )
}
