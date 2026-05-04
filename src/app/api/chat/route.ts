import { streamText, tool, convertToModelMessages, type UIMessage } from 'ai'
import { openrouter } from '@openrouter/ai-sdk-provider'
import { quizPayloadSchema, type QuizPayload } from '@/lib/quiz-schema'

const BASE_SYSTEM = `You are QuEZ AI, an expert quiz builder assistant. When the user describes a quiz they want, call the updateQuiz tool to output the full structured quiz data.

Always:
- Generate clear, accurate questions appropriate for the target audience
- Provide exactly 4 answer options for multiple_choice, or 2 options (["True", "False"]) for true_false
- Include a brief explanation for each correct answer
- Set appropriate time limits: easy questions 30s, complex ones 45-60s
- Suggest a relevant topic, audience level, and difficulty
- Pick a fitting emoji as the cover
- After calling the tool, briefly confirm what you built and offer to refine it

If the user asks to change something, call updateQuiz again with the updated quiz.`

export async function POST(req: Request) {
  console.log('[chat] POST hit')
  const {
    messages,
    existingQuiz,
  }: { messages: UIMessage[]; existingQuiz?: QuizPayload } = await req.json()
  console.log(
    '[chat] messages count:',
    messages?.length,
    'last role:',
    messages?.[messages.length - 1]?.role,
    'existingQuiz:',
    !!existingQuiz
  )
  console.log('[chat] OPENROUTER_API_KEY present:', !!process.env.OPENROUTER_API_KEY, 'len:', process.env.OPENROUTER_API_KEY?.length)

  const modelId = 'deepseek/deepseek-v4-flash'
  console.log('[chat] using model:', modelId)

  const system = existingQuiz
    ? `${BASE_SYSTEM}

The user is refining an existing quiz. Current state:

\`\`\`json
${JSON.stringify(existingQuiz, null, 2)}
\`\`\`

When calling updateQuiz, return the FULL updated quiz including fields the user did not ask to change. Preserve unchanged questions verbatim.`
    : BASE_SYSTEM

  const result = streamText({
    model: openrouter(modelId),
    onChunk: ({ chunk }) => {
      console.log('[chat] chunk type:', chunk.type)
    },
    onFinish: ({ finishReason, usage, text, toolCalls }) => {
      console.log('[chat] finish reason:', finishReason, 'usage:', usage, 'text len:', text?.length, 'toolCalls:', toolCalls?.length)
    },
    system,
    messages: await convertToModelMessages(messages),
    tools: {
      updateQuiz: tool({
        description:
          'Update the quiz preview panel with structured quiz data. Call this whenever building or updating a quiz.',
        inputSchema: quizPayloadSchema,
        execute: async (quizData) => {
          console.log('[chat] updateQuiz tool called — title:', quizData.title, 'questions:', quizData.questions?.length)
          return { success: true, quiz: quizData }
        },
      }),
    },
  })

  return result.toUIMessageStreamResponse({
    onError: (error) => {
      console.error('[chat route error]', JSON.stringify(error, Object.getOwnPropertyNames(error as object), 2))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cause = (error as any)?.cause
      if (cause) {
        console.error('[chat route cause]', JSON.stringify(cause, Object.getOwnPropertyNames(cause), 2))
        if (Array.isArray(cause.errors)) {
          cause.errors.forEach((e: unknown, i: number) =>
            console.error(`[cause.errors[${i}]]`, JSON.stringify(e, Object.getOwnPropertyNames(e as object), 2))
          )
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyErr = error as any
      const parts = [
        anyErr?.name,
        anyErr?.message,
        anyErr?.statusCode && `status=${anyErr.statusCode}`,
        anyErr?.responseBody && `body=${typeof anyErr.responseBody === 'string' ? anyErr.responseBody : JSON.stringify(anyErr.responseBody)}`,
        anyErr?.cause?.message,
      ].filter(Boolean)
      return parts.join(' | ') || String(error)
    },
  })
}
