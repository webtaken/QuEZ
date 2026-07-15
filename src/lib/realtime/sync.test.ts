import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const buildGameSnapshot = vi.fn()
vi.mock('./game-state', () => ({
  buildGameSnapshot: (...a: unknown[]) => buildGameSnapshot(...a),
}))

const emit = vi.fn()
const to = vi.fn(() => ({ emit }))
const timersMap = new Map()
vi.mock('./io', () => ({
  getIo: () => ({ to }),
  getPhaseTimers: () => timersMap,
}))

const { syncGameById, phaseTimerSpec } = await import('./sync')

const BASE_GAME = {
  id: 'g1',
  status: 'question',
  currentQuestionIndex: 0,
  phaseStartedAt: new Date('2026-01-01T00:00:00.000Z'),
}
const QUESTION = { id: 'q_1', timeLimit: 30 }

function snapshotResult(overrides: Record<string, unknown> = {}) {
  return {
    snapshot: { status: 'question', participants: [] },
    game: BASE_GAME,
    currentQuestion: QUESTION,
    totalQuestions: 3,
    ...overrides,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:10.000Z')) // 10s into the question
  buildGameSnapshot.mockReset()
  to.mockClear()
  emit.mockClear()
})

afterEach(() => {
  for (const { timer } of timersMap.values()) clearTimeout(timer)
  timersMap.clear()
  vi.useRealTimers()
})

describe('phaseTimerSpec', () => {
  it('arms the question deadline from phaseStartedAt + timeLimit (plus epsilon)', () => {
    const spec = phaseTimerSpec(BASE_GAME, QUESTION, 3)
    expect(spec!.phaseKey).toBe('question:0')
    // 30s limit, 10s elapsed → 20s remaining + 250ms epsilon
    expect(spec!.delayMs).toBe(20_000 + 250)
  })

  it('clamps an overdue question deadline to the epsilon', () => {
    const spec = phaseTimerSpec({ ...BASE_GAME, phaseStartedAt: new Date('2026-01-01T00:00:00.000Z') }, { id: 'q_1', timeLimit: 5 }, 3)
    expect(spec!.delayMs).toBe(250)
  })

  it('arms the podium auto-advance only on the final reveal', () => {
    const finalReveal = { ...BASE_GAME, status: 'reveal', currentQuestionIndex: 2, phaseStartedAt: new Date('2026-01-01T00:00:09.000Z') }
    const spec = phaseTimerSpec(finalReveal, QUESTION, 3)
    expect(spec!.phaseKey).toBe('reveal:2')
    // 5s lingering, 1s elapsed → 4s remaining + epsilon
    expect(spec!.delayMs).toBe(4_000 + 250)
  })

  it('returns null for waiting, podium, and non-final reveal', () => {
    expect(phaseTimerSpec({ ...BASE_GAME, status: 'waiting' }, QUESTION, 3)).toBeNull()
    expect(phaseTimerSpec({ ...BASE_GAME, status: 'podium' }, QUESTION, 3)).toBeNull()
    expect(phaseTimerSpec({ ...BASE_GAME, status: 'reveal', currentQuestionIndex: 0 }, QUESTION, 3)).toBeNull()
  })
})

describe('syncGameById', () => {
  it('broadcasts the snapshot to the game-id room', async () => {
    buildGameSnapshot.mockResolvedValue(snapshotResult())
    await syncGameById('g1')
    expect(to).toHaveBeenCalledWith('g1')
    expect(emit).toHaveBeenCalledWith('game:state', snapshotResult().snapshot)
  })

  it('emits game:error and clears the timer when the game is gone', async () => {
    buildGameSnapshot.mockResolvedValue(snapshotResult())
    await syncGameById('g1')
    expect(timersMap.has('g1')).toBe(true)

    buildGameSnapshot.mockResolvedValue(null)
    await syncGameById('g1')
    expect(emit).toHaveBeenCalledWith('game:error', { reason: 'ended' })
    expect(timersMap.has('g1')).toBe(false)
  })

  it('re-syncs when the phase deadline fires (the timer never flips state itself)', async () => {
    buildGameSnapshot.mockResolvedValue(snapshotResult())
    await syncGameById('g1')
    expect(buildGameSnapshot).toHaveBeenCalledTimes(1)

    // Deadline passes → timer fires → syncGameById runs again, and
    // maybeAdvancePhase (inside buildGameSnapshot) performs the actual flip.
    await vi.advanceTimersByTimeAsync(20_000 + 250)
    expect(buildGameSnapshot).toHaveBeenCalledTimes(2)
  })

  it('does not arm a timer for phases without a deadline', async () => {
    buildGameSnapshot.mockResolvedValue(snapshotResult({ game: { ...BASE_GAME, status: 'waiting' } }))
    await syncGameById('g1')
    expect(timersMap.has('g1')).toBe(false)
  })

  it('catches buildGameSnapshot rejections and resolves (never throws)', async () => {
    const error = new Error('db down')
    buildGameSnapshot.mockRejectedValue(error)

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(syncGameById('g1')).resolves.toBeUndefined()
      expect(consoleErrorSpy).toHaveBeenCalledWith('[realtime] sync failed for game g1:', error)
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  it('catches and logs timer-fire sync rejections to prevent unhandled rejection crashes', async () => {
    buildGameSnapshot.mockResolvedValue(snapshotResult())
    await syncGameById('g1')
    expect(buildGameSnapshot).toHaveBeenCalledTimes(1)

    // Make the next buildGameSnapshot call reject (simulating a transient DB error).
    const error = new Error('DB error')
    buildGameSnapshot.mockRejectedValueOnce(error)

    // Spy on console.error to verify it was called (silenced to prevent test noise).
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // Deadline passes → timer fires → syncGameById runs again and rejects.
    // The rejection is caught by the inner try/catch and logged.
    await vi.advanceTimersByTimeAsync(20_000 + 250)

    // Verify the rejection was handled by console.error.
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[realtime] sync failed for game g1:',
      error
    )

    consoleErrorSpy.mockRestore()
  })
})
