'use client'

import { Trophy } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { GameLeaderboardEntry, GameStateView } from '@/hooks/useGameSocket'

function PodiumBlock({
  entry,
  place,
  heightClass,
  delayClass,
  isYou,
}: {
  entry: GameLeaderboardEntry
  place: 1 | 2 | 3
  heightClass: string
  delayClass: string
  isYou: boolean
}) {
  return (
    <div className={`flex flex-col items-center gap-2 w-24 ${delayClass}`}>
      {place === 1 && <Trophy className="w-6 h-6 text-accent" />}
      <p
        className={cn(
          'text-sm font-semibold truncate w-full text-center',
          isYou ? 'text-accent' : 'text-foreground'
        )}
      >
        {entry.nickname}
        {isYou && ' (you)'}
      </p>
      <p className="text-xs text-muted-foreground tabular-nums">{entry.score}</p>
      <div
        className={`w-full rounded-t-xl bg-accent/20 border border-accent/40 flex items-start justify-center pt-2 ${heightClass}`}
      >
        <span className="font-display font-bold text-2xl text-accent">{place}</span>
      </div>
    </div>
  )
}

export function StudentPodium({
  leaderboard,
  you,
}: {
  leaderboard: GameLeaderboardEntry[]
  you: GameStateView['you']
}) {
  const [first, second, third] = leaderboard
  const rest = leaderboard.slice(3)
  const yourEntry = leaderboard.find((p) => p.id === you?.id)

  return (
    <div className="max-w-2xl mx-auto px-6 py-10 space-y-8 text-center">
      <div className="space-y-2">
        <h1 className="font-display font-bold text-2xl text-foreground">Final results</h1>
        {yourEntry && (
          <p className="text-muted-foreground text-sm">
            You finished <span className="font-semibold text-accent">#{yourEntry.rank}</span> with{' '}
            <span className="font-semibold text-accent">{yourEntry.score}</span> points
          </p>
        )}
      </div>

      <div className="flex items-end justify-center gap-3">
        {second && (
          <PodiumBlock
            entry={second}
            place={2}
            heightClass="h-28"
            delayClass="animate-fade-up animate-fade-up-delay-2"
            isYou={second.id === you?.id}
          />
        )}
        {first && (
          <PodiumBlock
            entry={first}
            place={1}
            heightClass="h-36"
            delayClass="animate-fade-up"
            isYou={first.id === you?.id}
          />
        )}
        {third && (
          <PodiumBlock
            entry={third}
            place={3}
            heightClass="h-20"
            delayClass="animate-fade-up animate-fade-up-delay-3"
            isYou={third.id === you?.id}
          />
        )}
      </div>

      {rest.length > 0 && (
        <div className="rounded-2xl border-2 border-border bg-card divide-y divide-border shadow-brutal text-left animate-fade-up animate-fade-up-delay-3">
          {rest.map((p) => (
            <div
              key={p.id}
              className={cn(
                'flex items-center justify-between px-4 py-2.5 text-sm',
                p.id === you?.id && 'bg-accent/10'
              )}
            >
              <span className="flex items-center gap-3">
                <span className="w-6 text-muted-foreground font-mono">{p.rank}</span>
                <span className={p.id === you?.id ? 'text-accent font-semibold' : 'text-foreground'}>
                  {p.nickname}
                  {p.id === you?.id && ' (you)'}
                </span>
              </span>
              <span className="font-semibold text-accent tabular-nums">{p.score}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
