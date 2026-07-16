# Responsive Multi-Device Adaptation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every QuEZ surface fully adaptive from 360px phones through tablets, desktops, and projected host screens (1920px+).

**Architecture:** Tailwind v4 mobile-first breakpoint refactor, page by page. Structure swaps (builder tabs) done with CSS visibility toggling so both panels stay mounted and no state is lost. Host game views get fluid `clamp()` type utilities for projector scaling. Playwright viewport sweep guards public pages; auth-gated pages get manual verification (Google-only OAuth makes automated login infeasible).

**Tech Stack:** Next.js 16.2.4 (App Router, custom `server.mjs`), React 19, Tailwind CSS v4, shadcn/ui (with `SidebarProvider` + `useIsMobile` already present), Playwright (added by this plan), vitest (existing, untouched).

**Spec:** `docs/superpowers/specs/2026-07-15-responsive-multi-device-design.md`

## Global Constraints

- Minimum supported width: **360px**. Zero horizontal overflow on every page at every viewport ≥360px.
- Touch targets ≥44×44px on mobile; interactive rows/buttons users tap during games ≥`min-h-14`.
- Text inputs that receive focus on mobile use ≥16px font (`text-base`) to prevent iOS zoom-on-focus.
- Use `dvh` units, never `vh`/`h-screen`, on layouts with bottom-pinned inputs.
- **Layout-only change:** do not alter colors, tokens, fonts, shadows, or any theme value. The `DESIGN.md` neo-brutalism migration is separate work.
- Tailwind default breakpoints only (`sm:` 640, `md:` 768, `lg:` 1024, `xl:` 1280). Mobile-first: base classes = phone, desktop layouts activate at `lg:`.
- No hover-gated actions: anything reachable only via `group-hover` must also be visible/tappable below `lg:`.
- Per `AGENTS.md`: this repo's Next.js has breaking changes — before using any Next.js API that is not already present in the file you're editing, read the relevant guide in `node_modules/next/dist/docs/`.
- Conventional commits, one commit per task, ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Spec deviations (decided at planning)

1. **Playwright coverage limited to public routes.** Auth is Google OAuth only (`src/lib/auth.ts` has no email/password), so dashboard/builder/host routes cannot be swept automatically without adding a test-only auth backdoor (rejected: YAGNI, security surface). Those surfaces get exact manual verification steps in Task 7 instead.
2. **Host podium does not stack vertically on phones.** Three podium blocks at `w-20` (240px + gaps) fit inside 360px; shrinking beats stacking, which would destroy the podium visual. Spec's "stack vertically" line is superseded by this.
3. **Container queries deferred.** The spec allowed `@container` for `QuestionCard`/answer grids. The builder's mobile tab layout gives each panel full viewport width, so viewport breakpoints stay accurate there, and game answer grids get direct breakpoint treatment (Tasks 5–6). If the Task 7 device pass finds a component misrendering inside the narrow desktop chat/preview column (~280–380px), fix that one component with Tailwind `@container`/`@sm:` variants — do not introduce them speculatively.

---

### Task 1: Playwright infrastructure + public-page viewport sweep

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/responsive.spec.ts`
- Modify: `package.json` (devDependency + script)

**Interfaces:**
- Consumes: dev server via `pnpm dev` (custom `server.mjs`, port 3000). Requires a working `.env` with database credentials — same requirement as normal local dev.
- Produces: `pnpm test:e2e` script and the sweep spec that Tasks 2 and 7 run as their gate. Vitest is unaffected: its `include` is `src/**/*.test.ts`, so `e2e/*.spec.ts` never collides.

- [ ] **Step 1: Install Playwright**

```bash
pnpm add -D @playwright/test
pnpm exec playwright install chromium
```

- [ ] **Step 2: Create `playwright.config.ts`**

```ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: { baseURL: 'http://localhost:3000' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
```

- [ ] **Step 3: Add script to `package.json`**

In the `"scripts"` block, after `"test:watch"`:

```json
"test:e2e": "playwright test",
```

- [ ] **Step 4: Write the sweep spec `e2e/responsive.spec.ts`**

```ts
import { test, expect } from '@playwright/test'

const VIEWPORTS = [
  { name: 'phone', width: 360, height: 740 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'laptop', width: 1024, height: 768 },
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'projector', width: 1920, height: 1080 },
]

const PUBLIC_ROUTES = ['/', '/pricing', '/faq', '/blog', '/community', '/join', '/login']

for (const vp of VIEWPORTS) {
  for (const route of PUBLIC_ROUTES) {
    test(`${route} has no horizontal overflow at ${vp.name} (${vp.width}px)`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await page.goto(route)
      await page.waitForLoadState('networkidle')
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }))
      expect(overflow.scrollWidth, 'page must not scroll horizontally').toBeLessThanOrEqual(
        overflow.clientWidth
      )
    })
  }
}
```

- [ ] **Step 5: Run the sweep to record the baseline**

Run: `pnpm test:e2e`
Expected: some tests may FAIL (that's the point — they define Task 2's work). Record which route×viewport combinations fail. If all pass, Task 2 becomes a visual audit only.

- [ ] **Step 6: Commit**

```bash
git add playwright.config.ts e2e/responsive.spec.ts package.json pnpm-lock.yaml
git commit -m "test: add Playwright viewport sweep for public pages"
```

---

### Task 2: Marketing surface fixes

**Files:**
- Modify: `src/components/landing/Hero.tsx:14,51,76`
- Modify: any marketing page the Task 1 baseline flagged (`src/app/(marketing)/*.tsx`, `src/components/landing/QuizDirectory.tsx`, `src/components/marketing/Footer.tsx`)
- Test: `e2e/responsive.spec.ts` (existing, is the gate)

**Interfaces:**
- Consumes: Task 1's sweep spec.
- Produces: all marketing + `/join` + `/login` sweep tests green.

- [ ] **Step 1: Fix Hero for 360px**

In `src/components/landing/Hero.tsx`:

Line 14 — section padding:
```tsx
<section className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden px-4 sm:px-6">
```

Line 51 — h1 scales down one step on phones:
```tsx
className="font-display font-bold text-4xl sm:text-6xl lg:text-7xl text-foreground leading-[1.2] tracking-tight animate-fade-up"
```

Line 76 — stats row wraps instead of squeezing:
```tsx
<div className="mt-16 flex flex-wrap gap-x-8 gap-y-4 justify-center animate-fade-up animate-fade-up-delay-3">
```

- [ ] **Step 2: Fix every baseline failure from Task 1**

For each failing route×viewport, open the page at that width (`pnpm dev`, devtools responsive mode), find the overflowing element (in console: `[...document.querySelectorAll('*')].filter(e => e.scrollWidth > document.documentElement.clientWidth)`), and apply the matching pattern:

| Symptom | Fix |
|---|---|
| Fixed-width card/row wider than viewport | replace fixed `w-*` with `w-full max-w-*` |
| Multi-column grid squeezed | `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` |
| Horizontal flex row of items | add `flex-wrap` |
| Long unbroken string (URL, code) | add `break-all` or `truncate` |
| Large fixed padding | `p-4 sm:p-6 lg:p-8` |

These are the only sanctioned fix shapes — no redesigns, no theme changes.

- [ ] **Step 3: Run sweep to verify green**

Run: `pnpm test:e2e`
Expected: PASS — all 35 tests.

- [ ] **Step 4: Lint and commit**

```bash
pnpm lint
git add -A src/
git commit -m "fix(marketing): responsive layout down to 360px"
```

---

### Task 3: Dashboard shell — mobile header, page padding, billing cards

**Files:**
- Modify: `src/app/dashboard/layout.tsx`
- Modify: `src/app/dashboard/page.tsx:44-61,99-105`
- Modify: `src/app/dashboard/billing/page.tsx:38,60-115`

**Interfaces:**
- Consumes: shadcn sidebar primitives in `src/components/ui/sidebar.tsx` — `SidebarTrigger` (already exported; on mobile it opens the sidebar as a Sheet automatically, breakpoint 768px via `src/hooks/use-mobile.ts`).
- Produces: dashboard pages usable at 360px. No new exports.

- [ ] **Step 1: Add mobile header with sidebar trigger to `src/app/dashboard/layout.tsx`**

Replace the return block:

```tsx
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar'
```

```tsx
  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar />
      <SidebarInset>
        <div className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b-2 border-border bg-background px-4 md:hidden">
          <SidebarTrigger className="size-9" />
          <span className="font-display font-bold text-lg text-foreground">
            <span className="text-primary">Q</span>uE<span className="inline-block -rotate-6 text-primary">Z</span>
          </span>
        </div>
        {children}
      </SidebarInset>
    </SidebarProvider>
  )
```

Note: the desktop sidebar already hides itself below `md` (shadcn built-in) — this header is the only way to open it there, hence `md:hidden`.

- [ ] **Step 2: Make `src/app/dashboard/page.tsx` stack on phones**

Line 44: `<div className="p-4 sm:p-6 lg:p-8 max-w-6xl">`

Lines 45–61 — header stacks, actions wrap:
```tsx
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="font-display font-bold text-2xl sm:text-3xl text-foreground">
            My Dashboard
          </h1>
          <p className="text-muted-foreground mt-1">Manage your quizzes and track performance</p>
        </div>
        <div className="flex items-center gap-3">
          <CreditsPill balance={balance} />
          <Link href="/dashboard/quizzes/new">
            <Button className="bg-primary text-primary-foreground rounded-full gap-2 font-semibold shadow-brutal hover:bg-primary/90">
              <Sparkles className="w-4 h-4" />
              New Quiz
            </Button>
          </Link>
        </div>
      </div>
```

Lines 100–105 — FAB clears thumbs + notch:
```tsx
        <button className="fixed bottom-4 right-4 sm:bottom-8 sm:right-8 mb-[env(safe-area-inset-bottom)] flex items-center gap-2 bg-primary text-primary-foreground rounded-full px-5 h-12 font-semibold shadow-brutal border-2 border-border hover:bg-primary/90 transition-colors">
```

- [ ] **Step 3: Billing — stacked cards on phone, table from `md:`**

In `src/app/dashboard/billing/page.tsx`:

Line 38: `<div className="p-4 sm:p-6 lg:p-8 max-w-4xl">`

Replace the table block (lines 64–114). Keep the existing `<table>` exactly as-is but wrap it in `hidden md:block`, and add a mobile card list before it:

```tsx
        <div className="space-y-3 md:hidden">
          {transactions.map((tx) => {
            const meta = tx.metadata as Record<string, unknown> | null
            const detail = txDetail(meta)
            const quizId = typeof meta?.quizId === 'string' ? meta.quizId : null
            return (
              <div key={tx.id} className="rounded-2xl border border-border bg-card p-4 text-sm space-y-1">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-foreground font-medium">{txLabel(tx.type, meta)}</span>
                  <span className={cn('font-medium whitespace-nowrap', tx.amount >= 0 ? 'text-accent' : 'text-foreground')}>
                    {tx.amount >= 0 ? '+' : ''}
                    {tx.amount.toFixed(2)}
                  </span>
                </div>
                {detail && <p className="text-muted-foreground text-xs">{detail}</p>}
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {tx.createdAt.toLocaleDateString('en-US')}{' '}
                    {tx.createdAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span>Balance: {formatCredits(tx.balanceAfter)}</span>
                </div>
                {quizId && (
                  <Link href={`/dashboard/quizzes/${quizId}`} className="text-accent text-xs hover:underline">
                    View quiz
                  </Link>
                )}
              </div>
            )
          })}
        </div>
        <div className="hidden md:block rounded-2xl border border-border bg-card overflow-x-auto">
          {/* existing <table> unchanged */}
        </div>
```

- [ ] **Step 4: Verify manually**

Run: `pnpm dev`, open `http://localhost:3000/dashboard` signed in, devtools responsive mode.
Check at 360px: hamburger opens sidebar sheet; header stacked; FAB not clipped. At 360px on `/dashboard/billing`: cards, no table, no horizontal scroll. At 1024px: sidebar inline, table back.

- [ ] **Step 5: Lint and commit**

```bash
pnpm lint
git add src/app/dashboard/
git commit -m "feat(dashboard): mobile header with sidebar drawer, responsive pages"
```

---

### Task 4: Builder — Chat/Editor tabs on mobile

**Files:**
- Modify: `src/components/builder/QuizEditor.tsx:75-80,178-240`
- Modify: `src/components/builder/ChatPanel.tsx:378,494-517`

**Interfaces:**
- Consumes: `cn` from `@/lib/utils` (existing).
- Produces: no API change — `QuizEditor` props unchanged. Both panels stay mounted at all widths (CSS `hidden` toggling), so `ChatPanel` internal state and quiz draft survive tab switches and window resizes by construction.

- [ ] **Step 1: Add tab state and restructure the QuizEditor shell**

In `src/components/builder/QuizEditor.tsx`, add to imports:

```tsx
import { cn } from '@/lib/utils'
```

Inside the component (next to the other `useState` calls, line ~78):

```tsx
const [activeTab, setActiveTab] = useState<'chat' | 'editor'>('chat')
```

Replace the outer shell (lines 178–193, everything from `return (` down to the editor `<div className="flex-1 overflow-y-auto bg-background">`):

```tsx
  return (
    <div className="flex h-dvh flex-col lg:flex-row">
      {/* Mobile tab bar */}
      <div className="flex shrink-0 border-b-2 border-border bg-card lg:hidden">
        {(['chat', 'editor'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'flex-1 h-12 text-sm font-semibold capitalize transition-colors',
              activeTab === tab
                ? 'text-foreground border-b-2 border-primary -mb-0.5'
                : 'text-muted-foreground'
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Chat — full width on mobile (when active), 28% column on lg+ */}
      <div
        className={cn(
          'min-h-0 flex-1 lg:flex-none lg:w-[28%] lg:min-w-[280px] lg:max-w-[380px]',
          activeTab !== 'chat' && 'hidden lg:block'
        )}
      >
        <ChatPanel
          onQuizUpdate={handleAgentUpdate}
          initialQuiz={quiz}
          quizId={initialQuiz.id}
          initialMessages={initialMessages}
          initialTree={initialTree}
          initialRows={initialRows}
        />
      </div>

      {/* Editor — rest */}
      <div
        className={cn(
          'min-h-0 flex-1 overflow-y-auto bg-background',
          activeTab !== 'editor' && 'hidden lg:block'
        )}
      >
```

The rest of the editor JSX (header + body) stays inside this div unchanged except for Steps 2–3. `h-screen` → `h-dvh` is deliberate (mobile keyboard, Global Constraints).

- [ ] **Step 2: Compress the editor header on mobile**

Line 195 — padding:
```tsx
<div className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur px-3 py-3 lg:px-6 lg:py-4">
```

Line 196 — allow wrap so action buttons drop to a second row at narrow widths:
```tsx
<div className="flex flex-wrap items-center gap-2 lg:gap-3">
```

Line 236 — Save button label hides on the narrowest screens (icon remains):
```tsx
{saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
<span className="hidden sm:inline">{dirty ? 'Save changes' : 'Saved'}</span>
```

Line 243 — body padding: `<div className="p-4 sm:p-6 space-y-6 max-w-3xl mx-auto">`

- [ ] **Step 3: ChatPanel — touch fixes**

In `src/components/builder/ChatPanel.tsx`:

Line 378 — right border only when it's a column (lg+); pad the pinned input area's container for notches by adding safe-area padding to the root:
```tsx
<div className="flex flex-col h-full bg-card lg:border-r-2 border-border pb-[env(safe-area-inset-bottom)]">
```

Lines 494, 503, 511, 517 — four hover-gated message action buttons use `opacity-0 group-hover:opacity-100`. On touch there is no hover. Change each occurrence of:
```
opacity-0 group-hover:opacity-100
```
to:
```
opacity-100 lg:opacity-0 lg:group-hover:opacity-100
```

- [ ] **Step 4: Verify manually**

Run: `pnpm dev`, open a quiz in the builder.
- At 1280px: identical to before — chat column left, editor right, no tab bar.
- At 390px: tab bar shows; Chat tab = full-screen chat with input pinned bottom; Editor tab = full editor. Type a chat message draft, switch tabs and back — draft still there. Edit the title, switch tabs and back — edit still there. Resize 390→1280→390: nothing lost, layout correct.
- Message action buttons visible without hover at 390px.

- [ ] **Step 5: Run tests, lint, commit**

```bash
pnpm test
pnpm lint
git add src/components/builder/
git commit -m "feat(builder): chat/editor tabs on mobile, touch-friendly actions"
```

---

### Task 5: Host game views — projector fluid type + phone hosting

**Files:**
- Modify: `src/app/globals.css` (utilities layer, after `.shadow-brutal-lg`)
- Modify: `src/components/game/HostWaitingRoom.tsx:26-69`
- Modify: `src/components/game/HostQuestionLive.tsx:26-60`
- Modify: `src/components/game/HostReveal.tsx:35-85`
- Modify: `src/components/game/HostPodium.tsx:18,44`
- Modify: `src/components/game/HostGameView.tsx:102`

**Interfaces:**
- Consumes: existing `@layer utilities` block in `globals.css`.
- Produces: three CSS utility classes used by all four host views — `text-fluid-hero`, `text-fluid-question`, `text-fluid-answer`. Task 6 does NOT use them (student screens are handheld; fixed sizes suffice).

- [ ] **Step 1: Add fluid type utilities to `src/app/globals.css`**

Inside the existing `@layer utilities` block, after `.shadow-brutal-lg`:

```css
  /* Fluid projector type (responsive spec §Foundations). Scales with
     viewport width so host screens read from the back of a room at
     1920px+ without a breakpoint ladder. */
  .text-fluid-hero {
    font-size: clamp(2.5rem, 1.5rem + 4vw, 6rem); /* room PIN */
    line-height: 1.1;
  }
  .text-fluid-question {
    font-size: clamp(1.5rem, 1rem + 1.8vw, 3.25rem);
    line-height: 1.25;
  }
  .text-fluid-answer {
    font-size: clamp(0.875rem, 0.65rem + 0.7vw, 1.5rem);
    line-height: 1.4;
  }
```

- [ ] **Step 2: HostWaitingRoom**

In `src/components/game/HostWaitingRoom.tsx`:

Line 26: `<div className="max-w-3xl xl:max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-8 text-center">`

Line 29 (title): `<h1 className="font-display font-bold text-fluid-question text-foreground">{quizTitle}</h1>`

Line 35 (PIN): `<p className="font-display font-bold text-fluid-hero text-primary tabular-nums tracking-widest">`

Lines 61–66 (Start button, full-width on phone):
```tsx
        size="lg"
        className="w-full sm:w-auto gap-2 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 font-semibold shadow-brutal border-2 border-border"
```

- [ ] **Step 3: HostQuestionLive**

In `src/components/game/HostQuestionLive.tsx`:

Line 26: `<div className="max-w-2xl xl:max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-6 text-center">`

Line 27 (progress/timer row, larger at distance): `<div className="flex items-center justify-between text-sm xl:text-xl text-muted-foreground">`

Line 40 (question): `<h1 className="font-display font-bold text-fluid-question text-foreground leading-snug">`

Line 44 (answer grid): `<div className="grid grid-cols-1 sm:grid-cols-2 gap-2 xl:gap-4">`

Line 48 (option rows): `className="flex items-center gap-3 px-4 py-3 xl:px-6 xl:py-5 rounded-xl border border-border bg-card text-left text-fluid-answer"`

Line 58 (answered count): `<p className="text-accent font-semibold xl:text-2xl">`

- [ ] **Step 4: HostReveal**

In `src/components/game/HostReveal.tsx`:

Line 35: `<div className="max-w-2xl xl:max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-6">`

Line 36 (question): `<h1 className="font-display font-semibold text-fluid-question text-foreground text-center">`

Line 40 (grid): `<div className="grid grid-cols-1 sm:grid-cols-2 gap-2 xl:gap-4">`

Line 45 (inside `cn(...)`, first string): `'flex items-center gap-3 px-4 py-3 xl:px-6 xl:py-5 rounded-xl border text-left text-fluid-answer',`

Line 65 (leaderboard rows): `<div key={p.id} className="flex items-center justify-between px-4 py-2.5 text-sm xl:text-lg xl:py-3.5">`

- [ ] **Step 5: HostPodium + HostGameView**

`src/components/game/HostPodium.tsx` line 18 — blocks shrink on phone, grow on projector:
```tsx
<div className={`flex flex-col items-center gap-2 w-20 sm:w-24 xl:w-32 ${delayClass}`}>
```
Line 44: `<div className="max-w-2xl xl:max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-8 text-center">`

`src/components/game/HostGameView.tsx` line 102 — mute button gets a ≥44px hit area:
```tsx
className="fixed top-2 right-2 sm:top-4 sm:right-4 z-10 p-2.5 text-muted-foreground hover:text-foreground transition-colors"
```

- [ ] **Step 6: Verify manually**

Run: `pnpm dev`. Host a live game (needs a quiz with questions).
- At 1920×1080: PIN ≈96px, question ≈52px — readable across a room; answers 2-col with generous padding.
- At 390px: everything fits, Start button full-width, no overflow through waiting room → question → reveal → podium.

- [ ] **Step 7: Lint and commit**

```bash
pnpm lint
git add src/app/globals.css src/components/game/
git commit -m "feat(game): fluid projector type for host views, phone hosting layout"
```

---

### Task 6: Student game, join, solo play — touch polish

**Files:**
- Modify: `src/components/game/JoinForm.tsx:59-91`
- Modify: `src/components/game/StudentQuestionLive.tsx:77-121`
- Modify: `src/components/game/StudentReveal.tsx`, `src/components/game/StudentPodium.tsx`, `src/components/game/StudentWaitingRoom.tsx` (audit, same rules)
- Modify: `src/components/quiz/QuizPlayer.tsx` (audit, same rules)

**Interfaces:**
- Consumes: nothing new.
- Produces: no API changes.

- [ ] **Step 1: JoinForm**

In `src/components/game/JoinForm.tsx`:

Line 59: `<form onSubmit={handleSubmit} className="max-w-sm mx-auto px-4 sm:px-6 py-10 sm:py-16 space-y-5 text-center">`

Line 75–80 (nickname input — 16px font + height):
```tsx
          <Input
            value={nickname}
            onChange={(e) => setNickname(e.target.value.slice(0, 20))}
            placeholder="Your name"
            maxLength={20}
            className="h-12 text-base"
          />
```

Line 84–88 (Join button): add `h-12` to its className string:
```tsx
className="w-full h-12 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 font-semibold shadow-brutal border-2 border-border"
```

- [ ] **Step 2: StudentQuestionLive — thumb-sized answers**

In `src/components/game/StudentQuestionLive.tsx`:

Line 77: `<div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">`

Line 87 (option grid — 2 cols in landscape orientation, which also covers desktop; portrait stays 1 col): `<div className="grid grid-cols-1 landscape:grid-cols-2 gap-2">`

Line 97 (option buttons, inside `cn(...)` first string):
```tsx
'flex items-center gap-3 px-4 py-3 min-h-14 rounded-xl border text-base text-left transition-all',
```

Line 114–121 (Submit): add `h-12` alongside `w-full` in its className.

- [ ] **Step 3: Audit remaining student views + QuizPlayer with the same rules**

For each of `StudentReveal.tsx`, `StudentPodium.tsx`, `StudentWaitingRoom.tsx`, `QuizPlayer.tsx` apply exactly these rules where the pattern appears (no other changes):
- container `px-6` → `px-4 sm:px-6`; `py-10`/`py-16` → `py-6 sm:py-10`
- any `<button>` the player taps during play: ensure `min-h-14 text-base` (answer options) or `h-12` (single actions)
- any horizontal flex of badges/names: ensure `flex-wrap`
- any player-supplied string (nickname, answer, title): ensure `truncate` or `break-words` on its element

- [ ] **Step 4: Verify manually**

Run: `pnpm dev`. Join a game from devtools at 360×740: answer buttons ≥56px tall, nickname input doesn't trigger zoom (16px font), no overflow through waiting → question → reveal → podium. Rotate to landscape (740×360): options go 2-col. Play a solo quiz at `/play/[id]` at 360px: same checks.

- [ ] **Step 5: Test, lint, commit**

```bash
pnpm test
pnpm lint
git add src/components/game/ src/components/quiz/
git commit -m "feat(game): touch-sized student and solo play controls"
```

---

### Task 7: Full verification pass

**Files:**
- Test: `e2e/responsive.spec.ts` (run), full manual checklist below

- [ ] **Step 1: Run the full automated suite**

```bash
pnpm lint
pnpm test
pnpm test:e2e
pnpm build
```
Expected: all PASS / build succeeds. Fix anything that fails before proceeding (fixes belong to the task that introduced them; amend nothing — new `fix:` commit).

- [ ] **Step 2: Manual device checklist (real phone, not emulator)**

On an actual phone against the dev server (`pnpm dev`, phone on same network):
1. Builder: tab bar works; chat input stays visible with keyboard open (dvh check); draft + chat survive tab switches; message actions tappable.
2. Dashboard: drawer opens/closes; billing shows cards.
3. Live game as student: join form no zoom-on-focus; answers thumb-sized; landscape 2-col; safe-area clearance on notched device.
4. Live game as host on the phone: waiting room controls reachable, Start full-width.
5. Desktop 1920px (or TV): host question readable from ~5m.

Record any failure as a new `fix:` task before closing the plan.

- [ ] **Step 3: Final commit (if fixes were made)**

```bash
git add -A
git commit -m "fix: responsive polish from device verification pass"
```
