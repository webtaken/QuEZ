# Quiz Background Music Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quiz creators pick one background song from a predefined library; the song loops while a player takes the quiz, Kahoot-style.

**Architecture:** Static track library constant (`src/lib/music.ts`) + MP3s in `public/music/` + one nullable `music_track` column on `quizzes`. Creator picks in `QuizEditor` via a new `MusicPicker` component. Player gets a new `ready` phase (user gesture unlocks audio) and a `useQuizMusic` hook that loops the track until submit.

**Tech Stack:** Next.js 16 (app router), Drizzle ORM + Postgres, zod v4, vitest, Tailwind v4, base-ui Button, lucide-react icons.

**Spec:** `docs/superpowers/specs/2026-07-07-quiz-music-design.md`

## Global Constraints

- **Custom Next.js build:** APIs may differ from training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing Next-specific code (per `AGENTS.md`). Follow existing code patterns exactly.
- Package manager is `pnpm`. Tests: `pnpm test` (vitest, node environment, only `src/**/*.test.ts` files run).
- Buttons rendered as links use base-ui pattern: `<Button nativeButton={false} render={<Link href=... />}>`.
- zod is v4 (`import { z } from 'zod'`).
- `pnpm db:push` applies schema changes; requires the local Postgres from `.env` to be running. If it fails to connect, stop and ask the user to start the database.
- The AI chat tool schema must NOT include `musicTrack` — only the creator sets music, via the dropdown.
- Commit messages: conventional commits (`feat:`, `test:`, `docs:`) matching repo history.

---

### Task 1: Music library module

**Files:**
- Create: `src/lib/music.ts`
- Test: `src/lib/music.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (used by Tasks 3, 4, 6):
  - `MUSIC_TRACKS: readonly { id, name, file }[]` — 6 tracks
  - `type MusicTrackId` — union of the 6 id literals
  - `MUSIC_TRACK_IDS: [MusicTrackId, ...MusicTrackId[]]` — for `z.enum`
  - `getTrackById(id: string | null | undefined): MusicTrack | null`

- [ ] **Step 1: Write the failing test**

Create `src/lib/music.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { MUSIC_TRACKS, MUSIC_TRACK_IDS, getTrackById } from './music'

describe('MUSIC_TRACKS', () => {
  it('has at least one track, each with id, name, and a /music/ file path', () => {
    expect(MUSIC_TRACKS.length).toBeGreaterThan(0)
    for (const t of MUSIC_TRACKS) {
      expect(t.id).toMatch(/^[a-z0-9-]+$/)
      expect(t.name.length).toBeGreaterThan(0)
      expect(t.file).toMatch(/^\/music\/.+\.mp3$/)
    }
  })

  it('has unique ids', () => {
    const ids = MUSIC_TRACKS.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('MUSIC_TRACK_IDS mirrors MUSIC_TRACKS ids', () => {
    expect(MUSIC_TRACK_IDS).toEqual(MUSIC_TRACKS.map((t) => t.id))
  })
})

describe('getTrackById', () => {
  it('returns the track for a known id', () => {
    const first = MUSIC_TRACKS[0]
    expect(getTrackById(first.id)).toEqual(first)
  })

  it('returns null for an unknown id', () => {
    expect(getTrackById('does-not-exist')).toBeNull()
  })

  it('returns null for null and undefined', () => {
    expect(getTrackById(null)).toBeNull()
    expect(getTrackById(undefined)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/music.test.ts`
Expected: FAIL — cannot resolve `./music`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/music.ts`:

```ts
export type MusicTrack = {
  id: string
  name: string
  file: string
}

// Background music library for quiz play. All tracks are Kevin MacLeod
// (incompetech.com), CC BY 4.0 — attribution lives in public/music/CREDITS.md.
export const MUSIC_TRACKS = [
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/music.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/music.ts src/lib/music.test.ts
git commit -m "feat(music): add background music track library"
```

---

### Task 2: Download MP3s and write attribution

**Files:**
- Create: `public/music/monkeys-spinning-monkeys.mp3` (and 5 more)
- Create: `public/music/CREDITS.md`

**Interfaces:**
- Consumes: file names defined in Task 1's `MUSIC_TRACKS`.
- Produces: static MP3 assets served at `/music/*.mp3`.

- [ ] **Step 1: Download the 6 tracks**

The incompetech URLs were verified reachable (HTTP 200) on 2026-07-07. Note the URL names differ from our file names — the mapping is explicit below:

```bash
mkdir -p public/music
cd public/music
curl -fL -o monkeys-spinning-monkeys.mp3 "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Monkeys%20Spinning%20Monkeys.mp3"
curl -fL -o fluffing-a-duck.mp3 "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Fluffing%20a%20Duck.mp3"
curl -fL -o sneaky-snitch.mp3 "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Sneaky%20Snitch.mp3"
curl -fL -o carefree.mp3 "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Carefree.mp3"
curl -fL -o pixel-peeker-polka.mp3 "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Pixel%20Peeker%20Polka%20-%20faster.mp3"
curl -fL -o local-forecast-elevator.mp3 "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Local%20Forecast%20-%20Elevator.mp3"
cd ../..
```

- [ ] **Step 2: Verify the downloads are real MP3s**

Run: `file public/music/*.mp3 && du -h public/music/*.mp3`
Expected: every file reports `Audio file with ID3 ...` or `MPEG ADTS, layer III` — NOT `HTML document` or `empty`. Sizes roughly 1–8 MB each. If any file is HTML or tiny, the download failed — retry it; if it keeps failing, stop and tell the user which track needs a manual download.

- [ ] **Step 3: Write CREDITS.md**

Create `public/music/CREDITS.md`:

```markdown
# Music Credits

All tracks by Kevin MacLeod (incompetech.com),
licensed under Creative Commons: By Attribution 4.0 License
http://creativecommons.org/licenses/by/4.0/

| File | Track |
| --- | --- |
| monkeys-spinning-monkeys.mp3 | "Monkeys Spinning Monkeys" |
| fluffing-a-duck.mp3 | "Fluffing a Duck" |
| sneaky-snitch.mp3 | "Sneaky Snitch" |
| carefree.mp3 | "Carefree" |
| pixel-peeker-polka.mp3 | "Pixel Peeker Polka (faster)" |
| local-forecast-elevator.mp3 | "Local Forecast - Elevator" |
```

- [ ] **Step 4: Commit**

```bash
git add public/music
git commit -m "feat(music): add royalty-free track files with attribution"
```

---

### Task 3: Schema column, zod validation, API routes

**Files:**
- Modify: `src/db/schema.ts` (quizzes table, ~line 82)
- Modify: `src/lib/quiz-schema.ts`
- Modify: `src/lib/chat-tools.ts:16`
- Modify: `src/app/api/quizzes/[id]/route.ts` (PUT, ~line 89)
- Modify: `src/app/api/quizzes/route.ts` (POST insert, ~line 125)
- Test: `src/lib/quiz-schema.test.ts` (new)

**Interfaces:**
- Consumes: `MUSIC_TRACK_IDS` from `src/lib/music.ts` (Task 1).
- Produces (used by Tasks 4, 6):
  - `quizzes.musicTrack` column (`music_track`, nullable text)
  - `QuizPayload` type gains `musicTrack?: MusicTrackId | null`
  - PUT/POST `/api/quizzes` persist `musicTrack`

- [ ] **Step 1: Write the failing test**

Create `src/lib/quiz-schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { quizPayloadSchema } from './quiz-schema'
import { MUSIC_TRACKS } from './music'

const base = {
  title: 'T',
  description: '',
  topic: 'Math',
  audience: 'High School',
  difficulty: 'medium',
  coverEmoji: '🧠',
  questions: [],
}

describe('quizPayloadSchema musicTrack', () => {
  it('accepts a known track id', () => {
    const r = quizPayloadSchema.safeParse({ ...base, musicTrack: MUSIC_TRACKS[0].id })
    expect(r.success).toBe(true)
  })

  it('accepts null', () => {
    const r = quizPayloadSchema.safeParse({ ...base, musicTrack: null })
    expect(r.success).toBe(true)
  })

  it('accepts an omitted musicTrack', () => {
    const r = quizPayloadSchema.safeParse(base)
    expect(r.success).toBe(true)
  })

  it('rejects an unknown track id', () => {
    const r = quizPayloadSchema.safeParse({ ...base, musicTrack: 'not-a-track' })
    expect(r.success).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/quiz-schema.test.ts`
Expected: FAIL — "rejects an unknown track id" fails (zod strips unknown keys today, so parse succeeds).

- [ ] **Step 3: Add musicTrack to the zod schema**

In `src/lib/quiz-schema.ts`, add the import and the field:

```ts
import { z } from 'zod'
import { MUSIC_TRACK_IDS } from '@/lib/music'
```

In `quizPayloadSchema`, after `coverEmoji`:

```ts
  coverEmoji: z.string().min(1).describe('Single emoji representing the quiz topic'),
  musicTrack: z.enum(MUSIC_TRACK_IDS).nullable().optional(),
  questions: z.array(quizQuestionSchema),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/quiz-schema.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Exclude musicTrack from the AI chat tool**

In `src/lib/chat-tools.ts` line 16, change:

```ts
    inputSchema: quizPayloadSchema,
```

to:

```ts
    // Music is creator-only (picked in the editor dropdown); the agent must not
    // set or clear it, so it is stripped from the tool schema.
    inputSchema: quizPayloadSchema.omit({ musicTrack: true }),
```

- [ ] **Step 6: Add the DB column**

In `src/db/schema.ts`, in the `quizzes` table after `coverEmoji` (line 82):

```ts
  coverEmoji: text('cover_emoji').default('🧠'),
  musicTrack: text('music_track'),
```

Run: `pnpm db:push`
Expected: drizzle reports the added column. If it cannot connect to Postgres, stop and ask the user to start the local database.

- [ ] **Step 7: Persist musicTrack in the PUT route**

In `src/app/api/quizzes/[id]/route.ts`, PUT handler, in the `tx.update(quizzes).set({...})` block after `coverEmoji: data.coverEmoji,` (~line 89):

```ts
        coverEmoji: data.coverEmoji,
        musicTrack: data.musicTrack ?? null,
```

- [ ] **Step 8: Persist musicTrack in the POST route**

In `src/app/api/quizzes/route.ts`, in the `tx.insert(quizzes).values({...})` block after `coverEmoji: data.coverEmoji,` (~line 125):

```ts
        coverEmoji: data.coverEmoji,
        musicTrack: data.musicTrack ?? null,
```

- [ ] **Step 9: Run all tests and lint**

Run: `pnpm test && pnpm lint`
Expected: all tests pass, no new lint errors.

- [ ] **Step 10: Commit**

```bash
git add src/db/schema.ts src/lib/quiz-schema.ts src/lib/quiz-schema.test.ts src/lib/chat-tools.ts "src/app/api/quizzes/[id]/route.ts" src/app/api/quizzes/route.ts
git commit -m "feat(music): music_track column, payload validation, API persistence"
```

---

### Task 4: MusicPicker component + QuizEditor integration

**Files:**
- Create: `src/components/builder/MusicPicker.tsx`
- Modify: `src/components/builder/QuizEditor.tsx` (toPayload ~line 38, handleAgentUpdate ~line 79, metadata grid ~line 238)

**Interfaces:**
- Consumes: `MUSIC_TRACKS`, `getTrackById`, `MusicTrackId` from `src/lib/music.ts`; `QuizPayload` (now with `musicTrack`) from Task 3.
- Produces: `MusicPicker({ value, onChange }: { value: MusicTrackId | null; onChange: (v: MusicTrackId | null) => void })` — used only by QuizEditor.

- [ ] **Step 1: Create MusicPicker**

Create `src/components/builder/MusicPicker.tsx`:

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { Play, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MUSIC_TRACKS, getTrackById, type MusicTrackId } from '@/lib/music'

interface MusicPickerProps {
  value: MusicTrackId | null
  onChange: (value: MusicTrackId | null) => void
}

export function MusicPicker({ value, onChange }: MusicPickerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [previewing, setPreviewing] = useState(false)

  useEffect(() => {
    return () => {
      audioRef.current?.pause()
      audioRef.current = null
    }
  }, [])

  function stopPreview() {
    audioRef.current?.pause()
    audioRef.current = null
    setPreviewing(false)
  }

  function togglePreview() {
    if (previewing) {
      stopPreview()
      return
    }
    const track = getTrackById(value)
    if (!track) return
    const audio = new Audio(track.file)
    audio.loop = true
    audio.volume = 0.5
    audioRef.current = audio
    audio
      .play()
      .then(() => setPreviewing(true))
      .catch(() => stopPreview())
  }

  function handleChange(next: string) {
    stopPreview()
    onChange(next === '' ? null : (next as MusicTrackId))
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={value ?? ''}
        onChange={(e) => handleChange(e.target.value)}
        aria-label="Background music"
        className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
      >
        <option value="">No music</option>
        {MUSIC_TRACKS.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <Button
        variant="outline"
        size="icon"
        onClick={togglePreview}
        disabled={!value}
        aria-label={previewing ? 'Stop preview' : 'Preview song'}
        className="shrink-0 h-9 w-9"
      >
        {previewing ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      </Button>
    </div>
  )
}
```

- [ ] **Step 2: Wire into QuizEditor**

In `src/components/builder/QuizEditor.tsx`:

a. Add imports:

```ts
import { MusicPicker } from './MusicPicker'
import type { MusicTrackId } from '@/lib/music'
```

b. In `toPayload` (~line 38), after `coverEmoji`:

```ts
    coverEmoji: q.coverEmoji ?? '🧠',
    musicTrack: (q.musicTrack as MusicTrackId | null) ?? null,
```

c. In `handleAgentUpdate` (~line 79) — the AI tool schema omits `musicTrack`, so a plain replace would erase the creator's choice. Preserve it:

```ts
  const handleAgentUpdate = useCallback((next: QuizPayload) => {
    setQuiz((prev) => ({
      ...next,
      musicTrack: prev.musicTrack ?? null,
      questions: next.questions.map((q, i) => ({ ...q, order: i + 1 })),
    }))
    setDirty(true)
  }, [])
```

d. In the metadata grid (`grid grid-cols-1 md:grid-cols-3 gap-3`, ~line 238), add a fourth field after the Difficulty div (it wraps to a second row):

```tsx
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Music</label>
                <MusicPicker
                  value={quiz.musicTrack ?? null}
                  onChange={(v) => setField('musicTrack', v)}
                />
              </div>
```

- [ ] **Step 3: Verify types, lint, tests**

Run: `pnpm lint && pnpm test && npx tsc --noEmit`
Expected: all clean. (`setField('musicTrack', v)` type-checks because `musicTrack` is now part of `QuizPayload`.)

- [ ] **Step 4: Manual check**

Run: `pnpm dev`, open an existing quiz in the dashboard editor:
- Music dropdown shows "No music" + 6 tracks.
- Selecting a track and clicking play button plays audio; clicking stop stops it; switching tracks stops the preview.
- Pick a track, Save changes → reload page → selection persisted.

- [ ] **Step 5: Commit**

```bash
git add src/components/builder/MusicPicker.tsx src/components/builder/QuizEditor.tsx
git commit -m "feat(builder): music picker with audio preview in quiz editor"
```

---

### Task 5: Ready phase in QuizPlayer

**Files:**
- Modify: `src/components/quiz/QuizPlayer.tsx`

**Interfaces:**
- Consumes: nothing new (pure player-state change).
- Produces: `Phase` union gains `'ready'`; a `startQuiz()` click handler exists for Task 6 to hook music into.

- [ ] **Step 1: Add the ready phase**

In `src/components/quiz/QuizPlayer.tsx`:

a. Extend the phase union (line 44):

```ts
type Phase = 'ready' | 'playing' | 'submitting' | 'finished' | 'error'
```

b. Initial state (line 47):

```ts
  const [phase, setPhase] = useState<Phase>('ready')
```

c. Add a start handler after `reset()` (~line 131):

```ts
  function startQuiz() {
    setPhase('playing')
  }
```

d. Add the ready screen render before the `if (phase === 'error')` block (~line 133). Note `total` is declared at line 57, above this point:

```tsx
  if (phase === 'ready') {
    return (
      <div className="max-w-2xl mx-auto p-6 text-center space-y-6 pt-16">
        <div className="text-7xl">{quiz.coverEmoji}</div>
        <h1 className="font-[family-name:var(--font-syne)] font-bold text-3xl text-foreground">
          {quiz.title}
        </h1>
        <p className="text-muted-foreground">
          {total} question{total === 1 ? '' : 's'} · answer before the timer runs out
        </p>
        <Button onClick={startQuiz} size="lg" className="rounded-xl">
          Start quiz
        </Button>
      </div>
    )
  }
```

The existing timer `useEffect` only runs when `phase === 'playing'`, so the timer starts on the Start click. `reset()` already sets phase directly to `'playing'` — leave it: "Play again" skips the ready screen by design.

- [ ] **Step 2: Verify lint + manual check**

Run: `pnpm lint && npx tsc --noEmit`
Expected: clean.

Run: `pnpm dev`, open a public quiz at `/play/<id>`:
- Ready screen shows emoji, title, question count, Start button. Timer not running.
- Start → first question appears, timer counts down.
- Finish quiz → "Play again" restarts at question 1 directly (no ready screen).

- [ ] **Step 3: Commit**

```bash
git add src/components/quiz/QuizPlayer.tsx
git commit -m "feat(play): ready screen before quiz starts"
```

---

### Task 6: useQuizMusic hook + player wiring + mute

**Files:**
- Create: `src/hooks/useQuizMusic.ts`
- Modify: `src/components/quiz/QuizPlayer.tsx`
- Modify: `src/app/play/[id]/page.tsx` (~line 57)

**Interfaces:**
- Consumes: `getTrackById` from `src/lib/music.ts` (Task 1); `quizzes.musicTrack` column (Task 3); `startQuiz()` / `reset()` from Task 5.
- Produces: `useQuizMusic(file: string | null): { start(): void; stop(): void; muted: boolean; toggleMute(): void }`.

- [ ] **Step 1: Create the hook**

Create `src/hooks/useQuizMusic.ts`:

```ts
'use client'

import { useEffect, useRef, useState } from 'react'

// Loops a background track during quiz play. start() must be called from a
// user gesture (click) or the browser's autoplay policy rejects play() — the
// rejection is swallowed so the quiz always proceeds, with or without audio.
export function useQuizMusic(file: string | null) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [muted, setMuted] = useState(false)

  useEffect(() => {
    return () => {
      audioRef.current?.pause()
      audioRef.current = null
    }
  }, [])

  function start() {
    if (!file) return
    if (!audioRef.current) {
      const audio = new Audio(file)
      audio.loop = true
      audio.volume = 0.35
      audioRef.current = audio
    }
    audioRef.current.muted = muted
    audioRef.current.currentTime = 0
    audioRef.current.play().catch(() => {})
  }

  function stop() {
    audioRef.current?.pause()
  }

  function toggleMute() {
    setMuted((m) => {
      const next = !m
      if (audioRef.current) audioRef.current.muted = next
      return next
    })
  }

  return { start, stop, muted, toggleMute }
}
```

- [ ] **Step 2: Wire into QuizPlayer**

In `src/components/quiz/QuizPlayer.tsx`:

a. Add imports:

```ts
import { Clock, Volume2, VolumeX } from 'lucide-react'
import { getTrackById } from '@/lib/music'
import { useQuizMusic } from '@/hooks/useQuizMusic'
```

(`Clock` is already imported — extend that line.)

b. Add `musicTrack` to the `Quiz` type (~line 20):

```ts
type Quiz = {
  id: string
  title: string
  topic: string
  audience: string
  difficulty: string
  coverEmoji: string
  musicTrack: string | null
  questions: PlayQuestion[]
}
```

c. Inside the component, after the state declarations (~line 55):

```ts
  const track = getTrackById(quiz.musicTrack)
  const music = useQuizMusic(track?.file ?? null)
```

(`getTrackById` returns null for unknown/removed ids — quiz plays silently, no crash.)

d. Start music with the quiz (Task 5's handler):

```ts
  function startQuiz() {
    music.start()
    setPhase('playing')
  }
```

e. Stop music when play ends — first line of `submit()` (~line 101):

```ts
  async function submit(finalAnswers: Answer[]) {
    music.stop()
    setPhase('submitting')
```

f. Restart music on "Play again" — first line of `reset()` (~line 122; the button click is a user gesture, so `play()` is allowed):

```ts
  function reset() {
    music.start()
    setAnswers([])
```

g. Mute toggle in the playing header — in the top bar next to the `Q x / y` counter (~line 229), wrap the existing span and add a button:

```tsx
          <span className="text-muted-foreground shrink-0 ml-3 flex items-center gap-2">
            {track && (
              <button
                onClick={music.toggleMute}
                aria-label={music.muted ? 'Unmute music' : 'Mute music'}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                {music.muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
            )}
            Q {index + 1} / {total}
          </span>
```

- [ ] **Step 3: Pass musicTrack from the play page**

In `src/app/play/[id]/page.tsx`, in the `QuizPlayer` props (~line 57):

```tsx
          coverEmoji: quiz.coverEmoji ?? '🧠',
          musicTrack: quiz.musicTrack,
```

- [ ] **Step 4: Verify lint, types, tests**

Run: `pnpm lint && npx tsc --noEmit && pnpm test`
Expected: all clean.

- [ ] **Step 5: Manual check**

Run: `pnpm dev`. Set a track on a public quiz in the editor, then open `/play/<id>`:
- Start quiz → music loops during questions.
- Mute button toggles audio; icon switches.
- Last answer submitted → music stops at the results screen.
- "Play again" → music restarts with question 1.
- Set quiz music to "No music" → play page shows no mute button, no audio, no errors.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useQuizMusic.ts src/components/quiz/QuizPlayer.tsx "src/app/play/[id]/page.tsx"
git commit -m "feat(play): looping background music with mute toggle"
```

---

### Task 7: Full verification

**Files:** none new.

- [ ] **Step 1: Full test + lint + build**

Run: `pnpm test && pnpm lint && pnpm build`
Expected: all tests pass, lint clean, production build succeeds.

- [ ] **Step 2: End-to-end manual pass**

With `pnpm dev`:
1. Editor: pick a song, preview it, save, reload — persisted.
2. Chat: ask the AI to modify the quiz (e.g. "add a question"), then check the music dropdown — selection unchanged.
3. Save after the AI edit, reload — music still persisted.
4. Play: ready screen → start → music loops → mute works → results stop music → play again restarts music.
5. Quiz with "No music": plays silently, no mute button, no console errors.

- [ ] **Step 3: Fix anything found, commit fixes**

Any failures: fix, re-run Step 1, commit with a `fix:` message.
