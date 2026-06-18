import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { db } from '@/db'
import { quizzes, questions } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { quizPayloadWithFlagsSchema } from '@/lib/quiz-schema'
import { deleteQuiz } from '@/db/quiz-mutations'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json()

  if (typeof body.isPublic !== 'boolean') {
    return NextResponse.json({ error: 'isPublic must be boolean' }, { status: 400 })
  }

  const [updated] = await db
    .update(quizzes)
    .set({ isPublic: body.isPublic, updatedAt: new Date() })
    .where(and(eq(quizzes.id, id), eq(quizzes.userId, session.user.id)))
    .returning()

  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ id: updated.id, isPublic: updated.isPublic })
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const json = await req.json().catch(() => null)
  if (!json) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const parsed = quizPayloadWithFlagsSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const [existing] = await db
    .select()
    .from(quizzes)
    .where(and(eq(quizzes.id, id), eq(quizzes.userId, session.user.id)))
    .limit(1)

  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const data = parsed.data

  for (const q of data.questions) {
    if (q.correctIndex >= q.options.length) {
      return NextResponse.json(
        { error: `correctIndex out of range for question order ${q.order}` },
        { status: 400 }
      )
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .update(quizzes)
      .set({
        title: data.title,
        description: data.description,
        topic: data.topic,
        audience: data.audience,
        difficulty: data.difficulty,
        coverEmoji: data.coverEmoji,
        isPublic: typeof data.isPublic === 'boolean' ? data.isPublic : existing.isPublic,
        updatedAt: new Date(),
      })
      .where(eq(quizzes.id, id))

    await tx.delete(questions).where(eq(questions.quizId, id))

    if (data.questions.length) {
      await tx.insert(questions).values(
        data.questions.map((q, i) => ({
          quizId: id,
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
  })

  return NextResponse.json({ id })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const res = await deleteQuiz(id, session.user.id)
  if (!res.ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ id })
}
