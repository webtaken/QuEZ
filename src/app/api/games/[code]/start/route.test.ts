import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}))

const getSession = vi.fn()
vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: () => getSession() } },
}))

const getGameByCode = vi.fn()
vi.mock('@/db/game-queries', () => ({
  getGameByCode: (...a: unknown[]) => getGameByCode(...a),
}))

const startGame = vi.fn()
vi.mock('@/db/game-mutations', () => ({
  startGame: (...a: unknown[]) => startGame(...a),
}))

process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test'

const { POST } = await import('./route')

const req = {} as Parameters<typeof POST>[0]
const ctx = (code: string) => ({ params: Promise.resolve({ code }) })
const GAME = { id: 'g1', hostUserId: 'host1' }

beforeEach(() => {
  getSession.mockReset()
  getGameByCode.mockReset()
  startGame.mockReset()
})

describe('POST /api/games/[code]/start', () => {
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
    expect(startGame).not.toHaveBeenCalled()
  })

  it('propagates the error + status from startGame', async () => {
    getSession.mockResolvedValue({ user: { id: 'host1' } })
    getGameByCode.mockResolvedValue(GAME)
    startGame.mockResolvedValue({ ok: false, error: 'No players have joined yet', status: 400 })
    const res = await POST(req, ctx('854123'))
    expect(res.status).toBe(400)
  })

  it('starts the game', async () => {
    getSession.mockResolvedValue({ user: { id: 'host1' } })
    getGameByCode.mockResolvedValue(GAME)
    startGame.mockResolvedValue({ ok: true })
    const res = await POST(req, ctx('854123'))
    expect(res.status).toBe(200)
    expect(startGame).toHaveBeenCalledWith('g1')
  })
})
