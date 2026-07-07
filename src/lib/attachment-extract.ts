import { parseOffice } from 'officeparser'
import { generateText } from 'ai'
import { openrouter } from '@openrouter/ai-sdk-provider'
import { computeDebit } from '@/lib/credit-math'
import type { AttachmentKind } from './attachment-kind'

export const IMAGE_MODEL = 'google/gemini-2.5-flash-lite'
const IMAGE_PROMPT =
  'Transcribe all text in this image verbatim. Then describe any diagrams, figures, charts, tables, or handwriting in detail. Output plain text only.'

export type ExtractResult = {
  text: string
  // Set only for AI-powered paths (images); null means the extraction was free.
  debit: { credits: number; rawCostUsd: number; usedFallback: boolean } | null
}

// Returns extracted plain text. Documents go through officeparser (pure JS/WASM,
// serverless-safe); plain text/markdown/csv are decoded directly; images are
// transcribed + described by a cheap vision model (which costs credits).
export async function extractAttachmentText(args: {
  kind: AttachmentKind
  bytes: Uint8Array
  mimeType: string
}): Promise<ExtractResult> {
  if (args.kind === 'image') {
    const result = await generateText({
      model: openrouter(IMAGE_MODEL, { usage: { include: true } }),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: IMAGE_PROMPT },
            { type: 'image', image: args.bytes, mediaType: args.mimeType },
          ],
        },
      ],
    })
    const debit = computeDebit({
      steps: result.steps ?? [],
      totalTokens: result.usage?.totalTokens,
    })
    return { text: result.text.trim(), debit }
  }

  if (args.kind === 'text') {
    return { text: Buffer.from(args.bytes).toString('utf-8').trim(), debit: null }
  }

  // pdf | docx | pptx | xlsx. The explicit fileType hint matters: officeparser's
  // magic-byte auto-detection loads `file-type` via a dynamic import that
  // bundlers (Next/Turbopack) cannot resolve at runtime, and the kind is
  // already authoritative from upload validation anyway.
  const ast = await parseOffice(Buffer.from(args.bytes), { fileType: args.kind })
  return { text: ast.toText().trim(), debit: null }
}
