'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { newId } from '@/lib/ids'
import { validateUpload, MAX_FILES_PER_MESSAGE, type AttachmentKind } from '@/lib/attachment-kind'

export type ComposerAttachment = {
  id: string
  filename: string
  kind: AttachmentKind
  status: 'uploading' | 'ready' | 'error'
  error?: string
}

export function useAttachments(quizId?: string) {
  const [items, setItems] = useState<ComposerAttachment[]>([])
  const itemsRef = useRef<ComposerAttachment[]>([])

  useEffect(() => {
    itemsRef.current = items
  }, [items])

  const patch = useCallback((id: string, next: Partial<ComposerAttachment>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...next } : it)))
  }, [])

  const upload = useCallback(
    async (id: string, file: File) => {
      try {
        const signRes = await fetch('/api/attachments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id,
            filename: file.name,
            mimeType: file.type || 'application/octet-stream',
            sizeBytes: file.size,
            ...(quizId ? { quizId } : {}),
          }),
        })
        if (!signRes.ok) throw new Error((await signRes.json().catch(() => ({})))?.error ?? 'Upload rejected')
        const { uploadUrl } = await signRes.json()

        const putRes = await fetch(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file,
        })
        if (!putRes.ok) throw new Error('Upload failed')

        const procRes = await fetch(`/api/attachments/${id}/process`, { method: 'POST' })
        const proc = await procRes.json().catch(() => ({ status: 'error' }))
        if (proc.status !== 'ready') {
          patch(id, { status: 'error', error: proc.errorMessage ?? 'Could not process file' })
          return
        }
        patch(id, { status: 'ready' })
      } catch (e) {
        patch(id, { status: 'error', error: (e as Error).message })
      }
    },
    [quizId, patch]
  )

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files)
      const room = MAX_FILES_PER_MESSAGE - itemsRef.current.length
      for (const file of list.slice(0, Math.max(0, room))) {
        const v = validateUpload({
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
        })
        const id = newId()
        if (!v.ok) {
          setItems((prev) => [...prev, { id, filename: file.name, kind: 'text', status: 'error', error: v.error }])
          continue
        }
        setItems((prev) => [...prev, { id, filename: file.name, kind: v.kind, status: 'uploading' }])
        void upload(id, file)
      }
    },
    [upload]
  )

  const remove = useCallback((id: string) => setItems((prev) => prev.filter((it) => it.id !== id)), [])
  const clear = useCallback(() => setItems([]), [])

  const anyBusy = items.some((it) => it.status === 'uploading')
  return { items, anyBusy, addFiles, remove, clear }
}
