'use client'

import { Clock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useCountdown } from '@/hooks/useCountdown'
import type { GameQuestionView, GameParticipantView } from '@/hooks/useGameSocket'

export function HostQuestionLive({
  question,
  currentQuestionIndex,
  totalQuestions,
  phaseStartedAt,
  participants,
}: {
  question: GameQuestionView
  currentQuestionIndex: number
  totalQuestions: number
  phaseStartedAt: string
  participants: GameParticipantView[]
}) {
  const secondsLeft = useCountdown(phaseStartedAt, question.timeLimit)
  const answeredCount = participants.filter((p) => p.answered).length

  return (
    <div className="max-w-2xl xl:max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-6 text-center">
      <div className="flex items-center justify-between text-sm xl:text-xl text-muted-foreground">
        <span>
          Question {currentQuestionIndex + 1} / {totalQuestions}
        </span>
        <Badge
          variant="secondary"
          className={cn(
            'gap-1 tabular-nums xl:h-9 xl:text-xl xl:[&>svg]:size-5',
            secondsLeft <= 5 && 'bg-destructive/20 text-destructive'
          )}
        >
          <Clock className="w-3 h-3" />
          {secondsLeft}s
        </Badge>
      </div>

      <h1 className="font-display font-bold text-fluid-question text-foreground leading-snug">
        {question.text}
      </h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 xl:gap-4">
        {question.options.map((opt, i) => (
          <div
            key={i}
            className="flex items-center gap-3 px-4 py-3 xl:px-6 xl:py-5 rounded-xl border border-border bg-card text-left text-fluid-answer"
          >
            <span className="w-6 h-6 rounded-full border text-xs font-bold flex items-center justify-center shrink-0">
              {String.fromCharCode(65 + i)}
            </span>
            <span>{opt}</span>
          </div>
        ))}
      </div>

      <p className="text-accent font-semibold xl:text-2xl">
        {answeredCount} / {participants.length} answered
      </p>
    </div>
  )
}
