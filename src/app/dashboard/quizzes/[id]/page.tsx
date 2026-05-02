import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { db } from '@/db'
import { quizzes, questions } from '@/db/schema'
import { and, eq, asc } from 'drizzle-orm'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export default async function EditQuizPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const session = await auth.api.getSession({ headers: await headers() })

  const [quiz] = await db
    .select()
    .from(quizzes)
    .where(and(eq(quizzes.id, id), eq(quizzes.userId, session!.user.id)))

  if (!quiz) notFound()

  const quizQuestions = await db
    .select()
    .from(questions)
    .where(eq(questions.quizId, id))
    .orderBy(asc(questions.order))

  return (
    <div className="p-8 max-w-4xl">
      <Link href="/dashboard">
        <Button variant="ghost" className="gap-2 mb-6 -ml-2 text-muted-foreground">
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </Button>
      </Link>

      <div className="flex items-center gap-3 mb-2">
        <span className="text-4xl">{quiz.coverEmoji}</span>
        <h1 className="font-[family-name:var(--font-syne)] font-bold text-3xl text-foreground">
          {quiz.title}
        </h1>
      </div>

      <div className="flex gap-2 mb-8">
        <Badge variant="secondary">{quiz.topic}</Badge>
        <Badge variant="secondary">{quiz.audience}</Badge>
        <Badge variant="secondary">{quiz.difficulty}</Badge>
        <Badge variant={quiz.isPublic ? 'default' : 'secondary'}>
          {quiz.isPublic ? 'Public' : 'Draft'}
        </Badge>
      </div>

      <div className="space-y-4">
        {quizQuestions.map((q) => (
          <div key={q.id} className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-start gap-3 mb-3">
              <span className="w-7 h-7 rounded-full bg-[oklch(0.93_0.22_127/20%)] text-[oklch(0.93_0.22_127)] text-xs font-bold flex items-center justify-center shrink-0">
                {q.order}
              </span>
              <p className="font-[family-name:var(--font-syne)] font-semibold text-foreground">
                {q.text}
              </p>
            </div>
            <div className="space-y-2 ml-10">
              {(q.options as string[]).map((opt, i) => (
                <div
                  key={i}
                  className={`px-4 py-2 rounded-xl text-sm border ${
                    i === q.correctIndex
                      ? 'border-green-500/40 bg-green-500/10 text-green-400'
                      : 'border-border text-muted-foreground'
                  }`}
                >
                  <span className="font-bold mr-2">{String.fromCharCode(65 + i)}.</span>
                  {opt}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
