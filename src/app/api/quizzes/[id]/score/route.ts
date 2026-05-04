import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db'
import { questions } from '@/db/schema'
import { asc, eq } from 'drizzle-orm'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Quiz not found' }, { status: 404 })
  }

  let body: { answers?: { questionId: string; selectedIndex: number | null }[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!Array.isArray(body.answers)) {
    return NextResponse.json({ error: 'answers must be an array' }, { status: 400 })
  }

  const qs = await db
    .select()
    .from(questions)
    .where(eq(questions.quizId, id))
    .orderBy(asc(questions.order))

  if (qs.length === 0) {
    return NextResponse.json({ error: 'Quiz not found' }, { status: 404 })
  }

  const answerMap = new Map(
    body.answers.map((a) => [a.questionId, a.selectedIndex])
  )

  const results = qs.map((q) => {
    const raw = answerMap.get(q.id)
    const selected = typeof raw === 'number' ? raw : null
    return {
      questionId: q.id,
      correctIndex: q.correctIndex,
      selected,
      isCorrect: selected === q.correctIndex,
      explanation: q.explanation,
    }
  })

  const score = results.filter((r) => r.isCorrect).length

  return NextResponse.json({
    score,
    total: results.length,
    results,
  })
}
