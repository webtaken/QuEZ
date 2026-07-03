import { db } from '@/db'
import { quizzes } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { listAttachmentKeysForQuiz } from '@/db/attachment-queries'

/**
 * Hard-delete a quiz owned by `userId`. FK ON DELETE CASCADE removes the quiz's
 * questions, chat_messages, and attachments rows. R2 objects are NOT covered by
 * the cascade, so we collect their keys before deleting and return them for the
 * caller to remove from storage.
 */
export async function deleteQuiz(
  quizId: string,
  userId: string
): Promise<{ ok: boolean; r2Keys: string[] }> {
  return db.transaction(async (tx) => {
    const [owned] = await tx
      .select({ id: quizzes.id })
      .from(quizzes)
      .where(and(eq(quizzes.id, quizId), eq(quizzes.userId, userId)))
      .limit(1)
    if (!owned) return { ok: false, r2Keys: [] }

    const r2Keys = await listAttachmentKeysForQuiz(quizId, tx)
    await tx.delete(quizzes).where(eq(quizzes.id, quizId))
    return { ok: true, r2Keys }
  })
}
