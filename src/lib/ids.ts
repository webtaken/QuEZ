// Chat message ids are stored in Postgres `uuid` columns (chat_messages.id,
// parent_id, quizzes.active_leaf_id) and must match the id useChat renders
// client-side. The AI SDK default id generator emits short nanoids, which are
// neither valid uuids nor coordinated between client and server — so both the
// client (useChat generateId) and server (toUIMessageStreamResponse
// generateMessageId) generate ids through this single helper.
export function newId(): string {
  return crypto.randomUUID()
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}
