'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChatPanel } from '@/components/builder/ChatPanel'
import { QuizPreview } from '@/components/builder/QuizPreview'
import { toast } from 'sonner'

type QuizData = {
  title: string
  description: string
  topic: string
  audience: string
  difficulty: 'easy' | 'medium' | 'hard'
  coverEmoji: string
  questions: Array<{
    order: number
    text: string
    type: 'multiple_choice' | 'true_false'
    options: string[]
    correctIndex: number
    explanation: string
    timeLimit: number
  }>
}

export default function NewQuizPage() {
  const router = useRouter()
  const [quiz, setQuiz] = useState<QuizData | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSave(isPublic: boolean) {
    if (!quiz) return
    setSaving(true)
    toast.loading(isPublic ? 'Publishing quiz...' : 'Saving draft...')

    try {
      const res = await fetch('/api/quizzes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...quiz, isPublic }),
      })

      if (!res.ok) throw new Error('Failed to save quiz')

      const { id } = await res.json()
      toast.dismiss()
      toast.success(isPublic ? 'Quiz published!' : 'Draft saved!')
      router.push(`/dashboard/quizzes/${id}`)
    } catch {
      toast.dismiss()
      toast.error('Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-screen">
      {/* Chat — 28% */}
      <div className="w-[28%] min-w-[280px] max-w-[380px]">
        <ChatPanel onQuizUpdate={setQuiz} />
      </div>
      {/* Preview — rest */}
      <div className="flex-1 overflow-hidden">
        <QuizPreview quiz={quiz} onSave={handleSave} saving={saving} />
      </div>
    </div>
  )
}
