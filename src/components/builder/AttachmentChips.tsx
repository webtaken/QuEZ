'use client'

import { X, FileText, Image as ImageIcon, Loader2, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AttachmentKind } from '@/lib/attachment-kind'
import type { ComposerAttachment } from './useAttachments'

function KindIcon({ kind }: { kind: string }) {
  if (kind === 'image') return <ImageIcon className="w-3.5 h-3.5" />
  return <FileText className="w-3.5 h-3.5" />
}

export function ComposerChips({
  items,
  onRemove,
}: {
  items: ComposerAttachment[]
  onRemove: (id: string) => void
}) {
  if (!items.length) return null
  return (
    <div className="flex flex-wrap gap-1.5 mb-2">
      {items.map((it) => (
        <span
          key={it.id}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs',
            it.status === 'error'
              ? 'border-destructive/40 text-destructive bg-destructive/10'
              : 'border-border text-muted-foreground bg-secondary'
          )}
          title={it.error ?? it.filename}
        >
          {it.status === 'uploading' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : it.status === 'error' ? (
            <AlertCircle className="w-3.5 h-3.5" />
          ) : (
            <KindIcon kind={it.kind} />
          )}
          <span className="max-w-[140px] truncate">{it.filename}</span>
          <button type="button" onClick={() => onRemove(it.id)} aria-label={`Remove ${it.filename}`}>
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
    </div>
  )
}

// Read-only chips rendered inside a sent message bubble from data-attachment parts.
export function MessageChips({ parts }: { parts: unknown[] }) {
  const chips = (parts ?? [])
    .map((p) => p as { type?: string; id?: string; filename?: string; kind?: AttachmentKind })
    .filter((p) => p.type === 'data-attachment' && p.filename)
  if (!chips.length) return null
  return (
    <div className="flex flex-wrap gap-1.5 mb-1.5">
      {chips.map((c, i) => (
        <span
          key={c.id ?? i}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-2 py-1 text-xs text-muted-foreground"
        >
          <KindIcon kind={c.kind ?? 'text'} />
          <span className="max-w-[140px] truncate">{c.filename}</span>
        </span>
      ))}
    </div>
  )
}
