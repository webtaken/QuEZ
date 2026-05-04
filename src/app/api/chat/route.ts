import { streamText, tool, convertToModelMessages, type UIMessage } from 'ai'
import { openrouter } from '@openrouter/ai-sdk-provider'
import { z } from 'zod'

export async function POST(req: Request) {
  console.log('[chat] POST hit')
  const { messages }: { messages: UIMessage[] } = await req.json()
  console.log('[chat] messages count:', messages?.length, 'last role:', messages?.[messages.length - 1]?.role)
  console.log('[chat] OPENROUTER_API_KEY present:', !!process.env.OPENROUTER_API_KEY, 'len:', process.env.OPENROUTER_API_KEY?.length)

  const modelId = 'deepseek/deepseek-v4-flash'
  console.log('[chat] using model:', modelId)

  const result = streamText({
    model: openrouter(modelId),
    onChunk: ({ chunk }) => {
      console.log('[chat] chunk type:', chunk.type)
    },
    onFinish: ({ finishReason, usage, text, toolCalls }) => {
      console.log('[chat] finish reason:', finishReason, 'usage:', usage, 'text len:', text?.length, 'toolCalls:', toolCalls?.length)
    },
    system: `You are QuEZ AI, an expert quiz builder assistant. When the user describes a quiz they want, call the updateQuiz tool to output the full structured quiz data.

Always:
- Generate clear, accurate questions appropriate for the target audience
- Provide exactly 4 answer options for multiple_choice, or 2 options (["True", "False"]) for true_false
- Include a brief explanation for each correct answer
- Set appropriate time limits: easy questions 30s, complex ones 45-60s
- Suggest a relevant topic, audience level, and difficulty
- Pick a fitting emoji as the cover
- After calling the tool, briefly confirm what you built and offer to refine it

If the user asks to change something, call updateQuiz again with the updated quiz.`,
    messages: await convertToModelMessages(messages),
    tools: {
      updateQuiz: tool({
        description:
          'Update the quiz preview panel with structured quiz data. Call this whenever building or updating a quiz.',
        inputSchema: z.object({
          title: z.string().describe('Quiz title'),
          description: z.string().describe('Short description of the quiz'),
          topic: z.string().describe('Subject area e.g. Mathematics, Biology, History'),
          audience: z
            .string()
            .describe(
              'Target audience e.g. Elementary School, High School, Undergraduate, Professional'
            ),
          difficulty: z.enum(['easy', 'medium', 'hard']),
          coverEmoji: z.string().describe('Single emoji representing the quiz topic'),
          questions: z.array(
            z.object({
              order: z.number().int().min(1),
              text: z.string().describe('The question text'),
              type: z.enum(['multiple_choice', 'true_false']),
              options: z.array(z.string()).min(2).max(4).describe('Answer options'),
              correctIndex: z
                .number()
                .int()
                .min(0)
                .describe('Index of the correct answer in options'),
              explanation: z.string().describe('Brief explanation of why the answer is correct'),
              timeLimit: z.number().int().min(15).max(60).describe('Seconds to answer'),
            })
          ),
        }),
        execute: async (quizData) => {
          console.log('[chat] updateQuiz tool called — title:', quizData.title, 'questions:', quizData.questions?.length)
          return { success: true, quiz: quizData }
        },
      }),
    },
  })

  return result.toUIMessageStreamResponse({
    onError: (error) => {
      // Print full error details (ETIMEDOUT/AggregateError sub-causes)
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
      // Forward full readable detail to client (was returning [object Object])
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
