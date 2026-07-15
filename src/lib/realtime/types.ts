// Wire format shared by the Socket.IO server and the browser client.
// MUST stay free of server-only imports (drizzle, node:*) — the client bundles it.

// How long the final question's reveal lingers before auto-advancing to podium.
// Lives here (not in game-mutations) so client-safe modules can import it
// without pulling in the db.
export const REVEAL_TO_PODIUM_MS = 5000

export type GameStatus = 'waiting' | 'question' | 'reveal' | 'podium'

export type GameSnapshotParticipant = {
  id: string
  nickname: string
  score: number
  streak: number
  answered: boolean
  kickedAt: string | null
}

export type GameLeaderboardEntry = {
  id: string
  nickname: string
  score: number
  totalAnswerMs: number
  rank: number
}

export type GameQuestionView = { id: string; text: string; options: string[]; timeLimit: number }

// One shared payload per room — every client receives the same snapshot and
// derives its own view (see snapshot-view.ts). correctIndex/leaderboard are
// present only when status is 'reveal' or 'podium'.
export type GameSnapshot = {
  status: GameStatus
  currentQuestionIndex: number
  totalQuestions: number
  phaseStartedAt: string
  participants: GameSnapshotParticipant[]
  question?: GameQuestionView
  correctIndex?: number
  leaderboard?: GameLeaderboardEntry[]
}

export type GameErrorReason = 'not-found' | 'ended'
