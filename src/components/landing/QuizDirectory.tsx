'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import Link from 'next/link'
import { Search, X, Gamepad2, BookOpen } from 'lucide-react'

const TOPICS = ['Mathematics', 'Science', 'Biology', 'History', 'Programming', 'Geography', 'Literature', 'Philosophy', 'Economics']
const AUDIENCES = ['Elementary School', 'Middle School', 'High School', 'Undergraduate', 'Graduate', 'Professional', 'General']
const DIFFICULTIES = ['Easy', 'Medium', 'Hard']
const LANGUAGES = ['English', 'Spanish', 'French', 'Portuguese']

const DIFFICULTY_COLOR: Record<string, string> = {
  easy: 'bg-success',
  medium: 'bg-warning',
  hard: 'bg-destructive',
}

type Quiz = {
  id: string
  title: string
  description: string | null
  topic: string
  audience: string
  difficulty: string
  language: string
  coverEmoji: string
  playCount: number
  questionCount: number
  authorName: string
  authorImage: string | null
}

interface QuizDirectoryProps {
  initialQuizzes: Quiz[]
  total: number
}

export function QuizDirectory({ initialQuizzes, total }: QuizDirectoryProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [quizzes, setQuizzes] = useState(initialQuizzes)
  const [count, setCount] = useState(total)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  const sectionRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])

  const q = searchParams.get('q') ?? ''
  const topic = searchParams.get('topic') ?? ''
  const audience = searchParams.get('audience') ?? ''
  const difficulty = searchParams.get('difficulty') ?? ''
  const language = searchParams.get('language') ?? ''

  const updateParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value) {
        params.set(key, value)
      } else {
        params.delete(key)
      }
      params.delete('page')
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [searchParams, pathname, router]
  )

  // Fetch quizzes when filters change
  useEffect(() => {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (topic) params.set('topic', topic)
    if (audience) params.set('audience', audience)
    if (difficulty) params.set('difficulty', difficulty)
    if (language) params.set('language', language)
    params.set('page', '1')

    setLoading(true)
    fetch(`/api/quizzes?${params.toString()}`)
      .then((r) => r.json())
      .then(({ quizzes, total }) => {
        setQuizzes(quizzes)
        setCount(total)
        setPage(1)
      })
      .finally(() => setLoading(false))
  }, [q, topic, audience, difficulty, language])

  // Intersection observer for stagger animation
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) e.target.classList.add('visible')
        })
      },
      { threshold: 0.1 }
    )
    itemRefs.current.forEach((el) => el && obs.observe(el))
    return () => obs.disconnect()
  }, [quizzes])

  async function loadMore() {
    const nextPage = page + 1
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (topic) params.set('topic', topic)
    if (audience) params.set('audience', audience)
    if (difficulty) params.set('difficulty', difficulty)
    if (language) params.set('language', language)
    params.set('page', String(nextPage))

    setLoadingMore(true)
    const res = await fetch(`/api/quizzes?${params.toString()}`)
    const data = await res.json()
    setQuizzes((prev) => [...prev, ...data.quizzes])
    setPage(nextPage)
    setLoadingMore(false)
  }

  const hasMore = quizzes.length < count

  return (
    <section id="community-quizzes" ref={sectionRef} className="py-24 px-6">
      <div className="max-w-7xl mx-auto">
        <h2 className="font-[family-name:var(--font-syne)] font-bold text-4xl text-foreground mb-2">
          Explore Community Quizzes
        </h2>
        <p className="text-muted-foreground mb-10">
          {count.toLocaleString()} quizzes from educators around the world
        </p>

        {/* Search + filters */}
        <div className="mb-8 space-y-4">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              className="pl-10 bg-card border-border"
              placeholder="Search quizzes..."
              defaultValue={q}
              onChange={(e) => updateParam('q', e.target.value)}
            />
          </div>

          <div className="flex flex-wrap gap-2 text-sm">
            <FilterGroup
              label="Topic"
              options={TOPICS}
              value={topic}
              onSelect={(v) => updateParam('topic', topic === v ? '' : v)}
            />
            <FilterGroup
              label="Audience"
              options={AUDIENCES}
              value={audience}
              onSelect={(v) => updateParam('audience', audience === v ? '' : v)}
            />
            <FilterGroup
              label="Difficulty"
              options={DIFFICULTIES}
              value={difficulty}
              onSelect={(v) => updateParam('difficulty', difficulty === v ? '' : v)}
            />
            <FilterGroup
              label="Language"
              options={LANGUAGES}
              value={language}
              onSelect={(v) => updateParam('language', language === v ? '' : v)}
            />
          </div>

          {/* Active filter chips */}
          {[
            { key: 'q', value: q, label: `"${q}"` },
            { key: 'topic', value: topic, label: topic },
            { key: 'audience', value: audience, label: audience },
            { key: 'difficulty', value: difficulty, label: difficulty },
            { key: 'language', value: language, label: language },
          ]
            .filter((f) => f.value)
            .map((f) => (
              <span
                key={f.key}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-accent-lime/15 text-accent-lime text-xs font-medium border border-accent-lime/30"
              >
                {f.label}
                <button onClick={() => updateParam(f.key, '')} aria-label={`Remove ${f.key} filter`}>
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
        </div>

        {/* Grid */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <QuizCardSkeleton key={i} />
            ))}
          </div>
        ) : quizzes.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {quizzes.map((quiz, i) => (
                <div
                  key={quiz.id}
                  ref={(el) => { itemRefs.current[i] = el }}
                  className="stagger-item"
                  style={{ transitionDelay: `${(i % 12) * 50}ms` }}
                >
                  <QuizCard quiz={quiz} />
                </div>
              ))}
            </div>

            {hasMore && (
              <div className="mt-12 text-center">
                <Button
                  variant="outline"
                  className="rounded-full px-8"
                  onClick={loadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? 'Loading...' : 'Load More'}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}

function FilterGroup({
  label,
  options,
  value,
  onSelect,
}: {
  label: string
  options: string[]
  value: string
  onSelect: (v: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      <span className="text-muted-foreground text-xs pr-1">{label}:</span>
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onSelect(opt)}
          className={`px-3 py-1 rounded-full text-xs border transition-colors ${
            value.toLowerCase() === opt.toLowerCase()
              ? 'bg-accent-lime text-accent-lime-foreground border-transparent font-semibold'
              : 'border-border text-muted-foreground hover:border-accent-lime/50 hover:text-foreground'
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  )
}

function QuizCard({ quiz }: { quiz: Quiz }) {
  const initials = quiz.authorName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <div className="card-glow rounded-2xl border border-border bg-card overflow-hidden flex flex-col">
      {/* Cover */}
      <div className="relative h-28 bg-secondary flex items-center justify-center text-5xl">
        {quiz.coverEmoji}
        <Badge className="absolute top-3 left-3 bg-accent-lime/80 text-accent-lime-foreground border-none text-xs">
          {quiz.topic}
        </Badge>
      </div>

      {/* Body */}
      <div className="p-4 flex flex-col flex-1">
        <h3 className="font-[family-name:var(--font-syne)] font-semibold text-foreground leading-tight line-clamp-2 mb-3">
          {quiz.title}
        </h3>

        {/* Author */}
        <div className="flex items-center gap-2 mb-4">
          <div className="w-6 h-6 rounded-full bg-accent-lime flex items-center justify-center text-accent-lime-foreground text-xs font-bold flex-shrink-0">
            {initials}
          </div>
          <span className="text-xs text-muted-foreground truncate">{quiz.authorName}</span>
        </div>

        {/* Meta */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground mb-4">
          <span className="flex items-center gap-1">
            <BookOpen className="w-3.5 h-3.5" />
            {quiz.questionCount} questions
          </span>
          <span className="flex items-center gap-1">
            <Gamepad2 className="w-3.5 h-3.5" />
            {quiz.playCount.toLocaleString()} plays
          </span>
          {/* Difficulty dots */}
          <span className="flex items-center gap-0.5 ml-auto">
            {['easy', 'medium', 'hard'].map((d) => (
              <span
                key={d}
                className={`w-2 h-2 rounded-full ${
                  ['easy', 'medium', 'hard'].indexOf(d) <=
                  ['easy', 'medium', 'hard'].indexOf(quiz.difficulty.toLowerCase())
                    ? DIFFICULTY_COLOR[quiz.difficulty.toLowerCase()]
                    : 'bg-muted'
                }`}
              />
            ))}
          </span>
        </div>

        <Badge variant="secondary" className="w-fit text-xs mb-4">
          {quiz.audience}
        </Badge>

        {/* CTA */}
        <Button
          className="mt-auto w-full rounded-xl"
          variant="secondary"
          nativeButton={false}
          render={<Link href={`/play/${quiz.id}`} />}
        >
          Play Quiz
        </Button>
      </div>
    </div>
  )
}

function QuizCardSkeleton() {
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <Skeleton className="h-28 w-full rounded-none" />
      <div className="p-4 space-y-3">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-9 w-full rounded-xl" />
      </div>
    </div>
  )
}

function EmptyState() {
  const router = useRouter()
  return (
    <div className="text-center py-20">
      <div className="text-6xl mb-4">🔍</div>
      <h3 className="font-[family-name:var(--font-syne)] font-semibold text-xl text-foreground mb-2">
        No quizzes found
      </h3>
      <p className="text-muted-foreground mb-6">
        Be the first to create one!
      </p>
      <Button
        className="bg-accent-lime text-accent-lime-foreground rounded-full px-8"
        onClick={() => router.push('/dashboard/quizzes/new')}
      >
        Create a Quiz
      </Button>
    </div>
  )
}
