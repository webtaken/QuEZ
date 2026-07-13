# Kahoot-style Live Play Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A teacher hosts a quiz live — students join a waiting room via a 6-digit code or URL, the teacher pushes everyone through timed questions in lockstep, answers are scored with a speed+streak formula, and the game ends on an animated podium.

**Architecture:** Three new Postgres tables (`game_sessions`, `game_participants`, `game_answers`) behind a thin API (`/api/games/...`) that delegates to `src/db/game-queries.ts` / `src/db/game-mutations.ts`. No websockets — the browser polls `GET /api/games/[code]/state` every ~1.5s; that same endpoint lazily flips `question → reveal` server-side once the timer elapses or everyone has answered (no cron needed on serverless). Host (`/host/[code]`) and student (`/join`, `/game/[code]`) each get their own client view tree driven by the same polled state shape.

**Tech Stack:** Next.js 16 (app router), Drizzle ORM + Postgres, zod v4, vitest, Tailwind v4, base-ui Button/Badge, lucide-react icons.

**Spec:** `docs/superpowers/specs/2026-07-12-kahoot-live-mode-design.md`

## Global Constraints

- **Custom Next.js build:** APIs may differ from training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing Next-specific code (per `AGENTS.md`). Follow existing code patterns exactly.
- Package manager is `pnpm`. Tests: `pnpm test` (vitest, node environment, only `src/**/*.test.ts` files run).
- `pnpm db:push` applies schema changes directly (no migration files are committed — `drizzle.config.ts` points `out` at an untracked `./drizzle` dir). Requires the local Postgres from `.env` to be running; if it can't connect, stop and ask the user to start the database.
- **DB-layer testing convention (existing, not new):** files under `src/db/*-queries.ts` / `*-mutations.ts` are NOT unit-tested directly anywhere in this codebase (no test DB in CI) — see `src/db/quiz-mutations.ts`, `src/db/attachment-queries.ts`, none of which have a `.test.ts`. Route handlers that call them ARE tested, with the module mocked (see `src/app/api/quizzes/[id]/route.test.ts`, `src/app/api/credits/route.test.ts`). This plan follows that convention: `game-queries.ts`/`game-mutations.ts` ship without dedicated tests; route tests mock them. Pure logic with no DB dependency (`game-scoring.ts`, `game-code.ts`) gets real unit tests.
- Buttons rendered as links use base-ui pattern: `<Button nativeButton={false} render={<Link href=... />}>`.
- zod is v4 (`import { z } from 'zod'`).
- Never hardcode a color — use theme tokens (`bg-accent-lime`, `text-destructive`, `bg-success/20`, etc.) per `DESIGN.md`. Headings use `font-[family-name:var(--font-syne)]`.
- `newId()` / `isUuid()` from `src/lib/ids.ts` are the existing id-generation/validation helpers — reuse them, don't add a second UUID regex.
- Commit messages: conventional commits (`feat:`, `test:`, `docs:`) matching repo history.

---

### Task 1: Schema — `game_sessions`, `game_participants`, `game_answers`

**Files:**
- Modify: `src/db/schema.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (used by every later task): `gameSessions`, `gameParticipants`, `gameAnswers` tables and `GameSession`, `GameParticipant`, `GameAnswer`, `NewGameSession`, `NewGameParticipant`, `NewGameAnswer` types. `gameSessions.status` is one of `'waiting' | 'question' | 'reveal' | 'podium'` (application-level union, stored as `text`).

- [x] **Step 1: Add `uniqueIndex` to the drizzle import**

In `src/db/schema.ts`, line 1-12, add `uniqueIndex` to the import list:

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
  uniqueIndex,
  numeric,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
```

- [x] **Step 2: Add the three tables**

In `src/db/schema.ts`, after the `creditTransactions` table's closing `)` (currently ends at line 173, right before `export type User = ...`), insert:

```ts
export const gameSessions = pgTable(
  'game_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    quizId: uuid('quiz_id')
      .notNull()
      .references(() => quizzes.id, { onDelete: 'cascade' }),
    hostUserId: text('host_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    code: text('code').notNull(), // 6-digit numeric string, e.g. "854123" — not DB-unique, see game-code.ts
    status: text('status').notNull().default('waiting'), // waiting|question|reveal|podium
    currentQuestionIndex: integer('current_question_index').notNull().default(0),
    phaseStartedAt: timestamp('phase_started_at').defaultNow().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    endedAt: timestamp('ended_at'),
  },
  (t) => [index('game_sessions_code_idx').on(t.code)]
)

export const gameParticipants = pgTable(
  'game_participants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gameId: uuid('game_id')
      .notNull()
      .references(() => gameSessions.id, { onDelete: 'cascade' }),
    sessionToken: text('session_token').notNull(), // client-generated, persisted in localStorage for rejoin
    nickname: text('nickname').notNull(),
    score: integer('score').notNull().default(0),
    streak: integer('streak').notNull().default(0),
    totalAnswerMs: integer('total_answer_ms').notNull().default(0), // tie-break: lower is faster overall
    kickedAt: timestamp('kicked_at'),
    joinedAt: timestamp('joined_at').defaultNow().notNull(),
  },
  (t) => [
    index('game_participants_game_id_idx').on(t.gameId),
    index('game_participants_session_token_idx').on(t.sessionToken),
  ]
)

export const gameAnswers = pgTable(
  'game_answers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gameId: uuid('game_id')
      .notNull()
      .references(() => gameSessions.id, { onDelete: 'cascade' }),
    participantId: uuid('participant_id')
      .notNull()
      .references(() => gameParticipants.id, { onDelete: 'cascade' }),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    selectedIndex: integer('selected_index'), // null = no answer / timed out
    answerMs: integer('answer_ms').notNull(),
    isCorrect: boolean('is_correct').notNull(),
    pointsAwarded: integer('points_awarded').notNull().default(0),
    answeredAt: timestamp('answered_at').defaultNow().notNull(),
  },
  (t) => [
    index('game_answers_game_question_idx').on(t.gameId, t.questionId),
    uniqueIndex('game_answers_participant_question_idx').on(t.participantId, t.questionId),
  ]
)
```

- [x] **Step 3: Add type exports**

In `src/db/schema.ts`, in the type-export block at the bottom (currently lines 175-185), add after the existing `CreditTransaction`/`NewCreditTransaction` lines:

```ts
export type GameSession = typeof gameSessions.$inferSelect
export type GameParticipant = typeof gameParticipants.$inferSelect
export type GameAnswer = typeof gameAnswers.$inferSelect
export type NewGameSession = typeof gameSessions.$inferInsert
export type NewGameParticipant = typeof gameParticipants.$inferInsert
export type NewGameAnswer = typeof gameAnswers.$inferInsert
```

- [x] **Step 4: Push the schema**

Run: `pnpm db:push`
Expected: drizzle reports 3 new tables created. If it cannot connect to Postgres, stop and ask the user to start the local database.

- [x] **Step 5: Verify types compile**

Run: `npx tsc --noEmit`
Expected: clean (no errors referencing `schema.ts`).

- [x] **Step 6: Commit**

```bash
git add src/db/schema.ts
git commit -m "feat(live): add game_sessions, game_participants, game_answers tables"
```

---

### Task 2: Scoring formula — `src/lib/game-scoring.ts`

**Files:**
- Create: `src/lib/game-scoring.ts`
- Test: `src/lib/game-scoring.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (used by Tasks 4, 7, 9):
  - `computePoints(timeLimitMs: number, answerMs: number, isCorrect: boolean, priorStreak: number): number`
  - `rankParticipants<T extends { score: number; totalAnswerMs: number }>(participants: T[]): (T & { rank: number })[]`

- [x] **Step 1: Write the failing test**

Create `src/lib/game-scoring.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { computePoints, rankParticipants } from './game-scoring'

describe('computePoints', () => {
  it('awards full points for an instant correct answer, no streak', () => {
    expect(computePoints(30000, 0, true, 0)).toBe(1000)
  })

  it('awards half points for a correct answer at the very last instant', () => {
    expect(computePoints(30000, 30000, true, 0)).toBe(500)
  })

  it('scales linearly between instant and last-instant', () => {
    // half the time elapsed -> 3/4 of max points
    expect(computePoints(20000, 10000, true, 0)).toBe(750)
  })

  it('awards 0 for a wrong answer regardless of speed or streak', () => {
    expect(computePoints(30000, 0, false, 5)).toBe(0)
  })

  it('awards 0 for a timed-out (no) answer', () => {
    expect(computePoints(30000, 30000, false, 3)).toBe(0)
  })

  it('applies a 10%-per-streak bonus on top of base points', () => {
    expect(computePoints(30000, 0, true, 3)).toBe(1300)
  })

  it('caps the streak bonus at a 5-streak (+50%)', () => {
    expect(computePoints(30000, 0, true, 5)).toBe(1500)
    expect(computePoints(30000, 0, true, 10)).toBe(1500)
  })
})

describe('rankParticipants', () => {
  it('sorts by score descending', () => {
    const result = rankParticipants([
      { id: 'a', score: 100, totalAnswerMs: 5000 },
      { id: 'b', score: 300, totalAnswerMs: 5000 },
      { id: 'c', score: 200, totalAnswerMs: 5000 },
    ])
    expect(result.map((p) => p.id)).toEqual(['b', 'c', 'a'])
    expect(result.map((p) => p.rank)).toEqual([1, 2, 3])
  })

  it('breaks a score tie by lower totalAnswerMs (faster overall)', () => {
    const result = rankParticipants([
      { id: 'slow', score: 100, totalAnswerMs: 9000 },
      { id: 'fast', score: 100, totalAnswerMs: 3000 },
    ])
    expect(result.map((p) => p.id)).toEqual(['fast', 'slow'])
  })

  it('does not mutate the input array', () => {
    const input = [
      { id: 'a', score: 1, totalAnswerMs: 1 },
      { id: 'b', score: 2, totalAnswerMs: 1 },
    ]
    const copy = [...input]
    rankParticipants(input)
    expect(input).toEqual(copy)
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/game-scoring.test.ts`
Expected: FAIL — cannot resolve `./game-scoring`.

- [x] **Step 3: Write the implementation**

Create `src/lib/game-scoring.ts`:

```ts
const MAX_POINTS = 1000
const MAX_STREAK_FOR_BONUS = 5
const STREAK_BONUS_PER_LEVEL = 0.1

// Correct + instant answer scores MAX_POINTS; correct at the very last
// instant scores half that. Wrong or missing answers score 0. A streak of
// N consecutive correct answers (capped at MAX_STREAK_FOR_BONUS) adds
// STREAK_BONUS_PER_LEVEL per level on top, e.g. a 5-streak = +50%.
export function computePoints(
  timeLimitMs: number,
  answerMs: number,
  isCorrect: boolean,
  priorStreak: number
): number {
  if (!isCorrect) return 0
  const remainingMs = Math.max(0, timeLimitMs - answerMs)
  const basePoints = MAX_POINTS * (0.5 + 0.5 * (remainingMs / timeLimitMs))
  const streakBonus = 1 + Math.min(priorStreak, MAX_STREAK_FOR_BONUS) * STREAK_BONUS_PER_LEVEL
  return Math.round(basePoints * streakBonus)
}

// Leaderboard order: highest score first; a tie is broken by whoever was
// faster across the whole game (lower cumulative totalAnswerMs).
export function rankParticipants<T extends { score: number; totalAnswerMs: number }>(
  participants: T[]
): (T & { rank: number })[] {
  return [...participants]
    .sort((a, b) => b.score - a.score || a.totalAnswerMs - b.totalAnswerMs)
    .map((p, i) => ({ ...p, rank: i + 1 }))
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/game-scoring.test.ts`
Expected: PASS (10 tests).

- [x] **Step 5: Commit**

```bash
git add src/lib/game-scoring.ts src/lib/game-scoring.test.ts
git commit -m "feat(live): speed+streak scoring formula and leaderboard ranking"
```

---

### Task 3: Room code generation — `src/lib/game-code.ts`

**Files:**
- Create: `src/lib/game-code.ts`
- Test: `src/lib/game-code.test.ts`

**Interfaces:**
- Consumes: nothing (the DB-existence check is injected as a callback, keeping this module pure and DB-free).
- Produces (used by Task 4): `generateUniqueGameCode(codeExists: (code: string) => Promise<boolean>, maxAttempts?: number): Promise<string>`

- [x] **Step 1: Write the failing test**

Create `src/lib/game-code.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { generateUniqueGameCode } from './game-code'

describe('generateUniqueGameCode', () => {
  it('returns a 6-digit numeric string', async () => {
    const codeExists = vi.fn().mockResolvedValue(false)
    const code = await generateUniqueGameCode(codeExists)
    expect(code).toMatch(/^\d{6}$/)
  })

  it('retries on collision until it finds a free code', async () => {
    const codeExists = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const code = await generateUniqueGameCode(codeExists)
    expect(code).toMatch(/^\d{6}$/)
    expect(codeExists).toHaveBeenCalledTimes(2)
  })

  it('throws after exhausting maxAttempts', async () => {
    const codeExists = vi.fn().mockResolvedValue(true)
    await expect(generateUniqueGameCode(codeExists, 3)).rejects.toThrow(
      'Could not generate a unique game code'
    )
    expect(codeExists).toHaveBeenCalledTimes(3)
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/game-code.test.ts`
Expected: FAIL — cannot resolve `./game-code`.

- [x] **Step 3: Write the implementation**

Create `src/lib/game-code.ts`:

```ts
function randomSixDigitCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

// Room codes are not DB-unique (a finished game's code can be recycled), so
// uniqueness is checked against currently-active games via the injected
// codeExists callback rather than a DB constraint. Collisions are rare
// (1-in-900000) but retried a few times just in case.
export async function generateUniqueGameCode(
  codeExists: (code: string) => Promise<boolean>,
  maxAttempts = 10
): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const code = randomSixDigitCode()
    if (!(await codeExists(code))) return code
  }
  throw new Error('Could not generate a unique game code')
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/game-code.test.ts`
Expected: PASS (3 tests).

- [x] **Step 5: Commit**

```bash
git add src/lib/game-code.ts src/lib/game-code.test.ts
git commit -m "feat(live): unique 6-digit room code generator"
```

---

### Task 4: DB layer — `src/db/game-queries.ts` + `src/db/game-mutations.ts`

**Files:**
- Create: `src/db/game-queries.ts`
- Create: `src/db/game-mutations.ts`

**Interfaces:**
- Consumes: `gameSessions`, `gameParticipants`, `gameAnswers`, `questions` from `src/db/schema.ts` (Task 1); `generateUniqueGameCode` from `src/lib/game-code.ts` (Task 3); `computePoints` from `src/lib/game-scoring.ts` (Task 2).
- Produces (used by Tasks 5-11's routes):
  - Queries: `getGameByCode(code: string): Promise<GameSession | null>`, `hasActiveGameWithCode(code: string): Promise<boolean>`, `getQuestionsForQuiz(quizId: string): Promise<Question[]>`, `getParticipantsWithAnswerStatus(gameId: string, questionId: string | null): Promise<{ id, nickname, score, streak, totalAnswerMs, kickedAt: Date | null, answered: boolean }[]>`
  - Mutations: `createGameSession(quizId: string, hostUserId: string): Promise<{ ok: true; game: GameSession } | { ok: false; error: string; status: number }>` (bundles the quiz-ownership + has-questions checks, same shape as `deleteQuiz` in `src/db/quiz-mutations.ts`), `joinGame(game: GameSession, nickname: string, sessionToken: string): Promise<JoinResult>`, `startGame(gameId: string): Promise<{ ok: true } | { ok: false; error: string; status: number }>`, `submitAnswer(game: GameSession, question: { id: string; correctIndex: number; timeLimit: number }, participantId: string, selectedIndex: number | null): Promise<{ ok: true } | { ok: false; error: string; status: number }>`, `maybeAdvancePhase(game: GameSession, currentQuestion: { id: string; timeLimit: number } | undefined): Promise<GameSession>`, `advanceGame(game: GameSession, totalQuestions: number): Promise<{ ok: true; game: GameSession } | { ok: false; error: string; status: number }>`, `kickParticipant(gameId: string, participantId: string): Promise<boolean>`

No dedicated test file for this task — see "DB-layer testing convention" in Global Constraints above. Correctness of this layer is exercised indirectly by the mocked route tests in Tasks 5-11.

- [x] **Step 1: Create the queries module**

Create `src/db/game-queries.ts`:

```ts
import { db } from '@/db'
import { gameSessions, gameParticipants, gameAnswers, questions } from '@/db/schema'
import { and, asc, desc, eq, ne } from 'drizzle-orm'

// The newest row for a code is always the current one — codes are recycled
// once a game reaches 'podium', so an old finished game and a new one can
// briefly share a code.
export async function getGameByCode(code: string) {
  const [game] = await db
    .select()
    .from(gameSessions)
    .where(eq(gameSessions.code, code))
    .orderBy(desc(gameSessions.createdAt))
    .limit(1)
  return game ?? null
}

export async function hasActiveGameWithCode(code: string): Promise<boolean> {
  const [existing] = await db
    .select({ id: gameSessions.id })
    .from(gameSessions)
    .where(and(eq(gameSessions.code, code), ne(gameSessions.status, 'podium')))
    .limit(1)
  return !!existing
}

export async function getQuestionsForQuiz(quizId: string) {
  return db.select().from(questions).where(eq(questions.quizId, quizId)).orderBy(asc(questions.order))
}

export async function getParticipantsWithAnswerStatus(gameId: string, questionId: string | null) {
  const participants = await db
    .select()
    .from(gameParticipants)
    .where(eq(gameParticipants.gameId, gameId))
    .orderBy(asc(gameParticipants.joinedAt))

  let answeredIds = new Set<string>()
  if (questionId) {
    const answers = await db
      .select({ participantId: gameAnswers.participantId })
      .from(gameAnswers)
      .where(and(eq(gameAnswers.gameId, gameId), eq(gameAnswers.questionId, questionId)))
    answeredIds = new Set(answers.map((a) => a.participantId))
  }

  return participants.map((p) => ({
    id: p.id,
    nickname: p.nickname,
    score: p.score,
    streak: p.streak,
    totalAnswerMs: p.totalAnswerMs,
    kickedAt: p.kickedAt,
    answered: answeredIds.has(p.id),
  }))
}
```

- [x] **Step 2: Create the mutations module**

Create `src/db/game-mutations.ts`:

```ts
import { db } from '@/db'
import { gameSessions, gameParticipants, gameAnswers, quizzes, type GameSession } from '@/db/schema'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { generateUniqueGameCode } from '@/lib/game-code'
import { computePoints } from '@/lib/game-scoring'
import { hasActiveGameWithCode, getQuestionsForQuiz } from '@/db/game-queries'

type CreateGameResult = { ok: true; game: GameSession } | { ok: false; error: string; status: number }

export async function createGameSession(quizId: string, hostUserId: string): Promise<CreateGameResult> {
  const [quiz] = await db
    .select({ id: quizzes.id })
    .from(quizzes)
    .where(and(eq(quizzes.id, quizId), eq(quizzes.userId, hostUserId)))
    .limit(1)
  if (!quiz) return { ok: false, error: 'Quiz not found', status: 404 }

  const quizQuestions = await getQuestionsForQuiz(quizId)
  if (quizQuestions.length === 0) {
    return { ok: false, error: 'Quiz has no questions', status: 400 }
  }

  const code = await generateUniqueGameCode(hasActiveGameWithCode)
  const [created] = await db.insert(gameSessions).values({ quizId, hostUserId, code }).returning()
  return { ok: true, game: created }
}

type JoinResult =
  | { ok: true; participant: typeof gameParticipants.$inferSelect }
  | { ok: false; error: string; status: number }

// sessionToken is generated client-side BEFORE the join request, so a retried
// request (e.g. after a dropped response) is idempotent: the second call
// finds the same sessionToken and returns the existing participant instead
// of erroring on a duplicate nickname.
export async function joinGame(game: GameSession, nickname: string, sessionToken: string): Promise<JoinResult> {
  const [existing] = await db
    .select()
    .from(gameParticipants)
    .where(and(eq(gameParticipants.gameId, game.id), eq(gameParticipants.sessionToken, sessionToken)))
    .limit(1)
  if (existing) {
    if (existing.kickedAt) return { ok: false, error: 'You were removed from this game', status: 403 }
    return { ok: true, participant: existing }
  }

  if (game.status !== 'waiting') {
    return { ok: false, error: 'This game has already started', status: 403 }
  }

  const trimmed = nickname.trim()
  const active = await db
    .select({ nickname: gameParticipants.nickname })
    .from(gameParticipants)
    .where(and(eq(gameParticipants.gameId, game.id), isNull(gameParticipants.kickedAt)))
  if (active.some((p) => p.nickname.toLowerCase() === trimmed.toLowerCase())) {
    return { ok: false, error: 'That nickname is already taken in this game', status: 409 }
  }

  const [created] = await db
    .insert(gameParticipants)
    .values({ gameId: game.id, nickname: trimmed, sessionToken })
    .returning()
  return { ok: true, participant: created }
}

export async function startGame(gameId: string): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const active = await db
    .select({ id: gameParticipants.id })
    .from(gameParticipants)
    .where(and(eq(gameParticipants.gameId, gameId), isNull(gameParticipants.kickedAt)))
  if (active.length === 0) {
    return { ok: false, error: 'No players have joined yet', status: 400 }
  }

  const [updated] = await db
    .update(gameSessions)
    .set({ status: 'question', currentQuestionIndex: 0, phaseStartedAt: new Date() })
    .where(and(eq(gameSessions.id, gameId), eq(gameSessions.status, 'waiting')))
    .returning({ id: gameSessions.id })
  if (!updated) return { ok: false, error: 'Game has already started', status: 409 }
  return { ok: true }
}

export async function kickParticipant(gameId: string, participantId: string): Promise<boolean> {
  const [updated] = await db
    .update(gameParticipants)
    .set({ kickedAt: new Date() })
    .where(and(eq(gameParticipants.id, participantId), eq(gameParticipants.gameId, gameId)))
    .returning({ id: gameParticipants.id })
  return !!updated
}

type AnswerResult = { ok: true } | { ok: false; error: string; status: number }

export async function submitAnswer(
  game: GameSession,
  question: { id: string; correctIndex: number; timeLimit: number },
  participantId: string,
  selectedIndex: number | null
): Promise<AnswerResult> {
  const [participant] = await db
    .select()
    .from(gameParticipants)
    .where(
      and(
        eq(gameParticipants.id, participantId),
        eq(gameParticipants.gameId, game.id),
        isNull(gameParticipants.kickedAt)
      )
    )
    .limit(1)
  if (!participant) return { ok: false, error: 'Participant not found', status: 404 }

  const timeLimitMs = question.timeLimit * 1000
  const rawMs = Date.now() - game.phaseStartedAt.getTime()
  const answerMs = Math.max(0, Math.min(rawMs, timeLimitMs))
  const isCorrect = selectedIndex !== null && selectedIndex === question.correctIndex
  const pointsAwarded = computePoints(timeLimitMs, answerMs, isCorrect, participant.streak)

  const [inserted] = await db
    .insert(gameAnswers)
    .values({
      gameId: game.id,
      participantId,
      questionId: question.id,
      selectedIndex,
      answerMs,
      isCorrect,
      pointsAwarded,
    })
    .onConflictDoNothing({ target: [gameAnswers.participantId, gameAnswers.questionId] })
    .returning({ id: gameAnswers.id })

  // A duplicate submit (double-tap, client retry) is a no-op — the first
  // submission already scored and updated the participant.
  if (!inserted) return { ok: true }

  await db
    .update(gameParticipants)
    .set({
      score: sql`${gameParticipants.score} + ${pointsAwarded}`,
      streak: isCorrect ? participant.streak + 1 : 0,
      totalAnswerMs: sql`${gameParticipants.totalAnswerMs} + ${answerMs}`,
    })
    .where(eq(gameParticipants.id, participantId))

  return { ok: true }
}

// The core state-machine step: called on every poll of GET /state. If the
// question phase's timer has elapsed, or every active participant has
// answered, it backfills a 0-point "no answer" for anyone who didn't answer
// (keeping streak/tie-break consistent) and flips the game to 'reveal'. The
// `WHERE status='question'` guard on the final UPDATE makes this race-safe:
// if two pollers both pass the elapsed/all-answered check at once, only one
// UPDATE actually applies — the loser just returns the (soon-stale) game it
// was given, and picks up 'reveal' on its next poll ~1.5s later.
export async function maybeAdvancePhase(
  game: GameSession,
  currentQuestion: { id: string; timeLimit: number } | undefined
): Promise<GameSession> {
  if (game.status !== 'question' || !currentQuestion) return game

  const elapsedMs = Date.now() - game.phaseStartedAt.getTime()
  const timeLimitMs = currentQuestion.timeLimit * 1000

  const active = await db
    .select({ id: gameParticipants.id })
    .from(gameParticipants)
    .where(and(eq(gameParticipants.gameId, game.id), isNull(gameParticipants.kickedAt)))

  const answered = await db
    .select({ participantId: gameAnswers.participantId })
    .from(gameAnswers)
    .where(and(eq(gameAnswers.gameId, game.id), eq(gameAnswers.questionId, currentQuestion.id)))
  const answeredIds = new Set(answered.map((a) => a.participantId))

  const allAnswered = active.length > 0 && active.every((p) => answeredIds.has(p.id))
  if (elapsedMs < timeLimitMs && !allAnswered) return game

  const missing = active.filter((p) => !answeredIds.has(p.id))
  if (missing.length > 0) {
    await db
      .insert(gameAnswers)
      .values(
        missing.map((p) => ({
          gameId: game.id,
          participantId: p.id,
          questionId: currentQuestion.id,
          selectedIndex: null,
          answerMs: timeLimitMs,
          isCorrect: false,
          pointsAwarded: 0,
        }))
      )
      .onConflictDoNothing({ target: [gameAnswers.participantId, gameAnswers.questionId] })

    await db
      .update(gameParticipants)
      .set({ streak: 0, totalAnswerMs: sql`${gameParticipants.totalAnswerMs} + ${timeLimitMs}` })
      .where(
        inArray(
          gameParticipants.id,
          missing.map((p) => p.id)
        )
      )
  }

  const [updated] = await db
    .update(gameSessions)
    .set({ status: 'reveal', phaseStartedAt: new Date() })
    .where(and(eq(gameSessions.id, game.id), eq(gameSessions.status, 'question')))
    .returning()
  return updated ?? game
}

export async function advanceGame(
  game: GameSession,
  totalQuestions: number
): Promise<{ ok: true; game: GameSession } | { ok: false; error: string; status: number }> {
  if (game.status !== 'reveal') {
    return { ok: false, error: 'Game is not in the reveal phase', status: 409 }
  }
  const isLast = game.currentQuestionIndex + 1 >= totalQuestions
  const [updated] = await db
    .update(gameSessions)
    .set(
      isLast
        ? { status: 'podium', endedAt: new Date() }
        : { status: 'question', currentQuestionIndex: game.currentQuestionIndex + 1, phaseStartedAt: new Date() }
    )
    .where(and(eq(gameSessions.id, game.id), eq(gameSessions.status, 'reveal')))
    .returning()
  if (!updated) return { ok: false, error: 'Game is not in the reveal phase', status: 409 }
  return { ok: true, game: updated }
}
```

- [x] **Step 3: Verify types**

Run: `npx tsc --noEmit`
Expected: clean. (`onConflictDoNothing({ target: [...] })` type-checks because the unique index in Task 1 covers exactly `[gameAnswers.participantId, gameAnswers.questionId]`.)

- [x] **Step 4: Lint**

Run: `pnpm lint`
Expected: clean.

- [x] **Step 5: Commit**

```bash
git add src/db/game-queries.ts src/db/game-mutations.ts
git commit -m "feat(live): game state-machine DB layer (queries + mutations)"
```

---

### Task 5: `POST /api/games` — create a live game session

**Files:**
- Create: `src/app/api/games/route.ts`
- Test: `src/app/api/games/route.test.ts`

**Interfaces:**
- Consumes: `createGameSession` from `src/db/game-mutations.ts` (Task 4); `isUuid` from `src/lib/ids.ts`.
- Produces (used by Task 13's `HostLiveButton`): `POST /api/games` — body `{ quizId: string }`, auth required, returns `{ gameId, code }` (200) or `{ error }` (401/400/404).

- [x] **Step 1: Write the failing test**

Create `src/app/api/games/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}))

const getSession = vi.fn()
vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: () => getSession() } },
}))

const createGameSession = vi.fn()
vi.mock('@/db/game-mutations', () => ({
  createGameSession: (...args: unknown[]) => createGameSession(...args),
}))

process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test'

const { POST } = await import('./route')

const VALID_QUIZ_ID = '3549497d-eda3-4e66-8461-7ef45416d8e0'
function req(body: unknown) {
  return { json: async () => body } as Parameters<typeof POST>[0]
}

beforeEach(() => {
  getSession.mockReset()
  createGameSession.mockReset()
})

describe('POST /api/games', () => {
  it('returns 401 when there is no session', async () => {
    getSession.mockResolvedValue(null)
    const res = await POST(req({ quizId: VALID_QUIZ_ID }))
    expect(res.status).toBe(401)
  })

  it('returns 400 for a malformed quizId', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } })
    const res = await POST(req({ quizId: 'not-a-uuid' }))
    expect(res.status).toBe(400)
    expect(createGameSession).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid JSON', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } })
    const badReq = {
      json: async () => {
        throw new Error('bad json')
      },
    } as Parameters<typeof POST>[0]
    const res = await POST(badReq)
    expect(res.status).toBe(400)
  })

  it('propagates the error + status from createGameSession', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } })
    createGameSession.mockResolvedValue({ ok: false, error: 'Quiz has no questions', status: 400 })
    const res = await POST(req({ quizId: VALID_QUIZ_ID }))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'Quiz has no questions' })
  })

  it('creates a game session and returns its id + code', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } })
    createGameSession.mockResolvedValue({ ok: true, game: { id: 'g1', code: '854123' } })
    const res = await POST(req({ quizId: VALID_QUIZ_ID }))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ gameId: 'g1', code: '854123' })
    expect(createGameSession).toHaveBeenCalledWith(VALID_QUIZ_ID, 'u1')
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm test src/app/api/games/route.test.ts`
Expected: FAIL — cannot resolve `./route`.

- [x] **Step 3: Write the implementation**

Create `src/app/api/games/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { isUuid } from '@/lib/ids'
import { createGameSession } from '@/db/game-mutations'

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body || !isUuid(body.quizId)) {
    return NextResponse.json({ error: 'quizId must be a valid id' }, { status: 400 })
  }

  const result = await createGameSession(body.quizId, session.user.id)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  return NextResponse.json({ gameId: result.game.id, code: result.game.code })
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm test src/app/api/games/route.test.ts`
Expected: PASS (5 tests).

- [x] **Step 5: Commit**

```bash
git add src/app/api/games/route.ts src/app/api/games/route.test.ts
git commit -m "feat(live): POST /api/games to create a live game session"
```

---

### Task 6: `POST /api/games/[code]/join` — anonymous nickname join

**Files:**
- Create: `src/app/api/games/[code]/join/route.ts`
- Test: `src/app/api/games/[code]/join/route.test.ts`

**Interfaces:**
- Consumes: `getGameByCode` from `src/db/game-queries.ts`; `joinGame` from `src/db/game-mutations.ts` (Task 4).
- Produces (used by Task 18's `JoinForm`): `POST /api/games/[code]/join` — body `{ nickname: string, sessionToken: string }`, public (no auth). Returns `{ participantId, nickname }` (200) or `{ error }` (400/403/404/409).

- [x] **Step 1: Write the failing test**

Create `src/app/api/games/[code]/join/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getGameByCode = vi.fn()
vi.mock('@/db/game-queries', () => ({
  getGameByCode: (...a: unknown[]) => getGameByCode(...a),
}))

const joinGame = vi.fn()
vi.mock('@/db/game-mutations', () => ({
  joinGame: (...a: unknown[]) => joinGame(...a),
}))

process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test'

const { POST } = await import('./route')

function req(body: unknown) {
  return { json: async () => body } as Parameters<typeof POST>[0]
}
const ctx = (code: string) => ({ params: Promise.resolve({ code }) })
const FAKE_GAME = { id: 'g1', status: 'waiting' }

beforeEach(() => {
  getGameByCode.mockReset()
  joinGame.mockReset()
})

describe('POST /api/games/[code]/join', () => {
  it('returns 400 for an empty nickname', async () => {
    const res = await POST(req({ nickname: '  ', sessionToken: 't1' }), ctx('854123'))
    expect(res.status).toBe(400)
    expect(getGameByCode).not.toHaveBeenCalled()
  })

  it('returns 400 for a nickname over 20 characters', async () => {
    const res = await POST(req({ nickname: 'x'.repeat(21), sessionToken: 't1' }), ctx('854123'))
    expect(res.status).toBe(400)
  })

  it('returns 400 for a missing sessionToken', async () => {
    const res = await POST(req({ nickname: 'Juan' }), ctx('854123'))
    expect(res.status).toBe(400)
  })

  it('returns 404 for an unknown code', async () => {
    getGameByCode.mockResolvedValue(null)
    const res = await POST(req({ nickname: 'Juan', sessionToken: 't1' }), ctx('000000'))
    expect(res.status).toBe(404)
  })

  it('propagates the error + status from joinGame', async () => {
    getGameByCode.mockResolvedValue(FAKE_GAME)
    joinGame.mockResolvedValue({ ok: false, error: 'That nickname is already taken in this game', status: 409 })
    const res = await POST(req({ nickname: 'Juan', sessionToken: 't1' }), ctx('854123'))
    expect(res.status).toBe(409)
  })

  it('joins and returns the participant id + nickname', async () => {
    getGameByCode.mockResolvedValue(FAKE_GAME)
    joinGame.mockResolvedValue({ ok: true, participant: { id: 'p1', nickname: 'Juan' } })
    const res = await POST(req({ nickname: '  Juan  ', sessionToken: 't1' }), ctx('854123'))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ participantId: 'p1', nickname: 'Juan' })
    expect(joinGame).toHaveBeenCalledWith(FAKE_GAME, 'Juan', 't1')
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm test src/app/api/games/[code]/join/route.test.ts`
Expected: FAIL — cannot resolve `./route`.

- [x] **Step 3: Write the implementation**

Create `src/app/api/games/[code]/join/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { getGameByCode } from '@/db/game-queries'
import { joinGame } from '@/db/game-mutations'

export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const body = await req.json().catch(() => null)

  const nickname = typeof body?.nickname === 'string' ? body.nickname.trim() : ''
  const sessionToken = typeof body?.sessionToken === 'string' ? body.sessionToken : ''
  if (!nickname || nickname.length > 20) {
    return NextResponse.json({ error: 'Nickname must be 1-20 characters' }, { status: 400 })
  }
  if (!sessionToken) {
    return NextResponse.json({ error: 'sessionToken is required' }, { status: 400 })
  }

  const game = await getGameByCode(code)
  if (!game) return NextResponse.json({ error: 'Game not found' }, { status: 404 })

  const result = await joinGame(game, nickname, sessionToken)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  return NextResponse.json({ participantId: result.participant.id, nickname: result.participant.nickname })
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm test src/app/api/games/[code]/join/route.test.ts`
Expected: PASS (6 tests).

- [x] **Step 5: Commit**

```bash
git add "src/app/api/games/[code]/join/route.ts" "src/app/api/games/[code]/join/route.test.ts"
git commit -m "feat(live): POST /api/games/[code]/join for anonymous nickname join"
```

---

### Task 7: `GET /api/games/[code]/state` — the polling endpoint

**Files:**
- Create: `src/app/api/games/[code]/state/route.ts`
- Test: `src/app/api/games/[code]/state/route.test.ts`

**Interfaces:**
- Consumes: `getGameByCode`, `getQuestionsForQuiz`, `getParticipantsWithAnswerStatus` from `src/db/game-queries.ts`; `maybeAdvancePhase` from `src/db/game-mutations.ts`; `rankParticipants` from `src/lib/game-scoring.ts` (Task 2, used live/un-mocked — it's pure).
- Produces (used by Task 12's `useGamePolling` and every Host/Student view, Tasks 14-22): `GET /api/games/[code]/state?participantId=` — public. Response shape:
  ```ts
  type GameStateView = {
    status: 'waiting' | 'question' | 'reveal' | 'podium'
    currentQuestionIndex: number
    totalQuestions: number
    phaseStartedAt: string // ISO
    participants: { id: string; nickname: string; score: number; answered: boolean }[]
    you: { id: string; nickname: string; score: number; streak: number; kickedAt: string | null } | null
    question?: { id: string; text: string; options: string[]; timeLimit: number }
    correctIndex?: number
    leaderboard?: { id: string; nickname: string; score: number; totalAnswerMs: number; rank: number }[]
  }
  ```
  `question` is present for every status except `waiting`. `correctIndex`/`leaderboard` are present only for `reveal`/`podium`. Kicked participants are excluded from `participants`/`leaderboard` but `you` still resolves for them (so their own client can detect `kickedAt` and show a "removed" screen).

- [x] **Step 1: Write the failing test**

Create `src/app/api/games/[code]/state/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getGameByCode = vi.fn()
const getQuestionsForQuiz = vi.fn()
const getParticipantsWithAnswerStatus = vi.fn()
vi.mock('@/db/game-queries', () => ({
  getGameByCode: (...a: unknown[]) => getGameByCode(...a),
  getQuestionsForQuiz: (...a: unknown[]) => getQuestionsForQuiz(...a),
  getParticipantsWithAnswerStatus: (...a: unknown[]) => getParticipantsWithAnswerStatus(...a),
}))

const maybeAdvancePhase = vi.fn()
vi.mock('@/db/game-mutations', () => ({
  maybeAdvancePhase: (...a: unknown[]) => maybeAdvancePhase(...a),
}))

process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test'

const { GET } = await import('./route')

const GAME = {
  id: 'g1',
  quizId: 'q1',
  code: '854123',
  status: 'question',
  currentQuestionIndex: 0,
  phaseStartedAt: new Date('2026-01-01T00:00:00.000Z'),
  hostUserId: 'h1',
}
const QUESTIONS = [
  { id: 'q_1', text: 'Q1', options: ['A', 'B'], timeLimit: 30, correctIndex: 1, order: 1 },
]
const PARTICIPANTS = [
  { id: 'p1', nickname: 'Ana', score: 100, streak: 1, totalAnswerMs: 5000, kickedAt: null, answered: true },
  {
    id: 'p2',
    nickname: 'Bad',
    score: 0,
    streak: 0,
    totalAnswerMs: 0,
    kickedAt: new Date('2026-01-01T00:01:00.000Z'),
    answered: false,
  },
]

function makeReq(code: string, participantId?: string) {
  const qs = participantId ? `?participantId=${participantId}` : ''
  return { nextUrl: new URL(`http://localhost/api/games/${code}/state${qs}`) } as unknown as Parameters<
    typeof GET
  >[0]
}
const ctx = (code: string) => ({ params: Promise.resolve({ code }) })

beforeEach(() => {
  getGameByCode.mockReset()
  getQuestionsForQuiz.mockReset().mockResolvedValue(QUESTIONS)
  getParticipantsWithAnswerStatus.mockReset().mockResolvedValue(PARTICIPANTS)
  maybeAdvancePhase.mockReset().mockImplementation(async (g) => g)
})

describe('GET /api/games/[code]/state', () => {
  it('returns 404 for an unknown code', async () => {
    getGameByCode.mockResolvedValue(null)
    const res = await GET(makeReq('000000'), ctx('000000'))
    expect(res.status).toBe(404)
  })

  it('omits question and leaderboard while waiting, and passes null questionId', async () => {
    getGameByCode.mockResolvedValue({ ...GAME, status: 'waiting' })
    const res = await GET(makeReq('854123'), ctx('854123'))
    const data = await res.json()
    expect(data.status).toBe('waiting')
    expect(data.question).toBeUndefined()
    expect(data.leaderboard).toBeUndefined()
    expect(getParticipantsWithAnswerStatus).toHaveBeenCalledWith('g1', null)
  })

  it('includes the question without correctIndex, and excludes kicked participants, during the question phase', async () => {
    getGameByCode.mockResolvedValue(GAME)
    const res = await GET(makeReq('854123'), ctx('854123'))
    const data = await res.json()
    expect(data.question).toEqual({ id: 'q_1', text: 'Q1', options: ['A', 'B'], timeLimit: 30 })
    expect(data.correctIndex).toBeUndefined()
    expect(data.leaderboard).toBeUndefined()
    expect(data.participants).toEqual([{ id: 'p1', nickname: 'Ana', score: 100, answered: true }])
    expect(getParticipantsWithAnswerStatus).toHaveBeenCalledWith('g1', 'q_1')
  })

  it('includes correctIndex and a ranked leaderboard during reveal', async () => {
    getGameByCode.mockResolvedValue(GAME)
    maybeAdvancePhase.mockImplementation(async (g) => ({ ...g, status: 'reveal' }))
    const res = await GET(makeReq('854123'), ctx('854123'))
    const data = await res.json()
    expect(data.status).toBe('reveal')
    expect(data.correctIndex).toBe(1)
    expect(data.leaderboard).toEqual([{ id: 'p1', nickname: 'Ana', score: 100, totalAnswerMs: 5000, rank: 1 }])
  })

  it('resolves "you" — including a kicked participant — independent of the active participants list', async () => {
    getGameByCode.mockResolvedValue(GAME)
    const res = await GET(makeReq('854123', 'p2'), ctx('854123'))
    const data = await res.json()
    expect(data.you).toEqual({
      id: 'p2',
      nickname: 'Bad',
      score: 0,
      streak: 0,
      kickedAt: '2026-01-01T00:01:00.000Z',
    })
    expect(data.participants.find((p: { id: string }) => p.id === 'p2')).toBeUndefined()
  })

  it('returns you: null when no participantId is given', async () => {
    getGameByCode.mockResolvedValue(GAME)
    const res = await GET(makeReq('854123'), ctx('854123'))
    const data = await res.json()
    expect(data.you).toBeNull()
  })

  it('runs the lazy phase transition on every poll', async () => {
    getGameByCode.mockResolvedValue(GAME)
    await GET(makeReq('854123'), ctx('854123'))
    expect(maybeAdvancePhase).toHaveBeenCalledWith(GAME, QUESTIONS[0])
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm test src/app/api/games/[code]/state/route.test.ts`
Expected: FAIL — cannot resolve `./route`.

- [x] **Step 3: Write the implementation**

Create `src/app/api/games/[code]/state/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { getGameByCode, getQuestionsForQuiz, getParticipantsWithAnswerStatus } from '@/db/game-queries'
import { maybeAdvancePhase } from '@/db/game-mutations'
import { rankParticipants } from '@/lib/game-scoring'

export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const participantId = req.nextUrl.searchParams.get('participantId')

  const game = await getGameByCode(code)
  if (!game) return NextResponse.json({ error: 'Game not found' }, { status: 404 })

  const allQuestions = await getQuestionsForQuiz(game.quizId)
  const currentQuestion = allQuestions[game.currentQuestionIndex]

  const settled = await maybeAdvancePhase(game, currentQuestion)

  const list = await getParticipantsWithAnswerStatus(
    settled.id,
    currentQuestion && (settled.status === 'question' || settled.status === 'reveal') ? currentQuestion.id : null
  )
  const active = list.filter((p) => !p.kickedAt)
  const you = participantId ? (list.find((p) => p.id === participantId) ?? null) : null

  const response: Record<string, unknown> = {
    status: settled.status,
    currentQuestionIndex: settled.currentQuestionIndex,
    totalQuestions: allQuestions.length,
    phaseStartedAt: settled.phaseStartedAt.toISOString(),
    participants: active.map((p) => ({ id: p.id, nickname: p.nickname, score: p.score, answered: p.answered })),
    you: you
      ? {
          id: you.id,
          nickname: you.nickname,
          score: you.score,
          streak: you.streak,
          kickedAt: you.kickedAt ? you.kickedAt.toISOString() : null,
        }
      : null,
  }

  if (currentQuestion && settled.status !== 'waiting') {
    response.question = {
      id: currentQuestion.id,
      text: currentQuestion.text,
      options: currentQuestion.options,
      timeLimit: currentQuestion.timeLimit,
    }
  }

  if (settled.status === 'reveal' || settled.status === 'podium') {
    if (currentQuestion) response.correctIndex = currentQuestion.correctIndex
    response.leaderboard = rankParticipants(
      active.map((p) => ({ id: p.id, nickname: p.nickname, score: p.score, totalAnswerMs: p.totalAnswerMs }))
    )
  }

  return NextResponse.json(response)
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm test src/app/api/games/[code]/state/route.test.ts`
Expected: PASS (7 tests).

- [x] **Step 5: Commit**

```bash
git add "src/app/api/games/[code]/state/route.ts" "src/app/api/games/[code]/state/route.test.ts"
git commit -m "feat(live): GET /api/games/[code]/state polling endpoint with lazy phase transition"
```

---

### Task 8: `POST /api/games/[code]/start` — host starts the game

**Files:**
- Create: `src/app/api/games/[code]/start/route.ts`
- Test: `src/app/api/games/[code]/start/route.test.ts`

**Interfaces:**
- Consumes: `getGameByCode` from `src/db/game-queries.ts`; `startGame` from `src/db/game-mutations.ts` (Task 4).
- Produces (used by Task 14's `HostWaitingRoom` "Start" button): `POST /api/games/[code]/start` — host-only. Returns `{ ok: true }` (200) or `{ error }` (401/403/404/400/409).

- [x] **Step 1: Write the failing test**

Create `src/app/api/games/[code]/start/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}))

const getSession = vi.fn()
vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: () => getSession() } },
}))

const getGameByCode = vi.fn()
vi.mock('@/db/game-queries', () => ({
  getGameByCode: (...a: unknown[]) => getGameByCode(...a),
}))

const startGame = vi.fn()
vi.mock('@/db/game-mutations', () => ({
  startGame: (...a: unknown[]) => startGame(...a),
}))

process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test'

const { POST } = await import('./route')

const req = {} as Parameters<typeof POST>[0]
const ctx = (code: string) => ({ params: Promise.resolve({ code }) })
const GAME = { id: 'g1', hostUserId: 'host1' }

beforeEach(() => {
  getSession.mockReset()
  getGameByCode.mockReset()
  startGame.mockReset()
})

describe('POST /api/games/[code]/start', () => {
  it('returns 401 when there is no session', async () => {
    getSession.mockResolvedValue(null)
    const res = await POST(req, ctx('854123'))
    expect(res.status).toBe(401)
  })

  it('returns 404 for an unknown code', async () => {
    getSession.mockResolvedValue({ user: { id: 'host1' } })
    getGameByCode.mockResolvedValue(null)
    const res = await POST(req, ctx('000000'))
    expect(res.status).toBe(404)
  })

  it('returns 403 when the caller is not the host', async () => {
    getSession.mockResolvedValue({ user: { id: 'someone-else' } })
    getGameByCode.mockResolvedValue(GAME)
    const res = await POST(req, ctx('854123'))
    expect(res.status).toBe(403)
    expect(startGame).not.toHaveBeenCalled()
  })

  it('propagates the error + status from startGame', async () => {
    getSession.mockResolvedValue({ user: { id: 'host1' } })
    getGameByCode.mockResolvedValue(GAME)
    startGame.mockResolvedValue({ ok: false, error: 'No players have joined yet', status: 400 })
    const res = await POST(req, ctx('854123'))
    expect(res.status).toBe(400)
  })

  it('starts the game', async () => {
    getSession.mockResolvedValue({ user: { id: 'host1' } })
    getGameByCode.mockResolvedValue(GAME)
    startGame.mockResolvedValue({ ok: true })
    const res = await POST(req, ctx('854123'))
    expect(res.status).toBe(200)
    expect(startGame).toHaveBeenCalledWith('g1')
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm test src/app/api/games/[code]/start/route.test.ts`
Expected: FAIL — cannot resolve `./route`.

- [x] **Step 3: Write the implementation**

Create `src/app/api/games/[code]/start/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getGameByCode } from '@/db/game-queries'
import { startGame } from '@/db/game-mutations'

export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { code } = await params
  const game = await getGameByCode(code)
  if (!game) return NextResponse.json({ error: 'Game not found' }, { status: 404 })
  if (game.hostUserId !== session.user.id) {
    return NextResponse.json({ error: 'Only the host can start this game' }, { status: 403 })
  }

  const result = await startGame(game.id)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  return NextResponse.json({ ok: true })
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm test src/app/api/games/[code]/start/route.test.ts`
Expected: PASS (5 tests).

- [x] **Step 5: Commit**

```bash
git add "src/app/api/games/[code]/start/route.ts" "src/app/api/games/[code]/start/route.test.ts"
git commit -m "feat(live): POST /api/games/[code]/start (host-only)"
```

---

### Task 9: `POST /api/games/[code]/answer` — submit an answer

**Files:**
- Create: `src/app/api/games/[code]/answer/route.ts`
- Test: `src/app/api/games/[code]/answer/route.test.ts`

**Interfaces:**
- Consumes: `getGameByCode`, `getQuestionsForQuiz` from `src/db/game-queries.ts`; `submitAnswer` from `src/db/game-mutations.ts` (Task 4).
- Produces (used by Task 20's `StudentQuestionLive`): `POST /api/games/[code]/answer` — body `{ participantId, questionId, selectedIndex: number | null }`, public. Returns `{ ok: true }` (200) — deliberately never echoes correctness, so a student can't learn the answer before the reveal phase. Errors: 400/404/409.

- [x] **Step 1: Write the failing test**

Create `src/app/api/games/[code]/answer/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getGameByCode = vi.fn()
const getQuestionsForQuiz = vi.fn()
vi.mock('@/db/game-queries', () => ({
  getGameByCode: (...a: unknown[]) => getGameByCode(...a),
  getQuestionsForQuiz: (...a: unknown[]) => getQuestionsForQuiz(...a),
}))

const submitAnswer = vi.fn()
vi.mock('@/db/game-mutations', () => ({
  submitAnswer: (...a: unknown[]) => submitAnswer(...a),
}))

process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test'

const { POST } = await import('./route')

function req(body: unknown) {
  return { json: async () => body } as Parameters<typeof POST>[0]
}
const ctx = (code: string) => ({ params: Promise.resolve({ code }) })
const GAME_ON_Q1 = { id: 'g1', quizId: 'q1', status: 'question', currentQuestionIndex: 0 }
const QUESTIONS = [{ id: 'q_1', correctIndex: 1, timeLimit: 30 }]

beforeEach(() => {
  getGameByCode.mockReset()
  getQuestionsForQuiz.mockReset().mockResolvedValue(QUESTIONS)
  submitAnswer.mockReset()
})

describe('POST /api/games/[code]/answer', () => {
  it('returns 400 when participantId or questionId is missing', async () => {
    const res = await POST(req({ questionId: 'q_1', selectedIndex: 0 }), ctx('854123'))
    expect(res.status).toBe(400)
    expect(getGameByCode).not.toHaveBeenCalled()
  })

  it('returns 404 for an unknown code', async () => {
    getGameByCode.mockResolvedValue(null)
    const res = await POST(req({ participantId: 'p1', questionId: 'q_1', selectedIndex: 0 }), ctx('000000'))
    expect(res.status).toBe(404)
  })

  it('returns 409 when the game is not in the question phase', async () => {
    getGameByCode.mockResolvedValue({ ...GAME_ON_Q1, status: 'reveal' })
    const res = await POST(req({ participantId: 'p1', questionId: 'q_1', selectedIndex: 0 }), ctx('854123'))
    expect(res.status).toBe(409)
    expect(submitAnswer).not.toHaveBeenCalled()
  })

  it('returns 409 when questionId does not match the current question', async () => {
    getGameByCode.mockResolvedValue(GAME_ON_Q1)
    const res = await POST(req({ participantId: 'p1', questionId: 'stale-question', selectedIndex: 0 }), ctx('854123'))
    expect(res.status).toBe(409)
    expect(submitAnswer).not.toHaveBeenCalled()
  })

  it('propagates the error + status from submitAnswer', async () => {
    getGameByCode.mockResolvedValue(GAME_ON_Q1)
    submitAnswer.mockResolvedValue({ ok: false, error: 'Participant not found', status: 404 })
    const res = await POST(req({ participantId: 'p1', questionId: 'q_1', selectedIndex: 0 }), ctx('854123'))
    expect(res.status).toBe(404)
  })

  it('accepts a null selectedIndex (explicit no-answer) and never echoes correctness', async () => {
    getGameByCode.mockResolvedValue(GAME_ON_Q1)
    submitAnswer.mockResolvedValue({ ok: true })
    const res = await POST(req({ participantId: 'p1', questionId: 'q_1', selectedIndex: null }), ctx('854123'))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
    expect(submitAnswer).toHaveBeenCalledWith(GAME_ON_Q1, QUESTIONS[0], 'p1', null)
  })

  it('scores a chosen answer', async () => {
    getGameByCode.mockResolvedValue(GAME_ON_Q1)
    submitAnswer.mockResolvedValue({ ok: true })
    const res = await POST(req({ participantId: 'p1', questionId: 'q_1', selectedIndex: 1 }), ctx('854123'))
    expect(res.status).toBe(200)
    expect(submitAnswer).toHaveBeenCalledWith(GAME_ON_Q1, QUESTIONS[0], 'p1', 1)
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm test src/app/api/games/[code]/answer/route.test.ts`
Expected: FAIL — cannot resolve `./route`.

- [x] **Step 3: Write the implementation**

Create `src/app/api/games/[code]/answer/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { getGameByCode, getQuestionsForQuiz } from '@/db/game-queries'
import { submitAnswer } from '@/db/game-mutations'

export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const body = await req.json().catch(() => null)

  const participantId = typeof body?.participantId === 'string' ? body.participantId : ''
  const questionId = typeof body?.questionId === 'string' ? body.questionId : ''
  const selectedIndex = typeof body?.selectedIndex === 'number' ? body.selectedIndex : null
  if (!participantId || !questionId) {
    return NextResponse.json({ error: 'participantId and questionId are required' }, { status: 400 })
  }

  const game = await getGameByCode(code)
  if (!game) return NextResponse.json({ error: 'Game not found' }, { status: 404 })
  if (game.status !== 'question') {
    return NextResponse.json({ error: 'This question is no longer accepting answers' }, { status: 409 })
  }

  const allQuestions = await getQuestionsForQuiz(game.quizId)
  const currentQuestion = allQuestions[game.currentQuestionIndex]
  if (!currentQuestion || currentQuestion.id !== questionId) {
    return NextResponse.json({ error: 'That is not the current question' }, { status: 409 })
  }

  const result = await submitAnswer(game, currentQuestion, participantId, selectedIndex)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  return NextResponse.json({ ok: true })
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm test src/app/api/games/[code]/answer/route.test.ts`
Expected: PASS (7 tests).

- [x] **Step 5: Commit**

```bash
git add "src/app/api/games/[code]/answer/route.ts" "src/app/api/games/[code]/answer/route.test.ts"
git commit -m "feat(live): POST /api/games/[code]/answer (correctness never echoed)"
```

---

### Task 10: `POST /api/games/[code]/advance` — host moves to next question or podium

**Files:**
- Create: `src/app/api/games/[code]/advance/route.ts`
- Test: `src/app/api/games/[code]/advance/route.test.ts`

**Interfaces:**
- Consumes: `getGameByCode`, `getQuestionsForQuiz` from `src/db/game-queries.ts`; `advanceGame` from `src/db/game-mutations.ts` (Task 4).
- Produces (used by Task 16's `HostReveal` "Next"/"Podium" button): `POST /api/games/[code]/advance` — host-only. Returns `{ status }` (200) or `{ error }` (401/403/404/409).

- [x] **Step 1: Write the failing test**

Create `src/app/api/games/[code]/advance/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}))

const getSession = vi.fn()
vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: () => getSession() } },
}))

const getGameByCode = vi.fn()
const getQuestionsForQuiz = vi.fn()
vi.mock('@/db/game-queries', () => ({
  getGameByCode: (...a: unknown[]) => getGameByCode(...a),
  getQuestionsForQuiz: (...a: unknown[]) => getQuestionsForQuiz(...a),
}))

const advanceGame = vi.fn()
vi.mock('@/db/game-mutations', () => ({
  advanceGame: (...a: unknown[]) => advanceGame(...a),
}))

process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test'

const { POST } = await import('./route')

const req = {} as Parameters<typeof POST>[0]
const ctx = (code: string) => ({ params: Promise.resolve({ code }) })
const GAME = { id: 'g1', quizId: 'q1', hostUserId: 'host1' }

beforeEach(() => {
  getSession.mockReset()
  getGameByCode.mockReset()
  getQuestionsForQuiz.mockReset().mockResolvedValue([{ id: 'q_1' }, { id: 'q_2' }])
  advanceGame.mockReset()
})

describe('POST /api/games/[code]/advance', () => {
  it('returns 401 when there is no session', async () => {
    getSession.mockResolvedValue(null)
    const res = await POST(req, ctx('854123'))
    expect(res.status).toBe(401)
  })

  it('returns 404 for an unknown code', async () => {
    getSession.mockResolvedValue({ user: { id: 'host1' } })
    getGameByCode.mockResolvedValue(null)
    const res = await POST(req, ctx('000000'))
    expect(res.status).toBe(404)
  })

  it('returns 403 when the caller is not the host', async () => {
    getSession.mockResolvedValue({ user: { id: 'someone-else' } })
    getGameByCode.mockResolvedValue(GAME)
    const res = await POST(req, ctx('854123'))
    expect(res.status).toBe(403)
    expect(advanceGame).not.toHaveBeenCalled()
  })

  it('propagates the error + status from advanceGame', async () => {
    getSession.mockResolvedValue({ user: { id: 'host1' } })
    getGameByCode.mockResolvedValue(GAME)
    advanceGame.mockResolvedValue({ ok: false, error: 'Game is not in the reveal phase', status: 409 })
    const res = await POST(req, ctx('854123'))
    expect(res.status).toBe(409)
  })

  it('advances and returns the new status, passing the total question count', async () => {
    getSession.mockResolvedValue({ user: { id: 'host1' } })
    getGameByCode.mockResolvedValue(GAME)
    advanceGame.mockResolvedValue({ ok: true, game: { status: 'question' } })
    const res = await POST(req, ctx('854123'))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ status: 'question' })
    expect(advanceGame).toHaveBeenCalledWith(GAME, 2)
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm test src/app/api/games/[code]/advance/route.test.ts`
Expected: FAIL — cannot resolve `./route`.

- [x] **Step 3: Write the implementation**

Create `src/app/api/games/[code]/advance/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getGameByCode, getQuestionsForQuiz } from '@/db/game-queries'
import { advanceGame } from '@/db/game-mutations'

export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { code } = await params
  const game = await getGameByCode(code)
  if (!game) return NextResponse.json({ error: 'Game not found' }, { status: 404 })
  if (game.hostUserId !== session.user.id) {
    return NextResponse.json({ error: 'Only the host can advance this game' }, { status: 403 })
  }

  const allQuestions = await getQuestionsForQuiz(game.quizId)
  const result = await advanceGame(game, allQuestions.length)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  return NextResponse.json({ status: result.game.status })
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm test src/app/api/games/[code]/advance/route.test.ts`
Expected: PASS (5 tests).

- [x] **Step 5: Commit**

```bash
git add "src/app/api/games/[code]/advance/route.ts" "src/app/api/games/[code]/advance/route.test.ts"
git commit -m "feat(live): POST /api/games/[code]/advance (host-only)"
```

---

### Task 11: `POST /api/games/[code]/kick` — host removes a participant

**Files:**
- Create: `src/app/api/games/[code]/kick/route.ts`
- Test: `src/app/api/games/[code]/kick/route.test.ts`

**Interfaces:**
- Consumes: `getGameByCode` from `src/db/game-queries.ts`; `kickParticipant` from `src/db/game-mutations.ts` (Task 4).
- Produces (used by Task 14's `HostWaitingRoom` / Task 15's live view kick button): `POST /api/games/[code]/kick` — body `{ participantId }`, host-only. Returns `{ ok: true }` (200) or `{ error }` (401/400/403/404).

- [x] **Step 1: Write the failing test**

Create `src/app/api/games/[code]/kick/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}))

const getSession = vi.fn()
vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: () => getSession() } },
}))

const getGameByCode = vi.fn()
vi.mock('@/db/game-queries', () => ({
  getGameByCode: (...a: unknown[]) => getGameByCode(...a),
}))

const kickParticipant = vi.fn()
vi.mock('@/db/game-mutations', () => ({
  kickParticipant: (...a: unknown[]) => kickParticipant(...a),
}))

process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test'

const { POST } = await import('./route')

function req(body: unknown) {
  return { json: async () => body } as Parameters<typeof POST>[0]
}
const ctx = (code: string) => ({ params: Promise.resolve({ code }) })
const GAME = { id: 'g1', hostUserId: 'host1' }

beforeEach(() => {
  getSession.mockReset()
  getGameByCode.mockReset()
  kickParticipant.mockReset()
})

describe('POST /api/games/[code]/kick', () => {
  it('returns 401 when there is no session', async () => {
    getSession.mockResolvedValue(null)
    const res = await POST(req({ participantId: 'p1' }), ctx('854123'))
    expect(res.status).toBe(401)
  })

  it('returns 400 when participantId is missing', async () => {
    getSession.mockResolvedValue({ user: { id: 'host1' } })
    const res = await POST(req({}), ctx('854123'))
    expect(res.status).toBe(400)
    expect(getGameByCode).not.toHaveBeenCalled()
  })

  it('returns 404 for an unknown code', async () => {
    getSession.mockResolvedValue({ user: { id: 'host1' } })
    getGameByCode.mockResolvedValue(null)
    const res = await POST(req({ participantId: 'p1' }), ctx('000000'))
    expect(res.status).toBe(404)
  })

  it('returns 403 when the caller is not the host', async () => {
    getSession.mockResolvedValue({ user: { id: 'someone-else' } })
    getGameByCode.mockResolvedValue(GAME)
    const res = await POST(req({ participantId: 'p1' }), ctx('854123'))
    expect(res.status).toBe(403)
    expect(kickParticipant).not.toHaveBeenCalled()
  })

  it('returns 404 when the participant does not belong to this game', async () => {
    getSession.mockResolvedValue({ user: { id: 'host1' } })
    getGameByCode.mockResolvedValue(GAME)
    kickParticipant.mockResolvedValue(false)
    const res = await POST(req({ participantId: 'not-in-this-game' }), ctx('854123'))
    expect(res.status).toBe(404)
  })

  it('kicks the participant', async () => {
    getSession.mockResolvedValue({ user: { id: 'host1' } })
    getGameByCode.mockResolvedValue(GAME)
    kickParticipant.mockResolvedValue(true)
    const res = await POST(req({ participantId: 'p1' }), ctx('854123'))
    expect(res.status).toBe(200)
    expect(kickParticipant).toHaveBeenCalledWith('g1', 'p1')
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm test src/app/api/games/[code]/kick/route.test.ts`
Expected: FAIL — cannot resolve `./route`.

- [x] **Step 3: Write the implementation**

Create `src/app/api/games/[code]/kick/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getGameByCode } from '@/db/game-queries'
import { kickParticipant } from '@/db/game-mutations'

export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { code } = await params
  const body = await req.json().catch(() => null)
  const participantId = typeof body?.participantId === 'string' ? body.participantId : ''
  if (!participantId) {
    return NextResponse.json({ error: 'participantId is required' }, { status: 400 })
  }

  const game = await getGameByCode(code)
  if (!game) return NextResponse.json({ error: 'Game not found' }, { status: 404 })
  if (game.hostUserId !== session.user.id) {
    return NextResponse.json({ error: 'Only the host can remove a player' }, { status: 403 })
  }

  const kicked = await kickParticipant(game.id, participantId)
  if (!kicked) return NextResponse.json({ error: 'Participant not found' }, { status: 404 })

  return NextResponse.json({ ok: true })
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm test src/app/api/games/[code]/kick/route.test.ts`
Expected: PASS (6 tests).

- [x] **Step 5: Commit**

```bash
git add "src/app/api/games/[code]/kick/route.ts" "src/app/api/games/[code]/kick/route.test.ts"
git commit -m "feat(live): POST /api/games/[code]/kick (host-only)"
```

---

### Task 12: Client hooks — `useGamePolling`, `useCountdown`, `useGameSound`

**Files:**
- Create: `src/hooks/useGamePolling.ts`
- Create: `src/hooks/useCountdown.ts`
- Create: `src/hooks/useGameSound.ts`

**Interfaces:**
- Consumes: nothing (fetch `GET /api/games/[code]/state` from Task 7 directly; no other module imports).
- Produces (used by every Host/Student view, Tasks 14-22):
  - `useGamePolling(code: string, participantId?: string | null): { state: GameStateView | null; error: string | null }` — the `GameStateView` shape matches Task 7's response exactly.
  - `useCountdown(phaseStartedAt: string, timeLimitSeconds: number): number` — seconds remaining, ticking every 250ms, computed from the server timestamp (not a local timer that could drift from the server's phase transition).
  - `useGameSound(): { playCorrect(): void; playWrong(): void }` — synthesized Web Audio tones, no new audio assets.

No dedicated test file — these are DOM/browser-API hooks with no automated coverage anywhere in this codebase (see `src/hooks/useQuizMusic.ts`, which also ships without a test). Verified manually in Task 23's end-to-end pass.

- [x] **Step 1: Create the polling hook**

Create `src/hooks/useGamePolling.ts`:

```ts
'use client'

import { useEffect, useRef, useState } from 'react'

export type GameParticipantView = { id: string; nickname: string; score: number; answered: boolean }
export type GameLeaderboardEntry = {
  id: string
  nickname: string
  score: number
  totalAnswerMs: number
  rank: number
}
export type GameQuestionView = { id: string; text: string; options: string[]; timeLimit: number }
export type GameStateView = {
  status: 'waiting' | 'question' | 'reveal' | 'podium'
  currentQuestionIndex: number
  totalQuestions: number
  phaseStartedAt: string
  participants: GameParticipantView[]
  you: { id: string; nickname: string; score: number; streak: number; kickedAt: string | null } | null
  question?: GameQuestionView
  correctIndex?: number
  leaderboard?: GameLeaderboardEntry[]
}

const POLL_MS = 1500

export function useGamePolling(code: string, participantId?: string | null) {
  const [state, setState] = useState<GameStateView | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setInterval>

    async function poll() {
      try {
        const qs = participantId ? `?participantId=${encodeURIComponent(participantId)}` : ''
        const res = await fetch(`/api/games/${code}/state${qs}`, { cache: 'no-store' })
        if (cancelled) return
        if (!res.ok) {
          setError(res.status === 404 ? 'Game not found' : 'Failed to load game')
          return
        }
        const data = (await res.json()) as GameStateView
        setError(null)
        setState(data)
      } catch {
        if (!cancelled) setError('Connection lost, retrying...')
      }
    }

    poll()
    timer = setInterval(poll, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [code, participantId])

  return { state, error }
}
```

- [x] **Step 2: Create the countdown hook**

Create `src/hooks/useCountdown.ts`:

```ts
'use client'

import { useEffect, useState } from 'react'

// Ticks down from a server-provided phase start time, not a locally-started
// timer — so a page that mounts mid-question (or after a poll delay) still
// shows the correct remaining time instead of restarting from timeLimitSeconds.
export function useCountdown(phaseStartedAt: string, timeLimitSeconds: number) {
  const [secondsLeft, setSecondsLeft] = useState(timeLimitSeconds)

  useEffect(() => {
    const endMs = new Date(phaseStartedAt).getTime() + timeLimitSeconds * 1000

    function tick() {
      setSecondsLeft(Math.max(0, Math.ceil((endMs - Date.now()) / 1000)))
    }

    tick()
    const timer = setInterval(tick, 250)
    return () => clearInterval(timer)
  }, [phaseStartedAt, timeLimitSeconds])

  return secondsLeft
}
```

- [x] **Step 3: Create the sound hook**

Create `src/hooks/useGameSound.ts`:

```ts
'use client'

// Correct/wrong cues are synthesized tones (Web Audio oscillator), not audio
// files — no licensing/attribution overhead, unlike public/music/*.mp3.
export function useGameSound() {
  function playTone(frequencies: number[], durationMs: number) {
    if (typeof window === 'undefined') return
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return

    const ctx = new AudioCtx()
    const now = ctx.currentTime
    const slice = durationMs / 1000 / frequencies.length

    frequencies.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const start = now + i * slice
      const end = start + slice
      gain.gain.setValueAtTime(0.2, start)
      gain.gain.exponentialRampToValueAtTime(0.001, end)
      osc.connect(gain).connect(ctx.destination)
      osc.start(start)
      osc.stop(end)
    })

    window.setTimeout(() => ctx.close(), durationMs + 100)
  }

  return {
    playCorrect: () => playTone([523.25, 783.99], 400), // C5 -> G5, rising chime
    playWrong: () => playTone([196], 500), // low G3 buzz
  }
}
```

- [x] **Step 4: Verify types and lint**

Run: `npx tsc --noEmit && pnpm lint`
Expected: clean.

- [x] **Step 5: Commit**

```bash
git add src/hooks/useGamePolling.ts src/hooks/useCountdown.ts src/hooks/useGameSound.ts
git commit -m "feat(live): polling, countdown, and synthesized-sound client hooks"
```

---

### Task 13: "Host live" entry point in the dashboard editor

**Files:**
- Create: `src/components/quiz/HostLiveButton.tsx`
- Modify: `src/components/builder/QuizEditor.tsx` (imports ~line 20, header actions ~line 219)

**Interfaces:**
- Consumes: `POST /api/games` from Task 5.
- Produces: nothing consumed by later tasks — this is the leaf entry point into the flow built in Tasks 14+.

- [x] **Step 1: Create HostLiveButton**

Create `src/components/quiz/HostLiveButton.tsx` (mirrors the structure of `src/components/quiz/PublishToggle.tsx`):

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Radio, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function HostLiveButton({ quizId, disabled }: { quizId: string; disabled?: boolean }) {
  const router = useRouter()
  const [starting, setStarting] = useState(false)

  async function hostLive() {
    setStarting(true)
    try {
      const res = await fetch('/api/games', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quizId }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to start live game')
      }
      const data = await res.json()
      router.push(`/host/${data.code}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to start live game')
      setStarting(false)
    }
  }

  return (
    <Button
      onClick={hostLive}
      disabled={disabled || starting}
      size="sm"
      variant="outline"
      className="gap-1.5"
    >
      {starting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Radio className="w-3.5 h-3.5" />}
      Host live
    </Button>
  )
}
```

(No `finally`-reset of `starting` on success: the component navigates away via `router.push`, so it's fine to stay disabled/spinning until unmount.)

- [x] **Step 2: Wire into QuizEditor**

In `src/components/builder/QuizEditor.tsx`:

a. Add the import after the `PublishToggle` import (~line 20):

```ts
import { PublishToggle } from '@/components/quiz/PublishToggle'
import { HostLiveButton } from '@/components/quiz/HostLiveButton'
```

b. In the header actions `div` (~line 209-219), add the button immediately before `PublishToggle`:

```tsx
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setDeleteOpen(true)}
                aria-label="Delete quiz"
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
              <HostLiveButton quizId={initialQuiz.id} disabled={quiz.questions.length === 0} />
              <PublishToggle quizId={initialQuiz.id} initialIsPublic={initialQuiz.isPublic} />
```

- [x] **Step 3: Verify types, lint**

Run: `npx tsc --noEmit && pnpm lint`
Expected: clean.

- [x] **Step 4: Manual check**

Run: `pnpm dev`, open a quiz with at least one question in the dashboard editor:
- "Host live" button is enabled; clicking it creates a game and navigates to `/host/<code>` (404 for now — the host page doesn't exist until Task 14, that's expected at this point in the plan).
- Open a quiz with zero questions — "Host live" is disabled.

- [x] **Step 5: Commit**

```bash
git add src/components/quiz/HostLiveButton.tsx src/components/builder/QuizEditor.tsx
git commit -m "feat(live): Host live button in the dashboard quiz editor"
```

---

### Task 14: Host page shell, `HostGameView` orchestrator, `HostWaitingRoom`

**Files:**
- Create: `src/app/host/[code]/page.tsx`
- Create: `src/components/game/HostGameView.tsx`
- Create: `src/components/game/HostWaitingRoom.tsx`

**Interfaces:**
- Consumes: `getGameByCode` from `src/db/game-queries.ts`; `useGamePolling`/`GameStateView`/`GameParticipantView` from `src/hooks/useGamePolling.ts` (Task 12); `POST /api/games/[code]/{start,kick}` from Tasks 6-11.
- Produces: `HostGameView({ code, quizTitle, coverEmoji }: { code: string; quizTitle: string; coverEmoji: string })` — the orchestrator Tasks 15-17 plug their components into. `HostWaitingRoom({ code, quizTitle, coverEmoji, participants, onKick, onStart })`.

- [x] **Step 1: Host page (server component, auth + ownership gate)**

Create `src/app/host/[code]/page.tsx`:

```tsx
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { getGameByCode } from '@/db/game-queries'
import { db } from '@/db'
import { quizzes } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { HostGameView } from '@/components/game/HostGameView'

export default async function HostPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) notFound()

  const game = await getGameByCode(code)
  if (!game || game.hostUserId !== session.user.id) notFound()

  const [quiz] = await db
    .select({ title: quizzes.title, coverEmoji: quizzes.coverEmoji })
    .from(quizzes)
    .where(eq(quizzes.id, game.quizId))
    .limit(1)
  if (!quiz) notFound()

  return <HostGameView code={code} quizTitle={quiz.title} coverEmoji={quiz.coverEmoji ?? '🧠'} />
}
```

- [x] **Step 2: HostGameView orchestrator**

Create `src/components/game/HostGameView.tsx`:

```tsx
'use client'

import { useGamePolling } from '@/hooks/useGamePolling'
import { HostWaitingRoom } from './HostWaitingRoom'
import { HostQuestionLive } from './HostQuestionLive'
import { HostReveal } from './HostReveal'
import { HostPodium } from './HostPodium'

export function HostGameView({
  code,
  quizTitle,
  coverEmoji,
}: {
  code: string
  quizTitle: string
  coverEmoji: string
}) {
  const { state, error } = useGamePolling(code)

  async function post(path: string, body?: unknown) {
    await fetch(`/api/games/${code}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
  }

  if (error) {
    return <div className="max-w-md mx-auto pt-24 text-center text-destructive">{error}</div>
  }
  if (!state) {
    return <div className="max-w-md mx-auto pt-24 text-center text-muted-foreground">Loading game...</div>
  }

  if (state.status === 'waiting') {
    return (
      <HostWaitingRoom
        code={code}
        quizTitle={quizTitle}
        coverEmoji={coverEmoji}
        participants={state.participants}
        onKick={(participantId) => post('/kick', { participantId })}
        onStart={() => post('/start')}
      />
    )
  }
  if (state.status === 'question' && state.question) {
    return (
      <HostQuestionLive
        question={state.question}
        currentQuestionIndex={state.currentQuestionIndex}
        totalQuestions={state.totalQuestions}
        phaseStartedAt={state.phaseStartedAt}
        participants={state.participants}
      />
    )
  }
  if (state.status === 'reveal' && state.question) {
    return (
      <HostReveal
        key={state.currentQuestionIndex}
        question={state.question}
        correctIndex={state.correctIndex ?? -1}
        currentQuestionIndex={state.currentQuestionIndex}
        totalQuestions={state.totalQuestions}
        leaderboard={state.leaderboard ?? []}
        onAdvance={() => post('/advance')}
      />
    )
  }
  if (state.status === 'podium') {
    return <HostPodium leaderboard={state.leaderboard ?? []} quizTitle={quizTitle} coverEmoji={coverEmoji} />
  }
  return null
}
```

(`HostQuestionLive`, `HostReveal`, `HostPodium` don't exist until Tasks 15-17 — this task will not type-check or build in isolation. That's expected; Step 4 below runs the check only after Task 17.)

- [x] **Step 3: HostWaitingRoom**

Create `src/components/game/HostWaitingRoom.tsx`:

```tsx
'use client'

import { X, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { GameParticipantView } from '@/hooks/useGamePolling'

export function HostWaitingRoom({
  code,
  quizTitle,
  coverEmoji,
  participants,
  onKick,
  onStart,
}: {
  code: string
  quizTitle: string
  coverEmoji: string
  participants: GameParticipantView[]
  onKick: (participantId: string) => void
  onStart: () => void
}) {
  const joinUrl = typeof window !== 'undefined' ? `${window.location.origin}/join/${code}` : `/join/${code}`

  return (
    <div className="max-w-3xl mx-auto px-6 py-10 space-y-8 text-center">
      <div className="space-y-2">
        <div className="text-5xl">{coverEmoji}</div>
        <h1 className="font-[family-name:var(--font-syne)] font-bold text-2xl text-foreground">{quizTitle}</h1>
        <p className="text-muted-foreground text-sm">Waiting for players to join</p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 space-y-2">
        <p className="text-xs text-muted-foreground uppercase tracking-wide">Room code</p>
        <p className="font-[family-name:var(--font-syne)] font-bold text-5xl text-accent-lime tabular-nums tracking-widest">
          {code}
        </p>
        <p className="text-xs text-muted-foreground break-all">{joinUrl}</p>
      </div>

      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {participants.length} player{participants.length === 1 ? '' : 's'} joined
        </p>
        <div className="flex flex-wrap gap-2 justify-center min-h-12">
          {participants.map((p) => (
            <Badge key={p.id} variant="secondary" className="gap-1.5 text-sm py-1.5 px-3">
              {p.nickname}
              <button
                onClick={() => onKick(p.id)}
                aria-label={`Remove ${p.nickname}`}
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="w-3 h-3" />
              </button>
            </Badge>
          ))}
        </div>
      </div>

      <Button
        onClick={onStart}
        disabled={participants.length === 0}
        size="lg"
        className="gap-2 rounded-xl bg-accent-lime text-accent-lime-foreground hover:bg-accent-lime/90 font-semibold"
      >
        <Play className="w-4 h-4" />
        Start quiz
      </Button>
    </div>
  )
}
```

- [x] **Step 4: Commit**

This task intentionally does not type-check in isolation (`HostGameView` imports `HostQuestionLive`/`HostReveal`/`HostPodium`, created in Tasks 15-17). Commit now; verification happens at the end of Task 17.

```bash
git add "src/app/host/[code]/page.tsx" src/components/game/HostGameView.tsx src/components/game/HostWaitingRoom.tsx
git commit -m "feat(live): host page shell, orchestrator, and waiting room"
```

---

### Task 15: `HostQuestionLive` component

**Files:**
- Create: `src/components/game/HostQuestionLive.tsx`

**Interfaces:**
- Consumes: `useCountdown` from `src/hooks/useCountdown.ts` (Task 12); `GameQuestionView`, `GameParticipantView` types from `src/hooks/useGamePolling.ts`.
- Produces: `HostQuestionLive({ question, currentQuestionIndex, totalQuestions, phaseStartedAt, participants })` — used by `HostGameView` (Task 14).

- [x] **Step 1: Create the component**

Create `src/components/game/HostQuestionLive.tsx`:

```tsx
'use client'

import { Clock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useCountdown } from '@/hooks/useCountdown'
import type { GameQuestionView, GameParticipantView } from '@/hooks/useGamePolling'

export function HostQuestionLive({
  question,
  currentQuestionIndex,
  totalQuestions,
  phaseStartedAt,
  participants,
}: {
  question: GameQuestionView
  currentQuestionIndex: number
  totalQuestions: number
  phaseStartedAt: string
  participants: GameParticipantView[]
}) {
  const secondsLeft = useCountdown(phaseStartedAt, question.timeLimit)
  const answeredCount = participants.filter((p) => p.answered).length

  return (
    <div className="max-w-2xl mx-auto px-6 py-10 space-y-6 text-center">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          Question {currentQuestionIndex + 1} / {totalQuestions}
        </span>
        <Badge
          variant="secondary"
          className={cn('gap-1 tabular-nums', secondsLeft <= 5 && 'bg-destructive/20 text-destructive')}
        >
          <Clock className="w-3 h-3" />
          {secondsLeft}s
        </Badge>
      </div>

      <h1 className="font-[family-name:var(--font-syne)] font-bold text-2xl text-foreground leading-snug">
        {question.text}
      </h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {question.options.map((opt, i) => (
          <div
            key={i}
            className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-secondary/50 text-left text-sm"
          >
            <span className="w-6 h-6 rounded-full border text-xs font-bold flex items-center justify-center shrink-0">
              {String.fromCharCode(65 + i)}
            </span>
            <span>{opt}</span>
          </div>
        ))}
      </div>

      <p className="text-accent-lime font-semibold">
        {answeredCount} / {participants.length} answered
      </p>
    </div>
  )
}
```

- [x] **Step 2: Commit**

Still not type-checkable in isolation (`HostReveal`/`HostPodium` remain, Tasks 16-17).

```bash
git add src/components/game/HostQuestionLive.tsx
git commit -m "feat(live): HostQuestionLive — live question + answered-count display"
```

---

### Task 16: `HostReveal` component

**Files:**
- Create: `src/components/game/HostReveal.tsx`

**Interfaces:**
- Consumes: `GameQuestionView`, `GameLeaderboardEntry` types from `src/hooks/useGamePolling.ts` (Task 12).
- Produces: `HostReveal({ question, correctIndex, currentQuestionIndex, totalQuestions, leaderboard, onAdvance })` — used by `HostGameView` (Task 14), which already keys it by `currentQuestionIndex` so the 2s advance-gate resets on every new question.

- [x] **Step 1: Create the component**

Create `src/components/game/HostReveal.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { GameQuestionView, GameLeaderboardEntry } from '@/hooks/useGamePolling'

export function HostReveal({
  question,
  correctIndex,
  currentQuestionIndex,
  totalQuestions,
  leaderboard,
  onAdvance,
}: {
  question: GameQuestionView
  correctIndex: number
  currentQuestionIndex: number
  totalQuestions: number
  leaderboard: GameLeaderboardEntry[]
  onAdvance: () => void
}) {
  const [canAdvance, setCanAdvance] = useState(false)
  const isLast = currentQuestionIndex + 1 >= totalQuestions

  // Gives students at least 2s to see the reveal (highlight + sound) before
  // the host can skip to the next question. Resets because HostGameView
  // keys this component by currentQuestionIndex, forcing a remount per question.
  useEffect(() => {
    const t = setTimeout(() => setCanAdvance(true), 2000)
    return () => clearTimeout(t)
  }, [])

  return (
    <div className="max-w-2xl mx-auto px-6 py-10 space-y-6">
      <h1 className="font-[family-name:var(--font-syne)] font-semibold text-xl text-foreground text-center">
        {question.text}
      </h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {question.options.map((opt, i) => (
          <div
            key={i}
            className={cn(
              'flex items-center gap-3 px-4 py-3 rounded-xl border text-left text-sm',
              i === correctIndex
                ? 'border-success bg-success/15 text-foreground'
                : 'border-border bg-secondary/30 text-muted-foreground'
            )}
          >
            <span className="w-6 h-6 rounded-full border text-xs font-bold flex items-center justify-center shrink-0">
              {String.fromCharCode(65 + i)}
            </span>
            <span>{opt}</span>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <h2 className="font-[family-name:var(--font-syne)] font-semibold text-sm text-muted-foreground">
          Leaderboard
        </h2>
        <div className="rounded-2xl border border-border bg-card divide-y divide-border">
          {leaderboard.slice(0, 8).map((p) => (
            <div key={p.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span className="flex items-center gap-3">
                <span className="w-6 text-muted-foreground font-mono">{p.rank}</span>
                <span className="text-foreground">{p.nickname}</span>
              </span>
              <span className="font-semibold text-accent-lime tabular-nums">{p.score}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="text-center">
        <Button
          onClick={onAdvance}
          disabled={!canAdvance}
          size="lg"
          className="rounded-xl bg-accent-lime text-accent-lime-foreground hover:bg-accent-lime/90 font-semibold"
        >
          {isLast ? 'Show podium' : 'Next question'}
        </Button>
      </div>
    </div>
  )
}
```

- [x] **Step 2: Commit**

Still not type-checkable in isolation (`HostPodium` remains, Task 17).

```bash
git add src/components/game/HostReveal.tsx
git commit -m "feat(live): HostReveal — answer highlight, leaderboard, gated advance"
```

---

### Task 17: `HostPodium` component

**Files:**
- Create: `src/components/game/HostPodium.tsx`

**Interfaces:**
- Consumes: `GameLeaderboardEntry` type from `src/hooks/useGamePolling.ts` (Task 12); `.animate-fade-up`/`-delay-1/2/3` CSS classes already defined in `src/app/globals.css`.
- Produces: `HostPodium({ leaderboard, quizTitle, coverEmoji })` — used by `HostGameView` (Task 14). This completes the full host component tree.

- [x] **Step 1: Create the component**

Create `src/components/game/HostPodium.tsx`:

```tsx
'use client'

import { Trophy } from 'lucide-react'
import type { GameLeaderboardEntry } from '@/hooks/useGamePolling'

function PodiumBlock({
  entry,
  place,
  heightClass,
  delayClass,
}: {
  entry: GameLeaderboardEntry
  place: 1 | 2 | 3
  heightClass: string
  delayClass: string
}) {
  return (
    <div className={`flex flex-col items-center gap-2 w-24 ${delayClass}`}>
      {place === 1 && <Trophy className="w-6 h-6 text-accent-lime" />}
      <p className="text-sm font-semibold text-foreground truncate w-full text-center">{entry.nickname}</p>
      <p className="text-xs text-muted-foreground tabular-nums">{entry.score}</p>
      <div
        className={`w-full rounded-t-xl bg-accent-lime/20 border border-accent-lime/40 flex items-start justify-center pt-2 ${heightClass}`}
      >
        <span className="font-[family-name:var(--font-syne)] font-bold text-2xl text-accent-lime">{place}</span>
      </div>
    </div>
  )
}

export function HostPodium({
  leaderboard,
  quizTitle,
  coverEmoji,
}: {
  leaderboard: GameLeaderboardEntry[]
  quizTitle: string
  coverEmoji: string
}) {
  const [first, second, third] = leaderboard
  const rest = leaderboard.slice(3)

  return (
    <div className="max-w-2xl mx-auto px-6 py-10 space-y-8 text-center">
      <div className="space-y-2">
        <div className="text-5xl">{coverEmoji}</div>
        <h1 className="font-[family-name:var(--font-syne)] font-bold text-2xl text-foreground">{quizTitle}</h1>
        <p className="text-muted-foreground text-sm">Final results</p>
      </div>

      <div className="flex items-end justify-center gap-3">
        {second && <PodiumBlock entry={second} place={2} heightClass="h-28" delayClass="animate-fade-up-delay-2" />}
        {first && <PodiumBlock entry={first} place={1} heightClass="h-36" delayClass="animate-fade-up" />}
        {third && <PodiumBlock entry={third} place={3} heightClass="h-20" delayClass="animate-fade-up-delay-3" />}
      </div>

      {rest.length > 0 && (
        <div className="rounded-2xl border border-border bg-card divide-y divide-border text-left animate-fade-up-delay-3">
          {rest.map((p) => (
            <div key={p.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span className="flex items-center gap-3">
                <span className="w-6 text-muted-foreground font-mono">{p.rank}</span>
                <span className="text-foreground">{p.nickname}</span>
              </span>
              <span className="font-semibold text-accent-lime tabular-nums">{p.score}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [x] **Step 2: Verify the full host tree type-checks and lints**

Run: `npx tsc --noEmit && pnpm lint`
Expected: clean. This is the first point where `HostGameView` (Task 14) has all its imports satisfied.

- [x] **Step 3: Manual check**

Run: `pnpm dev`. From a quiz with ≥1 question in the dashboard, click "Host live":
- Waiting room shows the room code, share URL, and updates as you `curl -X POST http://localhost:3000/api/games/<code>/join -H 'Content-Type: application/json' -d '{"nickname":"Test","sessionToken":"t1"}'` a couple of times (no student UI exists yet — Tasks 18-22 — so simulate joins via curl for this check).
- "Start quiz" enabled once ≥1 joined; clicking it shows `HostQuestionLive` with a live countdown and answered-count.
- Manually `curl -X POST .../answer` for a joined participant, then either wait out the timer or answer for everyone — confirm the view flips to `HostReveal` with the correct answer highlighted and leaderboard populated.
- "Next question" is disabled for ~2s then enabled; clicking through to the last question shows "Show podium"; clicking it renders `HostPodium` with the top-3 blocks and stagger animation.

- [x] **Step 4: Commit**

```bash
git add src/components/game/HostPodium.tsx
git commit -m "feat(live): HostPodium — animated final results"
```

---

### Task 18: Join flow — `/join`, `/join/[code]`, `JoinForm`

**Files:**
- Create: `src/components/game/JoinForm.tsx`
- Create: `src/app/join/page.tsx`
- Create: `src/app/join/[code]/page.tsx`

**Interfaces:**
- Consumes: `POST /api/games/[code]/join` from Task 6.
- Produces: on success, writes `localStorage['quez_game_<code>']` = `JSON.stringify({ participantId, sessionToken })`. **This exact key format is the contract Task 19's `StudentGameView` reads to detect an existing join** — same key (`quez_game_<code>`), same two fields.

- [x] **Step 1: Create JoinForm**

Create `src/components/game/JoinForm.tsx`:

```tsx
'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

function storageKey(code: string) {
  return `quez_game_${code}`
}

export function JoinForm({ initialCode }: { initialCode?: string }) {
  const router = useRouter()
  const [code, setCode] = useState(initialCode ?? '')
  const [nickname, setNickname] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    const trimmedCode = code.trim()
    const trimmedNickname = nickname.trim()
    if (!/^\d{6}$/.test(trimmedCode)) {
      setError('Room code must be 6 digits')
      return
    }
    if (!trimmedNickname) {
      setError('Enter a nickname')
      return
    }

    setJoining(true)
    const key = storageKey(trimmedCode)
    const existing = localStorage.getItem(key)
    const sessionToken = existing ? (JSON.parse(existing).sessionToken as string) : crypto.randomUUID()

    try {
      const res = await fetch(`/api/games/${trimmedCode}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: trimmedNickname, sessionToken }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to join')
      }
      const data = await res.json()
      localStorage.setItem(key, JSON.stringify({ participantId: data.participantId, sessionToken }))
      router.push(`/game/${trimmedCode}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to join')
      setJoining(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-sm mx-auto px-6 py-16 space-y-5 text-center">
      <h1 className="font-[family-name:var(--font-syne)] font-bold text-2xl text-foreground">Join a game</h1>
      <div className="space-y-3 text-left">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Room code</label>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="854123"
            inputMode="numeric"
            className="text-center text-2xl tabular-nums tracking-widest h-14"
            maxLength={6}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Nickname</label>
          <Input
            value={nickname}
            onChange={(e) => setNickname(e.target.value.slice(0, 20))}
            placeholder="Your name"
            maxLength={20}
          />
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button
        type="submit"
        disabled={joining}
        size="lg"
        className="w-full rounded-xl bg-accent-lime text-accent-lime-foreground hover:bg-accent-lime/90 font-semibold"
      >
        {joining ? 'Joining...' : 'Join'}
      </Button>
    </form>
  )
}
```

- [x] **Step 2: Create the pages**

Create `src/app/join/page.tsx`:

```tsx
import { JoinForm } from '@/components/game/JoinForm'

export default function JoinPage() {
  return <JoinForm />
}
```

Create `src/app/join/[code]/page.tsx`:

```tsx
import { JoinForm } from '@/components/game/JoinForm'

export default async function JoinCodePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  return <JoinForm initialCode={code} />
}
```

- [x] **Step 3: Verify types, lint**

Run: `npx tsc --noEmit && pnpm lint`
Expected: clean.

- [x] **Step 4: Manual check**

Run: `pnpm dev`, with a game already in `waiting` (via Task 17's host flow):
- Visit `/join/<code>` — code is prefilled, readonly-feeling but still editable; enter a nickname, submit.
- Redirects to `/game/<code>` (404 for now — `StudentGameView` doesn't exist until Task 19, that's expected here).
- Visit `/join` directly — code field is empty, can be typed manually.
- Try joining with a nickname already taken in that room (join twice with different sessionTokens, same nickname) — shows the inline "already taken" error.

- [x] **Step 5: Commit**

```bash
git add src/components/game/JoinForm.tsx src/app/join/page.tsx "src/app/join/[code]/page.tsx"
git commit -m "feat(live): join flow — room code + nickname entry"
```

---

### Task 19: Student page shell, `StudentGameView` orchestrator, `StudentWaitingRoom`

**Files:**
- Create: `src/app/game/[code]/page.tsx`
- Create: `src/components/game/StudentGameView.tsx`
- Create: `src/components/game/StudentWaitingRoom.tsx`

**Interfaces:**
- Consumes: `localStorage['quez_game_<code>']` written by Task 18's `JoinForm`; `useGamePolling`/`GameStateView`/`GameParticipantView` from `src/hooks/useGamePolling.ts` (Task 12).
- Produces: `StudentGameView({ code })` — the orchestrator Tasks 20-22 plug their components into. It lifts `selectedIndex` (the student's tapped answer) keyed by `currentQuestionIndex`, so it survives the `question → reveal` remount and can be passed into `StudentReveal` (Task 21) for the correct/wrong sound cue. `StudentWaitingRoom({ participants, you })`.

- [x] **Step 1: Student page (no auth — anonymous play)**

Create `src/app/game/[code]/page.tsx`:

```tsx
import { StudentGameView } from '@/components/game/StudentGameView'

export default async function GamePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  return <StudentGameView code={code} />
}
```

- [x] **Step 2: StudentGameView orchestrator**

Create `src/components/game/StudentGameView.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useGamePolling } from '@/hooks/useGamePolling'
import { StudentWaitingRoom } from './StudentWaitingRoom'
import { StudentQuestionLive } from './StudentQuestionLive'
import { StudentReveal } from './StudentReveal'
import { StudentPodium } from './StudentPodium'

function storageKey(code: string) {
  return `quez_game_${code}`
}

export function StudentGameView({ code }: { code: string }) {
  const router = useRouter()
  // undefined = not yet read from localStorage, null = no join found (redirecting)
  const [participantId, setParticipantId] = useState<string | null | undefined>(undefined)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [answeredQuestionIndex, setAnsweredQuestionIndex] = useState<number | null>(null)

  useEffect(() => {
    const raw = localStorage.getItem(storageKey(code))
    if (!raw) {
      router.replace(`/join/${code}`)
      setParticipantId(null)
      return
    }
    const parsed = JSON.parse(raw) as { participantId: string }
    setParticipantId(parsed.participantId)
  }, [code, router])

  const { state, error } = useGamePolling(code, participantId ?? undefined)

  if (participantId === undefined || participantId === null) return null

  if (error) {
    return (
      <div className="max-w-md mx-auto pt-24 text-center">
        <p className="text-destructive">{error}</p>
      </div>
    )
  }
  if (!state) {
    return <div className="max-w-md mx-auto pt-24 text-center text-muted-foreground">Loading game...</div>
  }
  if (state.you?.kickedAt) {
    return (
      <div className="max-w-md mx-auto pt-24 text-center">
        <p className="text-destructive font-semibold">You were removed from this game by the host.</p>
      </div>
    )
  }

  function recordAnswer(index: number | null) {
    setSelectedIndex(index)
    setAnsweredQuestionIndex(state!.currentQuestionIndex)
  }

  if (state.status === 'waiting') {
    return <StudentWaitingRoom participants={state.participants} you={state.you} />
  }
  if (state.status === 'question' && state.question) {
    return (
      <StudentQuestionLive
        code={code}
        participantId={participantId}
        question={state.question}
        phaseStartedAt={state.phaseStartedAt}
        currentQuestionIndex={state.currentQuestionIndex}
        onAnswered={recordAnswer}
      />
    )
  }
  if (state.status === 'reveal' && state.question && state.you) {
    return (
      <StudentReveal
        key={state.currentQuestionIndex}
        question={state.question}
        correctIndex={state.correctIndex ?? -1}
        selectedIndex={answeredQuestionIndex === state.currentQuestionIndex ? selectedIndex : null}
        you={state.you}
      />
    )
  }
  if (state.status === 'podium') {
    return <StudentPodium leaderboard={state.leaderboard ?? []} you={state.you} />
  }
  return null
}
```

(`StudentQuestionLive`, `StudentReveal`, `StudentPodium` don't exist until Tasks 20-22 — expected not to type-check until then, same as the host tree in Task 14.)

- [x] **Step 3: StudentWaitingRoom**

Create `src/components/game/StudentWaitingRoom.tsx`:

```tsx
'use client'

import { Badge } from '@/components/ui/badge'
import type { GameParticipantView, GameStateView } from '@/hooks/useGamePolling'

export function StudentWaitingRoom({
  participants,
  you,
}: {
  participants: GameParticipantView[]
  you: GameStateView['you']
}) {
  return (
    <div className="max-w-md mx-auto px-6 py-16 space-y-6 text-center">
      <h1 className="font-[family-name:var(--font-syne)] font-bold text-2xl text-foreground">You&apos;re in!</h1>
      <p className="text-muted-foreground text-sm">Waiting for the host to start the quiz...</p>

      <div className="flex flex-wrap gap-2 justify-center">
        {participants.map((p) => (
          <Badge key={p.id} variant={p.id === you?.id ? 'default' : 'secondary'} className="text-sm py-1.5 px-3">
            {p.nickname}
            {p.id === you?.id && ' (you)'}
          </Badge>
        ))}
      </div>
    </div>
  )
}
```

- [x] **Step 4: Commit**

```bash
git add "src/app/game/[code]/page.tsx" src/components/game/StudentGameView.tsx src/components/game/StudentWaitingRoom.tsx
git commit -m "feat(live): student page shell, orchestrator, and waiting room"
```

---

### Task 20: `StudentQuestionLive` component

**Files:**
- Create: `src/components/game/StudentQuestionLive.tsx`

**Interfaces:**
- Consumes: `useCountdown` from `src/hooks/useCountdown.ts` (Task 12); `GameQuestionView` type; `POST /api/games/[code]/answer` from Task 9.
- Produces: `StudentQuestionLive({ code, participantId, question, phaseStartedAt, currentQuestionIndex, onAnswered })` — used by `StudentGameView` (Task 19). Calls `onAnswered(index | null)` exactly once per question, whether the student tapped a tile or the timer ran out, so the parent can remember it for `StudentReveal` (Task 21).

- [x] **Step 1: Create the component**

Create `src/components/game/StudentQuestionLive.tsx`:

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
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
  question,
  phaseStartedAt,
  currentQuestionIndex,
  onAnswered,
}: {
  code: string
  participantId: string
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
    setSelected(null)
    setAnswered(false)
    submittedRef.current = false
  }, [currentQuestionIndex])

  useEffect(() => {
    if (secondsLeft === 0 && !submittedRef.current) submit(null)
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
      body: JSON.stringify({ participantId, questionId: question.id, selectedIndex: index }),
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
              onClick={() => submit(i)}
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

      {answered && (
        <p className="text-center text-accent-lime font-semibold text-sm">
          {selected === null ? "Time's up!" : 'Answer locked'} — waiting for the others...
        </p>
      )}
    </div>
  )
}
```

- [x] **Step 2: Commit**

Still not type-checkable in isolation (`StudentReveal`/`StudentPodium` remain, Tasks 21-22).

```bash
git add src/components/game/StudentQuestionLive.tsx
git commit -m "feat(live): StudentQuestionLive — tappable tiles, countdown ring, answer submit"
```

---

### Task 21: `StudentReveal` component

**Files:**
- Create: `src/components/game/StudentReveal.tsx`

**Interfaces:**
- Consumes: `useGameSound` from `src/hooks/useGameSound.ts` (Task 12); `GameQuestionView`/`GameStateView` types.
- Produces: `StudentReveal({ question, correctIndex, selectedIndex, you })` — used by `StudentGameView` (Task 19), which keys it by `currentQuestionIndex` so the sound cue fires exactly once per question (remount, not a re-render).

- [x] **Step 1: Create the component**

Create `src/components/game/StudentReveal.tsx`:

```tsx
'use client'

import { useEffect } from 'react'
import { cn } from '@/lib/utils'
import { useGameSound } from '@/hooks/useGameSound'
import type { GameQuestionView, GameStateView } from '@/hooks/useGamePolling'

export function StudentReveal({
  question,
  correctIndex,
  selectedIndex,
  you,
}: {
  question: GameQuestionView
  correctIndex: number
  selectedIndex: number | null
  you: NonNullable<GameStateView['you']>
}) {
  const { playCorrect, playWrong } = useGameSound()
  const isCorrect = selectedIndex !== null && selectedIndex === correctIndex

  useEffect(() => {
    if (isCorrect) playCorrect()
    else playWrong()
    // Fires once on mount only — StudentGameView keys this component by
    // currentQuestionIndex, so a new question is always a fresh mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="max-w-2xl mx-auto px-6 py-10 space-y-6 text-center">
      <div
        className={cn(
          'rounded-2xl border p-6 space-y-1',
          isCorrect ? 'border-success bg-success/15' : 'border-destructive bg-destructive/15'
        )}
      >
        <p
          className={cn(
            'font-[family-name:var(--font-syne)] font-bold text-2xl',
            isCorrect ? 'text-success' : 'text-destructive'
          )}
        >
          {isCorrect ? 'Correct!' : selectedIndex === null ? "Time's up" : 'Wrong'}
        </p>
        {isCorrect && you.streak > 1 && <p className="text-sm text-muted-foreground">🔥 {you.streak} in a row</p>}
      </div>

      <div className="grid grid-cols-1 gap-2">
        {question.options.map((opt, i) => (
          <div
            key={i}
            className={cn(
              'flex items-center gap-3 px-4 py-3 rounded-xl border text-left text-sm',
              i === correctIndex
                ? 'border-success bg-success/15 text-foreground'
                : 'border-border bg-secondary/30 text-muted-foreground'
            )}
          >
            <span className="w-6 h-6 rounded-full border text-xs font-bold flex items-center justify-center shrink-0">
              {String.fromCharCode(65 + i)}
            </span>
            <span>{opt}</span>
          </div>
        ))}
      </div>

      <p className="text-muted-foreground text-sm">
        Total score: <span className="font-semibold text-accent-lime">{you.score}</span>
      </p>
    </div>
  )
}
```

- [x] **Step 2: Commit**

Still not type-checkable in isolation (`StudentPodium` remains, Task 22).

```bash
git add src/components/game/StudentReveal.tsx
git commit -m "feat(live): StudentReveal — correct/wrong banner, sound cue, streak"
```

---

### Task 22: `StudentPodium` component

**Files:**
- Create: `src/components/game/StudentPodium.tsx`

**Interfaces:**
- Consumes: `GameLeaderboardEntry`/`GameStateView` types from `src/hooks/useGamePolling.ts` (Task 12); same `.animate-fade-up`/`-delay-*` CSS as `HostPodium` (Task 17).
- Produces: `StudentPodium({ leaderboard, you })` — used by `StudentGameView` (Task 19). This completes the full student component tree.

- [x] **Step 1: Create the component**

Create `src/components/game/StudentPodium.tsx`:

```tsx
'use client'

import { Trophy } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { GameLeaderboardEntry, GameStateView } from '@/hooks/useGamePolling'

function PodiumBlock({
  entry,
  place,
  heightClass,
  delayClass,
  isYou,
}: {
  entry: GameLeaderboardEntry
  place: 1 | 2 | 3
  heightClass: string
  delayClass: string
  isYou: boolean
}) {
  return (
    <div className={`flex flex-col items-center gap-2 w-24 ${delayClass}`}>
      {place === 1 && <Trophy className="w-6 h-6 text-accent-lime" />}
      <p
        className={cn(
          'text-sm font-semibold truncate w-full text-center',
          isYou ? 'text-accent-lime' : 'text-foreground'
        )}
      >
        {entry.nickname}
        {isYou && ' (you)'}
      </p>
      <p className="text-xs text-muted-foreground tabular-nums">{entry.score}</p>
      <div
        className={`w-full rounded-t-xl bg-accent-lime/20 border border-accent-lime/40 flex items-start justify-center pt-2 ${heightClass}`}
      >
        <span className="font-[family-name:var(--font-syne)] font-bold text-2xl text-accent-lime">{place}</span>
      </div>
    </div>
  )
}

export function StudentPodium({
  leaderboard,
  you,
}: {
  leaderboard: GameLeaderboardEntry[]
  you: GameStateView['you']
}) {
  const [first, second, third] = leaderboard
  const rest = leaderboard.slice(3)
  const yourEntry = leaderboard.find((p) => p.id === you?.id)

  return (
    <div className="max-w-2xl mx-auto px-6 py-10 space-y-8 text-center">
      <div className="space-y-2">
        <h1 className="font-[family-name:var(--font-syne)] font-bold text-2xl text-foreground">Final results</h1>
        {yourEntry && (
          <p className="text-muted-foreground text-sm">
            You finished <span className="font-semibold text-accent-lime">#{yourEntry.rank}</span> with{' '}
            <span className="font-semibold text-accent-lime">{yourEntry.score}</span> points
          </p>
        )}
      </div>

      <div className="flex items-end justify-center gap-3">
        {second && (
          <PodiumBlock
            entry={second}
            place={2}
            heightClass="h-28"
            delayClass="animate-fade-up-delay-2"
            isYou={second.id === you?.id}
          />
        )}
        {first && (
          <PodiumBlock
            entry={first}
            place={1}
            heightClass="h-36"
            delayClass="animate-fade-up"
            isYou={first.id === you?.id}
          />
        )}
        {third && (
          <PodiumBlock
            entry={third}
            place={3}
            heightClass="h-20"
            delayClass="animate-fade-up-delay-3"
            isYou={third.id === you?.id}
          />
        )}
      </div>

      {rest.length > 0 && (
        <div className="rounded-2xl border border-border bg-card divide-y divide-border text-left animate-fade-up-delay-3">
          {rest.map((p) => (
            <div
              key={p.id}
              className={cn(
                'flex items-center justify-between px-4 py-2.5 text-sm',
                p.id === you?.id && 'bg-accent-lime/10'
              )}
            >
              <span className="flex items-center gap-3">
                <span className="w-6 text-muted-foreground font-mono">{p.rank}</span>
                <span className={p.id === you?.id ? 'text-accent-lime font-semibold' : 'text-foreground'}>
                  {p.nickname}
                  {p.id === you?.id && ' (you)'}
                </span>
              </span>
              <span className="font-semibold text-accent-lime tabular-nums">{p.score}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [x] **Step 2: Verify the full student tree type-checks and lints**

Run: `npx tsc --noEmit && pnpm lint`
Expected: clean. This is the first point where `StudentGameView` (Task 19) has all its imports satisfied.

- [x] **Step 3: Manual check (two browser windows)**

Run: `pnpm dev`. Window A: dashboard → "Host live" → `/host/<code>`. Window B: `/join/<code>` → enter a nickname → join.

- Window B shows the waiting room with its own nickname highlighted; Window A shows it in the roster.
- Start from Window A → both flip to the live question. Window B: tap a tile → locks, "Answer locked" message. Let the timer run out on a second question without tapping → "Time's up" auto-submits.
- Both flip to reveal at the same time (within ~1.5s of each other, from polling): Window B shows a correct/wrong banner with a sound cue; Window A shows the leaderboard.
- Window A clicks "Next question" (disabled for the first 2s) → both advance.
- On the last question, Window A's button reads "Show podium"; clicking it shows both windows the animated podium, Window B's own row/block highlighted.
- Refresh Window B mid-game → it reconnects to the same seat/score (via the `sessionToken` in `localStorage`) instead of being asked to join again.
- From Window A's waiting room, kick a not-yet-started player — their Window B shows "You were removed from this game by the host."

- [x] **Step 4: Commit**

```bash
git add src/components/game/StudentPodium.tsx
git commit -m "feat(live): StudentPodium — final rank, animated top-3, own-row highlight"
```

---

### Task 23: Full verification

**Files:** none new.

- [x] **Step 1: Full test + lint + type-check + build**

Run: `pnpm test && pnpm lint && npx tsc --noEmit && pnpm build`
Expected: all tests pass (Tasks 2-3, 5-11 — 54 tests total: 10+3+5+6+7+5+7+5+6), lint clean, no type errors, production build succeeds.

- [x] **Step 2: End-to-end manual pass covering every spec edge case**

With `pnpm dev`, two browser windows (host + student, per Task 22 Step 3), work through:

1. **Happy path:** host creates a game → student joins with a nickname → host starts → both play through every question (answer, reveal with sound, leaderboard, next) → podium at the end.
2. **Nickname collision:** a second student tries to join the same room with a nickname already taken (case-insensitive, e.g. `Juan` vs `juan`) — sees the inline 409 error, must pick a different name.
3. **Late join blocked:** after the host starts, a new browser tab tries `/join/<code>` with a fresh nickname — sees "This game has already started."
4. **Reconnect allowed:** an already-joined student refreshes mid-game — rejoins the same seat/score via their `sessionToken`, not treated as late-join.
5. **Host kick:** host kicks a participant from the waiting room and, separately, mid-game — that student's next poll shows "You were removed."
6. **Duplicate answer submit:** in dev tools, fire the same `POST /answer` twice for one participant/question (e.g. double-click race) — second call is a no-op, score isn't double-counted (verify via the leaderboard).
7. **Timeout with partial answers:** let a question's timer expire while only some students have answered — the rest are auto-scored 0 and the phase still flips to reveal.
8. **Quiz deleted mid-game:** as the quiz owner, delete the quiz (dashboard) while a game on it is still `waiting`/`question` — the next poll from host or student 404s and shows "host ended this quiz" (cascade delete via the `quizzes` FK).
9. **Scoring sanity:** answer one question instantly and correctly, another correctly at the last second — confirm the instant answer scores roughly double the last-second one (per the `computePoints` formula), and that a 2-streak scores more than the same speed with no streak.

- [x] **Step 3: Fix anything found, commit fixes**

Any failures: fix, re-run Step 1, commit with a `fix:` message.

---

## Plan self-review

**Spec coverage:** every section of `docs/superpowers/specs/2026-07-12-kahoot-live-mode-design.md` maps to a task — Data model → Task 1; State machine (lazy transition) → Task 4/7; Scoring → Task 2; Routes (API) → Tasks 5-11; Routes (Pages) → Tasks 13-14, 18-19; Sound + animation → Tasks 12, 17, 21-22; Error handling → covered across Tasks 6 (nickname collision, late-join), 8 (0-participant start), 9 (duplicate submit, wrong-question), 11 (kick), 19 (kicked-student screen), and exercised end-to-end in Task 23 Step 2; Testing → a `.test.ts` on every task with no DB dependency (Tasks 2, 3, 5-11).

**Placeholder scan:** no `TBD`/`TODO`/"add appropriate error handling"-style steps; every code block is complete, runnable code, not a description of code.

**Type consistency:** `GameStateView`/`GameQuestionView`/`GameParticipantView`/`GameLeaderboardEntry` are defined once in Task 12 (`useGamePolling.ts`) and imported by type everywhere else (Tasks 14-22) rather than redeclared — checked for drift across all 9 consuming files. Route response shapes (Task 7) match the hook's `GameStateView` field-for-field (`participants[].answered`, `you.streak`, optional `question`/`correctIndex`/`leaderboard`). `computePoints`/`rankParticipants` signatures (Task 2) match their call sites in `game-mutations.ts` (Task 4) and the state route (Task 7).

**Scope check:** single cohesive feature, sequenced backend-first (Tasks 1-12) then UI (13-22) so each layer is testable before the next depends on it. Not decomposed into separate specs/plans — every task depends on the schema from Task 1 and most host/student UI tasks share the Task 12 hooks, so splitting would just add cross-plan coordination overhead without giving any task independent shippability.

**Ambiguity check:** resolved during brainstorming and re-confirmed here — room-code recycling scope (`podium` excluded, Task 3/4), tie-break rule (score desc, then total answer time asc, Task 2), what "late join" means precisely (any `sessionToken` not already in the game once `status !== 'waiting'`, Task 4), and what the student sees on kick (immediate, via their own `you.kickedAt` on the next poll, Task 19) are all pinned to one interpretation in the relevant task rather than left open.

