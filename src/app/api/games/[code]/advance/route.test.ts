import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}))

const getSession = vi.fn()
vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: () => getSession() } },
}))

const getGameByCode = vi.fn()
const getQuestionsForQuiz = vi.fn()
vi.mock('@/db/game-queries', () => ({
  getGameByCode: (...a: unknown[]) => getGameByCode(...a),
  getQuestionsForQuiz: (...a: unknown[]) => getQuestionsForQuiz(...a),
}))

const advanceGame = vi.fn()
vi.mock('@/db/game-mutations', () => ({
  advanceGame: (...a: unknown[]) => advanceGame(...a),
}))

process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test'

const { POST } = await import('./route')

const req = {} as Parameters<typeof POST>[0]
const ctx = (code: string) => ({ params: Promise.resolve({ code }) })
const GAME = { id: 'g1', quizId: 'q1', hostUserId: 'host1' }

beforeEach(() => {
  getSession.mockReset()
  getGameByCode.mockReset()
  getQuestionsForQuiz.mockReset().mockResolvedValue([{ id: 'q_1' }, { id: 'q_2' }])
  advanceGame.mockReset()
})

describe('POST /api/games/[code]/advance', () => {
  it('returns 401 when there is no session', async () => {
    getSession.mockResolvedValue(null)
    const res = await POST(req, ctx('854123'))
    expect(res.status).toBe(401)
  })

  it('returns 404 for an unknown code', async () => {
    getSession.mockResolvedValue({ user: { id: 'host1' } })
    getGameByCode.mockResolvedValue(null)
    const res = await POST(req, ctx('000000'))
    expect(res.status).toBe(404)
  })

  it('returns 403 when the caller is not the host', async () => {
    getSession.mockResolvedValue({ user: { id: 'someone-else' } })
    getGameByCode.mockResolvedValue(GAME)
    const res = await POST(req, ctx('854123'))
    expect(res.status).toBe(403)
    expect(advanceGame).not.toHaveBeenCalled()
  })

  it('propagates the error + status from advanceGame', async () => {
    getSession.mockResolvedValue({ user: { id: 'host1' } })
    getGameByCode.mockResolvedValue(GAME)
    advanceGame.mockResolvedValue({ ok: false, error: 'Game is not in the reveal phase', status: 409 })
    const res = await POST(req, ctx('854123'))
    expect(res.status).toBe(409)
  })

  it('advances and returns the new status, passing the total question count', async () => {
    getSession.mockResolvedValue({ user: { id: 'host1' } })
    getGameByCode.mockResolvedValue(GAME)
    advanceGame.mockResolvedValue({ ok: true, game: { status: 'question' } })
    const res = await POST(req, ctx('854123'))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ status: 'question' })
    expect(advanceGame).toHaveBeenCalledWith(GAME, 2)
  })
})
