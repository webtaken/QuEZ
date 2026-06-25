# Web Search in Chat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-toggled web search to the quiz-builder chat so the assistant can ground answers in real/recent facts, showing its sources as chips.

**Architecture:** When the user enables a toggle, the `/api/chat` request includes the OpenRouter provider's typed `webSearch` server tool in `streamText`'s `tools`. The tool is provider-executed and model-invoked (the model searches only when it judges it needs facts). OpenRouter's `url_citation` annotations are auto-converted by `@openrouter/ai-sdk-provider` into native AI SDK `source-url` parts; `sendSources: true` streams them to the client, where they ride the existing `chat_messages.parts` JSONB persistence and render as chips.

**Tech Stack:** Next.js 16, React 19, Vercel AI SDK `ai@6.0.174`, `@ai-sdk/react@3`, `@openrouter/ai-sdk-provider@2.9.0`, Drizzle ORM, Postgres, vitest (node env).

## Global Constraints

- **No new Next.js patterns.** Mirror the existing `src/app/api/chat/route.ts` handler shape. (Per `AGENTS.md`: this Next.js version may differ from training data — do not invent route/config APIs.)
- **No DB migration.** `source-url` parts persist through the existing `chat_messages.parts` (JSONB) column via the existing `persistTurn` path. Do not touch `src/db/schema.ts`.
- **Cost cap:** web search tool is configured with `maxResults: 5` (~$0.005/searched message) and is only attached when the toggle is on.
- **Behavior:** toggle default **off**; toggle on = model *may* search (not forced).
- **Tests:** vitest is **node env, `src/**/*.test.ts` only** — no DOM/testing-library. Unit-test pure logic only. Verify UI + live integration via `next build`, `eslint`, and a live smoke test.
- **Favicons:** use a plain `<img>` (with an `eslint-disable-next-line @next/next/no-img-element`) — do **not** use `next/image` (it would require `images.remotePatterns` config; out of scope).
- **Commit** after each task. Run `npm run lint` before every commit; it must pass.

---

### Task 1: `extractSources` helper

Pure function that normalizes native `source-url` parts into a render-ready, deduped list.

**Files:**
- Modify: `src/lib/chat-messages.ts` (add export at end of file)
- Test: `src/lib/chat-messages.test.ts` (add a `describe` block)

**Interfaces:**
- Produces: `export type ChatSource = { url: string; title: string }` and
  `export function extractSources(parts: unknown[]): ChatSource[]`
- Consumed by: Task 4 (`SourceChips`) and Task 5 (`ChatPanel`).

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/chat-messages.test.ts`:

```ts
import { extractSources } from './chat-messages'

describe('extractSources', () => {
  const src = (url: string, title?: string) => ({ type: 'source-url', sourceId: url, url, title })

  it('returns url + title from source-url parts', () => {
    expect(
      extractSources([{ type: 'text', text: 'hi' }, src('https://a.com/x', 'A Title')])
    ).toEqual([{ url: 'https://a.com/x', title: 'A Title' }])
  })

  it('falls back to the url when title is missing or blank', () => {
    expect(extractSources([src('https://a.com/x', '   ')])).toEqual([
      { url: 'https://a.com/x', title: 'https://a.com/x' },
    ])
    expect(extractSources([src('https://b.com')])).toEqual([
      { url: 'https://b.com', title: 'https://b.com' },
    ])
  })

  it('dedupes by url, keeping first occurrence', () => {
    expect(
      extractSources([src('https://a.com', 'First'), src('https://a.com', 'Second')])
    ).toEqual([{ url: 'https://a.com', title: 'First' }])
  })

  it('ignores non-source and malformed parts; empty input → []', () => {
    expect(extractSources([{ type: 'tool-updateQuiz' }, { type: 'source-url' }])).toEqual([])
    expect(extractSources([])).toEqual([])
    expect(extractSources(undefined as unknown as unknown[])).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- src/lib/chat-messages.test.ts`
Expected: FAIL — `extractSources is not a function` (or import error).

- [ ] **Step 3: Implement `extractSources`**

Append to `src/lib/chat-messages.ts`:

```ts
export type ChatSource = { url: string; title: string }

// Normalize native AI SDK `source-url` parts (produced by the OpenRouter provider
// from web-search url_citation annotations) into a deduped, render-ready list.
export function extractSources(parts: unknown[]): ChatSource[] {
  const seen = new Set<string>()
  const out: ChatSource[] = []
  for (const part of parts ?? []) {
    const p = part as { type?: string; url?: string; title?: string }
    if (p.type !== 'source-url' || !p.url) continue
    if (seen.has(p.url)) continue
    seen.add(p.url)
    out.push({ url: p.url, title: p.title?.trim() || p.url })
  }
  return out
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- src/lib/chat-messages.test.ts`
Expected: PASS (all `extractSources` cases green, existing tests still green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/chat-messages.ts src/lib/chat-messages.test.ts
git commit -m "feat(chat): extractSources helper for web-search source parts"
```

---

### Task 2: `buildChatTools` helper

Extract the `streamText` `tools` assembly into a pure, testable function that conditionally adds the OpenRouter web-search server tool.

**Files:**
- Create: `src/lib/chat-tools.ts`
- Test: `src/lib/chat-tools.test.ts`

**Interfaces:**
- Produces: `export function buildChatTools(opts: { webSearch: boolean }): ToolSet`
  — always contains key `updateQuiz`; contains key `web_search` only when `webSearch` is true.
- Consumed by: Task 3 (`route.ts`).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/chat-tools.test.ts`:

```ts
import { describe, it, expect } from 'vitest'

// The OpenRouter provider's default instance may read OPENROUTER_API_KEY at import time.
// A dummy value is enough — buildChatTools only constructs tool descriptors, no network.
process.env.OPENROUTER_API_KEY ??= 'test-key'

import { buildChatTools } from './chat-tools'

describe('buildChatTools', () => {
  it('always includes the updateQuiz tool', () => {
    expect(Object.keys(buildChatTools({ webSearch: false }))).toEqual(['updateQuiz'])
  })

  it('adds web_search only when webSearch is enabled', () => {
    const keys = Object.keys(buildChatTools({ webSearch: true }))
    expect(keys).toContain('updateQuiz')
    expect(keys).toContain('web_search')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- src/lib/chat-tools.test.ts`
Expected: FAIL — cannot find module `./chat-tools`.

- [ ] **Step 3: Implement `buildChatTools`**

Create `src/lib/chat-tools.ts`:

```ts
import { tool, type ToolSet } from 'ai'
import { openrouter } from '@openrouter/ai-sdk-provider'
import { quizPayloadSchema } from '@/lib/quiz-schema'

// Cap results so each web search stays at ~$0.005 (OpenRouter Exa fallback pricing).
const WEB_SEARCH_MAX_RESULTS = 5

// Assemble the chat tool set. The updateQuiz tool is always present. When the user
// enables web search, the OpenRouter web-search server tool is added — it is
// provider-executed and model-invoked, so the model searches only when it judges
// the query needs external facts (no client-side execute, no extra streamText step).
export function buildChatTools({ webSearch }: { webSearch: boolean }): ToolSet {
  const updateQuiz = tool({
    description:
      'Update the quiz preview panel with structured quiz data. Call this whenever building or updating a quiz.',
    inputSchema: quizPayloadSchema,
    execute: async (quizData) => {
      return { success: true, quiz: quizData }
    },
  })

  if (webSearch) {
    return {
      updateQuiz,
      web_search: openrouter.tools.webSearch({ maxResults: WEB_SEARCH_MAX_RESULTS }),
    }
  }

  return { updateQuiz }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- src/lib/chat-tools.test.ts`
Expected: PASS.

> If the test errors at import with a missing-API-key message, the `process.env.OPENROUTER_API_KEY ??= 'test-key'` line at the top of the test handles it. If it still fails because the provider validates the key strictly, move that line into a `vitest` `setupFiles` entry; otherwise proceed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chat-tools.ts src/lib/chat-tools.test.ts
git commit -m "feat(chat): buildChatTools assembles tools with optional web search"
```

---

### Task 3: Wire web search into `/api/chat`

Read the `webSearch` flag from the request body, build tools via `buildChatTools`, and enable source streaming.

**Files:**
- Modify: `src/app/api/chat/route.ts`

**Interfaces:**
- Consumes: `buildChatTools` (Task 2).
- Produces: an `/api/chat` endpoint that accepts `{ ..., webSearch?: boolean }` and streams `source-url` parts when search runs.

- [ ] **Step 1: Update imports**

In `src/app/api/chat/route.ts`, replace line 1 and add the helper import. Change:

```ts
import { streamText, tool, convertToModelMessages, type UIMessage } from 'ai'
import { headers } from 'next/headers'
import { openrouter } from '@openrouter/ai-sdk-provider'
import { quizPayloadSchema, type QuizPayload } from '@/lib/quiz-schema'
```

to:

```ts
import { streamText, convertToModelMessages, type UIMessage } from 'ai'
import { headers } from 'next/headers'
import { openrouter } from '@openrouter/ai-sdk-provider'
import { type QuizPayload } from '@/lib/quiz-schema'
import { buildChatTools } from '@/lib/chat-tools'
```

(`tool` and `quizPayloadSchema` now live in `chat-tools.ts`; `openrouter` is still needed for the model factory `openrouter(modelId)`.)

- [ ] **Step 2: Read the `webSearch` flag from the body**

Replace the body destructure (currently lines 27–37):

```ts
  const {
    messages,
    existingQuiz,
    quizId,
    parentId,
  }: {
    messages: UIMessage[]
    existingQuiz?: QuizPayload
    quizId?: string
    parentId?: string | null
  } = await req.json()
```

with:

```ts
  const {
    messages,
    existingQuiz,
    quizId,
    parentId,
    webSearch,
  }: {
    messages: UIMessage[]
    existingQuiz?: QuizPayload
    quizId?: string
    parentId?: string | null
    webSearch?: boolean
  } = await req.json()
```

- [ ] **Step 3: Use `buildChatTools` in the `streamText` call**

Replace the `streamText` call (currently lines 56–70):

```ts
  const result = streamText({
    model: openrouter(modelId),
    system,
    messages: await convertToModelMessages(messages),
    tools: {
      updateQuiz: tool({
        description:
          'Update the quiz preview panel with structured quiz data. Call this whenever building or updating a quiz.',
        inputSchema: quizPayloadSchema,
        execute: async (quizData) => {
          return { success: true, quiz: quizData }
        },
      }),
    },
  })
```

with:

```ts
  const result = streamText({
    model: openrouter(modelId),
    system,
    messages: await convertToModelMessages(messages),
    tools: buildChatTools({ webSearch: webSearch ?? false }),
  })
```

- [ ] **Step 4: Stream source parts to the client**

In the `result.toUIMessageStreamResponse({ ... })` call, add `sendSources: true` right after `generateMessageId: newId,` (currently line 77):

```ts
  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    generateMessageId: newId,
    sendSources: true,
    onFinish: async ({ responseMessage }) => {
```

(Leave the rest of `onFinish`/`onError` unchanged.)

- [ ] **Step 5: Verify it compiles and lints**

Run: `npm run lint && npx tsc --noEmit`
Expected: no errors. (If `tsc` is not wired, run `npm run build` instead and expect a successful compile.)

- [ ] **Step 6: Commit**

```bash
git add src/app/api/chat/route.ts
git commit -m "feat(chat): enable OpenRouter web search tool + source streaming in /api/chat"
```

---

### Task 4: `SourceChips` component

Presentational component that renders a row of source chips (favicon + title, opens in a new tab).

**Files:**
- Create: `src/components/builder/SourceChips.tsx`

**Interfaces:**
- Consumes: `ChatSource` type from `@/lib/chat-messages` (Task 1).
- Produces: `export function SourceChips({ sources }: { sources: ChatSource[] })`.
- Consumed by: Task 5 (`ChatPanel`).

- [ ] **Step 1: Create the component**

Create `src/components/builder/SourceChips.tsx`:

```tsx
import type { ChatSource } from '@/lib/chat-messages'

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function SourceChips({ sources }: { sources: ChatSource[] }) {
  if (!sources.length) return null
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {sources.map((s) => {
        const domain = domainOf(s.url)
        return (
          <a
            key={s.url}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            title={s.title}
            className="inline-flex items-center gap-1.5 max-w-[220px] px-2 py-1 rounded-full bg-secondary text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-colors"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
              alt=""
              width={14}
              height={14}
              className="rounded-sm shrink-0"
            />
            <span className="truncate">{s.title}</span>
          </a>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Verify it compiles and lints**

Run: `npm run lint && npm run build`
Expected: no errors, no `no-img-element` warning (disabled inline).

- [ ] **Step 3: Commit**

```bash
git add src/components/builder/SourceChips.tsx
git commit -m "feat(chat): SourceChips component for web-search sources"
```

---

### Task 5: Toggle + source rendering in `ChatPanel`

Add the web-search toggle (persisted to `localStorage`), send the flag with each request, and render `SourceChips` under assistant messages.

**Files:**
- Modify: `src/components/builder/ChatPanel.tsx`

**Interfaces:**
- Consumes: `extractSources` (Task 1), `SourceChips` (Task 4), `buildChatTools` flow (Task 3).

- [ ] **Step 1: Update imports**

In `src/components/builder/ChatPanel.tsx`:

- Add `Globe` to the lucide import (line 10): change
  `import { Send, Bot } from 'lucide-react'` to
  `import { Send, Bot, Globe } from 'lucide-react'`.
- Add `extractSources` to the chat-messages import (line 14): change
  `import { collectToolCallIds, dbRowToUIMessage, extractQuizFromParts } from '@/lib/chat-messages'`
  to
  `import { collectToolCallIds, dbRowToUIMessage, extractQuizFromParts, extractSources } from '@/lib/chat-messages'`.
- Add a new import line after line 17:
  `import { SourceChips } from './SourceChips'`

- [ ] **Step 2: Add toggle state, ref, and persistence**

Insert just after `const [input, setInput] = useState('')` (line 46):

```ts
  const [webSearch, setWebSearch] = useState(false)
  const webSearchRef = useRef(false)
  // Restore the toggle from localStorage on mount (default off).
  useEffect(() => {
    const saved = localStorage.getItem('quez-web-search') === '1'
    setWebSearch(saved)
    webSearchRef.current = saved
  }, [])
  function toggleWebSearch() {
    setWebSearch((prev) => {
      const next = !prev
      webSearchRef.current = next
      localStorage.setItem('quez-web-search', next ? '1' : '0')
      return next
    })
  }
```

- [ ] **Step 3: Send the flag in the transport body**

In the `transport` `useMemo` body callback (lines 76–79), add `webSearch`:

```ts
        body: () => ({
          ...(quizRef.current ? { existingQuiz: quizRef.current } : {}),
          ...(quizId ? { quizId, parentId: leafIdRef.current } : {}),
          webSearch: webSearchRef.current,
        }),
```

(The callback reads `webSearchRef.current` at send-time, so the toggle does not need to be in the `useMemo` dependency array — same pattern as `quizRef`/`leafIdRef`.)

- [ ] **Step 4: Render source chips under assistant messages**

In the message map, insert the chips right after the message-bubble block closes and before the `{!isEditing && (` actions block. Find this boundary (around lines 395–396):

```tsx
                </div>
              )}
              {!isEditing && (
```

Change it to:

```tsx
                </div>
              )}
              {msg.role === 'assistant' &&
                (() => {
                  const sources = extractSources(
                    (msg as unknown as { parts?: unknown[] }).parts ?? []
                  )
                  return sources.length ? <SourceChips sources={sources} /> : null
                })()}
              {!isEditing && (
```

- [ ] **Step 5: Add the toggle button to the input row**

In the input area, the row is `<div className="flex gap-2 items-end">` (line 501) containing the `<Textarea>` then the send `<Button>`. Insert a toggle button as the first child of that row, immediately before `<Textarea`:

```tsx
        <div className="flex gap-2 items-end">
          <Button
            type="button"
            onClick={toggleWebSearch}
            size="icon"
            variant="ghost"
            aria-pressed={webSearch}
            title={webSearch ? 'Web search on' : 'Web search off'}
            className={cn(
              'shrink-0 w-11 h-11 border border-border',
              webSearch
                ? 'text-accent-lime bg-accent-lime/15 border-accent-lime/40'
                : 'text-muted-foreground'
            )}
          >
            <Globe className="w-4 h-4" />
          </Button>
          <Textarea
```

- [ ] **Step 6: Verify it compiles and lints**

Run: `npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/builder/ChatPanel.tsx
git commit -m "feat(chat): web search toggle + source chips in ChatPanel"
```

---

### Task 6: Full verification + live smoke test

Confirm the whole feature works end-to-end against the real OpenRouter API. This task is the verification gate for the two integration unknowns: the `web_search` tool key the provider expects, and whether `source-url` parts arrive on the **streaming** path.

**Files:** none (verification only; create follow-up fix commits if something fails).

- [ ] **Step 1: Run the full automated suite**

Run: `npm run test && npm run lint && npm run build`
Expected: all unit tests PASS, lint clean, build succeeds.

- [ ] **Step 2: Start the app**

Run: `npm run dev` (ensure `OPENROUTER_API_KEY` is set in `.env`). Open the quiz builder.

- [ ] **Step 3: Smoke — search off (regression)**

With the 🌐 toggle **off**, ask: *"Create a 5-question quiz about basic arithmetic."*
Expected: quiz builds as before; **no** source chips; behavior unchanged from `main`.

- [ ] **Step 4: Smoke — search on**

Toggle 🌐 **on** (button highlights). Ask a question that needs fresh facts, e.g.
*"Make a 5-question quiz about major world news events from the past month, and cite sources."*
Expected:
- The model invokes web search; the assistant answer reflects current info.
- A row of **source chips** (favicon + title) renders under the assistant message.
- Clicking a chip opens the source in a new tab.

> If no chips appear: in `src/app/api/chat/route.ts`, temporarily log `responseMessage.parts` inside `onFinish` and inspect for `type: 'source-url'`. If the model never calls search, confirm the tool key — try renaming `web_search` to the provider's expected id, or check `openrouter.tools.webSearch`'s emitted tool `type`. If parts exist server-side but not client-side, re-confirm `sendSources: true` is set.

- [ ] **Step 5: Smoke — persistence across reload**

Reload the builder page for the same quiz. Expected: the assistant message still shows its source chips (they were persisted in `chat_messages.parts` and re-rendered via `extractSources`).

- [ ] **Step 6: Smoke — toggle persistence**

Reload the page. Expected: the 🌐 toggle is in the same on/off state as before (from `localStorage`).

- [ ] **Step 7: Final commit (only if fixes were needed)**

```bash
git add -A
git commit -m "fix(chat): adjustments from web search smoke test"
```

---

## Self-Review (completed during planning)

- **Spec coverage:** §1 scope → Tasks 3/5 (toggle, may-search via server tool); §3 mechanism → Tasks 2/3; §4 data flow/persistence → Tasks 1/3/5 (native `source-url` parts, no migration); §5 frontend → Tasks 4/5; §6 errors/cost → `maxResults: 5` (Task 2), graceful no-chips (Task 1 returns `[]`), toggle-on-no-search is normal; §8 verification → Task 6. All covered.
- **Placeholder scan:** none — every code/test step contains full content and exact commands.
- **Type consistency:** `ChatSource` defined in Task 1, consumed unchanged in Tasks 4/5; `buildChatTools({ webSearch })` signature defined in Task 2, called identically in Task 3; tool key `web_search` consistent across Tasks 2/3/6.
