# QuEZ Design System

The single source of truth for QuEZ's visual language. Every color, radius, font, and
motion in the frontend derives from the tokens defined in
[`src/app/globals.css`](src/app/globals.css). **This file documents those tokens and the
rules for using them.**

> **Golden rule:** never hardcode a color. Use a theme token (`bg-accent-lime`,
> `text-destructive`, `bg-success/20`, …). Never write arbitrary values like
> `bg-[oklch(...)]`, `text-green-400`, or `bg-purple-600`. See [Usage rules](#usage-rules).

QuEZ ships **dark-first**. The `.dark` block is the real product theme (deep navy + lime).
`:root` is a light fallback only.

---

## 1. Color tokens

All colors are CSS custom properties in OKLCH, mapped to Tailwind utilities via
`@theme inline`. Use the **Tailwind token**, not the raw value.

### Brand & surface

| Token (Tailwind) | Var | Dark value | Role |
|---|---|---|---|
| `background` | `--background` | `oklch(0.13 0.03 264)` | Page background — deep navy |
| `foreground` | `--foreground` | `oklch(0.985 0 0)` | Primary text — near-white |
| `card` / `popover` | `--card` | `oklch(0.17 0.03 264)` | Card & popover surfaces |
| `secondary` / `muted` / `accent` | `--secondary` | `oklch(0.22 0.04 264)` | Raised slate surfaces, chips, emoji tiles |
| `muted-foreground` | `--muted-foreground` | `oklch(0.65 0.02 264)` | Secondary / meta text |
| `border` | `--border` | `oklch(1 0 0 / 8%)` | Hairline borders (white @ 8%) |
| `input` | `--input` | `oklch(1 0 0 / 10%)` | Input borders |
| `ring` | `--ring` | `oklch(0.93 0.22 127)` | Focus ring — lime |

### Accent & semantic

| Token (Tailwind) | Var | Dark value | Role |
|---|---|---|---|
| `accent-lime` | `--accent-lime` | `oklch(0.93 0.22 127)` | **Primary brand accent.** CTAs, active nav, highlights, progress, logo |
| `accent-lime-foreground` | `--accent-lime-foreground` | `oklch(0.13 0.03 264)` | Text/icons on a lime fill (dark navy) |
| `success` | `--success` | `oklch(0.79 0.21 152)` | Correct answers, "easy" difficulty |
| `warning` | `--warning` | `oklch(0.85 0.19 92)` | Skipped answers, "medium" difficulty |
| `destructive` | `--destructive` | `oklch(0.704 0.191 22.216)` | Wrong answers, "hard" difficulty, delete, errors |

> `success` and `warning` carry `-foreground` pairs too (dark navy), for use on solid fills.

`primary` in dark mode resolves to the same lime as `accent-lime` (`--primary: oklch(0.93 0.22 127)`).
Prefer `accent-lime` in app code so intent stays explicit; `primary` is reserved for
shadcn primitives that ship with it.

### Sidebar tokens

The sidebar has its own surface scale: `sidebar`, `sidebar-foreground`,
`sidebar-primary` (lime), `sidebar-accent`, `sidebar-border`, `sidebar-ring`. Defined in
both `:root` and `.dark`. Used only inside `src/components/ui/sidebar.tsx` and
`Sidebar.tsx`.

### Opacity modifiers

Tints come from the `/NN` opacity syntax on a token — never a second hardcoded color:

- Lime tint backgrounds: `bg-accent-lime/20`, `bg-accent-lime/15`, `bg-accent-lime/10`, `bg-accent-lime/8`
- Lime hover/borders: `hover:bg-accent-lime/90`, `border-accent-lime/30`, `hover:border-accent-lime/50`
- Semantic tints: `bg-success/20 text-success`, `bg-destructive/20 text-destructive`, `bg-warning/20 text-warning`
- Colored shadows: `shadow-accent-lime/20`, `shadow-accent-lime/30`

---

## 2. Typography

Three font families, wired through CSS vars and applied via Tailwind.

| Family | Var / utility | Use |
|---|---|---|
| **Syne** | `--font-syne` → `font-[family-name:var(--font-syne)]` (also `font-display`) | Display: all headings, quiz/question titles, logo, stat numbers |
| **DM Sans** | `--font-dm-sans` → `font-sans` (default) | Body, labels, UI copy |
| **Geist Mono** | `--font-mono` → `font-mono` | Code / technical text |

Headings consistently set `font-[family-name:var(--font-syne)]` + a weight.

**Weights:** `font-bold` (page/hero headings, stat values), `font-semibold` (card &
question titles), `font-medium` (labels, badges, buttons), normal (body).

**Size scale (representative):**

| Class | Use |
|---|---|
| `text-xs` (12px) | Labels, badges, meta, difficulty/status chips |
| `text-sm` (14px) | Body, sidebar, chat bubbles |
| `text-base` (16px) | Buttons, inputs |
| `text-lg`–`text-xl` | Question text, section titles |
| `text-2xl`–`text-4xl` | Page & dashboard headings |
| `text-5xl sm:text-6xl lg:text-7xl` | Hero headline (`Hero.tsx`) |

**Tracking / leading:** `tracking-tight` + `leading-[1.05]` on the hero headline;
`leading-snug` for question text; `leading-relaxed` for chat; `line-clamp-2` on directory
card titles.

---

## 3. Radius

Base token `--radius: 0.75rem` (12px); the scale is computed from it.

| Tailwind | Formula | ≈ px | Used for |
|---|---|---|---|
| `rounded-sm` | `--radius × 0.6` | 7.2 | small inner elements |
| `rounded-md` | `--radius × 0.8` | 9.6 | `<select>` / native inputs |
| `rounded-lg` | `--radius × 1.0` | 12 | buttons, inputs, dropdowns, sheets (shadcn default) |
| `rounded-xl` | `--radius × 1.4` | 16.8 | quiz options, answer rows, emoji tiles |
| `rounded-2xl` | `--radius × 1.8` | 21.6 | **primary card shape** — every panel/card |
| `rounded-full` | — | — | pills, badges, avatars, CTAs, FAB, progress bar |

**Convention:** structural cards = `rounded-2xl`; interactive sub-elements = `rounded-xl`;
controls = `rounded-lg`; anything pill-shaped or circular = `rounded-full`.

---

## 4. Borders

- **Default:** `border border-border` (1px, white @ 8%) — the standard card/divider outline.
- **Directional dividers:** `border-b` / `border-t` / `border-l` / `border-r border-border`
  for section separators (chat header, editor header, preview panes).
- **Dashed:** `border-2 border-dashed border-border` for "add" / empty drop zones
  (Add question button, empty preview tile).
- **Rings (focus & subtle outline):** shadcn primitives use `ring-1 ring-foreground/10`
  for card edges and `focus-visible:ring-[3px] focus-visible:ring-ring/50` for focus.
  Error state: `aria-invalid:ring-destructive/20 aria-invalid:border-destructive`.
- **Selected/active outline:** `border-accent-lime` (+ `bg-accent-lime/15`) for the
  locked quiz answer; `border-accent-lime/30` for selected chips.

---

## 5. Shadows & elevation

| Class | Use |
|---|---|
| `shadow-xs` | inputs / `<select>` |
| `shadow-sm` | floating sidebar, sheets |
| `shadow-md` | dropdown menus |
| `shadow-lg` | primary CTAs (`Get Started`, FAB) |
| `shadow-2xl` | hero floating mock cards |

**Colored action glow:** primary lime buttons add `shadow-accent-lime/20` (or `/30`) for a
brand-tinted ambient glow.

**`.card-glow`** (custom, in `globals.css`) — hover treatment for directory cards
(`QuizDirectory.tsx`): lifts `translateY(-4px)` and paints a dual lime shadow
(1px ring @ 40% + 32px ambient @ 12%), both derived from `var(--accent-lime)`.

---

## 6. Spacing & layout

- **Gaps:** `gap-1/1.5` (tight icon+label), `gap-2/3` (standard flex), `gap-4` (card
  content), `gap-6` (grids/sections), `gap-8` (hero stats).
- **Padding:** cards `p-4`–`p-5`/`p-6`; pages `p-8`; compact chips `px-3 py-1`.
- **Max-widths:** `max-w-2xl`/`3xl` (reading/quiz/editor columns), `max-w-6xl` (dashboard),
  `max-w-7xl` (directory & landing grids).
- **Responsive grid pattern (canonical):**
  `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6` (directory, landing).
  Dashboard stats use `grid-cols-2 lg:grid-cols-4`.
- **App shell:** dashboard = fixed sidebar + `flex-1` content; builder = chat
  `w-[28%] min-w-[280px] max-w-[380px]` + `flex-1` editor; quiz player = centered
  `max-w-2xl`/`3xl`.
- Breakpoints are Tailwind defaults (`sm` 640 · `md` 768 · `lg` 1024 · `xl` 1280).

---

## 7. Custom utilities & animation

Defined in `globals.css`:

| Class | Effect | Used in |
|---|---|---|
| `.dot-grid` | 28px radial dot pattern (foreground @ 8%) | Hero background |
| `.card-glow` | hover lift + lime glow (see §5) | Directory cards |
| `.animate-fade-up` | `fade-up` keyframe, 0.5s, 24px rise + fade-in | Cards, chat messages, hero |
| `.animate-fade-up-delay-1/2/3` | staggered 0.1/0.2/0.3s delays | Hero sequence |
| `.stagger-item` (+`.visible`) | 20px rise + fade, toggled by IntersectionObserver | Directory grid reveal |

Built-in Tailwind animations in use: `animate-pulse` (skeletons), `animate-bounce`
(empty-state emoji, scroll cue), `animate-in`/`animate-out` (menus, sheets).

---

## 8. shadcn/ui component conventions

Primitives live in `src/components/ui/` (built on `@base-ui/react`, variants via CVA).
They are **already token-based** — extend them, don't restyle them inline.

| Component | Default shape | Variants |
|---|---|---|
| `Button` | `rounded-lg h-8 text-sm font-medium`, focus `ring-3 ring-ring/50` | `default · outline · secondary · ghost · destructive · link` × `xs · sm · default · lg · icon` |
| `Card` | `rounded-xl bg-card ring-1 ring-foreground/10` | `default · sm` |
| `Input` / `Textarea` | `rounded-lg`, `focus-visible:ring-[3px]`, `border-input` | — |
| `Badge` | `rounded-4xl h-5 text-xs font-medium` | `default · secondary · destructive · outline · ghost · link` |
| `Avatar` | `rounded-full size-8 ring-2 ring-background` | `sm · default · lg` |
| `Dropdown` / `Tooltip` / `Sheet` / `Sidebar` / `Skeleton` / `Separator` | per shadcn | — |

**App pattern:** primary actions are `rounded-full` lime buttons
(`bg-accent-lime text-accent-lime-foreground`), secondary actions use the `outline` or
`secondary` Button variant.

---

## Usage rules

1. **Color only via tokens.** `bg-accent-lime`, `text-success`, `bg-destructive/20`, etc.
   - ❌ `bg-[oklch(0.93_0.22_127)]` → ✅ `bg-accent-lime`
   - ❌ `text-[oklch(0.13_0.03_264)]` (text on lime) → ✅ `text-accent-lime-foreground`
   - ❌ `hover:bg-[oklch(0.88_0.22_127)]` → ✅ `hover:bg-accent-lime/90`
   - ❌ `shadow-[oklch(0.93_0.22_127/20%)]` → ✅ `shadow-accent-lime/20`
2. **Status palette is semantic, not literal.** Correct/easy = `success`;
   skipped/medium = `warning`; wrong/hard/error/delete = `destructive`. Never `green-*`,
   `yellow-*`, `red-*`.
3. **No second brand color.** Lime is the only accent — there is no purple. Decorative
   surfaces use `secondary`; accents use `accent-lime`.
4. **Tints = opacity modifiers** on a token (`/8 /10 /15 /20 /30 /50 /90`), never a new color.
5. **New semantic need?** Add a `--token` (+ `-foreground`) in `:root` **and** `.dark`,
   register `--color-token` in `@theme inline`, then use the utility. Don't reach for a raw
   Tailwind palette shade.
6. **Cards = `rounded-2xl border border-border bg-card`.** Keep the shape consistent.
7. **Headings = Syne** via `font-[family-name:var(--font-syne)]`.
8. `src/components/ui/*` are generated/regenerable — keep them token-based; don't bake in
   one-off colors.

---

## Adherence audit

State of `globals.css` compliance. A full sweep on **2026-06-16** found **64** hardcoded
color values bypassing the theme; **all were remediated** in the same change.

### What was fixed

| Category | Count | Resolution |
|---|---|---|
| Arbitrary `oklch(...)` lime values (`bg-[oklch(0.93_0.22_127)]`, …) | 30 | → `accent-lime` / `accent-lime-foreground` tokens (incl. `shadow-accent-lime/NN`, `hover:bg-accent-lime/90`) |
| Hardcoded `green-*` / `yellow-*` (status & difficulty) | ~14 | → new `success` / `warning` tokens |
| Hardcoded `red-*` (errors, wrong, hard) | ~8 | → existing `destructive` token |
| Hardcoded `purple-*` (avatars, badges, glows, tiles) | ~9 | Purple retired — solid accents → `accent-lime`, decorative → `secondary` |
| Raw oklch in `.dot-grid` / `.card-glow` | 3 | → relative-color `oklch(from var(--token) …)` |

New tokens added: `--success` / `--success-foreground`, `--warning` /
`--warning-foreground` (in `:root`, `.dark`, and `@theme inline`).

Files touched: `globals.css`; `builder/{QuestionCard,QuestionEditor,QuizPreview,ChatPanel,QuizEditor}.tsx`;
`quiz/{QuizPlayer,QuestionReview}.tsx`; `landing/{Hero,QuizDirectory}.tsx`;
`dashboard/Sidebar.tsx`; `app/dashboard/page.tsx`.

### Known acceptable exception

- `src/components/ui/sheet.tsx` uses `bg-black/10` for the modal overlay scrim — a
  conventional neutral dim, left as-is (low priority). Promote to an `--overlay` token if
  overlay theming is ever needed.

### Verification

`npx next build` — compiles clean, TypeScript passes. Re-audit with:

```bash
grep -rn "oklch(0\." src --include=*.tsx          # → no matches
grep -rn "purple-" src --include=*.tsx            # → no matches
grep -rnE "(bg|text|border)-(green|yellow|red)-[0-9]" src --include=*.tsx   # → no matches
```
