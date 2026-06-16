'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { QuestionReview } from './QuestionReview'

type PlayQuestion = {
  id: string
  order: number
  text: string
  type: string
  options: string[]
  timeLimit: number
}

type Quiz = {
  id: string
  title: string
  topic: string
  audience: string
  difficulty: string
  coverEmoji: string
  questions: PlayQuestion[]
}

type Answer = { questionId: string; selectedIndex: number | null }

type ScoreResult = {
  score: number
  total: number
  results: {
    questionId: string
    correctIndex: number
    selected: number | null
    isCorrect: boolean
    explanation: string | null
  }[]
}

type Phase = 'playing' | 'submitting' | 'finished' | 'error'

export function QuizPlayer({ quiz }: { quiz: Quiz }) {
  const [phase, setPhase] = useState<Phase>('playing')
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Answer[]>([])
  const [timeLeft, setTimeLeft] = useState(quiz.questions[0]?.timeLimit ?? 30)
  const [locked, setLocked] = useState<number | null>(null)
  const [result, setResult] = useState<ScoreResult | null>(null)
  const [errorMsg, setErrorMsg] = useState<string>('')
  const advancingRef = useRef(false)

  const current = quiz.questions[index]
  const total = quiz.questions.length

  useEffect(() => {
    if (phase !== 'playing' || !current) return
    setTimeLeft(current.timeLimit)
    setLocked(null)
    advancingRef.current = false

    const tick = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          clearInterval(tick)
          queueAdvance(null)
          return 0
        }
        return t - 1
      })
    }, 1000)

    return () => clearInterval(tick)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, phase])

  function queueAdvance(selected: number | null) {
    if (advancingRef.current) return
    advancingRef.current = true
    const next: Answer[] = [
      ...answers,
      { questionId: current.id, selectedIndex: selected },
    ]
    setAnswers(next)
    if (index + 1 >= total) {
      submit(next)
    } else {
      window.setTimeout(() => setIndex((i) => i + 1), 300)
    }
  }

  function chooseOption(i: number) {
    if (locked !== null || advancingRef.current) return
    setLocked(i)
    window.setTimeout(() => queueAdvance(i), 350)
  }

  async function submit(finalAnswers: Answer[]) {
    setPhase('submitting')
    try {
      const res = await fetch(`/api/quizzes/${quiz.id}/score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: finalAnswers }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to score quiz')
      }
      const data = (await res.json()) as ScoreResult
      setResult(data)
      setPhase('finished')
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Failed to score quiz')
      setPhase('error')
    }
  }

  function reset() {
    setAnswers([])
    setIndex(0)
    setResult(null)
    setLocked(null)
    setErrorMsg('')
    setTimeLeft(quiz.questions[0]?.timeLimit ?? 30)
    advancingRef.current = false
    setPhase('playing')
  }

  if (phase === 'error') {
    return (
      <div className="max-w-2xl mx-auto p-6 text-center space-y-4">
        <p className="text-destructive">{errorMsg}</p>
        <div className="flex gap-3 justify-center">
          <Button onClick={reset} className="rounded-xl">
            Try again
          </Button>
          <Button
            variant="outline"
            className="rounded-xl"
            nativeButton={false}
            render={<Link href="/" />}
          >
            Back to home
          </Button>
        </div>
      </div>
    )
  }

  if (phase === 'submitting') {
    return (
      <div className="max-w-2xl mx-auto p-6 text-center">
        <p className="text-muted-foreground">Scoring...</p>
      </div>
    )
  }

  if (phase === 'finished' && result) {
    const pct = Math.round((result.score / result.total) * 100)
    return (
      <div className="max-w-3xl mx-auto px-6 space-y-8">
        <div className="text-center space-y-3 pt-6">
          <div className="text-6xl">{quiz.coverEmoji}</div>
          <h1 className="font-[family-name:var(--font-syne)] font-bold text-3xl text-foreground">
            {quiz.title}
          </h1>
          <p className="text-muted-foreground text-sm">Quiz complete</p>
          <div className="space-y-1">
            <p className="font-[family-name:var(--font-syne)] font-bold text-5xl text-accent-lime">
              {result.score} / {result.total}
            </p>
            <p className="text-muted-foreground">{pct}%</p>
          </div>
        </div>

        <div className="space-y-4">
          {quiz.questions.map((q, i) => (
            <QuestionReview
              key={q.id}
              order={q.order}
              text={q.text}
              options={q.options}
              correctIndex={result.results[i].correctIndex}
              selectedIndex={result.results[i].selected}
              explanation={result.results[i].explanation}
            />
          ))}
        </div>

        <div className="flex gap-3 justify-center pb-8">
          <Button onClick={reset} className="rounded-xl">
            Play again
          </Button>
          <Button
            variant="outline"
            className="rounded-xl"
            nativeButton={false}
            render={<Link href="/" />}
          >
            Back to home
          </Button>
        </div>
      </div>
    )
  }

  if (!current) {
    return (
      <div className="max-w-2xl mx-auto p-6 text-center">
        <p className="text-muted-foreground">No questions in this quiz.</p>
      </div>
    )
  }

  const progress = ((index + 1) / total) * 100

  return (
    <div className="max-w-2xl mx-auto px-6 space-y-6">
      <div className="space-y-2 pt-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-[family-name:var(--font-syne)] font-semibold flex items-center gap-2 truncate">
            <span className="text-2xl">{quiz.coverEmoji}</span>
            <span className="truncate">{quiz.title}</span>
          </span>
          <span className="text-muted-foreground shrink-0 ml-3">
            Q {index + 1} / {total}
          </span>
        </div>
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-accent-lime transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div
        key={current.id}
        className="rounded-2xl border border-border bg-card p-6 animate-fade-up"
      >
        <div className="flex items-start gap-3 mb-5">
          <span className="flex-shrink-0 w-8 h-8 rounded-full bg-accent-lime/20 text-accent-lime text-sm font-bold flex items-center justify-center">
            {current.order}
          </span>
          <p className="font-[family-name:var(--font-syne)] font-semibold text-lg text-foreground leading-snug flex-1">
            {current.text}
          </p>
          <Badge
            variant="secondary"
            className={cn(
              'gap-1 text-xs shrink-0 tabular-nums',
              timeLeft <= 5 && 'bg-destructive/20 text-destructive'
            )}
          >
            <Clock className="w-3 h-3" />
            {timeLeft}s
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-2">
          {current.options.map((opt, i) => {
            const isLocked = locked === i
            const dim = locked !== null && !isLocked
            return (
              <button
                key={i}
                onClick={() => chooseOption(i)}
                disabled={locked !== null}
                className={cn(
                  'flex items-center gap-3 px-4 py-3 rounded-xl border text-sm text-left transition-all',
                  isLocked
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
      </div>
    </div>
  )
}
