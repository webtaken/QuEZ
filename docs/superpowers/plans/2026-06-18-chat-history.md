# Chat History, Branching Edits & Quiz Versioning — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist quiz-builder chat history per quiz, support ChatGPT-style branching edits, and snapshot the quiz per AI turn with explicit restore.

**Architecture:** A flat `chat_messages` table stores every message as a tree node (`parentId` self-ref). A single `quizzes.activeLeafId` pointer defines the active path (walk parents up from the leaf). A pure, dependency-free `chat-tree` module derives the active path / siblings / leaf descent and is unit-tested with vitest. The chat route persists each turn server-side in `onFinish` and snapshots the resulting quiz onto the assistant row. The server page loads the active path and hydrates `useChat`. `ChatPanel` adds message actions (edit→branch, regenerate, delete, copy, timestamps, retry) and a version badge + restore.

**Tech Stack:** Next 16 (App Router), `ai` v6, `@ai-sdk/react` v3, drizzle-orm 0.45 + drizzle-kit (push), better-auth, zod, vitest (added in Task 1), Tailwind, lucide-react, sonner.

## Global Constraints

- **This is a modified Next.js** — per `AGENTS.md`, read `node_modules/next/dist/docs/` before using any Next API that differs from training data; heed deprecation notices.
- Migrations are **push-based**: schema changes apply with `npm run db:push` (no SQL migration files).
- Every API route MUST verify ownership: `quiz.userId === session.user.id`; return 404 when the quiz isn't found for that user, 401 when there is no session. Follow `src/app/api/quizzes/[id]/route.ts`.
- Validate route id with the existing `UUID_RE` pattern before querying.
- `useChat` message ids and `chat_messages.id` are the **same** server-generated uuid (via `generateMessageId`) so reload is stable.
- The greeting bubble stays a client-only constant; never persist it.
- Quiz "Save changes" (`PUT /api/quizzes/[id]`) stays quiz-only and is not modified by this work.
- TypeScript strict: no `any` in new code except where mirroring the existing `parts` access pattern already in `ChatPanel.tsx`.

## Verification model (read before starting)

The repo has **no test runner and no test DB harness**. Tasks split into two kinds:

- **Pure-logic tasks (1, 3):** TDD with vitest — `npx vitest run <file>`.
- **DB / route / React tasks (2, 4–11):** verified by `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npm run db:push`, and the **scripted dev smoke** given in each task (start `npm run dev`, perform listed clicks, observe). No automated browser tests are added — that harness does not exist in this repo and is out of scope.

## File Structure

- `src/lib/chat-tree.ts` — **new.** Pure tree logic over plain node arrays. No DB/React imports. Unit-tested.
- `src/lib/chat-tree.test.ts` — **new.** Vitest unit tests for the above.
- `src/lib/chat-messages.ts` — **new.** Map DB rows ↔ `UIMessage`; extract quiz from a message's tool part. Pure. Unit-tested.
- `src/lib/chat-messages.test.ts` — **new.** Vitest unit tests.
- `src/db/schema.ts` — **modify.** Add `chatMessages` table + `quizzes.activeLeafId`.
- `src/db/chat-queries.ts` — **new.** Drizzle reads/writes for messages (load path, persist turn, set active leaf, delete subtree).
- `src/app/api/chat/route.ts` — **modify.** Persist turn in `onFinish`, accept `parentId`, snapshot quiz.
- `src/app/api/quizzes/[id]/active-leaf/route.ts` — **new.** PATCH branch switch.
- `src/app/api/quizzes/[id]/messages/[mid]/route.ts` — **new.** DELETE node + subtree.
- `src/app/dashboard/quizzes/[id]/page.tsx` — **modify.** Load active path, pass `initialMessages` + `activeLeafId`.
- `src/components/builder/QuizEditor.tsx` — **modify.** Thread props to `ChatPanel`.
- `src/components/builder/ChatPanel.tsx` — **modify.** Hydration + hydration-fix, message actions, switcher, restore.
- `vitest.config.ts`, `package.json` — **modify/new.** Test harness (Task 1).

---

### Task 1: Test harness + `chat-tree` pure module

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (devDeps + `test` script)
- Create: `src/lib/chat-tree.ts`
- Test: `src/lib/chat-tree.test.ts`

**Interfaces:**
- Produces:
  - `type TreeNode = { id: string; parentId: string | null; createdAt: Date }`
  - `childrenOf(nodes: TreeNode[], parentId: string | null): TreeNode[]` — sorted by `createdAt` asc, then `id`.
  - `descendToLeaf(nodes: TreeNode[], startId: string): string` — newest child each step, returns leaf id.
  - `buildActivePath(nodes: TreeNode[], activeLeafId: string | null): string[]` — root→leaf id order; `[]` if leaf missing.
  - `siblingInfo(nodes: TreeNode[], nodeId: string, activeLeafId: string): { index: number; count: number; siblingIds: string[] }` — siblings = nodes sharing this node's `parentId`, sorted; `index` is this node's position; `count` total.
  - `switchSibling(nodes: TreeNode[], forkChildId: string, dir: -1 | 1, activeLeafId: string): string | null` — among siblings of `forkChildId`, move `dir`, then `descendToLeaf`; returns new leaf id or `null` if move is out of range.

- [ ] **Step 1: Install vitest**

```bash
npm install -D vitest@^3
```

- [ ] **Step 2: Add the test script**

In `package.json` `scripts`, add:

```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
```

- [ ] **Step 4: Write the failing test** — `src/lib/chat-tree.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import {
  childrenOf,
  descendToLeaf,
  buildActivePath,
  siblingInfo,
  switchSibling,
  type TreeNode,
} from './chat-tree'

// Tree:
//   U1 - A1 -+- U2  - A2
//           +- U2' -+- A2'
//                   +- A2''
const t = (id: string, parentId: string | null, ms: number): TreeNode => ({
  id,
  parentId,
  createdAt: new Date(ms),
})
const nodes: TreeNode[] = [
  t('U1', null, 1),
  t('A1', 'U1', 2),
  t('U2', 'A1', 3),
  t('A2', 'U2', 4),
  t('U2p', 'A1', 5),
  t('A2p', 'U2p', 6),
  t('A2pp', 'U2p', 7),
]

describe('childrenOf', () => {
  it('returns direct children sorted by createdAt', () => {
    expect(childrenOf(nodes, 'A1').map((n) => n.id)).toEqual(['U2', 'U2p'])
  })
  it('returns roots for null parent', () => {
    expect(childrenOf(nodes, null).map((n) => n.id)).toEqual(['U1'])
  })
})

describe('descendToLeaf', () => {
  it('follows newest child to a leaf', () => {
    expect(descendToLeaf(nodes, 'A1')).toBe('A2pp')
  })
  it('returns the node itself when it is a leaf', () => {
    expect(descendToLeaf(nodes, 'A2')).toBe('A2')
  })
})

describe('buildActivePath', () => {
  it('walks parents up from the leaf, root first', () => {
    expect(buildActivePath(nodes, 'A2pp')).toEqual(['U1', 'A1', 'U2p', 'A2pp'])
  })
  it('returns [] when the leaf is missing', () => {
    expect(buildActivePath(nodes, 'nope')).toEqual([])
  })
  it('returns [] for null leaf', () => {
    expect(buildActivePath(nodes, null)).toEqual([])
  })
})

describe('siblingInfo', () => {
  it('reports index/count among same-parent siblings', () => {
    expect(siblingInfo(nodes, 'U2p', 'A2pp')).toEqual({
      index: 1,
      count: 2,
      siblingIds: ['U2', 'U2p'],
    })
  })
  it('is 1/1 for an only child', () => {
    expect(siblingInfo(nodes, 'A1', 'A2pp')).toMatchObject({ index: 0, count: 1 })
  })
})

describe('switchSibling', () => {
  it('moves to the previous sibling and descends to its leaf', () => {
    expect(switchSibling(nodes, 'U2p', -1, 'A2pp')).toBe('A2')
  })
  it('returns null when moving out of range', () => {
    expect(switchSibling(nodes, 'U2p', 1, 'A2pp')).toBeNull()
  })
})
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npx vitest run src/lib/chat-tree.test.ts`
Expected: FAIL — `Failed to resolve import "./chat-tree"`.

- [ ] **Step 6: Implement `src/lib/chat-tree.ts`**

```ts
export type TreeNode = { id: string; parentId: string | null; createdAt: Date }

function byCreatedAt(a: TreeNode, b: TreeNode): number {
  const d = a.createdAt.getTime() - b.createdAt.getTime()
  return d !== 0 ? d : a.id.localeCompare(b.id)
}

export function childrenOf(nodes: TreeNode[], parentId: string | null): TreeNode[] {
  return nodes.filter((n) => n.parentId === parentId).sort(byCreatedAt)
}

export function descendToLeaf(nodes: TreeNode[], startId: string): string {
  let current = startId
  for (;;) {
    const kids = childrenOf(nodes, current)
    if (kids.length === 0) return current
    current = kids[kids.length - 1].id // newest
  }
}

export function buildActivePath(nodes: TreeNode[], activeLeafId: string | null): string[] {
  if (!activeLeafId) return []
  const byId = new Map(nodes.map((n) => [n.id, n]))
  if (!byId.has(activeLeafId)) return []
  const path: string[] = []
  let cursor: string | null = activeLeafId
  const guard = new Set<string>()
  while (cursor) {
    if (guard.has(cursor)) break // cycle guard
    guard.add(cursor)
    const node = byId.get(cursor)
    if (!node) break
    path.push(node.id)
    cursor = node.parentId
  }
  return path.reverse()
}

export function siblingInfo(
  nodes: TreeNode[],
  nodeId: string,
  _activeLeafId: string
): { index: number; count: number; siblingIds: string[] } {
  const node = nodes.find((n) => n.id === nodeId)
  if (!node) return { index: 0, count: 0, siblingIds: [] }
  const sibs = childrenOf(nodes, node.parentId)
  const siblingIds = sibs.map((s) => s.id)
  return { index: siblingIds.indexOf(nodeId), count: sibs.length, siblingIds }
}

export function switchSibling(
  nodes: TreeNode[],
  forkChildId: string,
  dir: -1 | 1,
  activeLeafId: string
): string | null {
  const { index, siblingIds } = siblingInfo(nodes, forkChildId, activeLeafId)
  const target = index + dir
  if (target < 0 || target >= siblingIds.length) return null
  return descendToLeaf(nodes, siblingIds[target])
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run src/lib/chat-tree.test.ts`
Expected: PASS — all assertions green.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/lib/chat-tree.ts src/lib/chat-tree.test.ts
git commit -m "feat(chat): add chat-tree pure module + vitest harness"
```

---

### Task 2: DB schema — `chat_messages` + `quizzes.activeLeafId`

**Files:**
- Modify: `src/db/schema.ts`

**Interfaces:**
- Produces:
  - `chatMessages` table; `ChatMessage = typeof chatMessages.$inferSelect`, `NewChatMessage = typeof chatMessages.$inferInsert`.
  - `quizzes.activeLeafId` column (uuid, nullable).

- [ ] **Step 1: Add the `AnyPgColumn` import**

In `src/db/schema.ts`, extend the existing import from `drizzle-orm/pg-core` to include `AnyPgColumn`:

```ts
import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
```

- [ ] **Step 2: Add `activeLeafId` to `quizzes`**

In the `quizzes` table definition, add after `playCount`:

```ts
  activeLeafId: uuid('active_leaf_id'),
```

(No FK constraint — it points into `chat_messages`, which is declared after `quizzes`; keeping it constraint-free avoids a circular DDL dependency and is fine for a single pointer.)

- [ ] **Step 3: Add the `chatMessages` table**

After the `questions` table, add:

```ts
export const chatMessages = pgTable('chat_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  quizId: uuid('quiz_id')
    .notNull()
    .references(() => quizzes.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // 'user' | 'assistant'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parts: jsonb('parts').notNull().$type<any[]>(),
  parentId: uuid('parent_id').references((): AnyPgColumn => chatMessages.id, {
    onDelete: 'cascade',
  }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  quizSnapshot: jsonb('quiz_snapshot').$type<any>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})
```

- [ ] **Step 4: Add the inferred types**

At the bottom of the file, with the other type exports:

```ts
export type ChatMessage = typeof chatMessages.$inferSelect
export type NewChatMessage = typeof chatMessages.$inferInsert
```

- [ ] **Step 5: Push schema + typecheck**

Run: `npm run db:push`
Expected: drizzle-kit applies the new table + column without errors.
Run: `npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts
git commit -m "feat(chat): add chat_messages table + quizzes.activeLeafId"
```

---

### Task 3: Message mapping helpers (`chat-messages.ts`)

**Files:**
- Create: `src/lib/chat-messages.ts`
- Test: `src/lib/chat-messages.test.ts`

**Interfaces:**
- Consumes: `QuizPayload` from `@/lib/quiz-schema`.
- Produces:
  - `type UIMsgLike = { id: string; role: 'user' | 'assistant'; parts: unknown[] }`
  - `dbRowToUIMessage(row: { id: string; role: string; parts: unknown[] }): UIMsgLike` — shape `useChat` expects.
  - `extractQuizFromParts(parts: unknown[]): QuizPayload | null` — find a `tool-updateQuiz` part with `state === 'output-available'` and return `output.quiz`, else `null`.
  - `collectToolCallIds(messages: { parts: unknown[] }[]): string[]` — all `toolCallId`s present (for the hydration-fix seed).

- [ ] **Step 1: Write the failing test** — `src/lib/chat-messages.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import {
  dbRowToUIMessage,
  extractQuizFromParts,
  collectToolCallIds,
} from './chat-messages'

const quiz = { title: 'Bio', questions: [] }
const toolPart = {
  type: 'tool-updateQuiz',
  state: 'output-available',
  toolCallId: 'call_1',
  output: { quiz },
}

describe('dbRowToUIMessage', () => {
  it('keeps id/role/parts', () => {
    const row = { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }
    expect(dbRowToUIMessage(row)).toEqual({
      id: 'm1',
      role: 'user',
      parts: [{ type: 'text', text: 'hi' }],
    })
  })
})

describe('extractQuizFromParts', () => {
  it('returns the quiz from a completed updateQuiz part', () => {
    expect(extractQuizFromParts([{ type: 'text', text: 'ok' }, toolPart])).toEqual(quiz)
  })
  it('ignores parts still streaming (no output)', () => {
    expect(
      extractQuizFromParts([{ type: 'tool-updateQuiz', state: 'input-available', toolCallId: 'c' }])
    ).toBeNull()
  })
  it('returns null when no tool part present', () => {
    expect(extractQuizFromParts([{ type: 'text', text: 'hi' }])).toBeNull()
  })
})

describe('collectToolCallIds', () => {
  it('collects ids across messages', () => {
    const msgs = [{ parts: [{ type: 'text', text: 'x' }] }, { parts: [toolPart] }]
    expect(collectToolCallIds(msgs)).toEqual(['call_1'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/chat-messages.test.ts`
Expected: FAIL — `Failed to resolve import "./chat-messages"`.

- [ ] **Step 3: Implement `src/lib/chat-messages.ts`**

```ts
import type { QuizPayload } from '@/lib/quiz-schema'

export type UIMsgLike = { id: string; role: 'user' | 'assistant'; parts: unknown[] }

export function dbRowToUIMessage(row: {
  id: string
  role: string
  parts: unknown[]
}): UIMsgLike {
  return {
    id: row.id,
    role: row.role === 'assistant' ? 'assistant' : 'user',
    parts: row.parts ?? [],
  }
}

export function extractQuizFromParts(parts: unknown[]): QuizPayload | null {
  for (const part of parts ?? []) {
    const p = part as {
      type?: string
      state?: string
      output?: { quiz?: QuizPayload }
    }
    if (p.type === 'tool-updateQuiz' && p.state === 'output-available' && p.output?.quiz) {
      return p.output.quiz
    }
  }
  return null
}

export function collectToolCallIds(messages: { parts: unknown[] }[]): string[] {
  const ids: string[] = []
  for (const msg of messages) {
    for (const part of msg.parts ?? []) {
      const p = part as { type?: string; toolCallId?: string }
      if (p.type === 'tool-updateQuiz' && p.toolCallId) ids.push(p.toolCallId)
    }
  }
  return ids
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/chat-messages.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chat-messages.ts src/lib/chat-messages.test.ts
git commit -m "feat(chat): add db-row<->UIMessage mapping helpers"
```

---

### Task 4: DB query layer + chat route persistence

**Files:**
- Create: `src/db/chat-queries.ts`
- Modify: `src/app/api/chat/route.ts`

**Interfaces:**
- Consumes: `chatMessages`, `quizzes`, `NewChatMessage` from `@/db/schema`; `db` from `@/db`.
- Produces (from `chat-queries.ts`):
  - `loadActivePath(quizId: string, userId: string): Promise<{ messages: ChatMessage[]; activeLeafId: string | null }>` — all messages for quiz (owner-scoped) plus pointer; caller derives path with `buildActivePath`.
  - `persistTurn(args: { quizId: string; userId: string; userMessage: NewChatMessage; assistantMessage: NewChatMessage }): Promise<void>` — inserts both rows (each carries its own `parentId`), sets `quizzes.activeLeafId` to the assistant id, in one transaction.
  - `setActiveLeaf(quizId: string, userId: string, leafId: string): Promise<boolean>` — owner-scoped update; false if not owned.
  - `deleteSubtree(quizId: string, userId: string, messageId: string): Promise<{ ok: boolean; newLeafId: string | null }>`.

- [ ] **Step 1: Implement `src/db/chat-queries.ts`**

```ts
import { db } from '@/db'
import { chatMessages, quizzes, type ChatMessage, type NewChatMessage } from '@/db/schema'
import { and, eq } from 'drizzle-orm'

async function assertOwner(quizId: string, userId: string): Promise<boolean> {
  const [q] = await db
    .select({ id: quizzes.id })
    .from(quizzes)
    .where(and(eq(quizzes.id, quizId), eq(quizzes.userId, userId)))
    .limit(1)
  return !!q
}

export async function loadActivePath(
  quizId: string,
  userId: string
): Promise<{ messages: ChatMessage[]; activeLeafId: string | null }> {
  const [q] = await db
    .select({ id: quizzes.id, activeLeafId: quizzes.activeLeafId })
    .from(quizzes)
    .where(and(eq(quizzes.id, quizId), eq(quizzes.userId, userId)))
    .limit(1)
  if (!q) return { messages: [], activeLeafId: null }
  const messages = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.quizId, quizId))
  return { messages, activeLeafId: q.activeLeafId ?? null }
}

export async function persistTurn(args: {
  quizId: string
  userId: string
  userMessage: NewChatMessage
  assistantMessage: NewChatMessage
}): Promise<void> {
  if (!(await assertOwner(args.quizId, args.userId))) return
  await db.transaction(async (tx) => {
    await tx.insert(chatMessages).values(args.userMessage)
    await tx.insert(chatMessages).values(args.assistantMessage)
    await tx
      .update(quizzes)
      .set({ activeLeafId: args.assistantMessage.id!, updatedAt: new Date() })
      .where(eq(quizzes.id, args.quizId))
  })
}

export async function setActiveLeaf(
  quizId: string,
  userId: string,
  leafId: string
): Promise<boolean> {
  const [leaf] = await db
    .select({ id: chatMessages.id })
    .from(chatMessages)
    .where(and(eq(chatMessages.id, leafId), eq(chatMessages.quizId, quizId)))
    .limit(1)
  if (!leaf) return false
  const res = await db
    .update(quizzes)
    .set({ activeLeafId: leafId, updatedAt: new Date() })
    .where(and(eq(quizzes.id, quizId), eq(quizzes.userId, userId)))
    .returning({ id: quizzes.id })
  return res.length > 0
}

export async function deleteSubtree(
  quizId: string,
  userId: string,
  messageId: string
): Promise<{ ok: boolean; newLeafId: string | null }> {
  if (!(await assertOwner(quizId, userId))) return { ok: false, newLeafId: null }
  const [target] = await db
    .select({ id: chatMessages.id, parentId: chatMessages.parentId })
    .from(chatMessages)
    .where(and(eq(chatMessages.id, messageId), eq(chatMessages.quizId, quizId)))
    .limit(1)
  if (!target) return { ok: false, newLeafId: null }

  const [q] = await db
    .select({ activeLeafId: quizzes.activeLeafId })
    .from(quizzes)
    .where(eq(quizzes.id, quizId))
    .limit(1)

  // ON DELETE CASCADE on parent_id removes the whole subtree.
  await db.delete(chatMessages).where(eq(chatMessages.id, messageId))

  // If the active leaf was inside the deleted subtree it no longer exists;
  // reseat to the deleted node's parent (caller re-descends to a leaf client-side
  // on next load via buildActivePath/descendToLeaf).
  const remaining = await db
    .select({ id: chatMessages.id })
    .from(chatMessages)
    .where(eq(chatMessages.id, q?.activeLeafId ?? ''))
    .limit(1)
  let newLeafId = q?.activeLeafId ?? null
  if (remaining.length === 0) {
    newLeafId = target.parentId
    await db
      .update(quizzes)
      .set({ activeLeafId: newLeafId, updatedAt: new Date() })
      .where(eq(quizzes.id, quizId))
  }
  return { ok: true, newLeafId }
}
```

- [ ] **Step 2: Typecheck the query layer**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Rewrite `src/app/api/chat/route.ts` to persist the turn**

Replace the file with (keeps `BASE_SYSTEM` and the tool unchanged; adds auth, `parentId`, `quizId`, persistence, snapshot):

```ts
import { streamText, tool, convertToModelMessages, type UIMessage } from 'ai'
import { headers } from 'next/headers'
import { openrouter } from '@openrouter/ai-sdk-provider'
import { quizPayloadSchema, type QuizPayload } from '@/lib/quiz-schema'
import { auth } from '@/lib/auth'
import { persistTurn } from '@/db/chat-queries'
import { extractQuizFromParts } from '@/lib/chat-messages'
import type { NewChatMessage } from '@/db/schema'

const BASE_SYSTEM = `You are QuEZ AI, an expert quiz builder assistant. When the user describes a quiz they want, call the updateQuiz tool to output the full structured quiz data.

Always:
- Generate clear, accurate questions appropriate for the target audience
- Provide exactly 4 answer options for multiple_choice, or 2 options (["True", "False"]) for true_false
- Include a brief explanation for each correct answer
- Set appropriate time limits: easy questions 30s, complex ones 45-60s
- Suggest a relevant topic, audience level, and difficulty
- Pick a fitting emoji as the cover
- After calling the tool, briefly confirm what you built and offer to refine it

If the user asks to change something, call updateQuiz again with the updated quiz.`

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return new Response('Unauthorized', { status: 401 })

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

  const modelId = 'deepseek/deepseek-v4-flash'

  const system = existingQuiz
    ? `${BASE_SYSTEM}

The user is refining an existing quiz. Current state:

\`\`\`json
${JSON.stringify(existingQuiz, null, 2)}
\`\`\`

When calling updateQuiz, return the FULL updated quiz including fields the user did not ask to change. Preserve unchanged questions verbatim.`
    : BASE_SYSTEM

  // The last incoming message is the new user turn to persist.
  const incomingUser = messages[messages.length - 1]

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

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    onFinish: async ({ responseMessage }) => {
      // Persist only when we have a quiz to attach the thread to.
      if (!quizId || !incomingUser || incomingUser.role !== 'user') return
      const assistantParts = (responseMessage as unknown as { parts: unknown[] }).parts ?? []
      const snapshot = extractQuizFromParts(assistantParts)
      const userMessage: NewChatMessage = {
        id: incomingUser.id,
        quizId,
        userId: session.user.id,
        role: 'user',
        parts: (incomingUser as unknown as { parts: unknown[] }).parts ?? [],
        parentId: parentId ?? null,
      }
      const assistantMessage: NewChatMessage = {
        id: responseMessage.id,
        quizId,
        userId: session.user.id,
        role: 'assistant',
        parts: assistantParts,
        parentId: incomingUser.id,
        quizSnapshot: snapshot ?? null,
      }
      await persistTurn({ quizId, userId: session.user.id, userMessage, assistantMessage })
    },
    onError: (error) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyErr = error as any
      const parts = [
        anyErr?.name,
        anyErr?.message,
        anyErr?.statusCode && `status=${anyErr.statusCode}`,
        anyErr?.responseBody &&
          `body=${typeof anyErr.responseBody === 'string' ? anyErr.responseBody : JSON.stringify(anyErr.responseBody)}`,
        anyErr?.cause?.message,
      ].filter(Boolean)
      return parts.join(' | ') || String(error)
    },
  })
}
```

> NOTE for implementer: confirm the `onFinish` callback field name against the installed SDK — `grep -nE "responseMessage|UIMessageStreamOnFinishCallback" node_modules/ai/dist/index.d.ts`. v6 passes `{ messages, responseMessage, isContinuation }`. If `responseMessage` is absent, use the last element of the `messages` array instead.

- [ ] **Step 4: Typecheck + lint + build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: clean (no new errors).

- [ ] **Step 5: Dev smoke — persistence happy path**

Run `npm run dev`. Open an existing quiz at `/dashboard/quizzes/<id>`. Send a message in the chat; wait for the reply. In another terminal:

Run: `npm run db:studio` (or a `tsx` one-off select) and confirm two new `chat_messages` rows exist for that quiz, the assistant row has a non-null `quiz_snapshot`, and `quizzes.active_leaf_id` equals the assistant row id.

- [ ] **Step 6: Commit**

```bash
git add src/db/chat-queries.ts src/app/api/chat/route.ts
git commit -m "feat(chat): persist each turn server-side with quiz snapshot"
```

---

### Task 5: Server load + hydrate `useChat`

**Files:**
- Modify: `src/app/dashboard/quizzes/[id]/page.tsx`
- Modify: `src/components/builder/QuizEditor.tsx`
- Modify: `src/components/builder/ChatPanel.tsx`

**Interfaces:**
- Consumes: `loadActivePath` (Task 4), `buildActivePath` (Task 1), `dbRowToUIMessage` (Task 3).
- Produces:
  - `ChatPanel` accepts new props: `initialMessages?: UIMsgLike[]`, `quizId: string`.
  - `QuizEditor` accepts `initialMessages?` and passes them + `initialQuiz.id` to `ChatPanel`.

- [ ] **Step 1: Load + order messages in the page**

In `src/app/dashboard/quizzes/[id]/page.tsx`, after fetching `quizQuestions`, add:

```ts
import { loadActivePath } from '@/db/chat-queries'
import { buildActivePath } from '@/lib/chat-tree'
import { dbRowToUIMessage } from '@/lib/chat-messages'
```

and before the `return`:

```ts
  const { messages: chatRows, activeLeafId } = await loadActivePath(id, session.user.id)
  const pathIds = buildActivePath(
    chatRows.map((m) => ({ id: m.id, parentId: m.parentId, createdAt: m.createdAt })),
    activeLeafId
  )
  const byId = new Map(chatRows.map((m) => [m.id, m]))
  const initialMessages = pathIds
    .map((mid) => byId.get(mid))
    .filter((m): m is (typeof chatRows)[number] => !!m)
    .map((m) => dbRowToUIMessage({ id: m.id, role: m.role, parts: m.parts }))
```

Change the return to:

```tsx
  return (
    <QuizEditor
      initialQuiz={quiz}
      initialQuestions={quizQuestions}
      initialMessages={initialMessages}
    />
  )
```

- [ ] **Step 2: Thread props through `QuizEditor`**

In `src/components/builder/QuizEditor.tsx`, extend the props interface and the `ChatPanel` usage:

```ts
import type { UIMsgLike } from '@/lib/chat-messages'

interface QuizEditorProps {
  initialQuiz: Quiz
  initialQuestions: Question[]
  initialMessages?: UIMsgLike[]
}
```

```tsx
export function QuizEditor({ initialQuiz, initialQuestions, initialMessages }: QuizEditorProps) {
```

```tsx
        <ChatPanel
          onQuizUpdate={handleAgentUpdate}
          initialQuiz={quiz}
          quizId={initialQuiz.id}
          initialMessages={initialMessages}
        />
```

- [ ] **Step 3: Accept + hydrate in `ChatPanel`**

In `src/components/builder/ChatPanel.tsx`, update the props interface and `useChat` call:

```ts
import type { UIMsgLike } from '@/lib/chat-messages'

interface ChatPanelProps {
  onQuizUpdate: (quiz: QuizPayload) => void
  initialQuiz?: QuizPayload
  initialPrompt?: string
  quizId: string
  initialMessages?: UIMsgLike[]
}
```

```ts
export function ChatPanel({
  onQuizUpdate,
  initialQuiz,
  initialPrompt,
  quizId,
  initialMessages,
}: ChatPanelProps) {
```

In the `useChat({ ... })` call, add `id` and `messages`:

```ts
  const { messages, sendMessage, status, error, setMessages, regenerate } = useChat({
    id: quizId,
    messages: (initialMessages ?? []) as unknown as UIMessage[],
    transport,
    onError: (err) => { /* unchanged */ },
    onFinish: ({ message }) => { /* unchanged */ },
  })
```

Add `quizId` and `parentId` to the transport body so the server can persist + attach. Replace the `transport` `useMemo` body callback:

```ts
  const leafIdRef = useRef<string | null>(
    initialMessages && initialMessages.length
      ? initialMessages[initialMessages.length - 1].id
      : null
  )
```

```ts
        body: () => ({
          ...(quizRef.current ? { existingQuiz: quizRef.current } : {}),
          quizId,
          parentId: leafIdRef.current,
        }),
```

(Keep the existing `/* eslint-disable react-hooks/refs */` wrapper. Add `quizId` to the `useMemo` dependency array.)

After each successful turn, advance the leaf ref. Extend the existing `onFinish` in `useChat`:

```ts
    onFinish: ({ message }) => {
      leafIdRef.current = message.id
      console.log('[ChatPanel] onFinish — parts:', (message as unknown as { parts?: unknown[] }).parts?.length)
    },
```

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean.

- [ ] **Step 5: Dev smoke — history survives refresh**

`npm run dev` → open a quiz, send a message, get a reply, **refresh the page**. Expected: the conversation is still there (greeting + your message + assistant reply), in order.

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/quizzes/[id]/page.tsx src/components/builder/QuizEditor.tsx src/components/builder/ChatPanel.tsx
git commit -m "feat(chat): load + hydrate chat history on page load"
```

---

### Task 6: Hydration-fix — don't replay history into the editor

**Files:**
- Modify: `src/components/builder/ChatPanel.tsx`

**Interfaces:**
- Consumes: `collectToolCallIds` (Task 3).

**Problem solved:** `seenToolCallsRef` starts empty each mount, so the existing effect re-forwards every historical `tool-updateQuiz` output into the editor on load — marking the quiz dirty and clobbering the saved quiz. Seed the set with hydrated ids so only **new** outputs forward.

- [ ] **Step 1: Seed `seenToolCallsRef` on mount**

Replace the `seenToolCallsRef` declaration:

```ts
  const seenToolCallsRef = useRef<Set<string>>(
    new Set(collectToolCallIds((initialMessages ?? []) as { parts: unknown[] }[]))
  )
```

Add the import:

```ts
import { collectToolCallIds } from '@/lib/chat-messages'
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Dev smoke — load does not dirty the quiz**

`npm run dev` → open a quiz that already has chat history (from Task 5 smoke). On load, the "Save changes" button must read **"Saved"** (disabled), i.e. `dirty === false`. Sending a NEW message that updates the quiz must still mark it dirty and update the editor.

- [ ] **Step 4: Commit**

```bash
git add src/components/builder/ChatPanel.tsx
git commit -m "fix(chat): seed seen tool-calls so hydration doesn't clobber the quiz"
```

---

### Task 7: Branch switch — endpoint + `‹ n/m ›` UI

**Files:**
- Create: `src/app/api/quizzes/[id]/active-leaf/route.ts`
- Modify: `src/components/builder/ChatPanel.tsx`

**Interfaces:**
- Consumes: `setActiveLeaf` (Task 4); `siblingInfo`, `switchSibling`, `buildActivePath` (Task 1); `byId` map of all loaded nodes.
- Produces: `PATCH /api/quizzes/[id]/active-leaf` body `{ leafId: string }` → `{ ok: true }` / 404.

The switcher needs the **full tree**, not just the active path. Load all nodes once for the panel.

- [ ] **Step 1: Create the endpoint**

`src/app/api/quizzes/[id]/active-leaf/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { setActiveLeaf } from '@/db/chat-queries'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const body = await req.json().catch(() => null)
  if (!body || typeof body.leafId !== 'string') {
    return NextResponse.json({ error: 'leafId required' }, { status: 400 })
  }

  const ok = await setActiveLeaf(id, session.user.id, body.leafId)
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Load the full tree into `ChatPanel`**

The page already loads all rows; pass them too. In `page.tsx`, add to the `QuizEditor` props a serialized full-tree array:

```ts
  const treeNodes = chatRows.map((m) => ({
    id: m.id,
    parentId: m.parentId,
    createdAt: m.createdAt.toISOString(),
  }))
```

Pass `treeNodes={treeNodes}` to `QuizEditor`, thread it to `ChatPanel` as prop `initialTree?: { id: string; parentId: string | null; createdAt: string }[]`. In `ChatPanel`, hold it in state and parse dates:

```ts
  const [tree, setTree] = useState(() =>
    (initialTree ?? []).map((n) => ({ id: n.id, parentId: n.parentId, createdAt: new Date(n.createdAt) }))
  )
```

When a new turn finishes, append its two nodes to `tree` (in the `useChat` `onFinish`, push the assistant; the user node is appended in `submit`). Keep `tree` and `messages` consistent — the active path drawn from `tree` must match `messages`.

> Implementation note: simplest robust approach — after every `sendMessage`/`regenerate`/switch/delete, re-fetch nothing; instead derive `messages` from `tree` + `activeLeafId` using `buildActivePath`. But to stay close to the existing `useChat`-driven render, keep `messages` as the source for rendering and use `tree` ONLY to compute sibling badges and to resolve switch targets. On switch/delete, call `setMessages` with the rebuilt path mapped through `byId`.

- [ ] **Step 3: Render the switcher under messages with siblings**

In the `messages.map(...)`, compute sibling info per message and render controls. Add inside the bubble wrapper (below the bubble):

```tsx
{(() => {
  const info = siblingInfo(tree, msg.id, leafIdRef.current ?? msg.id)
  if (info.count < 2) return null
  return (
    <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
      <button
        aria-label="Previous version"
        className="px-1 disabled:opacity-30"
        disabled={info.index <= 0}
        onClick={() => onSwitch(msg.id, -1)}
      >‹</button>
      <span>{info.index + 1}/{info.count}</span>
      <button
        aria-label="Next version"
        className="px-1 disabled:opacity-30"
        disabled={info.index >= info.count - 1}
        onClick={() => onSwitch(msg.id, 1)}
      >›</button>
    </div>
  )
})()}
```

Add the imports and handler:

```ts
import { siblingInfo, switchSibling, buildActivePath } from '@/lib/chat-tree'
import { dbRowToUIMessage } from '@/lib/chat-messages'
```

```ts
  async function onSwitch(forkChildId: string, dir: -1 | 1) {
    const newLeaf = switchSibling(tree, forkChildId, dir, leafIdRef.current ?? forkChildId)
    if (!newLeaf) return
    const res = await fetch(`/api/quizzes/${quizId}/active-leaf`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leafId: newLeaf }),
    })
    if (!res.ok) return
    leafIdRef.current = newLeaf
    const pathIds = buildActivePath(tree, newLeaf)
    const byId = new Map(rowsRef.current.map((r) => [r.id, r]))
    setMessages(
      pathIds
        .map((id) => byId.get(id))
        .filter(Boolean)
        .map((r) => dbRowToUIMessage(r as { id: string; role: string; parts: unknown[] })) as unknown as UIMessage[]
    )
  }
```

> `rowsRef` holds the full `{ id, role, parts }` rows for path rebuilds. Add a `rowsRef = useRef(initialMessages-equivalent-full-rows)` seeded from a new `initialRows` prop (the page already has `chatRows`; pass `id/role/parts` for each). Append to it on each finished turn alongside `tree`.

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean.

- [ ] **Step 5: Dev smoke — branch switch**

`npm run dev` → open a quiz with history → edit an earlier user message (Task 8 may be needed first; if testing before Task 8, manually create a branch by regenerating once Task 8/3-feature lands). Confirm `‹ 1/2 ›` appears, clicking `‹`/`›` swaps the visible downstream messages, and refresh preserves the selected branch (server `active_leaf_id` updated).

- [ ] **Step 6: Commit**

```bash
git add src/app/api/quizzes/[id]/active-leaf/route.ts src/components/builder/ChatPanel.tsx src/app/dashboard/quizzes/[id]/page.tsx src/components/builder/QuizEditor.tsx
git commit -m "feat(chat): branch switcher with active-leaf endpoint"
```

---

### Task 8: Edit a user message (branch) + regenerate

**Files:**
- Modify: `src/components/builder/ChatPanel.tsx`

**Interfaces:**
- Consumes: `useChat`'s `sendMessage`, `regenerate`, `setMessages`; `leafIdRef`.

Edit re-uses the send path: editing user message `M` means sending a NEW user message whose `parentId` is `M.parentId`. Set `leafIdRef` to `M.parentId` **before** sending so the transport body attaches the new sibling correctly, then `sendMessage`.

- [ ] **Step 1: Add edit state + handlers**

```ts
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')

  function startEdit(msgId: string, current: string) {
    setEditingId(msgId)
    setEditText(current)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditText('')
  }

  function submitEdit(msgId: string) {
    const text = editText.trim()
    if (!text || isLoading) return
    const node = tree.find((n) => n.id === msgId)
    const parentId = node?.parentId ?? null
    // Attach the new user sibling under the edited message's parent.
    leafIdRef.current = parentId
    setEditingId(null)
    setEditText('')
    sendMessage({ role: 'user', parts: [{ type: 'text', text }] })
  }
```

> The server inserts the new user row with `parentId = leafIdRef.current` (the shared parent) → a sibling branch. After `onFinish`, append the new user + assistant nodes to `tree`/`rowsRef` and set `leafIdRef` to the assistant id (already done in the shared `onFinish` + `submit` append logic from Task 7).

- [ ] **Step 2: Render edit affordance for user messages**

In the `messages.map`, for `msg.role === 'user'`, when `editingId === msg.id` render a textarea + Save/Cancel instead of the bubble:

```tsx
{msg.role === 'user' && editingId === msg.id ? (
  <div className="w-[85%] space-y-2">
    <Textarea
      value={editText}
      onChange={(e) => setEditText(e.target.value)}
      className="text-sm"
      rows={3}
    />
    <div className="flex gap-2 justify-end">
      <Button size="sm" variant="ghost" onClick={cancelEdit}>Cancel</Button>
      <Button size="sm" onClick={() => submitEdit(msg.id)} disabled={!editText.trim() || isLoading}>
        Save &amp; rerun
      </Button>
    </div>
  </div>
) : (
  /* existing bubble JSX */
)}
```

- [ ] **Step 3: Add hover actions (Edit + Regenerate)**

Add a small action row revealed on hover. For user bubbles: Edit. For assistant bubbles: Regenerate (calls `regenerate({ messageId: msg.id })` — re-runs that assistant turn; the SDK produces a new assistant message which the server persists as a sibling under the same user parent):

```tsx
<button
  className="opacity-0 group-hover:opacity-100 text-xs text-muted-foreground"
  onClick={() => regenerate({ messageId: msg.id })}
>
  Regenerate
</button>
```

Wrap each message row container with `className="group ..."` so `group-hover` works.

> NOTE: confirm `regenerate`'s argument shape — `grep -nE "regenerate" node_modules/@ai-sdk/react/dist/index.d.ts node_modules/ai/dist/index.d.ts`. If it takes no `messageId`, call `regenerate()` (re-runs the last assistant turn) and only show Regenerate on the final assistant message.

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean.

- [ ] **Step 5: Dev smoke — edit creates a branch**

`npm run dev` → send 2 turns → hover the FIRST user message → Edit → change text → Save & rerun. Expected: a new assistant reply appears; `‹ 1/2 ›` shows on the edited turn; switching back shows the original; refresh preserves the active branch.

- [ ] **Step 6: Commit**

```bash
git add src/components/builder/ChatPanel.tsx
git commit -m "feat(chat): edit user messages as branches + regenerate"
```

---

### Task 9: Delete a message (+ subtree)

**Files:**
- Create: `src/app/api/quizzes/[id]/messages/[mid]/route.ts`
- Modify: `src/components/builder/ChatPanel.tsx`

**Interfaces:**
- Consumes: `deleteSubtree` (Task 4).
- Produces: `DELETE /api/quizzes/[id]/messages/[mid]` → `{ ok: true, newLeafId: string | null }`.

- [ ] **Step 1: Create the endpoint**

`src/app/api/quizzes/[id]/messages/[mid]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { deleteSubtree } from '@/db/chat-queries'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; mid: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, mid } = await params
  if (!UUID_RE.test(id) || !UUID_RE.test(mid)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const res = await deleteSubtree(id, session.user.id, mid)
  if (!res.ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(res)
}
```

- [ ] **Step 2: Add the delete handler + button in `ChatPanel`**

```ts
  async function onDelete(msgId: string) {
    if (isLoading) return
    const res = await fetch(`/api/quizzes/${quizId}/messages/${msgId}`, { method: 'DELETE' })
    if (!res.ok) return
    const { newLeafId }: { newLeafId: string | null } = await res.json()
    // Drop the subtree locally.
    const removed = new Set<string>()
    const collect = (rootId: string) => {
      removed.add(rootId)
      for (const child of tree.filter((n) => n.parentId === rootId)) collect(child.id)
    }
    collect(msgId)
    const nextTree = tree.filter((n) => !removed.has(n.id))
    setTree(nextTree)
    rowsRef.current = rowsRef.current.filter((r) => !removed.has(r.id))
    const leaf = newLeafId ? descendToLeaf(nextTree, newLeafId) : null
    leafIdRef.current = leaf
    const pathIds = buildActivePath(nextTree, leaf)
    const byId = new Map(rowsRef.current.map((r) => [r.id, r]))
    setMessages(
      pathIds.map((id) => dbRowToUIMessage(byId.get(id)!)) as unknown as UIMessage[]
    )
  }
```

Add `descendToLeaf` to the `chat-tree` import. Render a Delete button in the hover actions for both roles:

```tsx
<button
  className="opacity-0 group-hover:opacity-100 text-xs text-destructive"
  onClick={() => onDelete(msg.id)}
>
  Delete
</button>
```

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean.

- [ ] **Step 4: Dev smoke — delete subtree**

`npm run dev` → 3 turns → hover the middle user message → Delete. Expected: that message and everything after it vanish; refresh confirms they're gone server-side; `active_leaf_id` reseated to the parent.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/quizzes/[id]/messages/[mid]/route.ts src/components/builder/ChatPanel.tsx
git commit -m "feat(chat): delete message + subtree"
```

---

### Task 10: Copy, timestamps, retry

**Files:**
- Modify: `src/components/builder/ChatPanel.tsx`

- [ ] **Step 1: Copy button**

Add to hover actions (both roles):

```tsx
<button
  className="opacity-0 group-hover:opacity-100 text-xs text-muted-foreground"
  onClick={() => navigator.clipboard.writeText(getTextFromMessage(msg))}
>
  Copy
</button>
```

- [ ] **Step 2: Timestamp under each bubble**

The hydrated rows carry no createdAt in `UIMessage`; read from `tree`. Below the bubble:

```tsx
{(() => {
  const n = tree.find((x) => x.id === msg.id)
  if (!n) return null
  return (
    <p className="text-[10px] text-muted-foreground mt-0.5">
      {n.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
    </p>
  )
})()}
```

- [ ] **Step 3: Retry on error**

After the messages list, when `status === 'error'`, render a retry affordance:

```tsx
{status === 'error' && (
  <div className="flex justify-start">
    <Button size="sm" variant="outline" onClick={() => regenerate()}>
      Retry
    </Button>
  </div>
)}
```

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean.

- [ ] **Step 5: Dev smoke**

`npm run dev` → hover a message → Copy → paste elsewhere matches text. Timestamps render under hydrated + new messages. To exercise Retry, temporarily set an invalid `modelId` in the route, send a message, confirm the Retry button appears and works after reverting the model id.

- [ ] **Step 6: Commit**

```bash
git add src/components/builder/ChatPanel.tsx
git commit -m "feat(chat): copy, timestamps, retry-on-error"
```

---

### Task 11: Quiz version badge + restore

**Files:**
- Modify: `src/components/builder/ChatPanel.tsx`

**Interfaces:**
- Consumes: existing `onQuizUpdate` prop (sets editor quiz + dirty); the `quizSnapshot` on assistant rows (already loaded into `rowsRef`).

Restore writes a snapshot into the editor via `onQuizUpdate`. The version number = 1-based index of this assistant row among snapshot-bearing rows on the active path.

- [ ] **Step 1: Compute snapshot map + version numbers**

The page must include `quizSnapshot` in the rows passed down. Extend `initialRows`/`rowsRef` rows to `{ id, role, parts, quizSnapshot }`. In `page.tsx` rows mapping include `quizSnapshot: m.quizSnapshot`.

In `ChatPanel`, derive version numbers for assistant messages that have a snapshot:

```ts
  const versionByMsgId = useMemo(() => {
    const map = new Map<string, number>()
    let v = 0
    for (const msg of messages) {
      const row = rowsRef.current.find((r) => r.id === msg.id)
      if (msg.role === 'assistant' && row?.quizSnapshot) {
        v += 1
        map.set(msg.id, v)
      }
    }
    return map
  }, [messages])
```

- [ ] **Step 2: Render badge + Restore for snapshot-bearing assistant messages**

Below such bubbles:

```tsx
{versionByMsgId.has(msg.id) && (
  <div className="flex items-center gap-2 mt-1">
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
      v{versionByMsgId.get(msg.id)}
    </span>
    <button
      className="text-xs text-accent-lime"
      onClick={() => {
        const row = rowsRef.current.find((r) => r.id === msg.id)
        if (row?.quizSnapshot) onQuizUpdate(row.quizSnapshot as QuizPayload)
      }}
    >
      Restore this version
    </button>
  </div>
)}
```

> `onQuizUpdate` already marks the editor dirty (`handleAgentUpdate` → `setDirty(true)`), so the user must click "Save changes" to persist a restore. This is intentional — restore is a proposed change, not an auto-commit, protecting any in-progress manual edits.

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean.

- [ ] **Step 4: Dev smoke — restore**

`npm run dev` → build a quiz over 2 AI turns (v1, v2) → manually tweak a question in the editor → click **Restore this version** on v1. Expected: editor reverts to the v1 quiz, "Save changes" becomes enabled (dirty); clicking Save persists it. Switching chat branches alone never changes the editor.

- [ ] **Step 5: Commit**

```bash
git add src/components/builder/ChatPanel.tsx src/app/dashboard/quizzes/[id]/page.tsx
git commit -m "feat(chat): quiz version badge + restore"
```

---

## Final verification

- [ ] Run full unit suite: `npm run test` → all green.
- [ ] `npx tsc --noEmit && npm run lint && npm run build` → clean.
- [ ] End-to-end smoke: send → refresh (history persists) → edit (branch) → switch ‹ › → regenerate → delete subtree → copy → restore version → Save changes. All behave per the spec.

## Self-review notes (author)

- **Spec coverage:** persistence (T4–5), load/hydrate (T5), branching edit C (T8), current-quiz base A (T4 `existingQuiz` unchanged), auto-save (T4 `onFinish`), tree model A (T1–2), delete+subtree (T9), regenerate (T8), copy/timestamps/retry (T10), Tier-1 versioning snapshot+restore (T4 snapshot, T11 restore), hydration-fix (T6), ownership/auth on every route (T4,7,9). All mapped.
- **SDK uncertainty flagged, not hidden:** `onFinish` `responseMessage` field and `regenerate({ messageId })` arg shape each carry an explicit `grep` verification note for the implementer, because the installed `ai` v6 / `@ai-sdk/react` v3 surface must be confirmed against the source, not assumed.
- **Known coupling:** Tasks 7–11 all edit `ChatPanel.tsx` and share `tree` / `rowsRef` / `leafIdRef` state introduced in Task 7; Task 7 must land before 8–11. This is the one file the spec said may grow unwieldy — if it crosses ~400 lines, extract the message-actions + tree-state into a `useChatThread(quizId, initial…)` hook during Task 7.
```
