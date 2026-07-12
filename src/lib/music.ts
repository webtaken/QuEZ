export type MusicTrack = {
  id: string
  name: string
  file: string
}

// Background music library for quiz play. All tracks are Kevin MacLeod
// (incompetech.com), CC BY 4.0 — attribution lives in public/music/CREDITS.md.
export const MUSIC_TRACKS = [
  {
    id: 'tense-music-from-game-show',
    name: 'Tense Music from Game Show',
    file: '/music/tense-music-from-game-show.mp3',
  },
  {
    id: 'monkeys-spinning-monkeys',
    name: 'Monkeys Spinning Monkeys',
    file: '/music/monkeys-spinning-monkeys.mp3',
  },
  {
    id: 'fluffing-a-duck',
    name: 'Fluffing a Duck',
    file: '/music/fluffing-a-duck.mp3',
  },
  {
    id: 'sneaky-snitch',
    name: 'Sneaky Snitch',
    file: '/music/sneaky-snitch.mp3',
  },
  {
    id: 'carefree',
    name: 'Carefree',
    file: '/music/carefree.mp3',
  },
  {
    id: 'pixel-peeker-polka',
    name: 'Pixel Peeker Polka',
    file: '/music/pixel-peeker-polka.mp3',
  },
  {
    id: 'local-forecast-elevator',
    name: 'Local Forecast (Elevator)',
    file: '/music/local-forecast-elevator.mp3',
  },
] as const satisfies readonly MusicTrack[]

export type MusicTrackId = (typeof MUSIC_TRACKS)[number]['id']

export const MUSIC_TRACK_IDS = MUSIC_TRACKS.map((t) => t.id) as [
  MusicTrackId,
  ...MusicTrackId[],
]

export function getTrackById(
  id: string | null | undefined
): MusicTrack | null {
  if (!id) return null
  return MUSIC_TRACKS.find((t) => t.id === id) ?? null
}
