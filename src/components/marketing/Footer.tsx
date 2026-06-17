import Link from 'next/link'
import { Logo } from './Logo'
import { NAV_LINKS } from './nav-links'

export function Footer() {
  return (
    <footer className="border-t border-border bg-card">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-6 py-12 md:flex-row md:items-start md:justify-between">
        <div className="space-y-3">
          <Logo />
          <p className="max-w-xs text-sm text-muted-foreground">
            The AI-powered quiz builder for educators, trainers, and curious
            minds.
          </p>
        </div>
        <nav className="flex flex-col gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Explore
          </span>
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="border-t border-border">
        <div className="mx-auto max-w-7xl px-6 py-4 text-xs text-muted-foreground">
          © 2026 QuEZ. All rights reserved.
        </div>
      </div>
    </footer>
  )
}
