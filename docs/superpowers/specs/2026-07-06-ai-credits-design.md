# AI Credits System — Design

**Date:** 2026-07-06
**Status:** Approved (brainstorming complete)
**Scope:** Credits only — no payments/Stripe yet.

## Overview

Every user gets a one-time grant of 100 AI credits. All AI usage (quiz-builder chat, web search, image OCR) debits credits based on the real token cost of each call plus a margin. When credits run out, AI features are blocked until the owner grants more manually. Payments come later; this design leaves a clean seam for them (a future Stripe webhook calls the same grant function).

## Economics

- **1 credit = $0.01 of retail value.** 100 credits = $1.00 retail.
- **Margin: 5×** on raw provider cost. Formula: `credits = rawCostUsd × 5 / 0.01 = rawCostUsd × 500`.
- **Source of truth for raw cost:** OpenRouter usage accounting — `providerMetadata.openrouter.usage.cost` (USD actually charged by OpenRouter for the generation, including the web-search fee). No per-model price table to maintain.
- **Fallback** when the cost field is missing (provider hiccup): estimate from token counts (`totalUsage`) at a conservative hardcoded per-token price. Fallback constant lives next to the margin in `src/lib/credits.ts`.
- Expected costs: plain chat message ≈ 0.5 credits, chat message with web search ≈ 3 credits, image OCR ≈ 0.1 credits.
- Grading is deterministic (no AI) — never costs credits. Non-image attachment parsing (pdf/docx/pptx/xlsx/text via officeparser) is local — never costs credits.

## Grants

- **Signup:** 100 credits, granted via better-auth `databaseHooks.user.create.after` in `src/lib/auth.ts` (type `signup_grant`).
- **Manual top-up:** `pnpm credits:grant <email> <amount>` — a tsx script (like `db:seed`) calling `grantCredits` with type `manual_grant`. Also used once to backfill existing users after schema push.
- No refresh cycle, no expiry, no plan tiers in v1.

## Data Model

In `src/db/schema.ts`, applied with `pnpm db:push`:

**`users`** — add column:
- `creditBalance` — `numeric(12,4)`, not null, default `0`.

**`credit_transactions`** — new table (append-only ledger):
- `id` — text PK (same id pattern as existing tables)
- `userId` — text, FK → `users.id`, cascade delete, not null
- `amount` — `numeric(12,4)`, not null; positive = grant, negative = debit
- `balanceAfter` — `numeric(12,4)`, not null
- `type` — text, not null: `signup_grant` | `manual_grant` | `chat` | `ocr`
- `metadata` — jsonb, nullable: `{ quizId?, model?, inputTokens?, outputTokens?, rawCostUsd?, webSearch? }`
- `createdAt` — timestamp, not null, default now
- Index on `(userId, createdAt)`

## Core Module — `src/lib/credits.ts`

Single owner of all credit math and mutations:

- `CREDIT_USD_VALUE = 0.01`, `MARGIN = 5` (exported constants)
- `getBalance(userId): Promise<number>`
- `grantCredits({ userId, amount, type, metadata? })` — atomic: increment balance + insert ledger row with `balanceAfter`
- `debitForUsage({ userId, rawCostUsd, type, metadata })` — converts cost → credits, then atomic: decrement balance + insert ledger row
- Atomicity: one DB transaction with `UPDATE users SET credit_balance = credit_balance ± x ... RETURNING credit_balance`, then ledger insert using the returned value. Race-safe under concurrent requests; balance and ledger cannot drift.
- Balance **may go negative**: debits are post-hoc (actual cost known only after the stream finishes). Blocking happens on the *next* request. Overshoot bounded to roughly one message.

## Debit Flow — Chat (`src/app/api/chat/route.ts`)

1. After the existing session guard: if `getBalance(userId) <= 0` → respond `402` with `{ error: 'insufficient_credits' }`.
2. Enable usage accounting: `openrouter(CHAT_MODEL, { usage: { include: true } })`.
3. In `streamText`'s `onFinish`: sum `steps[i].providerMetadata?.openrouter?.usage?.cost` across all steps (covers tool round-trips and the web-search fee). If no step reports cost, use the token fallback with `totalUsage`.
4. Call `debitForUsage({ type: 'chat', metadata: { quizId, model, inputTokens, outputTokens, rawCostUsd, webSearch } })`.

## Debit Flow — Image OCR (`src/app/api/attachments/[id]/process/route.ts`)

Same pattern, only for `kind === 'image'` (the AI path):
1. Pre-flight balance check → `402` if `<= 0`.
2. `extractAttachmentText` returns usage/cost alongside text (enable `usage: { include: true }` on the OCR model in `src/lib/attachment-extract.ts`).
3. `debitForUsage({ type: 'ocr', ... })`.

## API

- `GET /api/credits` — session-guarded; returns `{ balance, transactions }` (latest 100, newest first). No pagination in v1.

## UI

**Balance badge** — small pill (coin icon + balance) in the builder header and dashboard header. Client component fetching `GET /api/credits`. In the builder, refetch after each chat turn (`useChat` `onFinish`) so burn is visible live. Amber below 10 credits, red at ≤ 0.

**Out-of-credits state** — in `ChatPanel`:
- On `402` from send (`useChat` `onError`): show an "Out of credits" banner in the chat and disable the input.
- Pre-emptive: if balance ≤ 0 on load, show the same state without sending a request.
- OCR route `402` → sonner toast, attachment marked failed.

**History page** — `/dashboard/credits`:
- Balance headline.
- Transaction table: date, type label ("Chat message", "Web search chat", "Image extraction", "Signup bonus", "Top-up"), signed amount (colored), balance after, detail line from metadata (tokens, quiz link).
- Reuses the dashboard layout and existing table styling.

**Display rounding:** store 4 decimals, display 1 decimal (floor). Users see credits only — never raw USD.

## Error Handling & Edge Cases

- **Concurrent requests:** both may pass pre-flight near zero; atomic decrement keeps the ledger consistent; balance may dip negative — accepted.
- **Missing cost metadata:** token-count fallback estimate; never debit zero for a completed generation, never fail the user's request because of debit bookkeeping (log the error, respond normally).
- **Client-aborted stream:** `onFinish` doesn't fire → message goes undebited. Accepted v1 loss (pennies).
- **Existing users:** backfilled via the grant script after `db:push`.

## Testing (vitest)

- `credits.ts` unit tests: cost→credit conversion, grant/debit math, ledger `balanceAfter` correctness, negative-balance behavior.
- Cost-extraction helper unit tests: multi-step summing, fallback path when cost is missing.
- Route test: chat returns `402` when balance ≤ 0.

## Out of Scope (explicit)

Stripe/payments, monthly refresh, plan tiers, credit expiry, admin UI (script only), per-message cost display in chat, pagination on history.

## Future Seam

When payments arrive: Stripe webhook on invoice paid → `grantCredits({ type: 'subscription_grant' (new), amount: planCredits })`. Pre-flight, debit, ledger, and UI all unchanged.
