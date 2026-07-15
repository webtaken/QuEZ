'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useCountdown } from '@/hooks/useCountdown'
import { cn } from '@/lib/utils'
import type { GameQuestionView } from '@/hooks/useGameSocket'

// A lightweight ring built from the same accent-lime/secondary CSS custom
// properties Tailwind maps its utility classes to — not a hardcoded color,
// just read directly since conic-gradient can't take a Tailwind class.
function CountdownRing({ secondsLeft, timeLimit }: { secondsLeft: number; timeLimit: number }) {
  const pct = timeLimit > 0 ? (secondsLeft / timeLimit) * 100 : 0
  return (
    <div
      className="w-14 h-14 rounded-full flex items-center justify-center shrink-0"
      style={{ background: `conic-gradient(var(--accent-lime) ${pct}%, var(--secondary) ${pct}%)` }}
    >
      <div className="w-11 h-11 rounded-full bg-card flex items-center justify-center text-sm font-bold tabular-nums text-foreground">
        {secondsLeft}
      </div>
    </div>
  )
}

export function StudentQuestionLive({
  code,
  participantId,
  sessionToken,
  question,
  phaseStartedAt,
  currentQuestionIndex,
  onAnswered,
}: {
  code: string
  participantId: string
  sessionToken: string
  question: GameQuestionView
  phaseStartedAt: string
  currentQuestionIndex: number
  onAnswered: (index: number | null) => void
}) {
  const secondsLeft = useCountdown(phaseStartedAt, question.timeLimit)
  const [selected, setSelected] = useState<number | null>(null)
  const [answered, setAnswered] = useState(false)
  const submittedRef = useRef(false)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected(null)
    setAnswered(false)
    submittedRef.current = false
  }, [currentQuestionIndex])

  // Timer expiry auto-submits whatever is currently selected (null if
  // nothing) — a student who picked but never pressed Submit still gets
  // their pick scored, at full elapsed time.
  useEffect(() => {
    if (secondsLeft === 0 && !submittedRef.current) submit(selected)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft])

  function submit(index: number | null) {
    if (submittedRef.current) return
    submittedRef.current = true
    setSelected(index)
    setAnswered(true)
    onAnswered(index)
    fetch(`/api/games/${code}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantId, sessionToken, questionId: question.id, selectedIndex: index }),
    }).catch(() => {})
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-10 space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Question in progress</p>
        <CountdownRing secondsLeft={secondsLeft} timeLimit={question.timeLimit} />
      </div>

      <h1 className="font-[family-name:var(--font-syne)] font-bold text-xl text-foreground text-center leading-snug">
        {question.text}
      </h1>

      <div className="grid grid-cols-1 gap-2">
        {question.options.map((opt, i) => {
          const isSelected = selected === i
          const dim = answered && !isSelected
          return (
            <button
              key={i}
              onClick={() => setSelected(i)}
              disabled={answered}
              className={cn(
                'flex items-center gap-3 px-4 py-3 rounded-xl border text-sm text-left transition-all',
                isSelected
                  ? 'border-accent-lime bg-accent-lime/15 text-foreground'
                  : 'border-border bg-secondary/50 text-foreground hover:border-accent-lime/50 hover:bg-secondary',
                dim && 'opacity-40'
              )}
            >
              <span className="w-6 h-6 rounded-full border text-xs font-bold flex items-center justify-center shrink-0">
                {String.fromCharCode(65 + i)}
              </span>
              <span className="flex-1">{opt}</span>
            </button>
          )
        })}
      </div>

      {!answered && (
        <Button
          onClick={() => submit(selected)}
          disabled={selected === null}
          size="lg"
          className="w-full rounded-xl bg-accent-lime text-accent-lime-foreground hover:bg-accent-lime/90 font-semibold"
        >
          Submit answer
        </Button>
      )}

      {answered && (
        <p className="text-center text-accent-lime font-semibold text-sm">
          {selected === null ? "Time's up!" : 'Answer locked'} — waiting for the others...
        </p>
      )}
    </div>
  )
}
