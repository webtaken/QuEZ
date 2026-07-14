'use client'

import { useEffect } from 'react'
import { cn } from '@/lib/utils'
import { useGameSound } from '@/hooks/useGameSound'
import type { GameLeaderboardEntry, GameQuestionView, GameStateView } from '@/hooks/useGamePolling'

export function StudentReveal({
  question,
  correctIndex,
  selectedIndex,
  you,
  leaderboard,
}: {
  question: GameQuestionView
  correctIndex: number
  selectedIndex: number | null
  you: NonNullable<GameStateView['you']>
  leaderboard: GameLeaderboardEntry[]
}) {
  const { playCorrect, playWrong } = useGameSound()
  const isCorrect = selectedIndex !== null && selectedIndex === correctIndex

  useEffect(() => {
    if (isCorrect) playCorrect()
    else playWrong()
    // Fires once on mount only — StudentGameView keys this component by
    // currentQuestionIndex, so a new question is always a fresh mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="max-w-2xl mx-auto px-6 py-10 space-y-6 text-center">
      <div
        className={cn(
          'rounded-2xl border p-6 space-y-1',
          isCorrect ? 'border-success bg-success/15' : 'border-destructive bg-destructive/15'
        )}
      >
        <p
          className={cn(
            'font-[family-name:var(--font-syne)] font-bold text-2xl',
            isCorrect ? 'text-success' : 'text-destructive'
          )}
        >
          {isCorrect ? 'Correct!' : selectedIndex === null ? "Time's up" : 'Wrong'}
        </p>
        {isCorrect && you.streak > 1 && <p className="text-sm text-muted-foreground">🔥 {you.streak} in a row</p>}
      </div>

      <div className="grid grid-cols-1 gap-2">
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

      {leaderboard.length > 0 && (
        <div className="space-y-2 text-left">
          <h2 className="font-[family-name:var(--font-syne)] font-semibold text-sm text-muted-foreground">
            Leaderboard
          </h2>
          <div className="rounded-2xl border border-border bg-card divide-y divide-border">
            {leaderboard.map((p) => (
              <div
                key={p.id}
                className={cn(
                  'flex items-center justify-between px-4 py-2.5 text-sm',
                  p.id === you.id && 'bg-accent-lime/10'
                )}
              >
                <span className="flex items-center gap-3">
                  <span className="w-6 text-muted-foreground font-mono">{p.rank}</span>
                  <span className={p.id === you.id ? 'text-accent-lime font-semibold' : 'text-foreground'}>
                    {p.nickname}
                    {p.id === you.id && ' (you)'}
                  </span>
                </span>
                <span className="font-semibold text-accent-lime tabular-nums">{p.score}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-muted-foreground text-sm">
        Total score: <span className="font-semibold text-accent-lime">{you.score}</span>
      </p>
    </div>
  )
}
