import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { db } from '@/db'
import { quizzes, questions, users } from '@/db/schema'
import { and, count, eq, ilike, or, sql } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { quizPayloadWithFlagsSchema } from '@/lib/quiz-schema'

const PAGE_SIZE = 12

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const q = searchParams.get('q') ?? ''
  const topic = searchParams.get('topic') ?? ''
  const audience = searchParams.get('audience') ?? ''
  const difficulty = searchParams.get('difficulty') ?? ''
  const language = searchParams.get('language') ?? ''
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))

  const filters = [
    eq(quizzes.isPublic, true),
    q ? or(ilike(quizzes.title, `%${q}%`), ilike(quizzes.description, `%${q}%`)) : undefined,
    topic ? ilike(quizzes.topic, topic) : undefined,
    audience ? ilike(quizzes.audience, audience) : undefined,
    difficulty ? ilike(quizzes.difficulty, difficulty) : undefined,
    language ? eq(quizzes.language, language) : undefined,
  ].filter(Boolean)

  const where = and(...(filters as Parameters<typeof and>))

  const [totalResult, rows] = await Promise.all([
    db.select({ count: count() }).from(quizzes).where(where),
    db
      .select({
        id: quizzes.id,
        title: quizzes.title,
        description: quizzes.description,
        topic: quizzes.topic,
        audience: quizzes.audience,
        difficulty: quizzes.difficulty,
        language: quizzes.language,
        coverEmoji: quizzes.coverEmoji,
        playCount: quizzes.playCount,
        authorName: users.name,
        authorImage: users.image,
        questionCount: sql<number>`(select count(*) from ${questions} where ${questions.quizId} = ${quizzes.id})`,
      })
      .from(quizzes)
      .innerJoin(users, eq(quizzes.userId, users.id))
      .where(where)
      .orderBy(sql`${quizzes.playCount} DESC`)
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
  ])

  return NextResponse.json({
    quizzes: rows,
    total: totalResult[0].count,
    page,
    pageSize: PAGE_SIZE,
  })
}

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const json = await req.json().catch(() => null)
  if (!json) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const parsed = quizPayloadWithFlagsSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const data = parsed.data

  for (const q of data.questions) {
    if (q.correctIndex >= q.options.length) {
      return NextResponse.json(
        { error: `correctIndex out of range for question order ${q.order}` },
        { status: 400 }
      )
    }
  }

  const id = await db.transaction(async (tx) => {
    const [quiz] = await tx
      .insert(quizzes)
      .values({
        userId: session.user.id,
        title: data.title,
        description: data.description,
        topic: data.topic,
        audience: data.audience,
        difficulty: data.difficulty,
        coverEmoji: data.coverEmoji,
        isPublic: !!data.isPublic,
        language: 'en',
      })
      .returning()

    if (data.questions.length) {
      await tx.insert(questions).values(
        data.questions.map((q, i) => ({
          quizId: quiz.id,
          order: i + 1,
          text: q.text,
          type: q.type,
          options: q.options,
          correctIndex: q.correctIndex,
          explanation: q.explanation,
          timeLimit: q.timeLimit,
        }))
      )
    }

    return quiz.id
  })

  return NextResponse.json({ id })
}
