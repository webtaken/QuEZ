import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getBalance, listTransactions } from '@/db/credit-queries'

// Only these metadata fields are safe to expose to the client — internal
// margin data (rawCostUsd, usedFallback, model) must never leave the server.
function pickPublicMetadata(metadata: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!metadata) return null
  return {
    webSearch: metadata.webSearch ?? null,
    inputTokens: metadata.inputTokens ?? null,
    outputTokens: metadata.outputTokens ?? null,
    quizId: metadata.quizId ?? null,
  }
}

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [balance, transactions] = await Promise.all([
    getBalance(session.user.id),
    listTransactions(session.user.id, 100),
  ])
  const sanitized = transactions.map((tx) => ({
    ...tx,
    metadata: pickPublicMetadata(tx.metadata as Record<string, unknown> | null),
  }))
  return NextResponse.json({ balance, transactions: sanitized })
}
