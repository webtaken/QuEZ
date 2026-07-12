import { z } from 'zod'
import { MUSIC_TRACK_IDS } from '@/lib/music'

export const quizQuestionSchema = z.object({
  order: z.number().int().min(1),
  text: z.string().min(1).describe('The question text'),
  type: z.enum(['multiple_choice', 'true_false']),
  options: z.array(z.string().min(1)).min(2).max(4).describe('Answer options'),
  correctIndex: z.number().int().min(0).describe('Index of the correct answer in options'),
  explanation: z.string().describe('Brief explanation of why the answer is correct'),
  timeLimit: z.number().int().min(15).max(60).describe('Seconds to answer'),
})

export const quizPayloadSchema = z.object({
  title: z.string().min(1).describe('Quiz title'),
  description: z.string().describe('Short description of the quiz'),
  topic: z.string().min(1).describe('Subject area e.g. Mathematics, Biology, History'),
  audience: z
    .string()
    .min(1)
    .describe('Target audience e.g. Elementary School, High School, Undergraduate, Professional'),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  coverEmoji: z.string().min(1).describe('Single emoji representing the quiz topic'),
  musicTrack: z.enum(MUSIC_TRACK_IDS).nullable().optional(),
  questions: z.array(quizQuestionSchema),
})

export const quizPayloadWithFlagsSchema = quizPayloadSchema.extend({
  isPublic: z.boolean().optional(),
})

export type QuizQuestion = z.infer<typeof quizQuestionSchema>
export type QuizPayload = z.infer<typeof quizPayloadSchema>
export type QuizPayloadWithFlags = z.infer<typeof quizPayloadWithFlagsSchema>
