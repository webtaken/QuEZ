'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ChevronDown, ChevronUp, Clock, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'

type QuestionData = {
  order: number
  text: string
  type: 'multiple_choice' | 'true_false'
  options: string[]
  correctIndex: number
  explanation: string
  timeLimit: number
}

interface QuestionCardProps {
  question: QuestionData
  onDelete?: () => void
}

export function QuestionCard({ question, onDelete }: QuestionCardProps) {
  const [showExplanation, setShowExplanation] = useState(false)

  return (
    <div className="rounded-2xl border border-border bg-card p-5 animate-fade-up">
      <div className="flex items-start gap-3 mb-4">
        <span className="flex-shrink-0 w-7 h-7 rounded-full bg-[oklch(0.93_0.22_127/20%)] text-[oklch(0.93_0.22_127)] text-xs font-bold flex items-center justify-center">
          {question.order}
        </span>
        <p className="font-[family-name:var(--font-syne)] font-semibold text-foreground leading-snug flex-1">
          {question.text}
        </p>
        <div className="flex items-center gap-1 shrink-0">
          <Badge variant="secondary" className="gap-1 text-xs">
            <Clock className="w-3 h-3" />
            {question.timeLimit}s
          </Badge>
          {onDelete && (
            <Button
              variant="ghost"
              size="icon"
              className="w-7 h-7 text-muted-foreground hover:text-destructive"
              onClick={onDelete}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Options */}
      <div className="grid grid-cols-1 gap-2 mb-3">
        {question.options.map((opt, i) => (
          <div
            key={i}
            className={cn(
              'flex items-center gap-3 px-4 py-2.5 rounded-xl border text-sm transition-colors',
              i === question.correctIndex
                ? 'border-green-500/40 bg-green-500/10 text-green-400'
                : 'border-border bg-secondary/50 text-muted-foreground'
            )}
          >
            <span className="w-5 h-5 rounded-full border text-xs font-bold flex items-center justify-center shrink-0">
              {String.fromCharCode(65 + i)}
            </span>
            {opt}
            {i === question.correctIndex && (
              <span className="ml-auto text-xs text-green-500 font-medium">✓ Correct</span>
            )}
          </div>
        ))}
      </div>

      {/* Explanation */}
      {question.explanation && (
        <button
          onClick={() => setShowExplanation((v) => !v)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {showExplanation ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          {showExplanation ? 'Hide' : 'Show'} explanation
        </button>
      )}
      {showExplanation && question.explanation && (
        <p className="mt-2 text-xs text-muted-foreground bg-secondary/50 rounded-xl p-3">
          {question.explanation}
        </p>
      )}
    </div>
  )
}
