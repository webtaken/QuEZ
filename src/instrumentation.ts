// Runs once when the Next.js server instance boots (inside Next's compiled
// context — unlike server.mjs, this can import TS/drizzle modules). server.mjs
// sets globalThis.__quezIo before app.prepare(), so the io server is already
// there when register() runs.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { wireRealtime } = await import('@/lib/realtime/connection')
  wireRealtime()
}
