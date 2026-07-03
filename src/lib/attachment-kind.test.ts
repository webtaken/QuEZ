import { describe, it, expect } from 'vitest'
import { kindFor, validateUpload, MAX_ATTACHMENT_BYTES } from './attachment-kind'

describe('kindFor', () => {
  it('maps known mime types', () => {
    expect(kindFor('a.pdf', 'application/pdf')).toBe('pdf')
    expect(kindFor('a.png', 'image/png')).toBe('image')
  })
  it('falls back to extension when mime is generic', () => {
    expect(kindFor('notes.md', 'application/octet-stream')).toBe('text')
    expect(kindFor('deck.pptx', '')).toBe('pptx')
  })
  it('returns null for unsupported types', () => {
    expect(kindFor('video.mp4', 'video/mp4')).toBeNull()
  })
})

describe('validateUpload', () => {
  it('accepts a valid file and returns its kind', () => {
    expect(validateUpload({ filename: 'a.docx', mimeType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', sizeBytes: 1000 }))
      .toEqual({ ok: true, kind: 'docx' })
  })
  it('rejects oversize files', () => {
    const r = validateUpload({ filename: 'a.pdf', mimeType: 'application/pdf', sizeBytes: MAX_ATTACHMENT_BYTES + 1 })
    expect(r.ok).toBe(false)
  })
  it('rejects unsupported types', () => {
    const r = validateUpload({ filename: 'a.mp4', mimeType: 'video/mp4', sizeBytes: 10 })
    expect(r).toEqual({ ok: false, error: 'unsupported file type' })
  })
  it('rejects non-positive sizes', () => {
    expect(validateUpload({ filename: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 0 }).ok).toBe(false)
  })
})
