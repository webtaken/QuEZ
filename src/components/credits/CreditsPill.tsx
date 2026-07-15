import Link from 'next/link'
import { Coins } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatCredits } from '@/lib/credit-math'

// Compact balance pill. Renders nothing until the balance is known so it never
// flashes a wrong number. Links to the credits history page.
export function CreditsPill({ balance }: { balance: number | null }) {
  if (balance === null) return null
  const tone =
    balance <= 0
      ? 'text-destructive border-destructive/40 bg-destructive/10'
      : balance < 10
        ? 'text-warning border-warning/40 bg-warning/10'
        : 'text-muted-foreground border-border bg-secondary'
  return (
    <Link
      href="/dashboard/billing"
      title="AI credits"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
        tone
      )}
    >
      <Coins className="w-3.5 h-3.5" />
      {formatCredits(balance)}
    </Link>
  )
}
