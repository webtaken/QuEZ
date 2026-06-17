import Link from 'next/link'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@/components/ui/avatar'
import { Logo } from './Logo'
import { NAV_LINKS } from './nav-links'
import { MobileNav } from './MobileNav'

async function getSessionSafe() {
  try {
    return await auth.api.getSession({ headers: await headers() })
  } catch {
    return null
  }
}

export async function Header() {
  const session = await getSessionSafe()
  const user = session?.user
  const initials = user?.name
    ?.split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  const authSlot = user ? (
    <Link
      href="/dashboard"
      className="inline-flex items-center gap-2 rounded-full py-1 pl-1 pr-3 transition-colors hover:bg-muted"
    >
      <Avatar className="size-8">
        <AvatarImage src={user.image ?? undefined} />
        <AvatarFallback className="bg-accent-lime text-accent-lime-foreground text-xs">
          {initials ?? '?'}
        </AvatarFallback>
      </Avatar>
      <span className="text-sm font-medium text-foreground">Dashboard</span>
    </Link>
  ) : (
    <Button
      className="rounded-full bg-accent-lime px-5 text-accent-lime-foreground hover:bg-accent-lime/90"
      render={<Link href="/login" />}
    >
      Log in
    </Button>
  )

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-6">
        <Logo />
        <nav className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <div className="hidden md:block">{authSlot}</div>
          <div className="md:hidden">
            <MobileNav authSlot={authSlot} />
          </div>
        </div>
      </div>
    </header>
  )
}
