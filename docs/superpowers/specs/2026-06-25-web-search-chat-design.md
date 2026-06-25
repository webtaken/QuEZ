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

**Confirmed facts that shape this design** (verified against installed
`@openrouter/ai-sdk-provider@2.9.0` and `ai@6.0.174` in `node_modules`):

1. The current model (`deepseek/deepseek-v4-flash`) has **no native search**, so OpenRouter
   uses the **Exa fallback** at **~$0.005 per search** (up to 10 results; +$0.001 per
   extra result). Capping `maxResults: 5` keeps it flat at ~$0.005.
2. The provider exposes a **typed server tool**: `openrouter.tools.webSearch(args)` where
   `args: { maxResults?: number; searchPrompt?: string; engine?: 'auto'|'native'|'exa' }`.
   Passed in `streamText({ tools })`, it is **provider-executed** and **model-invoked** —
   the model calls it only when it judges the query needs facts. This *is* the "may-search"
   behavior. (The deprecated `plugins:[{id:'web'}]` / `web_search_options` settings force a
   search every request — wrong for may-search.)
3. The provider **auto-converts** OpenRouter `url_citation` annotations into **native AI SDK
   `source-url` parts**: `{ type: 'source-url', sourceId, url, title, providerMetadata }`.
   We do **not** extract from `providerMetadata` ourselves. Sending these to the client just
   requires `sendSources: true` on `toUIMessageStreamResponse`. They then live in
   `message.parts` like any other part — so existing `parts` JSONB persistence carries them
   end-to-end with **no schema change and no synthetic part**.

---

## 3. Mechanism — enabling search

Use the typed **`openrouter.tools.webSearch({ maxResults: 5 })`** server tool
(model-invoked → matches "may-search").

- When `webSearch === true`, include the web-search server tool in the `streamText` `tools`
  record alongside the existing `updateQuiz` tool.
- When `webSearch === false`, the `tools` record is exactly as today (no search tool, no
  cost).
- Set `sendSources: true` on `toUIMessageStreamResponse` so the auto-generated `source-url`
  parts reach the client.

Because the tool is provider-executed, OpenRouter runs the search and the model's response
already incorporates the results in a single completion — no extra `streamText` step or
`stopWhen` change is required (the search tool has no client-side `execute`).

> ⚠️ **One integration risk to smoke-test:** the exact tool key the provider expects in the
> `tools` record, and confirming `source-url` parts actually arrive in the **streaming**
> path (the provider's annotation→source conversion was verified in the non-streaming path).
> The plan's final task is a live smoke test (toggle on, ask a current-events question,
> confirm chips appear) that catches both.

---

## 4. Data flow & persistence (no DB migration)

Sources travel as native `source-url` parts — no synthetic part, no metadata extraction.

Flow:

1. Toggle on → `ChatPanel` includes `webSearch: true` in the transport request body.
2. Route reads `webSearch`; if true, includes `openrouter.tools.webSearch({ maxResults: 5 })`
   in the `streamText` `tools` record. Sets `sendSources: true` on the response.
3. The provider converts `url_citation` annotations into `source-url` parts and the SDK
   streams them into the assistant `message.parts`.
4. `persistTurn` already writes `responseMessage.parts` into `chat_messages.parts` (JSONB) —
   `source-url` parts ride along unchanged. **No migration.**
5. On reload, `dbRowToUIMessage` returns the stored `parts` (including `source-url`), and
   `ChatPanel` renders chips from them.

A small pure helper `extractSources(parts)` normalizes `source-url` parts into
`{ url, title }[]` (deduped by URL) for rendering — the only new logic, and it is unit-tested.

---

## 5. Frontend — `ChatPanel.tsx`

- **Toggle:** a small button beside the chat input. State `webSearch: boolean`, persisted to
  `localStorage` (default off). Active styling when on. A `webSearchRef` mirrors the state so
  the existing `transport.body` callback (which reads refs at send-time) sees the current
  value.
- **Send:** add `webSearch: webSearchRef.current` to the transport request body (same place
  `existingQuiz` / `quizId` are attached).
- **Render:** for each assistant message, compute `extractSources(parts)` and, when
  non-empty, render `<SourceChips sources={...} />` below the message text.
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
| `src/lib/chat-tools.ts` (new) | `buildChatTools({ webSearch })` — assembles the `streamText` `tools` record; adds the web-search server tool when on |
| `src/lib/chat-messages.ts` | Add `extractSources(parts)` helper |
| `src/app/api/chat/route.ts` | Read `webSearch` flag; use `buildChatTools`; set `sendSources: true` |
| `src/components/builder/SourceChips.tsx` (new) | Presentational source-chips component |
| `src/components/builder/ChatPanel.tsx` | Toggle button + `localStorage` state + ref; add `webSearch` to request body; render `<SourceChips>` from `extractSources(parts)` |
| (no schema change) | `source-url` parts ride existing `parts` JSONB |

---

## 8. Verification

Pure logic is unit-tested (vitest, node env): `extractSources`, `buildChatTools`. UI
(`SourceChips`, `ChatPanel` toggle/render) and the live OpenRouter integration have no unit
harness (vitest is node-only, no testing-library) → verified by `next build` + `eslint` +
a **live smoke test**: toggle web search on, ask a current-events question, confirm the
model searches, source chips render, and chips persist across reload. The smoke test also
confirms the two integration unknowns from Section 3 (tool key + streaming source parts).
