'use client'

import { Badge } from '@/components/ui/badge'
import type { GameParticipantView, GameStateView } from '@/hooks/useGameSocket'

export function StudentWaitingRoom({
  participants,
  you,
}: {
  participants: GameParticipantView[]
  you: GameStateView['you']
}) {
  return (
    <div className="max-w-md mx-auto px-6 py-16 space-y-6 text-center">
      <h1 className="font-display font-bold text-2xl text-foreground">You&apos;re in!</h1>
      <p className="text-muted-foreground text-sm">Waiting for the host to start the quiz...</p>

      <div className="flex flex-wrap gap-2 justify-center">
        {participants.map((p) => (
          <Badge key={p.id} variant={p.id === you?.id ? 'default' : 'secondary'} className="text-sm py-1.5 px-3">
            {p.nickname}
            {p.id === you?.id && ' (you)'}
          </Badge>
        ))}
      </div>
    </div>
  )
}
