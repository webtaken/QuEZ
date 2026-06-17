import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Blog — QuEZ',
  description: 'Tips, product updates, and ideas for better quizzes from QuEZ.',
}

type Post = {
  emoji: string
  category: string
  title: string
  excerpt: string
  date: string
}

const POSTS: Post[] = [
  {
    emoji: '🚀',
    category: 'Product',
    title: 'Introducing AI-Powered Quiz Building',
    excerpt:
      'Describe your quiz in plain language and watch QuEZ assemble questions, answers, and explanations in seconds.',
    date: 'Jun 10, 2026',
  },
  {
    emoji: '🎯',
    category: 'Teaching',
    title: '5 Ways to Write Questions That Actually Test Understanding',
    excerpt:
      'Move beyond recall. Practical patterns for writing questions that measure real comprehension.',
    date: 'May 28, 2026',
  },
  {
    emoji: '🧠',
    category: 'Learning',
    title: 'The Science of Spaced Repetition for Quizzes',
    excerpt:
      'Why revisiting material on a schedule beats cramming — and how to build it into your quiz flow.',
    date: 'May 14, 2026',
  },
  {
    emoji: '🌍',
    category: 'Community',
    title: 'How Educators Are Sharing Quizzes Across the World',
    excerpt:
      'A look at the most-played community quizzes and the teachers behind them.',
    date: 'Apr 30, 2026',
  },
]

export default function BlogPage() {
  return (
    <main className="px-6 py-16">
      <div className="mx-auto max-w-7xl">
        <div className="text-center">
          <h1 className="font-[family-name:var(--font-syne)] font-bold text-4xl sm:text-5xl text-foreground">
            The QuEZ Blog
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            Product updates, teaching tips, and ideas for building better
            quizzes.
          </p>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {POSTS.map((post) => (
            <article
              key={post.title}
              className="flex flex-col rounded-2xl border border-border bg-card p-6"
            >
              <div className="flex h-32 items-center justify-center rounded-xl bg-secondary text-5xl">
                {post.emoji}
              </div>
              <div className="mt-4 text-xs font-medium text-accent-lime">
                {post.category}
              </div>
              <h2 className="mt-2 font-[family-name:var(--font-syne)] font-semibold text-lg leading-snug text-foreground">
                {post.title}
              </h2>
              <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">
                {post.excerpt}
              </p>
              <div className="mt-4 text-xs text-muted-foreground">
                {post.date}
              </div>
            </article>
          ))}
        </div>
      </div>
    </main>
  )
}
