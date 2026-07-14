# Kahoot-style Live Play Mode — Design

**Date:** 2026-07-12
**Status:** Approved
**Updated:** 2026-07-13 — select-then-submit answering, host-side music, podium visibility fix (plan: `docs/superpowers/plans/2026-07-13-live-mode-refinements.md`)
**Updated:** 2026-07-14 — students see the full ranked leaderboard on every reveal (same plan, Task 6)

## Goal

Let a teacher (e.g. Juan) host a quiz live: students join a waiting room with a
nickname via a 6-digit room code or direct URL, the teacher pushes everyone
through questions in lockstep with a per-question timer, answers are scored
with a speed + streak formula, and the game ends on an animated top-3 podium.

## Decisions

- **Transport:** short-interval polling (`GET /api/games/[code]/state`), no
  websockets/third-party pub-sub. Fits Vercel serverless (stateless
  functions, no persistent connections) with zero new infra.
- **Student identity:** fully anonymous — nickname only, no better-auth
  login. A `sessionToken` persisted in `localStorage` lets a refreshed tab
  rejoin the same seat/score.
- **Host identity:** must own the quiz, verified via existing better-auth
  `getSession` pattern (same as `/api/quizzes/[id]` routes).
- **Scoring:** speed-scaled base points + consecutive-correct streak bonus
  (formula below). Ties broken by lowest total answer time across the game.
- **Pacing:** host-controlled between questions — after reveal+leaderboard
  the game advances when the host clicks "Next". Exception (2026-07-13): the
  *last* question's reveal auto-advances to podium after ~5s for everyone;
  the host's "Show podium" button remains as an early skip.
- **Reconnect vs late join:** a student with a matching `sessionToken` can
  rejoin mid-game after a refresh/disconnect. A *new* nickname cannot join
  once `status !== 'waiting'`.
- **Host moderation:** host can kick a participant from the waiting room or
  a live game.
- **Answering UX:** select-then-submit. A student taps an option to select it
  (highlighted, changeable), and a Submit button sends the final answer. Timer
  expiry auto-submits the current selection — or a null no-answer if nothing
  is selected. `answerMs` is measured at the submit moment.
- **Live music:** the quiz's `musicTrack` loops on the host device only —
  started from the "Start quiz" click (a user gesture, so autoplay-safe),
  stopped at podium, with a mute toggle. If the host refreshes mid-game,
  music resumes on the next "Next question" click. Student devices keep only
  the synthesized correct/wrong cues.
- **Join URL:** `/join/[code]` (code prefilled, student only types a
  nickname); `/join` alone supports manual code entry.
- **No new infra dependency:** correct/wrong sound cues are synthesized with
  the Web Audio API (oscillator beeps) instead of new licensed MP3 assets —
  zero licensing/attribution overhead, swappable later for real SFX using
  the same pattern as `public/music`.

## Data model

Three new tables in `src/db/schema.ts`, following existing conventions
(`uuid` PK, `pgTable`, cascade FKs, `index`/`uniqueIndex`).

```ts
export const gameSessions = pgTable('game_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  quizId: uuid('quiz_id').notNull().references(() => quizzes.id, { onDelete: 'cascade' }),
  hostUserId: text('host_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  code: text('code').notNull(), // 6-digit numeric string, e.g. "854123"
  status: text('status').notNull().default('waiting'), // waiting|question|reveal|podium
  currentQuestionIndex: integer('current_question_index').notNull().default(0),
  phaseStartedAt: timestamp('phase_started_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  endedAt: timestamp('ended_at'),
}, (t) => [index('game_sessions_code_idx').on(t.code)])

export const gameParticipants = pgTable('game_participants', {
  id: uuid('id').primaryKey().defaultRandom(),
  gameId: uuid('game_id').notNull().references(() => gameSessions.id, { onDelete: 'cascade' }),
  sessionToken: text('session_token').notNull(),
  nickname: text('nickname').notNull(),
  score: integer('score').notNull().default(0),
  streak: integer('streak').notNull().default(0),
  totalAnswerMs: integer('total_answer_ms').notNull().default(0),
  kickedAt: timestamp('kicked_at'),
  joinedAt: timestamp('joined_at').defaultNow().notNull(),
}, (t) => [
  index('game_participants_game_id_idx').on(t.gameId),
  index('game_participants_session_token_idx').on(t.sessionToken),
])

export const gameAnswers = pgTable('game_answers', {
  id: uuid('id').primaryKey().defaultRandom(),
  gameId: uuid('game_id').notNull().references(() => gameSessions.id, { onDelete: 'cascade' }),
  participantId: uuid('participant_id').notNull().references(() => gameParticipants.id, { onDelete: 'cascade' }),
  questionId: uuid('question_id').notNull().references(() => questions.id, { onDelete: 'cascade' }),
  selectedIndex: integer('selected_index'), // null = no answer / timed out
  answerMs: integer('answer_ms').notNull(),
  isCorrect: boolean('is_correct').notNull(),
  pointsAwarded: integer('points_awarded').notNull().default(0),
  answeredAt: timestamp('answered_at').defaultNow().notNull(),
}, (t) => [
  index('game_answers_game_question_idx').on(t.gameId, t.questionId),
  uniqueIndex('game_answers_participant_question_idx').on(t.participantId, t.questionId),
])
```

**Room codes** are not DB-unique (an ended game's code can be recycled).
Generation: pick a random 6-digit string, query for an existing session with
that code in a non-`ended` status, retry on the rare collision.

## State machine

`waiting → question → reveal → question[next] → … → podium(after last, terminal)`

`podium` is the terminal status — it stays `podium` and `endedAt` (set at the
same time) marks completion; there is no separate `ended` status value.

No background timer or cron exists (Vercel serverless has neither).
**Key mechanism: lazy transition on read.** `GET /api/games/[code]/state` is
polled by host and every student. On each call, if `status==='question'` and
either `elapsed ≥ timeLimit*1000` or every active (non-kicked) participant
has answered the current question, the handler runs a conditional
`UPDATE game_sessions SET status='reveal', phase_started_at=now() WHERE id=$1 AND status='question'`
before building its response. Whichever poller's request lands first
performs the flip; the `WHERE status='question'` guard makes concurrent
pollers race-safe (only one `UPDATE` succeeds). Any active participant
missing an answer row for the current question is backfilled at the same
time: `selectedIndex=null, isCorrect=false, pointsAwarded=0,
answerMs=timeLimit*1000` — this keeps streak resets and the tie-break sum
consistent for players who never answered.

Transitions:
- `waiting → question`: `POST /api/games/[code]/start`, host-only, requires
  ≥1 active participant. Sets `currentQuestionIndex=0`, `phaseStartedAt=now`.
- `question → reveal`: automatic (above).
- `reveal → question[i+1]` or `reveal → podium`: `POST
  /api/games/[code]/advance`, host-only. `podium` is chosen when
  `currentQuestionIndex` was the last question; it also sets `endedAt`.
- `reveal → podium` (automatic, last question only, added 2026-07-13): the
  same lazy-transition check in `state` also flips the *final* reveal to
  podium once `elapsed ≥ 5s`, via
  `UPDATE game_sessions SET status='podium', ended_at=now(), phase_started_at=now() WHERE id=$1 AND status='reveal'`
  — so students reach the podium even if the host never clicks. The host's
  "Show podium" button stays as an early skip; the `WHERE status='reveal'`
  guard makes the button and the lazy flip race-safe against each other.

## Scoring

```
remainingMs   = max(0, timeLimit*1000 - answerMs)
basePoints    = isCorrect ? round(1000 * (0.5 + 0.5 * remainingMs / (timeLimit*1000))) : 0
streakBonus   = 1 + min(priorStreak, 5) * 0.1   // capped at +50% from a 5-streak
pointsAwarded = isCorrect ? round(basePoints * streakBonus) : 0
```

`priorStreak` is the participant's streak *before* this question. After
scoring: `streak = isCorrect ? priorStreak + 1 : 0`, `score += pointsAwarded`,
`totalAnswerMs += answerMs`. An instant correct answer nets the full
`1000 × streakBonus`; a correct answer at the very last instant nets half
that. A wrong or missing answer scores 0 and resets the streak.

Leaderboard order: `score DESC, totalAnswerMs ASC` — a tie on score is
broken by whoever was faster across the whole game (satisfies "the
participant that answered first" from the user story, generalized across
all questions rather than just the tied one, which is more robust since
exact-score ties on a single question are rare under a continuous formula).

The formula lives in a pure function, e.g. `src/lib/game-scoring.ts:
computePoints(timeLimitMs, answerMs, isCorrect, priorStreak)`, so it can be
unit-tested without touching the DB.

## Routes

### API (`src/app/api/games/...`, mirrors existing `api/quizzes` conventions)

- `POST /api/games` — host-only (better-auth session + quiz ownership
  check). Body `{ quizId }`. Generates a code, inserts `game_sessions`,
  returns `{ code, gameId }`.
- `GET /api/games/[code]/state` — public, polled continuously. Runs the
  lazy-transition check, then returns a role-agnostic view: `{ status,
  currentQuestionIndex, totalQuestions, phaseStartedAt, timeLimit, question:
  { text, options } }` plus `correctIndex` only when `status` is `reveal` or
  `podium`, plus `participants: [{ id, nickname, score, answered, kickedAt
  }]`, plus a computed `leaderboard` when `reveal`/`podium`.
- `POST /api/games/[code]/join` — body `{ nickname, sessionToken? }`. Blocks
  with 409 on a case-insensitive nickname collision among active
  participants. Blocks with 403 if `status !== 'waiting'` and no existing
  `sessionToken` matches an active participant. Otherwise inserts (or
  returns the matching rejoin) and responds `{ participantId, sessionToken
  }`.
- `POST /api/games/[code]/start` — host-only, `waiting → question`.
- `POST /api/games/[code]/answer` — body `{ participantId, questionId,
  selectedIndex, sessionToken }`. The `sessionToken` must match the
  participant row (added 2026-07-12 to close an answer-spoofing gap —
  `participantId` alone is public via the state poll). Validates
  `status==='question'`, `questionId` matches the current question,
  participant is active. Computes points via
  `computePoints`, inserts `game_answers` (unique index makes a duplicate
  submit a no-op that returns the existing row), updates the participant's
  `score`/`streak`/`totalAnswerMs`.
- `POST /api/games/[code]/advance` — host-only, `reveal → question[next] |
  podium`.
- `POST /api/games/[code]/kick` — host-only, body `{ participantId }`, sets
  `kickedAt=now()`.

### Pages

- `/dashboard/quizzes/[id]` — add a "Host Live" button (enabled once the
  quiz has ≥1 question) that calls `POST /api/games` and routes to
  `/host/[code]`.
- `/host/[code]` — host-only (redirects to login/dashboard if session's
  user isn't `hostUserId`). Loops the quiz's `musicTrack` (if set) from the
  "Start" click until podium, with a mute toggle in the header (reuses
  `useQuizMusic`). Renders one of: waiting room (roster of
  nickname chips, room code + shareable `/join/[code]` link, per-participant
  kick button, "Start" button), live question (question text, live
  answered-count / total, timer bar — no answer options shown to the host),
  reveal + leaderboard (correct answer highlighted, per-participant
  correct/wrong, ranked list, "Next"/"Podium" button appears after a 2s
  minimum so students see the reveal before the host can skip it), podium
  (animated top 3 + ranked rest, "End" returns to dashboard).
- `/join` and `/join/[code]` — nickname entry form, code prefilled from the
  URL param or typed manually. On success, stores `sessionToken` in
  `localStorage` and routes to `/game/[code]`.
- `/game/[code]` — student view, same phase set as the host view: waiting
  room (nickname roster, "waiting for host"), live question (large tappable
  answer tiles, countdown ring computed client-side from `phaseStartedAt` +
  `timeLimit`; tap selects with a highlight and stays changeable until a
  Submit button — disabled while nothing is selected — sends the final
  answer and locks; timer expiry auto-submits the current selection, null
  if none), reveal (correct/wrong banner,
  synthesized Web Audio cue, points earned this round, streak indicator, and
  the FULL ranked leaderboard — every active participant, not a top-N cut —
  with the student's own row highlighted; added 2026-07-14, students
  previously saw no ranking until the podium), podium (final rank;
  confetti-style CSS animation if top 3).

A shared `useGamePolling(code, participantId?)` hook drives both `/host` and
`/game` views: polls `state` on an interval (~1.5s), exposes the parsed
state plus `isConnected`.

## Sound + animation

- Correct/wrong cues: short Web Audio API oscillator tones (e.g. rising
  two-note chime for correct, single low buzz for wrong) — no new audio
  files, no attribution bookkeeping. This intentionally reopens the "sound
  effects" item the quiz-music design explicitly left out of scope.
- Podium: CSS stagger rise/scale-in on the top-3 blocks using the
  already-installed `tw-animate-css`; no new animation dependency. The
  `.animate-fade-up-delay-*` classes only add `animation-delay` + initial
  `opacity: 0` — they must always be paired with `.animate-fade-up` (the
  class carrying the `animation` property), as in `Hero.tsx`; a delay class
  alone leaves the element permanently invisible.
- Host music: `useQuizMusic` (the existing single-player hook) wired into
  `HostGameView` — the host page server component already loads the quiz for
  its ownership check and passes `musicTrack` down.
- Visuals follow `DESIGN.md` tokens throughout (`accent-lime`, `success`,
  `destructive`, `warning`) — correct = `success`, wrong = `destructive`,
  countdown urgency = `warning`.

## Error handling

- Nickname collision in-room → `409`, join form shows inline error.
- Quiz deleted mid-game → FK cascade removes `game_sessions` →  next poll
  `404`s → client shows "the host ended this quiz."
- Kicked participant → their own `state` response includes `kickedAt` →
  client shows "removed by host" and stops polling.
- Host closes the tab mid-game → game simply stays in its current phase
  (no zombie-game cleanup job in this scope — explicit non-goal below).
- Duplicate answer submit (double-tap, retry) → unique index on
  `(participantId, questionId)` makes it idempotent, returns the original
  scored result rather than erroring.
- Invalid/unknown room code → `404` "game not found" page at `/join/[code]`
  and `/game/[code]`.
- Starting with 0 active participants → `400`, "Start" button disabled
  client-side too.

## Testing

- `computePoints()` — pure unit tests: instant answer, last-instant answer,
  wrong answer, streak cap at 5, no-answer/timeout case.
- Route handler tests (vitest, mocked `db`/`auth`, same pattern as
  `route.test.ts`) for `join` (fresh join, rejoin via `sessionToken`,
  nickname collision, late-join block), `start` (0-participant block),
  `answer` (duplicate submit idempotency, wrong-question rejection),
  `advance`/`kick` (host-only enforcement), and the lazy transition in
  `state` (timer-elapsed flip, all-answered flip, answer-backfill for
  non-answerers).
- Full poll → play → reveal → podium flow: manual verification (two
  browser windows/devices), same rationale as the music design doc (no real
  timers/audio in jsdom).

## Out of scope

- Zombie-game expiry/cleanup job for abandoned sessions.
- Pause/resume mid-question.
- Team play, multiple-choice-only is assumed (no new question types).
- Multi-answer (select-all-that-apply) questions — considered 2026-07-13 and
  deferred: every question keeps exactly one `correctIndex`, so multi-select
  UI has nothing to grade against without a schema + builder + AI-generation
  change.
- Music playback on student devices (host screen only, Kahoot-style).
- Tying anonymous student results to a user account / gradebook export.
- Editing quiz questions while a game is live.
- Per-question or per-quiz configurable `maxPoints`/streak-cap tuning UI —
  the 1000-point base and 5-streak cap are fixed constants for now.
- Real licensed SFX files (synthesized tones are the MVP; swappable later).
