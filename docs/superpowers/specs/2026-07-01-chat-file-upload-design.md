# File Upload in Chat — Design

**Date:** 2026-07-01
**Status:** Approved (design); pending implementation plan
**Feature:** Let a user upload files (PDF, Word, PowerPoint, Excel, text/markdown, images)
into the quiz-builder chat and build/refine quizzes from their content.

---

## 1. Goal & Scope

Add file upload to the builder chat so the assistant can use the **content of uploaded
files** as source material — e.g. "generate a quiz from this PDF", "add 5 questions from
the diagram in this image".

**Decided during brainstorming:**

- **Formats (widest set):** PDF, `.txt`/`.md`, `.docx`, images, `.pptx`, `.xlsx`
  (plus what `officeParser` gives for free: `.csv`, `.odt/.odp/.ods`, `.html`, `.rtf`).
- **Size/volume:** medium — up to ~50 pages / one chapter. No RAG/chunking in v1.
- **Lifecycle:** files are **attached to the quiz** — persisted, shown in chat history,
  reusable across later turns and branches (not ephemeral).
- **Approach:** **extract-everything-to-text**, keep the existing cheap text model
  (`deepseek/deepseek-v4-flash`) for chat. Extracted text is injected server-side into the
  system prompt (mirrors how `existingQuiz` is injected today).
- **Storage:** raw bytes in **Cloudflare R2**; extracted text + metadata in Postgres.
- **Images:** handled by a cheap vision model at upload time
  (`google/gemini-2.5-flash-lite`), not chat-time native vision.

**Non-goals (YAGNI):** RAG / vector search / chunking; native multimodal in the chat model;
whole-textbook (100+ page) handling; in-place file editing or re-extraction; audio/video;
a file manager UI. Scanned/text-less PDF OCR is an edge case (see §7) — likely deferred.

---

## 2. Background — current architecture (verified)

- **Backend:** `src/app/api/chat/route.ts` calls
  `streamText({ model: openrouter('deepseek/deepseek-v4-flash'), system, messages, tools })`
  and returns `result.toUIMessageStreamResponse({ ..., onFinish })`. The `system` string is
  already **augmented per request** with `existingQuiz` JSON — the exact seam we reuse for
  injecting file text. Tool-calling is in use (`updateQuiz`).
- **Frontend:** `src/components/builder/ChatPanel.tsx` uses `useChat` from `@ai-sdk/react`
  with a `DefaultChatTransport` whose `body:` callback already attaches `existingQuiz`,
  `quizId`, `parentId`, `webSearch` at send time. Messages render by iterating
  `message.parts`.
- **Persistence & branching:** `chat_messages` (`src/db/schema.ts`) stores `parts` (JSONB),
  `parentId`, `quizSnapshot`; `persistTurn` (`src/db/chat-queries.ts`) writes user +
  assistant rows in the route's `onFinish`. A message tree (`src/lib/chat-tree.ts`) drives
  branch switching, edits, versioning.
- **New-quiz flow:** for an unsaved quiz, `quizId` is undefined and chat history is persisted
  only when the quiz is first saved (commit `2e31b4c`). File attachments follow the same
  reconcile-on-first-save pattern.
- **Versions:** `ai@^6`, `@ai-sdk/react@^3`, `@openrouter/ai-sdk-provider@^2.9.0`,
  `next@16`, `react@19`, `drizzle-orm`, `pg`. **Next 16 has breaking changes — read
  `node_modules/next/dist/docs/` before writing route handlers.**

---

## 3. Architecture & data flow

```
[composer] pick / drag file
   │
   ▼
POST /api/attachments            → validate type+size, insert attachments row (pending),
   │                                return { id, uploadUrl (presigned PUT), r2Key }
   ▼
browser PUT bytes ──────────────► Cloudflare R2   (direct upload, bypasses Vercel ~4.5MB
   │                                               serverless request-body limit)
   ▼
POST /api/attachments/:id/process → server GETs bytes from R2
   │                                → text formats: officeParser → Markdown
   │                                → images: gemini-2.5-flash-lite (transcribe + describe)
   │                                → update row: status=ready, extractedText, meta
   ▼
chip "📎 notes.pdf ✓" in composer, send enabled
   │
   ▼
sendMessage: user text + light data parts { type:'data-attachment', id, filename, kind }
   │
   ▼
POST /api/chat  → load ready attachments for referenced ids (this turn + active path)
   │             → inject their extractedText into `system` (like existingQuiz)
   ▼
deepseek/deepseek-v4-flash → updateQuiz tool (unchanged) → preview updates
```

**Key property:** extracted text is stored **once** in Postgres and injected **server-side**;
it never gets duplicated into every message's stored `parts`. Message `parts` carry only a
tiny reference, so branching, versioning, and persistence are unaffected.

---

## 4. Storage & schema

**R2:**
- Object key: `attachments/{userId}/{attachmentId}/{filename}`.
- Access via `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, S3-compatible endpoint
  `https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, `region: 'auto'`.
- **Presigned PUT** for browser→R2 upload; **presigned GET** (short TTL) only if we later
  need to re-read the original (e.g. native-vision upgrade or user download).
- Env: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`
  (add to `.env.example`).

**New table `attachments`** (`src/db/schema.ts`):

| column | type | notes |
|---|---|---|
| `id` | uuid pk | client-generated (matches existing id convention) |
| `userId` | text → users | scoping; cascade on user delete |
| `quizId` | uuid → quizzes, **nullable** | null until an unsaved quiz is first saved |
| `filename` | text | original name |
| `mimeType` | text | validated |
| `sizeBytes` | integer | validated |
| `r2Key` | text | object key |
| `kind` | text | `'pdf'\|'docx'\|'pptx'\|'xlsx'\|'text'\|'image'` |
| `status` | text | `'pending'\|'ready'\|'error'` |
| `extractedText` | text (nullable) | Markdown / transcription |
| `errorMessage` | text (nullable) | for `status='error'` |
| `meta` | jsonb (nullable) | `{ pageCount?, truncated?, charCount? }` |
| `createdAt` | timestamp | |

Indexes on `quizId` and `userId`. On quiz hard-delete, delete R2 objects for the quiz's
attachments (extend existing delete-quiz flow); DB rows cascade.

Queries live in a new `src/db/attachment-queries.ts` (mirrors `chat-queries.ts`).

---

## 5. Extraction pipeline

New module `src/lib/attachment-extract.ts` — a single dispatch keyed by `kind`:

- **Text formats** (`pdf`, `docx`, `pptx`, `xlsx`, `text`/`.md`/`.csv`/`.html`, ODF):
  `officeParser` → `ast.to('md')` → Markdown. OCR **off** (`ocr:false`) for speed. Pure
  JS/WASM (PDF via `pdfjs-dist`), no native binaries → Vercel-safe.
- **Images** (`image`): call OpenRouter `google/gemini-2.5-flash-lite` with the image and a
  fixed prompt — "Transcribe all text verbatim, then describe any diagrams, figures, charts,
  or handwriting." Store the response as `extractedText`.
- **Dispatch** maps mime/extension → `kind` → extractor. Unknown/unsupported → validation
  error before upload (see §8).

**Chosen over alternatives:** MarkItDown (Python-only, would need a sidecar service —
rejected); per-format libs (`unpdf`+`mammoth`+`xlsx`+`officeparser` — more deps, no gain);
Tesseract.js for images (heavy WASM cold-start, no diagram/figure understanding — a vision
LLM is better for quiz generation and cheaper to operate here).

**New deps:** `officeparser`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`.
Images reuse the existing `@openrouter/ai-sdk-provider`.

---

## 6. API endpoints (Next 16 route handlers)

- **`POST /api/attachments`** — body `{ id, filename, mimeType, sizeBytes, quizId? }`.
  Auth via `auth.api.getSession`. Validate type + size (§8). Insert `pending` row. Return
  `{ id, uploadUrl }` (presigned PUT scoped to the computed `r2Key`).
- **`POST /api/attachments/:id/process`** — auth + ownership check. GET bytes from R2,
  run extractor (§5), truncate to the per-file token budget (§7), update row to `ready`
  (or `error` with `errorMessage`). Return `{ status, filename, kind, errorMessage? }`.
- **Chat route (`/api/chat`)** — extended, not new (§7).
- **Delete:** no dedicated endpoint in v1 — attachment rows + R2 objects are cleaned when
  their quiz is deleted (extend the existing delete-quiz flow). Removing a chip before send
  is client-only (the orphaned `pending` row is harmless; a later sweep can GC).

Run these handlers on the **Node.js runtime** (officeParser + aws-sdk need Node APIs).

---

## 7. Chat-route injection & token strategy

In `src/app/api/chat/route.ts`:

1. Read attachment ids from the incoming user message's `data-attachment` parts **and**
   from earlier messages on the active path (so "add more from the doc" works on later
   turns without re-uploading).
2. Load those `attachments` rows where `status='ready'` and `userId` matches.
3. Build an injection block appended to `system` (after the `existingQuiz` block):

   ```
   The user attached these materials. Use them as the source for the quiz.

   --- notes.pdf (pdf) ---
   <extractedText>

   --- diagram.png (image) ---
   <extractedText>
   ```

4. **Token cap:** truncate each file's text to ~12k tokens (with a "…[truncated]" marker in
   `meta.truncated`). Even though Q2 allows ~50-page docs, this bounds per-turn cost and
   keeps well inside the model context. Total injected budget also capped across files.

Extraction text is authored at process time, so chat turns stay cheap and deterministic.

---

## 8. Client UX (ChatPanel)

- **Composer:** add a 📎 paperclip button next to the 🌐 web-search toggle, plus drag-and-drop
  onto the composer area. `<input type="file">` with the accepted mime/extension allowlist.
- **Attaching:** on select → `POST /api/attachments` → browser `PUT` to `uploadUrl` →
  `POST /api/attachments/:id/process`. Show a per-file chip: uploading spinner → ✓ ready.
  Send stays disabled while any chip is still uploading/processing.
- **Multi-file:** allow up to **3 files per message**.
- **On send:** include text plus `data-attachment` parts. In the rendered message bubble,
  show attachment chips (icon by `kind` + filename). Chips are removable before send.
- **Errors:** a failed extraction shows an error chip (removable); the user can still send —
  the quiz build proceeds without that file.

---

## 9. Validation, limits, security

- **Size:** max **15 MB/file** (rejected at the sign step via `sizeBytes`; belt-and-suspenders
  since presigned PUT can also constrain `ContentType`).
- **Type allowlist:** mime **and** extension must both be recognized → mapped to a `kind`.
  Anything else is rejected before an R2 object is created.
- **Auth/ownership:** every endpoint requires a session; `attachments.userId` must match the
  caller. R2 keys are namespaced by `userId`. Presigned URLs are short-TTL and per-key.
- **Injection safety:** extracted text is untrusted user content placed in `system`; the
  block is clearly framed as "source material," and the model's only side effect is the
  `updateQuiz` tool (structured output) — no shell/file/network capability to abuse.

---

## 10. Testing (Vitest, matching `src/lib/chat-*.test.ts`)

- **Extraction dispatch:** mime/extension → `kind` → correct extractor selected; unknown
  types rejected.
- **Injection builder:** given N ready attachments, produces the expected `system` block;
  respects per-file and total token caps and sets `meta.truncated`.
- **Validation:** size and type limits reject as specified.
- **New-quiz reconcile:** attachments with `quizId=null` are re-associated when the quiz is
  first saved (parallels the chat-history reconcile).
- Extractor internals (officeParser, gemini) are mocked; tests cover our dispatch/build glue,
  not third-party parsing.

---

## 11. Deferred / future

- Native multimodal in the chat model (send images/PDFs directly for higher-fidelity
  reasoning) — the R2 original is kept so this is a later upgrade, not a rewrite.
- Scanned/text-less PDF fallback (detect empty extraction → officeParser `ocr:true` or
  render-page→vision).
- Large-document handling (chunking / RAG) for 100+ page sources.
- Attachment management UI (list, re-use across quizzes, delete individual files).
