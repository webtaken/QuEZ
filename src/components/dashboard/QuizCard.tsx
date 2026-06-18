'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Edit, Trash2 } from 'lucide-react'
import { formatDistanceToNow } from '@/lib/date'
import { DeleteQuizDialog } from '@/components/quiz/DeleteQuizDialog'

export type DashboardQuiz = {
  id: string
  title: string
  topic: string
  audience: string
  coverEmoji: string | null
  isPublic: boolean
  questionCount: number
  createdAt: Date
}

export function QuizCard({ quiz }: { quiz: DashboardQuiz }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  return (
    <div className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4 hover:border-accent-lime/30 transition-colors">
      <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center text-2xl shrink-0">
        {quiz.coverEmoji ?? '🧠'}
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
            quiz.isPublic ? 'bg-accent-lime/20 text-accent-lime border-accent-lime/30' : ''
          }
        >
          {quiz.isPublic ? 'Public' : 'Draft'}
        </Badge>
        <Link href={`/dashboard/quizzes/${quiz.id}`}>
          <Button variant="ghost" size="icon" className="w-8 h-8">
            <Edit className="w-3.5 h-3.5" />
          </Button>
        </Link>
        <Button
          variant="ghost"
          size="icon"
          className="w-8 h-8 text-muted-foreground hover:text-destructive"
          onClick={() => setOpen(true)}
          aria-label={`Delete ${quiz.title}`}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
      <DeleteQuizDialog
        quizId={quiz.id}
        quizTitle={quiz.title}
        open={open}
        onOpenChange={setOpen}
        onDeleted={() => router.refresh()}
      />
    </div>
  )
}
