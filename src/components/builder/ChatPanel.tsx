'use client'

import { useRef, useEffect, useMemo, useState, KeyboardEvent } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import ReactMarkdown from 'react-markdown'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { TypingIndicator } from './TypingIndicator'
import { Send, Bot } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { QuizPayload } from '@/lib/quiz-schema'
import type { UIMsgLike } from '@/lib/chat-messages'

interface ChatPanelProps {
  onQuizUpdate: (quiz: QuizPayload) => void
  initialQuiz?: QuizPayload
  initialPrompt?: string
  quizId?: string
  initialMessages?: UIMsgLike[]
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

export function ChatPanel({ onQuizUpdate, initialQuiz, initialPrompt, quizId = 'new', initialMessages }: ChatPanelProps) {
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const quizRef = useRef<QuizPayload | undefined>(initialQuiz)

  useEffect(() => {
    quizRef.current = initialQuiz
  }, [initialQuiz])

  const leafIdRef = useRef<string | null>(
    initialMessages && initialMessages.length
      ? initialMessages[initialMessages.length - 1].id
      : null
  )

  /* eslint-disable react-hooks/refs */
  // body callback is invoked at send-time, not render-time
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/chat',
        body: () => ({
          ...(quizRef.current ? { existingQuiz: quizRef.current } : {}),
          quizId,
          parentId: leafIdRef.current,
        }),
      }),
    [quizId]
  )
  /* eslint-enable react-hooks/refs */

  const { messages, sendMessage, status, error } = useChat({
    id: quizId,
    messages: (initialMessages ?? []) as unknown as UIMessage[],
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
      console.log('[ChatPanel] onFinish — parts:', (message as unknown as { parts?: unknown[] }).parts?.length)
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

  const isLoading = status === 'submitted' || status === 'streaming'

  // Forward each completed tool-updateQuiz exactly once
  const seenToolCallsRef = useRef<Set<string>>(new Set())
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
    if (!text || isLoading) return
    console.log('[ChatPanel] submit:', text)
    setInput('')
    sendMessage({ role: 'user', parts: [{ type: 'text', text }] })
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      submit()
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
          return (
            <div
              key={msg.id}
              className={cn(
                'flex animate-fade-up',
                msg.role === 'user' ? 'justify-end' : 'justify-start'
              )}
            >
              <div
                className={cn(
                  'max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed',
                  msg.role === 'user'
                    ? 'bg-accent-lime text-accent-lime-foreground rounded-tr-sm font-medium'
                    : 'bg-secondary text-foreground rounded-tl-sm'
                )}
              >
                {msg.role === 'assistant' ? (
                  <ReactMarkdown>{text || '...'}</ReactMarkdown>
                ) : (
                  text
                )}
              </div>
            </div>
          )
        })}

        {isLoading && (
          <div className="flex justify-start animate-fade-up">
            <TypingIndicator />
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="flex-shrink-0 border-t border-border p-4">
        <div className="flex gap-2 items-end">
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
            disabled={isLoading || !input.trim()}
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
