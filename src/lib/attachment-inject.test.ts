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
  it('enforces the total char cap across multiple attachments', () => {
    const TOTAL_CHAR_CAP = 120_000
    const PREAMBLE =
      'The user attached these materials. Use them as the primary source for building or updating the quiz.\n\n'
    const block = buildAttachmentSystemBlock([
      { id: 'a1', filename: 'one.pdf', kind: 'pdf', extractedText: 'x'.repeat(50_000) },
      { id: 'a2', filename: 'two.pdf', kind: 'pdf', extractedText: 'y'.repeat(50_000) },
      { id: 'a3', filename: 'three.pdf', kind: 'pdf', extractedText: 'z'.repeat(50_000) },
    ])
    const sectionsLength = block.length - PREAMBLE.length
    expect(sectionsLength).toBeLessThanOrEqual(TOTAL_CHAR_CAP)
    expect(block).toContain('…[truncated]')
  })
})
