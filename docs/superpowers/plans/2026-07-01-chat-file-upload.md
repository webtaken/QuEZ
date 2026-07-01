# Chat File Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user upload files (PDF, Word, PowerPoint, Excel, text/markdown, images) into the builder chat and build/refine quizzes from their content.

**Architecture:** Files upload direct-to-R2 via a presigned PUT (bypassing Vercel's ~4.5MB body limit). A process endpoint extracts text server-side — `officeparser` for documents, `google/gemini-2.5-flash-lite` for images — and stores the text in a new `attachments` table. Message `parts` carry only a lightweight `data-attachment` reference; `/api/chat` re-scans the conversation for those references, loads the extracted text, and injects it into the system prompt (the same seam already used for `existingQuiz`). The chat model is unchanged.

**Tech Stack:** Next 16 (App Router route handlers), Vercel AI SDK v6 (`ai@^6`, `@ai-sdk/react@^3`), `@openrouter/ai-sdk-provider`, Drizzle + Postgres, `officeparser`, `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` (Cloudflare R2), Vitest.

## Global Constraints

- **Next 16 has breaking changes.** Before writing/modifying any route handler, read `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`. Route `params` are a `Promise` (`{ params }: { params: Promise<{ id: string }> }`) — see existing `src/app/api/quizzes/[id]/route.ts`.
- **IDs are UUIDs.** All `attachments.id` and message ids use `crypto.randomUUID()` via `newId()` from `src/lib/ids.ts`. Validate with `isUuid()` before any id reaches Postgres.
- **Chat model stays** `deepseek/deepseek-v4-flash`. Only image extraction uses `google/gemini-2.5-flash-lite`.
- **Attachment API + process routes run on the Node.js runtime** (default for route handlers; do not set `export const runtime = 'edge'`) — `officeparser` and `@aws-sdk/client-s3` need Node APIs.
- **Auth on every endpoint:** `await auth.api.getSession({ headers: await headers() })`; 401 when absent. Every attachment row is scoped by `attachments.userId === session.user.id`.
- **Limits:** max **15 MB/file**, max **3 files/message**, per-file injected-text cap ~48k chars, total ~120k chars.
- **Package manager is pnpm.** Tests: `pnpm test` (Vitest, `environment: 'node'`, files `src/**/*.test.ts`).
- **Follow existing patterns:** DB helpers in `src/db/*-queries.ts`; pure logic + colocated `*.test.ts` in `src/lib/`; route tests mock `@/lib/auth`, `next/headers`, and the DB/query layer (see `src/app/api/quizzes/[id]/route.test.ts`).

---

### Task 1: R2 client wrapper + install storage/extraction deps

**Files:**
- Modify: `package.json` (via pnpm add)
- Modify: `.env.example`
- Create: `src/lib/r2.ts`
- Test: `src/lib/r2.test.ts`

**Interfaces:**
- Produces: `r2Key(userId, attachmentId, filename): string`, `presignPut(key, contentType): Promise<string>`, `getObjectBytes(key): Promise<Uint8Array>`, `deleteObjects(keys: string[]): Promise<void>`.

- [ ] **Step 1: Install dependencies**

Run:
```bash
pnpm add officeparser @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```
Expected: three packages added to `dependencies` in `package.json`.

- [ ] **Step 2: Add R2 env vars to `.env.example`**

Append to `.env.example`:
```
# Cloudflare R2 (S3-compatible) — file attachments storage
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
```

- [ ] **Step 3: Write the failing test for `r2Key`**

Create `src/lib/r2.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { r2Key } from './r2'

describe('r2Key', () => {
  it('namespaces by user and attachment id', () => {
    expect(r2Key('user-1', 'att-1', 'notes.pdf')).toBe('attachments/user-1/att-1/notes.pdf')
  })
  it('sanitizes unsafe characters in the filename', () => {
    expect(r2Key('u', 'a', 'my report (v2).pdf')).toBe('attachments/u/a/my_report_v2_.pdf')
  })
  it('keeps the tail of very long filenames', () => {
    const key = r2Key('u', 'a', 'x'.repeat(300) + '.pdf')
    expect(key.startsWith('attachments/u/a/')).toBe(true)
    expect(key.length).toBeLessThan('attachments/u/a/'.length + 130)
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm test src/lib/r2.test.ts`
Expected: FAIL — `Failed to resolve import "./r2"` / `r2Key is not a function`.

- [ ] **Step 5: Implement `src/lib/r2.ts`**

```ts
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

let cached: S3Client | null = null
function client(): S3Client {
  if (cached) return cached
  cached = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  })
  return cached
}

// Object key: namespaced by user so presigned URLs and cleanup stay scoped.
export function r2Key(userId: string, attachmentId: string, filename: string): string {
  const safe = filename.replace(/[^\w.-]+/g, '_').slice(-120)
  return `attachments/${userId}/${attachmentId}/${safe}`
}

export async function presignPut(key: string, contentType: string): Promise<string> {
  return getSignedUrl(
    client(),
    new PutObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: key, ContentType: contentType }),
    { expiresIn: 600 }
  )
}

export async function getObjectBytes(key: string): Promise<Uint8Array> {
  const out = await client().send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: key }))
  // aws-sdk v3 attaches transformToByteArray() to the Node stream Body.
  return (out.Body as unknown as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray()
}

export async function deleteObjects(keys: string[]): Promise<void> {
  if (!keys.length) return
  await client().send(
    new DeleteObjectsCommand({
      Bucket: process.env.R2_BUCKET!,
      Delete: { Objects: keys.map((Key) => ({ Key })) },
    })
  )
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm test src/lib/r2.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml .env.example src/lib/r2.ts src/lib/r2.test.ts
git commit -m "feat(attachments): R2 client wrapper + deps"
```

---

### Task 2: `attachments` table schema

**Files:**
- Modify: `src/db/schema.ts`

**Interfaces:**
- Produces: `attachments` table, `type Attachment`, `type NewAttachment`.

- [ ] **Step 1: Add the table to `src/db/schema.ts`**

After the `chatMessages` table block (before the `export type` lines), add:
```ts
export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').primaryKey(), // client-generated uuid (newId)
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    quizId: uuid('quiz_id').references(() => quizzes.id, { onDelete: 'cascade' }), // null until first save
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    r2Key: text('r2_key').notNull(),
    kind: text('kind').notNull(), // 'pdf' | 'docx' | 'pptx' | 'xlsx' | 'text' | 'image'
    status: text('status').notNull().default('pending'), // 'pending' | 'ready' | 'error'
    extractedText: text('extracted_text'),
    errorMessage: text('error_message'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meta: jsonb('meta').$type<Record<string, any>>(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('attachments_quiz_id_idx').on(t.quizId),
    index('attachments_user_id_idx').on(t.userId),
  ]
)
```

- [ ] **Step 2: Export the row types**

Add next to the other `export type` lines at the bottom of `src/db/schema.ts`:
```ts
export type Attachment = typeof attachments.$inferSelect
export type NewAttachment = typeof attachments.$inferInsert
```

- [ ] **Step 3: Typecheck + push schema to the database**

Run:
```bash
pnpm exec tsc --noEmit
pnpm db:push
```
Expected: tsc clean; drizzle-kit creates the `attachments` table (confirm it lists the new table).

- [ ] **Step 4: Commit**

```bash
git add src/db/schema.ts
git commit -m "feat(attachments): add attachments table"
```

---

### Task 3: Attachment kind mapping + upload validation

**Files:**
- Create: `src/lib/attachment-kind.ts`
- Test: `src/lib/attachment-kind.test.ts`

**Interfaces:**
- Produces: `type AttachmentKind = 'pdf'|'docx'|'pptx'|'xlsx'|'text'|'image'`; `MAX_ATTACHMENT_BYTES`, `MAX_FILES_PER_MESSAGE`, `ACCEPT_ATTR`; `kindFor(filename, mimeType): AttachmentKind | null`; `validateUpload({filename, mimeType, sizeBytes}): { ok: true; kind } | { ok: false; error }`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/attachment-kind.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { kindFor, validateUpload, MAX_ATTACHMENT_BYTES } from './attachment-kind'

describe('kindFor', () => {
  it('maps known mime types', () => {
    expect(kindFor('a.pdf', 'application/pdf')).toBe('pdf')
    expect(kindFor('a.png', 'image/png')).toBe('image')
  })
  it('falls back to extension when mime is generic', () => {
    expect(kindFor('notes.md', 'application/octet-stream')).toBe('text')
    expect(kindFor('deck.pptx', '')).toBe('pptx')
  })
  it('returns null for unsupported types', () => {
    expect(kindFor('video.mp4', 'video/mp4')).toBeNull()
  })
})

describe('validateUpload', () => {
  it('accepts a valid file and returns its kind', () => {
    expect(validateUpload({ filename: 'a.docx', mimeType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', sizeBytes: 1000 }))
      .toEqual({ ok: true, kind: 'docx' })
  })
  it('rejects oversize files', () => {
    const r = validateUpload({ filename: 'a.pdf', mimeType: 'application/pdf', sizeBytes: MAX_ATTACHMENT_BYTES + 1 })
    expect(r.ok).toBe(false)
  })
  it('rejects unsupported types', () => {
    const r = validateUpload({ filename: 'a.mp4', mimeType: 'video/mp4', sizeBytes: 10 })
    expect(r).toEqual({ ok: false, error: 'unsupported file type' })
  })
  it('rejects non-positive sizes', () => {
    expect(validateUpload({ filename: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 0 }).ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/attachment-kind.test.ts`
Expected: FAIL — cannot resolve `./attachment-kind`.

- [ ] **Step 3: Implement `src/lib/attachment-kind.ts`**

```ts
export type AttachmentKind = 'pdf' | 'docx' | 'pptx' | 'xlsx' | 'text' | 'image'

export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024 // 15 MB
export const MAX_FILES_PER_MESSAGE = 3

const MIME_KIND: Record<string, AttachmentKind> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/plain': 'text',
  'text/markdown': 'text',
  'text/csv': 'text',
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/webp': 'image',
  'image/gif': 'image',
}

const EXT_KIND: Record<string, AttachmentKind> = {
  pdf: 'pdf',
  docx: 'docx',
  pptx: 'pptx',
  xlsx: 'xlsx',
  txt: 'text',
  md: 'text',
  markdown: 'text',
  csv: 'text',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  webp: 'image',
  gif: 'image',
}

// Accept attribute for the <input type="file">, derived from the allowlist.
export const ACCEPT_ATTR = '.pdf,.docx,.pptx,.xlsx,.txt,.md,.csv,.png,.jpg,.jpeg,.webp,.gif'

export function kindFor(filename: string, mimeType: string): AttachmentKind | null {
  const byMime = MIME_KIND[mimeType]
  if (byMime) return byMime
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return EXT_KIND[ext] ?? null
}

export function validateUpload(args: {
  filename: string
  mimeType: string
  sizeBytes: number
}): { ok: true; kind: AttachmentKind } | { ok: false; error: string } {
  if (!args.filename || typeof args.filename !== 'string') return { ok: false, error: 'filename required' }
  if (!Number.isInteger(args.sizeBytes) || args.sizeBytes <= 0) return { ok: false, error: 'invalid size' }
  if (args.sizeBytes > MAX_ATTACHMENT_BYTES) return { ok: false, error: 'file too large (max 15MB)' }
  const kind = kindFor(args.filename, args.mimeType)
  if (!kind) return { ok: false, error: 'unsupported file type' }
  return { ok: true, kind }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/attachment-kind.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/attachment-kind.ts src/lib/attachment-kind.test.ts
git commit -m "feat(attachments): kind mapping + upload validation"
```

---

### Task 4: System-prompt injection builder + id collector

**Files:**
- Create: `src/lib/attachment-inject.ts`
- Test: `src/lib/attachment-inject.test.ts`

**Interfaces:**
- Consumes: `AttachmentKind` from `./attachment-kind`.
- Produces: `type ReadyAttachment = { id: string; filename: string; kind: AttachmentKind; extractedText: string }`; `collectAttachmentIds(messages: { parts?: unknown[] }[]): string[]`; `buildAttachmentSystemBlock(attachments: ReadyAttachment[]): string`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/attachment-inject.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { collectAttachmentIds, buildAttachmentSystemBlock } from './attachment-inject'

describe('collectAttachmentIds', () => {
  it('collects unique data-attachment ids in order', () => {
    const messages = [
      { parts: [{ type: 'text', text: 'hi' }, { type: 'data-attachment', id: 'a1', filename: 'x.pdf', kind: 'pdf' }] },
      { parts: [{ type: 'data-attachment', id: 'a2', filename: 'y.png', kind: 'image' }] },
      { parts: [{ type: 'data-attachment', id: 'a1', filename: 'x.pdf', kind: 'pdf' }] }, // dup
    ]
    expect(collectAttachmentIds(messages)).toEqual(['a1', 'a2'])
  })
  it('returns empty when there are no attachment parts', () => {
    expect(collectAttachmentIds([{ parts: [{ type: 'text', text: 'hi' }] }])).toEqual([])
  })
})

describe('buildAttachmentSystemBlock', () => {
  it('returns empty string with no attachments', () => {
    expect(buildAttachmentSystemBlock([])).toBe('')
  })
  it('lists each file with a labeled section', () => {
    const block = buildAttachmentSystemBlock([
      { id: 'a1', filename: 'notes.pdf', kind: 'pdf', extractedText: 'Cell division basics' },
    ])
    expect(block).toContain('--- notes.pdf (pdf) ---')
    expect(block).toContain('Cell division basics')
  })
  it('truncates very long per-file text', () => {
    const block = buildAttachmentSystemBlock([
      { id: 'a1', filename: 'big.pdf', kind: 'pdf', extractedText: 'x'.repeat(60_000) },
    ])
    expect(block).toContain('…[truncated]')
    expect(block.length).toBeLessThan(50_000)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/attachment-inject.test.ts`
Expected: FAIL — cannot resolve `./attachment-inject`.

- [ ] **Step 3: Implement `src/lib/attachment-inject.ts`**

```ts
import type { AttachmentKind } from './attachment-kind'

export type ReadyAttachment = {
  id: string
  filename: string
  kind: AttachmentKind
  extractedText: string
}

// ~4 chars/token heuristic: ~12k tokens/file, ~30k tokens total across files.
const PER_FILE_CHAR_CAP = 48_000
const TOTAL_CHAR_CAP = 120_000
const TRUNCATION_MARK = '\n…[truncated]'

// Scan the whole conversation (current turn + history) for attachment references,
// so later turns ("add more from the doc") keep access without re-uploading.
export function collectAttachmentIds(messages: { parts?: unknown[] }[]): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const m of messages ?? []) {
    for (const part of m.parts ?? []) {
      const p = part as { type?: string; id?: string }
      if (p.type === 'data-attachment' && typeof p.id === 'string' && !seen.has(p.id)) {
        seen.add(p.id)
        ids.push(p.id)
      }
    }
  }
  return ids
}

export function buildAttachmentSystemBlock(attachments: ReadyAttachment[]): string {
  if (!attachments.length) return ''
  let total = 0
  const sections: string[] = []
  for (const a of attachments) {
    if (total >= TOTAL_CHAR_CAP) break
    let text = a.extractedText ?? ''
    if (text.length > PER_FILE_CHAR_CAP) text = text.slice(0, PER_FILE_CHAR_CAP) + TRUNCATION_MARK
    if (total + text.length > TOTAL_CHAR_CAP) {
      text = text.slice(0, Math.max(0, TOTAL_CHAR_CAP - total)) + TRUNCATION_MARK
    }
    total += text.length
    sections.push(`--- ${a.filename} (${a.kind}) ---\n${text}`)
  }
  return (
    'The user attached these materials. Use them as the primary source for building or updating the quiz.\n\n' +
    sections.join('\n\n')
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/attachment-inject.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/attachment-inject.ts src/lib/attachment-inject.test.ts
git commit -m "feat(attachments): system-prompt injection builder"
```

---

### Task 5: Extraction dispatch (officeparser + vision)

**Files:**
- Create: `src/lib/attachment-extract.ts`
- Test: `src/lib/attachment-extract.test.ts`

**Interfaces:**
- Consumes: `AttachmentKind` from `./attachment-kind`.
- Produces: `extractAttachmentText({ kind, bytes, mimeType }): Promise<string>`.

- [ ] **Step 1: Write the failing test (mock the third-party libs)**

Create `src/lib/attachment-extract.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const parseOfficeAsync = vi.fn()
vi.mock('officeparser', () => ({ parseOfficeAsync: (...a: unknown[]) => parseOfficeAsync(...a) }))

const generateText = vi.fn()
vi.mock('ai', () => ({ generateText: (...a: unknown[]) => generateText(...a) }))
vi.mock('@openrouter/ai-sdk-provider', () => ({ openrouter: (id: string) => ({ id }) }))

const { extractAttachmentText } = await import('./attachment-extract')

beforeEach(() => {
  parseOfficeAsync.mockReset()
  generateText.mockReset()
})

describe('extractAttachmentText', () => {
  it('decodes text files directly without calling officeparser', async () => {
    const bytes = new TextEncoder().encode('  hello notes  ')
    const out = await extractAttachmentText({ kind: 'text', bytes, mimeType: 'text/plain' })
    expect(out).toBe('hello notes')
    expect(parseOfficeAsync).not.toHaveBeenCalled()
  })

  it('runs officeparser for documents and trims the result', async () => {
    parseOfficeAsync.mockResolvedValue('  parsed pdf text  ')
    const out = await extractAttachmentText({ kind: 'pdf', bytes: new Uint8Array([1, 2]), mimeType: 'application/pdf' })
    expect(out).toBe('parsed pdf text')
    expect(parseOfficeAsync).toHaveBeenCalledOnce()
    expect(Buffer.isBuffer(parseOfficeAsync.mock.calls[0][0])).toBe(true)
  })

  it('sends images to the vision model with an image content part', async () => {
    generateText.mockResolvedValue({ text: 'transcribed image' })
    const bytes = new Uint8Array([9, 9])
    const out = await extractAttachmentText({ kind: 'image', bytes, mimeType: 'image/png' })
    expect(out).toBe('transcribed image')
    const arg = generateText.mock.calls[0][0]
    const content = arg.messages[0].content
    expect(content.some((c: { type: string }) => c.type === 'image')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/attachment-extract.test.ts`
Expected: FAIL — cannot resolve `./attachment-extract`.

- [ ] **Step 3: Implement `src/lib/attachment-extract.ts`**

```ts
import { parseOfficeAsync } from 'officeparser'
import { generateText } from 'ai'
import { openrouter } from '@openrouter/ai-sdk-provider'
import type { AttachmentKind } from './attachment-kind'

const IMAGE_MODEL = 'google/gemini-2.5-flash-lite'
const IMAGE_PROMPT =
  'Transcribe all text in this image verbatim. Then describe any diagrams, figures, charts, tables, or handwriting in detail. Output plain text only.'

// Returns extracted plain text. Documents go through officeparser (pure JS/WASM,
// serverless-safe); plain text/markdown/csv are decoded directly; images are
// transcribed + described by a cheap vision model.
export async function extractAttachmentText(args: {
  kind: AttachmentKind
  bytes: Uint8Array
  mimeType: string
}): Promise<string> {
  if (args.kind === 'image') {
    const { text } = await generateText({
      model: openrouter(IMAGE_MODEL),
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
    return text.trim()
  }

  if (args.kind === 'text') {
    return Buffer.from(args.bytes).toString('utf-8').trim()
  }

  // pdf | docx | pptx | xlsx
  const text = await parseOfficeAsync(Buffer.from(args.bytes))
  return text.trim()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/attachment-extract.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Verify the officeparser export against the installed version**

Run: `node -e "console.log(typeof require('officeparser').parseOfficeAsync)"`
Expected: `function`. If it prints `undefined`, open `node_modules/officeparser/index.d.ts`, find the buffer-parsing export (e.g. `parseOfficeAsync` / `parseOffice`), and update the import + call in `src/lib/attachment-extract.ts` accordingly, then re-run Step 4.

- [ ] **Step 6: Commit**

```bash
git add src/lib/attachment-extract.ts src/lib/attachment-extract.test.ts
git commit -m "feat(attachments): text/document/image extraction dispatch"
```

---

### Task 6: Attachment DB queries

**Files:**
- Create: `src/db/attachment-queries.ts`

**Interfaces:**
- Consumes: `attachments` table + `Attachment`/`NewAttachment` types (Task 2).
- Produces: `insertAttachment(row)`, `getOwnedAttachment(id, userId)`, `markAttachmentReady(id, text, meta)`, `markAttachmentError(id, message)`, `loadReadyAttachments(ids, userId)`, `reassociateAttachments(ids, quizId, userId, tx?)`, `listAttachmentKeysForQuiz(quizId, tx?)`.

- [ ] **Step 1: Implement `src/db/attachment-queries.ts`**

(No unit test — DB helpers are exercised through the route tests, matching `src/db/chat-queries.ts` which has no direct unit test. Correctness is checked by `tsc` here and by Tasks 7–11.)
```ts
import { db } from '@/db'
import { attachments, type Attachment, type NewAttachment } from '@/db/schema'
import { and, eq, inArray, isNull } from 'drizzle-orm'

// Accepts the base db or a transaction handle (same query-builder surface).
type DbLike = typeof db

export async function insertAttachment(row: NewAttachment): Promise<void> {
  await db.insert(attachments).values(row)
}

export async function getOwnedAttachment(id: string, userId: string): Promise<Attachment | null> {
  const [row] = await db
    .select()
    .from(attachments)
    .where(and(eq(attachments.id, id), eq(attachments.userId, userId)))
    .limit(1)
  return row ?? null
}

export async function markAttachmentReady(
  id: string,
  extractedText: string,
  meta: Record<string, unknown>
): Promise<void> {
  await db.update(attachments).set({ status: 'ready', extractedText, meta, errorMessage: null }).where(eq(attachments.id, id))
}

export async function markAttachmentError(id: string, errorMessage: string): Promise<void> {
  await db.update(attachments).set({ status: 'error', errorMessage }).where(eq(attachments.id, id))
}

export async function loadReadyAttachments(ids: string[], userId: string): Promise<Attachment[]> {
  if (!ids.length) return []
  return db
    .select()
    .from(attachments)
    .where(and(inArray(attachments.id, ids), eq(attachments.userId, userId), eq(attachments.status, 'ready')))
}

// Re-link new-quiz attachments (quizId null) to the quiz on first save.
export async function reassociateAttachments(
  ids: string[],
  quizId: string,
  userId: string,
  tx: DbLike = db
): Promise<void> {
  if (!ids.length) return
  await tx
    .update(attachments)
    .set({ quizId })
    .where(and(inArray(attachments.id, ids), eq(attachments.userId, userId), isNull(attachments.quizId)))
}

export async function listAttachmentKeysForQuiz(quizId: string, tx: DbLike = db): Promise<string[]> {
  const rows = await tx.select({ r2Key: attachments.r2Key }).from(attachments).where(eq(attachments.quizId, quizId))
  return rows.map((r) => r.r2Key)
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors. (If the `tx: DbLike = db` default trips the transaction type, change the param type to `PgTransaction<any, any, any>` imported from `drizzle-orm/pg-core`, or accept `tx?: DbLike` and default inside.)

- [ ] **Step 3: Commit**

```bash
git add src/db/attachment-queries.ts
git commit -m "feat(attachments): db query helpers"
```

---

### Task 7: `POST /api/attachments` (sign + create row)

**Files:**
- Create: `src/app/api/attachments/route.ts`
- Test: `src/app/api/attachments/route.test.ts`

**Interfaces:**
- Consumes: `validateUpload` (Task 3), `insertAttachment` (Task 6), `r2Key`/`presignPut` (Task 1), `isUuid`.
- Request body: `{ id: string(uuid), filename, mimeType, sizeBytes, quizId? }`. Response: `{ id, uploadUrl }`.

- [ ] **Step 1: Read the Next 16 route-handler doc**

Run: `sed -n '1,80p' node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
Confirm the `export async function POST(req: Request)` signature and JSON response pattern.

- [ ] **Step 2: Write the failing test**

Create `src/app/api/attachments/route.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
const getSession = vi.fn()
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: () => getSession() } } }))
const insertAttachment = vi.fn()
vi.mock('@/db/attachment-queries', () => ({ insertAttachment: (...a: unknown[]) => insertAttachment(...a) }))
const presignPut = vi.fn()
vi.mock('@/lib/r2', () => ({
  presignPut: (...a: unknown[]) => presignPut(...a),
  r2Key: () => 'attachments/u1/id/x.pdf',
}))
process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test'

const { POST } = await import('./route')
const ID = '3549497d-eda3-4e66-8461-7ef45416d8e0'
const make = (body: unknown) => ({ json: async () => body }) as unknown as Parameters<typeof POST>[0]

beforeEach(() => {
  getSession.mockReset(); insertAttachment.mockReset(); presignPut.mockReset()
})

describe('POST /api/attachments', () => {
  it('401 without a session', async () => {
    getSession.mockResolvedValue(null)
    const res = await POST(make({}))
    expect(res.status).toBe(401)
  })
  it('400 for a non-uuid id', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } })
    const res = await POST(make({ id: 'x', filename: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 5 }))
    expect(res.status).toBe(400)
  })
  it('400 for an unsupported type', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } })
    const res = await POST(make({ id: ID, filename: 'a.mp4', mimeType: 'video/mp4', sizeBytes: 5 }))
    expect(res.status).toBe(400)
    expect(insertAttachment).not.toHaveBeenCalled()
  })
  it('inserts a pending row and returns a presigned url', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } })
    presignPut.mockResolvedValue('https://r2/put')
    const res = await POST(make({ id: ID, filename: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 5 }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: ID, uploadUrl: 'https://r2/put' })
    expect(insertAttachment).toHaveBeenCalledOnce()
    const row = insertAttachment.mock.calls[0][0]
    expect(row).toMatchObject({ id: ID, userId: 'u1', kind: 'pdf', status: 'pending' })
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test src/app/api/attachments/route.test.ts`
Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 4: Implement `src/app/api/attachments/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { validateUpload } from '@/lib/attachment-kind'
import { insertAttachment } from '@/db/attachment-queries'
import { r2Key, presignPut } from '@/lib/r2'
import { isUuid } from '@/lib/ids'

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const { id, filename, mimeType, sizeBytes, quizId } = body as {
    id?: unknown; filename?: unknown; mimeType?: unknown; sizeBytes?: unknown; quizId?: unknown
  }
  if (!isUuid(id)) return NextResponse.json({ error: 'id must be a uuid' }, { status: 400 })

  const v = validateUpload({
    filename: String(filename ?? ''),
    mimeType: String(mimeType ?? ''),
    sizeBytes: Number(sizeBytes),
  })
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })

  const key = r2Key(session.user.id, id, String(filename))
  await insertAttachment({
    id,
    userId: session.user.id,
    quizId: isUuid(quizId) ? quizId : null,
    filename: String(filename),
    mimeType: String(mimeType),
    sizeBytes: Number(sizeBytes),
    r2Key: key,
    kind: v.kind,
    status: 'pending',
  })

  const uploadUrl = await presignPut(key, String(mimeType))
  return NextResponse.json({ id, uploadUrl })
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test src/app/api/attachments/route.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/app/api/attachments/route.ts src/app/api/attachments/route.test.ts
git commit -m "feat(attachments): POST /api/attachments (presign + create)"
```

---

### Task 8: `POST /api/attachments/[id]/process` (extract)

**Files:**
- Create: `src/app/api/attachments/[id]/process/route.ts`
- Test: `src/app/api/attachments/[id]/process/route.test.ts`

**Interfaces:**
- Consumes: `getOwnedAttachment`, `markAttachmentReady`, `markAttachmentError` (Task 6), `getObjectBytes` (Task 1), `extractAttachmentText` (Task 5).
- Route: `POST`, params `{ id }`. Response: `{ status, filename, kind, errorMessage? }`.

- [ ] **Step 1: Write the failing test**

Create `src/app/api/attachments/[id]/process/route.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
const getSession = vi.fn()
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: () => getSession() } } }))
const getOwnedAttachment = vi.fn()
const markAttachmentReady = vi.fn()
const markAttachmentError = vi.fn()
vi.mock('@/db/attachment-queries', () => ({
  getOwnedAttachment: (...a: unknown[]) => getOwnedAttachment(...a),
  markAttachmentReady: (...a: unknown[]) => markAttachmentReady(...a),
  markAttachmentError: (...a: unknown[]) => markAttachmentError(...a),
}))
const getObjectBytes = vi.fn()
vi.mock('@/lib/r2', () => ({ getObjectBytes: (...a: unknown[]) => getObjectBytes(...a) }))
const extractAttachmentText = vi.fn()
vi.mock('@/lib/attachment-extract', () => ({ extractAttachmentText: (...a: unknown[]) => extractAttachmentText(...a) }))
process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test'

const { POST } = await import('./route')
const ID = '3549497d-eda3-4e66-8461-7ef45416d8e0'
const req = {} as Parameters<typeof POST>[0]
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const row = { id: ID, userId: 'u1', r2Key: 'k', kind: 'pdf', mimeType: 'application/pdf', filename: 'a.pdf' }

beforeEach(() => {
  getSession.mockReset(); getOwnedAttachment.mockReset(); markAttachmentReady.mockReset()
  markAttachmentError.mockReset(); getObjectBytes.mockReset(); extractAttachmentText.mockReset()
})

describe('POST /api/attachments/[id]/process', () => {
  it('401 without a session', async () => {
    getSession.mockResolvedValue(null)
    expect((await POST(req, ctx(ID))).status).toBe(401)
  })
  it('404 when the attachment is missing/not owned', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } })
    getOwnedAttachment.mockResolvedValue(null)
    expect((await POST(req, ctx(ID))).status).toBe(404)
  })
  it('marks ready and returns status on success', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } })
    getOwnedAttachment.mockResolvedValue(row)
    getObjectBytes.mockResolvedValue(new Uint8Array([1]))
    extractAttachmentText.mockResolvedValue('some extracted text')
    const res = await POST(req, ctx(ID))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ready', filename: 'a.pdf', kind: 'pdf' })
    expect(markAttachmentReady).toHaveBeenCalledOnce()
  })
  it('marks error when extraction throws', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } })
    getOwnedAttachment.mockResolvedValue(row)
    getObjectBytes.mockResolvedValue(new Uint8Array([1]))
    extractAttachmentText.mockRejectedValue(new Error('boom'))
    const res = await POST(req, ctx(ID))
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('error')
    expect(markAttachmentError).toHaveBeenCalledOnce()
  })
  it('marks error when extraction yields empty text', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } })
    getOwnedAttachment.mockResolvedValue(row)
    getObjectBytes.mockResolvedValue(new Uint8Array([1]))
    extractAttachmentText.mockResolvedValue('   ')
    const res = await POST(req, ctx(ID))
    expect((await res.json()).status).toBe('error')
    expect(markAttachmentError).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test "src/app/api/attachments/[id]/process/route.test.ts"`
Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 3: Implement `src/app/api/attachments/[id]/process/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getOwnedAttachment, markAttachmentReady, markAttachmentError } from '@/db/attachment-queries'
import { getObjectBytes } from '@/lib/r2'
import { extractAttachmentText } from '@/lib/attachment-extract'
import type { AttachmentKind } from '@/lib/attachment-kind'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const row = await getOwnedAttachment(id, session.user.id)
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const bytes = await getObjectBytes(row.r2Key)
    const text = await extractAttachmentText({
      kind: row.kind as AttachmentKind,
      bytes,
      mimeType: row.mimeType,
    })
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

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test "src/app/api/attachments/[id]/process/route.test.ts"`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/attachments/[id]/process/route.ts" "src/app/api/attachments/[id]/process/route.test.ts"
git commit -m "feat(attachments): POST /api/attachments/[id]/process (extract)"
```

---

### Task 9: Inject attachment text into `/api/chat`

**Files:**
- Modify: `src/app/api/chat/route.ts`

**Interfaces:**
- Consumes: `collectAttachmentIds`, `buildAttachmentSystemBlock` (Task 4), `loadReadyAttachments` (Task 6).

- [ ] **Step 1: Add imports to `src/app/api/chat/route.ts`**

After the existing imports, add:
```ts
import { collectAttachmentIds, buildAttachmentSystemBlock } from '@/lib/attachment-inject'
import { loadReadyAttachments } from '@/db/attachment-queries'
import type { AttachmentKind } from '@/lib/attachment-kind'
```

- [ ] **Step 2: Change `const system` to `let system` and append the attachment block**

Find this block:
```ts
  const system = existingQuiz
    ? `${BASE_SYSTEM}

The user is refining an existing quiz. Current state:

\`\`\`json
${JSON.stringify(existingQuiz, null, 2)}
\`\`\`

When calling updateQuiz, return the FULL updated quiz including fields the user did not ask to change. Preserve unchanged questions verbatim.`
    : BASE_SYSTEM
```
Change the first line `const system` → `let system`, then immediately after that block insert:
```ts
  // Inject extracted text from any files the user attached (this turn or earlier
  // on the active path). Mirrors the existingQuiz injection above — content lives
  // in the attachments table, never duplicated into message parts.
  const attachmentIds = collectAttachmentIds(messages as { parts?: unknown[] }[])
  if (attachmentIds.length) {
    const ready = await loadReadyAttachments(attachmentIds, session.user.id)
    const block = buildAttachmentSystemBlock(
      ready.map((a) => ({
        id: a.id,
        filename: a.filename,
        kind: a.kind as AttachmentKind,
        extractedText: a.extractedText ?? '',
      }))
    )
    if (block) system = `${system}\n\n${block}`
  }
```

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Verify unknown `data-attachment` parts survive `convertToModelMessages`**

Run: `pnpm test` (whole suite) to confirm nothing regressed, then note for the manual E2E (Task 15): if `/api/chat` throws on the `data-attachment` part, add a filter that strips `data-*` parts before `convertToModelMessages` — e.g.
```ts
const modelMessages = await convertToModelMessages(messages)
```
becomes a map that removes parts whose `type` starts with `data-`. (AI SDK v6 treats `data-*` as UI-only and normally ignores them; only add the filter if the E2E shows an error.)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/chat/route.ts
git commit -m "feat(chat): inject attachment text into the system prompt"
```

---

### Task 10: Re-associate attachments on first save

**Files:**
- Modify: `src/app/api/quizzes/route.ts`

**Interfaces:**
- Consumes: `collectAttachmentIds` (Task 4), `reassociateAttachments` (Task 6).

- [ ] **Step 1: Add imports to `src/app/api/quizzes/route.ts`**

Extend the existing import from `@/lib/chat-messages` is separate; add:
```ts
import { collectAttachmentIds, reassociateAttachments } from '@/db/attachment-queries'
```
Wait — `collectAttachmentIds` lives in `@/lib/attachment-inject`. Add two imports:
```ts
import { collectAttachmentIds } from '@/lib/attachment-inject'
import { reassociateAttachments } from '@/db/attachment-queries'
```

- [ ] **Step 2: Re-link attachments inside the save transaction**

In the `db.transaction(async (tx) => { ... })` block, find where chat rows are inserted:
```ts
    if (incomingMessages.length) {
      const rows = buildChatRowsFromMessages({ ... })
      await tx.insert(chatMessages).values(rows)
      await tx
        .update(quizzes)
        .set({ activeLeafId: rows[rows.length - 1].id })
        .where(eq(quizzes.id, quiz.id))
    }
```
Immediately after that `if` block (still inside the transaction, before `return quiz.id`), add:
```ts
    // Link any files uploaded during the new-quiz session (quizId was null) to the saved quiz.
    const attachmentIds = collectAttachmentIds(incomingMessages as { parts?: unknown[] }[])
    if (attachmentIds.length) {
      await reassociateAttachments(attachmentIds, quiz.id, session.user.id, tx)
    }
```

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors. (If `reassociateAttachments`'s `tx` param type rejects the transaction handle, adjust its signature per Task 6 Step 2's note.)

- [ ] **Step 4: Run the existing quizzes route tests**

Run: `pnpm test src/app/api/quizzes`
Expected: PASS (no regressions).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/quizzes/route.ts
git commit -m "feat(attachments): re-link new-quiz attachments on first save"
```

---

### Task 11: Clean up R2 objects on quiz delete

**Files:**
- Modify: `src/db/quiz-mutations.ts`
- Modify: `src/app/api/quizzes/[id]/route.ts`

**Interfaces:**
- `deleteQuiz(quizId, userId)` now returns `{ ok: boolean; r2Keys: string[] }`.
- Consumes: `listAttachmentKeysForQuiz` (Task 6), `deleteObjects` (Task 1).

- [ ] **Step 1: Update `deleteQuiz` to collect keys before the cascade**

Replace the body of `deleteQuiz` in `src/db/quiz-mutations.ts` with:
```ts
import { db } from '@/db'
import { quizzes } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { listAttachmentKeysForQuiz } from '@/db/attachment-queries'

/**
 * Hard-delete a quiz owned by `userId`. FK ON DELETE CASCADE removes the quiz's
 * questions, chat_messages, and attachments rows. R2 objects are NOT covered by
 * the cascade, so we collect their keys before deleting and return them for the
 * caller to remove from storage.
 */
export async function deleteQuiz(
  quizId: string,
  userId: string
): Promise<{ ok: boolean; r2Keys: string[] }> {
  return db.transaction(async (tx) => {
    const [owned] = await tx
      .select({ id: quizzes.id })
      .from(quizzes)
      .where(and(eq(quizzes.id, quizId), eq(quizzes.userId, userId)))
      .limit(1)
    if (!owned) return { ok: false, r2Keys: [] }

    const r2Keys = await listAttachmentKeysForQuiz(quizId, tx)
    await tx.delete(quizzes).where(eq(quizzes.id, quizId))
    return { ok: true, r2Keys }
  })
}
```

- [ ] **Step 2: Delete the R2 objects in the DELETE route**

In `src/app/api/quizzes/[id]/route.ts`, add the import:
```ts
import { deleteObjects } from '@/lib/r2'
```
Then update the `DELETE` handler's tail:
```ts
  const res = await deleteQuiz(id, session.user.id)
  if (!res.ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Storage cleanup is best-effort: a failed R2 delete must not fail the request
  // (the DB rows are already gone). Orphaned objects can be swept later.
  try {
    await deleteObjects(res.r2Keys)
  } catch (e) {
    console.error('[quizzes/delete] R2 cleanup failed', e)
  }

  return NextResponse.json({ id })
```

- [ ] **Step 3: Update the delete route test for the new return shape**

In `src/app/api/quizzes/[id]/route.test.ts`, the `deleteQuiz` mock currently resolves `{ ok: true }` / `{ ok: false }`. Add `r2Keys: []` to those and mock `@/lib/r2`. At the top with the other mocks add:
```ts
const deleteObjects = vi.fn()
vi.mock('@/lib/r2', () => ({ deleteObjects: (...a: unknown[]) => deleteObjects(...a) }))
```
Change `deleteQuiz.mockResolvedValue({ ok: false })` → `{ ok: false, r2Keys: [] }` and `{ ok: true }` → `{ ok: true, r2Keys: [] }`. In `beforeEach` add `deleteObjects.mockReset()`.

- [ ] **Step 4: Run the tests**

Run: `pnpm test "src/app/api/quizzes/[id]/route.test.ts"`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm exec tsc --noEmit
git add src/db/quiz-mutations.ts "src/app/api/quizzes/[id]/route.ts" "src/app/api/quizzes/[id]/route.test.ts"
git commit -m "feat(attachments): delete R2 objects on quiz delete"
```

---

### Task 12: `useAttachments` composer hook

**Files:**
- Create: `src/components/builder/useAttachments.ts`

**Interfaces:**
- Produces: `type ComposerAttachment = { id: string; filename: string; kind: AttachmentKind; status: 'uploading'|'ready'|'error'; error?: string }`; `useAttachments(quizId?: string)` returning `{ items, anyBusy, addFiles(files: FileList | File[]): void, remove(id: string): void, clear(): void }`.

- [ ] **Step 1: Implement the hook**

(Client hook — no unit test; jsdom is not configured, and the codebase does not unit-test components. Verified via the manual E2E in Task 15.)
```ts
'use client'

import { useState, useCallback, useRef } from 'react'
import { newId } from '@/lib/ids'
import { validateUpload, MAX_FILES_PER_MESSAGE, type AttachmentKind } from '@/lib/attachment-kind'

export type ComposerAttachment = {
  id: string
  filename: string
  kind: AttachmentKind
  status: 'uploading' | 'ready' | 'error'
  error?: string
}

export function useAttachments(quizId?: string) {
  const [items, setItems] = useState<ComposerAttachment[]>([])
  const itemsRef = useRef<ComposerAttachment[]>([])
  itemsRef.current = items

  const patch = useCallback((id: string, next: Partial<ComposerAttachment>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...next } : it)))
  }, [])

  const upload = useCallback(
    async (id: string, file: File) => {
      try {
        const signRes = await fetch('/api/attachments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id,
            filename: file.name,
            mimeType: file.type || 'application/octet-stream',
            sizeBytes: file.size,
            ...(quizId ? { quizId } : {}),
          }),
        })
        if (!signRes.ok) throw new Error((await signRes.json().catch(() => ({})))?.error ?? 'Upload rejected')
        const { uploadUrl } = await signRes.json()

        const putRes = await fetch(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file,
        })
        if (!putRes.ok) throw new Error('Upload failed')

        const procRes = await fetch(`/api/attachments/${id}/process`, { method: 'POST' })
        const proc = await procRes.json().catch(() => ({ status: 'error' }))
        if (proc.status !== 'ready') {
          patch(id, { status: 'error', error: proc.errorMessage ?? 'Could not process file' })
          return
        }
        patch(id, { status: 'ready' })
      } catch (e) {
        patch(id, { status: 'error', error: (e as Error).message })
      }
    },
    [quizId, patch]
  )

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files)
      const room = MAX_FILES_PER_MESSAGE - itemsRef.current.length
      for (const file of list.slice(0, Math.max(0, room))) {
        const v = validateUpload({
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
        })
        const id = newId()
        if (!v.ok) {
          setItems((prev) => [...prev, { id, filename: file.name, kind: 'text', status: 'error', error: v.error }])
          continue
        }
        setItems((prev) => [...prev, { id, filename: file.name, kind: v.kind, status: 'uploading' }])
        void upload(id, file)
      }
    },
    [upload]
  )

  const remove = useCallback((id: string) => setItems((prev) => prev.filter((it) => it.id !== id)), [])
  const clear = useCallback(() => setItems([]), [])

  const anyBusy = items.some((it) => it.status === 'uploading')
  return { items, anyBusy, addFiles, remove, clear }
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm exec tsc --noEmit
git add src/components/builder/useAttachments.ts
git commit -m "feat(attachments): useAttachments composer hook"
```

---

### Task 13: `AttachmentChips` component

**Files:**
- Create: `src/components/builder/AttachmentChips.tsx`

**Interfaces:**
- Consumes: `ComposerAttachment` (Task 12), `AttachmentKind`.
- Produces: `ComposerChips({ items, onRemove })` for the composer, and `MessageChips({ parts })` for rendering `data-attachment` parts inside a message bubble.

- [ ] **Step 1: Implement the component**

```tsx
'use client'

import { X, FileText, Image as ImageIcon, Loader2, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AttachmentKind } from '@/lib/attachment-kind'
import type { ComposerAttachment } from './useAttachments'

function KindIcon({ kind }: { kind: string }) {
  if (kind === 'image') return <ImageIcon className="w-3.5 h-3.5" />
  return <FileText className="w-3.5 h-3.5" />
}

export function ComposerChips({
  items,
  onRemove,
}: {
  items: ComposerAttachment[]
  onRemove: (id: string) => void
}) {
  if (!items.length) return null
  return (
    <div className="flex flex-wrap gap-1.5 mb-2">
      {items.map((it) => (
        <span
          key={it.id}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs',
            it.status === 'error'
              ? 'border-destructive/40 text-destructive bg-destructive/10'
              : 'border-border text-muted-foreground bg-secondary'
          )}
          title={it.error ?? it.filename}
        >
          {it.status === 'uploading' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : it.status === 'error' ? (
            <AlertCircle className="w-3.5 h-3.5" />
          ) : (
            <KindIcon kind={it.kind} />
          )}
          <span className="max-w-[140px] truncate">{it.filename}</span>
          <button type="button" onClick={() => onRemove(it.id)} aria-label={`Remove ${it.filename}`}>
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
    </div>
  )
}

// Read-only chips rendered inside a sent message bubble from data-attachment parts.
export function MessageChips({ parts }: { parts: unknown[] }) {
  const chips = (parts ?? [])
    .map((p) => p as { type?: string; id?: string; filename?: string; kind?: AttachmentKind })
    .filter((p) => p.type === 'data-attachment' && p.filename)
  if (!chips.length) return null
  return (
    <div className="flex flex-wrap gap-1.5 mb-1.5">
      {chips.map((c, i) => (
        <span
          key={c.id ?? i}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-2 py-1 text-xs text-muted-foreground"
        >
          <KindIcon kind={c.kind ?? 'text'} />
          <span className="max-w-[140px] truncate">{c.filename}</span>
        </span>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm exec tsc --noEmit
git add src/components/builder/AttachmentChips.tsx
git commit -m "feat(attachments): attachment chip components"
```

---

### Task 14: Wire attachments into `ChatPanel`

**Files:**
- Modify: `src/components/builder/ChatPanel.tsx`

**Interfaces:**
- Consumes: `useAttachments` (Task 12), `ComposerChips`/`MessageChips` (Task 13), `ACCEPT_ATTR` (Task 3).

- [ ] **Step 1: Add imports**

At the top of `src/components/builder/ChatPanel.tsx`, add:
```ts
import { Paperclip } from 'lucide-react'
import { useAttachments } from './useAttachments'
import { ComposerChips, MessageChips } from './AttachmentChips'
import { ACCEPT_ATTR } from '@/lib/attachment-kind'
```

- [ ] **Step 2: Instantiate the hook + a hidden file input ref**

Inside the `ChatPanel` component, near the other `useRef`/`useState` declarations (after `const [input, setInput] = useState('')`), add:
```ts
  const attachments = useAttachments(quizId)
  const fileInputRef = useRef<HTMLInputElement>(null)
```

- [ ] **Step 3: Include attachment parts when sending, then clear**

In `submit()`, replace:
```ts
  function submit() {
    const text = input.trim()
    if (!text || isLoading) return
    console.log('[ChatPanel] submit:', text)
    setInput('')
    sendMessage({ role: 'user', parts: [{ type: 'text', text }] })
  }
```
with:
```ts
  function submit() {
    const text = input.trim()
    if ((!text && attachments.items.length === 0) || isLoading || attachments.anyBusy) return
    const attachmentParts = attachments.items
      .filter((it) => it.status === 'ready')
      .map((it) => ({ type: 'data-attachment', id: it.id, filename: it.filename, kind: it.kind }))
    const parts = [...(text ? [{ type: 'text', text }] : []), ...attachmentParts]
    setInput('')
    attachments.clear()
    // Data parts are UI-only (data-*); the extracted text is injected server-side.
    sendMessage({ role: 'user', parts } as unknown as Parameters<typeof sendMessage>[0])
  }
```

- [ ] **Step 4: Render composer chips + paperclip + hidden input**

In the input area JSX (the `{/* Input */}` block near the bottom), do two edits.

First, above the `<div className="flex gap-2 items-end">` row, add the chips:
```tsx
        <ComposerChips items={attachments.items} onRemove={attachments.remove} />
```

Second, inside that flex row, immediately after the web-search `<Button>` (the `<Globe />` button) and before the `<Textarea>`, add the paperclip button + hidden input:
```tsx
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT_ATTR}
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) attachments.addFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <Button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            size="icon"
            variant="ghost"
            title="Attach files"
            className="shrink-0 w-11 h-11 border border-border text-muted-foreground"
          >
            <Paperclip className="w-4 h-4" />
          </Button>
```

- [ ] **Step 5: Disable send while a file is still uploading**

In the send `<Button>` at the bottom, change:
```tsx
            disabled={isLoading || !input.trim()}
```
to:
```tsx
            disabled={isLoading || attachments.anyBusy || (!input.trim() && attachments.items.filter((i) => i.status === 'ready').length === 0)}
```

- [ ] **Step 6: Render attachment chips inside user message bubbles**

Find where each message's parts are rendered (the map over `messages`). Inside the user-branch of the message render, before the text/markdown content, add:
```tsx
                <MessageChips parts={(msg as unknown as { parts?: unknown[] }).parts ?? []} />
```
(Place it within the user message bubble container so chips appear above the user's text.)

- [ ] **Step 7: Enable drag-and-drop onto the composer (optional-but-included)**

On the outer input container `<div className="flex-shrink-0 border-t border-border p-4">`, add drop handlers:
```tsx
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            if (e.dataTransfer.files?.length) attachments.addFiles(e.dataTransfer.files)
          }}
```

- [ ] **Step 8: Typecheck + lint**

Run:
```bash
pnpm exec tsc --noEmit
pnpm lint
```
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/components/builder/ChatPanel.tsx
git commit -m "feat(chat): attach files in the builder composer"
```

---

### Task 15: Full suite + manual end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`
Expected: all tests pass (existing + Tasks 1,3,4,5,7,8,11).

- [ ] **Step 2: Provision R2 + env for a live run**

Create a Cloudflare R2 bucket, generate an S3 API token, and set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` in `.env`. In the R2 bucket settings, add a CORS policy allowing `PUT` from the app origin (needed for the browser presigned upload), e.g. allowed origin `http://localhost:3000`, allowed method `PUT`, allowed header `content-type`.

- [ ] **Step 3: Manual E2E on the new-quiz page**

Run `pnpm dev`. On `/dashboard/quizzes/new`:
1. Click the paperclip, pick a small PDF → chip shows spinner then ✓.
2. Type "Make a 5-question quiz from this file" and send.
3. Confirm the quiz preview populates from the file's content.
4. Confirm the sent user bubble shows the file chip.
5. Save the quiz. Reload the editor page → confirm the chat history + chip still render, and a follow-up ("add 3 more questions from the document") still uses the file (verifies `/api/chat` re-scans history and `data-attachment` parts survive `convertToModelMessages` — if the request errors here, apply the `data-*` strip from Task 9 Step 4).
6. Upload an image (photo of notes) → confirm text is transcribed and used.
7. Upload an unsupported type (e.g. `.mp4`) → confirm an error chip, and that send still works without it.
8. Delete the quiz → confirm no error (R2 objects removed best-effort).

- [ ] **Step 4: Final commit (if any fixes were needed)**

```bash
git add -A
git commit -m "fix(attachments): e2e follow-ups"
```

---

## Self-Review Notes (author)

- **Spec coverage:** §3 flow → Tasks 7,8,9; §4 storage/schema → Tasks 1,2,6; §5 extraction → Task 5; §6 API → Tasks 7,8; §7 injection/token cap → Tasks 4,9; §8 client UX → Tasks 12,13,14; §9 validation/security → Tasks 3,7 (+ auth/ownership across all routes); §10 testing → per-task tests + Task 15; new-quiz reconcile → Task 10; R2 cleanup on delete → Task 11.
- **Type consistency:** `extractAttachmentText({kind,bytes,mimeType})`, `buildAttachmentSystemBlock(ReadyAttachment[])`, `collectAttachmentIds(messages)`, `deleteQuiz → {ok,r2Keys}` used identically across producing/consuming tasks. `data-attachment` part shape `{type,id,filename,kind}` is consistent in send (Task 14), collect (Task 4), render (Task 13), reassociate (Task 10).
- **Known risk flagged inline:** exact `officeparser` export (Task 5 Step 5) and `data-*` part handling by `convertToModelMessages` (Task 9 Step 4) each have a verification step with a concrete fallback.
