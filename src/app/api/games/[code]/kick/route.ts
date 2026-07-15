import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getGameByCode } from '@/db/game-queries'
import { kickParticipant } from '@/db/game-mutations'
import { syncGameById } from '@/lib/realtime/sync'

export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { code } = await params
  const body = await req.json().catch(() => null)
  const participantId = typeof body?.participantId === 'string' ? body.participantId : ''
  if (!participantId) {
    return NextResponse.json({ error: 'participantId is required' }, { status: 400 })
  }

  const game = await getGameByCode(code)
  if (!game) return NextResponse.json({ error: 'Game not found' }, { status: 404 })
  if (game.hostUserId !== session.user.id) {
    return NextResponse.json({ error: 'Only the host can remove a player' }, { status: 403 })
  }

  const kicked = await kickParticipant(game.id, participantId)
  if (!kicked) return NextResponse.json({ error: 'Participant not found' }, { status: 404 })

  await syncGameById(game.id)

  return NextResponse.json({ ok: true })
}
