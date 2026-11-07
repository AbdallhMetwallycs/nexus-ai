# NEXUS AI — UI Design System (Phase 1)

Design personality: **professional, intelligent, minimalist, premium, technical.**
Powerful without visual noise: one accent, restrained saturation, dense-but-breathable
spacing, and honest labeling of everything simulated.

## 1. Identity

- **Name (temporary):** NEXUS AI — "Local Intelligence Platform".
- **Logo:** geometric "N" drawn as a continuous neural path in a rounded-square
  tile, gradient sky-blue → violet, with two node dots (input/output). Shipped as
  `public/nexus-logo.svg`, reproduced as inline React in `src/components/common/Logo.tsx`
  (no duplicated gradient IDs; safe for multiple instances).
- **Wordmark:** `NEXUS` extrabold + `AI` in accent color, tagline
  "Local Intelligence Platform" at 11 px.
- **Language of the identity:** the "N" path reads as a signal travelling
  through layers — local, deterministic, connected.

## 2. Color

Dark is the initial theme. Tokens live as CSS variables in `src/index.css`
consumed by Tailwind (`tailwind.config.js`), so a screen never hardcodes hex.

| Token | Dark | Light | Use |
|---|---|---|---|
| `surface-base` | `#0B0F17` | `#F6F8FB` | app canvas |
| `surface-raised` | `#111722` | `#FFFFFF` | cards, sidebar |
| `surface-overlay` | `#18202E` | `#FFFFFF` | modals, menus, toasts |
| `surface-line` | `#283447` | `#D6DEEB` | borders, tracks |
| `ink-primary` | `#E2E8F0` | `#0F172A` | titles, body |
| `ink-secondary` | `#94A3B8` | `#475569` | secondary text |
| `ink-muted` / `ink-faint` | `#64748B` / `#475569` | `#64748B` / `#94A3B8` | meta, captions |

Accents and semantics (shared across both themes):

- **Accent sky** `#38BDF8` (+ deep `#0284C7` for primary buttons): actions,
  active nav, focus rings, links, key data.
- **Violet** `#A78BFA` / `#7C3AED`: the *prototype/mock* channel — the DEMO
  banner, prototype badges, user-avatar in chat. Violet always means
  "demo identity", never "real system state".
- Status scale: ok `#34D399`, warn `#FBBF24`, err `#F87171`, info `#38BDF8`,
  idle `#94A3B8` — used consistently for model/tool/approval/connectivity state.

## 3. Typography

- **UI:** Inter (400/500/600/700/800) → falls back to Segoe UI / system-ui,
  so the app looks native on Windows even fully offline.
- **Data/code:** JetBrains Mono → Cascadia Code → Consolas.
- Scale (Tailwind): `2xs 11px` meta · `xs 12px` table/secondary · `sm 14px` body ·
  `base 16px` titles · `lg 18px` page title · `xl 20px` hero numbers.
- Mono numerals get `.mono-num` (font-mono + tabular-nums) — every percentage,
  byte figure, version and timestamp aligns optically.

## 4. Spacing, radius, elevation

- 4 px rhythm: `p-5` page padding, `space-y-4/5` between cards, `gap-2/2.5/3`
  in toolbars, `py-2.5` list rows.
- Radius: `rounded-card 12px` (cards/modals), `rounded-field 8px` (inputs/buttons),
  full pills for badges/chips.
- Shadows: `shadow-card` (1 px inner light + micro ambient), `shadow-pop`
  (menus/modals), `shadow-glow` (accent focus moments). Elevation is expressed
  mainly with **border + background step**, not big shadows — the premium cue.

## 5. Interaction states

- Every control has hover/focus/disabled states; `:focus-visible` draws a 2 px
  accent outline globally (keyboard navigation requirement).
- Motion is functional only: `fade-in 150ms`, `slide-up 180ms`, pulse dots for
  live-ish status. No decorative animation, no infinite loops inside content.
- Busy affordances (indexing, thinking, update checks) use spinners/pulse plus a
  toast that names the simulation.

## 6. Layout geometry

Desktop-first: `Sidebar (212px, collapsible 56px) | Topbar 48px | content`,
optional `context rail 260–300px` at ≥1280 (xl). Chat gets a 248 px thread list.
Content columns cap at `max-w-3xl` (chat) and use responsive card grids
(`md:grid-cols-2 xl:grid-cols-4`) so 1280×720, 1366×768 and 1920×1080 all stay
balanced without horizontal scroll.

## 7. The honesty layer (product-level design rule)

Because Phase 1 is UI-only, the design system bakes in truthfulness:

1. `<DemoNotice/>` violet banner on every data screen.
2. "UI prototype · Phase 1" badge permanently visible in the Topbar.
3. Every simulated action's toast/modal text says *what did not happen*
   ("no download occurred", "no model ran", "prototype state only").
4. Simulated telemetry refreshes deterministically and is labeled
   "not real sensor data" in tooltips.

## 8. Theming architecture

`ThemeContext` toggles `.dark`/`.light` on `<html>`; all component colors resolve
through CSS variables, so light mode is architecturally supported with zero
per-component work. Dark remains the default identity theme.
