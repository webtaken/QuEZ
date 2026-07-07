import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getBalance, listTransactions } from '@/db/credit-queries'

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [balance, transactions] = await Promise.all([
    getBalance(session.user.id),
    listTransactions(session.user.id, 100),
  ])
  return NextResponse.json({ balance, transactions })
}
