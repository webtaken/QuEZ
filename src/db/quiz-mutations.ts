import { db } from '@/db'
import { quizzes } from '@/db/schema'
import { and, eq } from 'drizzle-orm'

/**
 * Hard-delete a quiz owned by `userId`. FK ON DELETE CASCADE removes the
 * quiz's questions and chat_messages automatically (see src/db/schema.ts).
 * Returns { ok: false } when the quiz does not exist or is not owned by the
 * user — callers map this to a 404.
 */
export async function deleteQuiz(
  quizId: string,
  userId: string
): Promise<{ ok: boolean }> {
  const rows = await db
    .delete(quizzes)
    .where(and(eq(quizzes.id, quizId), eq(quizzes.userId, userId)))
    .returning({ id: quizzes.id })
  return { ok: rows.length > 0 }
}
