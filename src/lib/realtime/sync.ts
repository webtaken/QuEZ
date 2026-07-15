import type { GameSession } from '@/db/schema'
import { getIo } from './io'
import { ensurePhaseTimer, type PhaseTimerSpec } from './timers'
import { buildGameSnapshot } from './game-state'
import { REVEAL_TO_PODIUM_MS } from './types'

// Fire slightly after the true deadline so the elapsed-time check inside
// maybeAdvancePhase (the single flip engine) is guaranteed to pass.
const TIMER_EPSILON_MS = 250

export function phaseTimerSpec(
  game: Pick<GameSession, 'status' | 'currentQuestionIndex' | 'phaseStartedAt'>,
  currentQuestion: { timeLimit: number } | undefined,
  totalQuestions: number
): PhaseTimerSpec | null {
  if (game.status === 'question' && currentQuestion) {
    const deadline = game.phaseStartedAt.getTime() + currentQuestion.timeLimit * 1000
    return {
      phaseKey: `question:${game.currentQuestionIndex}`,
      delayMs: Math.max(0, deadline - Date.now()) + TIMER_EPSILON_MS,
    }
  }
  const isLast = game.currentQuestionIndex + 1 >= totalQuestions
  if (game.status === 'reveal' && isLast) {
    const deadline = game.phaseStartedAt.getTime() + REVEAL_TO_PODIUM_MS
    return {
      phaseKey: `reveal:${game.currentQuestionIndex}`,
      delayMs: Math.max(0, deadline - Date.now()) + TIMER_EPSILON_MS,
    }
  }
  return null
}

// The one entry point every event funnels through: POST mutations, socket
// connects, and timer fires all call syncGameById. It settles overdue phases
// (maybeAdvancePhase inside buildGameSnapshot), broadcasts one shared snapshot
// to the game's room, and (re-)arms the phase deadline timer.
export async function syncGameById(gameId: string): Promise<void> {
  const io = getIo()
  const result = await buildGameSnapshot(gameId)
  if (!result) {
    ensurePhaseTimer(gameId, null, () => {})
    io?.to(gameId).emit('game:error', { reason: 'ended' })
    return
  }
  io?.to(gameId).emit('game:state', result.snapshot)
  ensurePhaseTimer(gameId, phaseTimerSpec(result.game, result.currentQuestion, result.totalQuestions), () => {
    void syncGameById(gameId)
  })
}
