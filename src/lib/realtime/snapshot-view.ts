import type { GameLeaderboardEntry, GameQuestionView, GameSnapshot, GameStatus } from './types'

export type GameParticipantView = { id: string; nickname: string; score: number; answered: boolean }

export type GameStateView = {
  status: GameStatus
  currentQuestionIndex: number
  totalQuestions: number
  phaseStartedAt: string
  participants: GameParticipantView[]
  you: { id: string; nickname: string; score: number; streak: number; kickedAt: string | null } | null
  question?: GameQuestionView
  correctIndex?: number
  leaderboard?: GameLeaderboardEntry[]
}

// The room broadcast is one shared payload; each client derives its own view.
// "you" resolves from the FULL list (kicked included) so a kicked student
// still sees their removal screen, while the visible roster excludes them.
export function snapshotToView(snapshot: GameSnapshot, participantId: string | null): GameStateView {
  const you = participantId ? (snapshot.participants.find((p) => p.id === participantId) ?? null) : null
  return {
    status: snapshot.status,
    currentQuestionIndex: snapshot.currentQuestionIndex,
    totalQuestions: snapshot.totalQuestions,
    phaseStartedAt: snapshot.phaseStartedAt,
    participants: snapshot.participants
      .filter((p) => !p.kickedAt)
      .map((p) => ({ id: p.id, nickname: p.nickname, score: p.score, answered: p.answered })),
    you: you
      ? { id: you.id, nickname: you.nickname, score: you.score, streak: you.streak, kickedAt: you.kickedAt }
      : null,
    question: snapshot.question,
    correctIndex: snapshot.correctIndex,
    leaderboard: snapshot.leaderboard,
  }
}
