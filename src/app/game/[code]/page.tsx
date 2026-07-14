import { StudentGameView } from '@/components/game/StudentGameView'

export default async function GamePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  return <StudentGameView code={code} />
}
