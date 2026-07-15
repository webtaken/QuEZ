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

const kickParticipant = vi.fn()
vi.mock('@/db/game-mutations', () => ({
  kickParticipant: (...a: unknown[]) => kickParticipant(...a),
}))

const syncGameById = vi.fn()
vi.mock('@/lib/realtime/sync', () => ({
  syncGameById: (...a: unknown[]) => syncGameById(...a),
}))

process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test'

const { POST } = await import('./route')

function req(body: unknown) {
  return { json: async () => body } as Parameters<typeof POST>[0]
}
const ctx = (code: string) => ({ params: Promise.resolve({ code }) })
const GAME = { id: 'g1', hostUserId: 'host1' }

beforeEach(() => {
  getSession.mockReset()
  getGameByCode.mockReset()
  kickParticipant.mockReset()
  syncGameById.mockReset()
})

describe('POST /api/games/[code]/kick', () => {
  it('returns 401 when there is no session', async () => {
    getSession.mockResolvedValue(null)
    const res = await POST(req({ participantId: 'p1' }), ctx('854123'))
    expect(res.status).toBe(401)
  })

  it('returns 400 when participantId is missing', async () => {
    getSession.mockResolvedValue({ user: { id: 'host1' } })
    const res = await POST(req({}), ctx('854123'))
    expect(res.status).toBe(400)
    expect(getGameByCode).not.toHaveBeenCalled()
  })

  it('returns 404 for an unknown code', async () => {
    getSession.mockResolvedValue({ user: { id: 'host1' } })
    getGameByCode.mockResolvedValue(null)
    const res = await POST(req({ participantId: 'p1' }), ctx('000000'))
    expect(res.status).toBe(404)
  })

  it('returns 403 when the caller is not the host', async () => {
    getSession.mockResolvedValue({ user: { id: 'someone-else' } })
    getGameByCode.mockResolvedValue(GAME)
    const res = await POST(req({ participantId: 'p1' }), ctx('854123'))
    expect(res.status).toBe(403)
    expect(kickParticipant).not.toHaveBeenCalled()
  })

  it('returns 404 when the participant does not belong to this game', async () => {
    getSession.mockResolvedValue({ user: { id: 'host1' } })
    getGameByCode.mockResolvedValue(GAME)
    kickParticipant.mockResolvedValue(false)
    const res = await POST(req({ participantId: 'not-in-this-game' }), ctx('854123'))
    expect(res.status).toBe(404)
    expect(syncGameById).not.toHaveBeenCalled()
  })

  it('kicks the participant', async () => {
    getSession.mockResolvedValue({ user: { id: 'host1' } })
    getGameByCode.mockResolvedValue(GAME)
    kickParticipant.mockResolvedValue(true)
    const res = await POST(req({ participantId: 'p1' }), ctx('854123'))
    expect(res.status).toBe(200)
    expect(kickParticipant).toHaveBeenCalledWith('g1', 'p1')
    expect(syncGameById).toHaveBeenCalledWith('g1')
  })
})
