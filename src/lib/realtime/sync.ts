import type { GameSession } from '@/db/schema'
import { getIo, getSyncChains } from './io'
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
// Never throws: broadcast is best-effort — the DB write is the source of
// truth, and a client that misses a broadcast converges on the next sync.
async function doSync(gameId: string): Promise<void> {
  try {
    const io = getIo()
    const result = await buildGameSnapshot(gameId)
    if (!result) {
      ensurePhaseTimer(gameId, null, () => {})
      io?.to(gameId).emit('game:error', { reason: 'ended' })
      return
    }
    io?.to(gameId).emit('game:state', result.snapshot)
    ensurePhaseTimer(gameId, phaseTimerSpec(result.game, result.currentQuestion, result.totalQuestions), () => {
      // A failed timer-fire sync must not crash the process; the game self-heals
      // on the next connect or mutation sync.
      syncGameById(gameId).catch((err) => console.error(`[realtime] timer sync failed for game ${gameId}:`, err))
    })
  } catch (err) {
    console.error(`[realtime] sync failed for game ${gameId}:`, err)
  }
}

// Concurrent syncs for one game (two answers landing together, a connect
// racing an advance) must not interleave: the loser of maybeAdvancePhase's
// guarded UPDATE would broadcast a stale phase AFTER the winner's fresh one
// and re-arm/clear timers from stale state. A per-game promise chain makes
// every sync read state committed by the previous one. Single-instance only
// (in-process map) — matches the deployment decision.
export function syncGameById(gameId: string): Promise<void> {
  const chains = getSyncChains()
  const next = (chains.get(gameId) ?? Promise.resolve()).then(() => doSync(gameId))
  const tracked = next.finally(() => {
    if (chains.get(gameId) === tracked) chains.delete(gameId)
  })
  chains.set(gameId, tracked)
  return tracked
}
