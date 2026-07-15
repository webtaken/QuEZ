# Live Mode Polling → Socket.IO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 1.5s polling loop in live play mode with push-based realtime over Socket.IO, using a custom Node server on Railway.

**Architecture:** A plain-JS `server.mjs` attaches Socket.IO to the HTTP server and stashes `io` on `globalThis`; `src/instrumentation.ts` (inside Next's compiled context) wires the connection handler. Every event — POST mutation, socket connect, timer fire — funnels through one `syncGameById()` that settles overdue phases via the existing `maybeAdvancePhase` (kept as the single race-safe flip engine), broadcasts one shared snapshot to the game's room, and re-arms a phase-deadline timer.

**Tech Stack:** Next.js 16 (custom server, Turbopack), Socket.IO 4, Drizzle/Postgres, vitest, pnpm, Docker/Railway.

**Spec:** `docs/superpowers/specs/2026-07-14-live-mode-websockets-design.md`

## Global Constraints

- Single Railway instance: in-memory `io` and timers, no Redis adapter.
- Push-only socket: mutations remain the existing POST routes; the socket only receives. No auth on the socket handshake (`{ code, participantId? }` is identification, not auth).
- Every broadcast is a **full snapshot** — there are no incremental/partial events.
- Broadcast rooms are keyed by **game id**, never by code (codes are recycled after podium).
- `server.mjs` stays plain JS — Next's compiler does not process the custom server file, so it cannot import TS modules.
- Custom server and `output: "standalone"` cannot be combined (Next docs) — standalone must be removed from `next.config.ts` and the Dockerfile reworked.
- Every cross-module mutable singleton (io instance, timers map) lives on `globalThis` — Next bundles `instrumentation.ts`, route handlers, and `server.mjs` as separate module graphs, so module-scope state silently duplicates.
- `maybeAdvancePhase` in `src/db/game-mutations.ts` remains the only code that flips phases. Timers never flip state themselves; they just trigger a sync.
- New dependencies allowed: `socket.io`, `socket.io-client` only.
- Repo conventions: colocated `*.test.ts` files, vitest with `vi.mock` + `process.env.DATABASE_URL ??=` guard, `@/` path alias, no semicolon-free style changes — match surrounding code.

---

### Task 1: Realtime foundation — deps, wire types, globalThis accessors, phase timers

**Files:**
- Create: `src/lib/realtime/types.ts`
- Create: `src/lib/realtime/io.ts`
- Create: `src/lib/realtime/timers.ts`
- Test: `src/lib/realtime/timers.test.ts`
- Modify: `package.json` (dependencies only — scripts change in Task 6)

**Interfaces:**
- Consumes: nothing (foundation task).
- Produces:
  - `types.ts`: `REVEAL_TO_PODIUM_MS = 5000`, `GameStatus`, `GameSnapshotParticipant`, `GameLeaderboardEntry`, `GameQuestionView`, `GameSnapshot`, `GameErrorReason`.
  - `io.ts`: `getIo(): Server | null`, `getPhaseTimers(): Map<string, PhaseTimerEntry>`, `PhaseTimerEntry`.
  - `timers.ts`: `ensurePhaseTimer(gameId: string, spec: PhaseTimerSpec | null, onFire: () => void): void`, `PhaseTimerSpec = { phaseKey: string; delayMs: number }`.

- [ ] **Step 1: Install dependencies**

```bash
pnpm add socket.io socket.io-client
```

Expected: both added to `dependencies` in `package.json` (v4.8+).

- [ ] **Step 2: Create the shared wire types**

Create `src/lib/realtime/types.ts`:

```ts
// Wire format shared by the Socket.IO server and the browser client.
// MUST stay free of server-only imports (drizzle, node:*) — the client bundles it.

// How long the final question's reveal lingers before auto-advancing to podium.
// Lives here (not in game-mutations) so client-safe modules can import it
// without pulling in the db.
export const REVEAL_TO_PODIUM_MS = 5000

export type GameStatus = 'waiting' | 'question' | 'reveal' | 'podium'

export type GameSnapshotParticipant = {
  id: string
  nickname: string
  score: number
  streak: number
  answered: boolean
  kickedAt: string | null
}

export type GameLeaderboardEntry = {
  id: string
  nickname: string
  score: number
  totalAnswerMs: number
  rank: number
}

export type GameQuestionView = { id: string; text: string; options: string[]; timeLimit: number }

// One shared payload per room — every client receives the same snapshot and
// derives its own view (see snapshot-view.ts). correctIndex/leaderboard are
// present only when status is 'reveal' or 'podium'.
export type GameSnapshot = {
  status: GameStatus
  currentQuestionIndex: number
  totalQuestions: number
  phaseStartedAt: string
  participants: GameSnapshotParticipant[]
  question?: GameQuestionView
  correctIndex?: number
  leaderboard?: GameLeaderboardEntry[]
}

export type GameErrorReason = 'not-found' | 'ended'
```

- [ ] **Step 3: Create the globalThis accessors**

Create `src/lib/realtime/io.ts`:

```ts
import type { Server } from 'socket.io'

// server.mjs (plain JS, outside Next's compiled graph) sets globalThis.__quezIo
// before Next boots. Next bundles instrumentation.ts, route handlers, and lib
// modules as separate module graphs, so module-scope singletons silently
// duplicate — every cross-module mutable singleton must live on globalThis.
export type PhaseTimerEntry = { phaseKey: string; timer: NodeJS.Timeout }

type RealtimeGlobal = typeof globalThis & {
  __quezIo?: Server
  __quezPhaseTimers?: Map<string, PhaseTimerEntry>
}

export function getIo(): Server | null {
  return (globalThis as RealtimeGlobal).__quezIo ?? null
}

export function getPhaseTimers(): Map<string, PhaseTimerEntry> {
  const g = globalThis as RealtimeGlobal
  g.__quezPhaseTimers ??= new Map()
  return g.__quezPhaseTimers
}
```

- [ ] **Step 4: Write the failing timer tests**

Create `src/lib/realtime/timers.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ensurePhaseTimer } from './timers'
import { getPhaseTimers } from './io'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  for (const { timer } of getPhaseTimers().values()) clearTimeout(timer)
  getPhaseTimers().clear()
  vi.useRealTimers()
})

describe('ensurePhaseTimer', () => {
  it('arms a timer that fires once and removes its map entry', () => {
    const onFire = vi.fn()
    ensurePhaseTimer('g1', { phaseKey: 'question:0', delayMs: 1000 }, onFire)
    expect(getPhaseTimers().has('g1')).toBe(true)

    vi.advanceTimersByTime(999)
    expect(onFire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onFire).toHaveBeenCalledTimes(1)
    expect(getPhaseTimers().has('g1')).toBe(false)
  })

  it('keeps the existing timer for the same phaseKey — repeated syncs do not push the deadline back', () => {
    const onFire = vi.fn()
    ensurePhaseTimer('g1', { phaseKey: 'question:0', delayMs: 1000 }, onFire)
    vi.advanceTimersByTime(600)
    // A re-sync (e.g. a student answering) re-ensures the same phase.
    ensurePhaseTimer('g1', { phaseKey: 'question:0', delayMs: 1000 }, onFire)
    vi.advanceTimersByTime(400) // original deadline
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('replaces the timer when the phaseKey changes', () => {
    const first = vi.fn()
    const second = vi.fn()
    ensurePhaseTimer('g1', { phaseKey: 'question:0', delayMs: 1000 }, first)
    ensurePhaseTimer('g1', { phaseKey: 'reveal:0', delayMs: 500 }, second)
    vi.advanceTimersByTime(1000)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('clears the timer when spec is null', () => {
    const onFire = vi.fn()
    ensurePhaseTimer('g1', { phaseKey: 'question:0', delayMs: 1000 }, onFire)
    ensurePhaseTimer('g1', null, onFire)
    expect(getPhaseTimers().has('g1')).toBe(false)
    vi.advanceTimersByTime(2000)
    expect(onFire).not.toHaveBeenCalled()
  })

  it('tracks timers per game id independently', () => {
    const a = vi.fn()
    const b = vi.fn()
    ensurePhaseTimer('g1', { phaseKey: 'question:0', delayMs: 500 }, a)
    ensurePhaseTimer('g2', { phaseKey: 'question:0', delayMs: 1000 }, b)
    vi.advanceTimersByTime(500)
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 5: Run tests to verify they fail**

```bash
pnpm vitest run src/lib/realtime/timers.test.ts
```

Expected: FAIL — `Cannot find module './timers'` (or equivalent).

- [ ] **Step 6: Implement the timer module**

Create `src/lib/realtime/timers.ts`:

```ts
import { getPhaseTimers } from './io'

export type PhaseTimerSpec = { phaseKey: string; delayMs: number }

// Idempotent: called on every sync (connect, mutation, timer fire). Keeps an
// existing timer for the same phase (same phaseKey) so repeated syncs don't
// push the deadline back; replaces it when the phase changed; clears it when
// the phase needs no timer (waiting, non-final reveal, podium, deleted game).
export function ensurePhaseTimer(gameId: string, spec: PhaseTimerSpec | null, onFire: () => void): void {
  const timers = getPhaseTimers()
  const existing = timers.get(gameId)
  if (existing && spec && existing.phaseKey === spec.phaseKey) return
  if (existing) {
    clearTimeout(existing.timer)
    timers.delete(gameId)
  }
  if (!spec) return
  const timer = setTimeout(() => {
    timers.delete(gameId)
    onFire()
  }, spec.delayMs)
  timers.set(gameId, { phaseKey: spec.phaseKey, timer })
}
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
pnpm vitest run src/lib/realtime/timers.test.ts
```

Expected: 5 tests PASS.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/realtime/
git commit -m "feat(live): realtime foundation — socket.io deps, wire types, phase timers"
```

---

### Task 2: Snapshot builder — `buildGameSnapshot`

**Files:**
- Create: `src/lib/realtime/game-state.ts`
- Test: `src/lib/realtime/game-state.test.ts`
- Modify: `src/db/game-queries.ts` (add `getGameById`)
- Modify: `src/db/game-mutations.ts` (import `REVEAL_TO_PODIUM_MS` from types instead of local const)

**Interfaces:**
- Consumes: `GameSnapshot` from `./types`; `getGameById`, `getQuestionsForQuiz`, `getParticipantsWithAnswerStatus` from `@/db/game-queries`; `maybeAdvancePhase` from `@/db/game-mutations`; `rankParticipants` from `@/lib/game-scoring`.
- Produces: `buildGameSnapshot(gameId: string): Promise<{ snapshot: GameSnapshot; game: GameSession; currentQuestion: Question | undefined; totalQuestions: number } | null>` — returns `null` when the game no longer exists (quiz-delete cascade). `getGameById(id: string)` in game-queries.

- [ ] **Step 1: Add `getGameById` to `src/db/game-queries.ts`**

Append after `getGameByCode`:

```ts
export async function getGameById(id: string) {
  const [game] = await db.select().from(gameSessions).where(eq(gameSessions.id, id)).limit(1)
  return game ?? null
}
```

- [ ] **Step 2: Move the podium delay constant**

In `src/db/game-mutations.ts`, delete the line:

```ts
const REVEAL_TO_PODIUM_MS = 5000
```

and add to the imports at the top:

```ts
import { REVEAL_TO_PODIUM_MS } from '@/lib/realtime/types'
```

Run `pnpm test` — all existing tests must still pass.

- [ ] **Step 3: Write the failing snapshot tests**

These are the ported `state`-route tests (`src/app/api/games/[code]/state/route.test.ts` is deleted in Task 7 — this file replaces it). Create `src/lib/realtime/game-state.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getGameById = vi.fn()
const getQuestionsForQuiz = vi.fn()
const getParticipantsWithAnswerStatus = vi.fn()
vi.mock('@/db/game-queries', () => ({
  getGameById: (...a: unknown[]) => getGameById(...a),
  getQuestionsForQuiz: (...a: unknown[]) => getQuestionsForQuiz(...a),
  getParticipantsWithAnswerStatus: (...a: unknown[]) => getParticipantsWithAnswerStatus(...a),
}))

const maybeAdvancePhase = vi.fn()
vi.mock('@/db/game-mutations', () => ({
  maybeAdvancePhase: (...a: unknown[]) => maybeAdvancePhase(...a),
}))

process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test'

const { buildGameSnapshot } = await import('./game-state')

const GAME = {
  id: 'g1',
  quizId: 'q1',
  code: '854123',
  status: 'question',
  currentQuestionIndex: 0,
  phaseStartedAt: new Date('2026-01-01T00:00:00.000Z'),
  hostUserId: 'h1',
}
const QUESTIONS = [{ id: 'q_1', text: 'Q1', options: ['A', 'B'], timeLimit: 30, correctIndex: 1, order: 1 }]
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

beforeEach(() => {
  getGameById.mockReset()
  getQuestionsForQuiz.mockReset().mockResolvedValue(QUESTIONS)
  getParticipantsWithAnswerStatus.mockReset().mockResolvedValue(PARTICIPANTS)
  maybeAdvancePhase.mockReset().mockImplementation(async (g) => g)
})

describe('buildGameSnapshot', () => {
  it('returns null for an unknown game id', async () => {
    getGameById.mockResolvedValue(null)
    expect(await buildGameSnapshot('nope')).toBeNull()
  })

  it('omits question and leaderboard while waiting, and passes null questionId', async () => {
    getGameById.mockResolvedValue({ ...GAME, status: 'waiting' })
    const result = await buildGameSnapshot('g1')
    expect(result!.snapshot.status).toBe('waiting')
    expect(result!.snapshot.question).toBeUndefined()
    expect(result!.snapshot.leaderboard).toBeUndefined()
    expect(getParticipantsWithAnswerStatus).toHaveBeenCalledWith('g1', null)
  })

  it('includes every participant (kicked too, with ISO kickedAt) so clients can derive their own view', async () => {
    getGameById.mockResolvedValue(GAME)
    const result = await buildGameSnapshot('g1')
    expect(result!.snapshot.participants).toEqual([
      { id: 'p1', nickname: 'Ana', score: 100, streak: 1, answered: true, kickedAt: null },
      { id: 'p2', nickname: 'Bad', score: 0, streak: 0, answered: false, kickedAt: '2026-01-01T00:01:00.000Z' },
    ])
  })

  it('includes the question without correctIndex during the question phase', async () => {
    getGameById.mockResolvedValue(GAME)
    const result = await buildGameSnapshot('g1')
    expect(result!.snapshot.question).toEqual({ id: 'q_1', text: 'Q1', options: ['A', 'B'], timeLimit: 30 })
    expect(result!.snapshot.correctIndex).toBeUndefined()
    expect(result!.snapshot.leaderboard).toBeUndefined()
    expect(getParticipantsWithAnswerStatus).toHaveBeenCalledWith('g1', 'q_1')
  })

  it('includes correctIndex and a leaderboard ranked from active participants only during reveal', async () => {
    getGameById.mockResolvedValue(GAME)
    maybeAdvancePhase.mockImplementation(async (g) => ({ ...g, status: 'reveal' }))
    const result = await buildGameSnapshot('g1')
    expect(result!.snapshot.status).toBe('reveal')
    expect(result!.snapshot.correctIndex).toBe(1)
    expect(result!.snapshot.leaderboard).toEqual([
      { id: 'p1', nickname: 'Ana', score: 100, totalAnswerMs: 5000, rank: 1 },
    ])
  })

  it('runs the lazy phase transition and returns the settled game', async () => {
    getGameById.mockResolvedValue(GAME)
    const settled = { ...GAME, status: 'reveal', phaseStartedAt: new Date('2026-01-01T00:00:30.000Z') }
    maybeAdvancePhase.mockResolvedValue(settled)
    const result = await buildGameSnapshot('g1')
    expect(maybeAdvancePhase).toHaveBeenCalledWith(GAME, QUESTIONS[0], QUESTIONS.length)
    expect(result!.game).toEqual(settled)
    expect(result!.snapshot.phaseStartedAt).toBe('2026-01-01T00:00:30.000Z')
    expect(result!.currentQuestion).toEqual(QUESTIONS[0])
    expect(result!.totalQuestions).toBe(1)
  })
})
```

- [ ] **Step 4: Run tests to verify they fail**

```bash
pnpm vitest run src/lib/realtime/game-state.test.ts
```

Expected: FAIL — cannot find `./game-state`.

- [ ] **Step 5: Implement the snapshot builder**

Create `src/lib/realtime/game-state.ts`:

```ts
import { getGameById, getQuestionsForQuiz, getParticipantsWithAnswerStatus } from '@/db/game-queries'
import { maybeAdvancePhase } from '@/db/game-mutations'
import { rankParticipants } from '@/lib/game-scoring'
import type { GameSession } from '@/db/schema'
import type { GameSnapshot } from './types'

type Question = Awaited<ReturnType<typeof getQuestionsForQuiz>>[number]

export type GameSnapshotResult = {
  snapshot: GameSnapshot
  game: GameSession
  currentQuestion: Question | undefined
  totalQuestions: number
}

// The single read path for game state — used by the socket connect handler,
// syncGameById, and (indirectly) every POST mutation. Runs maybeAdvancePhase
// first, so any overdue phase settles before the snapshot is built; this is
// also the restart-recovery fallback (in-memory timers die with the process,
// but the next connect/mutation settles the phase from phaseStartedAt in DB).
export async function buildGameSnapshot(gameId: string): Promise<GameSnapshotResult | null> {
  const game = await getGameById(gameId)
  if (!game) return null

  const allQuestions = await getQuestionsForQuiz(game.quizId)
  const currentQuestion = allQuestions[game.currentQuestionIndex]

  const settled = await maybeAdvancePhase(game, currentQuestion, allQuestions.length)

  const list = await getParticipantsWithAnswerStatus(
    settled.id,
    currentQuestion && (settled.status === 'question' || settled.status === 'reveal') ? currentQuestion.id : null
  )
  const active = list.filter((p) => !p.kickedAt)

  const snapshot: GameSnapshot = {
    status: settled.status as GameSnapshot['status'],
    currentQuestionIndex: settled.currentQuestionIndex,
    totalQuestions: allQuestions.length,
    phaseStartedAt: settled.phaseStartedAt.toISOString(),
    participants: list.map((p) => ({
      id: p.id,
      nickname: p.nickname,
      score: p.score,
      streak: p.streak,
      answered: p.answered,
      kickedAt: p.kickedAt ? p.kickedAt.toISOString() : null,
    })),
  }

  if (currentQuestion && settled.status !== 'waiting') {
    snapshot.question = {
      id: currentQuestion.id,
      text: currentQuestion.text,
      options: currentQuestion.options,
      timeLimit: currentQuestion.timeLimit,
    }
  }

  if (settled.status === 'reveal' || settled.status === 'podium') {
    if (currentQuestion) snapshot.correctIndex = currentQuestion.correctIndex
    snapshot.leaderboard = rankParticipants(
      active.map((p) => ({ id: p.id, nickname: p.nickname, score: p.score, totalAnswerMs: p.totalAnswerMs }))
    )
  }

  return { snapshot, game: settled, currentQuestion, totalQuestions: allQuestions.length }
}
```

- [ ] **Step 6: Run the full test suite**

```bash
pnpm test
```

Expected: all PASS (new game-state tests + everything pre-existing, including the old state-route tests which still exist until Task 7).

- [ ] **Step 7: Commit**

```bash
git add src/lib/realtime/game-state.ts src/lib/realtime/game-state.test.ts src/db/game-queries.ts src/db/game-mutations.ts
git commit -m "feat(live): buildGameSnapshot — shared snapshot builder with lazy-transition fallback"
```

---

### Task 3: Sync engine — `syncGameById` + `phaseTimerSpec`

**Files:**
- Create: `src/lib/realtime/sync.ts`
- Test: `src/lib/realtime/sync.test.ts`

**Interfaces:**
- Consumes: `getIo` from `./io`, `ensurePhaseTimer`/`PhaseTimerSpec` from `./timers`, `buildGameSnapshot` from `./game-state`, `REVEAL_TO_PODIUM_MS` from `./types`.
- Produces:
  - `syncGameById(gameId: string): Promise<void>` — the one entry point POST routes, the connect handler, and timer fires all call.
  - `phaseTimerSpec(game, currentQuestion, totalQuestions): PhaseTimerSpec | null` (exported for tests).
  - Socket events emitted to room `gameId`: `'game:state'` with a `GameSnapshot`, `'game:error'` with `{ reason: 'ended' }`.

- [ ] **Step 1: Write the failing sync tests**

Create `src/lib/realtime/sync.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const buildGameSnapshot = vi.fn()
vi.mock('./game-state', () => ({
  buildGameSnapshot: (...a: unknown[]) => buildGameSnapshot(...a),
}))

const emit = vi.fn()
const to = vi.fn(() => ({ emit }))
const timersMap = new Map()
vi.mock('./io', () => ({
  getIo: () => ({ to }),
  getPhaseTimers: () => timersMap,
}))

const { syncGameById, phaseTimerSpec } = await import('./sync')

const BASE_GAME = {
  id: 'g1',
  status: 'question',
  currentQuestionIndex: 0,
  phaseStartedAt: new Date('2026-01-01T00:00:00.000Z'),
}
const QUESTION = { id: 'q_1', timeLimit: 30 }

function snapshotResult(overrides: Record<string, unknown> = {}) {
  return {
    snapshot: { status: 'question', participants: [] },
    game: BASE_GAME,
    currentQuestion: QUESTION,
    totalQuestions: 3,
    ...overrides,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:10.000Z')) // 10s into the question
  buildGameSnapshot.mockReset()
  to.mockClear()
  emit.mockClear()
})

afterEach(() => {
  for (const { timer } of timersMap.values()) clearTimeout(timer)
  timersMap.clear()
  vi.useRealTimers()
})

describe('phaseTimerSpec', () => {
  it('arms the question deadline from phaseStartedAt + timeLimit (plus epsilon)', () => {
    const spec = phaseTimerSpec(BASE_GAME, QUESTION, 3)
    expect(spec!.phaseKey).toBe('question:0')
    // 30s limit, 10s elapsed → 20s remaining + 250ms epsilon
    expect(spec!.delayMs).toBe(20_000 + 250)
  })

  it('clamps an overdue question deadline to the epsilon', () => {
    const spec = phaseTimerSpec({ ...BASE_GAME, phaseStartedAt: new Date('2026-01-01T00:00:00.000Z') }, { id: 'q_1', timeLimit: 5 }, 3)
    expect(spec!.delayMs).toBe(250)
  })

  it('arms the podium auto-advance only on the final reveal', () => {
    const finalReveal = { ...BASE_GAME, status: 'reveal', currentQuestionIndex: 2, phaseStartedAt: new Date('2026-01-01T00:00:09.000Z') }
    const spec = phaseTimerSpec(finalReveal, QUESTION, 3)
    expect(spec!.phaseKey).toBe('reveal:2')
    // 5s lingering, 1s elapsed → 4s remaining + epsilon
    expect(spec!.delayMs).toBe(4_000 + 250)
  })

  it('returns null for waiting, podium, and non-final reveal', () => {
    expect(phaseTimerSpec({ ...BASE_GAME, status: 'waiting' }, QUESTION, 3)).toBeNull()
    expect(phaseTimerSpec({ ...BASE_GAME, status: 'podium' }, QUESTION, 3)).toBeNull()
    expect(phaseTimerSpec({ ...BASE_GAME, status: 'reveal', currentQuestionIndex: 0 }, QUESTION, 3)).toBeNull()
  })
})

describe('syncGameById', () => {
  it('broadcasts the snapshot to the game-id room', async () => {
    buildGameSnapshot.mockResolvedValue(snapshotResult())
    await syncGameById('g1')
    expect(to).toHaveBeenCalledWith('g1')
    expect(emit).toHaveBeenCalledWith('game:state', snapshotResult().snapshot)
  })

  it('emits game:error and clears the timer when the game is gone', async () => {
    buildGameSnapshot.mockResolvedValue(snapshotResult())
    await syncGameById('g1')
    expect(timersMap.has('g1')).toBe(true)

    buildGameSnapshot.mockResolvedValue(null)
    await syncGameById('g1')
    expect(emit).toHaveBeenCalledWith('game:error', { reason: 'ended' })
    expect(timersMap.has('g1')).toBe(false)
  })

  it('re-syncs when the phase deadline fires (the timer never flips state itself)', async () => {
    buildGameSnapshot.mockResolvedValue(snapshotResult())
    await syncGameById('g1')
    expect(buildGameSnapshot).toHaveBeenCalledTimes(1)

    // Deadline passes → timer fires → syncGameById runs again, and
    // maybeAdvancePhase (inside buildGameSnapshot) performs the actual flip.
    await vi.advanceTimersByTimeAsync(20_000 + 250)
    expect(buildGameSnapshot).toHaveBeenCalledTimes(2)
  })

  it('does not arm a timer for phases without a deadline', async () => {
    buildGameSnapshot.mockResolvedValue(snapshotResult({ game: { ...BASE_GAME, status: 'waiting' } }))
    await syncGameById('g1')
    expect(timersMap.has('g1')).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm vitest run src/lib/realtime/sync.test.ts
```

Expected: FAIL — cannot find `./sync`.

- [ ] **Step 3: Implement the sync engine**

Create `src/lib/realtime/sync.ts`:

```ts
import type { GameSession } from '@/db/schema'
import { getIo } from './io'
import { ensurePhaseTimer, type PhaseTimerSpec } from './timers'
import { buildGameSnapshot } from './game-state'
import { REVEAL_TO_PODIUM_MS } from './types'

// Fire slightly after the true deadline so the elapsed-time check inside
// maybeAdvancePhase (the single flip engine) is guaranteed to pass.
const TIMER_EPSILON_MS = 250

export function phaseTimerSpec(
  game: Pick<GameSession, 'status' | 'currentQuestionIndex' | 'phaseStartedAt'>,
  currentQuestion: { timeLimit: number } | undefined,
  totalQuestions: number
): PhaseTimerSpec | null {
  if (game.status === 'question' && currentQuestion) {
    const deadline = game.phaseStartedAt.getTime() + currentQuestion.timeLimit * 1000
    return {
      phaseKey: `question:${game.currentQuestionIndex}`,
      delayMs: Math.max(0, deadline - Date.now()) + TIMER_EPSILON_MS,
    }
  }
  const isLast = game.currentQuestionIndex + 1 >= totalQuestions
  if (game.status === 'reveal' && isLast) {
    const deadline = game.phaseStartedAt.getTime() + REVEAL_TO_PODIUM_MS
    return {
      phaseKey: `reveal:${game.currentQuestionIndex}`,
      delayMs: Math.max(0, deadline - Date.now()) + TIMER_EPSILON_MS,
    }
  }
  return null
}

// The one entry point every event funnels through: POST mutations, socket
// connects, and timer fires all call syncGameById. It settles overdue phases
// (maybeAdvancePhase inside buildGameSnapshot), broadcasts one shared snapshot
// to the game's room, and (re-)arms the phase deadline timer.
export async function syncGameById(gameId: string): Promise<void> {
  const io = getIo()
  const result = await buildGameSnapshot(gameId)
  if (!result) {
    ensurePhaseTimer(gameId, null, () => {})
    io?.to(gameId).emit('game:error', { reason: 'ended' })
    return
  }
  io?.to(gameId).emit('game:state', result.snapshot)
  ensurePhaseTimer(gameId, phaseTimerSpec(result.game, result.currentQuestion, result.totalQuestions), () => {
    void syncGameById(gameId)
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm vitest run src/lib/realtime/sync.test.ts
```

Expected: 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/realtime/sync.ts src/lib/realtime/sync.test.ts
git commit -m "feat(live): syncGameById — snapshot broadcast + phase deadline timers"
```

---

### Task 4: Connection wiring — `connection.ts` + `instrumentation.ts`

**Files:**
- Create: `src/lib/realtime/connection.ts`
- Create: `src/instrumentation.ts`
- Test: `src/lib/realtime/connection.test.ts`

**Interfaces:**
- Consumes: `getIo` from `./io`, `syncGameById` from `./sync`, `getGameByCode` from `@/db/game-queries`.
- Produces: `wireRealtime(): void` — registers the Socket.IO connection handler. Socket handshake contract: client sends `auth: { code: string }`; server joins the socket to room `game.id` and triggers a sync. Emits `'game:error' { reason: 'not-found' }` directly to the socket for bad/missing codes.

- [ ] **Step 1: Write the failing connection tests**

Create `src/lib/realtime/connection.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getGameByCode = vi.fn()
vi.mock('@/db/game-queries', () => ({
  getGameByCode: (...a: unknown[]) => getGameByCode(...a),
}))

const syncGameById = vi.fn()
vi.mock('./sync', () => ({
  syncGameById: (...a: unknown[]) => syncGameById(...a),
}))

type ConnectionHandler = (socket: unknown) => Promise<void>
let connectionHandler: ConnectionHandler | null = null
let currentIo: { on: (ev: string, cb: ConnectionHandler) => void } | null = {
  on: (_ev, cb) => {
    connectionHandler = cb
  },
}
vi.mock('./io', () => ({
  getIo: () => currentIo,
}))

process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test'

const { wireRealtime } = await import('./connection')

function makeSocket(code?: unknown) {
  return {
    handshake: { auth: code === undefined ? {} : { code } },
    join: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(),
  }
}

beforeEach(() => {
  getGameByCode.mockReset()
  syncGameById.mockReset()
  connectionHandler = null
})

describe('wireRealtime', () => {
  it('does nothing when no io server exists (build/test contexts)', () => {
    currentIo = null
    expect(() => wireRealtime()).not.toThrow()
    currentIo = { on: (_ev, cb) => (connectionHandler = cb) }
  })

  it('rejects a connection with no code', async () => {
    wireRealtime()
    const socket = makeSocket()
    await connectionHandler!(socket)
    expect(socket.emit).toHaveBeenCalledWith('game:error', { reason: 'not-found' })
    expect(socket.disconnect).toHaveBeenCalledWith(true)
    expect(socket.join).not.toHaveBeenCalled()
  })

  it('rejects a connection for an unknown code', async () => {
    getGameByCode.mockResolvedValue(null)
    wireRealtime()
    const socket = makeSocket('000000')
    await connectionHandler!(socket)
    expect(socket.emit).toHaveBeenCalledWith('game:error', { reason: 'not-found' })
    expect(socket.disconnect).toHaveBeenCalledWith(true)
  })

  it('joins the game-id room (not the code) and syncs', async () => {
    getGameByCode.mockResolvedValue({ id: 'g1', code: '854123' })
    wireRealtime()
    const socket = makeSocket('854123')
    await connectionHandler!(socket)
    expect(socket.join).toHaveBeenCalledWith('g1')
    expect(syncGameById).toHaveBeenCalledWith('g1')
    expect(socket.disconnect).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm vitest run src/lib/realtime/connection.test.ts
```

Expected: FAIL — cannot find `./connection`.

- [ ] **Step 3: Implement the connection handler**

Create `src/lib/realtime/connection.ts`:

```ts
import type { Socket } from 'socket.io'
import { getIo } from './io'
import { syncGameById } from './sync'
import { getGameByCode } from '@/db/game-queries'

// Rooms are keyed by game id, not code: codes are recycled once a game hits
// podium, so a code-keyed room could leak a new game's broadcasts to sockets
// still attached to the finished game.
async function handleConnection(socket: Socket): Promise<void> {
  const code = typeof socket.handshake.auth?.code === 'string' ? socket.handshake.auth.code : null
  const game = code ? await getGameByCode(code) : null
  if (!game) {
    socket.emit('game:error', { reason: 'not-found' })
    socket.disconnect(true)
    return
  }
  await socket.join(game.id)
  // Sends the initial snapshot (to the whole room — idempotent) and re-arms
  // the phase timer; after a server restart this is what recovers the game.
  await syncGameById(game.id)
}

export function wireRealtime(): void {
  const io = getIo()
  if (!io) return // next build / vitest — no socket server exists
  // Return the promise (Socket.IO ignores it; the tests await it).
  io.on('connection', (socket) => handleConnection(socket))
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm vitest run src/lib/realtime/connection.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 5: Create `src/instrumentation.ts`**

```ts
// Runs once when the Next.js server instance boots (inside Next's compiled
// context — unlike server.mjs, this can import TS/drizzle modules). server.mjs
// sets globalThis.__quezIo before app.prepare(), so the io server is already
// there when register() runs.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { wireRealtime } = await import('@/lib/realtime/connection')
  wireRealtime()
}
```

- [ ] **Step 6: Run the full suite + lint**

```bash
pnpm test && pnpm lint
```

Expected: all PASS. (`wireRealtime` no-ops when `getIo()` is null, so instrumentation is harmless in test/build contexts.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/realtime/connection.ts src/lib/realtime/connection.test.ts src/instrumentation.ts
git commit -m "feat(live): socket connection handler wired via instrumentation"
```

---

### Task 5: Broadcast from the POST mutation routes

**Files:**
- Modify: `src/app/api/games/[code]/join/route.ts`
- Modify: `src/app/api/games/[code]/start/route.ts`
- Modify: `src/app/api/games/[code]/answer/route.ts`
- Modify: `src/app/api/games/[code]/advance/route.ts`
- Modify: `src/app/api/games/[code]/kick/route.ts`
- Test: the five colocated `route.test.ts` files

**Interfaces:**
- Consumes: `syncGameById(gameId: string)` from `@/lib/realtime/sync` (Task 3).
- Produces: no new exports — every successful mutation now triggers a room broadcast (which also settles phases and re-arms timers).

- [ ] **Step 1: Add the sync call to each route**

In **all five** route files, add the import:

```ts
import { syncGameById } from '@/lib/realtime/sync'
```

Then insert the sync **after the mutation succeeds, before the success response**:

`join/route.ts` — after the `joinGame` result check:

```ts
  const result = await joinGame(game, nickname, sessionToken)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  await syncGameById(game.id)

  return NextResponse.json({ participantId: result.participant.id, nickname: result.participant.nickname })
```

`start/route.ts` — after the `startGame` result check:

```ts
  const result = await startGame(game.id)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  await syncGameById(game.id)

  return NextResponse.json({ ok: true })
```

`answer/route.ts` — after the `submitAnswer` result check (this is also what triggers the all-answered early flip, via `maybeAdvancePhase` inside the sync):

```ts
  const result = await submitAnswer(game, currentQuestion, participantId, sessionToken, selectedIndex)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  await syncGameById(game.id)

  return NextResponse.json({ ok: true })
```

`advance/route.ts` — after the `advanceGame` result check:

```ts
  const result = await advanceGame(game, allQuestions.length)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  await syncGameById(result.game.id)

  return NextResponse.json({ status: result.game.status })
```

`kick/route.ts` — after the `kickParticipant` check:

```ts
  const kicked = await kickParticipant(game.id, participantId)
  if (!kicked) return NextResponse.json({ error: 'Participant not found' }, { status: 404 })

  await syncGameById(game.id)

  return NextResponse.json({ ok: true })
```

- [ ] **Step 2: Add the sync mock + assertions to each route test**

In **all five** `route.test.ts` files, add this mock block next to the existing `vi.mock` blocks (before the `await import('./route')` line):

```ts
const syncGameById = vi.fn()
vi.mock('@/lib/realtime/sync', () => ({
  syncGameById: (...a: unknown[]) => syncGameById(...a),
}))
```

Add `syncGameById.mockReset()` to each file's `beforeEach`.

Then add assertions — all game fixtures in these files use `id: 'g1'`:

- `start/route.test.ts` → in `'starts the game'`: `expect(syncGameById).toHaveBeenCalledWith('g1')`; in `'propagates the error + status from startGame'`: `expect(syncGameById).not.toHaveBeenCalled()`.
- `join/route.test.ts` → in `'joins and returns the participant id + nickname'`: called with `'g1'`; in `'propagates the error + status from joinGame'`: not called.
- `answer/route.test.ts` → in `'scores a chosen answer'` **and** `'accepts a null selectedIndex (explicit no-answer) and never echoes correctness'`: called with `'g1'`; in `'propagates the error + status from submitAnswer'`: not called.
- `advance/route.test.ts` → in `'advances and returns the new status, passing the total question count'`: called with `'g1'`. **Also update that test's `advanceGame` success mock so its returned `game` object includes `id: 'g1'`** (the route now reads `result.game.id`). In `'propagates the error + status from advanceGame'`: not called.
- `kick/route.test.ts` → in `'kicks the participant'`: called with `'g1'`; in `'returns 404 when the participant does not belong to this game'`: not called.

- [ ] **Step 3: Run tests to verify they fail, then verify route edits make them pass**

```bash
pnpm vitest run "src/app/api/games"
```

Expected after test edits but before route edits: new assertions FAIL. After route edits: all PASS. (If you edited routes first, just confirm everything passes.)

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/games/[code]"
git commit -m "feat(live): broadcast a snapshot after every game mutation"
```

---

### Task 6: Custom server — `server.mjs`, scripts, next.config

**Files:**
- Create: `server.mjs` (repo root)
- Modify: `package.json` (scripts)
- Modify: `next.config.ts` (remove standalone)

**Interfaces:**
- Consumes: the `globalThis.__quezIo` contract from `src/lib/realtime/io.ts` (Task 1) and `src/instrumentation.ts` (Task 4).
- Produces: a bootable server — `node server.mjs` serves Next.js plus Socket.IO on the same port. `HOSTNAME`/`PORT` env respected (Railway injects `PORT`).

- [ ] **Step 1: Create `server.mjs`**

```js
import { createServer } from 'node:http'
import next from 'next'
import { Server } from 'socket.io'

const dev = process.env.NODE_ENV !== 'production'
const hostname = process.env.HOSTNAME || '0.0.0.0'
const port = parseInt(process.env.PORT || '3000', 10)

const httpServer = createServer()

// destroyUpgrade: false — engine.io must not kill upgrade requests it doesn't
// own (Next's dev HMR websocket shares this server).
const io = new Server(httpServer, { destroyUpgrade: false })

// Contract with src/lib/realtime/io.ts (getIo): set BEFORE app.prepare() so
// instrumentation.ts register() finds it. This file stays plain JS — it runs
// outside Next's compiler and cannot import TS modules.
globalThis.__quezIo = io

// httpServer passed so Next attaches its own upgrade handling (dev HMR).
const app = next({ dev, hostname, port, httpServer })
const handle = app.getRequestHandler()

app.prepare().then(() => {
  httpServer.on('request', (req, res) => {
    // engine.io answers /socket.io/* itself; without this guard Next would
    // also try to handle those requests and double-write the response.
    if (req.url && req.url.startsWith('/socket.io/')) return
    handle(req, res)
  })
  httpServer.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port} (${dev ? 'dev' : 'production'})`)
  })
})
```

- [ ] **Step 2: Update `package.json` scripts**

```json
  "scripts": {
    "dev": "node server.mjs",
    "build": "next build",
    "start": "NODE_ENV=production node server.mjs",
```

(leave the remaining scripts untouched).

- [ ] **Step 3: Remove standalone output from `next.config.ts`**

```ts
const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
};
```

- [ ] **Step 4: Verify dev boot + socket handshake**

```bash
pnpm dev &
sleep 8
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/          # expect 200
curl -s "http://localhost:3000/socket.io/?EIO=4&transport=polling"     # expect a payload starting with 0{"sid":
kill %1
```

Expected: homepage 200; the socket.io handshake returns `0{"sid":"..."}`. Also confirm the boot log shows `> Ready on http://0.0.0.0:3000 (dev)` and no instrumentation errors.

**HMR check (manual, dev running):** open any page, edit a component, confirm hot update applies. Contingency if HMR websocket fails: the `httpServer` option + `destroyUpgrade: false` above is the fix for exactly this — if it still fails, check the browser console for the failing upgrade URL before changing anything.

- [ ] **Step 5: Verify production boot**

```bash
pnpm build && pnpm start &
sleep 8
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/          # expect 200
kill %1
```

Expected: build succeeds without `output: standalone` warnings; production server boots and serves.

- [ ] **Step 6: Commit**

```bash
git add server.mjs package.json next.config.ts
git commit -m "feat(live): custom server with Socket.IO attached"
```

---

### Task 7: Client — `useGameSocket` hook, view swap, delete polling

**Files:**
- Create: `src/lib/realtime/snapshot-view.ts`
- Test: `src/lib/realtime/snapshot-view.test.ts`
- Create: `src/hooks/useGameSocket.ts`
- Modify (imports only): `src/components/game/HostGameView.tsx`, `StudentGameView.tsx`, `StudentWaitingRoom.tsx`, `HostWaitingRoom.tsx`, `HostPodium.tsx`, `StudentPodium.tsx`, `StudentReveal.tsx`, `HostReveal.tsx`, `StudentQuestionLive.tsx`, `HostQuestionLive.tsx`
- Delete: `src/hooks/useGamePolling.ts`, `src/app/api/games/[code]/state/route.ts`, `src/app/api/games/[code]/state/route.test.ts`

**Interfaces:**
- Consumes: `GameSnapshot`, `GameErrorReason`, `GameLeaderboardEntry`, `GameQuestionView` from `@/lib/realtime/types`; socket events `'game:state'` / `'game:error'` (Tasks 3–4).
- Produces:
  - `snapshot-view.ts`: `snapshotToView(snapshot: GameSnapshot, participantId: string | null): GameStateView`, plus `GameStateView` and `GameParticipantView` types (identical shapes to the old `useGamePolling` exports).
  - `useGameSocket(code: string, participantId?: string | null): { state: GameStateView | null; error: string | null }` — drop-in replacement for `useGamePolling`, re-exporting all four types the components import.

- [ ] **Step 1: Write the failing snapshot-view tests**

Create `src/lib/realtime/snapshot-view.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { snapshotToView } from './snapshot-view'
import type { GameSnapshot } from './types'

const SNAPSHOT: GameSnapshot = {
  status: 'question',
  currentQuestionIndex: 0,
  totalQuestions: 3,
  phaseStartedAt: '2026-01-01T00:00:00.000Z',
  participants: [
    { id: 'p1', nickname: 'Ana', score: 100, streak: 2, answered: true, kickedAt: null },
    { id: 'p2', nickname: 'Bad', score: 0, streak: 0, answered: false, kickedAt: '2026-01-01T00:01:00.000Z' },
  ],
  question: { id: 'q_1', text: 'Q1', options: ['A', 'B'], timeLimit: 30 },
}

describe('snapshotToView', () => {
  it('filters kicked participants out of the roster', () => {
    const view = snapshotToView(SNAPSHOT, null)
    expect(view.participants).toEqual([{ id: 'p1', nickname: 'Ana', score: 100, answered: true }])
  })

  it('derives "you" from the full list — a kicked participant still finds themselves', () => {
    const view = snapshotToView(SNAPSHOT, 'p2')
    expect(view.you).toEqual({
      id: 'p2',
      nickname: 'Bad',
      score: 0,
      streak: 0,
      kickedAt: '2026-01-01T00:01:00.000Z',
    })
    expect(view.participants.find((p) => p.id === 'p2')).toBeUndefined()
  })

  it('returns you: null without a participantId or for an unknown id', () => {
    expect(snapshotToView(SNAPSHOT, null).you).toBeNull()
    expect(snapshotToView(SNAPSHOT, 'ghost').you).toBeNull()
  })

  it('passes status, indices, question, correctIndex, and leaderboard through', () => {
    const reveal: GameSnapshot = {
      ...SNAPSHOT,
      status: 'reveal',
      correctIndex: 1,
      leaderboard: [{ id: 'p1', nickname: 'Ana', score: 100, totalAnswerMs: 5000, rank: 1 }],
    }
    const view = snapshotToView(reveal, 'p1')
    expect(view.status).toBe('reveal')
    expect(view.question).toEqual(SNAPSHOT.question)
    expect(view.correctIndex).toBe(1)
    expect(view.leaderboard).toEqual(reveal.leaderboard)
    expect(view.phaseStartedAt).toBe('2026-01-01T00:00:00.000Z')
    expect(view.totalQuestions).toBe(3)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm vitest run src/lib/realtime/snapshot-view.test.ts
```

Expected: FAIL — cannot find `./snapshot-view`.

- [ ] **Step 3: Implement `snapshot-view.ts`**

Create `src/lib/realtime/snapshot-view.ts`:

```ts
import type { GameLeaderboardEntry, GameQuestionView, GameSnapshot, GameStatus } from './types'

export type GameParticipantView = { id: string; nickname: string; score: number; answered: boolean }

export type GameStateView = {
  status: GameStatus
  currentQuestionIndex: number
  totalQuestions: number
  phaseStartedAt: string
  participants: GameParticipantView[]
  you: { id: string; nickname: string; score: number; streak: number; kickedAt: string | null } | null
  question?: GameQuestionView
  correctIndex?: number
  leaderboard?: GameLeaderboardEntry[]
}

// The room broadcast is one shared payload; each client derives its own view.
// "you" resolves from the FULL list (kicked included) so a kicked student
// still sees their removal screen, while the visible roster excludes them.
export function snapshotToView(snapshot: GameSnapshot, participantId: string | null): GameStateView {
  const you = participantId ? (snapshot.participants.find((p) => p.id === participantId) ?? null) : null
  return {
    status: snapshot.status,
    currentQuestionIndex: snapshot.currentQuestionIndex,
    totalQuestions: snapshot.totalQuestions,
    phaseStartedAt: snapshot.phaseStartedAt,
    participants: snapshot.participants
      .filter((p) => !p.kickedAt)
      .map((p) => ({ id: p.id, nickname: p.nickname, score: p.score, answered: p.answered })),
    you: you
      ? { id: you.id, nickname: you.nickname, score: you.score, streak: you.streak, kickedAt: you.kickedAt }
      : null,
    question: snapshot.question,
    correctIndex: snapshot.correctIndex,
    leaderboard: snapshot.leaderboard,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm vitest run src/lib/realtime/snapshot-view.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 5: Create the hook**

Create `src/hooks/useGameSocket.ts`:

```ts
'use client'

import { useEffect, useState } from 'react'
import { io as createSocket } from 'socket.io-client'
import type { GameErrorReason, GameSnapshot } from '@/lib/realtime/types'
import { snapshotToView, type GameStateView } from '@/lib/realtime/snapshot-view'

// Components import these from the hook module, same as they did from
// useGamePolling — keep all four names exported here.
export type { GameStateView, GameParticipantView } from '@/lib/realtime/snapshot-view'
export type { GameLeaderboardEntry, GameQuestionView } from '@/lib/realtime/types'

export function useGameSocket(code: string, participantId?: string | null) {
  const [state, setState] = useState<GameStateView | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const socket = createSocket({ auth: { code } })

    socket.on('game:state', (snapshot: GameSnapshot) => {
      setError(null)
      setState(snapshotToView(snapshot, participantId ?? null))
    })
    socket.on('game:error', ({ reason }: { reason: GameErrorReason }) => {
      setError(reason === 'not-found' ? 'Game not found' : 'The host ended this quiz')
    })
    socket.on('connect_error', () => setError('Connection lost, retrying...'))
    socket.on('disconnect', (reason) => {
      // Socket.IO reconnects on its own; surface the blip like polling did.
      if (reason !== 'io client disconnect') setError('Connection lost, retrying...')
    })

    return () => {
      socket.disconnect()
    }
  }, [code, participantId])

  return { state, error }
}
```

- [ ] **Step 6: Swap the imports in the ten components**

```bash
cd /home/saul/Desktop/sideProjects/QuEZ
grep -rl "@/hooks/useGamePolling" src/components | xargs sed -i "s|@/hooks/useGamePolling|@/hooks/useGameSocket|g"
sed -i "s|useGamePolling(|useGameSocket(|g; s|import { useGamePolling }|import { useGameSocket }|g" src/components/game/HostGameView.tsx src/components/game/StudentGameView.tsx
grep -rn "useGamePolling" src/ || echo "clean"
```

Expected final grep: `clean`. (Type-only importers — `StudentWaitingRoom`, `HostWaitingRoom`, `HostPodium`, `StudentPodium`, `StudentReveal`, `HostReveal`, `StudentQuestionLive`, `HostQuestionLive` — only need the path swap; the two views also swap the function name.)

- [ ] **Step 7: Delete the polling artifacts**

```bash
git rm src/hooks/useGamePolling.ts
git rm -r "src/app/api/games/[code]/state"
```

(The state-route test coverage was ported to `game-state.test.ts` in Task 2.)

- [ ] **Step 8: Full suite, lint, build**

```bash
pnpm test && pnpm lint && pnpm build
```

Expected: all PASS; build succeeds with no references to the deleted modules.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(live): useGameSocket replaces polling; delete state route"
```

---

### Task 8: Dockerfile rework (no standalone)

**Files:**
- Modify: `Dockerfile`

**Interfaces:**
- Consumes: `server.mjs` (Task 6), the non-standalone `.next` build output.
- Produces: a Railway-deployable image running `node server.mjs`.

- [ ] **Step 1: Replace the Dockerfile**

```dockerfile
# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
# corepack picks up pnpm@10.33.0 from the packageManager field in package.json
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# React Compiler + Turbopack memory headroom; uncomment if the build OOMs:
# ENV NODE_OPTIONS=--max-old-space-size=4096
RUN pnpm build && rm -rf .next/cache

# The custom server (server.mjs) is incompatible with output:'standalone', so
# the runner needs real node_modules — production-only to keep the image sane.
FROM base AS prod-deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# server.mjs reads HOSTNAME/PORT from the environment; Railway injects PORT
# at runtime and it overrides the default below.
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs
COPY --from=prod-deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --chown=nextjs:nodejs package.json server.mjs ./
USER nextjs
EXPOSE 3000
CMD ["node", "server.mjs"]
```

- [ ] **Step 2: Verify the image builds and boots**

```bash
docker build -t quez-socketio .
docker run --rm -e DATABASE_URL="$DATABASE_URL" -p 3000:3000 quez-socketio &
sleep 8
curl -s "http://localhost:3000/socket.io/?EIO=4&transport=polling"   # expect 0{"sid":...
docker stop $(docker ps -q --filter ancestor=quez-socketio)
```

If Docker is not available locally, fall back to `pnpm build && pnpm start` (already verified in Task 6) and treat the first Railway deploy as the image verification — watch the deploy logs for the `> Ready on` line.

- [ ] **Step 3: Commit**

```bash
git add Dockerfile
git commit -m "build: Dockerfile for custom server (drop standalone output)"
```

---

### Task 9: Manual end-to-end verification

**Files:** none (verification only).

**Interfaces:** consumes the whole feature. Same rationale as prior live-mode specs: jsdom has no real sockets or timers, so the full flow is verified manually.

- [ ] **Step 1: Two-browser game flow (dev)**

Run `pnpm dev`. Host browser: dashboard → quiz → "Host Live". Two student browsers/incognito: `/join/[code]`.

Verify:
- Waiting-room roster updates **instantly** when a student joins (no 1.5s lag).
- "Start" pushes the question to all screens at once.
- Both students answer → reveal flips **immediately** (all-answered early flip), not at timer expiry.
- Next question: one student answers, the other doesn't → reveal at timer expiry; non-answerer scored 0 with streak reset.
- Host answered-count ticks up the moment each student submits.
- Kick a student → their screen shows "removed by host".
- Last question's reveal auto-advances to podium after ~5s with no host click; host "Show podium" skips early on a re-run.
- Host music + student sound cues behave as before.

- [ ] **Step 2: Restart recovery**

Mid-question (before the timer expires), Ctrl+C the dev server and restart `pnpm dev`.

Verify: student/host screens show "Connection lost, retrying..." then recover on their own; the question deadline still lands at the original time (phaseStartedAt-based re-arm); the game continues to reveal/podium normally.

- [ ] **Step 3: Error paths**

- `/game/BADCODE` and `/join/BADCODE` → "Game not found".
- Delete the quiz mid-game (second host tab) → players see "The host ended this quiz".

- [ ] **Step 4: Production smoke**

`pnpm build && pnpm start`, repeat one abbreviated game flow (join → start → answer → reveal → podium).

- [ ] **Step 5: Final commit / push**

```bash
pnpm test && pnpm lint
git status   # confirm clean or commit any stragglers
```

Then follow superpowers:finishing-a-development-branch (merge/PR decision belongs to the user).
