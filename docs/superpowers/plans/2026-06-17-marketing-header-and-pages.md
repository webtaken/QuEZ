# Marketing Header & Public Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a site-wide, server-rendered marketing header (logo / nav / login) plus the Community, Pricing, Blog, FAQ, and Login pages it links to.

**Architecture:** A Next.js `(marketing)` route group wraps the landing + four new content pages in a shared layout that renders a server-rendered, auth-aware `Header` and `Footer`. The header reads the session on the server (`auth.api.getSession`) so the logged-in/out state is in the initial HTML for SEO; the only client islands are the mobile nav `Sheet` and the Google sign-in button. Login lives outside the group (no header).

**Tech Stack:** Next.js 16.2.4 (App Router), React 19.2.4, better-auth (Google OAuth), shadcn/`@base-ui/react` primitives, Tailwind 4, drizzle-orm.

## Global Constraints

- **Next.js is 16.2.4 — APIs may differ from training data.** Before writing routing/`metadata`/route-group code, read the relevant guide in `node_modules/next/dist/docs/01-app/`.
- **Styling per `DESIGN.md` — tokens only.** Use `accent-lime`, `foreground`, `muted-foreground`, `card`, `border`, `secondary`, etc. NO hardcoded colors (`bg-[oklch(...)]`, `green-*`, `purple-*`). Headings use `font-[family-name:var(--font-syne)]`. Structural cards = `rounded-2xl border border-border bg-card`. Primary CTA = `rounded-full` lime.
  - **One allowed exception:** the multi-color Google "G" logo SVG on the login button — a brand asset, not themeable UI color (analogous to the documented `sheet.tsx` `bg-black/10` scrim exception).
- **Server components by default.** Add `'use client'` ONLY to the two interactive components (`MobileNav`, `GoogleSignInButton`).
- **Auth is Google-only.** No email/password UI. Sign-in via `signIn.social({ provider: 'google', callbackURL: '/dashboard' })`.
- **No new dependencies.** Everything needed is already installed.
- **Branch:** all work on `feat/marketing-header` (already checked out). Commit after every task.
- **Per-task verification:** `npx tsc --noEmit` (fast type check). Final task runs full `pnpm build` + DESIGN audit greps + manual route checks. There is no unit-test framework in this repo — do not invent one.

## File Structure

**Create:**
- `src/lib/quiz-queries.ts` — `getPublicQuizzes()`, shared by landing + community.
- `src/components/marketing/Logo.tsx` — QuEZ wordmark (server), links `/`.
- `src/components/marketing/nav-links.ts` — shared `NAV_LINKS` array.
- `src/components/marketing/MobileNav.tsx` — hamburger → `Sheet` (client).
- `src/components/marketing/Header.tsx` — sticky, auth-aware (server async).
- `src/components/marketing/Footer.tsx` — links + copyright (server).
- `src/components/auth/GoogleSignInButton.tsx` — Google OAuth trigger (client).
- `src/app/login/page.tsx` — login page (server, no header).
- `src/app/(marketing)/layout.tsx` — Header + children + Footer.
- `src/app/(marketing)/community/page.tsx`
- `src/app/(marketing)/pricing/page.tsx`
- `src/app/(marketing)/blog/page.tsx`
- `src/app/(marketing)/faq/page.tsx`

**Move:**
- `src/app/page.tsx` → `src/app/(marketing)/page.tsx` (URL `/` unchanged).

**Convention used everywhere:** the `(marketing)/layout.tsx` renders `Header` + `Footer` but NOT `<main>`; each page renders its own `<main>` (avoids nested `<main>` and keeps the landing's existing `<main className="scroll-smooth">`).

---

### Task 1: Extract `getPublicQuizzes()` query

**Files:**
- Create: `src/lib/quiz-queries.ts`
- Modify: `src/app/page.tsx` (replace inline `getInitialQuizzes` with import)

**Interfaces:**
- Produces: `getPublicQuizzes(): Promise<{ quizzes: PublicQuiz[]; total: number }>` and `type PublicQuiz`. Consumed by Task 7 (landing) and Task 8 (community). Returned `quizzes` shape is structurally compatible with the `Quiz` type that `QuizDirectory` expects.

- [ ] **Step 1: Create the shared query module**

Create `src/lib/quiz-queries.ts` (logic lifted verbatim from the current `getInitialQuizzes` in `src/app/page.tsx`, converted to top-level imports):

```ts
import { db } from '@/db'
import { quizzes, questions, users } from '@/db/schema'
import { eq, sql, and } from 'drizzle-orm'

export type PublicQuiz = {
  id: string
  title: string
  description: string | null
  topic: string
  audience: string
  difficulty: string
  language: string
  coverEmoji: string
  playCount: number
  authorName: string
  authorImage: string | null
  questionCount: number
}

/**
 * Public, published quizzes for the landing + community pages.
 * Swallows DB errors so the page still renders if the DB is unavailable.
 */
export async function getPublicQuizzes(): Promise<{
  quizzes: PublicQuiz[]
  total: number
}> {
  try {
    const rows = await db
      .select({
        id: quizzes.id,
        title: quizzes.title,
        description: quizzes.description,
        topic: quizzes.topic,
        audience: quizzes.audience,
        difficulty: quizzes.difficulty,
        language: quizzes.language,
        coverEmoji: sql<string>`coalesce(${quizzes.coverEmoji}, '🧠')`,
        playCount: quizzes.playCount,
        authorName: users.name,
        authorImage: users.image,
        questionCount: sql<number>`(select count(*) from ${questions} where ${questions.quizId} = ${quizzes.id})`,
      })
      .from(quizzes)
      .innerJoin(users, eq(quizzes.userId, users.id))
      .where(and(eq(quizzes.isPublic, true)))
      .orderBy(sql`${quizzes.playCount} DESC`)
      .limit(12)

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)` })
      .from(quizzes)
      .where(eq(quizzes.isPublic, true))

    return { quizzes: rows as PublicQuiz[], total: Number(total) }
  } catch {
    return { quizzes: [], total: 0 }
  }
}
```

- [ ] **Step 2: Update the landing page to use it**

Replace the entire contents of `src/app/page.tsx` with:

```tsx
import { Suspense } from 'react'
import { Hero } from '@/components/landing/Hero'
import { QuizDirectory } from '@/components/landing/QuizDirectory'
import { getPublicQuizzes } from '@/lib/quiz-queries'

export default async function HomePage() {
  const { quizzes, total } = await getPublicQuizzes()

  return (
    <main className="scroll-smooth">
      <Hero />
      <Suspense fallback={<DirectorySkeleton />}>
        <QuizDirectory initialQuizzes={quizzes} total={total} />
      </Suspense>
    </main>
  )
}

function DirectorySkeleton() {
  return (
    <section className="py-24 px-6">
      <div className="max-w-7xl mx-auto">
        <div className="h-10 w-72 bg-muted rounded animate-pulse mb-10" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="rounded-2xl border border-border bg-card h-64 animate-pulse"
            />
          ))}
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/quiz-queries.ts src/app/page.tsx
git commit -m "refactor: extract getPublicQuizzes for reuse"
```

---

### Task 2: Logo + shared nav links

**Files:**
- Create: `src/components/marketing/Logo.tsx`
- Create: `src/components/marketing/nav-links.ts`

**Interfaces:**
- Produces: `Logo({ className }: { className?: string })` (server component); `NAV_LINKS: { href: string; label: string }[]` and `type NavLink`. Consumed by Header (Task 5), MobileNav (Task 4), Footer (Task 6), Login (Task 3).

- [ ] **Step 1: Create the nav links module**

Create `src/components/marketing/nav-links.ts`:

```ts
export type NavLink = { href: string; label: string }

export const NAV_LINKS: NavLink[] = [
  { href: '/community', label: 'Community' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/blog', label: 'Blog' },
  { href: '/faq', label: 'FAQ' },
]
```

- [ ] **Step 2: Create the Logo component**

Create `src/components/marketing/Logo.tsx` (wordmark treatment matches `Sidebar.tsx`):

```tsx
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
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/marketing/Logo.tsx src/components/marketing/nav-links.ts
git commit -m "feat(marketing): add Logo and shared nav links"
```

---

### Task 3: Google sign-in button + login page

**Files:**
- Create: `src/components/auth/GoogleSignInButton.tsx`
- Create: `src/app/login/page.tsx`

**Interfaces:**
- Consumes: `Logo` (Task 2), `signIn` from `@/lib/auth-client`, `toast` from `sonner`, `Button` from `@/components/ui/button`.
- Produces: `GoogleSignInButton()` (client); `/login` route. No exports consumed by later tasks (Header links to `/login` by URL).

- [ ] **Step 1: Create the Google sign-in button**

Create `src/components/auth/GoogleSignInButton.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { signIn } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'

export function GoogleSignInButton() {
  const [loading, setLoading] = useState(false)

  async function handleSignIn() {
    setLoading(true)
    try {
      await signIn.social({ provider: 'google', callbackURL: '/dashboard' })
    } catch {
      setLoading(false)
      toast.error('Sign-in failed. Please try again.')
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={handleSignIn}
      disabled={loading}
      className="w-full h-11 rounded-full gap-3 text-base"
    >
      <GoogleIcon />
      {loading ? 'Redirecting…' : 'Continue with Google'}
    </Button>
  )
}

// Brand asset — multi-color by definition (allowed DESIGN.md exception).
function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.26 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
      />
    </svg>
  )
}
```

- [ ] **Step 2: Create the login page**

Create `src/app/login/page.tsx`:

```tsx
import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Logo } from '@/components/marketing/Logo'
import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton'

export const metadata: Metadata = {
  title: 'Log in — QuEZ',
  description: 'Log in to QuEZ to build and share AI-powered quizzes.',
}

export default function LoginPage() {
  return (
    <main className="relative min-h-screen flex items-center justify-center dot-grid px-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-2xl">
        <div className="flex justify-center mb-6">
          <Logo />
        </div>
        <h1 className="font-[family-name:var(--font-syne)] font-bold text-2xl text-center text-foreground">
          Welcome back
        </h1>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          Log in to build and share quizzes with AI.
        </p>
        <div className="mt-8">
          <GoogleSignInButton />
        </div>
        <Link
          href="/"
          className="mt-6 inline-flex w-full items-center justify-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to home
        </Link>
      </div>
    </main>
  )
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual check**

Run `pnpm dev`, visit `http://localhost:3000/login`. Expected: centered card, logo, "Continue with Google" button. Clicking it redirects to Google OAuth (or errors via toast if `GOOGLE_CLIENT_ID` unset — that's fine locally).

- [ ] **Step 5: Commit**

```bash
git add src/components/auth/GoogleSignInButton.tsx src/app/login/page.tsx
git commit -m "feat(auth): add Google login page"
```

---

### Task 4: MobileNav (client Sheet)

**Files:**
- Create: `src/components/marketing/MobileNav.tsx`

**Interfaces:**
- Consumes: `NAV_LINKS` (Task 2); `Sheet`/`SheetTrigger`/`SheetContent`/`SheetClose`/`SheetHeader`/`SheetTitle` from `@/components/ui/sheet`; `Button`; `Menu` from `lucide-react`.
- Produces: `MobileNav({ authSlot }: { authSlot: React.ReactNode })` (client). The `authSlot` is server-rendered nodes passed down from Header (Task 5) — RSC passes them through as a prop.

- [ ] **Step 1: Create the MobileNav component**

Create `src/components/marketing/MobileNav.tsx`:

```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetClose,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { NAV_LINKS } from './nav-links'

export function MobileNav({ authSlot }: { authSlot: React.ReactNode }) {
  const [open, setOpen] = useState(false)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="ghost" size="icon" aria-label="Open menu" />
        }
      >
        <Menu />
      </SheetTrigger>
      <SheetContent side="right" className="w-72">
        <SheetHeader>
          <SheetTitle className="font-[family-name:var(--font-syne)]">
            Menu
          </SheetTitle>
        </SheetHeader>
        <nav className="flex flex-col gap-1 px-4">
          {NAV_LINKS.map((l) => (
            <SheetClose
              key={l.href}
              render={
                <Link
                  href={l.href}
                  className="rounded-lg px-3 py-2 text-base text-foreground transition-colors hover:bg-muted"
                />
              }
            >
              {l.label}
            </SheetClose>
          ))}
        </nav>
        <div className="mt-auto border-t border-border p-4">{authSlot}</div>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (Not visually testable until wired in Task 7.)

- [ ] **Step 3: Commit**

```bash
git add src/components/marketing/MobileNav.tsx
git commit -m "feat(marketing): add mobile nav sheet"
```

---

### Task 5: Header (server, auth-aware)

**Files:**
- Create: `src/components/marketing/Header.tsx`

**Interfaces:**
- Consumes: `auth` from `@/lib/auth`; `headers` from `next/headers`; `Logo`, `NAV_LINKS`, `MobileNav` (Tasks 2/4); `Button`; `Avatar`/`AvatarImage`/`AvatarFallback` from `@/components/ui/avatar`.
- Produces: `Header()` (async server component). Consumed by `(marketing)/layout.tsx` (Task 7).

- [ ] **Step 1: Create the Header component**

Create `src/components/marketing/Header.tsx`:

```tsx
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
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (Not visually testable until Task 7.)

- [ ] **Step 3: Commit**

```bash
git add src/components/marketing/Header.tsx
git commit -m "feat(marketing): add auth-aware server header"
```

---

### Task 6: Footer

**Files:**
- Create: `src/components/marketing/Footer.tsx`

**Interfaces:**
- Consumes: `Logo`, `NAV_LINKS` (Task 2).
- Produces: `Footer()` (server). Consumed by `(marketing)/layout.tsx` (Task 7).

- [ ] **Step 1: Create the Footer component**

Create `src/components/marketing/Footer.tsx`:

```tsx
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
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/marketing/Footer.tsx
git commit -m "feat(marketing): add footer"
```

---

### Task 7: Marketing layout + move landing into the group

**Files:**
- Create: `src/app/(marketing)/layout.tsx`
- Move: `src/app/page.tsx` → `src/app/(marketing)/page.tsx`

**Interfaces:**
- Consumes: `Header` (Task 5), `Footer` (Task 6). The moved landing page is unchanged and still consumes `getPublicQuizzes` (Task 1).
- Produces: the shared marketing shell. Consumed by Tasks 8–11 (their pages render inside it).

- [ ] **Step 1: Read the Next 16 layout/route-group guide**

Run: `ls node_modules/next/dist/docs/01-app/` then read the routing/layouts guide to confirm route-group (`(folder)`) + nested layout conventions for 16.2.4.

- [ ] **Step 2: Create the marketing layout**

Create `src/app/(marketing)/layout.tsx`:

```tsx
import { Header } from '@/components/marketing/Header'
import { Footer } from '@/components/marketing/Footer'

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <Header />
      {children}
      <Footer />
    </>
  )
}
```

- [ ] **Step 3: Move the landing page into the group**

```bash
git mv src/app/page.tsx "src/app/(marketing)/page.tsx"
```

(No content change — the file already renders its own `<main className="scroll-smooth">`.)

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual check**

Run `pnpm dev`. Verify:
- `http://localhost:3000/` → header (logo left, nav center, "Log in" right) above the hero; footer at the bottom; URL is still `/`.
- `http://localhost:3000/dashboard` → NO marketing header (still its own sidebar). (Requires being logged in; if not, it redirects to `/` — that alone confirms the dashboard layout is untouched.)
- Resize narrow (`< 768px`): center nav hides, hamburger appears; clicking opens the sheet with the four links + auth action.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(marketing)/layout.tsx" "src/app/(marketing)/page.tsx" src/app/page.tsx
git commit -m "feat(marketing): wrap public pages in shared header/footer layout"
```

---

### Task 8: Community page

**Files:**
- Create: `src/app/(marketing)/community/page.tsx`

**Interfaces:**
- Consumes: `getPublicQuizzes` (Task 1), `QuizDirectory` from `@/components/landing/QuizDirectory` (existing; props `{ initialQuizzes, total }`). `QuizDirectory` uses `useSearchParams`, so it MUST be wrapped in `<Suspense>`.

- [ ] **Step 1: Create the community page**

Create `src/app/(marketing)/community/page.tsx`:

```tsx
import type { Metadata } from 'next'
import { Suspense } from 'react'
import { QuizDirectory } from '@/components/landing/QuizDirectory'
import { getPublicQuizzes } from '@/lib/quiz-queries'

export const metadata: Metadata = {
  title: 'Community Quizzes — QuEZ',
  description: 'Browse and play quizzes created by the QuEZ community.',
}

export default async function CommunityPage() {
  const { quizzes, total } = await getPublicQuizzes()

  return (
    <main className="px-6 pt-16">
      <div className="mx-auto max-w-7xl text-center">
        <h1 className="font-[family-name:var(--font-syne)] font-bold text-4xl sm:text-5xl text-foreground">
          Community Quizzes
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
          Browse quizzes built by educators and curious minds. Play, learn, and
          get inspired.
        </p>
      </div>
      <Suspense fallback={null}>
        <QuizDirectory initialQuizzes={quizzes} total={total} />
      </Suspense>
    </main>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual check**

Visit `http://localhost:3000/community`. Expected: header + heading + the quiz directory grid (or empty-state if DB has no public quizzes) + footer.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(marketing)/community/page.tsx"
git commit -m "feat(marketing): add community page"
```

---

### Task 9: Pricing page

**Files:**
- Create: `src/app/(marketing)/pricing/page.tsx`

**Interfaces:**
- Consumes: `Button`, `Link`, `Check` from `lucide-react`. Self-contained static content.

- [ ] **Step 1: Create the pricing page**

Create `src/app/(marketing)/pricing/page.tsx`:

```tsx
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
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual check**

Visit `http://localhost:3000/pricing`. Expected: three tier cards, Pro highlighted with lime "Most popular" badge + glow.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(marketing)/pricing/page.tsx"
git commit -m "feat(marketing): add pricing page"
```

---

### Task 10: Blog page

**Files:**
- Create: `src/app/(marketing)/blog/page.tsx`

**Interfaces:**
- Self-contained static content (no DB, no detail routes).

- [ ] **Step 1: Create the blog page**

Create `src/app/(marketing)/blog/page.tsx`:

```tsx
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Blog — QuEZ',
  description: 'Tips, product updates, and ideas for better quizzes from QuEZ.',
}

type Post = {
  emoji: string
  category: string
  title: string
  excerpt: string
  date: string
}

const POSTS: Post[] = [
  {
    emoji: '🚀',
    category: 'Product',
    title: 'Introducing AI-Powered Quiz Building',
    excerpt:
      'Describe your quiz in plain language and watch QuEZ assemble questions, answers, and explanations in seconds.',
    date: 'Jun 10, 2026',
  },
  {
    emoji: '🎯',
    category: 'Teaching',
    title: '5 Ways to Write Questions That Actually Test Understanding',
    excerpt:
      'Move beyond recall. Practical patterns for writing questions that measure real comprehension.',
    date: 'May 28, 2026',
  },
  {
    emoji: '🧠',
    category: 'Learning',
    title: 'The Science of Spaced Repetition for Quizzes',
    excerpt:
      'Why revisiting material on a schedule beats cramming — and how to build it into your quiz flow.',
    date: 'May 14, 2026',
  },
  {
    emoji: '🌍',
    category: 'Community',
    title: 'How Educators Are Sharing Quizzes Across the World',
    excerpt:
      'A look at the most-played community quizzes and the teachers behind them.',
    date: 'Apr 30, 2026',
  },
]

export default function BlogPage() {
  return (
    <main className="px-6 py-16">
      <div className="mx-auto max-w-7xl">
        <div className="text-center">
          <h1 className="font-[family-name:var(--font-syne)] font-bold text-4xl sm:text-5xl text-foreground">
            The QuEZ Blog
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            Product updates, teaching tips, and ideas for building better
            quizzes.
          </p>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {POSTS.map((post) => (
            <article
              key={post.title}
              className="flex flex-col rounded-2xl border border-border bg-card p-6"
            >
              <div className="flex h-32 items-center justify-center rounded-xl bg-secondary text-5xl">
                {post.emoji}
              </div>
              <div className="mt-4 text-xs font-medium text-accent-lime">
                {post.category}
              </div>
              <h2 className="mt-2 font-[family-name:var(--font-syne)] font-semibold text-lg leading-snug text-foreground">
                {post.title}
              </h2>
              <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">
                {post.excerpt}
              </p>
              <div className="mt-4 text-xs text-muted-foreground">
                {post.date}
              </div>
            </article>
          ))}
        </div>
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual check**

Visit `http://localhost:3000/blog`. Expected: responsive grid of 4 post cards.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(marketing)/blog/page.tsx"
git commit -m "feat(marketing): add blog page"
```

---

### Task 11: FAQ page (native `<details>`, zero JS)

**Files:**
- Create: `src/app/(marketing)/faq/page.tsx`

**Interfaces:**
- Self-contained. Uses native `<details>`/`<summary>` — no client component. The chevron rotation uses Tailwind's `group-open:` variant (`details` gets `class="group"`).

- [ ] **Step 1: Create the FAQ page**

Create `src/app/(marketing)/faq/page.tsx`:

```tsx
import type { Metadata } from 'next'
import { ChevronDown } from 'lucide-react'

export const metadata: Metadata = {
  title: 'FAQ — QuEZ',
  description: 'Answers to common questions about QuEZ, the AI quiz builder.',
}

type QA = { q: string; a: string }

const FAQS: QA[] = [
  {
    q: 'What is QuEZ?',
    a: 'QuEZ is an AI-powered quiz builder. Describe a topic in plain language and QuEZ generates questions, answers, and explanations you can edit, publish, and share.',
  },
  {
    q: 'Do I need an account to play quizzes?',
    a: 'No. Anyone can browse and play community quizzes. You only need an account to build and publish your own.',
  },
  {
    q: 'How do I sign in?',
    a: 'QuEZ uses Google sign-in. Click "Log in", continue with your Google account, and you are in — no passwords to remember.',
  },
  {
    q: 'Is QuEZ free?',
    a: 'Yes — the Free plan lets you create up to 5 quizzes with AI generation and public sharing. Paid plans unlock unlimited quizzes and more.',
  },
  {
    q: 'Can I edit what the AI generates?',
    a: 'Absolutely. Every generated question is fully editable — rewrite prompts, change answers, reorder, or delete before publishing.',
  },
  {
    q: 'Can I keep my quizzes private?',
    a: 'Private quizzes are available on the Pro and Team plans. On the Free plan, quizzes are public to the community.',
  },
]

export default function FaqPage() {
  return (
    <main className="px-6 py-16">
      <div className="mx-auto max-w-3xl">
        <div className="text-center">
          <h1 className="font-[family-name:var(--font-syne)] font-bold text-4xl sm:text-5xl text-foreground">
            Frequently asked questions
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            Everything you need to know about building and sharing quizzes.
          </p>
        </div>

        <div className="mt-12 space-y-3">
          {FAQS.map((item) => (
            <details
              key={item.q}
              className="group rounded-2xl border border-border bg-card px-6 py-4"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-foreground">
                {item.q}
                <ChevronDown className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {item.a}
              </p>
            </details>
          ))}
        </div>
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual check**

Visit `http://localhost:3000/faq`. Expected: 6 collapsible items; clicking a question expands the answer and rotates the chevron. Works with JS disabled (native `<details>`).

- [ ] **Step 4: Commit**

```bash
git add "src/app/(marketing)/faq/page.tsx"
git commit -m "feat(marketing): add FAQ page"
```

---

### Task 12: Final verification & DESIGN.md audit

**Files:** none (verification only).

- [ ] **Step 1: Full production build**

Run: `pnpm build`
Expected: compiles successfully, TypeScript passes, all routes listed (`/`, `/community`, `/pricing`, `/blog`, `/faq`, `/login`).

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 3: DESIGN.md color audit**

Run each — all must return NO matches:

```bash
grep -rn "oklch(0\." src --include=*.tsx
grep -rn "purple-" src --include=*.tsx
grep -rnE "(bg|text|border)-(green|yellow|red)-[0-9]" src --include=*.tsx
```

(The Google "G" SVG `fill="#..."` in `GoogleSignInButton.tsx` is the one allowed brand-asset exception and is not matched by these greps.)

- [ ] **Step 4: Manual smoke test**

Run `pnpm dev` and confirm:
- Header shows on `/`, `/community`, `/pricing`, `/blog`, `/faq`; absent on `/dashboard` and `/login`.
- Logged out → "Log in" (lime, links to `/login`). Logged in → avatar + "Dashboard" link.
- All four center nav links route correctly; footer links route correctly.
- Mobile (`< 768px`): hamburger opens the sheet with links + auth action; tapping a link closes it.
- `/login` → "Continue with Google" starts OAuth.

- [ ] **Step 5: Final commit (if anything was adjusted)**

```bash
git add -A
git commit -m "chore: verify marketing header build + design audit"
```

---

## Self-Review

**Spec coverage:**
- Header with logo (left) / nav (center) / login (right) → Task 5. ✓
- Login button → login page → Tasks 5 (link) + 3 (page). ✓
- Logo = text "QuEZ" → Task 2. ✓
- Community / Pricing / Blog / FAQ pages + routing → Tasks 8/9/10/11 + nav-links Task 2. ✓
- Server components for SEO → Header/Footer/pages all server; only `MobileNav` + `GoogleSignInButton` client; each page exports `metadata`. ✓
- `(marketing)` route group + dashboard untouched + login outside group → Task 7. ✓
- DESIGN.md compliance → Global Constraints + Task 12 audit. ✓
- Reuse existing `QuizDirectory` for community via extracted query → Tasks 1 + 8. ✓

**Placeholder scan:** No "TBD"/"TODO"/"similar to"/vague-handling steps — every file has complete code. ✓

**Type consistency:** `getPublicQuizzes()` returns `{ quizzes: PublicQuiz[]; total: number }`, consumed as `initialQuizzes`/`total` by `QuizDirectory` (structurally compatible). `NAV_LINKS` shape `{ href, label }` used identically in Header/MobileNav/Footer. `Header` passes `authSlot: React.ReactNode` matching `MobileNav`'s prop. `Logo({ className })` signature used in Header/Footer/Login. ✓
