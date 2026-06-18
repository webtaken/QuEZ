import { streamText, tool, convertToModelMessages, type UIMessage } from 'ai'
import { headers } from 'next/headers'
import { openrouter } from '@openrouter/ai-sdk-provider'
import { quizPayloadSchema, type QuizPayload } from '@/lib/quiz-schema'
import { auth } from '@/lib/auth'
import { persistTurn } from '@/db/chat-queries'
import { extractQuizFromParts } from '@/lib/chat-messages'
import type { NewChatMessage } from '@/db/schema'

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
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return new Response('Unauthorized', { status: 401 })

  const {
    messages,
    existingQuiz,
    quizId,
    parentId,
  }: {
    messages: UIMessage[]
    existingQuiz?: QuizPayload
    quizId?: string
    parentId?: string | null
  } = await req.json()

  const modelId = 'deepseek/deepseek-v4-flash'

  const system = existingQuiz
    ? `${BASE_SYSTEM}

The user is refining an existing quiz. Current state:

\`\`\`json
${JSON.stringify(existingQuiz, null, 2)}
\`\`\`

When calling updateQuiz, return the FULL updated quiz including fields the user did not ask to change. Preserve unchanged questions verbatim.`
    : BASE_SYSTEM

  // The last incoming message is the new user turn to persist.
  const incomingUser = messages[messages.length - 1]

  const result = streamText({
    model: openrouter(modelId),
    system,
    messages: await convertToModelMessages(messages),
    tools: {
      updateQuiz: tool({
        description:
          'Update the quiz preview panel with structured quiz data. Call this whenever building or updating a quiz.',
        inputSchema: quizPayloadSchema,
        execute: async (quizData) => {
          return { success: true, quiz: quizData }
        },
      }),
    },
  })

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    onFinish: async ({ responseMessage }) => {
      // Persist only when we have a quiz to attach the thread to.
      if (!quizId || !incomingUser || incomingUser.role !== 'user') return
      const assistantParts = (responseMessage as unknown as { parts: unknown[] }).parts ?? []
      const snapshot = extractQuizFromParts(assistantParts)
      const userMessage: NewChatMessage = {
        id: incomingUser.id,
        quizId,
        userId: session.user.id,
        role: 'user',
        parts: (incomingUser as unknown as { parts: unknown[] }).parts ?? [],
        parentId: parentId ?? null,
      }
      const assistantMessage: NewChatMessage = {
        id: responseMessage.id,
        quizId,
        userId: session.user.id,
        role: 'assistant',
        parts: assistantParts,
        parentId: incomingUser.id,
        quizSnapshot: snapshot ?? null,
      }
      await persistTurn({ quizId, userId: session.user.id, userMessage, assistantMessage })
    },
    onError: (error) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyErr = error as any
      const parts = [
        anyErr?.name,
        anyErr?.message,
        anyErr?.statusCode && `status=${anyErr.statusCode}`,
        anyErr?.responseBody &&
          `body=${typeof anyErr.responseBody === 'string' ? anyErr.responseBody : JSON.stringify(anyErr.responseBody)}`,
        anyErr?.cause?.message,
      ].filter(Boolean)
      return parts.join(' | ') || String(error)
    },
  })
}
