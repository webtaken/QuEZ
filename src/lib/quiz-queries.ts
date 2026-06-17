import { db } from '@/db'
import { quizzes, questions, users } from '@/db/schema'
import { eq, sql, and } from 'drizzle-orm'

export type PublicQuiz = {
  id: string
  title: string
  description: string | null
  topic: string
  audience: string
  difficulty: string
  language: string
  coverEmoji: string
  playCount: number
  authorName: string
  authorImage: string | null
  questionCount: number
}

/**
 * Public, published quizzes for the landing + community pages.
 * Swallows DB errors so the page still renders if the DB is unavailable.
 */
export async function getPublicQuizzes(): Promise<{
  quizzes: PublicQuiz[]
  total: number
}> {
  try {
    const rows = await db
      .select({
        id: quizzes.id,
        title: quizzes.title,
        description: quizzes.description,
        topic: quizzes.topic,
        audience: quizzes.audience,
        difficulty: quizzes.difficulty,
        language: quizzes.language,
        coverEmoji: sql<string>`coalesce(${quizzes.coverEmoji}, '🧠')`,
        playCount: quizzes.playCount,
        authorName: users.name,
        authorImage: users.image,
        questionCount: sql<number>`(select count(*) from ${questions} where ${questions.quizId} = ${quizzes.id})`,
      })
      .from(quizzes)
      .innerJoin(users, eq(quizzes.userId, users.id))
      .where(and(eq(quizzes.isPublic, true)))
      .orderBy(sql`${quizzes.playCount} DESC`)
      .limit(12)

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)` })
      .from(quizzes)
      .where(eq(quizzes.isPublic, true))

    return { quizzes: rows as PublicQuiz[], total: Number(total) }
  } catch {
    return { quizzes: [], total: 0 }
  }
}
