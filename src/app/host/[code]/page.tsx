import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { getGameByCode } from '@/db/game-queries'
import { db } from '@/db'
import { quizzes } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { HostGameView } from '@/components/game/HostGameView'

export default async function HostPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) notFound()

  const game = await getGameByCode(code)
  if (!game || game.hostUserId !== session.user.id) notFound()

  const [quiz] = await db
    .select({ title: quizzes.title, coverEmoji: quizzes.coverEmoji })
    .from(quizzes)
    .where(eq(quizzes.id, game.quizId))
    .limit(1)
  if (!quiz) notFound()

  return <HostGameView code={code} quizTitle={quiz.title} coverEmoji={quiz.coverEmoji ?? '🧠'} />
}
