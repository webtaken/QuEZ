import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getOwnedAttachment, markAttachmentReady, markAttachmentError } from '@/db/attachment-queries'
import { getObjectBytes } from '@/lib/r2'
import { extractAttachmentText } from '@/lib/attachment-extract'
import type { AttachmentKind } from '@/lib/attachment-kind'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const row = await getOwnedAttachment(id, session.user.id)
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const bytes = await getObjectBytes(row.r2Key)
    const text = await extractAttachmentText({
      kind: row.kind as AttachmentKind,
      bytes,
      mimeType: row.mimeType,
    })
    if (!text.trim()) {
      await markAttachmentError(id, 'No text could be extracted')
      return NextResponse.json({
        status: 'error',
        filename: row.filename,
        kind: row.kind,
        errorMessage: 'No text could be extracted from this file',
      })
    }
    await markAttachmentReady(id, text, { charCount: text.length })
    return NextResponse.json({ status: 'ready', filename: row.filename, kind: row.kind })
  } catch (e) {
    console.error('[attachments/process] extraction failed', e)
    await markAttachmentError(id, String((e as Error)?.message ?? e))
    return NextResponse.json({
      status: 'error',
      filename: row.filename,
      kind: row.kind,
      errorMessage: 'Could not process this file',
    })
  }
}
