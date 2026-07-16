'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ChatPanel } from '@/components/builder/ChatPanel'
import { QuizPreview } from '@/components/builder/QuizPreview'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { QuizPayload } from '@/lib/quiz-schema'
import type { UIMsgLike } from '@/lib/chat-messages'

export default function NewQuizPage() {
  const router = useRouter()
  const [quiz, setQuiz] = useState<QuizPayload | null>(null)
  const [saving, setSaving] = useState(false)
  const [initialPrompt, setInitialPrompt] = useState<string | undefined>(undefined)
  const [activeTab, setActiveTab] = useState<'chat' | 'preview'>('chat')
  const messagesRef = useRef<UIMsgLike[]>([])
  const onMessagesChange = useCallback((m: UIMsgLike[]) => {
    messagesRef.current = m
  }, [])

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
        body: JSON.stringify({ ...quiz, isPublic, messages: messagesRef.current }),
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
    <div className="flex h-dvh flex-col lg:flex-row">
      {/* Mobile tab bar */}
      <div className="flex shrink-0 border-b-2 border-border bg-card lg:hidden">
        {(['chat', 'preview'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'flex-1 h-12 text-sm font-semibold capitalize transition-colors',
              activeTab === tab
                ? 'text-foreground border-b-2 border-primary -mb-0.5'
                : 'text-muted-foreground'
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Chat — full width on mobile (when active), 28% column on lg+ */}
      <div
        className={cn(
          'min-h-0 flex-1 lg:flex-none lg:w-[28%] lg:min-w-[280px] lg:max-w-[380px]',
          activeTab !== 'chat' && 'hidden lg:block'
        )}
      >
        <ChatPanel onQuizUpdate={setQuiz} initialPrompt={initialPrompt} onMessagesChange={onMessagesChange} />
      </div>
      {/* Preview — rest */}
      <div
        className={cn(
          'min-h-0 flex-1 overflow-hidden',
          activeTab !== 'preview' && 'hidden lg:block'
        )}
      >
        <QuizPreview quiz={quiz} onSave={handleSave} saving={saving} />
      </div>
    </div>
  )
}
