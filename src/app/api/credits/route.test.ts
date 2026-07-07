import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}))

const getSession = vi.fn()
vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: () => getSession() } },
}))

const getBalance = vi.fn()
const listTransactions = vi.fn()
vi.mock('@/db/credit-queries', () => ({
  getBalance: (...a: unknown[]) => getBalance(...a),
  listTransactions: (...a: unknown[]) => listTransactions(...a),
}))

process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test'

const { GET } = await import('./route')

beforeEach(() => {
  getSession.mockReset()
  getBalance.mockReset()
  listTransactions.mockReset()
})

describe('GET /api/credits', () => {
  it('returns 401 when there is no session', async () => {
    getSession.mockResolvedValue(null)
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('returns the balance and recent transactions for the session user', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } })
    getBalance.mockResolvedValue(82.5)
    const tx = [
      {
        id: 't1',
        amount: -0.5,
        balanceAfter: 82.5,
        type: 'chat',
        metadata: {
          // whitelisted
          webSearch: true,
          inputTokens: 120,
          outputTokens: 45,
          quizId: 'q1',
          // must NOT be exposed to the client
          rawCostUsd: 0.0012,
          usedFallback: false,
          model: 'deepseek/deepseek-v4-flash',
        },
      },
    ]
    listTransactions.mockResolvedValue(tx)
    const res = await GET()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      balance: 82.5,
      transactions: [
        {
          id: 't1',
          amount: -0.5,
          balanceAfter: 82.5,
          type: 'chat',
          metadata: { webSearch: true, inputTokens: 120, outputTokens: 45, quizId: 'q1' },
        },
      ],
    })
    expect(getBalance).toHaveBeenCalledWith('u1')
    expect(listTransactions).toHaveBeenCalledWith('u1', 100)
  })
})
