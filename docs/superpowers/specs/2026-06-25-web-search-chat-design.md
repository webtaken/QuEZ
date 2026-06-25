# Web Search in Chat — Design

**Date:** 2026-06-25
**Status:** Approved (design); pending implementation plan
**Feature:** User-toggled web search in the quiz-builder chat, powered by OpenRouter's
server-side web search through the Vercel AI SDK.

---

## 1. Goal & Scope

Add an optional **web search** capability to the builder chat so the assistant can ground
quiz content in real / recent facts when the user wants it.

**Behavior (decided during brainstorming):**

- **Control:** a user **toggle** in the chat input (🌐). Default **off**.
- **When on:** the request exposes OpenRouter's web-search server tool to the model. The
  model **may** search — it decides per message whether the query needs fresh/external
  facts ("may-search", not forced). Trivial messages skip search.
- **Sources display:** when a search ran, the assistant message shows a **Sources** strip
  below the text — clickable chips (title + domain/favicon + link). No inline `[1]`
  citations.
- **Cost control:** search config is attached **only when the toggle is on**, so cost is
  incurred only when the user opts in. `max_results: 5` pins per-search cost at ~$0.005.

**Non-goals (YAGNI):** inline numbered citations; per-source result caching; an engine
picker UI; a usage/cost dashboard; forcing search on every message.

---

## 2. Background — current architecture (verified)

- **Backend:** `src/app/api/chat/route.ts` calls
  `streamText({ model: openrouter('deepseek/deepseek-v4-flash'), tools: { updateQuiz }, ... })`
  and returns `result.toUIMessageStreamResponse({ ..., onFinish })`. Tool-calling already
  in use (`updateQuiz`).
- **Frontend:** `src/components/builder/ChatPanel.tsx` uses `useChat` from `@ai-sdk/react`
  with a `DefaultChatTransport` pointed at `/api/chat`. The transport already attaches
  extra body fields (`existingQuiz`, `quizId`, `parentId`). Messages render by iterating
  `message.parts` (text via `ReactMarkdown`; `tool-updateQuiz` parts drive the preview).
- **Persistence:** `chat_messages` table (`src/db/schema.ts`) stores `parts` (JSONB),
  `parentId`, `quizSnapshot`. `persistTurn` (`src/db/chat-queries.ts`) writes user +
  assistant rows from the route's `onFinish`.
- **Versions:** `ai@^6`, `@ai-sdk/react@^3`, `@openrouter/ai-sdk-provider@^2.9.0`,
  `next@16`, `react@19`.

**Two confirmed facts that shape this design:**

1. The current model (`deepseek/deepseek-v4-flash`) has **no native search**, so OpenRouter
   uses the **Exa fallback** at **~$0.005 per search** (up to 10 results; +$0.001 per
   extra result). Capping `max_results: 5` keeps it flat at ~$0.005.
2. OpenRouter returns citations via **`providerMetadata.openrouter.annotations`**
   (array of `{ url, title, content }`) — **not** as native AI SDK `source` parts. We must
   extract annotations ourselves and attach them to the assistant message.

---

## 3. Mechanism — enabling search

Prefer the **`openrouter:web_search` server tool** (model-invoked → matches "may-search").
The deprecated `plugins: [{ id: 'web' }]` form auto-searches **every** request (= forced),
which contradicts the chosen behavior.

- When `webSearch === true`, attach the OpenRouter web-search server tool to the
  `streamText` request with `{ max_results: 5 }`, alongside the existing `updateQuiz` tool.
- When `webSearch === false`, the request is unchanged from today (no search config, no
  cost).

> ⚠️ **Implementation-verification item (highest-risk unknown):** the exact wiring of the
> `openrouter:web_search` server tool through `@openrouter/ai-sdk-provider` v2.9.0 (whether
> it is passed via `tools`, `providerOptions.openrouter`, or `extraBody`). The
> implementation plan **must** verify this against the installed provider's types/source in
> `node_modules` before coding.
>
> **Documented fallback:** if the server tool cannot be wired cleanly in v2.9.0, fall back to
> `plugins: [{ id: 'web', max_results: 5 }]` via `extraBody` on the model factory. Trade-off:
> the plugin searches more eagerly (closer to "force"), but cost is still gated because the
> config is only attached when the toggle is on. Note this deviation in the plan if taken.

---

## 4. Data flow & persistence (no DB migration)

The key constraint: sources arrive in `providerMetadata`, but the app renders and persists
from `message.parts`. Bridge the two by injecting a **synthetic part** so the existing
`parts` JSONB pipeline carries sources end-to-end with **no schema change**.

Flow:

1. Toggle on → `ChatPanel` includes `webSearch: true` in the transport request body.
2. Route reads `webSearch`; if true, attaches the web-search server tool to `streamText`.
3. After generation, read `providerMetadata.openrouter.annotations` and map to
   `sources: Array<{ url: string; title: string; snippet?: string }>` (dedupe by URL).
4. Inject a synthetic part into the assistant message:
   `{ type: 'data-sources', data: sources }`. (Mechanism: a custom data part written into
   the UI message stream — e.g. via `createUIMessageStream` + `writer.write(...)` merged
   with `result.toUIMessageStream()`, or the AI SDK 6 equivalent confirmed during
   implementation.)
5. The part lands in `message.parts` → `persistTurn` writes it into `chat_messages.parts`
   unchanged. **No migration.**
6. On reload, chips re-render from the persisted `data-sources` part automatically.

**Why a part, not message metadata:** the codebase already persists and renders `parts`;
adding a `metadata` column would touch the schema, `persistTurn`, the load path, and render.
A synthetic part reuses all of it.

---

## 5. Frontend — `ChatPanel.tsx`

- **Toggle:** a small button beside the chat input. State `webSearch: boolean`, persisted to
  `localStorage` (default off). Active styling when on.
- **Send:** add `webSearch` to the transport request body (same place
  `existingQuiz` / `quizId` are attached).
- **Render:** in the per-message render loop, detect `part.type === 'data-sources'` and
  render a new `<SourceChips sources={part.data} />` component below the message text.
  Chip = favicon (from domain) + title + opens `url` in a new tab.

**New component:** `SourceChips` — small, presentational, one purpose (render a list of
source chips). No data fetching.

---

## 6. Error handling & cost guards

- **`max_results: 5`** caps per-search cost (~$0.005).
- **Per-turn search cap:** bound search invocations per message via the `streamText` step
  limit (`stopWhen`) so one user message can't fan out into many billed searches.
- **Search/tool failure:** degrade gracefully — the model answers without sources; no hard
  error surfaced to the user. Log server-side.
- **Toggle on but no search:** model judged it unnecessary → no Sources strip. Normal, not an
  error.
- **Empty/malformed annotations:** if no valid annotations come back, simply render no chips.

---

## 7. Affected files

| File | Change |
|------|--------|
| `src/app/api/chat/route.ts` | Read `webSearch` flag; attach web-search server tool when on; extract annotations; inject `data-sources` part; per-turn search cap |
| `src/components/builder/ChatPanel.tsx` | Toggle button + `localStorage` state; add `webSearch` to request body; render `data-sources` parts |
| `src/components/builder/SourceChips.tsx` (new) | Presentational source-chips component |
| (no schema change) | `data-sources` rides existing `parts` JSONB |

---

## 8. Open verification items for the plan

1. **Server-tool wiring** in `@openrouter/ai-sdk-provider` v2.9.0 (Section 3) — verify
   against installed types/source before coding; fall back to the `web` plugin if needed.
2. **Custom data-part injection** API in `ai@6` (Section 4 step 4) — confirm the exact
   `createUIMessageStream` / writer pattern that merges with `streamText`'s
   `toUIMessageStream()` and still fires the existing `onFinish` persistence.
3. **`providerMetadata` access point** — confirm whether annotations are read from the
   streamed result's resolved `providerMetadata` promise or inside `onFinish`.
