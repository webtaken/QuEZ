import type { QuizPayload } from '@/lib/quiz-schema'
import type { NewChatMessage } from '@/db/schema'
import { isUuid } from './ids'

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

// Build the user + assistant rows for one chat turn from the SDK messages.
// Both ids must be uuids (DB schema) and stable across client render / reload,
// so we validate here instead of letting a bad id reach Postgres. The assistant
// row's parentId links to the user message, forming the conversation tree.
export function buildTurnMessages(args: {
  quizId: string
  userId: string
  parentId: string | null
  incomingUser: { id?: string; role?: string; parts?: unknown[] }
  responseMessage: { id?: string; parts?: unknown[] }
}): { userMessage: NewChatMessage; assistantMessage: NewChatMessage } {
  const userMsgId = args.incomingUser.id
  const assistantMsgId = args.responseMessage.id
  if (!isUuid(userMsgId)) {
    throw new Error(`user message id must be a uuid, got: ${String(userMsgId)}`)
  }
  if (!isUuid(assistantMsgId)) {
    throw new Error(`assistant message id must be a uuid, got: ${String(assistantMsgId)}`)
  }
  const assistantParts = args.responseMessage.parts ?? []
  const snapshot = extractQuizFromParts(assistantParts)
  return {
    userMessage: {
      id: userMsgId,
      quizId: args.quizId,
      userId: args.userId,
      role: 'user',
      parts: args.incomingUser.parts ?? [],
      parentId: args.parentId,
    },
    assistantMessage: {
      id: assistantMsgId,
      quizId: args.quizId,
      userId: args.userId,
      role: 'assistant',
      parts: assistantParts,
      parentId: userMsgId,
      quizSnapshot: snapshot ?? null,
    },
  }
}

// Persist a linear chat (the active path from the new-quiz page, which has no
// branches yet) as chat_messages rows: each message's parentId points at the
// previous one, so the editor's buildActivePath reconstructs the same order.
// active_leaf_id should be set to the last returned row's id.
export function buildChatRowsFromMessages(args: {
  quizId: string
  userId: string
  messages: { id?: string; role?: string; parts?: unknown[] }[]
}): NewChatMessage[] {
  const rows: NewChatMessage[] = []
  let parentId: string | null = null
  for (const m of args.messages) {
    if (!isUuid(m.id)) {
      throw new Error(`chat message id must be a uuid, got: ${String(m.id)}`)
    }
    const role = m.role === 'assistant' ? 'assistant' : 'user'
    const parts = m.parts ?? []
    rows.push({
      id: m.id,
      quizId: args.quizId,
      userId: args.userId,
      role,
      parts,
      parentId,
      quizSnapshot: role === 'assistant' ? (extractQuizFromParts(parts) ?? null) : null,
    })
    parentId = m.id
  }
  return rows
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
