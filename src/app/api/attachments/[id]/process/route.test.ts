import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
const getSession = vi.fn()
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: () => getSession() } } }))
const getOwnedAttachment = vi.fn()
const markAttachmentReady = vi.fn()
const markAttachmentError = vi.fn()
vi.mock('@/db/attachment-queries', () => ({
  getOwnedAttachment: (...a: unknown[]) => getOwnedAttachment(...a),
  markAttachmentReady: (...a: unknown[]) => markAttachmentReady(...a),
  markAttachmentError: (...a: unknown[]) => markAttachmentError(...a),
}))
const getObjectBytes = vi.fn()
vi.mock('@/lib/r2', () => ({ getObjectBytes: (...a: unknown[]) => getObjectBytes(...a) }))
const extractAttachmentText = vi.fn()
vi.mock('@/lib/attachment-extract', () => ({
  extractAttachmentText: (...a: unknown[]) => extractAttachmentText(...a),
  IMAGE_MODEL: 'google/gemini-2.5-flash-lite',
}))
const getBalance = vi.fn()
const debitCredits = vi.fn()
vi.mock('@/db/credit-queries', () => ({
  getBalance: (...a: unknown[]) => getBalance(...a),
  debitCredits: (...a: unknown[]) => debitCredits(...a),
}))
process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test'

const { POST } = await import('./route')
const ID = '3549497d-eda3-4e66-8461-7ef45416d8e0'
const req = {} as Parameters<typeof POST>[0]
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const row = { id: ID, userId: 'u1', r2Key: 'k', kind: 'pdf', mimeType: 'application/pdf', filename: 'a.pdf' }

beforeEach(() => {
  getSession.mockReset(); getOwnedAttachment.mockReset(); markAttachmentReady.mockReset()
  markAttachmentError.mockReset(); getObjectBytes.mockReset(); extractAttachmentText.mockReset()
  getBalance.mockReset(); debitCredits.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('POST /api/attachments/[id]/process', () => {
  it('401 without a session', async () => {
    getSession.mockResolvedValue(null)
    expect((await POST(req, ctx(ID))).status).toBe(401)
  })
  it('404 when the attachment is missing/not owned', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } })
    getOwnedAttachment.mockResolvedValue(null)
    expect((await POST(req, ctx(ID))).status).toBe(404)
  })
  it('marks ready and returns status on success', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } })
    getOwnedAttachment.mockResolvedValue(row)
    getObjectBytes.mockResolvedValue(new Uint8Array([1]))
    extractAttachmentText.mockResolvedValue({ text: 'some extracted text', debit: null })
    const res = await POST(req, ctx(ID))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ready', filename: 'a.pdf', kind: 'pdf' })
    expect(markAttachmentReady).toHaveBeenCalledOnce()
    expect(getBalance).not.toHaveBeenCalled()
    expect(debitCredits).not.toHaveBeenCalled()
  })
  it('marks error when extraction throws', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } })
    getOwnedAttachment.mockResolvedValue(row)
    getObjectBytes.mockResolvedValue(new Uint8Array([1]))
    extractAttachmentText.mockRejectedValue(new Error('boom'))
    const res = await POST(req, ctx(ID))
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('error')
    expect(markAttachmentError).toHaveBeenCalledOnce()
  })
  it('marks error when extraction yields empty text', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } })
    getOwnedAttachment.mockResolvedValue(row)
    getObjectBytes.mockResolvedValue(new Uint8Array([1]))
    extractAttachmentText.mockResolvedValue({ text: '   ', debit: null })
    const res = await POST(req, ctx(ID))
    expect((await res.json()).status).toBe('error')
    expect(markAttachmentError).toHaveBeenCalledOnce()
  })
  it('short-circuits with ready when the attachment was already processed (no re-run, no re-debit)', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } })
    getOwnedAttachment.mockResolvedValue({ ...row, kind: 'image', mimeType: 'image/png', filename: 'a.png', status: 'ready' })
    const res = await POST(req, ctx(ID))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ready', filename: 'a.png', kind: 'image' })
    expect(getObjectBytes).not.toHaveBeenCalled()
    expect(extractAttachmentText).not.toHaveBeenCalled()
    expect(debitCredits).not.toHaveBeenCalled()
    expect(getBalance).not.toHaveBeenCalled()
  })

  describe('image kind (AI-powered extraction)', () => {
    const imageRow = { ...row, kind: 'image', mimeType: 'image/png', filename: 'a.png' }

    it('returns 402 and skips extraction when balance is depleted', async () => {
      getSession.mockResolvedValue({ user: { id: 'u1' } })
      getOwnedAttachment.mockResolvedValue(imageRow)
      getBalance.mockResolvedValue(0)
      const res = await POST(req, ctx(ID))
      expect(res.status).toBe(402)
      expect(await res.json()).toEqual({
        status: 'error',
        filename: 'a.png',
        kind: 'image',
        errorMessage: 'Out of credits',
      })
      expect(markAttachmentError).toHaveBeenCalledWith(ID, 'Out of credits')
      expect(extractAttachmentText).not.toHaveBeenCalled()
      expect(getObjectBytes).not.toHaveBeenCalled()
    })

    it('debits credits before the empty-text check when the model ran', async () => {
      getSession.mockResolvedValue({ user: { id: 'u1' } })
      getOwnedAttachment.mockResolvedValue(imageRow)
      getBalance.mockResolvedValue(10)
      getObjectBytes.mockResolvedValue(new Uint8Array([1]))
      extractAttachmentText.mockResolvedValue({
        text: 'transcribed text',
        debit: { credits: 0.2, rawCostUsd: 0.0004, usedFallback: false },
      })
      const res = await POST(req, ctx(ID))
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ status: 'ready', filename: 'a.png', kind: 'image' })
      expect(debitCredits).toHaveBeenCalledWith({
        userId: 'u1',
        credits: 0.2,
        type: 'ocr',
        metadata: {
          attachmentId: ID,
          model: 'google/gemini-2.5-flash-lite',
          rawCostUsd: 0.0004,
          usedFallback: false,
        },
      })
      expect(markAttachmentReady).toHaveBeenCalledOnce()
    })

    it('still debits when the model ran but returned only whitespace text', async () => {
      getSession.mockResolvedValue({ user: { id: 'u1' } })
      getOwnedAttachment.mockResolvedValue(imageRow)
      getBalance.mockResolvedValue(10)
      getObjectBytes.mockResolvedValue(new Uint8Array([1]))
      extractAttachmentText.mockResolvedValue({
        text: '   ',
        debit: { credits: 0.05, rawCostUsd: 0.0001, usedFallback: true },
      })
      const res = await POST(req, ctx(ID))
      expect(debitCredits).toHaveBeenCalledOnce()
      expect(debitCredits).toHaveBeenCalledWith({
        userId: 'u1',
        credits: 0.05,
        type: 'ocr',
        metadata: {
          attachmentId: ID,
          model: 'google/gemini-2.5-flash-lite',
          rawCostUsd: 0.0001,
          usedFallback: true,
        },
      })
      expect((await res.json()).errorMessage).toBe('No text could be extracted from this file')
      expect(markAttachmentReady).not.toHaveBeenCalled()
      expect(markAttachmentError).toHaveBeenCalledWith(ID, 'No text could be extracted')
    })
  })
})
