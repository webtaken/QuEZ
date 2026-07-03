import { parseOffice } from 'officeparser'
import { generateText } from 'ai'
import { openrouter } from '@openrouter/ai-sdk-provider'
import type { AttachmentKind } from './attachment-kind'

const IMAGE_MODEL = 'google/gemini-2.5-flash-lite'
const IMAGE_PROMPT =
  'Transcribe all text in this image verbatim. Then describe any diagrams, figures, charts, tables, or handwriting in detail. Output plain text only.'

// Returns extracted plain text. Documents go through officeparser (pure JS/WASM,
// serverless-safe); plain text/markdown/csv are decoded directly; images are
// transcribed + described by a cheap vision model.
export async function extractAttachmentText(args: {
  kind: AttachmentKind
  bytes: Uint8Array
  mimeType: string
}): Promise<string> {
  if (args.kind === 'image') {
    const { text } = await generateText({
      model: openrouter(IMAGE_MODEL),
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
    return text.trim()
  }

  if (args.kind === 'text') {
    return Buffer.from(args.bytes).toString('utf-8').trim()
  }

  // pdf | docx | pptx | xlsx. The explicit fileType hint matters: officeparser's
  // magic-byte auto-detection loads `file-type` via a dynamic import that
  // bundlers (Next/Turbopack) cannot resolve at runtime, and the kind is
  // already authoritative from upload validation anyway.
  const ast = await parseOffice(Buffer.from(args.bytes), { fileType: args.kind })
  return ast.toText().trim()
}
