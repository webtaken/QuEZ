import { tool, type ToolSet } from 'ai'
import { openrouter } from '@openrouter/ai-sdk-provider'
import { quizPayloadSchema } from '@/lib/quiz-schema'

// Cap results so each web search stays at ~$0.005 (OpenRouter Exa fallback pricing).
const WEB_SEARCH_MAX_RESULTS = 5

// Assemble the chat tool set. The updateQuiz tool is always present. When the user
// enables web search, the OpenRouter web-search server tool is added — it is
// provider-executed and model-invoked, so the model searches only when it judges
// the query needs external facts (no client-side execute, no extra streamText step).
export function buildChatTools({ webSearch }: { webSearch: boolean }): ToolSet {
  const updateQuiz = tool({
    description:
      'Update the quiz preview panel with structured quiz data. Call this whenever building or updating a quiz.',
    // Music is creator-only (picked in the editor dropdown); the agent must not
    // set or clear it, so it is stripped from the tool schema.
    inputSchema: quizPayloadSchema.omit({ musicTrack: true }),
    execute: async (quizData) => {
      return { success: true, quiz: quizData }
    },
  })

  if (webSearch) {
    return {
      updateQuiz,
      web_search: openrouter.tools.webSearch({ maxResults: WEB_SEARCH_MAX_RESULTS }),
    }
  }

  return { updateQuiz }
}
