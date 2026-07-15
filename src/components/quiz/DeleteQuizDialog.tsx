'use client'

import { useState } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { toast } from 'sonner'
import { Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface DeleteQuizDialogProps {
  quizId: string
  quizTitle: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after a successful delete. Caller decides what to do (refresh/redirect). */
  onDeleted: () => void
}

export function DeleteQuizDialog({
  quizId,
  quizTitle,
  open,
  onOpenChange,
  onDeleted,
}: DeleteQuizDialogProps) {
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

  const confirmed = confirmText === quizTitle

  function handleOpenChange(next: boolean) {
    if (deleting) return // don't allow closing mid-delete
    if (!next) setConfirmText('')
    onOpenChange(next)
  }

  async function handleDelete() {
    if (!confirmed || deleting) return
    setDeleting(true)
    const toastId = toast.loading('Deleting quiz...')
    try {
      const res = await fetch(`/api/quizzes/${quizId}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to delete quiz')
      }
      toast.success('Quiz deleted', { id: toastId })
      setConfirmText('')
      onOpenChange(false)
      onDeleted()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete quiz', { id: toastId })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-foreground/40 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border-2 border-border bg-card p-6 shadow-brutal-lg transition-all duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <Trash2 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <Dialog.Title className="font-display text-lg font-bold text-foreground">
                Delete quiz
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                This permanently deletes{' '}
                <span className="font-medium text-foreground">{quizTitle}</span>, its
                questions, and its chat history. This cannot be undone.
              </Dialog.Description>
            </div>
          </div>

          <label className="mt-5 block text-sm text-muted-foreground">
            Type <span className="font-medium text-foreground">{quizTitle}</span> to confirm
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              disabled={deleting}
              autoFocus
              className="mt-1.5 h-10"
              placeholder={quizTitle}
            />
          </label>

          <div className="mt-6 flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleOpenChange(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={!confirmed || deleting}
              className="gap-1.5"
            >
              {deleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Delete quiz
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
