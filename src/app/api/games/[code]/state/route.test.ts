import { describe, it, expect, vi, beforeEach } from 'vitest'

const getGameByCode = vi.fn()
const getQuestionsForQuiz = vi.fn()
const getParticipantsWithAnswerStatus = vi.fn()
vi.mock('@/db/game-queries', () => ({
  getGameByCode: (...a: unknown[]) => getGameByCode(...a),
  getQuestionsForQuiz: (...a: unknown[]) => getQuestionsForQuiz(...a),
  getParticipantsWithAnswerStatus: (...a: unknown[]) => getParticipantsWithAnswerStatus(...a),
}))

const maybeAdvancePhase = vi.fn()
vi.mock('@/db/game-mutations', () => ({
  maybeAdvancePhase: (...a: unknown[]) => maybeAdvancePhase(...a),
}))

process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test'

const { GET } = await import('./route')

const GAME = {
  id: 'g1',
  quizId: 'q1',
  code: '854123',
  status: 'question',
  currentQuestionIndex: 0,
  phaseStartedAt: new Date('2026-01-01T00:00:00.000Z'),
  hostUserId: 'h1',
}
const QUESTIONS = [
  { id: 'q_1', text: 'Q1', options: ['A', 'B'], timeLimit: 30, correctIndex: 1, order: 1 },
]
const PARTICIPANTS = [
  { id: 'p1', nickname: 'Ana', score: 100, streak: 1, totalAnswerMs: 5000, kickedAt: null, answered: true },
  {
    id: 'p2',
    nickname: 'Bad',
    score: 0,
    streak: 0,
    totalAnswerMs: 0,
    kickedAt: new Date('2026-01-01T00:01:00.000Z'),
    answered: false,
  },
]

function makeReq(code: string, participantId?: string) {
  const qs = participantId ? `?participantId=${participantId}` : ''
  return { nextUrl: new URL(`http://localhost/api/games/${code}/state${qs}`) } as unknown as Parameters<
    typeof GET
  >[0]
}
const ctx = (code: string) => ({ params: Promise.resolve({ code }) })

beforeEach(() => {
  getGameByCode.mockReset()
  getQuestionsForQuiz.mockReset().mockResolvedValue(QUESTIONS)
  getParticipantsWithAnswerStatus.mockReset().mockResolvedValue(PARTICIPANTS)
  maybeAdvancePhase.mockReset().mockImplementation(async (g) => g)
})

describe('GET /api/games/[code]/state', () => {
  it('returns 404 for an unknown code', async () => {
    getGameByCode.mockResolvedValue(null)
    const res = await GET(makeReq('000000'), ctx('000000'))
    expect(res.status).toBe(404)
  })

  it('omits question and leaderboard while waiting, and passes null questionId', async () => {
    getGameByCode.mockResolvedValue({ ...GAME, status: 'waiting' })
    const res = await GET(makeReq('854123'), ctx('854123'))
    const data = await res.json()
    expect(data.status).toBe('waiting')
    expect(data.question).toBeUndefined()
    expect(data.leaderboard).toBeUndefined()
    expect(getParticipantsWithAnswerStatus).toHaveBeenCalledWith('g1', null)
  })

  it('includes the question without correctIndex, and excludes kicked participants, during the question phase', async () => {
    getGameByCode.mockResolvedValue(GAME)
    const res = await GET(makeReq('854123'), ctx('854123'))
    const data = await res.json()
    expect(data.question).toEqual({ id: 'q_1', text: 'Q1', options: ['A', 'B'], timeLimit: 30 })
    expect(data.correctIndex).toBeUndefined()
    expect(data.leaderboard).toBeUndefined()
    expect(data.participants).toEqual([{ id: 'p1', nickname: 'Ana', score: 100, answered: true }])
    expect(getParticipantsWithAnswerStatus).toHaveBeenCalledWith('g1', 'q_1')
  })

  it('includes correctIndex and a ranked leaderboard during reveal', async () => {
    getGameByCode.mockResolvedValue(GAME)
    maybeAdvancePhase.mockImplementation(async (g) => ({ ...g, status: 'reveal' }))
    const res = await GET(makeReq('854123'), ctx('854123'))
    const data = await res.json()
    expect(data.status).toBe('reveal')
    expect(data.correctIndex).toBe(1)
    expect(data.leaderboard).toEqual([{ id: 'p1', nickname: 'Ana', score: 100, totalAnswerMs: 5000, rank: 1 }])
  })

  it('resolves "you" — including a kicked participant — independent of the active participants list', async () => {
    getGameByCode.mockResolvedValue(GAME)
    const res = await GET(makeReq('854123', 'p2'), ctx('854123'))
    const data = await res.json()
    expect(data.you).toEqual({
      id: 'p2',
      nickname: 'Bad',
      score: 0,
      streak: 0,
      kickedAt: '2026-01-01T00:01:00.000Z',
    })
    expect(data.participants.find((p: { id: string }) => p.id === 'p2')).toBeUndefined()
  })

  it('returns you: null when no participantId is given', async () => {
    getGameByCode.mockResolvedValue(GAME)
    const res = await GET(makeReq('854123'), ctx('854123'))
    const data = await res.json()
    expect(data.you).toBeNull()
  })

  it('runs the lazy phase transition on every poll, passing the question count', async () => {
    getGameByCode.mockResolvedValue(GAME)
    await GET(makeReq('854123'), ctx('854123'))
    expect(maybeAdvancePhase).toHaveBeenCalledWith(GAME, QUESTIONS[0], QUESTIONS.length)
  })
})
