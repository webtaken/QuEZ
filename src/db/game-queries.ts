import { db } from '@/db'
import { gameSessions, gameParticipants, gameAnswers, questions } from '@/db/schema'
import { and, asc, desc, eq, ne } from 'drizzle-orm'

// The newest row for a code is always the current one — codes are recycled
// once a game reaches 'podium', so an old finished game and a new one can
// briefly share a code.
export async function getGameByCode(code: string) {
  const [game] = await db
    .select()
    .from(gameSessions)
    .where(eq(gameSessions.code, code))
    .orderBy(desc(gameSessions.createdAt))
    .limit(1)
  return game ?? null
}

export async function hasActiveGameWithCode(code: string): Promise<boolean> {
  const [existing] = await db
    .select({ id: gameSessions.id })
    .from(gameSessions)
    .where(and(eq(gameSessions.code, code), ne(gameSessions.status, 'podium')))
    .limit(1)
  return !!existing
}

export async function getQuestionsForQuiz(quizId: string) {
  return db.select().from(questions).where(eq(questions.quizId, quizId)).orderBy(asc(questions.order))
}

export async function getParticipantsWithAnswerStatus(gameId: string, questionId: string | null) {
  const participants = await db
    .select()
    .from(gameParticipants)
    .where(eq(gameParticipants.gameId, gameId))
    .orderBy(asc(gameParticipants.joinedAt))

  let answeredIds = new Set<string>()
  if (questionId) {
    const answers = await db
      .select({ participantId: gameAnswers.participantId })
      .from(gameAnswers)
      .where(and(eq(gameAnswers.gameId, gameId), eq(gameAnswers.questionId, questionId)))
    answeredIds = new Set(answers.map((a) => a.participantId))
  }

  return participants.map((p) => ({
    id: p.id,
    nickname: p.nickname,
    score: p.score,
    streak: p.streak,
    totalAnswerMs: p.totalAnswerMs,
    kickedAt: p.kickedAt,
    answered: answeredIds.has(p.id),
  }))
}
