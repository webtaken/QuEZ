const MAX_POINTS = 1000
const MAX_STREAK_FOR_BONUS = 5
const STREAK_BONUS_PER_LEVEL = 0.1

// Correct + instant answer scores MAX_POINTS; correct at the very last
// instant scores half that. Wrong or missing answers score 0. A streak of
// N consecutive correct answers (capped at MAX_STREAK_FOR_BONUS) adds
// STREAK_BONUS_PER_LEVEL per level on top, e.g. a 5-streak = +50%.
export function computePoints(
  timeLimitMs: number,
  answerMs: number,
  isCorrect: boolean,
  priorStreak: number
): number {
  if (!isCorrect) return 0
  const remainingMs = Math.max(0, timeLimitMs - answerMs)
  const basePoints = MAX_POINTS * (0.5 + 0.5 * (remainingMs / timeLimitMs))
  const streakBonus = 1 + Math.min(priorStreak, MAX_STREAK_FOR_BONUS) * STREAK_BONUS_PER_LEVEL
  return Math.round(basePoints * streakBonus)
}

// Leaderboard order: highest score first; a tie is broken by whoever was
// faster across the whole game (lower cumulative totalAnswerMs).
export function rankParticipants<T extends { score: number; totalAnswerMs: number }>(
  participants: T[]
): (T & { rank: number })[] {
  return [...participants]
    .sort((a, b) => b.score - a.score || a.totalAnswerMs - b.totalAnswerMs)
    .map((p, i) => ({ ...p, rank: i + 1 }))
}
