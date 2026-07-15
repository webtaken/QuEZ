import { NextRequest, NextResponse } from 'next/server'
import { getGameByCode, getQuestionsForQuiz } from '@/db/game-queries'
import { submitAnswer } from '@/db/game-mutations'
import { syncGameById } from '@/lib/realtime/sync'

export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const body = await req.json().catch(() => null)

  const participantId = typeof body?.participantId === 'string' ? body.participantId : ''
  const questionId = typeof body?.questionId === 'string' ? body.questionId : ''
  const sessionToken = typeof body?.sessionToken === 'string' ? body.sessionToken : ''
  const selectedIndex = typeof body?.selectedIndex === 'number' ? body.selectedIndex : null
  if (!participantId || !questionId || !sessionToken) {
    return NextResponse.json({ error: 'participantId, questionId, and sessionToken are required' }, { status: 400 })
  }

  const game = await getGameByCode(code)
  if (!game) return NextResponse.json({ error: 'Game not found' }, { status: 404 })
  if (game.status !== 'question') {
    return NextResponse.json({ error: 'This question is no longer accepting answers' }, { status: 409 })
  }

  const allQuestions = await getQuestionsForQuiz(game.quizId)
  const currentQuestion = allQuestions[game.currentQuestionIndex]
  if (!currentQuestion || currentQuestion.id !== questionId) {
    return NextResponse.json({ error: 'That is not the current question' }, { status: 409 })
  }

  const result = await submitAnswer(game, currentQuestion, participantId, sessionToken, selectedIndex)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  await syncGameById(game.id)

  return NextResponse.json({ ok: true })
}
