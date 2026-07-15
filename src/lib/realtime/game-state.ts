import { getGameById, getQuestionsForQuiz, getParticipantsWithAnswerStatus } from '@/db/game-queries'
import { maybeAdvancePhase } from '@/db/game-mutations'
import { rankParticipants } from '@/lib/game-scoring'
import type { GameSession } from '@/db/schema'
import type { GameSnapshot } from './types'

type Question = Awaited<ReturnType<typeof getQuestionsForQuiz>>[number]

export type GameSnapshotResult = {
  snapshot: GameSnapshot
  game: GameSession
  currentQuestion: Question | undefined
  totalQuestions: number
}

// The single read path for game state — used by the socket connect handler,
// syncGameById, and (indirectly) every POST mutation. Runs maybeAdvancePhase
// first, so any overdue phase settles before the snapshot is built; this is
// also the restart-recovery fallback (in-memory timers die with the process,
// but the next connect/mutation settles the phase from phaseStartedAt in DB).
export async function buildGameSnapshot(gameId: string): Promise<GameSnapshotResult | null> {
  const game = await getGameById(gameId)
  if (!game) return null

  const allQuestions = await getQuestionsForQuiz(game.quizId)
  const currentQuestion = allQuestions[game.currentQuestionIndex]

  const settled = await maybeAdvancePhase(game, currentQuestion, allQuestions.length)

  const list = await getParticipantsWithAnswerStatus(
    settled.id,
    currentQuestion && (settled.status === 'question' || settled.status === 'reveal') ? currentQuestion.id : null
  )
  const active = list.filter((p) => !p.kickedAt)

  const snapshot: GameSnapshot = {
    status: settled.status as GameSnapshot['status'],
    currentQuestionIndex: settled.currentQuestionIndex,
    totalQuestions: allQuestions.length,
    phaseStartedAt: settled.phaseStartedAt.toISOString(),
    participants: list.map((p) => ({
      id: p.id,
      nickname: p.nickname,
      score: p.score,
      streak: p.streak,
      answered: p.answered,
      kickedAt: p.kickedAt ? p.kickedAt.toISOString() : null,
    })),
  }

  if (currentQuestion && settled.status !== 'waiting') {
    snapshot.question = {
      id: currentQuestion.id,
      text: currentQuestion.text,
      options: currentQuestion.options,
      timeLimit: currentQuestion.timeLimit,
    }
  }

  if (settled.status === 'reveal' || settled.status === 'podium') {
    if (currentQuestion) snapshot.correctIndex = currentQuestion.correctIndex
    snapshot.leaderboard = rankParticipants(
      active.map((p) => ({ id: p.id, nickname: p.nickname, score: p.score, totalAnswerMs: p.totalAnswerMs }))
    )
  }

  return { snapshot, game: settled, currentQuestion, totalQuestions: allQuestions.length }
}
