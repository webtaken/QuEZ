import Link from 'next/link'
import { cn } from '@/lib/utils'

export function Logo({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      aria-label="QuEZ home"
      className={cn('inline-flex items-baseline', className)}
    >
      <span className="font-[family-name:var(--font-syne)] font-bold text-2xl text-foreground">
        <span className="text-accent-lime text-3xl">Q</span>uE
        <span className="inline-block -rotate-6 text-accent-lime">Z</span>
      </span>
    </Link>
  )
}
