import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { db } from '@/db'
import { quizzes, questions } from '@/db/schema'
import { and, eq, asc } from 'drizzle-orm'
import { QuizEditor } from '@/components/builder/QuizEditor'

export default async function EditQuizPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) notFound()

  const [quiz] = await db
    .select()
    .from(quizzes)
    .where(and(eq(quizzes.id, id), eq(quizzes.userId, session.user.id)))

  if (!quiz) notFound()

  const quizQuestions = await db
    .select()
    .from(questions)
    .where(eq(questions.quizId, id))
    .orderBy(asc(questions.order))

  return <QuizEditor initialQuiz={quiz} initialQuestions={quizQuestions} />
}
