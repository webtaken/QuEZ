# AI Credits System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users get a one-time grant of 100 AI credits; every AI call (quiz-builder chat, web search, image OCR) debits credits from the real OpenRouter cost × 5 margin; out-of-credits blocks AI features; balance + history visible in the UI.

**Architecture:** Pure credit math lives in `src/lib/credit-math.ts`; all DB mutations live in `src/db/credit-queries.ts` (balance column on `users` + append-only `credit_transactions` ledger, updated atomically in one transaction). Routes do a pre-flight balance check (402 when ≤ 0) and debit post-hoc in `onFinish`/after `generateText`, where the OpenRouter-reported USD cost is known. Spec: `docs/superpowers/specs/2026-07-06-ai-credits-design.md`.

**Tech Stack:** Next.js 16 (App Router), Drizzle ORM + Postgres, better-auth, Vercel AI SDK v6 + `@openrouter/ai-sdk-provider`, vitest, pnpm.

## Global Constraints

- **1 credit = $0.01 retail; margin = 5×** → `credits = rawCostUsd × 500`. Signup grant = **100 credits**. Minimum debit for a completed generation = **0.01 credits**.
- Raw cost source of truth: `providerMetadata.openrouter.usage.cost` (USD). Fallback when missing: `totalTokens × $0.000002`.
- Balance **may go negative** (debits are post-hoc). Blocking happens on the *next* request when balance ≤ 0.
- Debit bookkeeping must **never** fail a user request — wrap debits in try/catch + `console.error`.
- This repo is **Next.js 16 with breaking changes** — if unsure about a Next API, check `node_modules/next/dist/docs/` before using it. Route params are `Promise` (`await params`), as existing routes show.
- Package manager: `pnpm`. Schema changes applied with `pnpm db:push` (no migration files).
- All new server code resolves the user via the existing pattern: `const session = await auth.api.getSession({ headers: await headers() })`.
- Tests: vitest, colocated `*.test.ts`, module mocks hoisted with `vi.mock`, dummy `DATABASE_URL` before importing routes (copy the style of `src/app/api/quizzes/[id]/route.test.ts`).
- Commit after every task. Run `pnpm test` and `pnpm lint` before each commit.

---

### Task 1: Schema — balance column + ledger table

**Files:**
- Modify: `src/db/schema.ts`
- No test file (schema only; verified by `pnpm db:push`)

**Interfaces:**
- Produces: `users.creditBalance: number` (numeric 12,4, mode number, default 0), `creditTransactions` table, types `CreditTransaction`, `NewCreditTransaction`. Later tasks import `creditTransactions`, `users` from `@/db/schema`.

- [ ] **Step 1: Add `creditBalance` to `users`**

In `src/db/schema.ts`, add `numeric` to the existing `drizzle-orm/pg-core` import list, then add the column to `users` (after `image`):

```ts
import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  uuid,
  index,
  numeric,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
```

```ts
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  creditBalance: numeric('credit_balance', { precision: 12, scale: 4, mode: 'number' })
    .notNull()
    .default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})
```

- [ ] **Step 2: Add the `credit_transactions` table**

Append after the `attachments` table definition (still in the `// --- App tables ---` section):

```ts
export const creditTransactions = pgTable(
  'credit_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Positive = grant, negative = debit. balanceAfter snapshots users.credit_balance
    // right after this row's delta was applied.
    amount: numeric('amount', { precision: 12, scale: 4, mode: 'number' }).notNull(),
    balanceAfter: numeric('balance_after', { precision: 12, scale: 4, mode: 'number' }).notNull(),
    type: text('type').notNull(), // 'signup_grant' | 'manual_grant' | 'chat' | 'ocr'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata: jsonb('metadata').$type<Record<string, any>>(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('credit_transactions_user_created_idx').on(t.userId, t.createdAt)]
)
```

- [ ] **Step 3: Export the row types**

Add to the type exports at the bottom of `src/db/schema.ts`:

```ts
export type CreditTransaction = typeof creditTransactions.$inferSelect
export type NewCreditTransaction = typeof creditTransactions.$inferInsert
```

- [ ] **Step 4: Push the schema**

Run: `pnpm db:push`
Expected: drizzle-kit reports the new column and table applied without errors. (If it prompts about the new column on existing rows, the `default(0)` covers it — accept.)

- [ ] **Step 5: Verify tests still pass and commit**

Run: `pnpm test && pnpm lint`
Expected: all existing tests PASS, no lint errors.

```bash
git add src/db/schema.ts
git commit -m "feat(credits): add credit balance column and transactions ledger"
```

---

### Task 2: Pure credit math (`src/lib/credit-math.ts`)

**Files:**
- Create: `src/lib/credit-math.ts`
- Test: `src/lib/credit-math.test.ts`

**Interfaces:**
- Produces (later tasks import these exact names from `@/lib/credit-math`):
  - `CREDIT_USD_VALUE = 0.01`, `MARGIN = 5`, `SIGNUP_GRANT_CREDITS = 100`, `MIN_DEBIT_CREDITS = 0.01`, `FALLBACK_USD_PER_TOKEN = 0.000002`
  - `usdToCredits(rawCostUsd: number): number`
  - `computeDebit(args: { steps: StepLike[]; totalTokens: number | undefined }): { credits: number; rawCostUsd: number; usedFallback: boolean }` — `StepLike = { providerMetadata?: { openrouter?: { usage?: { cost?: number } } } }` (structurally matches AI SDK `StepResult` from both `streamText` and `generateText`)
  - `formatCredits(balance: number): string` — 1 decimal, floored

- [ ] **Step 1: Write the failing tests**

Create `src/lib/credit-math.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  usdToCredits,
  computeDebit,
  formatCredits,
  MIN_DEBIT_CREDITS,
  SIGNUP_GRANT_CREDITS,
} from './credit-math'

describe('usdToCredits', () => {
  it('applies the 5x margin at 1 credit = $0.01', () => {
    expect(usdToCredits(0.001)).toBeCloseTo(0.5)
    expect(usdToCredits(0.005)).toBeCloseTo(2.5)
    expect(usdToCredits(0)).toBe(0)
  })
})

describe('computeDebit', () => {
  const step = (cost?: number) => ({
    providerMetadata: { openrouter: { usage: cost === undefined ? {} : { cost } } },
  })

  it('sums OpenRouter-reported cost across steps', () => {
    const out = computeDebit({ steps: [step(0.001), step(0.002)], totalTokens: 9999 })
    expect(out.rawCostUsd).toBeCloseTo(0.003)
    expect(out.credits).toBeCloseTo(1.5)
    expect(out.usedFallback).toBe(false)
  })

  it('ignores steps without cost when at least one reports it', () => {
    const out = computeDebit({ steps: [step(undefined), step(0.002)], totalTokens: 9999 })
    expect(out.rawCostUsd).toBeCloseTo(0.002)
    expect(out.usedFallback).toBe(false)
  })

  it('falls back to token pricing when no step reports cost', () => {
    const out = computeDebit({ steps: [step(undefined), {}], totalTokens: 10_000 })
    expect(out.rawCostUsd).toBeCloseTo(0.02) // 10_000 * 0.000002
    expect(out.credits).toBeCloseTo(10)
    expect(out.usedFallback).toBe(true)
  })

  it('never debits below the minimum for a completed generation', () => {
    const zeroCost = computeDebit({ steps: [step(0)], totalTokens: 0 })
    expect(zeroCost.credits).toBe(MIN_DEBIT_CREDITS)
    const noInfo = computeDebit({ steps: [], totalTokens: undefined })
    expect(noInfo.credits).toBe(MIN_DEBIT_CREDITS)
  })
})

describe('formatCredits', () => {
  it('floors to one decimal', () => {
    expect(formatCredits(82.56)).toBe('82.5')
    expect(formatCredits(100)).toBe('100.0')
    expect(formatCredits(0)).toBe('0.0')
  })
})

describe('constants', () => {
  it('grants 100 credits on signup', () => {
    expect(SIGNUP_GRANT_CREDITS).toBe(100)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/credit-math.test.ts`
Expected: FAIL — cannot resolve `./credit-math`.

- [ ] **Step 3: Implement `src/lib/credit-math.ts`**

```ts
// AI credits pricing. 1 credit = $0.01 of retail value; debits apply MARGIN on
// the raw OpenRouter cost, so credits = rawCostUsd * MARGIN / CREDIT_USD_VALUE.
export const CREDIT_USD_VALUE = 0.01
export const MARGIN = 5
export const SIGNUP_GRANT_CREDITS = 100
// Floor for any completed generation, so a reported $0 cost is never free.
export const MIN_DEBIT_CREDITS = 0.01
// Conservative estimate used only when OpenRouter omits the cost field ($2/M tokens).
export const FALLBACK_USD_PER_TOKEN = 0.000002

export function usdToCredits(rawCostUsd: number): number {
  return (rawCostUsd * MARGIN) / CREDIT_USD_VALUE
}

// Structurally matches AI SDK StepResult (streamText onFinish steps and
// generateText result.steps) without importing SDK types.
export type StepLike = {
  providerMetadata?: { openrouter?: { usage?: { cost?: number } } }
}

// Sums the OpenRouter-reported USD cost across all steps (tool round-trips
// included; the web-search fee lands in the same cost field). Falls back to a
// token-count estimate when no step reports a cost.
export function computeDebit(args: {
  steps: StepLike[]
  totalTokens: number | undefined
}): { credits: number; rawCostUsd: number; usedFallback: boolean } {
  let rawCostUsd = 0
  let reported = false
  for (const step of args.steps) {
    const cost = step.providerMetadata?.openrouter?.usage?.cost
    if (typeof cost === 'number' && cost >= 0) {
      rawCostUsd += cost
      reported = true
    }
  }
  const usedFallback = !reported
  if (usedFallback) rawCostUsd = (args.totalTokens ?? 0) * FALLBACK_USD_PER_TOKEN
  const credits = Math.max(usdToCredits(rawCostUsd), MIN_DEBIT_CREDITS)
  return { credits, rawCostUsd, usedFallback }
}

export function formatCredits(balance: number): string {
  return (Math.floor(balance * 10) / 10).toFixed(1)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/credit-math.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/credit-math.ts src/lib/credit-math.test.ts
git commit -m "feat(credits): pure credit math — margin conversion, step cost extraction, formatting"
```

---

### Task 3: Credit queries + manual grant script

**Files:**
- Create: `src/db/credit-queries.ts`
- Create: `src/db/grant-credits.ts`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: `usdToCredits` not needed here — callers pass final `credits`; `users`, `creditTransactions` from Task 1.
- Produces (later tasks import from `@/db/credit-queries`):
  - `type CreditTxType = 'signup_grant' | 'manual_grant' | 'chat' | 'ocr'`
  - `getBalance(userId: string): Promise<number>`
  - `grantCredits(args: { userId: string; amount: number; type: 'signup_grant' | 'manual_grant'; metadata?: Record<string, unknown> }): Promise<number>` — returns new balance
  - `debitCredits(args: { userId: string; credits: number; type: 'chat' | 'ocr'; metadata?: Record<string, unknown> }): Promise<number>` — `credits` positive, sign applied internally; returns new balance
  - `listTransactions(userId: string, limit?: number): Promise<CreditTransaction[]>` — newest first, default limit 100

These are thin DB wrappers (no unit tests — same policy as the existing `*-queries.ts` files). They are exercised by the route tests (Tasks 5–7) via mocks and verified for real in Step 4 below.

- [ ] **Step 1: Create `src/db/credit-queries.ts`**

```ts
import { eq, desc, sql } from 'drizzle-orm'
import { db } from '@/db'
import { users, creditTransactions, type CreditTransaction } from '@/db/schema'

export type CreditTxType = 'signup_grant' | 'manual_grant' | 'chat' | 'ocr'

export async function getBalance(userId: string): Promise<number> {
  const [row] = await db
    .select({ balance: users.creditBalance })
    .from(users)
    .where(eq(users.id, userId))
  return row?.balance ?? 0
}

// Atomic balance update + ledger insert. The returned balance comes from the
// UPDATE ... RETURNING, so concurrent deltas cannot drift the ledger.
async function applyCreditDelta(args: {
  userId: string
  delta: number
  type: CreditTxType
  metadata?: Record<string, unknown>
}): Promise<number> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(users)
      .set({ creditBalance: sql`${users.creditBalance} + ${args.delta}` })
      .where(eq(users.id, args.userId))
      .returning({ balance: users.creditBalance })
    if (!row) throw new Error(`applyCreditDelta: user not found: ${args.userId}`)
    await tx.insert(creditTransactions).values({
      userId: args.userId,
      amount: args.delta,
      balanceAfter: row.balance,
      type: args.type,
      metadata: args.metadata ?? null,
    })
    return row.balance
  })
}

export async function grantCredits(args: {
  userId: string
  amount: number
  type: 'signup_grant' | 'manual_grant'
  metadata?: Record<string, unknown>
}): Promise<number> {
  return applyCreditDelta({ userId: args.userId, delta: args.amount, type: args.type, metadata: args.metadata })
}

export async function debitCredits(args: {
  userId: string
  credits: number
  type: 'chat' | 'ocr'
  metadata?: Record<string, unknown>
}): Promise<number> {
  return applyCreditDelta({ userId: args.userId, delta: -args.credits, type: args.type, metadata: args.metadata })
}

export async function listTransactions(userId: string, limit = 100): Promise<CreditTransaction[]> {
  return db
    .select()
    .from(creditTransactions)
    .where(eq(creditTransactions.userId, userId))
    .orderBy(desc(creditTransactions.createdAt))
    .limit(limit)
}
```

- [ ] **Step 2: Create the grant script `src/db/grant-credits.ts`**

Same structure as `src/db/seed.ts` (dotenv import, exit codes):

```ts
import 'dotenv/config'
import { eq } from 'drizzle-orm'
import { db } from './index'
import { users } from './schema'
import { grantCredits } from './credit-queries'

async function main() {
  const [email, amountArg] = process.argv.slice(2)
  const amount = Number(amountArg)
  if (!email || !Number.isFinite(amount) || amount <= 0) {
    console.error('Usage: pnpm credits:grant <email> <amount>')
    process.exit(1)
  }
  const [user] = await db.select().from(users).where(eq(users.email, email))
  if (!user) {
    console.error(`No user found with email ${email}`)
    process.exit(1)
  }
  const balance = await grantCredits({ userId: user.id, amount, type: 'manual_grant' })
  console.log(`Granted ${amount} credits to ${email}. New balance: ${balance}`)
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
```

- [ ] **Step 3: Add the package.json script**

In `package.json` scripts, after `"db:unseed"`:

```json
"credits:grant": "tsx src/db/grant-credits.ts"
```

- [ ] **Step 4: Verify against the real database**

```bash
pnpm credits:grant nonexistent@example.com 10
```
Expected: `No user found with email nonexistent@example.com`, exit 1.

Then grant to a real user (the owner's account, and any existing test users — this doubles as the backfill for pre-credits accounts):

```bash
pnpm credits:grant nebulabsai@gmail.com 100
```
Expected: `Granted 100 credits to nebulabsai@gmail.com. New balance: 100`

- [ ] **Step 5: Run checks and commit**

Run: `pnpm test && pnpm lint`
Expected: PASS.

```bash
git add src/db/credit-queries.ts src/db/grant-credits.ts package.json
git commit -m "feat(credits): credit queries with atomic ledger and manual grant script"
```

---

### Task 4: Signup grant hook

**Files:**
- Modify: `src/lib/auth.ts`

**Interfaces:**
- Consumes: `grantCredits` from `@/db/credit-queries`, `SIGNUP_GRANT_CREDITS` from `@/lib/credit-math`.

- [ ] **Step 1: Add the databaseHooks block**

`src/lib/auth.ts` becomes:

```ts
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { db } from '@/db'
import * as schema from '@/db/schema'
import { grantCredits } from '@/db/credit-queries'
import { SIGNUP_GRANT_CREDITS } from '@/lib/credit-math'

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          // A failed grant must never break signup — the grant script can repair it.
          try {
            await grantCredits({ userId: user.id, amount: SIGNUP_GRANT_CREDITS, type: 'signup_grant' })
          } catch (e) {
            console.error('[auth] signup credit grant failed', e)
          }
        },
      },
    },
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    },
  },
})
```

- [ ] **Step 2: Verify types compile and tests pass**

Run: `pnpm test && pnpm lint && pnpm exec tsc --noEmit`
Expected: PASS. (Real signup is verified manually in Task 9's end-to-end check — sign in with a fresh Google account and confirm a `signup_grant` row exists.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/auth.ts
git commit -m "feat(credits): grant 100 credits on signup via better-auth hook"
```

---

### Task 5: Chat route — pre-flight check + debit

**Files:**
- Modify: `src/app/api/chat/route.ts`
- Test: `src/app/api/chat/route.test.ts` (new)

**Interfaces:**
- Consumes: `getBalance`, `debitCredits` from `@/db/credit-queries`; `computeDebit` from `@/lib/credit-math`.
- Produces: `POST /api/chat` now returns `402` with JSON body `{"error":"insufficient_credits"}` when balance ≤ 0. The client (Task 8) detects the string `insufficient_credits` in the useChat error message.

- [ ] **Step 1: Write the failing route test**

Create `src/app/api/chat/route.test.ts`. It mocks every import of the route (same hoisted-mock style as `src/app/api/quizzes/[id]/route.test.ts`):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}))

const getSession = vi.fn()
vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: () => getSession() } },
}))

const getBalance = vi.fn()
const debitCredits = vi.fn()
vi.mock('@/db/credit-queries', () => ({
  getBalance: (...a: unknown[]) => getBalance(...a),
  debitCredits: (...a: unknown[]) => debitCredits(...a),
}))

const streamText = vi.fn()
vi.mock('ai', () => ({
  streamText: (...a: unknown[]) => streamText(...a),
  convertToModelMessages: async () => [],
}))

const openrouterFactory = vi.fn((id: string, opts?: unknown) => ({ id, opts }))
vi.mock('@openrouter/ai-sdk-provider', () => ({
  openrouter: (id: string, opts?: unknown) => openrouterFactory(id, opts),
}))

vi.mock('@/lib/chat-tools', () => ({ buildChatTools: () => ({}) }))
vi.mock('@/db/chat-queries', () => ({ persistTurn: vi.fn() }))
vi.mock('@/lib/chat-messages', () => ({
  buildTurnMessages: () => ({ userMessage: {}, assistantMessage: {} }),
}))
vi.mock('@/lib/ids', () => ({ newId: () => '00000000-0000-4000-8000-000000000000' }))
vi.mock('@/lib/attachment-inject', () => ({
  collectAttachmentIds: () => [],
  buildAttachmentSystemBlock: () => '',
}))
vi.mock('@/db/attachment-queries', () => ({ loadReadyAttachments: async () => [] }))

process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test'

const { POST } = await import('./route')

function chatRequest() {
  return new Request('http://test/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
    }),
  })
}

beforeEach(() => {
  getSession.mockReset()
  getBalance.mockReset()
  debitCredits.mockReset()
  streamText.mockReset()
  streamText.mockReturnValue({
    toUIMessageStreamResponse: () => new Response('stream'),
  })
})

describe('POST /api/chat credits', () => {
  it('returns 401 when there is no session', async () => {
    getSession.mockResolvedValue(null)
    const res = await POST(chatRequest())
    expect(res.status).toBe(401)
    expect(streamText).not.toHaveBeenCalled()
  })

  it('returns 402 and skips the model call when balance is 0', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } })
    getBalance.mockResolvedValue(0)
    const res = await POST(chatRequest())
    expect(res.status).toBe(402)
    await expect(res.json()).resolves.toEqual({ error: 'insufficient_credits' })
    expect(streamText).not.toHaveBeenCalled()
  })

  it('streams when balance is positive and enables usage accounting', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } })
    getBalance.mockResolvedValue(42)
    const res = await POST(chatRequest())
    expect(res.status).toBe(200)
    expect(streamText).toHaveBeenCalledOnce()
    expect(openrouterFactory).toHaveBeenCalledWith(
      'deepseek/deepseek-v4-flash',
      expect.objectContaining({ usage: { include: true } })
    )
  })

  it('debits from summed step costs in onFinish', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } })
    getBalance.mockResolvedValue(42)
    await POST(chatRequest())
    const config = streamText.mock.calls[0][0] as {
      onFinish: (e: unknown) => Promise<void>
    }
    await config.onFinish({
      steps: [{ providerMetadata: { openrouter: { usage: { cost: 0.002 } } } }],
      totalUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    })
    expect(debitCredits).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        credits: 1, // 0.002 * 500
        type: 'chat',
        metadata: expect.objectContaining({ rawCostUsd: 0.002, usedFallback: false }),
      })
    )
  })

  it('never throws out of onFinish when the debit fails', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } })
    getBalance.mockResolvedValue(42)
    debitCredits.mockRejectedValue(new Error('db down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await POST(chatRequest())
    const config = streamText.mock.calls[0][0] as {
      onFinish: (e: unknown) => Promise<void>
    }
    await expect(
      config.onFinish({ steps: [], totalUsage: { totalTokens: 10 } })
    ).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/app/api/chat/route.test.ts`
Expected: FAIL — the 402 test gets a streamed 200 (no credit check exists yet), and the `usage: { include: true }` assertion fails.

- [ ] **Step 3: Implement the route changes**

In `src/app/api/chat/route.ts`:

Add imports:

```ts
import { getBalance, debitCredits } from '@/db/credit-queries'
import { computeDebit } from '@/lib/credit-math'
```

After the session guard (`if (!session) return new Response('Unauthorized', { status: 401 })`), add:

```ts
  const balance = await getBalance(session.user.id)
  if (balance <= 0) {
    return Response.json({ error: 'insufficient_credits' }, { status: 402 })
  }
```

Replace the `streamText` call (keep everything else identical):

```ts
  const result = streamText({
    model: openrouter(modelId, { usage: { include: true } }),
    system,
    messages: await convertToModelMessages(messages),
    tools: buildChatTools({ webSearch: webSearch ?? false }),
    onFinish: async ({ steps, totalUsage }) => {
      // Debit from the OpenRouter-reported cost. Bookkeeping must never break
      // the user's stream — swallow and log.
      try {
        const { credits, rawCostUsd, usedFallback } = computeDebit({
          steps,
          totalTokens: totalUsage?.totalTokens,
        })
        await debitCredits({
          userId: session.user.id,
          credits,
          type: 'chat',
          metadata: {
            ...(quizId ? { quizId } : {}),
            model: modelId,
            inputTokens: totalUsage?.inputTokens,
            outputTokens: totalUsage?.outputTokens,
            rawCostUsd,
            usedFallback,
            webSearch: webSearch ?? false,
          },
        })
      } catch (e) {
        console.error('[chat] credit debit failed', e)
      }
    },
  })
```

Note: this `onFinish` belongs to `streamText` (it receives `steps`/`totalUsage`). The existing `onFinish` inside `toUIMessageStreamResponse` (which persists the turn) stays untouched — they are different callbacks and both run.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/app/api/chat/route.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Full check and commit**

Run: `pnpm test && pnpm lint`
Expected: PASS.

```bash
git add src/app/api/chat/route.ts src/app/api/chat/route.test.ts
git commit -m "feat(credits): chat pre-flight balance check and post-stream debit"
```

---

### Task 6: OCR debit — attachment extraction + process route + client toast

**Files:**
- Modify: `src/lib/attachment-extract.ts`
- Modify: `src/lib/attachment-extract.test.ts`
- Modify: `src/app/api/attachments/[id]/process/route.ts`
- Modify: `src/components/builder/useAttachments.ts`

**Interfaces:**
- Consumes: `computeDebit` from `@/lib/credit-math`; `getBalance`, `debitCredits` from `@/db/credit-queries`.
- Produces: `extractAttachmentText` now returns `Promise<{ text: string; debit: { credits: number; rawCostUsd: number; usedFallback: boolean } | null }>` — `debit` is `null` for non-AI paths (text/pdf/docx/pptx/xlsx). Also exports `IMAGE_MODEL`. `POST /api/attachments/[id]/process` returns `402` + `{ status: 'error', errorMessage: 'Out of credits', ... }` for images when balance ≤ 0.

- [ ] **Step 1: Update the extraction tests (failing first)**

Rewrite `src/lib/attachment-extract.test.ts` — existing assertions move to `out.text`, plus new debit cases:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const parseOffice = vi.fn()
vi.mock('officeparser', () => ({ parseOffice: (...a: unknown[]) => parseOffice(...a) }))

const generateText = vi.fn()
vi.mock('ai', () => ({ generateText: (...a: unknown[]) => generateText(...a) }))
const openrouterFactory = vi.fn((id: string, opts?: unknown) => ({ id, opts }))
vi.mock('@openrouter/ai-sdk-provider', () => ({
  openrouter: (id: string, opts?: unknown) => openrouterFactory(id, opts),
}))

const { extractAttachmentText } = await import('./attachment-extract')

beforeEach(() => {
  parseOffice.mockReset()
  generateText.mockReset()
})

describe('extractAttachmentText', () => {
  it('decodes text files directly without calling officeparser and without debit', async () => {
    const bytes = new TextEncoder().encode('  hello notes  ')
    const out = await extractAttachmentText({ kind: 'text', bytes, mimeType: 'text/plain' })
    expect(out.text).toBe('hello notes')
    expect(out.debit).toBeNull()
    expect(parseOffice).not.toHaveBeenCalled()
  })

  it('runs officeparser for documents, trims, and reports no debit', async () => {
    parseOffice.mockResolvedValue({ toText: () => '  parsed pdf text  ' })
    const out = await extractAttachmentText({ kind: 'pdf', bytes: new Uint8Array([1, 2]), mimeType: 'application/pdf' })
    expect(out.text).toBe('parsed pdf text')
    expect(out.debit).toBeNull()
    expect(parseOffice).toHaveBeenCalledOnce()
    expect(Buffer.isBuffer(parseOffice.mock.calls[0][0])).toBe(true)
  })

  it('passes the kind as an explicit fileType hint so bundlers cannot break auto-detection', async () => {
    parseOffice.mockResolvedValue({ toText: () => 'x' })
    for (const kind of ['pdf', 'docx', 'pptx', 'xlsx'] as const) {
      await extractAttachmentText({ kind, bytes: new Uint8Array([1]), mimeType: 'application/octet-stream' })
      expect(parseOffice).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ fileType: kind }))
    }
  })

  it('sends images to the vision model with usage accounting and computes the debit', async () => {
    generateText.mockResolvedValue({
      text: 'transcribed image',
      steps: [{ providerMetadata: { openrouter: { usage: { cost: 0.0004 } } } }],
      usage: { totalTokens: 500 },
    })
    const bytes = new Uint8Array([9, 9])
    const out = await extractAttachmentText({ kind: 'image', bytes, mimeType: 'image/png' })
    expect(out.text).toBe('transcribed image')
    expect(out.debit).toEqual({ credits: 0.2, rawCostUsd: 0.0004, usedFallback: false })
    const arg = generateText.mock.calls[0][0]
    const content = arg.messages[0].content
    expect(content.some((c: { type: string }) => c.type === 'image')).toBe(true)
    expect(openrouterFactory).toHaveBeenCalledWith(
      'google/gemini-2.5-flash-lite',
      expect.objectContaining({ usage: { include: true } })
    )
  })

  it('falls back to token pricing when the image call reports no cost', async () => {
    generateText.mockResolvedValue({
      text: 'ok',
      steps: [{}],
      usage: { totalTokens: 10_000 },
    })
    const out = await extractAttachmentText({ kind: 'image', bytes: new Uint8Array([1]), mimeType: 'image/png' })
    expect(out.debit?.usedFallback).toBe(true)
    expect(out.debit?.rawCostUsd).toBeCloseTo(0.02)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/attachment-extract.test.ts`
Expected: FAIL — `out.text` is undefined (function still returns a string).

- [ ] **Step 3: Update `src/lib/attachment-extract.ts`**

```ts
import { parseOffice } from 'officeparser'
import { generateText } from 'ai'
import { openrouter } from '@openrouter/ai-sdk-provider'
import { computeDebit } from '@/lib/credit-math'
import type { AttachmentKind } from './attachment-kind'

export const IMAGE_MODEL = 'google/gemini-2.5-flash-lite'
const IMAGE_PROMPT =
  'Transcribe all text in this image verbatim. Then describe any diagrams, figures, charts, tables, or handwriting in detail. Output plain text only.'

export type ExtractResult = {
  text: string
  // Set only for AI-powered paths (images); null means the extraction was free.
  debit: { credits: number; rawCostUsd: number; usedFallback: boolean } | null
}

// Returns extracted plain text. Documents go through officeparser (pure JS/WASM,
// serverless-safe); plain text/markdown/csv are decoded directly; images are
// transcribed + described by a cheap vision model (which costs credits).
export async function extractAttachmentText(args: {
  kind: AttachmentKind
  bytes: Uint8Array
  mimeType: string
}): Promise<ExtractResult> {
  if (args.kind === 'image') {
    const result = await generateText({
      model: openrouter(IMAGE_MODEL, { usage: { include: true } }),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: IMAGE_PROMPT },
            { type: 'image', image: args.bytes, mediaType: args.mimeType },
          ],
        },
      ],
    })
    const debit = computeDebit({
      steps: result.steps ?? [],
      totalTokens: result.usage?.totalTokens,
    })
    return { text: result.text.trim(), debit }
  }

  if (args.kind === 'text') {
    return { text: Buffer.from(args.bytes).toString('utf-8').trim(), debit: null }
  }

  // pdf | docx | pptx | xlsx. The explicit fileType hint matters: officeparser's
  // magic-byte auto-detection loads `file-type` via a dynamic import that
  // bundlers (Next/Turbopack) cannot resolve at runtime, and the kind is
  // already authoritative from upload validation anyway.
  const ast = await parseOffice(Buffer.from(args.bytes), { fileType: args.kind })
  return { text: ast.toText().trim(), debit: null }
}
```

- [ ] **Step 4: Run to verify the extraction tests pass**

Run: `pnpm vitest run src/lib/attachment-extract.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Update the process route**

`src/app/api/attachments/[id]/process/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getOwnedAttachment, markAttachmentReady, markAttachmentError } from '@/db/attachment-queries'
import { getObjectBytes } from '@/lib/r2'
import { extractAttachmentText, IMAGE_MODEL } from '@/lib/attachment-extract'
import { getBalance, debitCredits } from '@/db/credit-queries'
import type { AttachmentKind } from '@/lib/attachment-kind'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const row = await getOwnedAttachment(id, session.user.id)
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Only image extraction hits an AI model; other kinds are free local parsing.
  if (row.kind === 'image') {
    const balance = await getBalance(session.user.id)
    if (balance <= 0) {
      await markAttachmentError(id, 'Out of credits')
      return NextResponse.json(
        { status: 'error', filename: row.filename, kind: row.kind, errorMessage: 'Out of credits' },
        { status: 402 }
      )
    }
  }

  try {
    const bytes = await getObjectBytes(row.r2Key)
    const { text, debit } = await extractAttachmentText({
      kind: row.kind as AttachmentKind,
      bytes,
      mimeType: row.mimeType,
    })
    if (debit) {
      // The model ran regardless of the text outcome — debit before the empty check.
      try {
        await debitCredits({
          userId: session.user.id,
          credits: debit.credits,
          type: 'ocr',
          metadata: {
            attachmentId: id,
            model: IMAGE_MODEL,
            rawCostUsd: debit.rawCostUsd,
            usedFallback: debit.usedFallback,
          },
        })
      } catch (e) {
        console.error('[attachments/process] credit debit failed', e)
      }
    }
    if (!text.trim()) {
      await markAttachmentError(id, 'No text could be extracted')
      return NextResponse.json({
        status: 'error',
        filename: row.filename,
        kind: row.kind,
        errorMessage: 'No text could be extracted from this file',
      })
    }
    await markAttachmentReady(id, text, { charCount: text.length })
    return NextResponse.json({ status: 'ready', filename: row.filename, kind: row.kind })
  } catch (e) {
    console.error('[attachments/process] extraction failed', e)
    await markAttachmentError(id, String((e as Error)?.message ?? e))
    return NextResponse.json({
      status: 'error',
      filename: row.filename,
      kind: row.kind,
      errorMessage: 'Could not process this file',
    })
  }
}
```

- [ ] **Step 6: Surface the 402 in the composer**

In `src/components/builder/useAttachments.ts`, add the import and handle the 402 inside `upload` (before the generic `proc.status !== 'ready'` check):

```ts
import { toast } from 'sonner'
```

```ts
        const procRes = await fetch(`/api/attachments/${id}/process`, { method: 'POST' })
        if (procRes.status === 402) {
          toast.error('Out of AI credits — image text extraction is paused')
          patch(id, { status: 'error', error: 'Out of credits' })
          return
        }
        const proc = await procRes.json().catch(() => ({ status: 'error' }))
        if (proc.status !== 'ready') {
          patch(id, { status: 'error', error: proc.errorMessage ?? 'Could not process file' })
          return
        }
        patch(id, { status: 'ready' })
```

- [ ] **Step 7: Full check and commit**

Run: `pnpm test && pnpm lint`
Expected: PASS.

```bash
git add src/lib/attachment-extract.ts src/lib/attachment-extract.test.ts "src/app/api/attachments/[id]/process/route.ts" src/components/builder/useAttachments.ts
git commit -m "feat(credits): debit image OCR and block extraction when out of credits"
```

---

### Task 7: `GET /api/credits`

**Files:**
- Create: `src/app/api/credits/route.ts`
- Test: `src/app/api/credits/route.test.ts`

**Interfaces:**
- Consumes: `getBalance`, `listTransactions` from `@/db/credit-queries`.
- Produces: `GET /api/credits` → `200 { balance: number, transactions: CreditTransaction[] }` (latest 100, newest first) | `401`. Task 8's `useCredits` hook consumes `balance`.

- [ ] **Step 1: Write the failing test**

Create `src/app/api/credits/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}))

const getSession = vi.fn()
vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: () => getSession() } },
}))

const getBalance = vi.fn()
const listTransactions = vi.fn()
vi.mock('@/db/credit-queries', () => ({
  getBalance: (...a: unknown[]) => getBalance(...a),
  listTransactions: (...a: unknown[]) => listTransactions(...a),
}))

process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test'

const { GET } = await import('./route')

beforeEach(() => {
  getSession.mockReset()
  getBalance.mockReset()
  listTransactions.mockReset()
})

describe('GET /api/credits', () => {
  it('returns 401 when there is no session', async () => {
    getSession.mockResolvedValue(null)
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('returns the balance and recent transactions for the session user', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } })
    getBalance.mockResolvedValue(82.5)
    const tx = [{ id: 't1', amount: -0.5, balanceAfter: 82.5, type: 'chat' }]
    listTransactions.mockResolvedValue(tx)
    const res = await GET()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ balance: 82.5, transactions: tx })
    expect(getBalance).toHaveBeenCalledWith('u1')
    expect(listTransactions).toHaveBeenCalledWith('u1', 100)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/app/api/credits/route.test.ts`
Expected: FAIL — `./route` does not exist.

- [ ] **Step 3: Implement `src/app/api/credits/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getBalance, listTransactions } from '@/db/credit-queries'

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [balance, transactions] = await Promise.all([
    getBalance(session.user.id),
    listTransactions(session.user.id, 100),
  ])
  return NextResponse.json({ balance, transactions })
}
```

- [ ] **Step 4: Run to verify pass, then commit**

Run: `pnpm vitest run src/app/api/credits/route.test.ts && pnpm test && pnpm lint`
Expected: PASS.

```bash
git add src/app/api/credits/route.ts src/app/api/credits/route.test.ts
git commit -m "feat(credits): GET /api/credits balance and history endpoint"
```

---

### Task 8: Badge + out-of-credits chat UX

**Files:**
- Create: `src/components/credits/useCredits.ts`
- Create: `src/components/credits/CreditsPill.tsx`
- Modify: `src/components/builder/ChatPanel.tsx`

**Interfaces:**
- Consumes: `GET /api/credits` (Task 7), `formatCredits` from `@/lib/credit-math`.
- Produces: `useCredits(): { balance: number | null; refetch: () => Promise<void> }`; `CreditsPill({ balance }: { balance: number | null })` — also used by Task 9.

These are UI components — no unit tests (matches the repo: no component tests exist). Verified manually in Step 5.

- [ ] **Step 1: Create `src/components/credits/useCredits.ts`**

```ts
'use client'

import { useCallback, useEffect, useState } from 'react'

export function useCredits() {
  const [balance, setBalance] = useState<number | null>(null)

  const refetch = useCallback(async () => {
    try {
      const res = await fetch('/api/credits')
      if (!res.ok) return
      const data: { balance: number } = await res.json()
      setBalance(data.balance)
    } catch {
      // Badge just stays stale — never surface fetch noise to the user.
    }
  }, [])

  useEffect(() => {
    void refetch()
  }, [refetch])

  return { balance, refetch }
}
```

- [ ] **Step 2: Create `src/components/credits/CreditsPill.tsx`**

```tsx
import Link from 'next/link'
import { Coins } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatCredits } from '@/lib/credit-math'

// Compact balance pill. Renders nothing until the balance is known so it never
// flashes a wrong number. Links to the credits history page.
export function CreditsPill({ balance }: { balance: number | null }) {
  if (balance === null) return null
  const tone =
    balance <= 0
      ? 'text-destructive border-destructive/40 bg-destructive/10'
      : balance < 10
        ? 'text-amber-500 border-amber-500/40 bg-amber-500/10'
        : 'text-muted-foreground border-border bg-secondary'
  return (
    <Link
      href="/dashboard/credits"
      title="AI credits"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
        tone
      )}
    >
      <Coins className="w-3.5 h-3.5" />
      {formatCredits(balance)}
    </Link>
  )
}
```

- [ ] **Step 3: Wire credits into `ChatPanel.tsx`**

All edits to `src/components/builder/ChatPanel.tsx`:

**3a.** Add imports:

```ts
import { useCredits } from '@/components/credits/useCredits'
import { CreditsPill } from '@/components/credits/CreditsPill'
```

**3b.** Inside the component, next to the existing `useState` calls at the top:

```ts
  const credits = useCredits()
  // Set when the server rejects a send with 402 — sticks until credits refresh above 0.
  const [creditsRejected, setCreditsRejected] = useState(false)
  const outOfCredits = creditsRejected || (credits.balance !== null && credits.balance <= 0)
```

**3c.** In the `useChat` options, extend `onError` (keep the existing console lines) by adding as the first statement:

```ts
      if (err?.message?.includes('insufficient_credits')) setCreditsRejected(true)
```

**3d.** In the `useChat` `onFinish` callback, add as the first statement (before `leafIdRef.current = message.id`):

```ts
      void credits.refetch()
```

**3e.** In the header block (the `div` containing the Bot icon and "QuEZ AI" text), add the pill right-aligned — after the closing `</div>` of the name/subtitle block, still inside the header row:

```tsx
        <div className="ml-auto">
          <CreditsPill balance={credits.balance} />
        </div>
```

**3f.** Guard `submit()` — add to the existing early-return condition:

```ts
    if ((!text && attachments.items.length === 0) || isLoading || attachments.anyBusy || outOfCredits) return
```

**3g.** Add the banner directly above the input area (immediately before `<div className="flex-shrink-0 border-t border-border p-4"`):

```tsx
      {outOfCredits && (
        <div className="flex-shrink-0 border-t border-border px-4 py-3 bg-destructive/10 text-sm text-destructive">
          Out of AI credits — the AI builder is paused. You can still edit your quiz manually.
        </div>
      )}
```

**3h.** Disable the send button — extend its `disabled` prop:

```ts
            disabled={isLoading || attachments.anyBusy || outOfCredits || (!input.trim() && attachments.items.filter((i) => i.status === 'ready').length === 0)}
```

- [ ] **Step 4: Typecheck, lint, tests**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm test`
Expected: PASS.

- [ ] **Step 5: Manual verification**

Run: `pnpm dev`, sign in, open `/dashboard/quizzes/new`:
1. Pill shows the balance in the chat header.
2. Send a message → after the reply finishes, the pill value drops slightly.
3. In psql/`pnpm db:studio`, set your balance to 0 (`UPDATE users SET credit_balance = 0 WHERE email = '<you>';`), reload → banner shows, send disabled.
4. Restore: `pnpm credits:grant <you> 100`.

- [ ] **Step 6: Commit**

```bash
git add src/components/credits/useCredits.ts src/components/credits/CreditsPill.tsx src/components/builder/ChatPanel.tsx
git commit -m "feat(credits): balance pill and out-of-credits state in the builder chat"
```

---

### Task 9: Dashboard pill + credits history page

**Files:**
- Modify: `src/app/dashboard/page.tsx`
- Create: `src/app/dashboard/credits/page.tsx`

**Interfaces:**
- Consumes: `getBalance`, `listTransactions` from `@/db/credit-queries`; `CreditsPill` from Task 8; `formatCredits` from `@/lib/credit-math`.

- [ ] **Step 1: Add the pill to the dashboard header**

In `src/app/dashboard/page.tsx`, add imports:

```ts
import { getBalance } from '@/db/credit-queries'
import { CreditsPill } from '@/components/credits/CreditsPill'
```

Fetch the balance after `userId` is resolved:

```ts
  const balance = await getBalance(userId)
```

In the header row, wrap the New Quiz link so the pill sits beside it — replace the existing `<Link href="/dashboard/quizzes/new">...</Link>` block (the one inside `justify-between mb-8`) with:

```tsx
        <div className="flex items-center gap-3">
          <CreditsPill balance={balance} />
          <Link href="/dashboard/quizzes/new">
            <Button className="bg-accent-lime text-accent-lime-foreground rounded-full gap-2 font-semibold">
              <Sparkles className="w-4 h-4" />
              New Quiz
            </Button>
          </Link>
        </div>
```

- [ ] **Step 2: Create `src/app/dashboard/credits/page.tsx`**

Server component (the dashboard layout already guards the session, same as `dashboard/page.tsx`):

```tsx
import { headers } from 'next/headers'
import Link from 'next/link'
import { Coins } from 'lucide-react'
import { auth } from '@/lib/auth'
import { getBalance, listTransactions } from '@/db/credit-queries'
import { formatCredits } from '@/lib/credit-math'
import { cn } from '@/lib/utils'

const TYPE_LABELS: Record<string, string> = {
  signup_grant: 'Signup bonus',
  manual_grant: 'Top-up',
  chat: 'Chat message',
  ocr: 'Image extraction',
}

function txLabel(type: string, metadata: Record<string, unknown> | null): string {
  if (type === 'chat' && metadata?.webSearch) return 'Web search chat'
  return TYPE_LABELS[type] ?? type
}

function txDetail(metadata: Record<string, unknown> | null): string | null {
  if (!metadata) return null
  const input = typeof metadata.inputTokens === 'number' ? metadata.inputTokens : 0
  const output = typeof metadata.outputTokens === 'number' ? metadata.outputTokens : 0
  const total = input + output
  return total > 0 ? `${total.toLocaleString()} tokens` : null
}

export default async function CreditsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  const userId = session!.user.id
  const [balance, transactions] = await Promise.all([
    getBalance(userId),
    listTransactions(userId, 100),
  ])

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="font-[family-name:var(--font-syne)] font-bold text-3xl text-foreground">
          AI Credits
        </h1>
        <p className="text-muted-foreground mt-1">
          Credits are spent when the AI builds quizzes, searches the web, or reads images.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 mb-10 flex items-center gap-4">
        <div className="w-12 h-12 rounded-full bg-accent-lime/20 flex items-center justify-center">
          <Coins className="w-6 h-6 text-accent-lime" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Current balance</p>
          <p className="font-[family-name:var(--font-syne)] font-bold text-3xl text-foreground">
            {formatCredits(balance)} <span className="text-base font-medium">credits</span>
          </p>
        </div>
      </div>

      <h2 className="font-semibold text-lg text-foreground mb-3">History</h2>
      {transactions.length === 0 ? (
        <p className="text-muted-foreground text-sm">No activity yet.</p>
      ) : (
        <div className="rounded-2xl border border-border bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Activity</th>
                <th className="px-5 py-3 font-medium text-right">Credits</th>
                <th className="px-5 py-3 font-medium text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx) => {
                const meta = tx.metadata as Record<string, unknown> | null
                const detail = txDetail(meta)
                const quizId = typeof meta?.quizId === 'string' ? meta.quizId : null
                return (
                  <tr key={tx.id} className="border-b border-border last:border-0">
                    <td className="px-5 py-3 text-muted-foreground whitespace-nowrap">
                      {tx.createdAt.toLocaleDateString()}{' '}
                      {tx.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-foreground">{txLabel(tx.type, meta)}</span>
                      {detail && <span className="text-muted-foreground ml-2 text-xs">{detail}</span>}
                      {quizId && (
                        <Link
                          href={`/dashboard/quizzes/${quizId}`}
                          className="text-accent-lime ml-2 text-xs hover:underline"
                        >
                          View quiz
                        </Link>
                      )}
                    </td>
                    <td
                      className={cn(
                        'px-5 py-3 text-right font-medium whitespace-nowrap',
                        tx.amount >= 0 ? 'text-accent-lime' : 'text-foreground'
                      )}
                    >
                      {tx.amount >= 0 ? '+' : ''}
                      {tx.amount.toFixed(2)}
                    </td>
                    <td className="px-5 py-3 text-right text-muted-foreground whitespace-nowrap">
                      {formatCredits(tx.balanceAfter)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Typecheck, lint, tests, build**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm test && pnpm build`
Expected: all PASS; build compiles `/dashboard/credits`.

- [ ] **Step 4: End-to-end manual verification**

With `pnpm dev`:
1. `/dashboard` shows the pill next to New Quiz.
2. Pill click → `/dashboard/credits` shows balance headline + history rows (grants from Task 3, chat debits from Task 8's test message, with token detail and quiz link).
3. Send one chat message with web search enabled → new history row labeled "Web search chat" with a noticeably larger debit.
4. Upload an image attachment → "Image extraction" row appears.
5. (If a spare Google account is available) sign up fresh → balance starts at 100.0 with a "Signup bonus" row — this also verifies Task 4's hook.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/page.tsx src/app/dashboard/credits/page.tsx
git commit -m "feat(credits): dashboard balance pill and credits history page"
```
