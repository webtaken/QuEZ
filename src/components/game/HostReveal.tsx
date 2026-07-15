'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { GameQuestionView, GameLeaderboardEntry } from '@/hooks/useGameSocket'

export function HostReveal({
  question,
  correctIndex,
  currentQuestionIndex,
  totalQuestions,
  leaderboard,
  onAdvance,
}: {
  question: GameQuestionView
  correctIndex: number
  currentQuestionIndex: number
  totalQuestions: number
  leaderboard: GameLeaderboardEntry[]
  onAdvance: () => void
}) {
  const [canAdvance, setCanAdvance] = useState(false)
  const isLast = currentQuestionIndex + 1 >= totalQuestions

  // Gives students at least 2s to see the reveal (highlight + sound) before
  // the host can skip to the next question. Resets because HostGameView
  // keys this component by currentQuestionIndex, forcing a remount per question.
  useEffect(() => {
    const t = setTimeout(() => setCanAdvance(true), 2000)
    return () => clearTimeout(t)
  }, [])

  return (
    <div className="max-w-2xl mx-auto px-6 py-10 space-y-6">
      <h1 className="font-[family-name:var(--font-syne)] font-semibold text-xl text-foreground text-center">
        {question.text}
      </h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {question.options.map((opt, i) => (
          <div
            key={i}
            className={cn(
              'flex items-center gap-3 px-4 py-3 rounded-xl border text-left text-sm',
              i === correctIndex
                ? 'border-success bg-success/15 text-foreground'
                : 'border-border bg-secondary/30 text-muted-foreground'
            )}
          >
            <span className="w-6 h-6 rounded-full border text-xs font-bold flex items-center justify-center shrink-0">
              {String.fromCharCode(65 + i)}
            </span>
            <span>{opt}</span>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <h2 className="font-[family-name:var(--font-syne)] font-semibold text-sm text-muted-foreground">
          Leaderboard
        </h2>
        <div className="rounded-2xl border border-border bg-card divide-y divide-border">
          {leaderboard.slice(0, 8).map((p) => (
            <div key={p.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span className="flex items-center gap-3">
                <span className="w-6 text-muted-foreground font-mono">{p.rank}</span>
                <span className="text-foreground">{p.nickname}</span>
              </span>
              <span className="font-semibold text-accent-lime tabular-nums">{p.score}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="text-center">
        <Button
          onClick={onAdvance}
          disabled={!canAdvance}
          size="lg"
          className="rounded-xl bg-accent-lime text-accent-lime-foreground hover:bg-accent-lime/90 font-semibold"
        >
          {isLast ? 'Show podium' : 'Next question'}
        </Button>
      </div>
    </div>
  )
}
