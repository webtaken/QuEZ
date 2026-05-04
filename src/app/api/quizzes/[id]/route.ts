import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { db } from '@/db'
import { quizzes } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'

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
