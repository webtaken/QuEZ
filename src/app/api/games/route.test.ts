import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}))

const getSession = vi.fn()
vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: () => getSession() } },
}))

const createGameSession = vi.fn()
vi.mock('@/db/game-mutations', () => ({
  createGameSession: (...args: unknown[]) => createGameSession(...args),
}))

process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test'

const { POST } = await import('./route')

const VALID_QUIZ_ID = '3549497d-eda3-4e66-8461-7ef45416d8e0'
function req(body: unknown) {
  return { json: async () => body } as Parameters<typeof POST>[0]
}

beforeEach(() => {
  getSession.mockReset()
  createGameSession.mockReset()
})

describe('POST /api/games', () => {
  it('returns 401 when there is no session', async () => {
    getSession.mockResolvedValue(null)
    const res = await POST(req({ quizId: VALID_QUIZ_ID }))
    expect(res.status).toBe(401)
  })

  it('returns 400 for a malformed quizId', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } })
    const res = await POST(req({ quizId: 'not-a-uuid' }))
    expect(res.status).toBe(400)
    expect(createGameSession).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid JSON', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } })
    const badReq = {
      json: async () => {
        throw new Error('bad json')
      },
    } as Parameters<typeof POST>[0]
    const res = await POST(badReq)
    expect(res.status).toBe(400)
  })

  it('propagates the error + status from createGameSession', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } })
    createGameSession.mockResolvedValue({ ok: false, error: 'Quiz has no questions', status: 400 })
    const res = await POST(req({ quizId: VALID_QUIZ_ID }))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'Quiz has no questions' })
  })

  it('creates a game session and returns its id + code', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } })
    createGameSession.mockResolvedValue({ ok: true, game: { id: 'g1', code: '854123' } })
    const res = await POST(req({ quizId: VALID_QUIZ_ID }))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ gameId: 'g1', code: '854123' })
    expect(createGameSession).toHaveBeenCalledWith(VALID_QUIZ_ID, 'u1')
  })
})
