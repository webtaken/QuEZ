# Hero AI Prompt Launcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Lovable-style AI prompt box to the landing Hero that launches the visitor into the authenticated builder with their typed quiz idea, auto-starting generation.

**Architecture:** The Hero box is a pure launcher — no AI runs in it. On submit it routes to `/dashboard/quizzes/new?prompt=<encoded>` (signed-in) or routes there via `signIn.social` `callbackURL` (signed-out). The builder page reads the prompt from the URL on mount, passes it to `ChatPanel`, which fires one chat message into the existing `/api/chat` streaming flow, then strips the URL param so refresh does not re-fire.

**Tech Stack:** Next.js 16.2.4 (App Router), React 19, better-auth (`@/lib/auth-client`), Vercel AI SDK (`@ai-sdk/react` `useChat`), Tailwind with design tokens, existing `ui/textarea` + `ui/button`, lucide-react icons.

## Global Constraints

- **Non-standard Next.js 16** — APIs may differ from training data. Verify against `node_modules/next/dist/docs/` before using any Next API. (`useSearchParams` requires a `<Suspense>` boundary on prerendered routes — this plan avoids it by reading `window.location.search` in a mount effect.)
- **Never hardcode colors** — use design tokens only (`accent-lime`, `border`, `card`, `secondary`, `muted-foreground`, `foreground`). Opacity via `/NN` syntax.
- **Reuse existing UI primitives** — `@/components/ui/textarea`, `@/components/ui/button`. No new dependencies.
- **No automated test framework exists** in this repo. Per-task verification = `npm run lint` + `npm run build` clean, plus the manual browser check described in each task. Adding a test runner is out of scope (YAGNI).

---

### Task 1: ChatPanel accepts an initial prompt and auto-sends once

**Files:**
- Modify: `src/components/builder/ChatPanel.tsx`

**Interfaces:**
- Consumes: existing `useChat().sendMessage` (signature: `sendMessage({ role: 'user', parts: [{ type: 'text', text: string }] })`).
- Produces: `ChatPanelProps.initialPrompt?: string` — consumed by Task 2.

- [ ] **Step 1: Add `initialPrompt` to the props interface**

In `src/components/builder/ChatPanel.tsx`, change the `ChatPanelProps` interface (currently lines 14-17):

```tsx
interface ChatPanelProps {
  onQuizUpdate: (quiz: QuizPayload) => void
  initialQuiz?: QuizPayload
  initialPrompt?: string
}
```

And the component signature (currently line 32):

```tsx
export function ChatPanel({ onQuizUpdate, initialQuiz, initialPrompt }: ChatPanelProps) {
```

- [ ] **Step 2: Add the one-shot auto-send effect**

Immediately AFTER the `useChat({...})` call returns (after the closing `})` on line 69, before the `useEffect` that logs status on line 71), insert:

```tsx
  // Auto-send a prompt handed in from the landing Hero, exactly once.
  const autoSentRef = useRef(false)
  useEffect(() => {
    const p = initialPrompt?.trim()
    if (!p || autoSentRef.current) return
    autoSentRef.current = true
    sendMessage({ role: 'user', parts: [{ type: 'text', text: p }] })
  }, [initialPrompt, sendMessage])
```

(`useRef` and `useEffect` are already imported on line 3.)

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no errors for `ChatPanel.tsx` (warnings unrelated to this file are fine).

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: build succeeds, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/builder/ChatPanel.tsx
git commit -m "feat(builder): ChatPanel auto-sends initialPrompt once"
```

---

### Task 2: Builder page reads `?prompt` and passes it to ChatPanel

**Files:**
- Modify: `src/app/dashboard/quizzes/new/page.tsx`

**Interfaces:**
- Consumes: `ChatPanel` prop `initialPrompt?: string` (from Task 1).
- Produces: end-to-end behavior — visiting `/dashboard/quizzes/new?prompt=<text>` auto-starts generation.

- [ ] **Step 1: Add imports**

In `src/app/dashboard/quizzes/new/page.tsx`, change the React import (currently line 3) to include `useEffect`:

```tsx
import { useState, useEffect } from 'react'
```

(`useRouter` is already imported on line 4.)

- [ ] **Step 2: Read the prompt from the URL on mount and strip it**

Inside `NewQuizPage`, after the existing `const [saving, setSaving] = useState(false)` (line 13), add:

```tsx
  const [initialPrompt, setInitialPrompt] = useState<string | undefined>(undefined)

  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get('prompt')?.trim()
    if (!p) return
    setInitialPrompt(p)
    // Strip ?prompt so a refresh does not re-trigger generation.
    router.replace('/dashboard/quizzes/new')
  }, [router])
```

We read `window.location.search` directly instead of `useSearchParams()` to avoid the Next 16 `<Suspense>` prerender requirement. The page is already a Client Component, so this runs on mount.

- [ ] **Step 3: Pass `initialPrompt` to ChatPanel**

Change the `ChatPanel` usage (currently line 45) to:

```tsx
        <ChatPanel onQuizUpdate={setQuiz} initialPrompt={initialPrompt} />
```

- [ ] **Step 4: Lint + Build**

Run: `npm run lint && npm run build`
Expected: clean, no type errors.

- [ ] **Step 5: Manual verification**

Run: `npm run dev`. Sign in, then visit `/dashboard/quizzes/new?prompt=Make%20a%205-question%20quiz%20about%20photosynthesis`.
Expected: the prompt appears as a user message and the AI begins generating WITHOUT manual typing; the URL bar drops `?prompt`; refreshing the page does NOT re-fire generation.

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/quizzes/new/page.tsx
git commit -m "feat(builder): read ?prompt and hand it to ChatPanel"
```

---

### Task 3: HeroPrompt component + Hero integration

**Files:**
- Create: `src/components/landing/HeroPrompt.tsx`
- Modify: `src/components/landing/Hero.tsx`

**Interfaces:**
- Consumes: `signIn`, `useSession` from `@/lib/auth-client`; `useRouter` from `next/navigation`; `ui/textarea`, `ui/button`. Produces the `/dashboard/quizzes/new?prompt=` target consumed by Task 2.

- [ ] **Step 1: Create the HeroPrompt component**

Create `src/components/landing/HeroPrompt.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, type KeyboardEvent } from "react";
import { signIn, useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ArrowUp } from "lucide-react";

export function HeroPrompt() {
  const { data: session } = useSession();
  const router = useRouter();
  const [value, setValue] = useState("");

  function launch() {
    const text = value.trim();
    if (!text) return;
    const target = `/dashboard/quizzes/new?prompt=${encodeURIComponent(text)}`;
    if (session) {
      router.push(target);
    } else {
      signIn.social({ provider: "google", callbackURL: target });
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      launch();
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-3 shadow-2xl transition-colors focus-within:border-accent-lime/50 text-left">
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        rows={2}
        placeholder={'Describe your quiz… e.g. "10 questions on the French Revolution for high schoolers"'}
        className="min-h-[60px] max-h-40 resize-none border-0 bg-transparent px-2 text-base shadow-none focus-visible:ring-0"
      />
      <div className="flex items-center justify-between px-1 pt-1">
        <span className="text-xs text-muted-foreground">Press Enter to build</span>
        <Button
          onClick={launch}
          size="icon"
          disabled={!value.trim()}
          aria-label="Build quiz"
          className="w-10 h-10 shrink-0 rounded-full bg-accent-lime text-accent-lime-foreground shadow-lg shadow-accent-lime/20 hover:bg-accent-lime/90"
        >
          <ArrowUp className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire HeroPrompt into Hero — imports**

In `src/components/landing/Hero.tsx`, replace the current import block (lines 1-6) with:

```tsx
"use client";

import { ChevronDown, Sparkles } from "lucide-react";
import { HeroPrompt } from "./HeroPrompt";
```

This removes the now-unused `useRouter`, `signIn`, `useSession`, and `Button` imports (they moved into `HeroPrompt`). `Sparkles` (badge) and `ChevronDown` (links/scroll) are still used.

- [ ] **Step 3: Remove the now-unused session/router logic and handler**

In `Hero.tsx`, delete these lines from the top of the `Hero` component (currently lines 9-19):

```tsx
  const { data: session } = useSession();
  const router = useRouter();

  function handleGetStarted() {
    if (session) {
      router.push("/dashboard");
    } else {
      signIn.social({ provider: "google", callbackURL: "/dashboard" });
    }
  }
```

Keep the `scrollToDirectory` function that follows — it is still used by the community link and the scroll chevron.

- [ ] **Step 4: Replace the two-button block with the prompt box**

In `Hero.tsx`, replace the entire buttons block (currently lines 73-89, the `<div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center ...">` containing the two `<Button>`s) with:

```tsx
        <div className="mt-10 max-w-2xl mx-auto animate-fade-up animate-fade-up-delay-2">
          <HeroPrompt />
          <button
            onClick={scrollToDirectory}
            className="mt-4 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            or browse Community Quizzes
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>
```

Leave the badge, headline, subtext, stats row, scroll chevron, ambient glows, and floating `MockQuizCard`s unchanged.

- [ ] **Step 5: Lint + Build**

Run: `npm run lint && npm run build`
Expected: clean. If lint flags an unused import in `Hero.tsx`, remove that import. If `ArrowUp` is not exported by the installed lucide-react, swap it for `Send` (already used elsewhere in the codebase) in `HeroPrompt.tsx`.

- [ ] **Step 6: Manual verification — signed out**

Run `npm run dev`, sign out, load `/`. Type a quiz idea in the Hero box, press Enter.
Expected: Google sign-in launches; after auth you land in the builder and generation auto-starts with your typed prompt; URL drops `?prompt` after firing.

- [ ] **Step 7: Manual verification — signed in + edge cases**

While signed in, type an idea and press Enter → routes straight to builder and auto-starts. Shift+Enter inserts a newline instead of submitting. Empty/whitespace box → send button disabled, Enter does nothing. "or browse Community Quizzes" smooth-scrolls to the directory.

- [ ] **Step 8: Commit**

```bash
git add src/components/landing/HeroPrompt.tsx src/components/landing/Hero.tsx
git commit -m "feat(hero): add AI prompt launcher box"
```

---

## Self-Review

**Spec coverage:**
- Smart-launcher submit (signed-in push / signed-out callbackURL) → Task 3 Step 1. ✓
- Layout: box replaces buttons, community link demoted, stats kept → Task 3 Steps 3-4. ✓
- Query-param hand-off → Task 3 (write) + Task 2 (read). ✓
- ChatPanel `initialPrompt` + one-shot auto-send → Task 1. ✓
- Strip `?prompt` after consume; StrictMode/refresh guard → Task 2 Step 2 + Task 1 Step 2. ✓
- Enter submits / Shift+Enter newline (Hero only) → Task 3 Step 1. ✓
- Next 16 `useSearchParams`/Suspense caveat → resolved via `window.location.search` (Task 2 Step 2, Global Constraints). ✓
- Reuse `/api/chat`, no new route, no live AI in Hero → no API task created. ✓

**Placeholder scan:** No TBD/TODO/vague steps; all code shown in full.

**Type consistency:** `initialPrompt?: string` declared in Task 1 interface, passed in Task 2 Step 3, produced in Task 3 Step 1 as `?prompt=${encodeURIComponent(text)}`. `sendMessage` parts shape matches the existing call in `ChatPanel.submit()`. Consistent.
