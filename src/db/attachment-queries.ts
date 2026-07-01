import { db } from '@/db'
import { attachments, type Attachment, type NewAttachment } from '@/db/schema'
import { and, eq, inArray, isNull } from 'drizzle-orm'

// Accepts the base db or a transaction handle (same query-builder surface).
type DbLike = typeof db

export async function insertAttachment(row: NewAttachment): Promise<void> {
  await db.insert(attachments).values(row)
}

export async function getOwnedAttachment(id: string, userId: string): Promise<Attachment | null> {
  const [row] = await db
    .select()
    .from(attachments)
    .where(and(eq(attachments.id, id), eq(attachments.userId, userId)))
    .limit(1)
  return row ?? null
}

export async function markAttachmentReady(
  id: string,
  extractedText: string,
  meta: Record<string, unknown>
): Promise<void> {
  await db.update(attachments).set({ status: 'ready', extractedText, meta, errorMessage: null }).where(eq(attachments.id, id))
}

export async function markAttachmentError(id: string, errorMessage: string): Promise<void> {
  await db.update(attachments).set({ status: 'error', errorMessage }).where(eq(attachments.id, id))
}

export async function loadReadyAttachments(ids: string[], userId: string): Promise<Attachment[]> {
  if (!ids.length) return []
  return db
    .select()
    .from(attachments)
    .where(and(inArray(attachments.id, ids), eq(attachments.userId, userId), eq(attachments.status, 'ready')))
}

// Re-link new-quiz attachments (quizId null) to the quiz on first save.
export async function reassociateAttachments(
  ids: string[],
  quizId: string,
  userId: string,
  tx: DbLike = db
): Promise<void> {
  if (!ids.length) return
  await tx
    .update(attachments)
    .set({ quizId })
    .where(and(inArray(attachments.id, ids), eq(attachments.userId, userId), isNull(attachments.quizId)))
}

export async function listAttachmentKeysForQuiz(quizId: string, tx: DbLike = db): Promise<string[]> {
  const rows = await tx.select({ r2Key: attachments.r2Key }).from(attachments).where(eq(attachments.quizId, quizId))
  return rows.map((r) => r.r2Key)
}
