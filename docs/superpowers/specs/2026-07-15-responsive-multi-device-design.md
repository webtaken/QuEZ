# Responsive Multi-Device Adaptation — Design Spec

**Date:** 2026-07-15
**Status:** Approved
**Scope:** Entire app — marketing, dashboard, builder, host game, student game, join, solo play.
**Quality bar:** Fully adaptive — layouts restructure per device, not merely "nothing broken."

## Goals

- Every surface works from 360px phones through tablets, desktops, and projected host screens (1920px+).
- Mobile gets native-feeling patterns (tabs, drawer, thumb-sized targets), not squeezed desktop layouts.
- Host game views are readable from the back of a classroom when projected.

## Non-goals

- No theme/visual changes — the neo-brutalism migration in `DESIGN.md` is tracked separately. This work changes layout only.
- No separate mobile components/routes; one component tree adapts.
- No native apps or PWA work.

## Approach

Tailwind mobile-first breakpoints, page by page (approach A), with container queries
sprinkled where a component renders at very different widths in different contexts
(approach C, limited to `QuestionCard` and answer grids).

### Foundations

**Breakpoints** — Tailwind defaults, mobile-first (base styles = phone):

| Range | Meaning |
|---|---|
| base `<640px` | Phone |
| `sm:` 640px | Large phone / small tablet |
| `md:` 768px | Tablet portrait |
| `lg:` 1024px | Tablet landscape / laptop — desktop layouts activate here |
| `xl:` 1280px | Desktop |

- No custom breakpoints. Minimum supported width: **360px**, zero horizontal overflow.
- **Projector scaling:** host game views use fluid type via `clamp(min, vw-based, max)`
  on question text, answers, leaderboard, and game PIN. Scales continuously to 1080p+
  projection with no extra breakpoints and no JS.
- **Touch rules:** minimum 44×44px tap targets; inputs/buttons `h-11`+ on mobile;
  inputs use ≥16px font to prevent iOS zoom-on-focus; no hover-gated actions —
  dropdowns/tooltips must open on tap.
- **Structure swaps** (JS): only via the existing shadcn `useIsMobile` hook, and only
  where CSS cannot express the change — builder tabs and dashboard nav drawer.
  Everything else is pure CSS.
- **Container queries:** Tailwind v4 native `@container` for `QuestionCard` and answer
  grids only (they render in the ~300px builder preview and fullscreen game).
- **Safe areas:** `env(safe-area-inset-*)` padding on fixed bottom bars (builder chat
  input, builder tab bar) for notched phones.
- **Viewport units:** pinned-input screens use `dvh`, never `vh`, so the mobile
  keyboard doesn't hide inputs or cause double scrolling.

### Constraint

Per `AGENTS.md`, this repo's Next.js version has breaking changes. Implementation must
read the relevant guides in `node_modules/next/dist/docs/` before touching layout or
viewport-related APIs.

## Surface-by-surface design

### Marketing (`src/app/(marketing)/*`)

Mostly healthy — `MobileNav` exists. Sweep for: hero type scaling down, pricing cards
stacking, quiz directory grid `1 → 2 → 3` columns, footer columns stacking. Low effort.

### Dashboard (`/dashboard`, quizzes list, billing)

- Sidebar already uses shadcn `SidebarProvider` — mobile drawer behavior is built in.
  Add a mobile header bar with hamburger trigger.
- Quiz cards grid: `1 → 2 → 3` columns.
- Billing tables become stacked cards on phone.

### Builder (`/dashboard/quizzes/[id]`) — biggest rework

- **Desktop (`lg:`+):** unchanged — chat panel `28%` (280–380px), editor fills the rest.
- **Phone / tablet portrait (below `lg:`):** tab layout `[Chat | Editor]`, each tab full
  height, sticky tab bar. Chat input stays pinned to the bottom with safe-area padding.
- Editor header compresses on mobile: icon-only buttons, truncating title.
- `useIsMobile` swaps the structure. Draft quiz and chat state live **above** the split
  so switching tabs (or resizing across the breakpoint) loses nothing.

### Host game (`/host/[code]`)

- **Waiting room:** PIN and join URL get fluid `clamp()` sizing — dominant on
  projection; player chips wrap. When the host runs from a phone, controls go
  full-width at the bottom and the PIN stays dominant.
- **Live question:** question and answer grid use fluid type; answers 1 column on
  phone → 2 columns `sm:`+ (already present); paddings/spacing scale up at `xl:`+.
  Timer and answer counters readable at distance.
- **Reveal & podium:** same fluid treatment; podium bars stack vertically on phone.

### Student game (`/game/[code]`, `/join`)

Already phone-first (`max-w-md mx-auto`). Verify and polish: answer buttons thumb-sized
(`min-h-14`), centered capped-width card on tablet/desktop so no dead-space sprawl,
join form inputs `h-12`+ with ≥16px font.

### Solo play (`/play/[id]`)

Same treatment as student game: centered column, capped width, large touch answers.

## Edge cases

- **Mobile keyboard:** builder chat and join form use `dvh`-based layouts (see
  Foundations) so pinned inputs remain visible.
- **Orientation:** phone landscape during a game — answer grid switches to 2 columns,
  question text shrinks; no portrait assumption.
- **Resize mid-session:** builder structure swap must not drop chat/draft state
  (state lifted above the split).
- **Long content:** quiz titles, long answers, player names get explicit
  truncate/wrap rules; nothing overflows.

## Testing

- **Playwright viewport sweep:** 360, 768, 1024, 1440, 1920px per surface. Assert no
  horizontal scroll (`scrollWidth <= clientWidth`) and key controls visible.
- **Real-device manual pass** for builder tabs and student game (keyboard behavior,
  safe areas — emulators are unreliable here).
- Existing vitest suite untouched; layout-only change, no logic changes expected
  outside the builder tab structure.

## Decisions log

| Decision | Choice |
|---|---|
| Scope | Everything |
| Quality bar | Fully adaptive |
| Host big screens | Projector-aware (fluid type to 1920px+) |
| Builder on phone | Tabs (Chat / Editor) |
| Dashboard nav on phone | Drawer via existing shadcn sidebar |
| Approach | Tailwind breakpoints mobile-first + limited container queries |
