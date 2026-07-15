import { describe, it, expect, vi, beforeEach } from 'vitest'

const getGameById = vi.fn()
const getQuestionsForQuiz = vi.fn()
const getParticipantsWithAnswerStatus = vi.fn()
vi.mock('@/db/game-queries', () => ({
  getGameById: (...a: unknown[]) => getGameById(...a),
  getQuestionsForQuiz: (...a: unknown[]) => getQuestionsForQuiz(...a),
  getParticipantsWithAnswerStatus: (...a: unknown[]) => getParticipantsWithAnswerStatus(...a),
}))

const maybeAdvancePhase = vi.fn()
vi.mock('@/db/game-mutations', () => ({
  maybeAdvancePhase: (...a: unknown[]) => maybeAdvancePhase(...a),
}))

process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test'

const { buildGameSnapshot } = await import('./game-state')

const GAME = {
  id: 'g1',
  quizId: 'q1',
  code: '854123',
  status: 'question',
  currentQuestionIndex: 0,
  phaseStartedAt: new Date('2026-01-01T00:00:00.000Z'),
  hostUserId: 'h1',
}
const QUESTIONS = [{ id: 'q_1', text: 'Q1', options: ['A', 'B'], timeLimit: 30, correctIndex: 1, order: 1 }]
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

beforeEach(() => {
  getGameById.mockReset()
  getQuestionsForQuiz.mockReset().mockResolvedValue(QUESTIONS)
  getParticipantsWithAnswerStatus.mockReset().mockResolvedValue(PARTICIPANTS)
  maybeAdvancePhase.mockReset().mockImplementation(async (g) => g)
})

describe('buildGameSnapshot', () => {
  it('returns null for an unknown game id', async () => {
    getGameById.mockResolvedValue(null)
    expect(await buildGameSnapshot('nope')).toBeNull()
  })

  it('omits question and leaderboard while waiting, and passes null questionId', async () => {
    getGameById.mockResolvedValue({ ...GAME, status: 'waiting' })
    const result = await buildGameSnapshot('g1')
    expect(result!.snapshot.status).toBe('waiting')
    expect(result!.snapshot.question).toBeUndefined()
    expect(result!.snapshot.leaderboard).toBeUndefined()
    expect(getParticipantsWithAnswerStatus).toHaveBeenCalledWith('g1', null)
  })

  it('includes every participant (kicked too, with ISO kickedAt) so clients can derive their own view', async () => {
    getGameById.mockResolvedValue(GAME)
    const result = await buildGameSnapshot('g1')
    expect(result!.snapshot.participants).toEqual([
      { id: 'p1', nickname: 'Ana', score: 100, streak: 1, answered: true, kickedAt: null },
      { id: 'p2', nickname: 'Bad', score: 0, streak: 0, answered: false, kickedAt: '2026-01-01T00:01:00.000Z' },
    ])
  })

  it('includes the question without correctIndex during the question phase', async () => {
    getGameById.mockResolvedValue(GAME)
    const result = await buildGameSnapshot('g1')
    expect(result!.snapshot.question).toEqual({ id: 'q_1', text: 'Q1', options: ['A', 'B'], timeLimit: 30 })
    expect(result!.snapshot.correctIndex).toBeUndefined()
    expect(result!.snapshot.leaderboard).toBeUndefined()
    expect(getParticipantsWithAnswerStatus).toHaveBeenCalledWith('g1', 'q_1')
  })

  it('includes correctIndex and a leaderboard ranked from active participants only during reveal', async () => {
    getGameById.mockResolvedValue(GAME)
    maybeAdvancePhase.mockImplementation(async (g) => ({ ...g, status: 'reveal' }))
    const result = await buildGameSnapshot('g1')
    expect(result!.snapshot.status).toBe('reveal')
    expect(result!.snapshot.correctIndex).toBe(1)
    expect(result!.snapshot.leaderboard).toEqual([
      { id: 'p1', nickname: 'Ana', score: 100, totalAnswerMs: 5000, rank: 1 },
    ])
  })

  it('runs the lazy phase transition and returns the settled game', async () => {
    getGameById.mockResolvedValue(GAME)
    const settled = { ...GAME, status: 'reveal', phaseStartedAt: new Date('2026-01-01T00:00:30.000Z') }
    maybeAdvancePhase.mockResolvedValue(settled)
    const result = await buildGameSnapshot('g1')
    expect(maybeAdvancePhase).toHaveBeenCalledWith(GAME, QUESTIONS[0], QUESTIONS.length)
    expect(result!.game).toEqual(settled)
    expect(result!.snapshot.phaseStartedAt).toBe('2026-01-01T00:00:30.000Z')
    expect(result!.currentQuestion).toEqual(QUESTIONS[0])
    expect(result!.totalQuestions).toBe(1)
  })
})
