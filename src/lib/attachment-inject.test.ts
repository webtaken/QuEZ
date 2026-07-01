import { describe, it, expect } from 'vitest'
import { collectAttachmentIds, buildAttachmentSystemBlock } from './attachment-inject'

describe('collectAttachmentIds', () => {
  it('collects unique data-attachment ids in order', () => {
    const messages = [
      { parts: [{ type: 'text', text: 'hi' }, { type: 'data-attachment', id: 'a1', filename: 'x.pdf', kind: 'pdf' }] },
      { parts: [{ type: 'data-attachment', id: 'a2', filename: 'y.png', kind: 'image' }] },
      { parts: [{ type: 'data-attachment', id: 'a1', filename: 'x.pdf', kind: 'pdf' }] }, // dup
    ]
    expect(collectAttachmentIds(messages)).toEqual(['a1', 'a2'])
  })
  it('returns empty when there are no attachment parts', () => {
    expect(collectAttachmentIds([{ parts: [{ type: 'text', text: 'hi' }] }])).toEqual([])
  })
})

describe('buildAttachmentSystemBlock', () => {
  it('returns empty string with no attachments', () => {
    expect(buildAttachmentSystemBlock([])).toBe('')
  })
  it('lists each file with a labeled section', () => {
    const block = buildAttachmentSystemBlock([
      { id: 'a1', filename: 'notes.pdf', kind: 'pdf', extractedText: 'Cell division basics' },
    ])
    expect(block).toContain('--- notes.pdf (pdf) ---')
    expect(block).toContain('Cell division basics')
  })
  it('truncates very long per-file text', () => {
    const block = buildAttachmentSystemBlock([
      { id: 'a1', filename: 'big.pdf', kind: 'pdf', extractedText: 'x'.repeat(60_000) },
    ])
    expect(block).toContain('…[truncated]')
    expect(block.length).toBeLessThan(50_000)
  })
})
