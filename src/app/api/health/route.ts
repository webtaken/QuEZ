// Deliberately DB-free: a database blip should not make Railway restart the
// app container.
export function GET() {
  return Response.json({ ok: true })
}
