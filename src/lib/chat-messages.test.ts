import { describe, it, expect } from 'vitest'
import {
  dbRowToUIMessage,
  extractQuizFromParts,
  collectToolCallIds,
} from './chat-messages'

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
