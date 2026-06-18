# Chat History, Branching Edits & Quiz Versioning — Design

Date: 2026-06-18
Status: Approved design, ready for implementation plan
Area: `src/components/builder/ChatPanel.tsx`, `src/app/api/chat/route.ts`, `src/db/schema.ts`, `src/app/dashboard/quizzes/[id]/page.tsx`

## Problem

In the quiz builder, `ChatPanel` holds chat messages only in `useChat` in-memory state. On
page refresh the component remounts, `useChat` starts empty, and the entire conversation is
lost. "Save changes" persists the quiz (`PUT /api/quizzes/[id]`) but never the chat. Users also
want to edit earlier messages the way ChatGPT/Claude allow.

## Goals

1. Persist chat history per quiz so it survives refresh.
2. Edit a past user message with **branching** (keep old versions, ChatGPT-style `‹ 2/3 ›`).
3. Auto-save: every send + every assistant finish persists immediately, independent of the
   quiz "Save changes" button.
4. Secondary message features: delete (+subtree), regenerate, copy, timestamps, failed-send retry.
5. Lightweight **quiz versioning** (Tier 1): snapshot the quiz on each AI turn that changed it,
   with an explicit "Restore this version" action.

## Non-goals (deferred)

- Multiple named conversations / "new chat" per quiz.
- Full v0/Lovable versioning subsystem: separate version table, diff view, named/pinned
  versions, restore-any-arbitrary-state.
- Real-time multi-tab sync (last-write-wins is acceptable for v1).

## Decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Edit semantics | **Branching** (keep old branch, version switcher) | Matches ChatGPT/Claude; non-destructive |
| Quiz base on re-run | **Current quiz state** (`existingQuiz`, as today) | Simplest; preserves manual editor edits |
| Persistence trigger | **Auto-save** each turn, server-side | Survives refresh; "Save changes" stays quiz-only |
| Storage model | **Flat `chat_messages` table + `parentId` tree** | Real branching, queryable, scales |
| Quiz versioning | **Tier 1** — snapshot-on-node + explicit restore | Cheap (tiny jsonb), fixes branch/quiz mismatch, protects manual edits |
| Branch switch ↔ quiz | **(a) nav-only** + Restore button (not auto-restore) | Switching chat never surprises the editor |

## Environment

- `ai` v6, `@ai-sdk/react` v3, Next 16, `drizzle-orm` 0.45.
- `useChat({ id, messages })` hydrates initial state → load history into it.
- `setMessages` + `regenerate` = client edit/re-run path. SDK chat state is **linear** (single
  active path); **branching is implemented by us** (DB tree → derived active path → fed to `useChat`).
- Server `streamText(...).toUIMessageStreamResponse({ originalMessages, generateMessageId, onFinish })`
  is the server-side persistence point; `onFinish` receives the full final message list and the
  tool output (the new quiz).

## Data model

New table `chat_messages`:

```
id            uuid pk default random          -- server-generated, stable across reload
quizId        uuid → quizzes.id   cascade
userId        text → users.id     cascade     -- auth scope
role          text  ('user' | 'assistant')
parts         jsonb $type<UIMessagePart[]>    -- full AI-SDK parts (text + tool-updateQuiz)
parentId      uuid → chat_messages.id  null   -- self-ref; null = root
quizSnapshot  jsonb $type<QuizPayload> null   -- Tier 1: set ONLY on assistant turns that ran updateQuiz
createdAt     timestamp default now
```

Active-path pointer on the quiz: add `quizzes.activeLeafId uuid null`.

Indexes: `(quizId)`, `(parentId)`.

The greeting bubble stays a client-only constant — it is **not** stored.

## Tree & active-path mechanics

- **Active path** = walk `parentId` *up* from `activeLeafId` to root, reverse. This ordered list
  is what `useChat` renders.
- **Active child at a fork** = the child that is an ancestor of `activeLeafId` (derived; no extra
  column needed — the single leaf pointer fully determines the path).
- **Send new message:** parent = current leaf. Insert user msg → run → insert assistant msg →
  advance `activeLeafId` to the assistant. (Linear growth.)
- **Edit user message (branching):** insert a **new** user msg with the **same `parentId`** as the
  edited one (sibling = new branch); set it active; `regenerate`. Old sibling + subtree stay in DB.
- **Regenerate assistant:** new assistant sibling under the same parent user msg.
- **Delete message:** delete node + entire subtree (recursive/cascade via self-ref). If the active
  path crossed it, reseat `activeLeafId` to the deleted node's parent, then `descendToLeaf`.
- **Branch switcher `‹ n/m ›`** (shown on any node with ≥2 children):

```
clickSwitch(forkNode, dir):
  sibs   = children(forkNode) sorted by createdAt
  curIdx = index of the sib that is an ancestor of activeLeafId
  next   = sibs[curIdx + dir]
  leaf   = descendToLeaf(next)        # walk DOWN, newest child each step, to a leaf
  setActiveLeaf(leaf)                 # one DB write + setMessages(newPath); NO AI run
```

`descendToLeaf(n)`: `while n has children: n = newest child of n; return n`.

### Worked example

```
U1 "10-q biology quiz"
 │
A1 (builds quiz)                       Edit U2 → branch:
 │
U2 "make them harder"            U1
 │                                │
A2 (harder)                      A1 ──┬── U2  ── A2          (old branch)
                                      └── U2' ── A2'         (active)   ‹ 2/2 › at A1

                                 Regenerate A2':
                                 A1 ──┬── U2  ── A2
                                      └── U2' ──┬── A2'
                                                └── A2''     (active)   ‹ 2/2 › at U2'
```

## Quiz versioning & reconciliation (Tier 1)

The quiz is **one mutable document** (`quizzes` + `questions`), shown in the right editor. The
message *tree* branches; the quiz does not. The quiz changes **only** when an assistant turn runs
`updateQuiz`.

- **Every run sends current `existingQuiz` as base** — `/api/chat` receives whatever is in the
  editor right now (including manual edits). AI refines from there. Unchanged from today.
- **Branch switch is nav-only** — it runs nothing, so the quiz is untouched.
- **Snapshot:** when an assistant turn runs `updateQuiz`, `onFinish` writes the resulting quiz to
  that assistant row's `quizSnapshot`. Those rows are the implicit "versions".
- **Restore (explicit):** quiz-changing assistant messages render a `v{n}` badge + "Restore this
  version" button. Clicking writes `quizSnapshot` into the editor state (and through the existing
  `PUT /api/quizzes/[id]` save path). This is how an old branch's quiz becomes reachable.
- **Manual edits are safe:** restore is a button, never automatic — switching branches or editing
  text never clobbers the editor.

### Quiz timeline vs chat tree

| Step | Action | Runs `updateQuiz`? | Quiz doc after | Snapshot stored on |
|---|---|---|---|---|
| 1 | A1 | yes (base: empty) | Biology v1 | A1 |
| 2 | A2 "harder" | yes (base: Biology v1) | Biology-hard | A2 |
| 3 | edit U2→genetics, A2' | yes (base: Biology-hard = current) | Genetics | A2' |
| 4 | switch ‹ › back to branch 1 | no — nav only | Genetics (unchanged) | — |
| 5 | click "Restore" on A2 | n/a (restore) | Biology-hard | — |

Without restore (step 5), the editor at step 4 shows Genetics while the chat shows branch 1 —
the accepted trade-off of the nav-only model; the Restore button is the escape hatch.

## Persistence wiring

**Load (server → client):**
- `EditQuizPage` (server) fetches `chat_messages` for the quiz + `activeLeafId`, computes the
  active path, maps DB rows → `UIMessage[]`.
- Pass `initialMessages` down `QuizEditor → ChatPanel`; `useChat({ id: quiz.id, messages: initialMessages })`.

**Auto-save (server-side):**
- `/api/chat`: `streamText(...).toUIMessageStreamResponse({ originalMessages: messages, generateMessageId, onFinish: ({ messages }) => persistTurn(...) })`.
- `persistTurn` upserts the new user + assistant rows with correct `parentId`, advances
  `activeLeafId`, and writes `quizSnapshot` on the assistant row if `updateQuiz` ran.
- Request body gains `parentId` (the current leaf) so the server knows where to attach.
- Failed turns: `onFinish` only fires on success → DB stays consistent; nothing partial persisted.

**Quiz "Save changes"** stays quiz-only — untouched.

## API endpoints

- `POST /api/chat` — extended: send + regenerate, persists turn + snapshot. Body adds `parentId`.
- `PATCH /api/quizzes/[id]/active-leaf` — branch switch. Body `{ leafId }`.
- `DELETE /api/quizzes/[id]/messages/[mid]` — delete node + subtree, reseat `activeLeafId`.
- Edit = `POST /api/chat` inserting a user sibling under the shared parent, then streaming.
- Restore = reuses existing `PUT /api/quizzes/[id]` with the snapshot payload (no new endpoint).
- Every endpoint verifies `quiz.userId === session.user.id`; 404 otherwise (matches existing page).

## UI (`ChatPanel`)

- **Hover actions** per message: user → Edit, Copy, Delete; assistant → Copy, Regenerate, Delete.
- **Edit:** inline textarea replacing the bubble; Save → re-run (new branch), Cancel.
- **Branch switcher `‹ 2/3 ›`** under any message with siblings; flips `activeLeafId` (nav only).
- **Version badge + Restore** on assistant messages that have a `quizSnapshot`.
- **Timestamps:** small muted `createdAt` under the bubble.
- **Copy:** clipboard the message's text parts.
- **Retry:** on `status === 'error'`, show Retry on the failed user msg → `regenerate()`.

## Error handling & edge cases

- **Hydration must NOT replay history into the editor.** `seenToolCallsRef` currently starts empty
  each mount → it would re-fire historical `tool-updateQuiz` outputs onto the quiz, marking it dirty
  and potentially clobbering the saved quiz. **Fix:** seed `seenToolCallsRef` with all hydrated
  tool-call ids on mount; forward only outputs produced **during this session**.
- **Failed send:** `onFinish` skipped → DB unchanged → consistent. Retry re-runs.
- **Delete active-path node:** reseat `activeLeafId` to parent (then `descendToLeaf`) before responding.
- **Concurrent tabs:** last write wins on `activeLeafId` — acceptable for v1.
- **Empty/whitespace edit:** rejected client-side.
- **Orphan prevention:** subtree delete is recursive/cascade.
- **Restore vs unsaved manual edits:** restore overwrites editor state; if the editor is dirty,
  confirm before overwriting.

## Testing

- **Unit:** active-path derivation; edit → sibling under shared parent; delete → subtree removal +
  reseat; branch flip picks newest-child leaf; `descendToLeaf`.
- **API:** ownership 404s; `persistTurn` parentId/leaf advance + snapshot write; delete reseat.
- **Integration:** send → refresh → history present; edit → two branches → switch; regenerate
  sibling; restore writes snapshot to editor; **hydration does NOT mark the quiz dirty**.

## Files touched

- `src/db/schema.ts` — `chat_messages` table, `quizzes.activeLeafId`.
- `src/app/api/chat/route.ts` — `originalMessages`/`onFinish` persistence, `parentId` in body, snapshot.
- new: `src/app/api/quizzes/[id]/active-leaf/route.ts`, `src/app/api/quizzes/[id]/messages/[mid]/route.ts`.
- `src/app/dashboard/quizzes/[id]/page.tsx` — load history, compute active path, pass down.
- `src/components/builder/QuizEditor.tsx` — thread `initialMessages` to `ChatPanel`.
- `src/components/builder/ChatPanel.tsx` — hydration, message actions, switcher, restore, hydration fix.
- Migration for the new table + column.
