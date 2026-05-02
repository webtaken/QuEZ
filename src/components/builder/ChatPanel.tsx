'use client'

import { useRef, useEffect, useState, KeyboardEvent } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import ReactMarkdown from 'react-markdown'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { TypingIndicator } from './TypingIndicator'
import { Send, Bot } from 'lucide-react'
import { cn } from '@/lib/utils'

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

interface ChatPanelProps {
  onQuizUpdate: (quiz: QuizData) => void
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

export function ChatPanel({ onQuizUpdate }: ChatPanelProps) {
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
  })

  const isLoading = status === 'submitted' || status === 'streaming'

  // Watch messages for completed tool invocations
  useEffect(() => {
    if (status !== 'ready') return
    const last = messages[messages.length - 1]
    if (!last || last.role !== 'assistant') return

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parts: any[] = (last as any).parts ?? []
    for (const part of parts) {
      if (
        part.type === 'tool-invocation' &&
        part.toolInvocation?.toolName === 'updateQuiz' &&
        part.toolInvocation?.state === 'result'
      ) {
        onQuizUpdate(part.toolInvocation.output?.quiz ?? part.toolInvocation.result?.quiz)
      }
    }
  }, [messages, status, onQuizUpdate])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  function submit() {
    const text = input.trim()
    if (!text || isLoading) return
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
        <div className="w-8 h-8 rounded-full bg-[oklch(0.93_0.22_127/20%)] flex items-center justify-center">
          <Bot className="w-4 h-4 text-[oklch(0.93_0.22_127)]" />
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
                    ? 'bg-[oklch(0.93_0.22_127)] text-[oklch(0.13_0.03_264)] rounded-tr-sm font-medium'
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
            className="shrink-0 bg-[oklch(0.93_0.22_127)] text-[oklch(0.13_0.03_264)] hover:bg-[oklch(0.88_0.22_127)] w-11 h-11"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-1.5 text-center">⌘+Enter to send</p>
      </div>
    </div>
  )
}
