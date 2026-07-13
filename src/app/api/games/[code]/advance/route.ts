import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getGameByCode, getQuestionsForQuiz } from '@/db/game-queries'
import { advanceGame } from '@/db/game-mutations'

export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { code } = await params
  const game = await getGameByCode(code)
  if (!game) return NextResponse.json({ error: 'Game not found' }, { status: 404 })
  if (game.hostUserId !== session.user.id) {
    return NextResponse.json({ error: 'Only the host can advance this game' }, { status: 403 })
  }

  const allQuestions = await getQuestionsForQuiz(game.quizId)
  const result = await advanceGame(game, allQuestions.length)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  return NextResponse.json({ status: result.game.status })
}
