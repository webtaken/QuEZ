import { describe, it, expect, vi, beforeEach } from 'vitest'

const parseOffice = vi.fn()
vi.mock('officeparser', () => ({ parseOffice: (...a: unknown[]) => parseOffice(...a) }))

const generateText = vi.fn()
vi.mock('ai', () => ({ generateText: (...a: unknown[]) => generateText(...a) }))
vi.mock('@openrouter/ai-sdk-provider', () => ({ openrouter: (id: string) => ({ id }) }))

const { extractAttachmentText } = await import('./attachment-extract')

beforeEach(() => {
  parseOffice.mockReset()
  generateText.mockReset()
})

describe('extractAttachmentText', () => {
  it('decodes text files directly without calling officeparser', async () => {
    const bytes = new TextEncoder().encode('  hello notes  ')
    const out = await extractAttachmentText({ kind: 'text', bytes, mimeType: 'text/plain' })
    expect(out).toBe('hello notes')
    expect(parseOffice).not.toHaveBeenCalled()
  })

  it('runs officeparser for documents and trims the result', async () => {
    parseOffice.mockResolvedValue({ toText: () => '  parsed pdf text  ' })
    const out = await extractAttachmentText({ kind: 'pdf', bytes: new Uint8Array([1, 2]), mimeType: 'application/pdf' })
    expect(out).toBe('parsed pdf text')
    expect(parseOffice).toHaveBeenCalledOnce()
    expect(Buffer.isBuffer(parseOffice.mock.calls[0][0])).toBe(true)
  })

  it('sends images to the vision model with an image content part', async () => {
    generateText.mockResolvedValue({ text: 'transcribed image' })
    const bytes = new Uint8Array([9, 9])
    const out = await extractAttachmentText({ kind: 'image', bytes, mimeType: 'image/png' })
    expect(out).toBe('transcribed image')
    const arg = generateText.mock.calls[0][0]
    const content = arg.messages[0].content
    expect(content.some((c: { type: string }) => c.type === 'image')).toBe(true)
  })
})
