'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Globe, Lock, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function PublishToggle({
  quizId,
  initialIsPublic,
}: {
  quizId: string
  initialIsPublic: boolean
}) {
  const router = useRouter()
  const [isPublic, setIsPublic] = useState(initialIsPublic)
  const [pending, startTransition] = useTransition()
  const [submitting, setSubmitting] = useState(false)

  async function toggle() {
    const next = !isPublic
    setSubmitting(true)
    const toastId = toast.loading(next ? 'Publishing quiz...' : 'Unpublishing quiz...')

    try {
      const res = await fetch(`/api/quizzes/${quizId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPublic: next }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to update')
      }
      setIsPublic(next)
      toast.success(next ? 'Quiz published publicly' : 'Quiz set to draft', { id: toastId })
      startTransition(() => router.refresh())
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update', { id: toastId })
    } finally {
      setSubmitting(false)
    }
  }

  const busy = submitting || pending
  const Icon = busy ? Loader2 : isPublic ? Lock : Globe

  return (
    <Button
      onClick={toggle}
      disabled={busy}
      variant={isPublic ? 'outline' : 'default'}
      size="sm"
      className="gap-2"
    >
      <Icon className={busy ? 'animate-spin' : ''} />
      {isPublic ? 'Unpublish' : 'Publish publicly'}
    </Button>
  )
}
