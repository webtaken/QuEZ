'use client'

import { useRef, useEffect, useMemo, useState, KeyboardEvent } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import ReactMarkdown from 'react-markdown'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { TypingIndicator } from './TypingIndicator'
import { Send, Bot, Globe, Paperclip, Plus } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import type { QuizPayload } from '@/lib/quiz-schema'
import type { UIMsgLike } from '@/lib/chat-messages'
import { collectToolCallIds, dbRowToUIMessage, extractQuizFromParts, extractSources } from '@/lib/chat-messages'
import { newId } from '@/lib/ids'
import { siblingInfo, switchSibling, buildActivePath, descendToLeaf } from '@/lib/chat-tree'
import type { TreeNode } from '@/lib/chat-tree'
import { SourceChips } from './SourceChips'
import { useAttachments } from './useAttachments'
import { ComposerChips, MessageChips } from './AttachmentChips'
import { ACCEPT_ATTR } from '@/lib/attachment-kind'

interface ChatPanelProps {
  onQuizUpdate: (quiz: QuizPayload) => void
  initialQuiz?: QuizPayload
  initialPrompt?: string
  quizId?: string
  initialMessages?: UIMsgLike[]
  initialTree?: { id: string; parentId: string | null; createdAt: string }[]
  initialRows?: { id: string; role: string; parts: unknown[]; quizSnapshot?: unknown }[]
  // Reports the current visible conversation (active path). Used by the
  // new-quiz page to persist chat history when the quiz is first saved.
  onMessagesChange?: (messages: UIMsgLike[]) => void
}

const GREETING = `Hi! I'm your QuEZ AI builder. Tell me about the quiz you want to create.

Try: *"Create a 10-question biology quiz for high school students about cell division"*`

function getTextFromMessage(message: UIMessage): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parts: any[] = (message as any).parts ?? []
  return parts
    .filter((p: { type: string }) => p.type === 'text')
    .map((p: { text: string }) => p.text)
    .join('')
}

export function ChatPanel({ onQuizUpdate, initialQuiz, initialPrompt, quizId, initialMessages, initialTree, initialRows, onMessagesChange }: ChatPanelProps) {
  const [input, setInput] = useState('')
  const attachments = useAttachments(quizId)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Start false on server and client alike; reading localStorage in the useState
  // initializer makes the first client render differ from SSR (hydration mismatch).
  const [webSearch, setWebSearch] = useState(false)
  const webSearchRef = useRef(webSearch)
  useEffect(() => {
    if (localStorage.getItem('quez-web-search') === '1') setWebSearch(true)
  }, [])
  // Keep the ref in sync with state (writes ref only — does not call setState, no cascading render).
  useEffect(() => { webSearchRef.current = webSearch }, [webSearch])
  function toggleWebSearch() {
    setWebSearch((prev) => {
      const next = !prev
      webSearchRef.current = next
      localStorage.setItem('quez-web-search', next ? '1' : '0')
      return next
    })
  }
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const quizRef = useRef<QuizPayload | undefined>(initialQuiz)

  const [tree, setTree] = useState<TreeNode[]>(() =>
    (initialTree ?? []).map((n) => ({ id: n.id, parentId: n.parentId, createdAt: new Date(n.createdAt) }))
  )
  const treeRef = useRef<TreeNode[]>(
    (initialTree ?? []).map((n) => ({ id: n.id, parentId: n.parentId, createdAt: new Date(n.createdAt) }))
  )
  const rowsRef = useRef<{ id: string; role: string; parts: unknown[]; quizSnapshot?: unknown }[]>(initialRows ?? [])

  useEffect(() => {
    quizRef.current = initialQuiz
  }, [initialQuiz])

  const initialLeafId =
    initialMessages && initialMessages.length
      ? initialMessages[initialMessages.length - 1].id
      : null

  const leafIdRef = useRef<string | null>(initialLeafId)
  const [activeLeafId, setActiveLeafId] = useState<string | null>(initialLeafId)

  /* eslint-disable react-hooks/refs */
  // body callback is invoked at send-time, not render-time
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/chat',
        body: () => ({
          ...(quizRef.current ? { existingQuiz: quizRef.current } : {}),
          ...(quizId ? { quizId, parentId: leafIdRef.current } : {}),
          webSearch: webSearchRef.current,
        }),
      }),
    [quizId]
  )
  /* eslint-enable react-hooks/refs */

  const { messages, sendMessage, setMessages, regenerate, status, error } = useChat({
    id: quizId ?? 'new',
    messages: (initialMessages ?? []) as unknown as UIMessage[],
    // User message ids land in the chat_messages.id uuid column, so generate
    // uuids client-side (the SDK default emits short non-uuid nanoids).
    generateId: newId,
    transport,
    onError: (err) => {
      console.error('[ChatPanel] useChat error raw:', err)
      console.error('[ChatPanel] err.message:', err?.message)
      console.error('[ChatPanel] err.cause:', (err as unknown as { cause?: unknown })?.cause)
      console.error('[ChatPanel] err keys:', err && Object.getOwnPropertyNames(err))
      try {
        console.error('[ChatPanel] err json:', JSON.stringify(err, Object.getOwnPropertyNames(err as object), 2))
      } catch (e) {
        console.error('[ChatPanel] err stringify failed:', e)
      }
    },
    onFinish: ({ message }) => {
      leafIdRef.current = message.id
      setActiveLeafId(message.id)
      console.log('[ChatPanel] onFinish — parts:', (message as unknown as { parts?: unknown[] }).parts?.length)
      // Reconcile tree and rowsRef for any new messages not yet tracked
      setMessages((prev) => {
        let prevId: string | null = null
        const newNodes: TreeNode[] = []
        const newRows: { id: string; role: string; parts: unknown[]; quizSnapshot?: unknown }[] = []
        const existingIds = new Set(treeRef.current.map((n) => n.id))
        const existingRowIds = new Set(rowsRef.current.map((r) => r.id))
        for (const msg of prev) {
          if (!existingIds.has(msg.id)) {
            newNodes.push({ id: msg.id, parentId: prevId, createdAt: new Date() })
          }
          if (!existingRowIds.has(msg.id)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const parts: unknown[] = (msg as any).parts ?? []
            newRows.push({
              id: msg.id,
              role: msg.role,
              parts,
              quizSnapshot: msg.role === 'assistant' ? extractQuizFromParts(parts) : null,
            })
          }
          prevId = msg.id
        }
        if (newNodes.length > 0) {
          setTree((t) => {
            const updated = [...t, ...newNodes]
            treeRef.current = updated
            return updated
          })
        }
        if (newRows.length > 0) {
          rowsRef.current = [...rowsRef.current, ...newRows]
        }
        return prev
      })
    },
  })

  // Auto-send a prompt handed in from the landing Hero, exactly once.
  const autoSentRef = useRef(false)
  useEffect(() => {
    const p = initialPrompt?.trim()
    if (!p || autoSentRef.current) return
    autoSentRef.current = true
    sendMessage({ role: 'user', parts: [{ type: 'text', text: p }] })
  }, [initialPrompt, sendMessage])

  useEffect(() => {
    console.log('[ChatPanel] status:', status, 'messages:', messages.length, 'error:', error?.message)
  }, [status, messages.length, error])

  // Report the current conversation upward (new-quiz page persists it on save).
  useEffect(() => {
    if (!onMessagesChange) return
    onMessagesChange(
      messages.map((m) => ({
        id: m.id,
        role: m.role === 'assistant' ? 'assistant' : 'user',
        parts: (m as unknown as { parts?: unknown[] }).parts ?? [],
      }))
    )
  }, [messages, onMessagesChange])

  const isLoading = status === 'submitted' || status === 'streaming'

  /* eslint-disable react-hooks/refs */
  // rowsRef is read at message-render time; keyed on messages so it recomputes when the list changes
  const versionByMsgId = useMemo(() => {
    const map = new Map<string, number>()
    let v = 0
    for (const msg of messages) {
      const row = rowsRef.current.find((r) => r.id === msg.id)
      if (msg.role === 'assistant' && row?.quizSnapshot) {
        v += 1
        map.set(msg.id, v)
      }
    }
    return map
  }, [messages])
  /* eslint-enable react-hooks/refs */

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')

  function startEdit(msgId: string, current: string) {
    setEditingId(msgId)
    setEditText(current)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditText('')
  }

  function submitEdit(msgId: string) {
    const text = editText.trim()
    if (!text || isLoading) return
    const node = treeRef.current.find((n) => n.id === msgId)
    const parentId = node?.parentId ?? null
    // Truncate the active path to the parent — the old branch stays in tree/rowsRef
    const byId = new Map(rowsRef.current.map((r) => [r.id, r]))
    const truncated = buildActivePath(treeRef.current, parentId)
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((r) => dbRowToUIMessage(r as { id: string; role: string; parts: unknown[] })) as unknown as UIMessage[]
    setMessages(truncated)
    // Point leafIdRef to the parent so the transport sends parentId = parent (sibling branch)
    leafIdRef.current = parentId
    setActiveLeafId(parentId)
    setEditingId(null)
    setEditText('')
    sendMessage({ role: 'user', parts: [{ type: 'text', text }] })
  }

  // Forward each completed tool-updateQuiz exactly once
  const seenToolCallsRef = useRef<Set<string>>(
    new Set(collectToolCallIds((initialMessages ?? []) as { parts: unknown[] }[]))
  )
  useEffect(() => {
    for (const msg of messages) {
      if (msg.role !== 'assistant') continue
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parts: any[] = (msg as any).parts ?? []
      for (const part of parts) {
        if (part.type !== 'tool-updateQuiz') continue
        if (part.state !== 'output-available') continue
        const id: string | undefined = part.toolCallId
        const key = id ?? `${msg.id}:noid`
        if (seenToolCallsRef.current.has(key)) continue
        const quiz = part.output?.quiz
        if (!quiz) continue
        seenToolCallsRef.current.add(key)
        console.log('[ChatPanel] forwarding quiz — questions:', quiz.questions?.length, 'toolCallId:', id)
        onQuizUpdate(quiz)
      }
    }
  }, [messages, onQuizUpdate])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  function submit() {
    const text = input.trim()
    if ((!text && attachments.items.length === 0) || isLoading || attachments.anyBusy) return
    const attachmentParts = attachments.items
      .filter((it) => it.status === 'ready')
      .map((it) => ({ type: 'data-attachment', id: it.id, filename: it.filename, kind: it.kind }))
    const parts = [...(text ? [{ type: 'text', text }] : []), ...attachmentParts]
    setInput('')
    attachments.clear()
    // Data parts are UI-only (data-*); the extracted text is injected server-side.
    sendMessage({ role: 'user', parts } as unknown as Parameters<typeof sendMessage>[0])
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      submit()
    }
  }

  async function onSwitch(forkChildId: string, dir: -1 | 1) {
    if (!quizId) return
    const newLeaf = switchSibling(treeRef.current, forkChildId, dir, leafIdRef.current ?? forkChildId)
    if (!newLeaf) return
    const res = await fetch(`/api/quizzes/${quizId}/active-leaf`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leafId: newLeaf }),
    })
    if (!res.ok) return
    leafIdRef.current = newLeaf
    setActiveLeafId(newLeaf)
    const pathIds = buildActivePath(treeRef.current, newLeaf)
    const byId = new Map(rowsRef.current.map((r) => [r.id, r]))
    setMessages(
      pathIds
        .map((id) => byId.get(id))
        .filter(Boolean)
        .map((r) => dbRowToUIMessage(r as { id: string; role: string; parts: unknown[] })) as unknown as UIMessage[]
    )
  }

  async function onDelete(msgId: string) {
    if (isLoading) return
    if (!quizId) return
    const res = await fetch(`/api/quizzes/${quizId}/messages/${msgId}`, { method: 'DELETE' })
    if (!res.ok) return
    const { newLeafId }: { newLeafId: string | null } = await res.json()
    // Collect the removed subtree id set using the freshest tree ref
    const removed = new Set<string>()
    const collect = (rootId: string) => {
      removed.add(rootId)
      for (const child of treeRef.current.filter((n) => n.parentId === rootId)) collect(child.id)
    }
    collect(msgId)
    // Update both state and ref together
    const nextTree = treeRef.current.filter((n) => !removed.has(n.id))
    setTree(nextTree)
    treeRef.current = nextTree
    rowsRef.current = rowsRef.current.filter((r) => !removed.has(r.id))
    // Descend from the server-reseated parent to a leaf
    const leaf = newLeafId ? descendToLeaf(nextTree, newLeafId) : null
    leafIdRef.current = leaf
    setActiveLeafId(leaf)
    // Rebuild the visible path
    const byId = new Map(rowsRef.current.map((r) => [r.id, r]))
    setMessages(
      buildActivePath(nextTree, leaf)
        .map((id) => byId.get(id))
        .filter(Boolean)
        .map((r) => dbRowToUIMessage(r as { id: string; role: string; parts: unknown[] })) as unknown as UIMessage[]
    )
    // Persist the descended leaf so refresh matches the view
    if (leaf && leaf !== newLeafId) {
      await fetch(`/api/quizzes/${quizId}/active-leaf`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leafId: leaf }),
      })
    }
  }

  return (
    <div className="flex flex-col h-full bg-card border-r border-border">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-border px-5 py-4 flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-accent-lime/20 flex items-center justify-center">
          <Bot className="w-4 h-4 text-accent-lime" />
        </div>
        <div>
          <p className="font-semibold text-sm text-foreground">QuEZ AI</p>
          <p className="text-xs text-muted-foreground">Describe your quiz</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Greeting */}
        <div className="flex justify-start">
          <div className="max-w-[85%] px-4 py-3 rounded-2xl rounded-tl-sm bg-secondary text-sm text-foreground leading-relaxed">
            <ReactMarkdown>{GREETING}</ReactMarkdown>
          </div>
        </div>

        {messages.map((msg) => {
          const text = getTextFromMessage(msg)
          if (!text && msg.role === 'assistant') return null
          const info = siblingInfo(tree, msg.id, activeLeafId ?? msg.id)
          const isEditing = editingId === msg.id
          return (
            <div
              key={msg.id}
              className={cn(
                'group flex flex-col animate-fade-up',
                msg.role === 'user' ? 'items-end' : 'items-start'
              )}
            >
              {msg.role === 'user' && isEditing ? (
                <div className="w-[85%] space-y-2">
                  <Textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    className="text-sm"
                    rows={3}
                  />
                  <div className="flex gap-2 justify-end">
                    <Button size="sm" variant="ghost" onClick={cancelEdit}>Cancel</Button>
                    <Button
                      size="sm"
                      onClick={() => submitEdit(msg.id)}
                      disabled={!editText.trim() || isLoading}
                    >
                      Save &amp; rerun
                    </Button>
                  </div>
                </div>
              ) : (
                <div
                  className={cn(
                    'max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed',
                    msg.role === 'user'
                      ? 'bg-accent-lime text-accent-lime-foreground rounded-tr-sm font-medium'
                      : 'bg-secondary text-foreground rounded-tl-sm'
                  )}
                >
                  {msg.role === 'user' && (
                    <MessageChips parts={(msg as unknown as { parts?: unknown[] }).parts ?? []} />
                  )}
                  {msg.role === 'assistant' ? (
                    <ReactMarkdown>{text || '...'}</ReactMarkdown>
                  ) : (
                    text
                  )}
                </div>
              )}
              {msg.role === 'assistant' &&
                (() => {
                  const sources = extractSources(
                    (msg as unknown as { parts?: unknown[] }).parts ?? []
                  )
                  return sources.length ? <SourceChips sources={sources} /> : null
                })()}
              {!isEditing && (
                <>
                {(() => {
                  const n = tree.find((x) => x.id === msg.id)
                  if (!n) return null
                  return (
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {n.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  )
                })()}
                <div className={cn(
                  'flex items-center gap-2 mt-1',
                  msg.role === 'user' ? 'justify-end' : 'justify-start'
                )}>
                  {info.count >= 2 && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <button
                        aria-label="Previous version"
                        className="px-1 disabled:opacity-30"
                        disabled={info.index <= 0}
                        onClick={() => onSwitch(msg.id, -1)}
                      >&#8249;</button>
                      <span>{info.index + 1}/{info.count}</span>
                      <button
                        aria-label="Next version"
                        className="px-1 disabled:opacity-30"
                        disabled={info.index >= info.count - 1}
                        onClick={() => onSwitch(msg.id, 1)}
                      >&#8250;</button>
                    </div>
                  )}
                  {msg.role === 'user' && (
                    <button
                      className="opacity-0 group-hover:opacity-100 text-xs text-muted-foreground transition-opacity"
                      onClick={() => startEdit(msg.id, text)}
                      disabled={isLoading}
                    >
                      Edit
                    </button>
                  )}
                  {msg.role === 'assistant' && (
                    <button
                      className="opacity-0 group-hover:opacity-100 text-xs text-muted-foreground transition-opacity"
                      onClick={() => regenerate({ messageId: msg.id })}
                      disabled={isLoading}
                    >
                      Regenerate
                    </button>
                  )}
                  <button
                    className="opacity-0 group-hover:opacity-100 text-xs text-muted-foreground transition-opacity"
                    onClick={() => navigator.clipboard.writeText(getTextFromMessage(msg))}
                  >
                    Copy
                  </button>
                  <button
                    className="opacity-0 group-hover:opacity-100 text-xs text-destructive transition-opacity"
                    onClick={() => onDelete(msg.id)}
                    disabled={isLoading}
                  >
                    Delete
                  </button>
                </div>
                {versionByMsgId.has(msg.id) && (
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
                      v{versionByMsgId.get(msg.id)}
                    </span>
                    <button
                      className="text-xs text-accent-lime"
                      onClick={() => {
                        const row = rowsRef.current.find((r) => r.id === msg.id)
                        if (row?.quizSnapshot) onQuizUpdate(row.quizSnapshot as QuizPayload)
                      }}
                    >
                      Restore this version
                    </button>
                  </div>
                )}
                </>
              )}
            </div>
          )
        })}

        {isLoading && (
          <div className="flex justify-start animate-fade-up">
            <TypingIndicator />
          </div>
        )}

        {status === 'error' && (
          <div className="flex justify-start">
            <Button size="sm" variant="outline" onClick={() => regenerate()}>
              Retry
            </Button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div
        className="flex-shrink-0 border-t border-border p-4"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          if (e.dataTransfer.files?.length) attachments.addFiles(e.dataTransfer.files)
        }}
      >
        <ComposerChips items={attachments.items} onRemove={attachments.remove} />
        <div className="flex gap-2 items-end">
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT_ATTR}
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) attachments.addFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  title="Add files and tools"
                  className={cn(
                    'shrink-0 w-11 h-11 border border-border',
                    webSearch
                      ? 'text-accent-lime bg-accent-lime/15 border-accent-lime/40'
                      : 'text-muted-foreground'
                  )}
                >
                  <Plus className="w-4 h-4" />
                </Button>
              }
            />
            <DropdownMenuContent side="top" align="start" className="min-w-44">
              <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                <Paperclip /> Add files
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem checked={webSearch} onCheckedChange={toggleWebSearch}>
                <Globe /> Web search
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Describe your quiz..."
            className="min-h-[44px] max-h-32 resize-none bg-background border-border text-sm"
            rows={1}
          />
          <Button
            onClick={submit}
            size="icon"
            disabled={isLoading || attachments.anyBusy || (!input.trim() && attachments.items.filter((i) => i.status === 'ready').length === 0)}
            className="shrink-0 bg-accent-lime text-accent-lime-foreground hover:bg-accent-lime/90 w-11 h-11"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-1.5 text-center">⌘+Enter to send</p>
      </div>
    </div>
  )
}
