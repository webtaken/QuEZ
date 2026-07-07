import { streamText, convertToModelMessages, type UIMessage } from 'ai'
import { headers } from 'next/headers'
import { openrouter } from '@openrouter/ai-sdk-provider'
import { type QuizPayload } from '@/lib/quiz-schema'
import { buildChatTools } from '@/lib/chat-tools'
import { auth } from '@/lib/auth'
import { persistTurn } from '@/db/chat-queries'
import { buildTurnMessages } from '@/lib/chat-messages'
import { newId } from '@/lib/ids'
import { collectAttachmentIds, buildAttachmentSystemBlock } from '@/lib/attachment-inject'
import { loadReadyAttachments } from '@/db/attachment-queries'
import type { AttachmentKind } from '@/lib/attachment-kind'
import { getBalance, debitCredits } from '@/db/credit-queries'
import { computeDebit } from '@/lib/credit-math'

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

  const balance = await getBalance(session.user.id)
  if (balance <= 0) {
    return Response.json({ error: 'insufficient_credits' }, { status: 402 })
  }

  const {
    messages,
    existingQuiz,
    quizId,
    parentId,
    webSearch,
  }: {
    messages: UIMessage[]
    existingQuiz?: QuizPayload
    quizId?: string
    parentId?: string | null
    webSearch?: boolean
  } = await req.json()

  const modelId = 'deepseek/deepseek-v4-flash'

  let system = existingQuiz
    ? `${BASE_SYSTEM}

The user is refining an existing quiz. Current state:

\`\`\`json
${JSON.stringify(existingQuiz, null, 2)}
\`\`\`

When calling updateQuiz, return the FULL updated quiz including fields the user did not ask to change. Preserve unchanged questions verbatim.`
    : BASE_SYSTEM

  // Inject extracted text from any files the user attached (this turn or earlier
  // on the active path). Mirrors the existingQuiz injection above — content lives
  // in the attachments table, never duplicated into message parts.
  const attachmentIds = collectAttachmentIds(messages as { parts?: unknown[] }[])
  if (attachmentIds.length) {
    const ready = await loadReadyAttachments(attachmentIds, session.user.id)
    const block = buildAttachmentSystemBlock(
      ready.map((a) => ({
        id: a.id,
        filename: a.filename,
        kind: a.kind as AttachmentKind,
        extractedText: a.extractedText ?? '',
      }))
    )
    if (block) system = `${system}\n\n${block}`
  }

  // The last incoming message is the new user turn to persist.
  const incomingUser = messages[messages.length - 1]

  const result = streamText({
    model: openrouter(modelId, { usage: { include: true } }),
    system,
    messages: await convertToModelMessages(messages),
    tools: buildChatTools({ webSearch: webSearch ?? false }),
    onFinish: async ({ steps, totalUsage }) => {
      // Debit from the OpenRouter-reported cost. Bookkeeping must never break
      // the user's stream — swallow and log.
      try {
        const { credits, rawCostUsd, usedFallback } = computeDebit({
          steps,
          totalTokens: totalUsage?.totalTokens,
        })
        await debitCredits({
          userId: session.user.id,
          credits,
          type: 'chat',
          metadata: {
            ...(quizId ? { quizId } : {}),
            model: modelId,
            inputTokens: totalUsage?.inputTokens,
            outputTokens: totalUsage?.outputTokens,
            rawCostUsd,
            usedFallback,
            webSearch: webSearch ?? false,
          },
        })
      } catch (e) {
        console.error('[chat] credit debit failed', e)
      }
    },
  })

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    // Assign a stable uuid to the assistant message. The SDK sends it on the
    // stream start chunk so useChat adopts the same id client-side, keeping
    // chat_messages.id === the rendered message id for reload hydration.
    generateMessageId: newId,
    sendSources: true,
    onFinish: async ({ responseMessage }) => {
      // Persist only when we have a quiz to attach the thread to.
      if (!quizId || !incomingUser || incomingUser.role !== 'user') return
      const { userMessage, assistantMessage } = buildTurnMessages({
        quizId,
        userId: session.user.id,
        parentId: parentId ?? null,
        incomingUser,
        responseMessage,
      })
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
