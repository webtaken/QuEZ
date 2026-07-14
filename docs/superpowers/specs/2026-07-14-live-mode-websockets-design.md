# Live Mode Realtime Transport: Polling → Socket.IO — Design

**Date:** 2026-07-14
**Status:** Approved
**Supersedes:** the "Transport" decision in
`docs/superpowers/specs/2026-07-12-kahoot-live-mode-design.md` (short-interval
polling, chosen for Vercel serverless). Everything else in that spec —
data model, scoring, routes, pages, sound/animation — stays as designed.

## Goal

Replace the 1.5s polling loop in live play mode with push-based realtime over
Socket.IO. The app now deploys to Railway as a single long-running Node
process (Docker, `ea56e14`), so the original serverless constraints (no
persistent connections, no server-side timers) no longer apply.

## Context

- Current transport: `useGamePolling` fetches `GET /api/games/[code]/state`
  every 1.5s; state transitions happen lazily inside that handler
  ("lazy transition on read").
- Railway keeps WebSocket connections open indefinitely (exempt from
  inactivity timeouts) and officially documents Socket.IO deployments.
- Next.js 16 constraint (from `node_modules/next/dist/docs`): a custom
  server and `output: "standalone"` **cannot be used together** — standalone
  does not trace custom server files. Adopting a custom server therefore
  forces a Dockerfile rework.

## Decisions

- **Transport:** Socket.IO attached to a custom Node server, in-process with
  Next.js. Chosen over SSE (works with standalone but unidirectional and
  hand-rolled heartbeats), plain `ws` (reinvents Socket.IO's reconnect/
  rooms/fallback), and a separate realtime service (needless second service
  plus cross-service auth at this scale). Socket.IO gives rooms keyed by game
  code, automatic reconnection, and long-polling fallback for hostile
  networks (school Wi-Fi).
- **Protocol: push-only.** The socket carries server→client state broadcasts
  only. All mutations (`join`, `start`, `answer`, `advance`, `kick`) remain
  the existing POST routes with their existing better-auth / `sessionToken`
  checks; each successful mutation broadcasts a fresh snapshot to the room.
  No auth on the socket itself — it only receives data every player is
  allowed to see.
- **Scale: single Railway instance.** In-memory `io` and timers, no Redis
  adapter. Multi-instance later = add `@socket.io/redis-adapter`, an isolated
  change.
- **Scope: transport swap only.** No new gameplay features; identical UX.
  Same phases, scoring, and views as the 2026-07-12 spec.
- **Server-side timers replace lazy transitions** as the primary phase-flip
  mechanism. The lazy-transition check survives as a restart-recovery
  fallback inside the snapshot builder.

## Architecture

### Custom server: `server.mjs` (repo root, plain JS)

~30 lines. Next's docs note the custom server file skips Next's compiler, so
it stays plain JS with no TS or build step:

1. Create `http.Server`.
2. Attach a Socket.IO `Server` to it.
3. Stash `io` on `globalThis` via the accessor in `src/lib/realtime/`.
4. `next({ dev, httpServer })` → `app.prepare()` → handle all HTTP requests
   with Next's request handler.

Script changes in `package.json`:

- `dev` → `node server.mjs` (dev mode, Turbopack enabled via the `next()`
  options).
- `start` → `NODE_ENV=production node server.mjs`.
- `build` → unchanged (`next build`).

### Game logic stays in TypeScript, inside Next's world

`server.mjs` cannot import Drizzle/TS modules. Instead, a new
`src/instrumentation.ts` (`register()` runs once at Next server boot, inside
Next's compiled context) grabs the `io` reference from `globalThis` and wires
the Socket.IO connection handler. All realtime logic lives in
`src/lib/realtime/`:

- `io.ts` — typed `globalThis` accessors for the `io` instance and the
  timers map. **Rule:** every cross-module mutable singleton goes through
  `globalThis`, because Next bundles `instrumentation.ts`, route handlers,
  and `server.mjs` as separate module graphs (module-scope state would
  silently duplicate). Same pattern as the common dev-db singleton.
- `game-state.ts` — snapshot builder + lazy-transition check, moved out of
  the deleted `state` route. Shared by the socket connect handler and the
  POST routes.
- `timers.ts` — phase-deadline scheduling (below).

### Connection flow

Handshake carries `{ code, participantId? }` (Socket.IO `auth` payload).
On connection the server:

1. Looks up the active game session by `code`; unknown code → emit
   `game:error` `{ reason: 'not-found' }` and disconnect.
2. Joins the socket to room `code`.
3. Builds a snapshot (running the lazy-transition fallback check) and emits
   it to the connecting socket.
4. Calls `ensurePhaseTimer(game)` to (re-)arm the current phase's deadline —
   this is what recovers timers after a server restart.

### Build & deploy changes

- `next.config.ts`: remove `output: "standalone"`.
- `Dockerfile`: runner stage now copies `.next/`, `public/`, `server.mjs`,
  and production-pruned `node_modules` (new prod-deps stage:
  `pnpm install --prod --frozen-lockfile`). Image grows roughly 150→500MB;
  acceptable on Railway. `CMD ["node", "server.mjs"]`. `HOSTNAME`/`PORT` env
  handling unchanged (Railway injects `PORT`).
- New dependencies: `socket.io` (server), `socket.io-client` (client).

## State machine: server-side timers

Phases and guards are unchanged from the 2026-07-12 spec
(`waiting → question → reveal → … → podium`, conditional `UPDATE … WHERE
status=…` keeps every flip race-safe). What changes is *who* drives the
clock:

- `start` / `advance` POST: flip status in DB, broadcast snapshot to the
  room, schedule `setTimeout(timeLimit)` for the question deadline.
- Deadline fires: backfill null answers for non-answerers (same backfill
  semantics as before), run the guarded `question → reveal` UPDATE,
  broadcast.
- `answer` POST: insert answer; if every active participant has now
  answered → cancel the timer, guarded early flip to reveal, broadcast;
  otherwise broadcast a fresh snapshot (there is no special answered-count
  event — every broadcast is a full snapshot).
- Final reveal → podium: 5-second server timer; the host's "Show podium"
  button remains an early skip. Same `WHERE status='reveal'` guard makes
  timer and button race-safe.
- Timers are held in a `globalThis` map keyed by game id;
  `ensurePhaseTimer(game)` is idempotent — it computes remaining time from
  `phaseStartedAt` in the DB and arms a timer only if none exists for that
  game+phase.

**Restart safety.** Railway deploys and crashes kill in-memory timers.
Recovery path: Socket.IO clients auto-reconnect → connection handler builds
a snapshot → the lazy-transition fallback flips any overdue phase →
`ensurePhaseTimer` re-arms the deadline. Because all state lives in
Postgres (`phaseStartedAt`, answers, scores), nothing is lost; a restart
shows up to players as a brief "Connection lost, retrying…" blip.

An improvement over polling: the question deadline now fires even if every
client disappears — reveal happens server-side without needing a poller to
land.

## Client changes

- New `src/hooks/useGameSocket.ts` replaces `useGamePolling`, keeping the
  same return shape `{ state, error }` so `/host/[code]` and `/game/[code]`
  views are untouched. Internals: `socket.io-client` with
  `{ code, participantId }` handshake auth, snapshot on connect, `state`
  events thereafter. `error` derives from `disconnect` / `connect_error` /
  `game:error` events; Socket.IO's own reconnection loop replaces the manual
  retry messaging.
- **One shared snapshot per room** — no per-socket personalization.
  `participants` entries gain `streak` and `kickedAt`; the client derives
  `you = participants.find(p => p.id === participantId)`. Nothing secret
  leaks: scores/streaks are public on the leaderboard anyway, and
  `correctIndex` stays gated by status (present only in `reveal`/`podium`
  snapshots).
- Deletions: `src/hooks/useGamePolling.ts` and
  `GET /api/games/[code]/state` (snapshot builder moves to
  `src/lib/realtime/game-state.ts`).

## Error handling

- Unknown room code on connect → `game:error { reason: 'not-found' }` →
  client shows the existing "game not found" screen.
- Quiz deleted mid-game → FK cascade removes the session → next snapshot
  build finds nothing → `game:error { reason: 'ended' }` broadcast → clients
  show "the host ended this quiz."
- Kicked participant → next broadcast carries their `kickedAt` in
  `participants` → client shows "removed by host" and disconnects the
  socket.
- Server restart / deploy → automatic reconnect + lazy-check recovery
  (above).
- Duplicate answer POST → unchanged idempotency via the
  `(participantId, questionId)` unique index.
- Host closes tab mid-game → game holds its phase, but the question deadline
  still fires server-side, so students reach reveal; podium auto-advance on
  the last question also still fires.
- Broadcast emit failures are non-fatal: the DB write is the source of
  truth; a client that missed a broadcast converges on the next one or on
  reconnect.

## Testing

- `game-state.ts`: port the existing `state`-route tests to direct unit
  tests — lazy flip on elapsed time, all-answered flip, answer backfill for
  non-answerers.
- `timers.ts` with vitest fake timers: deadline flip fires, early
  all-answered flip cancels the pending timer, `ensurePhaseTimer` is
  idempotent and re-arms correctly from a mid-phase `phaseStartedAt`
  ("restart" simulation).
- Existing POST route tests keep passing; the `globalThis` io accessor is
  stubbed with a spy to assert each mutation broadcasts.
- Manual E2E (same rationale as prior specs — no real sockets/timers in
  jsdom): two browsers through the full flow, plus killing the server
  mid-question to verify reconnect + timer recovery.

## Out of scope

- Multi-instance scaling / Redis adapter (single Railway replica assumed).
- Any gameplay/UX changes — features, scoring, and views are identical to
  the 2026-07-12 spec.
- Moving mutations onto the socket (full socket protocol) — POSTs stay.
- Zombie-game cleanup (still an explicit non-goal, unchanged).
- Vercel compatibility — the custom server is Node-only by design; polling
  code is deleted, not kept as a fallback (Socket.IO's long-polling
  transport covers degraded networks).
