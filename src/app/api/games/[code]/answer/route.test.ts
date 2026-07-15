import { describe, it, expect, vi, beforeEach } from 'vitest'

const getGameByCode = vi.fn()
const getQuestionsForQuiz = vi.fn()
vi.mock('@/db/game-queries', () => ({
  getGameByCode: (...a: unknown[]) => getGameByCode(...a),
  getQuestionsForQuiz: (...a: unknown[]) => getQuestionsForQuiz(...a),
}))

const submitAnswer = vi.fn()
vi.mock('@/db/game-mutations', () => ({
  submitAnswer: (...a: unknown[]) => submitAnswer(...a),
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
const GAME_ON_Q1 = { id: 'g1', quizId: 'q1', status: 'question', currentQuestionIndex: 0 }
const QUESTIONS = [{ id: 'q_1', correctIndex: 1, timeLimit: 30 }]

beforeEach(() => {
  getGameByCode.mockReset()
  getQuestionsForQuiz.mockReset().mockResolvedValue(QUESTIONS)
  submitAnswer.mockReset()
  syncGameById.mockReset()
})

describe('POST /api/games/[code]/answer', () => {
  it('returns 400 when participantId or questionId is missing', async () => {
    const res = await POST(req({ questionId: 'q_1', sessionToken: 't1', selectedIndex: 0 }), ctx('854123'))
    expect(res.status).toBe(400)
    expect(getGameByCode).not.toHaveBeenCalled()
  })

  it('returns 400 when sessionToken is missing', async () => {
    const res = await POST(req({ participantId: 'p1', questionId: 'q_1', selectedIndex: 0 }), ctx('854123'))
    expect(res.status).toBe(400)
    expect(getGameByCode).not.toHaveBeenCalled()
    expect(submitAnswer).not.toHaveBeenCalled()
  })

  it('returns 404 for an unknown code', async () => {
    getGameByCode.mockResolvedValue(null)
    const res = await POST(
      req({ participantId: 'p1', questionId: 'q_1', sessionToken: 't1', selectedIndex: 0 }),
      ctx('000000')
    )
    expect(res.status).toBe(404)
  })

  it('returns 409 when the game is not in the question phase', async () => {
    getGameByCode.mockResolvedValue({ ...GAME_ON_Q1, status: 'reveal' })
    const res = await POST(
      req({ participantId: 'p1', questionId: 'q_1', sessionToken: 't1', selectedIndex: 0 }),
      ctx('854123')
    )
    expect(res.status).toBe(409)
    expect(submitAnswer).not.toHaveBeenCalled()
  })

  it('returns 409 when questionId does not match the current question', async () => {
    getGameByCode.mockResolvedValue(GAME_ON_Q1)
    const res = await POST(
      req({ participantId: 'p1', questionId: 'stale-question', sessionToken: 't1', selectedIndex: 0 }),
      ctx('854123')
    )
    expect(res.status).toBe(409)
    expect(submitAnswer).not.toHaveBeenCalled()
  })

  it('propagates the error + status from submitAnswer', async () => {
    getGameByCode.mockResolvedValue(GAME_ON_Q1)
    submitAnswer.mockResolvedValue({ ok: false, error: 'Participant not found', status: 404 })
    const res = await POST(
      req({ participantId: 'p1', questionId: 'q_1', sessionToken: 't1', selectedIndex: 0 }),
      ctx('854123')
    )
    expect(res.status).toBe(404)
    expect(syncGameById).not.toHaveBeenCalled()
  })

  it('accepts a null selectedIndex (explicit no-answer) and never echoes correctness', async () => {
    getGameByCode.mockResolvedValue(GAME_ON_Q1)
    submitAnswer.mockResolvedValue({ ok: true })
    const res = await POST(
      req({ participantId: 'p1', questionId: 'q_1', sessionToken: 't1', selectedIndex: null }),
      ctx('854123')
    )
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
    expect(submitAnswer).toHaveBeenCalledWith(GAME_ON_Q1, QUESTIONS[0], 'p1', 't1', null)
    expect(syncGameById).toHaveBeenCalledWith('g1')
  })

  it('scores a chosen answer', async () => {
    getGameByCode.mockResolvedValue(GAME_ON_Q1)
    submitAnswer.mockResolvedValue({ ok: true })
    const res = await POST(
      req({ participantId: 'p1', questionId: 'q_1', sessionToken: 't1', selectedIndex: 1 }),
      ctx('854123')
    )
    expect(res.status).toBe(200)
    expect(submitAnswer).toHaveBeenCalledWith(GAME_ON_Q1, QUESTIONS[0], 'p1', 't1', 1)
    expect(syncGameById).toHaveBeenCalledWith('g1')
  })
})
