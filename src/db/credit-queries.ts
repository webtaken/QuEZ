import { eq, desc, sql } from 'drizzle-orm'
import { db } from '@/db'
import { users, creditTransactions, type CreditTransaction } from '@/db/schema'

export type CreditTxType = 'signup_grant' | 'manual_grant' | 'chat' | 'ocr'

export async function getBalance(userId: string): Promise<number> {
  const [row] = await db
    .select({ balance: users.creditBalance })
    .from(users)
    .where(eq(users.id, userId))
  return row?.balance ?? 0
}

// Atomic balance update + ledger insert. The returned balance comes from the
// UPDATE ... RETURNING, so concurrent deltas cannot drift the ledger.
async function applyCreditDelta(args: {
  userId: string
  delta: number
  type: CreditTxType
  metadata?: Record<string, unknown>
}): Promise<number> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(users)
      .set({ creditBalance: sql`${users.creditBalance} + ${args.delta}` })
      .where(eq(users.id, args.userId))
      .returning({ balance: users.creditBalance })
    if (!row) throw new Error(`applyCreditDelta: user not found: ${args.userId}`)
    await tx.insert(creditTransactions).values({
      userId: args.userId,
      amount: args.delta,
      balanceAfter: row.balance,
      type: args.type,
      metadata: args.metadata ?? null,
    })
    return row.balance
  })
}

export async function grantCredits(args: {
  userId: string
  amount: number
  type: 'signup_grant' | 'manual_grant'
  metadata?: Record<string, unknown>
}): Promise<number> {
  if (!(args.amount > 0)) throw new Error('grantCredits: amount must be positive')
  return applyCreditDelta({ userId: args.userId, delta: args.amount, type: args.type, metadata: args.metadata })
}

export async function debitCredits(args: {
  userId: string
  credits: number
  type: 'chat' | 'ocr'
  metadata?: Record<string, unknown>
}): Promise<number> {
  return applyCreditDelta({ userId: args.userId, delta: -args.credits, type: args.type, metadata: args.metadata })
}

export async function listTransactions(userId: string, limit = 100): Promise<CreditTransaction[]> {
  return db
    .select()
    .from(creditTransactions)
    .where(eq(creditTransactions.userId, userId))
    .orderBy(desc(creditTransactions.createdAt), desc(creditTransactions.id))
    .limit(limit)
}
