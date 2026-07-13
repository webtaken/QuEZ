import { JoinForm } from '@/components/game/JoinForm'

export default async function JoinCodePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  return <JoinForm initialCode={code} />
}
