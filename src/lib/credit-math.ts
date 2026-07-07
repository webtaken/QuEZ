// AI credits pricing. 1 credit = $0.01 of retail value; debits apply MARGIN on
// the raw OpenRouter cost, so credits = rawCostUsd * MARGIN / CREDIT_USD_VALUE.
export const CREDIT_USD_VALUE = 0.01
export const MARGIN = 5
export const SIGNUP_GRANT_CREDITS = 100
// Floor for any completed generation, so a reported $0 cost is never free.
export const MIN_DEBIT_CREDITS = 0.01
// Conservative estimate used only when OpenRouter omits the cost field ($2/M tokens).
export const FALLBACK_USD_PER_TOKEN = 0.000002

export function usdToCredits(rawCostUsd: number): number {
  return (rawCostUsd * MARGIN) / CREDIT_USD_VALUE
}

// Structurally matches AI SDK StepResult (streamText onFinish steps and
// generateText result.steps) without importing SDK types.
export type StepLike = {
  providerMetadata?: { openrouter?: { usage?: { cost?: number } } }
}

// Sums the OpenRouter-reported USD cost across all steps (tool round-trips
// included; the web-search fee lands in the same cost field). Falls back to a
// token-count estimate when no step reports a cost.
export function computeDebit(args: {
  steps: StepLike[]
  totalTokens: number | undefined
}): { credits: number; rawCostUsd: number; usedFallback: boolean } {
  let rawCostUsd = 0
  let reported = false
  for (const step of args.steps) {
    const cost = step.providerMetadata?.openrouter?.usage?.cost
    if (typeof cost === 'number' && cost >= 0) {
      rawCostUsd += cost
      reported = true
    }
  }
  const usedFallback = !reported
  if (usedFallback) rawCostUsd = (args.totalTokens ?? 0) * FALLBACK_USD_PER_TOKEN
  const credits = Math.max(usdToCredits(rawCostUsd), MIN_DEBIT_CREDITS)
  return { credits, rawCostUsd, usedFallback }
}

export function formatCredits(balance: number): string {
  return (Math.floor(balance * 10) / 10).toFixed(1)
}
