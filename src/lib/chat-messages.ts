import type { QuizPayload } from '@/lib/quiz-schema'

export type UIMsgLike = { id: string; role: 'user' | 'assistant'; parts: unknown[] }

export function dbRowToUIMessage(row: {
  id: string
  role: string
  parts: unknown[]
}): UIMsgLike {
  return {
    id: row.id,
    role: row.role === 'assistant' ? 'assistant' : 'user',
    parts: row.parts ?? [],
  }
}

export function extractQuizFromParts(parts: unknown[]): QuizPayload | null {
  for (const part of parts ?? []) {
    const p = part as {
      type?: string
      state?: string
      output?: { quiz?: QuizPayload }
    }
    if (p.type === 'tool-updateQuiz' && p.state === 'output-available' && p.output?.quiz) {
      return p.output.quiz
    }
  }
  return null
}

export function collectToolCallIds(messages: { parts: unknown[] }[]): string[] {
  const ids: string[] = []
  for (const msg of messages) {
    for (const part of msg.parts ?? []) {
      const p = part as { type?: string; toolCallId?: string }
      if (p.type === 'tool-updateQuiz' && p.toolCallId) ids.push(p.toolCallId)
    }
  }
  return ids
}
