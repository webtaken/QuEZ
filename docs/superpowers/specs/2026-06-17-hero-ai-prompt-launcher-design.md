# Hero AI Prompt Launcher — Design

**Date:** 2026-06-17
**Status:** Approved (design)
**Component area:** Landing Hero (`src/components/landing/Hero.tsx`) + builder chat (`src/components/builder/ChatPanel.tsx`, `src/app/dashboard/quizzes/new/page.tsx`)

## Goal

Add a Lovable.dev-style AI prompt box to the landing Hero. A visitor types their quiz idea in plain language and submits; the prompt carries them into the authenticated builder, where generation starts automatically. The Hero box is a smart **launcher** — no AI runs in the Hero itself.

## Approach (chosen)

Smart launcher (option A from brainstorm). On submit:

- **Signed-in** → `router.push("/dashboard/quizzes/new?prompt=<encoded>")`.
- **Not signed-in** → `signIn.social({ provider: "google", callbackURL: "/dashboard/quizzes/new?prompt=<encoded>" })`.

The builder reads `?prompt` and auto-fires one chat message, reusing the existing `/api/chat` streaming flow + `updateQuiz` tool. No new API route, no live AI in the Hero, no streaming preview.

Rejected alternatives:
- **Live mini-chat in Hero** — streams AI inline. More complexity, burns tokens on anonymous traffic, duplicates builder UI.
- **Scripted typing animation** — fake flair, no real value.

Prompt hand-off via **query param** (chosen over sessionStorage): survives the Google OAuth redirect cleanly via `callbackURL`, shareable, debuggable, no storage edge cases.

## Components

### `HeroPrompt` (new)
Lives in `src/components/landing/Hero.tsx` (or sibling file `HeroPrompt.tsx`). Replaces the current two-button block.

- Reuses `ui/textarea` (auto-grow 1→4 rows) + `ui/button` (lime icon send button, `ArrowUp` or `Send` icon).
- Container: `rounded-2xl border border-border bg-card`, lime focus ring, padding consistent with builder input.
- Placeholder: `Describe your quiz… e.g. "10 questions on the French Revolution for high schoolers"`.
- Helper line below box (small, muted): keyboard hint optional.
- **No** fake mic / "Build" pill / "+" chips (YAGNI — Lovable has them, we skip).

Behavior:
```
onSubmit(text):
  t = text.trim(); if (!t) return
  target = `/dashboard/quizzes/new?prompt=${encodeURIComponent(t)}`
  if (session) router.push(target)
  else signIn.social({ provider: "google", callbackURL: target })
```
- **Enter** submits; **Shift+Enter** = newline (Hero only — builder keeps its existing ⌘+Enter).
- Empty/whitespace guarded; send button disabled when input empty.

### Hero layout changes (`Hero.tsx`)
- Remove `Get Started` + `See Community Quizzes` button block.
- Insert `HeroPrompt` (full width of the `max-w-2xl` content column).
- Below the box: small text link "or browse Community Quizzes →" wired to existing `scrollToDirectory`.
- **Keep:** badge, headline, subtext, stats row, scroll chevron, ambient glows, floating mock cards.
- `useSession` / `signIn` stay (now consumed by `HeroPrompt`). The old `handleGetStarted` is replaced by the launcher logic.

### `ChatPanel` (modify) — `src/components/builder/ChatPanel.tsx`
- Add optional prop `initialPrompt?: string`.
- On mount, if `initialPrompt` is non-empty: fire `sendMessage({ role: 'user', parts: [{ type: 'text', text: initialPrompt }] })` **exactly once**, guarded by a `useRef` flag (defends against React StrictMode double-invoke and re-renders).
- Do **not** prefill the input box — the message goes straight into the thread.
- No change to existing manual submit / ⌘+Enter behavior.

### Builder page (modify) — `src/app/dashboard/quizzes/new/page.tsx`
- Read the `prompt` query param and pass it to `<ChatPanel initialPrompt={...} />`.
- **Next 16 caveat:** client `useSearchParams()` may require a Suspense boundary / CSR bailout. Verify against `node_modules/next/dist/docs/` before implementing. Fallback: read `window.location.search` inside a `useEffect` on mount.
- After the prompt is consumed, `router.replace("/dashboard/quizzes/new")` to strip `?prompt`, so a refresh does not re-fire generation.

## Data flow

```
Visitor types idea in Hero box
  │ submit (Enter)
  ▼
signed-in? ──no──► signIn.social({ callbackURL: /…/new?prompt=… }) ──► Google OAuth ──► callback
  │ yes                                                                                   │
  ▼                                                                                       ▼
router.push(/dashboard/quizzes/new?prompt=…) ─────────────────────────► NewQuizPage reads ?prompt
                                                                                          │
                                                                                          ▼
                                                              ChatPanel.initialPrompt → sendMessage (once)
                                                                                          │
                                                                          existing /api/chat stream + updateQuiz tool
                                                                                          ▼
                                                                          QuizPreview populates; URL stripped of ?prompt
```

## Edge cases

- **OAuth redirect** — prompt rides in `callbackURL`, survives the round-trip through Google. ✓
- **Duplicate generation** — `useRef` guard in `ChatPanel` + `?prompt` strip after consume prevents re-fire on refresh/StrictMode.
- **Empty / whitespace submit** — guarded in both Hero and builder.
- **Long prompt** — quiz ideas are short; no length cap now (soft-cap ~500 chars is a future nicety, YAGNI).

## Non-goals

- No live AI / streaming in the Hero.
- No new API route — reuse existing `/api/chat`.
- No mic / voice / file-attach affordances.
- No prompt length cap, no rate limiting (existing builder constraints apply downstream).

## Testing notes

- Manual: signed-out submit → Google sign-in → lands in builder → generation auto-starts with the typed prompt; refresh does not re-fire.
- Manual: signed-in submit → straight to builder → auto-start.
- Manual: empty box → send disabled / no-op.
- Verify Next 16 `useSearchParams` / Suspense behavior in dev build (no CSR bailout warning).

## Files touched

- `src/components/landing/Hero.tsx` — replace buttons with `HeroPrompt`, demote community link.
- `src/components/builder/ChatPanel.tsx` — add `initialPrompt` + one-shot auto-send.
- `src/app/dashboard/quizzes/new/page.tsx` — read `?prompt`, pass down, strip after consume.
- (optional) `src/components/landing/HeroPrompt.tsx` — if extracted to its own file.
