import type { Metadata } from 'next'
import Link from 'next/link'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'

export const metadata: Metadata = {
  title: 'Pricing — QuEZ',
  description: 'Simple pricing for QuEZ. Start free, upgrade when you grow.',
}

type Tier = {
  name: string
  price: string
  period: string
  blurb: string
  features: string[]
  cta: string
  featured: boolean
}

const TIERS: Tier[] = [
  {
    name: 'Free',
    price: '$0',
    period: '/forever',
    blurb: 'For getting started and casual quiz-making.',
    features: [
      'Up to 5 quizzes',
      'AI quiz generation',
      'Public sharing',
      'Community library access',
    ],
    cta: 'Get started',
    featured: false,
  },
  {
    name: 'Pro',
    price: '$12',
    period: '/month',
    blurb: 'For educators and creators who publish often.',
    features: [
      'Unlimited quizzes',
      'Priority AI generation',
      'Private quizzes',
      'Advanced analytics',
      'Custom branding',
    ],
    cta: 'Start Pro',
    featured: true,
  },
  {
    name: 'Team',
    price: '$39',
    period: '/month',
    blurb: 'For schools and organizations working together.',
    features: [
      'Everything in Pro',
      'Up to 10 seats',
      'Shared workspaces',
      'Team analytics',
      'Priority support',
    ],
    cta: 'Contact sales',
    featured: false,
  },
]

export default function PricingPage() {
  return (
    <main className="px-6 py-16">
      <div className="mx-auto max-w-7xl">
        <div className="text-center">
          <h1 className="font-[family-name:var(--font-syne)] font-bold text-4xl sm:text-5xl text-foreground">
            Simple, honest pricing
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            Start free. Upgrade when your quizzes outgrow it. No hidden fees.
          </p>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-3">
          {TIERS.map((tier) => (
            <div
              key={tier.name}
              className={
                tier.featured
                  ? 'relative rounded-2xl border border-accent-lime/30 bg-card p-8 shadow-lg shadow-accent-lime/20'
                  : 'rounded-2xl border border-border bg-card p-8'
              }
            >
              {tier.featured && (
                <span className="absolute -top-3 left-8 rounded-full bg-accent-lime px-3 py-1 text-xs font-medium text-accent-lime-foreground">
                  Most popular
                </span>
              )}
              <h2 className="font-[family-name:var(--font-syne)] font-semibold text-xl text-foreground">
                {tier.name}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">{tier.blurb}</p>
              <div className="mt-6 flex items-baseline gap-1">
                <span className="font-[family-name:var(--font-syne)] font-bold text-4xl text-foreground">
                  {tier.price}
                </span>
                <span className="text-sm text-muted-foreground">
                  {tier.period}
                </span>
              </div>
              <ul className="mt-6 space-y-3">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-foreground">
                    <Check className="mt-0.5 size-4 shrink-0 text-accent-lime" />
                    {f}
                  </li>
                ))}
              </ul>
              <Button
                className={
                  tier.featured
                    ? 'mt-8 w-full rounded-full bg-accent-lime text-accent-lime-foreground hover:bg-accent-lime/90'
                    : 'mt-8 w-full rounded-full'
                }
                variant={tier.featured ? 'default' : 'outline'}
                render={<Link href="/login" />}
              >
                {tier.cta}
              </Button>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
