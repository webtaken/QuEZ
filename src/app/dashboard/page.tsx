import { headers } from 'next/headers'
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { db } from '@/db'
import { quizzes, questions } from '@/db/schema'
import { eq, sql, count } from 'drizzle-orm'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Sparkles, BookOpen, Gamepad2, Globe, Plus, Edit, Trash2 } from 'lucide-react'
import { formatDistanceToNow } from '@/lib/date'

export default async function DashboardPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  const userId = session!.user.id

  const userQuizzes = await db
    .select({
      id: quizzes.id,
      title: quizzes.title,
      topic: quizzes.topic,
      audience: quizzes.audience,
      difficulty: quizzes.difficulty,
      isPublic: quizzes.isPublic,
      coverEmoji: quizzes.coverEmoji,
      playCount: quizzes.playCount,
      createdAt: quizzes.createdAt,
      questionCount: sql<number>`(select count(*) from ${questions} where ${questions.quizId} = ${quizzes.id})`,
    })
    .from(quizzes)
    .where(eq(quizzes.userId, userId))
    .orderBy(sql`${quizzes.createdAt} DESC`)

  const totalQuestions = userQuizzes.reduce((s, q) => s + Number(q.questionCount), 0)
  const totalPlays = userQuizzes.reduce((s, q) => s + q.playCount, 0)
  const publicCount = userQuizzes.filter((q) => q.isPublic).length

  if (userQuizzes.length === 0) {
    return <EmptyDashboard />
  }

  return (
    <div className="p-8 max-w-6xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-[family-name:var(--font-syne)] font-bold text-3xl text-foreground">
            My Dashboard
          </h1>
          <p className="text-muted-foreground mt-1">Manage your quizzes and track performance</p>
        </div>
        <Link href="/dashboard/quizzes/new">
          <Button className="bg-accent-lime text-accent-lime-foreground rounded-full gap-2 font-semibold">
            <Sparkles className="w-4 h-4" />
            New Quiz
          </Button>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        {[
          { label: 'Total Quizzes', value: userQuizzes.length, icon: BookOpen },
          { label: 'Total Questions', value: totalQuestions, icon: BookOpen },
          { label: 'Total Plays', value: totalPlays.toLocaleString(), icon: Gamepad2 },
          { label: 'Public Quizzes', value: publicCount, icon: Globe },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border border-border bg-card p-5">
            <p className="text-xs text-muted-foreground mb-1">{s.label}</p>
            <p className="font-[family-name:var(--font-syne)] font-bold text-2xl text-foreground">
              {s.value}
            </p>
          </div>
        ))}
      </div>

      {/* Quiz list */}
      <div className="space-y-3">
        {userQuizzes.map((quiz) => (
          <div
            key={quiz.id}
            className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4 hover:border-accent-lime/30 transition-colors"
          >
            <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center text-2xl shrink-0">
              {quiz.coverEmoji}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-[family-name:var(--font-syne)] font-semibold text-foreground truncate">
                {quiz.title}
              </p>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <Badge variant="secondary" className="text-xs">
                  {quiz.topic}
                </Badge>
                <Badge variant="secondary" className="text-xs">
                  {quiz.audience}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {quiz.questionCount} questions
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatDistanceToNow(quiz.createdAt)}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge
                variant={quiz.isPublic ? 'default' : 'secondary'}
                className={
                  quiz.isPublic
                    ? 'bg-accent-lime/20 text-accent-lime border-accent-lime/30'
                    : ''
                }
              >
                {quiz.isPublic ? 'Public' : 'Draft'}
              </Badge>
              <Link href={`/dashboard/quizzes/${quiz.id}`}>
                <Button variant="ghost" size="icon" className="w-8 h-8">
                  <Edit className="w-3.5 h-3.5" />
                </Button>
              </Link>
            </div>
          </div>
        ))}
      </div>

      {/* FAB */}
      <Link href="/dashboard/quizzes/new">
        <button className="fixed bottom-8 right-8 flex items-center gap-2 bg-accent-lime text-accent-lime-foreground rounded-full px-5 h-12 font-semibold shadow-lg shadow-accent-lime/30 hover:bg-accent-lime/90 transition-colors">
          <Plus className="w-4 h-4" />
          New Quiz
        </button>
      </Link>
    </div>
  )
}

function EmptyDashboard() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-8 text-center">
      <div className="text-7xl mb-6 animate-bounce">🧠</div>
      <h2 className="font-[family-name:var(--font-syne)] font-bold text-3xl text-foreground mb-3">
        You haven&apos;t created any quizzes yet
      </h2>
      <p className="text-muted-foreground mb-8 max-w-sm">
        Use the AI quiz builder to generate your first quiz in seconds.
      </p>
      <Link href="/dashboard/quizzes/new">
        <Button className="bg-accent-lime text-accent-lime-foreground rounded-full px-8 h-12 font-semibold gap-2 text-base shadow-lg shadow-accent-lime/20">
          <Sparkles className="w-5 h-5" />
          Create My First Quiz
        </Button>
      </Link>
    </div>
  )
}
