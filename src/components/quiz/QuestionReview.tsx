'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'

interface QuestionReviewProps {
  order: number
  text: string
  options: string[]
  correctIndex: number
  selectedIndex: number | null
  explanation: string | null
}

export function QuestionReview({
  order,
  text,
  options,
  correctIndex,
  selectedIndex,
  explanation,
}: QuestionReviewProps) {
  const [showExplanation, setShowExplanation] = useState(false)
  const wasSkipped = selectedIndex === null
  const isCorrect = !wasSkipped && selectedIndex === correctIndex

  const statusLabel = isCorrect ? '✓ Correct' : wasSkipped ? '⏱ Skipped' : '✗ Wrong'
  const statusColor = isCorrect
    ? 'text-green-500'
    : wasSkipped
      ? 'text-yellow-500'
      : 'text-red-500'

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start gap-3 mb-4">
        <span
          className={cn(
            'flex-shrink-0 w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center',
            isCorrect
              ? 'bg-green-500/20 text-green-400'
              : wasSkipped
                ? 'bg-yellow-500/20 text-yellow-400'
                : 'bg-red-500/20 text-red-400'
          )}
        >
          {order}
        </span>
        <p className="font-[family-name:var(--font-syne)] font-semibold text-foreground leading-snug flex-1">
          {text}
        </p>
        <span className={cn('shrink-0 text-xs font-medium', statusColor)}>
          {statusLabel}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-2 mb-3">
        {options.map((opt, i) => {
          const isCorrectOpt = i === correctIndex
          const isSelectedWrong = i === selectedIndex && !isCorrectOpt
          return (
            <div
              key={i}
              className={cn(
                'flex items-center gap-3 px-4 py-2.5 rounded-xl border text-sm',
                isCorrectOpt
                  ? 'border-green-500/40 bg-green-500/10 text-green-400'
                  : isSelectedWrong
                    ? 'border-red-500/40 bg-red-500/10 text-red-400'
                    : 'border-border bg-secondary/50 text-muted-foreground'
              )}
            >
              <span className="w-5 h-5 rounded-full border text-xs font-bold flex items-center justify-center shrink-0">
                {String.fromCharCode(65 + i)}
              </span>
              <span className="flex-1">{opt}</span>
              {isCorrectOpt && (
                <span className="text-xs text-green-500 font-medium shrink-0">
                  ✓ Correct
                </span>
              )}
              {isSelectedWrong && (
                <span className="text-xs text-red-500 font-medium shrink-0">
                  Your pick
                </span>
              )}
            </div>
          )
        })}
      </div>

      {explanation && (
        <button
          onClick={() => setShowExplanation((v) => !v)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {showExplanation ? (
            <ChevronUp className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
          {showExplanation ? 'Hide' : 'Show'} explanation
        </button>
      )}
      {showExplanation && explanation && (
        <p className="mt-2 text-xs text-muted-foreground bg-secondary/50 rounded-xl p-3">
          {explanation}
        </p>
      )}
    </div>
  )
}
