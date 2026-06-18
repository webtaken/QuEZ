# Delete a Quiz Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authenticated owner permanently (hard) delete one of their quizzes from both the dashboard list and the quiz editor, with a type-to-confirm guard.

**Architecture:** A `DELETE /api/quizzes/[id]` route handler delegates to a `deleteQuiz(quizId, userId)` DB mutation (mirroring the existing `deleteSubtree` → messages route pattern). Postgres FK `ON DELETE CASCADE` removes the quiz's `questions` and `chat_messages` automatically. A single reusable client component `DeleteQuizDialog` (type-to-confirm) is wired into a new dashboard `QuizCard` client component and into the editor toolbar.

**Tech Stack:** Next.js 16 (App Router, route handlers), React 19 client components, Drizzle ORM + node-postgres, better-auth, base-ui dialog primitives, sonner toasts, vitest (node env).

## Global Constraints

- **This is Next.js 16** — APIs differ from training data. Mirror existing in-repo patterns (route handlers, `useRouter`, `router.refresh`/`router.push`). Before deviating from an existing pattern, read the relevant guide in `node_modules/next/dist/docs/`.
- **Hard delete only.** No soft-delete column. Dependent rows (`questions`, `chat_messages`) are removed by the FK `onDelete: 'cascade'` already defined in `src/db/schema.ts`.
- **Ownership scoping is mandatory.** Every quiz mutation filters by `userId` in the `WHERE` clause: `and(eq(quizzes.id, id), eq(quizzes.userId, session.user.id))`. A missing or non-owned quiz returns `404` (unified — no ownership info leak).
- **Auth:** `await auth.api.getSession({ headers: await headers() })`; no session → `401`.
- **Toasts:** `import { toast } from 'sonner'`. `Toaster` is already mounted in `src/app/layout.tsx`.
- **Tests:** vitest `environment: 'node'`, glob `src/**/*.test.ts` (`.ts` only — no `.tsx`). No jsdom/React-render harness exists; do **not** add one. UI components are verified manually. Route handlers are tested with module mocks.

---

### Task 1: `DELETE /api/quizzes/[id]` route + `deleteQuiz` mutation

**Files:**
- Create: `src/db/quiz-mutations.ts`
- Modify: `src/app/api/quizzes/[id]/route.ts` (append a `DELETE` handler; add one import)
- Test: `src/app/api/quizzes/[id]/route.test.ts`

**Interfaces:**
- Produces: `deleteQuiz(quizId: string, userId: string): Promise<{ ok: boolean }>` in `@/db/quiz-mutations`.
- Produces: `export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse>` in the route module. Responses: `401` (no session), `400` (malformed id), `404` (`{ ok: false }`), `200 { id }` (success).
- Consumes (existing, already in the route file): `auth` from `@/lib/auth`, `headers` from `next/headers`, `UUID_RE` constant, `NextRequest`/`NextResponse` from `next/server`.

- [ ] **Step 1: Write the failing test**

Create `src/app/api/quizzes/[id]/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock calls are hoisted above all imports by vitest.
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}))

const getSession = vi.fn()
vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: () => getSession() } },
}))

const deleteQuiz = vi.fn()
vi.mock('@/db/quiz-mutations', () => ({
  deleteQuiz: (...args: unknown[]) => deleteQuiz(...args),
}))

// `@/db` (imported transitively by the route) builds a pg Pool from this.
// pg does not connect until a query runs, and deleteQuiz is mocked, so a
// dummy URL is enough to let the module import without a live database.
process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test'

const { DELETE } = await import('./route')

const VALID_ID = '3549497d-eda3-4e66-8461-7ef45416d8e0'
const req = {} as Parameters<typeof DELETE>[0]
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  getSession.mockReset()
  deleteQuiz.mockReset()
})

describe('DELETE /api/quizzes/[id]', () => {
  it('returns 401 when there is no session', async () => {
    getSession.mockResolvedValue(null)
    const res = await DELETE(req, ctx(VALID_ID))
    expect(res.status).toBe(401)
    expect(deleteQuiz).not.toHaveBeenCalled()
  })

  it('returns 400 for a malformed id', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } })
    const res = await DELETE(req, ctx('not-a-uuid'))
    expect(res.status).toBe(400)
    expect(deleteQuiz).not.toHaveBeenCalled()
  })

  it('returns 404 when the quiz is missing or not owned', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } })
    deleteQuiz.mockResolvedValue({ ok: false })
    const res = await DELETE(req, ctx(VALID_ID))
    expect(res.status).toBe(404)
  })

  it('returns 200 and the id on success', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } })
    deleteQuiz.mockResolvedValue({ ok: true })
    const res = await DELETE(req, ctx(VALID_ID))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ id: VALID_ID })
  })

  it('scopes the delete to the session user', async () => {
    getSession.mockResolvedValue({ user: { id: 'owner-123' } })
    deleteQuiz.mockResolvedValue({ ok: true })
    await DELETE(req, ctx(VALID_ID))
    expect(deleteQuiz).toHaveBeenCalledWith(VALID_ID, 'owner-123')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/app/api/quizzes/\[id\]/route.test.ts`
Expected: FAIL — `route.ts` has no `DELETE` export (and `@/db/quiz-mutations` does not exist yet), so the import / `DELETE(...)` call errors.

- [ ] **Step 3: Create the `deleteQuiz` mutation**

Create `src/db/quiz-mutations.ts`:

```ts
import { db } from '@/db'
import { quizzes } from '@/db/schema'
import { and, eq } from 'drizzle-orm'

/**
 * Hard-delete a quiz owned by `userId`. FK ON DELETE CASCADE removes the
 * quiz's questions and chat_messages automatically (see src/db/schema.ts).
 * Returns { ok: false } when the quiz does not exist or is not owned by the
 * user — callers map this to a 404.
 */
export async function deleteQuiz(
  quizId: string,
  userId: string
): Promise<{ ok: boolean }> {
  const rows = await db
    .delete(quizzes)
    .where(and(eq(quizzes.id, quizId), eq(quizzes.userId, userId)))
    .returning({ id: quizzes.id })
  return { ok: rows.length > 0 }
}
```

- [ ] **Step 4: Add the `DELETE` handler to the route**

In `src/app/api/quizzes/[id]/route.ts`, add this import below the existing imports (after the `import { quizPayloadWithFlagsSchema } ...` line):

```ts
import { deleteQuiz } from '@/db/quiz-mutations'
```

Then append this handler at the end of the file (after the `PUT` function):

```ts
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const res = await deleteQuiz(id, session.user.id)
  if (!res.ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ id })
}
```

Note: `req` is unused here (same as the existing `messages/[mid]/route.ts` DELETE handler, which also keeps an unused `req` param and passes lint). Do not rename it.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test src/app/api/quizzes/\[id\]/route.test.ts`
Expected: PASS — all 5 cases green.

- [ ] **Step 6: Commit**

```bash
git add src/db/quiz-mutations.ts src/app/api/quizzes/\[id\]/route.ts src/app/api/quizzes/\[id\]/route.test.ts
git commit -m "feat(api): hard-delete a quiz via DELETE /api/quizzes/[id]"
```

---

### Task 2: `DeleteQuizDialog` component (type-to-confirm)

**Files:**
- Create: `src/components/quiz/DeleteQuizDialog.tsx`

**Interfaces:**
- Consumes: `DELETE /api/quizzes/[id]` from Task 1.
- Produces: `DeleteQuizDialog` React component with props
  `{ quizId: string; quizTitle: string; open: boolean; onOpenChange: (open: boolean) => void; onDeleted: () => void }`.
  The Delete button is enabled only when the typed text exactly equals `quizTitle`. On success it shows a toast, closes, and calls `onDeleted()` (caller decides refresh vs. redirect). On failure it shows an error toast and stays open.

There is no automated test for this component — vitest runs in `node` env with no React-render harness (see Global Constraints). Verified manually in Task 5.

- [ ] **Step 1: Create the component**

Create `src/components/quiz/DeleteQuizDialog.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { toast } from 'sonner'
import { Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface DeleteQuizDialogProps {
  quizId: string
  quizTitle: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after a successful delete. Caller decides what to do (refresh/redirect). */
  onDeleted: () => void
}

export function DeleteQuizDialog({
  quizId,
  quizTitle,
  open,
  onOpenChange,
  onDeleted,
}: DeleteQuizDialogProps) {
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

  const confirmed = confirmText === quizTitle

  function handleOpenChange(next: boolean) {
    if (deleting) return // don't allow closing mid-delete
    if (!next) setConfirmText('')
    onOpenChange(next)
  }

  async function handleDelete() {
    if (!confirmed || deleting) return
    setDeleting(true)
    const toastId = toast.loading('Deleting quiz...')
    try {
      const res = await fetch(`/api/quizzes/${quizId}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to delete quiz')
      }
      toast.success('Quiz deleted', { id: toastId })
      setConfirmText('')
      onOpenChange(false)
      onDeleted()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete quiz', { id: toastId })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-6 shadow-lg transition-all duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <Trash2 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <Dialog.Title className="font-[family-name:var(--font-syne)] text-lg font-bold text-foreground">
                Delete quiz
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                This permanently deletes{' '}
                <span className="font-medium text-foreground">{quizTitle}</span>, its
                questions, and its chat history. This cannot be undone.
              </Dialog.Description>
            </div>
          </div>

          <label className="mt-5 block text-sm text-muted-foreground">
            Type <span className="font-medium text-foreground">{quizTitle}</span> to confirm
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              disabled={deleting}
              autoFocus
              className="mt-1.5 h-10"
              placeholder={quizTitle}
            />
          </label>

          <div className="mt-6 flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleOpenChange(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={!confirmed || deleting}
              className="gap-1.5"
            >
              {deleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Delete quiz
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
```

- [ ] **Step 2: Typecheck the component**

Run: `pnpm exec tsc --noEmit`
Expected: PASS — no type errors. (Confirms the base-ui `Dialog` primitive surface and prop types compile.)

- [ ] **Step 3: Commit**

```bash
git add src/components/quiz/DeleteQuizDialog.tsx
git commit -m "feat(quiz): add type-to-confirm DeleteQuizDialog component"
```

---

### Task 3: Dashboard list — extract `QuizCard` and wire delete

**Files:**
- Create: `src/components/dashboard/QuizCard.tsx`
- Modify: `src/app/dashboard/page.tsx` (replace the inline card markup with `<QuizCard>`; drop now-unused imports)

**Interfaces:**
- Consumes: `DeleteQuizDialog` (Task 2).
- Produces: `QuizCard` component + `DashboardQuiz` type with props `{ quiz: DashboardQuiz }`, where
  `DashboardQuiz = { id: string; title: string; topic: string; audience: string; coverEmoji: string | null; isPublic: boolean; questionCount: number; createdAt: Date }`.
  On successful delete it calls `router.refresh()`.

- [ ] **Step 1: Create the `QuizCard` client component**

Create `src/components/dashboard/QuizCard.tsx`:

```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Edit, Trash2 } from 'lucide-react'
import { formatDistanceToNow } from '@/lib/date'
import { DeleteQuizDialog } from '@/components/quiz/DeleteQuizDialog'

export type DashboardQuiz = {
  id: string
  title: string
  topic: string
  audience: string
  coverEmoji: string | null
  isPublic: boolean
  questionCount: number
  createdAt: Date
}

export function QuizCard({ quiz }: { quiz: DashboardQuiz }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  return (
    <div className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4 hover:border-accent-lime/30 transition-colors">
      <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center text-2xl shrink-0">
        {quiz.coverEmoji ?? '🧠'}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-[family-name:var(--font-syne)] font-semibold text-foreground truncate">
          {quiz.title}
        </p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <Badge variant="secondary" className="text-xs">
            {quiz.topic}
          </Badge>
          <Badge variant="secondary" className="text-xs">
            {quiz.audience}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {quiz.questionCount} questions
          </span>
          <span className="text-xs text-muted-foreground">
            {formatDistanceToNow(quiz.createdAt)}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Badge
          variant={quiz.isPublic ? 'default' : 'secondary'}
          className={
            quiz.isPublic ? 'bg-accent-lime/20 text-accent-lime border-accent-lime/30' : ''
          }
        >
          {quiz.isPublic ? 'Public' : 'Draft'}
        </Badge>
        <Link href={`/dashboard/quizzes/${quiz.id}`}>
          <Button variant="ghost" size="icon" className="w-8 h-8">
            <Edit className="w-3.5 h-3.5" />
          </Button>
        </Link>
        <Button
          variant="ghost"
          size="icon"
          className="w-8 h-8 text-muted-foreground hover:text-destructive"
          onClick={() => setOpen(true)}
          aria-label={`Delete ${quiz.title}`}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
      <DeleteQuizDialog
        quizId={quiz.id}
        quizTitle={quiz.title}
        open={open}
        onOpenChange={setOpen}
        onDeleted={() => router.refresh()}
      />
    </div>
  )
}
```

- [ ] **Step 2: Use `QuizCard` in the dashboard page**

In `src/app/dashboard/page.tsx`, replace the entire quiz-list `.map(...)` block (the `<div className="space-y-3">` contents, from `{userQuizzes.map((quiz) => (` through its closing `))}`) with:

```tsx
{userQuizzes.map((quiz) => (
  <QuizCard
    key={quiz.id}
    quiz={{
      id: quiz.id,
      title: quiz.title,
      topic: quiz.topic,
      audience: quiz.audience,
      coverEmoji: quiz.coverEmoji,
      isPublic: quiz.isPublic,
      questionCount: Number(quiz.questionCount),
      createdAt: quiz.createdAt,
    }}
  />
))}
```

- [ ] **Step 3: Fix imports in the dashboard page**

Add the import (with the other component imports near the top of `src/app/dashboard/page.tsx`):

```tsx
import { QuizCard } from '@/components/dashboard/QuizCard'
```

Then remove the now-unused imports. Change the line:

```tsx
import { Badge } from '@/components/ui/badge'
```

to nothing (delete it), and change:

```tsx
import { Sparkles, BookOpen, Gamepad2, Globe, Plus, Edit, Trash2 } from 'lucide-react'
```

to:

```tsx
import { Sparkles, BookOpen, Gamepad2, Globe, Plus } from 'lucide-react'
```

and delete:

```tsx
import { formatDistanceToNow } from '@/lib/date'
```

(`Button` and `Link` stay — still used by the "New Quiz" buttons and FAB. `BookOpen`, `Gamepad2`, `Globe`, `Plus`, `Sparkles` stay — used in the stats grid and buttons.)

- [ ] **Step 4: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS — no unused-import or type errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/QuizCard.tsx src/app/dashboard/page.tsx
git commit -m "feat(dashboard): delete quiz from the dashboard list"
```

---

### Task 4: Editor toolbar — wire delete

**Files:**
- Modify: `src/components/builder/QuizEditor.tsx` (add `Trash2` import + `DeleteQuizDialog` import, delete-open state, toolbar button, dialog)

**Interfaces:**
- Consumes: `DeleteQuizDialog` (Task 2). `QuizEditor` already has `router` (from `useRouter`), `useState`, and `toast`.
- On successful delete it calls `router.push('/dashboard')`.

- [ ] **Step 1: Add imports**

In `src/components/builder/QuizEditor.tsx`, change the lucide import line:

```tsx
import { Save, Plus, Loader2 } from 'lucide-react'
```

to:

```tsx
import { Save, Plus, Loader2, Trash2 } from 'lucide-react'
```

And add, with the other component imports (e.g. directly below the `PublishToggle` import):

```tsx
import { DeleteQuizDialog } from '@/components/quiz/DeleteQuizDialog'
```

- [ ] **Step 2: Add delete-open state**

In the `QuizEditor` function body, just after the existing `const [quiz, setQuiz] = useState(...)` / `const [dirty, setDirty] = useState(false)` state declarations, add:

```tsx
  const [deleteOpen, setDeleteOpen] = useState(false)
```

- [ ] **Step 3: Add the toolbar button and the dialog**

In the toolbar block, replace:

```tsx
            <div className="flex items-center gap-2 shrink-0">
              <PublishToggle quizId={initialQuiz.id} initialIsPublic={initialQuiz.isPublic} />
```

with:

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
              <PublishToggle quizId={initialQuiz.id} initialIsPublic={initialQuiz.isPublic} />
              <DeleteQuizDialog
                quizId={initialQuiz.id}
                quizTitle={initialQuiz.title}
                open={deleteOpen}
                onOpenChange={setDeleteOpen}
                onDeleted={() => router.push('/dashboard')}
              />
```

(The dialog renders through a portal, so its position inside the toolbar `div` does not affect layout. `quizTitle` uses `initialQuiz.title` — the persisted title — so the type-to-confirm target is stable even if the user edited the title field locally.)

- [ ] **Step 4: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/builder/QuizEditor.tsx
git commit -m "feat(editor): delete quiz from the editor toolbar"
```

---

### Task 5: Full verification (automated + manual)

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite, lint, and build**

Run:
```bash
pnpm test
pnpm lint
pnpm build
```
Expected: tests pass (including the 5 DELETE cases), lint clean, build succeeds.

- [ ] **Step 2: Manual — delete from the dashboard with type-to-confirm**

Run `pnpm dev`. Log in, create or pick a quiz, then on the dashboard:
- Click the trash icon on a quiz card → dialog opens.
- Confirm the Delete button is **disabled** until you type the exact quiz title.
- Type a wrong title → still disabled. Type the exact title → enabled.
- Click Delete → success toast, dialog closes, the card disappears (list refreshes).

- [ ] **Step 3: Manual — delete from the editor**

Open a quiz in the editor (`/dashboard/quizzes/[id]`):
- Click the trash icon in the toolbar → dialog opens, type-to-confirm gates the same way.
- Confirm → success toast and redirect to `/dashboard`; the quiz is gone from the list.

- [ ] **Step 4: Manual — confirm the cascade**

Before deleting a quiz that has chat history, note its `id`. After deleting, run `pnpm db:studio` and confirm:
- No `quizzes` row with that `id`.
- No `questions` rows with `quiz_id` = that id.
- No `chat_messages` rows with `quiz_id` = that id.

(This verifies the FK `ON DELETE CASCADE` removed dependent rows — the behavior `deleteQuiz` relies on instead of deleting children explicitly.)

- [ ] **Step 5: Manual — ownership / 404**

With the dev server running, attempt to delete a quiz you do not own (use a quiz id belonging to another user, e.g. via `curl`):
```bash
curl -i -X DELETE http://localhost:3000/api/quizzes/<other-users-quiz-id>
```
Expected: `404` (unauthenticated request returns `401`); the other user's quiz row is untouched in `db:studio`.

- [ ] **Step 6: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "chore(quiz): verification fixes for quiz deletion"
```
(Skip if nothing changed.)
