'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ChatPanel } from '@/components/builder/ChatPanel'
import { QuizPreview } from '@/components/builder/QuizPreview'
import { toast } from 'sonner'
import type { QuizPayload } from '@/lib/quiz-schema'

export default function NewQuizPage() {
  const router = useRouter()
  const [quiz, setQuiz] = useState<QuizPayload | null>(null)
  const [saving, setSaving] = useState(false)
  const [initialPrompt, setInitialPrompt] = useState<string | undefined>(undefined)

  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get('prompt')?.trim()
    if (!p) return
    setInitialPrompt(p)
    // Strip ?prompt so a refresh does not re-trigger generation.
    router.replace('/dashboard/quizzes/new')
  }, [router])

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
        <ChatPanel onQuizUpdate={setQuiz} initialPrompt={initialPrompt} />
      </div>
      {/* Preview — rest */}
      <div className="flex-1 overflow-hidden">
        <QuizPreview quiz={quiz} onSave={handleSave} saving={saving} />
      </div>
    </div>
  )
}
