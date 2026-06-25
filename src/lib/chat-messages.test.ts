import { describe, it, expect } from 'vitest'
import {
  dbRowToUIMessage,
  extractQuizFromParts,
  collectToolCallIds,
  buildTurnMessages,
  buildChatRowsFromMessages,
  extractSources,
} from './chat-messages'
import { newId } from './ids'

const quiz = { title: 'Bio', questions: [] }
const toolPart = {
  type: 'tool-updateQuiz',
  state: 'output-available',
  toolCallId: 'call_1',
  output: { quiz },
}

describe('dbRowToUIMessage', () => {
  it('keeps id/role/parts', () => {
    const row = { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }
    expect(dbRowToUIMessage(row)).toEqual({
      id: 'm1',
      role: 'user',
      parts: [{ type: 'text', text: 'hi' }],
    })
  })
})

describe('extractQuizFromParts', () => {
  it('returns the quiz from a completed updateQuiz part', () => {
    expect(extractQuizFromParts([{ type: 'text', text: 'ok' }, toolPart])).toEqual(quiz)
  })
  it('ignores parts still streaming (no output)', () => {
    expect(
      extractQuizFromParts([{ type: 'tool-updateQuiz', state: 'input-available', toolCallId: 'c' }])
    ).toBeNull()
  })
  it('returns null when no tool part present', () => {
    expect(extractQuizFromParts([{ type: 'text', text: 'hi' }])).toBeNull()
  })
})

describe('collectToolCallIds', () => {
  it('collects ids across messages', () => {
    const msgs = [{ parts: [{ type: 'text', text: 'x' }] }, { parts: [toolPart] }]
    expect(collectToolCallIds(msgs)).toEqual(['call_1'])
  })
})

describe('buildTurnMessages', () => {
  const base = { quizId: newId(), userId: 'user_text_id', parentId: null }

  it('throws when the assistant responseMessage has no id (reproduces the 500)', () => {
    expect(() =>
      buildTurnMessages({
        ...base,
        incomingUser: { id: newId(), role: 'user', parts: [{ type: 'text', text: 'hi' }] },
        responseMessage: { parts: [] }, // no id assigned — the original bug
      })
    ).toThrow(/assistant message id/i)
  })

  it('throws when the user message id is not a uuid (nanoid latent bug)', () => {
    expect(() =>
      buildTurnMessages({
        ...base,
        incomingUser: { id: 'aB3xZ9q', role: 'user', parts: [] }, // ai-sdk default nanoid
        responseMessage: { id: newId(), parts: [] },
      })
    ).toThrow(/user message id/i)
  })

  it('builds valid rows; assistant.parentId links to the user id; snapshot extracted', () => {
    const userMsgId = newId()
    const assistantMsgId = newId()
    const { userMessage, assistantMessage } = buildTurnMessages({
      ...base,
      incomingUser: { id: userMsgId, role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      responseMessage: { id: assistantMsgId, parts: [toolPart] },
    })
    expect(userMessage.id).toBe(userMsgId)
    expect(userMessage.parentId).toBeNull()
    expect(userMessage.role).toBe('user')
    expect(assistantMessage.id).toBe(assistantMsgId)
    expect(assistantMessage.parentId).toBe(userMsgId)
    expect(assistantMessage.role).toBe('assistant')
    expect(assistantMessage.quizSnapshot).toEqual(quiz)
  })
})

describe('buildChatRowsFromMessages', () => {
  it('returns [] for no messages', () => {
    expect(buildChatRowsFromMessages({ quizId: newId(), userId: 'u', messages: [] })).toEqual([])
  })

  it('links rows into a linear parent chain in order; assistant snapshot extracted', () => {
    const a = newId()
    const b = newId()
    const c = newId()
    const rows = buildChatRowsFromMessages({
      quizId: newId(),
      userId: 'u',
      messages: [
        { id: a, role: 'user', parts: [{ type: 'text', text: 'hi' }] },
        { id: b, role: 'assistant', parts: [toolPart] },
        { id: c, role: 'user', parts: [] },
      ],
    })
    expect(rows.map((r) => r.id)).toEqual([a, b, c])
    expect(rows.map((r) => r.parentId)).toEqual([null, a, b])
    expect(rows[0].quizSnapshot).toBeNull()
    expect(rows[1].quizSnapshot).toEqual(quiz)
  })

  it('throws when a message id is not a uuid', () => {
    expect(() =>
      buildChatRowsFromMessages({
        quizId: newId(),
        userId: 'u',
        messages: [{ id: 'aB3xZ9q', role: 'user', parts: [] }],
      })
    ).toThrow(/uuid/i)
  })
})

describe('extractSources', () => {
  const src = (url: string, title?: string) => ({ type: 'source-url', sourceId: url, url, title })

  it('returns url + title from source-url parts', () => {
    expect(
      extractSources([{ type: 'text', text: 'hi' }, src('https://a.com/x', 'A Title')])
    ).toEqual([{ url: 'https://a.com/x', title: 'A Title' }])
  })

  it('falls back to the url when title is missing or blank', () => {
    expect(extractSources([src('https://a.com/x', '   ')])).toEqual([
      { url: 'https://a.com/x', title: 'https://a.com/x' },
    ])
    expect(extractSources([src('https://b.com')])).toEqual([
      { url: 'https://b.com', title: 'https://b.com' },
    ])
  })

  it('dedupes by url, keeping first occurrence', () => {
    expect(
      extractSources([src('https://a.com', 'First'), src('https://a.com', 'Second')])
    ).toEqual([{ url: 'https://a.com', title: 'First' }])
  })

  it('ignores non-source and malformed parts; empty input → []', () => {
    expect(extractSources([{ type: 'tool-updateQuiz' }, { type: 'source-url' }])).toEqual([])
    expect(extractSources([])).toEqual([])
    expect(extractSources(undefined as unknown as unknown[])).toEqual([])
  })
})
