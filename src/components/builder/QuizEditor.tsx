'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Save, Plus, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ChatPanel } from './ChatPanel'
import { QuestionEditor } from './QuestionEditor'
import { PublishToggle } from '@/components/quiz/PublishToggle'
import { quizPayloadSchema, type QuizPayload, type QuizQuestion } from '@/lib/quiz-schema'
import type { Quiz, Question } from '@/db/schema'
import type { UIMsgLike } from '@/lib/chat-messages'

interface QuizEditorProps {
  initialQuiz: Quiz
  initialQuestions: Question[]
  initialMessages?: UIMsgLike[]
  initialTree?: { id: string; parentId: string | null; createdAt: string }[]
  initialRows?: { id: string; role: string; parts: unknown[] }[]
}

function blankQuestion(order: number): QuizQuestion {
  return {
    order,
    text: '',
    type: 'multiple_choice',
    options: ['', '', '', ''],
    correctIndex: 0,
    explanation: '',
    timeLimit: 30,
  }
}

function toPayload(q: Quiz, qs: Question[]): QuizPayload {
  return {
    title: q.title,
    description: q.description ?? '',
    topic: q.topic,
    audience: q.audience,
    difficulty: (q.difficulty as QuizPayload['difficulty']) ?? 'medium',
    coverEmoji: q.coverEmoji ?? '🧠',
    questions: qs.map((row, i) => ({
      order: i + 1,
      text: row.text,
      type: (row.type as QuizQuestion['type']) ?? 'multiple_choice',
      options: row.options as string[],
      correctIndex: row.correctIndex,
      explanation: row.explanation ?? '',
      timeLimit: row.timeLimit,
    })),
  }
}

export function QuizEditor({ initialQuiz, initialQuestions, initialMessages, initialTree, initialRows }: QuizEditorProps) {
  const router = useRouter()
  const [quiz, setQuiz] = useState<QuizPayload>(() => toPayload(initialQuiz, initialQuestions))
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!dirty) return
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  function setField<K extends keyof QuizPayload>(key: K, value: QuizPayload[K]) {
    setQuiz((prev) => ({ ...prev, [key]: value }))
    setDirty(true)
  }

  const handleAgentUpdate = useCallback((next: QuizPayload) => {
    setQuiz({
      ...next,
      questions: next.questions.map((q, i) => ({ ...q, order: i + 1 })),
    })
    setDirty(true)
  }, [])

  function updateQuestion(i: number, next: QuizQuestion) {
    setQuiz((prev) => ({
      ...prev,
      questions: prev.questions.map((q, idx) => (idx === i ? { ...next, order: i + 1 } : q)),
    }))
    setDirty(true)
  }

  function deleteQuestion(i: number) {
    setQuiz((prev) => ({
      ...prev,
      questions: prev.questions
        .filter((_, idx) => idx !== i)
        .map((q, idx) => ({ ...q, order: idx + 1 })),
    }))
    setDirty(true)
  }

  function moveQuestion(i: number, dir: -1 | 1) {
    const j = i + dir
    setQuiz((prev) => {
      if (j < 0 || j >= prev.questions.length) return prev
      const next = [...prev.questions]
      ;[next[i], next[j]] = [next[j], next[i]]
      return { ...prev, questions: next.map((q, idx) => ({ ...q, order: idx + 1 })) }
    })
    setDirty(true)
  }

  function addQuestion() {
    setQuiz((prev) => ({
      ...prev,
      questions: [...prev.questions, blankQuestion(prev.questions.length + 1)],
    }))
    setDirty(true)
  }

  async function handleSave() {
    const validation = quizPayloadSchema.safeParse(quiz)
    if (!validation.success) {
      const issue = validation.error.issues[0]
      toast.error(`Fix: ${issue.path.join('.') || 'quiz'} — ${issue.message}`)
      return
    }
    for (const q of quiz.questions) {
      if (q.correctIndex >= q.options.length) {
        toast.error(`Question ${q.order}: select a correct answer that exists in options`)
        return
      }
    }

    setSaving(true)
    const toastId = toast.loading('Saving...')
    try {
      const res = await fetch(`/api/quizzes/${initialQuiz.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(quiz),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to save')
      }
      toast.success('Saved', { id: toastId })
      setDirty(false)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save', { id: toastId })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-screen">
      {/* Chat — 28% */}
      <div className="w-[28%] min-w-[280px] max-w-[380px]">
        <ChatPanel
          onQuizUpdate={handleAgentUpdate}
          initialQuiz={quiz}
          quizId={initialQuiz.id}
          initialMessages={initialMessages}
          initialTree={initialTree}
          initialRows={initialRows}
        />
      </div>

      {/* Editor — rest */}
      <div className="flex-1 overflow-y-auto bg-background">
        {/* Header */}
        <div className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur px-6 py-4">
          <div className="flex items-center gap-3">
            <Input
              value={quiz.coverEmoji}
              onChange={(e) => setField('coverEmoji', e.target.value)}
              maxLength={4}
              className="w-14 h-12 text-center text-2xl shrink-0"
              aria-label="Cover emoji"
            />
            <Input
              value={quiz.title}
              onChange={(e) => setField('title', e.target.value)}
              placeholder="Quiz title"
              className="font-[family-name:var(--font-syne)] font-bold text-xl h-12"
            />
            <div className="flex items-center gap-2 shrink-0">
              <PublishToggle quizId={initialQuiz.id} initialIsPublic={initialQuiz.isPublic} />
              <Button
                onClick={handleSave}
                disabled={saving || !dirty}
                size="sm"
                className="gap-1.5 rounded-full bg-accent-lime text-accent-lime-foreground hover:bg-accent-lime/90 font-semibold"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                {dirty ? 'Save changes' : 'Saved'}
              </Button>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6 max-w-3xl mx-auto">
          {/* Metadata */}
          <section className="rounded-2xl border border-border bg-card p-5 space-y-4">
            <h2 className="font-semibold text-sm text-foreground">Quiz details</h2>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Description</label>
              <Textarea
                value={quiz.description}
                onChange={(e) => setField('description', e.target.value)}
                placeholder="Short description"
                rows={2}
                className="resize-none"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Topic</label>
                <Input
                  value={quiz.topic}
                  onChange={(e) => setField('topic', e.target.value)}
                  placeholder="e.g. Biology"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Audience</label>
                <Input
                  value={quiz.audience}
                  onChange={(e) => setField('audience', e.target.value)}
                  placeholder="e.g. High School"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Difficulty</label>
                <select
                  value={quiz.difficulty}
                  onChange={(e) =>
                    setField('difficulty', e.target.value as QuizPayload['difficulty'])
                  }
                  className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                >
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                </select>
              </div>
            </div>
          </section>

          {/* Questions */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-sm text-foreground">
                Questions ({quiz.questions.length})
              </h2>
            </div>

            {quiz.questions.map((q, i) => (
              <QuestionEditor
                key={i}
                question={q}
                index={i}
                total={quiz.questions.length}
                onChange={(next) => updateQuestion(i, next)}
                onDelete={() => deleteQuestion(i)}
                onMoveUp={() => moveQuestion(i, -1)}
                onMoveDown={() => moveQuestion(i, 1)}
              />
            ))}

            <Button
              variant="outline"
              onClick={addQuestion}
              className="w-full gap-2 rounded-2xl border-dashed h-12"
            >
              <Plus className="w-4 h-4" />
              Add question
            </Button>
          </section>
        </div>
      </div>
    </div>
  )
}
