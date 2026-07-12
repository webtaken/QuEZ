import { notFound } from 'next/navigation'
import { db } from '@/db'
import { quizzes, questions } from '@/db/schema'
import { and, asc, eq, sql } from 'drizzle-orm'
import { QuizPlayer } from '@/components/quiz/QuizPlayer'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function PlayPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  if (!UUID_RE.test(id)) notFound()

  const [quiz] = await db
    .select()
    .from(quizzes)
    .where(and(eq(quizzes.id, id), eq(quizzes.isPublic, true)))
    .limit(1)

  if (!quiz) notFound()

  const qs = await db
    .select()
    .from(questions)
    .where(eq(questions.quizId, id))
    .orderBy(asc(questions.order))

  if (qs.length === 0) notFound()

  await db
    .update(quizzes)
    .set({ playCount: sql`${quizzes.playCount} + 1` })
    .where(eq(quizzes.id, id))

  const stripped = qs.map((q) => ({
    id: q.id,
    order: q.order,
    text: q.text,
    type: q.type,
    options: q.options,
    timeLimit: q.timeLimit,
  }))

  return (
    <main className="min-h-screen py-8">
      <QuizPlayer
        quiz={{
          id: quiz.id,
          title: quiz.title,
          topic: quiz.topic,
          audience: quiz.audience,
          difficulty: quiz.difficulty,
          coverEmoji: quiz.coverEmoji ?? '🧠',
          musicTrack: quiz.musicTrack,
          questions: stripped,
        }}
      />
    </main>
  )
}
