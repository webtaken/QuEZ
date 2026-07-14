# Quizzy Design System

A **playful, bold** design system for a modern quizzes app. Inspired by **neo-brutalism**:
vibrant flat colors, hard offset shadows, and strong ink borders. Light-first — a warm
cream page with white card surfaces and near-black ink for text, borders, and shadows.

> **Golden rule:** every surface and control is **bordered and hard-shadowed**, fills are
> **flat vibrant color** (no gradients, no glows), and type is **Space Grotesk**
> everywhere. Color is used **semantically** — see [Usage rules](#usage-rules).

> **Implementation status:** This is the **target** design spec. The running codebase still
> ships the previous dark-navy + lime theme (`src/app/globals.css`, `src/app/layout.tsx`);
> migrating the tokens, fonts, and components to this system is tracked separately. Until
> then, treat this file as the design contract to build toward, not a description of what is
> currently live. The "Proposed token names" below are the intended `globals.css` tokens for
> that migration.

---

## 1. Color palette

Eight colors. Canonical values are **hex** (matching the source design); at implementation
they convert to OKLCH custom properties. Every colored fill pairs with a fixed text color
for legibility — never guess it, use the table.

| Name | Hex | Role | Text on fill |
|---|---|---|---|
| **Coral** | `#FF5E5B` | Error / destructive / delete · Expert difficulty | White |
| **Purple** | `#6C5CE7` | Secondary actions · Hard difficulty | White |
| **Teal** | `#00C9A7` | Accent · Success · Easy difficulty · Create · Featured | Ink |
| **Yellow** | `#FFD84D` | **Primary CTA** · Medium difficulty · New | Ink |
| **Orange** | `#FF8A4C` | Highlight · Popular | Ink |
| **Cream** | `#FFF7E8` | Page background | Ink |
| **White** | `#FFFFFF` | Card & control surfaces | Ink |
| **Ink** | `#1E1E1E` | Text · borders · hard shadows | — |

**Proposed token names** (for the `globals.css` migration), each with a `-foreground` pair
set to Ink or White per the table above:

| Token | Value | `-foreground` |
|---|---|---|
| `--background` | Cream `#FFF7E8` | Ink |
| `--card` / `--popover` | White `#FFFFFF` | Ink |
| `--foreground` / `--border` / `--shadow` | Ink `#1E1E1E` | — |
| `--primary` | Yellow `#FFD84D` | Ink |
| `--secondary` | Purple `#6C5CE7` | White |
| `--accent` | Teal `#00C9A7` | Ink |
| `--highlight` | Orange `#FF8A4C` | Ink |
| `--success` | Teal `#00C9A7` | Ink |
| `--warning` | Yellow `#FFD84D` | Ink |
| `--destructive` | Coral `#FF5E5B` | White |

**Tints:** when a lighter surface is needed (e.g. a selected answer row), wash the hue over
white/cream at low opacity — a soft `coral/15`, `teal/15`, etc. Never introduce a new color
to make a tint.

---

## 2. Typography

**Space Grotesk** — one family for everything (display *and* body). Bold for headings,
regular/medium for body.

| Style | Weight / Size / Line-height |
|---|---|
| **Heading XL** | Bold · 48px · 120% |
| **Heading L** | Bold · 32px · 120% |
| **Heading M** | Bold · 24px · 120% |
| **Body Large** | Medium · 16px · 150% |
| **Body** | Regular · 14px · 150% |
| **Small** | Regular · 12px · 140% |

Uppercase `ABCDEFGHIJKLMNOPQRSTUVWXYZ`, lowercase, and `0123456789` all set in Space
Grotesk. Headings are always **bold**; supporting/meta text is **Small**.

---

## 3. Icon style

- **2px outline** stroke.
- **Rounded corners** on strokes.
- **Bold style** — chunky, high-contrast, ink-colored on light surfaces.

Icons sit inside colored **rounded-square tiles** (≈12px radius) when used as card/section
markers.

---

## 4. Buttons

All buttons get an **ink border + hard offset shadow** and the signature press motion
(see [Core rules](#core-rules)).

| Variant | Fill | Text |
|---|---|---|
| **Primary** | Yellow | Ink |
| **Secondary** | Purple | White |
| **Accent** | Teal | Ink |
| **Outline** | White | Ink |

- **Icon buttons:** square, ≈12px radius, a single colored fill (teal / green / orange /
  coral, etc.) with an ink border + shadow.
- **Size variants:** **Large** · **Default** · **Small** — scale padding and font together;
  keep the border weight constant.

---

## 5. Inputs

White fill, ink border, hard shadow. Focus deepens the shadow; active/checked states use the
accent fills.

- **Text input** — placeholder in muted ink; trailing icon optional (e.g. search).
- **Filled input** — same shape, carries a value.
- **Select / dropdown** — ink border, chevron affordance.
- **Checkbox** — square, ink border; checked = coral fill + white check.
- **Radio** — circle, ink border; selected = purple dot.
- **Toggle switch** — Active = teal track; Inactive = neutral track. Knob is a bordered
  white circle.

---

## 6. Cards

The primary container. **White surface · ink border · hard offset shadow.**

Composition (top→bottom): a **colored rounded-square icon tile**, the **title** (Heading M),
a **meta line** (question count, Small), a **difficulty badge**, and a **progress bar** with
its percentage. Difficulty color follows the badge scale in §7.

---

## 7. Badges & labels

Pill-shaped (fully rounded), ink border + small hard shadow, optional leading icon.

**Difficulty:**

| Label | Fill |
|---|---|
| Easy | Teal |
| Medium | Yellow |
| Hard | Purple |
| Expert | Coral |

**Status:**

| Label | Fill | Icon |
|---|---|---|
| New | Yellow | bell |
| Popular | Orange | star |
| Featured | Teal | star |

---

## 8. Navigation

- **Bottom navigation** — 5 items (Home · Explore · **Create** · Stats · Profile). The center
  **Create** action is a raised **yellow tile** with ink border + shadow; the rest are
  ink icon + label, active item emphasized.
- **Tabs** — a segmented, bordered strip; the **active tab is a yellow fill**, others are
  transparent on white.
- **Breadcrumb** — ink text separated by chevrons (e.g. `Home › Science › Physics Quiz`).

---

## 9. Question types

Each answer container is white with an ink border; the **selected/answered option takes a
colored fill + ink border**.

- **Multiple choice** — radio list; selected row washed in the accent (e.g. coral tint on
  the chosen answer).
- **True / False** — two side-by-side buttons; the chosen one fills solid.
- **Multiple select** — checkbox list; each checked box fills coral.
- **Short answer** — a single text input.

---

## 10. Progress & feedback

- **Progress bar** — rounded track with ink border; **teal fill** advancing left→right with
  a percentage label.
- **Step progress** — numbered circles connected by a line; completed/active steps are
  filled, upcoming steps are outline-only.
- **Alert / feedback rows** — bordered, hard-shadowed, with a leading status icon and a
  trailing dismiss `×`:

| State | Fill / accent | Example copy |
|---|---|---|
| Success | Teal | "Great! That's correct." |
| Warning | Yellow | "Almost there! Try again." |
| Error | Coral | "Incorrect. Keep practicing!" |

---

## 11. Modals

White card, **thick ink border (3px)**, hard shadow, title (Heading M) + close `×`, body
copy, and an action button.

- **Welcome / info** — friendly heading, primary (yellow) action ("Let's Go!").
- **Confirm / delete** — warning icon, `Cancel` (outline) + `Delete` (**coral**) actions.
- **Share** — social buttons (link · Facebook · Twitter · WhatsApp) as bordered colored
  tiles.

---

## 12. Empty & states

Centered icon + heading (Heading M) + supporting copy (Small) + one action button.

| State | Copy | Action |
|---|---|---|
| **No quizzes yet** | "You haven't created any quizzes yet." | Create Quiz (yellow) |
| **No results found** | "We couldn't find any quizzes matching …" | Clear Search (outline) |
| **All caught up** | "You've completed all available quizzes." | Explore More (yellow) |
| **Offline** | "You're offline. Check your connection and try again." | Retry (teal) |

---

## 13. Illustrations & decor

Playful accents that reinforce the bold, celebratory tone: **confetti shapes** (small
squares, diamonds, and stars in the palette colors), a **trophy**, and a **stack of books**.
Use sparingly around empty states, celebration moments, and hero areas — always in the
palette colors with ink outlines.

---

## Core rules

The four moves that make the neo-brutalism style read correctly:

1. **Borders** — every surface and control has a **solid ink border**: `2px` default, `3px`
   for emphasis (modals, primary CTAs). No hairline or translucent borders.
2. **Shadows** — **hard offset, zero blur**, always ink:
   - `2px 2px 0` — small (badges, chips)
   - `4px 4px 0` — default (buttons, cards, inputs)
   - `6px 6px 0` — raised (modals, hovered cards)

   A colored offset shadow is allowed on colored icon tiles.
3. **Radius** — chunky but rounded: cards ≈16–20px · buttons & inputs ≈12px · icon tiles
   ≈12px · badges/pills fully rounded.
4. **Motion** — the signature interaction:
   - **Press:** `translate(2px, 2px)` and the shadow **collapses to `0`** (the control
     "sinks" onto the page).
   - **Hover:** lift `translate(-2px, -2px)` and the shadow **grows**.
5. **Flat fills** — solid vibrant color only. No gradients, no glows. Tints are a light wash
   of the *same* hue over white/cream, never a second brand color.

---

## Usage rules

1. **Color is semantic, not decorative.** Success/Easy = **teal**; Medium/New = **yellow**;
   Hard/Secondary = **purple**; Error/Delete/Expert = **coral**; Highlight/Popular =
   **orange**. Don't repurpose a color outside its role.
2. **Text-on-fill is fixed.** White text on Coral and Purple; Ink text on Yellow, Teal,
   Orange, White, and Cream. Use the [palette table](#1-color-palette) — never eyeball it.
3. **Everything is bordered and hard-shadowed.** A borderless or blurred-shadow element is
   off-system.
4. **Space Grotesk everywhere.** One family for headings and body; weight and size carry the
   hierarchy (see §2).
5. **Flat fills, no gradients or glows.** Tints come from opacity over white/cream on the
   same hue.
6. **Light-only.** Cream page, white cards, ink ink. There is no dark theme in this system.
7. **Cards = white · ink border · hard shadow · ~16–20px radius.** Keep the container shape
   consistent.

---

## For the code migration

When this spec is implemented in `src/app/globals.css` (Tailwind v4, `@theme inline`) and
`src/app/layout.tsx`:

- Add the tokens from §1's "Proposed token names" table to `:root` (light-only — no `.dark`
  block), and register each `--color-*` in `@theme inline`.
- Load **Space Grotesk** via `next/font/google` in `layout.tsx`, mapped to `--font-sans`
  and `--font-display` (retiring Syne, DM Sans, and Geist Mono). Remove the hard-coded
  `dark` class on `<html>`.
- Add utilities for the hard-shadow scale and the press/hover motion so components share one
  source of truth.
