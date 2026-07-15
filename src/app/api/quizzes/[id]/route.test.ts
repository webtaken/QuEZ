import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock calls are hoisted above all imports by vitest.
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}))

const getSession = vi.fn()
vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: () => getSession() } },
}))

const deleteQuiz = vi.fn()
vi.mock('@/db/quiz-mutations', () => ({
  deleteQuiz: (...args: unknown[]) => deleteQuiz(...args),
}))

const deleteObjects = vi.fn()
vi.mock('@/lib/r2', () => ({ deleteObjects: (...a: unknown[]) => deleteObjects(...a) }))

const syncGameById = vi.fn()
vi.mock('@/lib/realtime/sync', () => ({
  syncGameById: (...a: unknown[]) => syncGameById(...a),
}))

// `@/db` (imported transitively by the route) builds a pg Pool from this.
// pg does not connect until a query runs, and deleteQuiz is mocked, so a
// dummy URL is enough to let the module import without a live database.
process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test'

// The route's own `db.select(...).from(gameSessions)...` call (collecting
// live game ids before the delete) is NOT covered by the deleteQuiz mock —
// stub the query builder chain directly so it resolves to a fixed list.
let liveGameRows: { id: string }[] = []
vi.mock('@/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => liveGameRows,
      }),
    }),
  },
}))

const { DELETE } = await import('./route')

const VALID_ID = '3549497d-eda3-4e66-8461-7ef45416d8e0'
const req = {} as Parameters<typeof DELETE>[0]
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  getSession.mockReset()
  deleteQuiz.mockReset()
  deleteObjects.mockReset()
  syncGameById.mockReset()
  liveGameRows = []
})

describe('DELETE /api/quizzes/[id]', () => {
  it('returns 401 when there is no session', async () => {
    getSession.mockResolvedValue(null)
    const res = await DELETE(req, ctx(VALID_ID))
    expect(res.status).toBe(401)
    expect(deleteQuiz).not.toHaveBeenCalled()
  })

  it('returns 400 for a malformed id', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } })
    const res = await DELETE(req, ctx('not-a-uuid'))
    expect(res.status).toBe(400)
    expect(deleteQuiz).not.toHaveBeenCalled()
  })

  it('returns 404 when the quiz is missing or not owned', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } })
    deleteQuiz.mockResolvedValue({ ok: false, r2Keys: [] })
    const res = await DELETE(req, ctx(VALID_ID))
    expect(res.status).toBe(404)
  })

  it('returns 200 and the id on success', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } })
    deleteQuiz.mockResolvedValue({ ok: true, r2Keys: [] })
    const res = await DELETE(req, ctx(VALID_ID))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ id: VALID_ID })
  })

  it('scopes the delete to the session user', async () => {
    getSession.mockResolvedValue({ user: { id: 'owner-123' } })
    deleteQuiz.mockResolvedValue({ ok: true, r2Keys: [] })
    await DELETE(req, ctx(VALID_ID))
    expect(deleteQuiz).toHaveBeenCalledWith(VALID_ID, 'owner-123')
  })

  it('calls deleteObjects with R2 keys on successful delete', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } })
    deleteQuiz.mockResolvedValue({ ok: true, r2Keys: ['attachments/u1/a/x.pdf'] })
    const res = await DELETE(req, ctx(VALID_ID))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: VALID_ID })
    expect(deleteObjects).toHaveBeenCalledWith(['attachments/u1/a/x.pdf'])
  })

  it('returns 200 even if R2 cleanup throws', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } })
    deleteQuiz.mockResolvedValue({ ok: true, r2Keys: ['k'] })
    deleteObjects.mockRejectedValue(new Error('r2 down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await DELETE(req, ctx(VALID_ID))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: VALID_ID })
  })

  it('broadcasts game:error to a live game when the delete succeeds', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } })
    liveGameRows = [{ id: 'game-1' }]
    deleteQuiz.mockResolvedValue({ ok: true, r2Keys: [] })
    const res = await DELETE(req, ctx(VALID_ID))
    expect(res.status).toBe(200)
    expect(syncGameById).toHaveBeenCalledWith('game-1')
  })

  it('does not broadcast when the delete is rejected (non-owner/404 path)', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } })
    liveGameRows = [{ id: 'game-1' }]
    deleteQuiz.mockResolvedValue({ ok: false, r2Keys: [] })
    const res = await DELETE(req, ctx(VALID_ID))
    expect(res.status).toBe(404)
    expect(syncGameById).not.toHaveBeenCalled()
  })
})
