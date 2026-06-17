import type { Metadata } from 'next'
import { ChevronDown } from 'lucide-react'

export const metadata: Metadata = {
  title: 'FAQ — QuEZ',
  description: 'Answers to common questions about QuEZ, the AI quiz builder.',
}

type QA = { q: string; a: string }

const FAQS: QA[] = [
  {
    q: 'What is QuEZ?',
    a: 'QuEZ is an AI-powered quiz builder. Describe a topic in plain language and QuEZ generates questions, answers, and explanations you can edit, publish, and share.',
  },
  {
    q: 'Do I need an account to play quizzes?',
    a: 'No. Anyone can browse and play community quizzes. You only need an account to build and publish your own.',
  },
  {
    q: 'How do I sign in?',
    a: 'QuEZ uses Google sign-in. Click "Log in", continue with your Google account, and you are in — no passwords to remember.',
  },
  {
    q: 'Is QuEZ free?',
    a: 'Yes — the Free plan lets you create up to 5 quizzes with AI generation and public sharing. Paid plans unlock unlimited quizzes and more.',
  },
  {
    q: 'Can I edit what the AI generates?',
    a: 'Absolutely. Every generated question is fully editable — rewrite prompts, change answers, reorder, or delete before publishing.',
  },
  {
    q: 'Can I keep my quizzes private?',
    a: 'Private quizzes are available on the Pro and Team plans. On the Free plan, quizzes are public to the community.',
  },
]

export default function FaqPage() {
  return (
    <main className="px-6 py-16">
      <div className="mx-auto max-w-3xl">
        <div className="text-center">
          <h1 className="font-[family-name:var(--font-syne)] font-bold text-4xl sm:text-5xl text-foreground">
            Frequently asked questions
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            Everything you need to know about building and sharing quizzes.
          </p>
        </div>

        <div className="mt-12 space-y-3">
          {FAQS.map((item) => (
            <details
              key={item.q}
              className="group rounded-2xl border border-border bg-card px-6 py-4"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-foreground">
                {item.q}
                <ChevronDown className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {item.a}
              </p>
            </details>
          ))}
        </div>
      </div>
    </main>
  )
}
