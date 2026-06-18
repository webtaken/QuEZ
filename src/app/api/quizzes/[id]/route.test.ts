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

// `@/db` (imported transitively by the route) builds a pg Pool from this.
// pg does not connect until a query runs, and deleteQuiz is mocked, so a
// dummy URL is enough to let the module import without a live database.
process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test'

const { DELETE } = await import('./route')

const VALID_ID = '3549497d-eda3-4e66-8461-7ef45416d8e0'
const req = {} as Parameters<typeof DELETE>[0]
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  getSession.mockReset()
  deleteQuiz.mockReset()
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
    deleteQuiz.mockResolvedValue({ ok: false })
    const res = await DELETE(req, ctx(VALID_ID))
    expect(res.status).toBe(404)
  })

  it('returns 200 and the id on success', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } })
    deleteQuiz.mockResolvedValue({ ok: true })
    const res = await DELETE(req, ctx(VALID_ID))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ id: VALID_ID })
  })

  it('scopes the delete to the session user', async () => {
    getSession.mockResolvedValue({ user: { id: 'owner-123' } })
    deleteQuiz.mockResolvedValue({ ok: true })
    await DELETE(req, ctx(VALID_ID))
    expect(deleteQuiz).toHaveBeenCalledWith(VALID_ID, 'owner-123')
  })
})
