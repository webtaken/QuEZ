import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { deleteSubtree } from '@/db/chat-queries'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; mid: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, mid } = await params
  if (!UUID_RE.test(id) || !UUID_RE.test(mid)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const res = await deleteSubtree(id, session.user.id, mid)
  if (!res.ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(res)
}
