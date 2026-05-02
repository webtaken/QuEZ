import { Suspense } from 'react'
import { Hero } from '@/components/landing/Hero'
import { QuizDirectory } from '@/components/landing/QuizDirectory'

async function getInitialQuizzes() {
  try {
    const { db } = await import('@/db')
    const { quizzes, questions, users } = await import('@/db/schema')
    const { eq, sql, and } = await import('drizzle-orm')

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
        questionCount:
          sql<number>`(select count(*) from ${questions} where ${questions.quizId} = ${quizzes.id})`,
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

    return { quizzes: rows, total: Number(total) }
  } catch {
    return { quizzes: [], total: 0 }
  }
}

export default async function HomePage() {
  const { quizzes, total } = await getInitialQuizzes()

  return (
    <main className="scroll-smooth">
      <Hero />
      <Suspense fallback={<DirectorySkeleton />}>
        <QuizDirectory initialQuizzes={quizzes} total={total} />
      </Suspense>
    </main>
  )
}

function DirectorySkeleton() {
  return (
    <section className="py-24 px-6">
      <div className="max-w-7xl mx-auto">
        <div className="h-10 w-72 bg-muted rounded animate-pulse mb-10" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="rounded-2xl border border-border bg-card h-64 animate-pulse"
            />
          ))}
        </div>
      </div>
    </section>
  )
}
