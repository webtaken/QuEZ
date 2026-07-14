import { Suspense } from 'react'
import { Hero } from '@/components/landing/Hero'
import { QuizDirectory } from '@/components/landing/QuizDirectory'
import { getPublicQuizzes } from '@/lib/quiz-queries'

// Requires a live DB connection, so it must not be prerendered at build time
// (Docker builds run without DATABASE_URL).
export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const { quizzes, total } = await getPublicQuizzes()

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
