import { db } from '@/db'
import { chatMessages, quizzes, type ChatMessage, type NewChatMessage } from '@/db/schema'
import { and, eq } from 'drizzle-orm'

async function assertOwner(quizId: string, userId: string): Promise<boolean> {
  const [q] = await db
    .select({ id: quizzes.id })
    .from(quizzes)
    .where(and(eq(quizzes.id, quizId), eq(quizzes.userId, userId)))
    .limit(1)
  return !!q
}

export async function loadActivePath(
  quizId: string,
  userId: string
): Promise<{ messages: ChatMessage[]; activeLeafId: string | null }> {
  const [q] = await db
    .select({ id: quizzes.id, activeLeafId: quizzes.activeLeafId })
    .from(quizzes)
    .where(and(eq(quizzes.id, quizId), eq(quizzes.userId, userId)))
    .limit(1)
  if (!q) return { messages: [], activeLeafId: null }
  const messages = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.quizId, quizId))
  return { messages, activeLeafId: q.activeLeafId ?? null }
}

export async function persistTurn(args: {
  quizId: string
  userId: string
  userMessage: NewChatMessage
  assistantMessage: NewChatMessage
}): Promise<void> {
  if (!(await assertOwner(args.quizId, args.userId))) return
  await db.transaction(async (tx) => {
    await tx.insert(chatMessages).values(args.userMessage)
    await tx.insert(chatMessages).values(args.assistantMessage)
    await tx
      .update(quizzes)
      .set({ activeLeafId: args.assistantMessage.id!, updatedAt: new Date() })
      .where(eq(quizzes.id, args.quizId))
  })
}

export async function setActiveLeaf(
  quizId: string,
  userId: string,
  leafId: string
): Promise<boolean> {
  const [leaf] = await db
    .select({ id: chatMessages.id })
    .from(chatMessages)
    .where(and(eq(chatMessages.id, leafId), eq(chatMessages.quizId, quizId)))
    .limit(1)
  if (!leaf) return false
  const res = await db
    .update(quizzes)
    .set({ activeLeafId: leafId, updatedAt: new Date() })
    .where(and(eq(quizzes.id, quizId), eq(quizzes.userId, userId)))
    .returning({ id: quizzes.id })
  return res.length > 0
}

export async function deleteSubtree(
  quizId: string,
  userId: string,
  messageId: string
): Promise<{ ok: boolean; newLeafId: string | null }> {
  if (!(await assertOwner(quizId, userId))) return { ok: false, newLeafId: null }
  const [target] = await db
    .select({ id: chatMessages.id, parentId: chatMessages.parentId })
    .from(chatMessages)
    .where(and(eq(chatMessages.id, messageId), eq(chatMessages.quizId, quizId)))
    .limit(1)
  if (!target) return { ok: false, newLeafId: null }

  const [q] = await db
    .select({ activeLeafId: quizzes.activeLeafId })
    .from(quizzes)
    .where(eq(quizzes.id, quizId))
    .limit(1)

  // ON DELETE CASCADE on parent_id removes the whole subtree.
  await db.delete(chatMessages).where(eq(chatMessages.id, messageId))

  // If the active leaf was inside the deleted subtree it no longer exists;
  // reseat to the deleted node's parent (caller re-descends to a leaf client-side
  // on next load via buildActivePath/descendToLeaf).
  const remaining = await db
    .select({ id: chatMessages.id })
    .from(chatMessages)
    .where(eq(chatMessages.id, q?.activeLeafId ?? ''))
    .limit(1)
  let newLeafId = q?.activeLeafId ?? null
  if (remaining.length === 0) {
    newLeafId = target.parentId
    await db
      .update(quizzes)
      .set({ activeLeafId: newLeafId, updatedAt: new Date() })
      .where(eq(quizzes.id, quizId))
  }
  return { ok: true, newLeafId }
}
