# Quiz Music (Kahoot-style) — Design

**Date:** 2026-07-07
**Status:** Approved

## Goal

Let a quiz creator pick one background song from a predefined library. The song
loops while a player takes the quiz, Kahoot-style.

## Decisions

- **Who picks:** the quiz creator, per quiz, in the builder. All players hear
  the same song. No player-side song selection.
- **Audio source:** royalty-free MP3 loops served statically from
  `/public/music/`. No S3, no synthesis.
- **Playback:** one track loops from question 1 until the quiz is submitted.
  Player gets a mute toggle. No per-question restart, no timeout tension
  effects.
- **Data model:** static library constant + one nullable column. No
  `music_tracks` table.

## Components

### 1. Music library

- `public/music/*.mp3` — roughly 6 royalty-free loops (Pixabay, Kevin
  MacLeod). Attribution recorded in `public/music/CREDITS.md`.
- `src/lib/music.ts` — single source of truth:
  ```ts
  export const MUSIC_TRACKS = [
    { id: 'upbeat-pop', name: 'Upbeat Pop', file: '/music/upbeat-pop.mp3' },
    // ...
  ] as const
  export function getTrackById(id: string | null | undefined) { ... } // returns track or null
  ```

### 2. Schema + API

- `quizzes` table gains `music_track: text('music_track')`, nullable. Stores a
  track id from the library; `null` means no music. Applied with
  `pnpm db:push`.
- Quiz save/update API: zod schema accepts `musicTrack` as one of the library
  ids or `null`; rejects anything else.
- `/play/[id]` page passes `musicTrack` through to `QuizPlayer`.

### 3. Builder UI (`QuizEditor`)

- New "Music" field alongside the existing difficulty select, same native
  `<select>` styling. Options: "No music" + each track name.
- Play/stop icon button next to the select to audition the selected track.
  One shared `Audio` element; changing selection or unmounting stops playback.
- `musicTrack` joins `QuizPayload` and is saved through the existing save path.

### 4. Player (`QuizPlayer`)

- New `ready` phase before `playing`: shows cover emoji, title, question
  count, and a "Start quiz" button. Clicking it starts the timer and the
  music. This user gesture satisfies browser autoplay policy.
- New hook `useQuizMusic(file: string | null)`:
  - Creates an `HTMLAudioElement` with `loop = true`, volume ≈ 0.35.
  - `start()` on Start click; stops on submit/finish/error and on unmount.
  - Exposes `muted` state + toggle.
- Mute/unmute button in the player header during play.
- "Play again" restarts music directly (the click is a gesture; no second
  ready screen).

## Error handling

- Stored track id not in the library (track removed later): treated as no
  music, no crash.
- Audio file 404 or `play()` rejection: caught and ignored; quiz proceeds
  silently.
- Editor preview: selecting a different song stops the currently playing
  preview first.

## Testing

- Unit (vitest): `getTrackById` returns track / null; API zod schema accepts
  valid ids and `null`, rejects unknown values.
- Audio playback and player flow: manual verification (jsdom has no real
  audio).

## Out of scope

- Player-side song choice or override.
- Timeout tension effects (speed-up, ticking).
- Admin-managed track library, S3 hosting, uploads.
- Sound effects (correct/wrong answer stingers).
