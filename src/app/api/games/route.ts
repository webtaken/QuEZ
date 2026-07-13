import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { isUuid } from '@/lib/ids'
import { createGameSession } from '@/db/game-mutations'

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body || !isUuid(body.quizId)) {
    return NextResponse.json({ error: 'quizId must be a valid id' }, { status: 400 })
  }

  const result = await createGameSession(body.quizId, session.user.id)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  return NextResponse.json({ gameId: result.game.id, code: result.game.code })
}
