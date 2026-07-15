'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { QuestionCard } from './QuestionCard'
import { Sparkles, Save, Globe } from 'lucide-react'
import { toast } from 'sonner'

type QuestionData = {
  order: number
  text: string
  type: 'multiple_choice' | 'true_false'
  options: string[]
  correctIndex: number
  explanation: string
  timeLimit: number
}

type QuizData = {
  title: string
  description: string
  topic: string
  audience: string
  difficulty: 'easy' | 'medium' | 'hard'
  coverEmoji: string
  questions: QuestionData[]
}

interface QuizPreviewProps {
  quiz: QuizData | null
  onSave: (isPublic: boolean) => Promise<void>
  saving: boolean
}

export function QuizPreview({ quiz, onSave, saving }: QuizPreviewProps) {
  const [questions, setQuestions] = useState<QuestionData[]>(quiz?.questions ?? [])

  // Sync when quiz updates from AI
  if (quiz && quiz.questions !== questions && quiz.questions.length !== questions.length) {
    setQuestions(quiz.questions)
  }

  const difficultyColor: Record<string, string> = {
    easy: 'bg-success/20 text-success',
    medium: 'bg-warning/20 text-warning',
    hard: 'bg-destructive/20 text-destructive',
  }

  function deleteQuestion(i: number) {
    setQuestions((prev) => {
      const next = prev.filter((_, idx) => idx !== i).map((q, idx) => ({ ...q, order: idx + 1 }))
      return next
    })
  }

  async function handleSave(isPublic: boolean) {
    if (!quiz || questions.length === 0) return
    await onSave(isPublic)
  }

  return (
    <div className="flex flex-col h-full bg-background border-l border-border">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-border px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            {quiz ? (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-2xl">{quiz.coverEmoji}</span>
                  <h2 className="font-display font-bold text-xl text-foreground truncate">
                    {quiz.title}
                  </h2>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="text-xs">
                    {quiz.topic}
                  </Badge>
                  <Badge variant="secondary" className="text-xs">
                    {quiz.audience}
                  </Badge>
                  <Badge
                    className={`text-xs border-0 ${difficultyColor[quiz.difficulty] ?? ''}`}
                  >
                    {quiz.difficulty}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {questions.length} questions
                  </span>
                </div>
              </>
            ) : (
              <div>
                <h2 className="font-display font-bold text-xl text-muted-foreground">
                  Quiz Preview
                </h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Describe your quiz in the chat →
                </p>
              </div>
            )}
          </div>

          {quiz && questions.length > 0 && (
            <div className="flex gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                className="rounded-full gap-1.5"
                onClick={() => handleSave(false)}
                disabled={saving}
              >
                <Save className="w-3.5 h-3.5" />
                Save Draft
              </Button>
              <Button
                size="sm"
                className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90 gap-1.5 font-semibold"
                onClick={() => handleSave(true)}
                disabled={saving}
              >
                <Globe className="w-3.5 h-3.5" />
                Publish
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Questions */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {questions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-20">
            <div className="w-16 h-16 rounded-2xl border-2 border-dashed border-border flex items-center justify-center mb-4">
              <Sparkles className="w-6 h-6 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground text-sm max-w-xs">
              Your quiz will appear here as you chat with the AI...
            </p>
          </div>
        ) : (
          questions.map((q, i) => (
            <QuestionCard
              key={`${q.order}-${q.text.slice(0, 20)}`}
              question={q}
              onDelete={() => deleteQuestion(i)}
            />
          ))
        )}
      </div>
    </div>
  )
}
