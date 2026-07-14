# Live Mode Refinements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four refinements to the shipped Kahoot live mode (spec: `docs/superpowers/specs/2026-07-12-kahoot-live-mode-design.md`, "Updated 2026-07-13" changes): fix invisible podium blocks, auto-advance the final reveal to podium, switch students to select-then-submit answering, and play the quiz's music track on the host device.

**Architecture:** All changes ride the existing polling architecture — no new tables, routes, or dependencies. The auto-podium is a second lazy transition inside `maybeAdvancePhase` (same conditional-UPDATE race-safety pattern as question→reveal). The music reuses the single-player `useQuizMusic` hook, wired into `HostGameView`.

**Tech Stack:** Next.js 16 app router (read `node_modules/next/dist/docs/` before Next-specific code — this repo's Next differs from upstream), Drizzle ORM, vitest, Tailwind v4 theme tokens, base-ui Button, lucide-react, pnpm.

## Global Constraints

- Branch: `feat/kahoot-live-mode` (PR #8 already open — these commits extend it).
- Never hardcode colors; use theme tokens (`accent-lime`, `success`, `destructive`, `border`, `card`, etc.). Headings use `font-[family-name:var(--font-syne)]`.
- DB-layer modules (`src/db/game-queries.ts`, `src/db/game-mutations.ts`) have NO direct unit tests (repo convention — no test DB in CI); routes are tested with those modules mocked.
- Only `src/**/*.test.ts` files run under `pnpm test`.
- Pre-existing debt you will see and must NOT fix or count as your failure: 1 tsc error in `src/app/api/games/route.test.ts` (TS2352), 6 lint errors / 5 warnings in untouched files (QuizPlayer, use-mobile, chat-tree, ChatPanel, etc.).
- Do not start a dev server and leave it running; kill anything you start and verify with `ps`.

---

### Task 1: Podium visibility fix

**Files:**
- Modify: `src/components/game/HostPodium.tsx:52-58`
- Modify: `src/components/game/StudentPodium.tsx:71,89,96`

**Interfaces:**
- Consumes: `.animate-fade-up` / `.animate-fade-up-delay-*` classes from `src/app/globals.css:159-165`.
- Produces: nothing new — pure class-string fix.

**Background:** `.animate-fade-up-delay-2` and `-delay-3` only set `animation-delay` + initial `opacity: 0`; the `animation` property lives on `.animate-fade-up`. A delay class used alone leaves the element permanently invisible (this hid 2nd/3rd podium blocks and the 4th-place-and-below list). The correct pairing pattern is in `src/components/landing/Hero.tsx:56` — `animate-fade-up animate-fade-up-delay-1`.

- [x] **Step 1: Fix HostPodium**

In `src/components/game/HostPodium.tsx`, three edits:

Line 52 — change `delayClass="animate-fade-up-delay-2"` to:

```tsx
        {second && <PodiumBlock entry={second} place={2} heightClass="h-28" delayClass="animate-fade-up animate-fade-up-delay-2" />}
```

Line 54 — change `delayClass="animate-fade-up-delay-3"` to:

```tsx
        {third && <PodiumBlock entry={third} place={3} heightClass="h-20" delayClass="animate-fade-up animate-fade-up-delay-3" />}
```

Line 58 — the `rest` list container, change `animate-fade-up-delay-3` to `animate-fade-up animate-fade-up-delay-3`:

```tsx
        <div className="rounded-2xl border border-border bg-card divide-y divide-border text-left animate-fade-up animate-fade-up-delay-3">
```

(Line 53, first place, already uses plain `animate-fade-up` — leave it.)

- [x] **Step 2: Fix StudentPodium**

In `src/components/game/StudentPodium.tsx`, three edits:

Line 71 (2nd-place block) — change `delayClass="animate-fade-up-delay-2"` to:

```tsx
            delayClass="animate-fade-up animate-fade-up-delay-2"
```

Line 89 (3rd-place block) — change `delayClass="animate-fade-up-delay-3"` to:

```tsx
            delayClass="animate-fade-up animate-fade-up-delay-3"
```

Line 96 (`rest` list container) — change `animate-fade-up-delay-3` to `animate-fade-up animate-fade-up-delay-3`:

```tsx
        <div className="rounded-2xl border border-border bg-card divide-y divide-border text-left animate-fade-up animate-fade-up-delay-3">
```

- [x] **Step 3: Verify no stray solo delay classes remain, lint + typecheck**

Run: `grep -rn "animate-fade-up-delay" src/components/game/`
Expected: every hit also contains `animate-fade-up ` (paired) on the same class string.

Run: `npx tsc --noEmit && pnpm lint`
Expected: clean except the pre-existing debt listed in Global Constraints.

- [x] **Step 4: Commit**

```bash
git add src/components/game/HostPodium.tsx src/components/game/StudentPodium.tsx
git commit -m "fix(live): pair animate-fade-up with delay classes so 2nd/3rd podium blocks render"
```

---

### Task 2: Auto-podium — final reveal lazily advances after 5s

**Files:**
- Modify: `src/db/game-mutations.ts:161-225` (`maybeAdvancePhase`)
- Modify: `src/app/api/games/[code]/state/route.ts:16`
- Test: `src/app/api/games/[code]/state/route.test.ts`

**Interfaces:**
- Consumes: existing `maybeAdvancePhase(game, currentQuestion)` and its call site in the state route.
- Produces: new signature `maybeAdvancePhase(game: GameSession, currentQuestion: { id: string; timeLimit: number } | undefined, totalQuestions: number): Promise<GameSession>` — the state route is its only caller. Task 5's manual pass relies on the 5s constant `REVEAL_TO_PODIUM_MS`.

**Background:** Students currently sit on the final reveal forever unless the host clicks "Show podium". Spec now requires the final reveal to auto-flip to podium after ~5s for everyone, using the same lazy-transition-on-poll mechanism as question→reveal. The host's button (gated at 2s by `HostReveal`) stays as an early skip; the `WHERE status='reveal'` guard makes button and lazy flip race-safe against each other. `maybeAdvancePhase` itself is DB-layer (mocked in route tests, per convention) — the route-level test verifies the new argument wiring, and Task 5 verifies the flip end-to-end.

- [x] **Step 1: Update the route test to expect the new third argument**

In `src/app/api/games/[code]/state/route.test.ts`, replace the last test (lines 120-124):

```ts
  it('runs the lazy phase transition on every poll, passing the question count', async () => {
    getGameByCode.mockResolvedValue(GAME)
    await GET(makeReq('854123'), ctx('854123'))
    expect(maybeAdvancePhase).toHaveBeenCalledWith(GAME, QUESTIONS[0], QUESTIONS.length)
  })
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- src/app/api/games/[code]/state/route.test.ts`
Expected: FAIL — `toHaveBeenCalledWith` mismatch (called with 2 args, expected 3).

- [x] **Step 3: Extend `maybeAdvancePhase` and the call site**

In `src/db/game-mutations.ts`, add a constant above `maybeAdvancePhase` and replace the function's opening (signature + the early guard at lines 161-165). The `reveal` branch goes before the existing `question` logic; everything from `const elapsedMs = Date.now() - ...` (line 167) down is unchanged:

```ts
const REVEAL_TO_PODIUM_MS = 5000

// The core state-machine step: called on every poll of GET /state. If the
// question phase's timer has elapsed, or every active participant has
// answered, it backfills a 0-point "no answer" for anyone who didn't answer
// (keeping streak/tie-break consistent) and flips the game to 'reveal'. The
// `WHERE status='question'` guard on the final UPDATE makes this race-safe:
// if two pollers both pass the elapsed/all-answered check at once, only one
// UPDATE actually applies — the loser just returns the (soon-stale) game it
// was given, and picks up 'reveal' on its next poll ~1.5s later.
//
// The *final* question's reveal also advances lazily: after
// REVEAL_TO_PODIUM_MS it flips to 'podium' so students reach the podium
// even if the host never clicks "Show podium". The host's /advance click
// remains an early skip; the `WHERE status='reveal'` guard keeps the two
// paths race-safe against each other.
export async function maybeAdvancePhase(
  game: GameSession,
  currentQuestion: { id: string; timeLimit: number } | undefined,
  totalQuestions: number
): Promise<GameSession> {
  if (game.status === 'reveal') {
    const isLast = game.currentQuestionIndex + 1 >= totalQuestions
    const revealElapsedMs = Date.now() - game.phaseStartedAt.getTime()
    if (!isLast || revealElapsedMs < REVEAL_TO_PODIUM_MS) return game
    const [updated] = await db
      .update(gameSessions)
      .set({ status: 'podium', endedAt: new Date(), phaseStartedAt: new Date() })
      .where(and(eq(gameSessions.id, game.id), eq(gameSessions.status, 'reveal')))
      .returning()
    return updated ?? game
  }

  if (game.status !== 'question' || !currentQuestion) return game
```

(The old comment block above the function is superseded by the one shown here — replace it. Do not touch the body from `const elapsedMs` onward, nor `advanceGame` below it.)

In `src/app/api/games/[code]/state/route.ts` line 16, change the call to:

```ts
  const settled = await maybeAdvancePhase(game, currentQuestion, allQuestions.length)
```

- [x] **Step 4: Run the test to verify it passes, then the full suite**

Run: `pnpm test -- src/app/api/games/[code]/state/route.test.ts`
Expected: PASS (7 tests).

Run: `pnpm test && npx tsc --noEmit && pnpm lint`
Expected: 155/155 tests pass (the reworded test replaces one, count unchanged); tsc/lint clean except pre-existing debt.

- [x] **Step 5: Commit**

```bash
git add src/db/game-mutations.ts "src/app/api/games/[code]/state/route.ts" "src/app/api/games/[code]/state/route.test.ts"
git commit -m "feat(live): final reveal auto-advances to podium after 5s via lazy transition"
```

---

### Task 3: Select-then-submit answering

**Files:**
- Modify: `src/components/game/StudentQuestionLive.tsx`

**Interfaces:**
- Consumes: `Button` from `@/components/ui/button` (same styling recipe as `HostReveal.tsx:77-84`); existing props — none change.
- Produces: same external contract (`onAnswered(index | null)` fires once, on submit or timeout), so `StudentGameView` needs no edits.

**Background:** Today a tap immediately POSTs and locks. New UX: tap selects (highlight, changeable), a Submit button — disabled until something is selected — sends the final answer and locks. Timer expiry auto-submits the current selection (a student who picked but forgot to press Submit gets their pick scored at full elapsed time), or null if nothing selected. `answerMs` is server-computed at the submit moment; the scoring formula is untouched. The `submittedRef` synchronous guard still prevents the submit-click vs timeout race double-POST. No component test exists for this file (repo has no component tests); Task 5's manual pass covers it.

- [x] **Step 1: Rewrite the interaction portion of the component**

Replace the entire contents of `src/components/game/StudentQuestionLive.tsx` with:

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useCountdown } from '@/hooks/useCountdown'
import { cn } from '@/lib/utils'
import type { GameQuestionView } from '@/hooks/useGamePolling'

// A lightweight ring built from the same accent-lime/secondary CSS custom
// properties Tailwind maps its utility classes to — not a hardcoded color,
// just read directly since conic-gradient can't take a Tailwind class.
function CountdownRing({ secondsLeft, timeLimit }: { secondsLeft: number; timeLimit: number }) {
  const pct = timeLimit > 0 ? (secondsLeft / timeLimit) * 100 : 0
  return (
    <div
      className="w-14 h-14 rounded-full flex items-center justify-center shrink-0"
      style={{ background: `conic-gradient(var(--accent-lime) ${pct}%, var(--secondary) ${pct}%)` }}
    >
      <div className="w-11 h-11 rounded-full bg-card flex items-center justify-center text-sm font-bold tabular-nums text-foreground">
        {secondsLeft}
      </div>
    </div>
  )
}

export function StudentQuestionLive({
  code,
  participantId,
  sessionToken,
  question,
  phaseStartedAt,
  currentQuestionIndex,
  onAnswered,
}: {
  code: string
  participantId: string
  sessionToken: string
  question: GameQuestionView
  phaseStartedAt: string
  currentQuestionIndex: number
  onAnswered: (index: number | null) => void
}) {
  const secondsLeft = useCountdown(phaseStartedAt, question.timeLimit)
  const [selected, setSelected] = useState<number | null>(null)
  const [answered, setAnswered] = useState(false)
  const submittedRef = useRef(false)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected(null)
    setAnswered(false)
    submittedRef.current = false
  }, [currentQuestionIndex])

  // Timer expiry auto-submits whatever is currently selected (null if
  // nothing) — a student who picked but never pressed Submit still gets
  // their pick scored, at full elapsed time.
  useEffect(() => {
    if (secondsLeft === 0 && !submittedRef.current) submit(selected)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft])

  function submit(index: number | null) {
    if (submittedRef.current) return
    submittedRef.current = true
    setSelected(index)
    setAnswered(true)
    onAnswered(index)
    fetch(`/api/games/${code}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantId, sessionToken, questionId: question.id, selectedIndex: index }),
    }).catch(() => {})
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-10 space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Question in progress</p>
        <CountdownRing secondsLeft={secondsLeft} timeLimit={question.timeLimit} />
      </div>

      <h1 className="font-[family-name:var(--font-syne)] font-bold text-xl text-foreground text-center leading-snug">
        {question.text}
      </h1>

      <div className="grid grid-cols-1 gap-2">
        {question.options.map((opt, i) => {
          const isSelected = selected === i
          const dim = answered && !isSelected
          return (
            <button
              key={i}
              onClick={() => setSelected(i)}
              disabled={answered}
              className={cn(
                'flex items-center gap-3 px-4 py-3 rounded-xl border text-sm text-left transition-all',
                isSelected
                  ? 'border-accent-lime bg-accent-lime/15 text-foreground'
                  : 'border-border bg-secondary/50 text-foreground hover:border-accent-lime/50 hover:bg-secondary',
                dim && 'opacity-40'
              )}
            >
              <span className="w-6 h-6 rounded-full border text-xs font-bold flex items-center justify-center shrink-0">
                {String.fromCharCode(65 + i)}
              </span>
              <span className="flex-1">{opt}</span>
            </button>
          )
        })}
      </div>

      {!answered && (
        <Button
          onClick={() => submit(selected)}
          disabled={selected === null}
          size="lg"
          className="w-full rounded-xl bg-accent-lime text-accent-lime-foreground hover:bg-accent-lime/90 font-semibold"
        >
          Submit answer
        </Button>
      )}

      {answered && (
        <p className="text-center text-accent-lime font-semibold text-sm">
          {selected === null ? "Time's up!" : 'Answer locked'} — waiting for the others...
        </p>
      )}
    </div>
  )
}
```

What changed vs the old file: option `onClick` now only does `setSelected(i)` (was `submit(i)`); the timeout effect submits `selected` instead of `null`, with a new explanatory comment; the Submit `Button` block is new; `Button` import is new. Everything else is byte-identical.

- [x] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && pnpm lint`
Expected: clean except pre-existing debt. In particular the two existing `eslint-disable` comments must survive (the rule reports at the setState call site).

- [x] **Step 3: Commit**

```bash
git add src/components/game/StudentQuestionLive.tsx
git commit -m "feat(live): select-then-submit answering — changeable pick, Submit button, timeout submits current selection"
```

---

### Task 4: Host-side quiz music

**Files:**
- Modify: `src/hooks/useQuizMusic.ts` (add `resume()`)
- Modify: `src/app/host/[code]/page.tsx` (select + pass `musicTrack`)
- Modify: `src/components/game/HostGameView.tsx` (wire hook, mute button, start/resume/stop)

**Interfaces:**
- Consumes: `useQuizMusic` + `getTrackById` (existing, used identically by `QuizPlayer.tsx:59-60`); `Volume2`/`VolumeX` icons (same mute-toggle pattern as `QuizPlayer.tsx:260-268`); `quizzes.musicTrack` column.
- Produces: `useQuizMusic` gains `resume(): void` — plays without resetting `currentTime` (no-op if already playing; falls back to `start()` if no Audio element exists yet, e.g. after a host page refresh). `HostGameView` gains a required `musicTrack: string | null` prop.

**Background:** Quizzes already carry a `musicTrack`; single-player plays it, live mode never did. Spec: host device only — `start()` inside the "Start quiz" click handler (user gesture → autoplay-safe), loop through question/reveal phases, stop at podium, mute toggle while playing. If the host refreshes mid-game the browser blocks autoplay until a gesture — so `resume()` is also called from the "Next question"/"Show podium" click, which restores music one click after a refresh and is a no-op when music is already playing.

- [x] **Step 1: Add `resume()` to `useQuizMusic`**

In `src/hooks/useQuizMusic.ts`, insert after the `start()` function (line 30) and add `resume` to the return (line 44):

```ts
  // Like start(), but never rewinds: no-op if already playing, falls back
  // to start() when no Audio element exists yet (e.g. after a page refresh
  // killed the old one). Must also be called from a user gesture.
  function resume() {
    if (!file) return
    if (!audioRef.current) {
      start()
      return
    }
    if (audioRef.current.paused) audioRef.current.play().catch(() => {})
  }
```

```ts
  return { start, resume, stop, muted, toggleMute }
```

- [x] **Step 2: Pass `musicTrack` from the host page**

In `src/app/host/[code]/page.tsx`, add `musicTrack: quizzes.musicTrack` to the select (lines 18-22) and pass it through (line 25):

```ts
  const [quiz] = await db
    .select({ title: quizzes.title, coverEmoji: quizzes.coverEmoji, musicTrack: quizzes.musicTrack })
    .from(quizzes)
    .where(eq(quizzes.id, game.quizId))
    .limit(1)
  if (!quiz) notFound()

  return (
    <HostGameView
      code={code}
      quizTitle={quiz.title}
      coverEmoji={quiz.coverEmoji ?? '🧠'}
      musicTrack={quiz.musicTrack}
    />
  )
```

- [x] **Step 3: Wire music into HostGameView**

Replace the entire contents of `src/components/game/HostGameView.tsx` with:

```tsx
'use client'

import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { Volume2, VolumeX } from 'lucide-react'
import { useGamePolling } from '@/hooks/useGamePolling'
import { useQuizMusic } from '@/hooks/useQuizMusic'
import { getTrackById } from '@/lib/music'
import { HostWaitingRoom } from './HostWaitingRoom'
import { HostQuestionLive } from './HostQuestionLive'
import { HostReveal } from './HostReveal'
import { HostPodium } from './HostPodium'

export function HostGameView({
  code,
  quizTitle,
  coverEmoji,
  musicTrack,
}: {
  code: string
  quizTitle: string
  coverEmoji: string
  musicTrack: string | null
}) {
  const { state, error } = useGamePolling(code)
  const track = getTrackById(musicTrack)
  const music = useQuizMusic(track?.file ?? null)

  const status = state?.status
  useEffect(() => {
    if (status === 'podium') music.stop()
    // music's functions are re-created every render; status is the only
    // real input, and stop() is idempotent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  async function post(path: string, body?: unknown) {
    await fetch(`/api/games/${code}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
  }

  let view: ReactNode = null
  if (error) {
    view = <div className="max-w-md mx-auto pt-24 text-center text-destructive">{error}</div>
  } else if (!state) {
    view = <div className="max-w-md mx-auto pt-24 text-center text-muted-foreground">Loading game...</div>
  } else if (state.status === 'waiting') {
    view = (
      <HostWaitingRoom
        code={code}
        quizTitle={quizTitle}
        coverEmoji={coverEmoji}
        participants={state.participants}
        onKick={(participantId) => post('/kick', { participantId })}
        onStart={() => {
          // start() must run inside the click gesture or autoplay is blocked.
          music.start()
          post('/start')
        }}
      />
    )
  } else if (state.status === 'question' && state.question) {
    view = (
      <HostQuestionLive
        question={state.question}
        currentQuestionIndex={state.currentQuestionIndex}
        totalQuestions={state.totalQuestions}
        phaseStartedAt={state.phaseStartedAt}
        participants={state.participants}
      />
    )
  } else if (state.status === 'reveal' && state.question) {
    view = (
      <HostReveal
        key={state.currentQuestionIndex}
        question={state.question}
        correctIndex={state.correctIndex ?? -1}
        currentQuestionIndex={state.currentQuestionIndex}
        totalQuestions={state.totalQuestions}
        leaderboard={state.leaderboard ?? []}
        onAdvance={() => {
          // No-op while music already plays; restores it one click after a
          // mid-game host refresh (refresh loses autoplay permission).
          music.resume()
          post('/advance')
        }}
      />
    )
  } else if (state.status === 'podium') {
    view = <HostPodium leaderboard={state.leaderboard ?? []} quizTitle={quizTitle} coverEmoji={coverEmoji} />
  }

  return (
    <>
      {track && (status === 'question' || status === 'reveal') && (
        <button
          onClick={music.toggleMute}
          aria-label={music.muted ? 'Unmute music' : 'Mute music'}
          className="fixed top-4 right-4 z-10 text-muted-foreground hover:text-foreground transition-colors"
        >
          {music.muted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
        </button>
      )}
      {view}
    </>
  )
}
```

What changed vs the old file: early returns became a `view` variable so the fixed-position mute button can render alongside every phase; `onStart`/`onAdvance` gained `music.start()`/`music.resume()`; the podium-stop effect, the three music imports, and the `musicTrack` prop are new. The phase components receive identical props.

- [x] **Step 4: Typecheck + lint + full tests**

Run: `npx tsc --noEmit && pnpm lint && pnpm test`
Expected: clean except pre-existing debt; 155/155 tests (no route/lib behavior touched).

- [x] **Step 5: Commit**

```bash
git add src/hooks/useQuizMusic.ts "src/app/host/[code]/page.tsx" src/components/game/HostGameView.tsx
git commit -m "feat(live): loop quiz music on host device — start on Start, resume on Next, stop at podium, mute toggle"
```

---

### Task 5: Full verification

**Files:** none new.

- [x] **Step 1: Full test + lint + type-check + build**

Run: `pnpm test && pnpm lint && npx tsc --noEmit && pnpm build`
Expected: 155/155 tests, production build succeeds; only the pre-existing debt from Global Constraints appears in lint/tsc.

- [x] **Step 2: Manual two-window pass over the four changes**

With `pnpm dev`, Window A (host, logged in via Google) hosts a quiz **with a music track set** and ≥2 questions; Window B (+ C, incognito) join as students:

1. **Select-then-submit:** in B, tap option A — highlighted, not locked; tap option B — selection moves; press "Submit answer" — locks, "Answer locked — waiting for the others...". Host's answered-count increments only on Submit.
2. **Timeout submits selection:** on another question in B, tap an option and do NOT press Submit; let the timer expire — reveal scores that option (points > 0 if correct), not a missed answer. On a question where B taps nothing, expiry shows "Time's up!" and scores 0.
3. **Music:** A hears the quiz track loop from clicking "Start quiz" through questions and reveals; mute toggle (top-right) silences/restores it; refresh A mid-game — silence — click "Next question" — music resumes; at podium the music stops. B never hears the track (only correct/wrong beeps).
4. **Auto-podium:** on the last question's reveal, host does NOT click — ~5-6.5s later (5s + poll interval) both A and B flip to podium. Replay and click "Show podium" between 2s and 5s — early skip still works.
5. **Podium visibility (the 2-player regression):** with exactly 2 participants, podium shows BOTH blocks (1st and 2nd) on host and student views; with 4+, the 4th-place list renders below the blocks.

Kill the dev server afterwards and verify with `ps` that it is gone.

- [x] **Step 3: Fix anything found, commit fixes**

Any failures: fix, re-run Step 1, commit with a `fix:` message.

---

## Plan self-review

**Spec coverage:** every 2026-07-13 spec change maps to a task — podium delay-class pairing rule (Sound + animation) → Task 1; `reveal → podium` lazy transition (State machine + Pacing) → Task 2; select-then-submit UX (Decisions + `/game` page) → Task 3; host-only music (Decisions + `/host` page + Sound) → Task 4; everything exercised end-to-end → Task 5.

**Placeholder scan:** no TBD/TODO; every code step shows complete code, every command has expected output.

**Type consistency:** `maybeAdvancePhase`'s new 3-arg signature (Task 2) matches its only call site and the updated test assertion; `resume()` (Task 4 Step 1) matches its call in HostGameView (Step 3); `musicTrack: string | null` prop matches `quizzes.musicTrack`'s `text` (nullable) column type; `onAnswered` contract in Task 3 is unchanged so `StudentGameView` correctly needs no edits.
