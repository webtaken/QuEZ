# Marketing Header & Public Pages — Design

**Date:** 2026-06-17
**Status:** Approved

## Goal

Add a site-wide marketing header to QuEZ's public landing experience, plus the
destination pages its navigation points to. The header has three regions:

1. **Left:** the QuEZ text logo.
2. **Middle:** nav links — Community, Pricing, Blog, FAQ — each routing to its own page.
3. **Right:** a Log in button that routes to a dedicated login page.

A primary constraint: maximize server-rendered content for SEO. Only genuinely
interactive fragments are client components.

## Stack context

- Next.js **16.2.4**, App Router, React 19.2.4. APIs may differ from older Next —
  implementation must verify routing/`metadata` APIs against `node_modules/next/dist/docs/`
  before coding (per `AGENTS.md`).
- Auth: **better-auth**, **Google OAuth only** (no email/password). Client helpers
  `signIn`/`signOut`/`useSession` from `@/lib/auth-client`; server session via
  `auth.api.getSession({ headers: await headers() })` from `@/lib/auth`.
- UI: shadcn primitives (`@base-ui/react` + CVA) in `src/components/ui/`, Tailwind 4.
- Theme: dark-first, deep navy + lime. **All styling per `DESIGN.md`** — token colors
  only, `font-syne` headings, `rounded-2xl` cards, no hardcoded color values.

## Architecture — `(marketing)` route group

A Next.js route group shares one layout (header + footer) across the public pages
without altering URLs. Dashboard is untouched and keeps its own sidebar. The login
page sits outside the group so it gets no header — a clean, focused page.

```
src/app/
  layout.tsx                      # unchanged (html/body/fonts/Toaster/TooltipProvider)
  (marketing)/
    layout.tsx                    # NEW server: <Header/> + {children} + <Footer/>
    page.tsx                      # MOVED from src/app/page.tsx → URL stays "/"
    community/page.tsx            # NEW
    pricing/page.tsx              # NEW
    blog/page.tsx                 # NEW
    faq/page.tsx                  # NEW
  login/page.tsx                  # NEW — outside the group, no header
  dashboard/...                   # untouched
```

Moving the landing into `(marketing)/page.tsx` keeps the URL `/` (route groups do not
affect paths). The root `src/app/layout.tsx` is unchanged.

## Components

```
src/components/marketing/
  Header.tsx          # SERVER async — session read, logo + nav + auth slot, sticky
  Logo.tsx            # SERVER — QuEZ wordmark (extracted from Sidebar), links to "/"
  nav-links.ts        # shared NAV array (Community/Pricing/Blog/FAQ → routes)
  MobileNav.tsx       # CLIENT — hamburger → Sheet with nav links + auth action
  Footer.tsx          # SERVER — nav links + copyright
src/components/auth/
  GoogleSignInButton.tsx  # CLIENT — signIn.social({ provider:'google', callbackURL:'/dashboard' })
src/lib/
  quiz-queries.ts     # extract getPublicQuizzes() from page.tsx → reused by landing + community
```

### Server/client split (the SEO-critical part)

- **`Header` is a server component.** Per request it reads
  `auth.api.getSession({ headers: await headers() })`, wrapped in try/catch so a DB
  failure degrades to the logged-out view instead of breaking render (mirrors the
  existing pattern in `page.tsx`).
  - **Logged-out** → "Log in" rendered as a styled `<Link href="/login">` (no JS).
  - **Logged-in** → `<Avatar>` (user image/initials) + a "Dashboard" `<Link>`.
    Sign-out is not in the header — it stays in the dashboard sidebar.
- The header's login control only **navigates** to `/login`. The Google OAuth call
  lives solely on the login page (`GoogleSignInButton`, client). So on desktop the
  header needs no client JS; the only client island is `MobileNav` (the `Sheet` toggle).
- **Logo** reuses the wordmark treatment already in `Sidebar.tsx`:
  `Q` (lime, larger) + `uE` + `Z` (lime, `-rotate-6`), Syne font. Extracted to a shared
  `Logo.tsx` and used by both the header and the login page.

### Header layout & styling

- `sticky top-0 z-50`, translucent: `bg-background/80 backdrop-blur border-b border-border`.
  Sits over the hero (which is `min-h-screen`) and pins on scroll across all pages.
- Three-region flex: logo left, nav centered (`hidden md:flex`), auth slot right.
- Mobile (`< md`): nav collapses into `MobileNav` (hamburger → `Sheet` from
  `src/components/ui/sheet.tsx`) containing the nav links and the auth action.

## Page content (all server-rendered; each exports `metadata`)

Every page exports a `metadata` object (title + description) for SEO.

- **Community** (`/community`) — page heading + reuse the existing `<QuizDirectory>`,
  fed by the extracted `getPublicQuizzes()`. Same data the landing uses.
- **Pricing** (`/pricing`) — three `rounded-2xl` tier cards (Free / Pro / Team) with
  feature lists. The recommended tier gets a lime CTA (`bg-accent-lime
  text-accent-lime-foreground`); others use `outline`/`secondary` Button variants.
- **Blog** (`/blog`) — responsive grid (`grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6`)
  of ~4 static post cards (cover emoji/category/title/excerpt/date). Static content
  array in the page file. No individual post detail pages (YAGNI).
- **FAQ** (`/faq`) — ~6 Q&A built with native `<details>`/`<summary>` elements: accordion
  behavior with zero JS, fully server-rendered, ideal for SEO. Styled with tokens.
- **Login** (`/login`) — centered card on `dot-grid` background; `Logo`, a heading,
  the "Continue with Google" button (`GoogleSignInButton`), and a back-to-home link.

## Data flow

- **Session:** read per request inside `Header` (server).
- **Quizzes:** `getPublicQuizzes()` extracted from `page.tsx` into `src/lib/quiz-queries.ts`;
  landing and community both call it. Returns `{ quizzes, total }`.
- **Static content:** pricing tiers, blog posts, and FAQ items are plain arrays defined
  in their respective page files — no DB, no new data layer.

## Error handling

- Header session read in try/catch → logged-out fallback if the DB is unavailable.
- `getPublicQuizzes()` keeps the existing try/catch returning `{ quizzes: [], total: 0 }`.
- Login: `signIn.social` failures surface via the existing sonner `Toaster`
  (already mounted in the root layout).

## Testing & verification

No test framework is present in the repo (no test deps in `package.json`). Verification:

- `pnpm build` (`next build`) compiles clean and TypeScript passes.
- Manual check: header renders on all 5 public pages and not on dashboard; nav links
  route correctly; logged-out shows "Log in", logged-in shows avatar + "Dashboard";
  mobile hamburger opens the sheet; login page completes Google OAuth to `/dashboard`.
- DESIGN.md compliance re-audit:
  `grep -rn "oklch(0\." src --include=*.tsx` and the green/yellow/red/purple greps → no matches.

## File summary

**New:**
- `src/app/(marketing)/layout.tsx`
- `src/app/(marketing)/community/page.tsx`
- `src/app/(marketing)/pricing/page.tsx`
- `src/app/(marketing)/blog/page.tsx`
- `src/app/(marketing)/faq/page.tsx`
- `src/app/login/page.tsx`
- `src/components/marketing/Header.tsx`
- `src/components/marketing/Logo.tsx`
- `src/components/marketing/nav-links.ts`
- `src/components/marketing/MobileNav.tsx`
- `src/components/marketing/Footer.tsx`
- `src/components/auth/GoogleSignInButton.tsx`
- `src/lib/quiz-queries.ts`

**Moved:**
- `src/app/page.tsx` → `src/app/(marketing)/page.tsx` (URL `/` unchanged; landing query
  extracted to `src/lib/quiz-queries.ts`).

## Out of scope (YAGNI)

- Individual blog post detail pages.
- Email/password auth (only Google is configured).
- Sign-out from the header (lives in dashboard sidebar).
- Header on the dashboard (it has its own sidebar).
- Real pricing/blog/FAQ CMS or DB content — static arrays only.
