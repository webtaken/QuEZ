import { NextRequest, NextResponse } from 'next/server'
import { getGameByCode, getQuestionsForQuiz, getParticipantsWithAnswerStatus } from '@/db/game-queries'
import { maybeAdvancePhase } from '@/db/game-mutations'
import { rankParticipants } from '@/lib/game-scoring'

export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const participantId = req.nextUrl.searchParams.get('participantId')

  const game = await getGameByCode(code)
  if (!game) return NextResponse.json({ error: 'Game not found' }, { status: 404 })

  const allQuestions = await getQuestionsForQuiz(game.quizId)
  const currentQuestion = allQuestions[game.currentQuestionIndex]

  const settled = await maybeAdvancePhase(game, currentQuestion)

  const list = await getParticipantsWithAnswerStatus(
    settled.id,
    currentQuestion && (settled.status === 'question' || settled.status === 'reveal') ? currentQuestion.id : null
  )
  const active = list.filter((p) => !p.kickedAt)
  const you = participantId ? (list.find((p) => p.id === participantId) ?? null) : null

  const response: Record<string, unknown> = {
    status: settled.status,
    currentQuestionIndex: settled.currentQuestionIndex,
    totalQuestions: allQuestions.length,
    phaseStartedAt: settled.phaseStartedAt.toISOString(),
    participants: active.map((p) => ({ id: p.id, nickname: p.nickname, score: p.score, answered: p.answered })),
    you: you
      ? {
          id: you.id,
          nickname: you.nickname,
          score: you.score,
          streak: you.streak,
          kickedAt: you.kickedAt ? you.kickedAt.toISOString() : null,
        }
      : null,
  }

  if (currentQuestion && settled.status !== 'waiting') {
    response.question = {
      id: currentQuestion.id,
      text: currentQuestion.text,
      options: currentQuestion.options,
      timeLimit: currentQuestion.timeLimit,
    }
  }

  if (settled.status === 'reveal' || settled.status === 'podium') {
    if (currentQuestion) response.correctIndex = currentQuestion.correctIndex
    response.leaderboard = rankParticipants(
      active.map((p) => ({ id: p.id, nickname: p.nickname, score: p.score, totalAnswerMs: p.totalAnswerMs }))
    )
  }

  return NextResponse.json(response)
}
