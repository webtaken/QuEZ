import { describe, it, expect, vi, beforeEach } from 'vitest'

const parseOffice = vi.fn()
vi.mock('officeparser', () => ({ parseOffice: (...a: unknown[]) => parseOffice(...a) }))

const generateText = vi.fn()
vi.mock('ai', () => ({ generateText: (...a: unknown[]) => generateText(...a) }))
const openrouterFactory = vi.fn((id: string, opts?: unknown) => ({ id, opts }))
vi.mock('@openrouter/ai-sdk-provider', () => ({
  openrouter: (id: string, opts?: unknown) => openrouterFactory(id, opts),
}))

const { extractAttachmentText } = await import('./attachment-extract')

beforeEach(() => {
  parseOffice.mockReset()
  generateText.mockReset()
})

describe('extractAttachmentText', () => {
  it('decodes text files directly without calling officeparser and without debit', async () => {
    const bytes = new TextEncoder().encode('  hello notes  ')
    const out = await extractAttachmentText({ kind: 'text', bytes, mimeType: 'text/plain' })
    expect(out.text).toBe('hello notes')
    expect(out.debit).toBeNull()
    expect(parseOffice).not.toHaveBeenCalled()
  })

  it('runs officeparser for documents, trims, and reports no debit', async () => {
    parseOffice.mockResolvedValue({ toText: () => '  parsed pdf text  ' })
    const out = await extractAttachmentText({ kind: 'pdf', bytes: new Uint8Array([1, 2]), mimeType: 'application/pdf' })
    expect(out.text).toBe('parsed pdf text')
    expect(out.debit).toBeNull()
    expect(parseOffice).toHaveBeenCalledOnce()
    expect(Buffer.isBuffer(parseOffice.mock.calls[0][0])).toBe(true)
  })

  it('passes the kind as an explicit fileType hint so bundlers cannot break auto-detection', async () => {
    parseOffice.mockResolvedValue({ toText: () => 'x' })
    for (const kind of ['pdf', 'docx', 'pptx', 'xlsx'] as const) {
      await extractAttachmentText({ kind, bytes: new Uint8Array([1]), mimeType: 'application/octet-stream' })
      expect(parseOffice).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ fileType: kind }))
    }
  })

  it('sends images to the vision model with usage accounting and computes the debit', async () => {
    generateText.mockResolvedValue({
      text: 'transcribed image',
      steps: [{ providerMetadata: { openrouter: { usage: { cost: 0.0004 } } } }],
      usage: { totalTokens: 500 },
    })
    const bytes = new Uint8Array([9, 9])
    const out = await extractAttachmentText({ kind: 'image', bytes, mimeType: 'image/png' })
    expect(out.text).toBe('transcribed image')
    expect(out.debit).toEqual({ credits: 0.2, rawCostUsd: 0.0004, usedFallback: false })
    const arg = generateText.mock.calls[0][0]
    const content = arg.messages[0].content
    expect(content.some((c: { type: string }) => c.type === 'image')).toBe(true)
    expect(openrouterFactory).toHaveBeenCalledWith(
      'google/gemini-2.5-flash-lite',
      expect.objectContaining({ usage: { include: true } })
    )
  })

  it('falls back to token pricing when the image call reports no cost', async () => {
    generateText.mockResolvedValue({
      text: 'ok',
      steps: [{}],
      usage: { totalTokens: 10_000 },
    })
    const out = await extractAttachmentText({ kind: 'image', bytes: new Uint8Array([1]), mimeType: 'image/png' })
    expect(out.debit?.usedFallback).toBe(true)
    expect(out.debit?.rawCostUsd).toBeCloseTo(0.02)
  })
})
