# Delete a Quiz — Design

**Date:** 2026-06-18
**Status:** Approved

## Goal

Let an authenticated owner permanently delete one of their quizzes. Deletion is a
**hard delete** — the row and all dependent data are removed, with no recovery.

## Entity Analysis

Tables related to a quiz (`src/db/schema.ts`):

| Table | Link to quiz | On delete | Notes |
|-------|--------------|-----------|-------|
| `quizzes` | root row | — | holds `activeLeafId` (uuid, **no FK**) pointing at a `chat_messages` row (active version leaf) |
| `questions` | `quizId` FK → `quizzes.id` | **cascade** | removed automatically by DB |
| `chat_messages` | `quizId` FK → `quizzes.id` | **cascade** | full chat history + `quizSnapshot` version snapshots; `parentId` self-ref also cascades |

Non-table references / side effects:

- `playCount` — plain integer column on `quizzes`, no separate table.
- **Scores are not persisted.** `api/quizzes/[id]/score/route.ts` computes the score on
  the fly and returns JSON; nothing is stored, so nothing needs cleanup.
- **Public play:** `isPublic` quizzes are served at `/play/[id]`. After deletion that
  route returns 404 — acceptable and expected.
- `activeLeafId` points into `chat_messages`. Deleting the quiz removes the whole quiz
  row, so there is no dangling pointer to reconcile.

**Conclusion:** existing FK cascades cover all dependent data. A single
`DELETE FROM quizzes WHERE id = ? AND user_id = ?` removes the quiz and cascades to
`questions` and `chat_messages`. No orphans are possible. No transaction required.

## Decisions

- **Hard delete** (irreversible). No soft-delete column, no trash bin — no audit or
  recovery requirement exists in the codebase.
- **Type-to-confirm** UX: the user must type the exact quiz title to enable the Delete
  button. Guards an irreversible action.
- **Entry points: both** the dashboard quiz list and the quiz editor page.
- **Post-delete behavior:**
  - Dashboard: remove the card and refresh the list in place, show a success toast.
  - Editor: redirect to `/dashboard`, show a success toast.

## Components

### 1. API — `DELETE /api/quizzes/[id]`

Add a `DELETE` handler to the existing `src/app/api/quizzes/[id]/route.ts`. Mirrors the
existing `PATCH` ownership pattern.

Logic:
1. `auth.api.getSession` → `401 Unauthorized` if no session.
2. Validate `id` against `UUID_RE` → `400 Invalid id` if malformed.
3. `db.delete(quizzes).where(and(eq(quizzes.id, id), eq(quizzes.userId, session.user.id))).returning()`.
4. Empty `returning()` → `404 Not found` (covers both "does not exist" and "not owner" —
   unified response, no ownership info leak).
5. Success → `200 { id }`.

DB FK cascades remove `questions` and `chat_messages` automatically. Ownership is
enforced in the `WHERE` clause; a user cannot delete another user's quiz.

### 2. Shared component — `DeleteQuizDialog`

New client component: `src/components/quiz/DeleteQuizDialog.tsx`. Single purpose:
type-to-confirm and fire the DELETE request. Reused by both entry points.

- Props: `quizId`, `quizTitle`, `onDeleted` callback, and trigger/open control
  (controlled `open` + `onOpenChange`, or a trigger element — match existing dialog usage).
- Body: shows the quiz title; a text input. The Delete button is disabled until the
  input value exactly equals `quizTitle`.
- On confirm: `fetch('/api/quizzes/' + quizId, { method: 'DELETE' })` with a loading
  state. On `ok` → success toast + call `onDeleted()`. On failure → error toast, keep the
  dialog open so the user can retry.
- Built on the existing `@base-ui/react` dialog primitives and `ui/button`. Toasts via
  `sonner` (already a dependency).

### 3. Dashboard wiring

`src/app/dashboard/page.tsx` is a server component. The quiz card needs client state for
the dialog, so extract the card markup into a client component (e.g.
`src/components/dashboard/QuizCard.tsx`) or a thin client wrapper around the existing
markup.

- Add a Trash2 button next to the existing Edit button on each card (the `Trash2` icon is
  already imported in `dashboard/page.tsx` but currently unused).
- `onDeleted` → `router.refresh()` to re-pull the server-rendered list. Success toast
  fired by the dialog.

### 4. Editor wiring

In `src/app/dashboard/quizzes/[id]` (editor page), add a delete entry point (a danger
button or menu item). On `onDeleted` → `router.push('/dashboard')` plus a success toast.

## Error Handling

| Condition | Response | UI |
|-----------|----------|----|
| No session | 401 | error toast |
| Malformed id | 400 | error toast |
| Not found / not owner | 404 | error toast |
| Server error | 500 | error toast; dialog stays open for retry |
| Success | 200 `{ id }` | success toast; refresh (dashboard) or redirect (editor) |

## Testing (vitest)

- DELETE removes the quiz and cascades: `questions` and `chat_messages` rows for that
  quiz are gone.
- DELETE of a quiz owned by another user → 404, and the quiz row is untouched.
- DELETE with a malformed id → 400.
- DELETE with no session → 401.
