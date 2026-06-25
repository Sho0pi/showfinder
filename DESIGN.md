# Design System — Spotify Show Finder

## Product Context
- **What:** Web app that maps upcoming concerts for the artists you listen to on Spotify.
- **Who:** Music fans who want to catch their artists live, plan trips around shows.
- **Type:** Single-page React app (Vite + Bun), map-forward.

## Aesthetic Direction
- **Direction:** Editorial-utility with a physical concert-ticket / tour-poster motif.
- **Decoration:** intentional — subtle film grain, ticket-stub perforations, gradient avatar rings.
- **Mood:** Warm, tactile, confident. "Your music, made physical." Map is the hero.
- **The memorable thing:** these are MY artists, and here's exactly where to catch them.

## Typography
- **Display/Hero:** Cabinet Grotesk (700/800) — poster boldness. (Fontshare)
- **Body/UI:** Geist (400–600). (Google Fonts)
- **Metadata (dates, venue, labels):** JetBrains Mono — ticket-print texture. (Google Fonts)
- **Loading:** `<link>` tags in `index.html` (Google + Fontshare).
- **Tailwind tokens:** `font-display`, `font-body` (default), `font-mono`.

## Color
- **Approach:** restrained — one warm accent + neutrals; teal as a secondary/interactive hue.
- **Canvas:** `#100E10` · **Surface:** `#1A171B` · **Surface-2:** `#221E23`
- **Ember (primary accent):** `#FF5A3C` — CTAs, dates, pins, the "ticket stub."
- **Teal (secondary):** `#5BC8C2` — genre chips, map interactive, kickers.
- **Text:** `#F4EFEA` · **Muted:** `#8B8389` · **Hairline:** `rgba(244,239,234,.10)`
- **Tailwind tokens:** `bg-canvas`, `bg-surface`, `bg-surface2`, `text-ember`, `text-teal`, `text-ink`, `text-muted`, `border-line`.
- **Dark only** (warm dark canvas is core to the identity).

## Spacing
- **Base unit:** 8px. **Density:** comfortable.

## Layout
- **Approach:** hybrid — map hero, ranked artist rail, editorial card grid.
- **Max content width:** `min(1180px, 94vw)`.
- **Radius:** sm 8 / md 14 / lg 22 / pill 9999 (`rounded-sm/md/lg/full`).

## Motion
- **Lib:** framer-motion. **Approach:** intentional.
- Card entrance: fade + 14px rise, ease-out 320ms, 40ms stagger (capped 400ms).
- Hover lift 3px. Map pins drop in. `prefers-reduced-motion` disables all animation (CSS guard).

## Signature elements
- Map hero (CARTO dark tiles) with coral teardrop pins (`.pin-teardrop`).
- Ranked circular artist rail with gradient ring (`.avatar-ring`), `#rank` label.
- Concert cards as tickets: photo, mono date, poster headline, mono venue, genre chips,
  dashed perforated stub footer (`.ticket-stub`) with vendor + ember Tickets CTA.
- Film-grain overlay (`body::before`).

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-06-25 | Initial system via /design-consultation | Ticket/poster metaphor; ember over Spotify-green for distinct identity. Stack: Tailwind v4 + lucide-react + framer-motion. |
