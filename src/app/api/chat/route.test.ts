import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}))

const getSession = vi.fn()
vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: () => getSession() } },
}))

const getBalance = vi.fn()
const debitCredits = vi.fn()
vi.mock('@/db/credit-queries', () => ({
  getBalance: (...a: unknown[]) => getBalance(...a),
  debitCredits: (...a: unknown[]) => debitCredits(...a),
}))

const streamText = vi.fn()
vi.mock('ai', () => ({
  streamText: (...a: unknown[]) => streamText(...a),
  convertToModelMessages: async () => [],
}))

const openrouterFactory = vi.fn((id: string, opts?: unknown) => ({ id, opts }))
vi.mock('@openrouter/ai-sdk-provider', () => ({
  openrouter: (id: string, opts?: unknown) => openrouterFactory(id, opts),
}))

vi.mock('@/lib/chat-tools', () => ({ buildChatTools: () => ({}) }))
vi.mock('@/db/chat-queries', () => ({ persistTurn: vi.fn() }))
vi.mock('@/lib/chat-messages', () => ({
  buildTurnMessages: () => ({ userMessage: {}, assistantMessage: {} }),
}))
vi.mock('@/lib/ids', () => ({ newId: () => '00000000-0000-4000-8000-000000000000' }))
vi.mock('@/lib/attachment-inject', () => ({
  collectAttachmentIds: () => [],
  buildAttachmentSystemBlock: () => '',
}))
vi.mock('@/db/attachment-queries', () => ({ loadReadyAttachments: async () => [] }))

process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test'

const { POST } = await import('./route')

function chatRequest() {
  return new Request('http://test/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
    }),
  })
}

beforeEach(() => {
  getSession.mockReset()
  getBalance.mockReset()
  debitCredits.mockReset()
  streamText.mockReset()
  streamText.mockReturnValue({
    toUIMessageStreamResponse: () => new Response('stream'),
  })
})

describe('POST /api/chat credits', () => {
  it('returns 401 when there is no session', async () => {
    getSession.mockResolvedValue(null)
    const res = await POST(chatRequest())
    expect(res.status).toBe(401)
    expect(streamText).not.toHaveBeenCalled()
  })

  it('returns 402 and skips the model call when balance is 0', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } })
    getBalance.mockResolvedValue(0)
    const res = await POST(chatRequest())
    expect(res.status).toBe(402)
    await expect(res.json()).resolves.toEqual({ error: 'insufficient_credits' })
    expect(streamText).not.toHaveBeenCalled()
  })

  it('streams when balance is positive and enables usage accounting', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } })
    getBalance.mockResolvedValue(42)
    const res = await POST(chatRequest())
    expect(res.status).toBe(200)
    expect(streamText).toHaveBeenCalledOnce()
    expect(openrouterFactory).toHaveBeenCalledWith(
      'deepseek/deepseek-v4-flash',
      expect.objectContaining({ usage: { include: true } })
    )
  })

  it('debits from summed step costs in onFinish', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } })
    getBalance.mockResolvedValue(42)
    await POST(chatRequest())
    const config = streamText.mock.calls[0][0] as {
      onFinish: (e: unknown) => Promise<void>
    }
    await config.onFinish({
      steps: [{ providerMetadata: { openrouter: { usage: { cost: 0.002 } } } }],
      totalUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    })
    expect(debitCredits).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        credits: 1, // 0.002 * 500
        type: 'chat',
        metadata: expect.objectContaining({ rawCostUsd: 0.002, usedFallback: false }),
      })
    )
  })

  it('never throws out of onFinish when the debit fails', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } })
    getBalance.mockResolvedValue(42)
    debitCredits.mockRejectedValue(new Error('db down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await POST(chatRequest())
    const config = streamText.mock.calls[0][0] as {
      onFinish: (e: unknown) => Promise<void>
    }
    await expect(
      config.onFinish({ steps: [], totalUsage: { totalTokens: 10 } })
    ).resolves.toBeUndefined()
  })
})
