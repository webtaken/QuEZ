import { db } from '@/db'
import { gameSessions, gameParticipants, gameAnswers, quizzes, type GameSession } from '@/db/schema'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { generateUniqueGameCode } from '@/lib/game-code'
import { computePoints } from '@/lib/game-scoring'
import { hasActiveGameWithCode, getQuestionsForQuiz } from '@/db/game-queries'

type CreateGameResult = { ok: true; game: GameSession } | { ok: false; error: string; status: number }

export async function createGameSession(quizId: string, hostUserId: string): Promise<CreateGameResult> {
  const [quiz] = await db
    .select({ id: quizzes.id })
    .from(quizzes)
    .where(and(eq(quizzes.id, quizId), eq(quizzes.userId, hostUserId)))
    .limit(1)
  if (!quiz) return { ok: false, error: 'Quiz not found', status: 404 }

  const quizQuestions = await getQuestionsForQuiz(quizId)
  if (quizQuestions.length === 0) {
    return { ok: false, error: 'Quiz has no questions', status: 400 }
  }

  const code = await generateUniqueGameCode(hasActiveGameWithCode)
  const [created] = await db.insert(gameSessions).values({ quizId, hostUserId, code }).returning()
  return { ok: true, game: created }
}

type JoinResult =
  | { ok: true; participant: typeof gameParticipants.$inferSelect }
  | { ok: false; error: string; status: number }

// sessionToken is generated client-side BEFORE the join request, so a retried
// request (e.g. after a dropped response) is idempotent: the second call
// finds the same sessionToken and returns the existing participant instead
// of erroring on a duplicate nickname.
export async function joinGame(game: GameSession, nickname: string, sessionToken: string): Promise<JoinResult> {
  const [existing] = await db
    .select()
    .from(gameParticipants)
    .where(and(eq(gameParticipants.gameId, game.id), eq(gameParticipants.sessionToken, sessionToken)))
    .limit(1)
  if (existing) {
    if (existing.kickedAt) return { ok: false, error: 'You were removed from this game', status: 403 }
    return { ok: true, participant: existing }
  }

  if (game.status !== 'waiting') {
    return { ok: false, error: 'This game has already started', status: 403 }
  }

  const trimmed = nickname.trim()
  const active = await db
    .select({ nickname: gameParticipants.nickname })
    .from(gameParticipants)
    .where(and(eq(gameParticipants.gameId, game.id), isNull(gameParticipants.kickedAt)))
  if (active.some((p) => p.nickname.toLowerCase() === trimmed.toLowerCase())) {
    return { ok: false, error: 'That nickname is already taken in this game', status: 409 }
  }

  const [created] = await db
    .insert(gameParticipants)
    .values({ gameId: game.id, nickname: trimmed, sessionToken })
    .returning()
  return { ok: true, participant: created }
}

export async function startGame(gameId: string): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const active = await db
    .select({ id: gameParticipants.id })
    .from(gameParticipants)
    .where(and(eq(gameParticipants.gameId, gameId), isNull(gameParticipants.kickedAt)))
  if (active.length === 0) {
    return { ok: false, error: 'No players have joined yet', status: 400 }
  }

  const [updated] = await db
    .update(gameSessions)
    .set({ status: 'question', currentQuestionIndex: 0, phaseStartedAt: new Date() })
    .where(and(eq(gameSessions.id, gameId), eq(gameSessions.status, 'waiting')))
    .returning({ id: gameSessions.id })
  if (!updated) return { ok: false, error: 'Game has already started', status: 409 }
  return { ok: true }
}

export async function kickParticipant(gameId: string, participantId: string): Promise<boolean> {
  const [updated] = await db
    .update(gameParticipants)
    .set({ kickedAt: new Date() })
    .where(and(eq(gameParticipants.id, participantId), eq(gameParticipants.gameId, gameId)))
    .returning({ id: gameParticipants.id })
  return !!updated
}

type AnswerResult = { ok: true } | { ok: false; error: string; status: number }

export async function submitAnswer(
  game: GameSession,
  question: { id: string; correctIndex: number; timeLimit: number },
  participantId: string,
  sessionToken: string,
  selectedIndex: number | null
): Promise<AnswerResult> {
  const [participant] = await db
    .select()
    .from(gameParticipants)
    .where(
      and(
        eq(gameParticipants.id, participantId),
        eq(gameParticipants.gameId, game.id),
        eq(gameParticipants.sessionToken, sessionToken),
        isNull(gameParticipants.kickedAt)
      )
    )
    .limit(1)
  if (!participant) return { ok: false, error: 'Participant not found', status: 404 }

  const timeLimitMs = question.timeLimit * 1000
  const rawMs = Date.now() - game.phaseStartedAt.getTime()
  const answerMs = Math.max(0, Math.min(rawMs, timeLimitMs))
  const isCorrect = selectedIndex !== null && selectedIndex === question.correctIndex
  const pointsAwarded = computePoints(timeLimitMs, answerMs, isCorrect, participant.streak)

  const [inserted] = await db
    .insert(gameAnswers)
    .values({
      gameId: game.id,
      participantId,
      questionId: question.id,
      selectedIndex,
      answerMs,
      isCorrect,
      pointsAwarded,
    })
    .onConflictDoNothing({ target: [gameAnswers.participantId, gameAnswers.questionId] })
    .returning({ id: gameAnswers.id })

  // A duplicate submit (double-tap, client retry) is a no-op — the first
  // submission already scored and updated the participant.
  if (!inserted) return { ok: true }

  await db
    .update(gameParticipants)
    .set({
      score: sql`${gameParticipants.score} + ${pointsAwarded}`,
      streak: isCorrect ? participant.streak + 1 : 0,
      totalAnswerMs: sql`${gameParticipants.totalAnswerMs} + ${answerMs}`,
    })
    .where(eq(gameParticipants.id, participantId))

  return { ok: true }
}

const REVEAL_TO_PODIUM_MS = 5000

// The core state-machine step: called on every poll of GET /state. If the
// question phase's timer has elapsed, or every active participant has
// answered, it backfills a 0-point "no answer" for anyone who didn't answer
// (keeping streak/tie-break consistent) and flips the game to 'reveal'. The
// `WHERE status='question'` guard on the final UPDATE makes this race-safe:
// if two pollers both pass the elapsed/all-answered check at once, only one
// UPDATE actually applies — the loser just returns the (soon-stale) game it
// was given, and picks up 'reveal' on its next poll ~1.5s later.
//
// The *final* question's reveal also advances lazily: after
// REVEAL_TO_PODIUM_MS it flips to 'podium' so students reach the podium
// even if the host never clicks "Show podium". The host's /advance click
// remains an early skip; the `WHERE status='reveal'` guard keeps the two
// paths race-safe against each other.
export async function maybeAdvancePhase(
  game: GameSession,
  currentQuestion: { id: string; timeLimit: number } | undefined,
  totalQuestions: number
): Promise<GameSession> {
  if (game.status === 'reveal') {
    const isLast = game.currentQuestionIndex + 1 >= totalQuestions
    const revealElapsedMs = Date.now() - game.phaseStartedAt.getTime()
    if (!isLast || revealElapsedMs < REVEAL_TO_PODIUM_MS) return game
    const [updated] = await db
      .update(gameSessions)
      .set({ status: 'podium', endedAt: new Date(), phaseStartedAt: new Date() })
      .where(and(eq(gameSessions.id, game.id), eq(gameSessions.status, 'reveal')))
      .returning()
    return updated ?? game
  }

  if (game.status !== 'question' || !currentQuestion) return game

  const elapsedMs = Date.now() - game.phaseStartedAt.getTime()
  const timeLimitMs = currentQuestion.timeLimit * 1000

  const active = await db
    .select({ id: gameParticipants.id })
    .from(gameParticipants)
    .where(and(eq(gameParticipants.gameId, game.id), isNull(gameParticipants.kickedAt)))

  const answered = await db
    .select({ participantId: gameAnswers.participantId })
    .from(gameAnswers)
    .where(and(eq(gameAnswers.gameId, game.id), eq(gameAnswers.questionId, currentQuestion.id)))
  const answeredIds = new Set(answered.map((a) => a.participantId))

  const allAnswered = active.length > 0 && active.every((p) => answeredIds.has(p.id))
  if (elapsedMs < timeLimitMs && !allAnswered) return game

  const missing = active.filter((p) => !answeredIds.has(p.id))
  if (missing.length > 0) {
    const backfilled = await db
      .insert(gameAnswers)
      .values(
        missing.map((p) => ({
          gameId: game.id,
          participantId: p.id,
          questionId: currentQuestion.id,
          selectedIndex: null,
          answerMs: timeLimitMs,
          isCorrect: false,
          pointsAwarded: 0,
        }))
      )
      .onConflictDoNothing({ target: [gameAnswers.participantId, gameAnswers.questionId] })
      .returning({ participantId: gameAnswers.participantId })

    // Only this call's own inserted rows (not rows that already existed via
    // onConflictDoNothing) should affect participant stats — otherwise
    // concurrent pollers double-count totalAnswerMs and stomp a streak a
    // last-second submitAnswer just earned.
    if (backfilled.length > 0) {
      await db
        .update(gameParticipants)
        .set({ streak: 0, totalAnswerMs: sql`${gameParticipants.totalAnswerMs} + ${timeLimitMs}` })
        .where(
          inArray(
            gameParticipants.id,
            backfilled.map((b) => b.participantId)
          )
        )
    }
  }

  const [updated] = await db
    .update(gameSessions)
    .set({ status: 'reveal', phaseStartedAt: new Date() })
    .where(and(eq(gameSessions.id, game.id), eq(gameSessions.status, 'question')))
    .returning()
  return updated ?? game
}

export async function advanceGame(
  game: GameSession,
  totalQuestions: number
): Promise<{ ok: true; game: GameSession } | { ok: false; error: string; status: number }> {
  if (game.status !== 'reveal') {
    return { ok: false, error: 'Game is not in the reveal phase', status: 409 }
  }
  const isLast = game.currentQuestionIndex + 1 >= totalQuestions
  const [updated] = await db
    .update(gameSessions)
    .set(
      isLast
        ? { status: 'podium', endedAt: new Date() }
        : { status: 'question', currentQuestionIndex: game.currentQuestionIndex + 1, phaseStartedAt: new Date() }
    )
    .where(and(eq(gameSessions.id, game.id), eq(gameSessions.status, 'reveal')))
    .returning()
  if (!updated) return { ok: false, error: 'Game is not in the reveal phase', status: 409 }
  return { ok: true, game: updated }
}
