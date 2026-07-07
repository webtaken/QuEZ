import { headers } from 'next/headers'
import Link from 'next/link'
import { Coins } from 'lucide-react'
import { auth } from '@/lib/auth'
import { getBalance, listTransactions } from '@/db/credit-queries'
import { formatCredits } from '@/lib/credit-math'
import { cn } from '@/lib/utils'

const TYPE_LABELS: Record<string, string> = {
  signup_grant: 'Signup bonus',
  manual_grant: 'Top-up',
  chat: 'Chat message',
  ocr: 'Image extraction',
}

function txLabel(type: string, metadata: Record<string, unknown> | null): string {
  if (type === 'chat' && metadata?.webSearch) return 'Web search chat'
  return TYPE_LABELS[type] ?? type
}

function txDetail(metadata: Record<string, unknown> | null): string | null {
  if (!metadata) return null
  const input = typeof metadata.inputTokens === 'number' ? metadata.inputTokens : 0
  const output = typeof metadata.outputTokens === 'number' ? metadata.outputTokens : 0
  const total = input + output
  return total > 0 ? `${total.toLocaleString()} tokens` : null
}

export default async function CreditsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  const userId = session!.user.id
  const [balance, transactions] = await Promise.all([
    getBalance(userId),
    listTransactions(userId, 100),
  ])

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="font-[family-name:var(--font-syne)] font-bold text-3xl text-foreground">
          AI Credits
        </h1>
        <p className="text-muted-foreground mt-1">
          Credits are spent when the AI builds quizzes, searches the web, or reads images.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 mb-10 flex items-center gap-4">
        <div className="w-12 h-12 rounded-full bg-accent-lime/20 flex items-center justify-center">
          <Coins className="w-6 h-6 text-accent-lime" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Current balance</p>
          <p className="font-[family-name:var(--font-syne)] font-bold text-3xl text-foreground">
            {formatCredits(balance)} <span className="text-base font-medium">credits</span>
          </p>
        </div>
      </div>

      <h2 className="font-semibold text-lg text-foreground mb-3">History</h2>
      {transactions.length === 0 ? (
        <p className="text-muted-foreground text-sm">No activity yet.</p>
      ) : (
        <div className="rounded-2xl border border-border bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Activity</th>
                <th className="px-5 py-3 font-medium text-right">Credits</th>
                <th className="px-5 py-3 font-medium text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx) => {
                const meta = tx.metadata as Record<string, unknown> | null
                const detail = txDetail(meta)
                const quizId = typeof meta?.quizId === 'string' ? meta.quizId : null
                return (
                  <tr key={tx.id} className="border-b border-border last:border-0">
                    <td className="px-5 py-3 text-muted-foreground whitespace-nowrap">
                      {tx.createdAt.toLocaleDateString('en-US')}{' '}
                      {tx.createdAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-foreground">{txLabel(tx.type, meta)}</span>
                      {detail && <span className="text-muted-foreground ml-2 text-xs">{detail}</span>}
                      {quizId && (
                        <Link
                          href={`/dashboard/quizzes/${quizId}`}
                          className="text-accent-lime ml-2 text-xs hover:underline"
                        >
                          View quiz
                        </Link>
                      )}
                    </td>
                    <td
                      className={cn(
                        'px-5 py-3 text-right font-medium whitespace-nowrap',
                        tx.amount >= 0 ? 'text-accent-lime' : 'text-foreground'
                      )}
                    >
                      {tx.amount >= 0 ? '+' : ''}
                      {tx.amount.toFixed(2)}
                    </td>
                    <td className="px-5 py-3 text-right text-muted-foreground whitespace-nowrap">
                      {formatCredits(tx.balanceAfter)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
