import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
const getSession = vi.fn()
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: () => getSession() } } }))
const insertAttachment = vi.fn()
vi.mock('@/db/attachment-queries', () => ({ insertAttachment: (...a: unknown[]) => insertAttachment(...a) }))
const presignPut = vi.fn()
vi.mock('@/lib/r2', () => ({
  presignPut: (...a: unknown[]) => presignPut(...a),
  r2Key: () => 'attachments/u1/id/x.pdf',
}))
process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test'

const { POST } = await import('./route')
const ID = '3549497d-eda3-4e66-8461-7ef45416d8e0'
const make = (body: unknown) => ({ json: async () => body }) as unknown as Parameters<typeof POST>[0]

beforeEach(() => {
  getSession.mockReset(); insertAttachment.mockReset(); presignPut.mockReset()
})

describe('POST /api/attachments', () => {
  it('401 without a session', async () => {
    getSession.mockResolvedValue(null)
    const res = await POST(make({}))
    expect(res.status).toBe(401)
  })
  it('400 for a non-uuid id', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } })
    const res = await POST(make({ id: 'x', filename: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 5 }))
    expect(res.status).toBe(400)
  })
  it('400 for an unsupported type', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } })
    const res = await POST(make({ id: ID, filename: 'a.mp4', mimeType: 'video/mp4', sizeBytes: 5 }))
    expect(res.status).toBe(400)
    expect(insertAttachment).not.toHaveBeenCalled()
  })
  it('inserts a pending row and returns a presigned url', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } })
    presignPut.mockResolvedValue('https://r2/put')
    const res = await POST(make({ id: ID, filename: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 5 }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: ID, uploadUrl: 'https://r2/put' })
    expect(insertAttachment).toHaveBeenCalledOnce()
    const row = insertAttachment.mock.calls[0][0]
    expect(row).toMatchObject({ id: ID, userId: 'u1', kind: 'pdf', status: 'pending' })
  })
})
