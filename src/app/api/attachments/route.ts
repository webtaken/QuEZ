import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { validateUpload } from '@/lib/attachment-kind'
import { insertAttachment } from '@/db/attachment-queries'
import { r2Key, presignPut } from '@/lib/r2'
import { isUuid } from '@/lib/ids'

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const { id, filename, mimeType, sizeBytes, quizId } = body as {
    id?: unknown; filename?: unknown; mimeType?: unknown; sizeBytes?: unknown; quizId?: unknown
  }
  if (!isUuid(id)) return NextResponse.json({ error: 'id must be a uuid' }, { status: 400 })

  const v = validateUpload({
    filename: String(filename ?? ''),
    mimeType: String(mimeType ?? ''),
    sizeBytes: Number(sizeBytes),
  })
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })

  const key = r2Key(session.user.id, id, String(filename))
  await insertAttachment({
    id,
    userId: session.user.id,
    quizId: isUuid(quizId) ? quizId : null,
    filename: String(filename),
    mimeType: String(mimeType),
    sizeBytes: Number(sizeBytes),
    r2Key: key,
    kind: v.kind,
    status: 'pending',
  })

  const uploadUrl = await presignPut(key, String(mimeType))
  return NextResponse.json({ id, uploadUrl })
}
