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
vi.mock('@/lib/attachment-extract', () => ({ extractAttachmentText: (...a: unknown[]) => extractAttachmentText(...a) }))
process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test'

const { POST } = await import('./route')
const ID = '3549497d-eda3-4e66-8461-7ef45416d8e0'
const req = {} as Parameters<typeof POST>[0]
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const row = { id: ID, userId: 'u1', r2Key: 'k', kind: 'pdf', mimeType: 'application/pdf', filename: 'a.pdf' }

beforeEach(() => {
  getSession.mockReset(); getOwnedAttachment.mockReset(); markAttachmentReady.mockReset()
  markAttachmentError.mockReset(); getObjectBytes.mockReset(); extractAttachmentText.mockReset()
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
    extractAttachmentText.mockResolvedValue('some extracted text')
    const res = await POST(req, ctx(ID))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ready', filename: 'a.pdf', kind: 'pdf' })
    expect(markAttachmentReady).toHaveBeenCalledOnce()
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
    extractAttachmentText.mockResolvedValue('   ')
    const res = await POST(req, ctx(ID))
    expect((await res.json()).status).toBe('error')
    expect(markAttachmentError).toHaveBeenCalledOnce()
  })
})
