'use client'

import { Trophy } from 'lucide-react'
import type { GameLeaderboardEntry } from '@/hooks/useGamePolling'

function PodiumBlock({
  entry,
  place,
  heightClass,
  delayClass,
}: {
  entry: GameLeaderboardEntry
  place: 1 | 2 | 3
  heightClass: string
  delayClass: string
}) {
  return (
    <div className={`flex flex-col items-center gap-2 w-24 ${delayClass}`}>
      {place === 1 && <Trophy className="w-6 h-6 text-accent-lime" />}
      <p className="text-sm font-semibold text-foreground truncate w-full text-center">{entry.nickname}</p>
      <p className="text-xs text-muted-foreground tabular-nums">{entry.score}</p>
      <div
        className={`w-full rounded-t-xl bg-accent-lime/20 border border-accent-lime/40 flex items-start justify-center pt-2 ${heightClass}`}
      >
        <span className="font-[family-name:var(--font-syne)] font-bold text-2xl text-accent-lime">{place}</span>
      </div>
    </div>
  )
}

export function HostPodium({
  leaderboard,
  quizTitle,
  coverEmoji,
}: {
  leaderboard: GameLeaderboardEntry[]
  quizTitle: string
  coverEmoji: string
}) {
  const [first, second, third] = leaderboard
  const rest = leaderboard.slice(3)

  return (
    <div className="max-w-2xl mx-auto px-6 py-10 space-y-8 text-center">
      <div className="space-y-2">
        <div className="text-5xl">{coverEmoji}</div>
        <h1 className="font-[family-name:var(--font-syne)] font-bold text-2xl text-foreground">{quizTitle}</h1>
        <p className="text-muted-foreground text-sm">Final results</p>
      </div>

      <div className="flex items-end justify-center gap-3">
        {second && <PodiumBlock entry={second} place={2} heightClass="h-28" delayClass="animate-fade-up animate-fade-up-delay-2" />}
        {first && <PodiumBlock entry={first} place={1} heightClass="h-36" delayClass="animate-fade-up" />}
        {third && <PodiumBlock entry={third} place={3} heightClass="h-20" delayClass="animate-fade-up animate-fade-up-delay-3" />}
      </div>

      {rest.length > 0 && (
        <div className="rounded-2xl border border-border bg-card divide-y divide-border text-left animate-fade-up animate-fade-up-delay-3">
          {rest.map((p) => (
            <div key={p.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span className="flex items-center gap-3">
                <span className="w-6 text-muted-foreground font-mono">{p.rank}</span>
                <span className="text-foreground">{p.nickname}</span>
              </span>
              <span className="font-semibold text-accent-lime tabular-nums">{p.score}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
