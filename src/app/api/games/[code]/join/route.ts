import { NextRequest, NextResponse } from 'next/server'
import { getGameByCode } from '@/db/game-queries'
import { joinGame } from '@/db/game-mutations'

export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const body = await req.json().catch(() => null)

  const nickname = typeof body?.nickname === 'string' ? body.nickname.trim() : ''
  const sessionToken = typeof body?.sessionToken === 'string' ? body.sessionToken : ''
  if (!nickname || nickname.length > 20) {
    return NextResponse.json({ error: 'Nickname must be 1-20 characters' }, { status: 400 })
  }
  if (!sessionToken) {
    return NextResponse.json({ error: 'sessionToken is required' }, { status: 400 })
  }

  const game = await getGameByCode(code)
  if (!game) return NextResponse.json({ error: 'Game not found' }, { status: 404 })

  const result = await joinGame(game, nickname, sessionToken)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  return NextResponse.json({ participantId: result.participant.id, nickname: result.participant.nickname })
}
