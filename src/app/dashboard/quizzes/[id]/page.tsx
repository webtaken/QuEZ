import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { db } from '@/db'
import { quizzes, questions } from '@/db/schema'
import { and, eq, asc } from 'drizzle-orm'
import { QuizEditor } from '@/components/builder/QuizEditor'
import { loadActivePath } from '@/db/chat-queries'
import { buildActivePath } from '@/lib/chat-tree'
import { dbRowToUIMessage } from '@/lib/chat-messages'

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

  const { messages: chatRows, activeLeafId } = await loadActivePath(id, session.user.id)
  const pathIds = buildActivePath(
    chatRows.map((m) => ({ id: m.id, parentId: m.parentId, createdAt: m.createdAt })),
    activeLeafId
  )
  const byId = new Map(chatRows.map((m) => [m.id, m]))
  const initialMessages = pathIds
    .map((mid) => byId.get(mid))
    .filter((m): m is (typeof chatRows)[number] => !!m)
    .map((m) => dbRowToUIMessage({ id: m.id, role: m.role, parts: m.parts }))

  return (
    <QuizEditor
      initialQuiz={quiz}
      initialQuestions={quizQuestions}
      initialMessages={initialMessages}
    />
  )
}
