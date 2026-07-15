import type { Metadata } from 'next'
import { Suspense } from 'react'
import { QuizDirectory } from '@/components/landing/QuizDirectory'
import { getPublicQuizzes } from '@/lib/quiz-queries'

export const metadata: Metadata = {
  title: 'Community Quizzes — QuEZ',
  description: 'Browse and play quizzes created by the QuEZ community.',
}

// Requires a live DB connection, so it must not be prerendered at build time
// (Docker builds run without DATABASE_URL).
export const dynamic = 'force-dynamic'

export default async function CommunityPage() {
  const { quizzes, total } = await getPublicQuizzes()

  return (
    <main className="px-6 pt-16">
      <div className="mx-auto max-w-7xl text-center">
        <h1 className="font-display font-bold text-4xl sm:text-5xl text-foreground">
          Community Quizzes
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
          Browse quizzes built by educators and curious minds. Play, learn, and
          get inspired.
        </p>
      </div>
      <Suspense fallback={null}>
        <QuizDirectory initialQuizzes={quizzes} total={total} showHeading={false} />
      </Suspense>
    </main>
  )
}
