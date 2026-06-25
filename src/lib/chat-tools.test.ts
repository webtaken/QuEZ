import { describe, it, expect } from 'vitest'

// The OpenRouter provider's default instance may read OPENROUTER_API_KEY at import time.
// A dummy value is enough — buildChatTools only constructs tool descriptors, no network.
process.env.OPENROUTER_API_KEY ??= 'test-key'

import { buildChatTools } from './chat-tools'

describe('buildChatTools', () => {
  it('always includes the updateQuiz tool', () => {
    expect(Object.keys(buildChatTools({ webSearch: false }))).toEqual(['updateQuiz'])
  })

  it('adds web_search only when webSearch is enabled', () => {
    const keys = Object.keys(buildChatTools({ webSearch: true }))
    expect(keys).toContain('updateQuiz')
    expect(keys).toContain('web_search')
  })
})
