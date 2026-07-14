import { describe, it, expect, vi, beforeEach } from 'vitest'

const getGameByCode = vi.fn()
vi.mock('@/db/game-queries', () => ({
  getGameByCode: (...a: unknown[]) => getGameByCode(...a),
}))

const joinGame = vi.fn()
vi.mock('@/db/game-mutations', () => ({
  joinGame: (...a: unknown[]) => joinGame(...a),
}))

process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test'

const { POST } = await import('./route')

function req(body: unknown) {
  return { json: async () => body } as Parameters<typeof POST>[0]
}
const ctx = (code: string) => ({ params: Promise.resolve({ code }) })
const FAKE_GAME = { id: 'g1', status: 'waiting' }

beforeEach(() => {
  getGameByCode.mockReset()
  joinGame.mockReset()
})

describe('POST /api/games/[code]/join', () => {
  it('returns 400 for an empty nickname', async () => {
    const res = await POST(req({ nickname: '  ', sessionToken: 't1' }), ctx('854123'))
    expect(res.status).toBe(400)
    expect(getGameByCode).not.toHaveBeenCalled()
  })

  it('returns 400 for a nickname over 20 characters', async () => {
    const res = await POST(req({ nickname: 'x'.repeat(21), sessionToken: 't1' }), ctx('854123'))
    expect(res.status).toBe(400)
  })

  it('returns 400 for a missing sessionToken', async () => {
    const res = await POST(req({ nickname: 'Juan' }), ctx('854123'))
    expect(res.status).toBe(400)
  })

  it('returns 404 for an unknown code', async () => {
    getGameByCode.mockResolvedValue(null)
    const res = await POST(req({ nickname: 'Juan', sessionToken: 't1' }), ctx('000000'))
    expect(res.status).toBe(404)
  })

  it('propagates the error + status from joinGame', async () => {
    getGameByCode.mockResolvedValue(FAKE_GAME)
    joinGame.mockResolvedValue({ ok: false, error: 'That nickname is already taken in this game', status: 409 })
    const res = await POST(req({ nickname: 'Juan', sessionToken: 't1' }), ctx('854123'))
    expect(res.status).toBe(409)
  })

  it('joins and returns the participant id + nickname', async () => {
    getGameByCode.mockResolvedValue(FAKE_GAME)
    joinGame.mockResolvedValue({ ok: true, participant: { id: 'p1', nickname: 'Juan' } })
    const res = await POST(req({ nickname: '  Juan  ', sessionToken: 't1' }), ctx('854123'))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ participantId: 'p1', nickname: 'Juan' })
    expect(joinGame).toHaveBeenCalledWith(FAKE_GAME, 'Juan', 't1')
  })
})
