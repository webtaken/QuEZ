import { describe, it, expect } from 'vitest'
import { r2Key } from './r2'

describe('r2Key', () => {
  it('namespaces by user and attachment id', () => {
    expect(r2Key('user-1', 'att-1', 'notes.pdf')).toBe('attachments/user-1/att-1/notes.pdf')
  })
  it('sanitizes unsafe characters in the filename', () => {
    expect(r2Key('u', 'a', 'my report (v2).pdf')).toBe('attachments/u/a/my_report_v2_.pdf')
  })
  it('keeps the tail of very long filenames', () => {
    const key = r2Key('u', 'a', 'x'.repeat(300) + '.pdf')
    expect(key.startsWith('attachments/u/a/')).toBe(true)
    expect(key.length).toBeLessThan('attachments/u/a/'.length + 130)
  })
})
