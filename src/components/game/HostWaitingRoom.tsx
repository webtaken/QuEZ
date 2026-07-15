'use client'

import { X, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { GameParticipantView } from '@/hooks/useGameSocket'

export function HostWaitingRoom({
  code,
  quizTitle,
  coverEmoji,
  participants,
  onKick,
  onStart,
}: {
  code: string
  quizTitle: string
  coverEmoji: string
  participants: GameParticipantView[]
  onKick: (participantId: string) => void
  onStart: () => void
}) {
  const joinUrl = typeof window !== 'undefined' ? `${window.location.origin}/join/${code}` : `/join/${code}`

  return (
    <div className="max-w-3xl mx-auto px-6 py-10 space-y-8 text-center">
      <div className="space-y-2">
        <div className="text-5xl">{coverEmoji}</div>
        <h1 className="font-[family-name:var(--font-syne)] font-bold text-2xl text-foreground">{quizTitle}</h1>
        <p className="text-muted-foreground text-sm">Waiting for players to join</p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 space-y-2">
        <p className="text-xs text-muted-foreground uppercase tracking-wide">Room code</p>
        <p className="font-[family-name:var(--font-syne)] font-bold text-5xl text-accent-lime tabular-nums tracking-widest">
          {code}
        </p>
        <p className="text-xs text-muted-foreground break-all">{joinUrl}</p>
      </div>

      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {participants.length} player{participants.length === 1 ? '' : 's'} joined
        </p>
        <div className="flex flex-wrap gap-2 justify-center min-h-12">
          {participants.map((p) => (
            <Badge key={p.id} variant="secondary" className="gap-1.5 text-sm py-1.5 px-3">
              {p.nickname}
              <button
                onClick={() => onKick(p.id)}
                aria-label={`Remove ${p.nickname}`}
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="w-3 h-3" />
              </button>
            </Badge>
          ))}
        </div>
      </div>

      <Button
        onClick={onStart}
        disabled={participants.length === 0}
        size="lg"
        className="gap-2 rounded-xl bg-accent-lime text-accent-lime-foreground hover:bg-accent-lime/90 font-semibold"
      >
        <Play className="w-4 h-4" />
        Start quiz
      </Button>
    </div>
  )
}
