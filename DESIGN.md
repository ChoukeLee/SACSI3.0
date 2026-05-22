---
version: 1.0
name: SACIS-design-system
description: "Warm professional B2B property management UI. Light canvas (#faf9f8), white surface cards with natural shadow, SACIS orange (#F45A2A) as single chromatic accent. Clean data-dense dashboards with hairline borders. MiSans typeface for Chinese + Latin. Built on Linear's structural principles adapted for light-mode operational software."
---

colors:
  canvas: "#faf9f8"
  surface-1: "#ffffff"
  surface-2: "#f6f4f1"
  surface-3: "#eeebe6"
  ink: "#1c1917"
  ink-muted: "#5c5651"
  ink-subtle: "#948c86"
  hairline: "#e8e4e0"
  hairline-strong: "#d4cfc9"
  primary: "#F45A2A"
  primary-hover: "#D9461C"
  primary-text: "#ffffff"
  semantic-success: "#0E8F7E"
  semantic-warning: "#F5A623"
  semantic-danger: "#C74646"

typography:
  page-title:
    fontSize: 20px
    fontWeight: 800
    lineHeight: 1.25
    letterSpacing: -0.3px
  section-label:
    fontSize: 13px
    fontWeight: 800
    lineHeight: 1.3
    letterSpacing: 0.08em
  card-label:
    fontSize: 11px
    fontWeight: 800
    lineHeight: 1.3
    letterSpacing: 0.08em
  body:
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  body-sm:
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 0
  mono:
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0

rounded:
  sm: 6px
  md: 8px
  lg: 12px
  xl: 16px
  "2xl": 20px
  full: 9999px

spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 20px
  "2xl": 24px
  "3xl": 32px

shadow:
  none: "none"
  sm: "0 1px 2px rgba(28,25,23,0.04)"
  card: "0 1px 2px rgba(28,25,23,0.04), 0 8px 24px -16px rgba(28,25,23,0.08)"
  panel: "0 24px 60px -32px rgba(28,25,23,0.20), 0 0 0 1px rgba(28,25,23,0.04)"
  dropdown: "0 14px 34px -22px rgba(28,25,23,0.16), 0 0 0 1px rgba(28,25,23,0.04)"
  lifted: "0 12px 32px -16px rgba(244,90,42,0.18)"

components:
  # ── Button ──
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-text}"
    typography: "{typography.card-label}"
    rounded: "{rounded.md}"
    padding: 8px 16px
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.card-label}"
    rounded: "{rounded.md}"
    padding: 8px 16px
    border: 1px solid "{colors.hairline}"
  button-secondary-hover:
    backgroundColor: "{colors.surface-2}"
  button-ghost:
    backgroundColor: transparent
    textColor: "{colors.ink-muted}"
    typography: "{typography.card-label}"
    rounded: "{rounded.md}"
    padding: 8px 12px
  button-ghost-hover:
    backgroundColor: "{colors.surface-2}"
  button-danger:
    backgroundColor: "{colors.semantic-danger}"
    textColor: white
    typography: "{typography.card-label}"
    rounded: "{rounded.md}"
    padding: 8px 16px
  button-danger-secondary:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.semantic-danger}"
    border: 1px solid "{colors.hairline}"
    rounded: "{rounded.md}"
    padding: 8px 16px
  button-icon:
    backgroundColor: transparent
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.md}"
    padding: 6px
  button-icon-hover:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"

  # ── Card ──
  card-default:
    backgroundColor: "{colors.surface-1}"
    border: 1px solid "{colors.hairline}"
    rounded: "{rounded.xl}"
    shadow: "{shadow.card}"
    padding: "{spacing.xl}"
  card-subtle:
    backgroundColor: "{colors.surface-2}"
    border: 1px solid "{colors.hairline}"
    rounded: "{rounded.xl}"
    padding: "{spacing.xl}"
  card-dashed:
    backgroundColor: "{colors.surface-1}"
    border: 1px dashed "{colors.hairline-strong}"
    rounded: "{rounded.xl}"
    padding: "{spacing.xl}"

  # ── Table ──
  table-root:
    width: 100%
    typography: "{typography.body-sm}"
  table-head:
    backgroundColor: "{colors.surface-2}"
    borderBottom: 1px solid "{colors.hairline}"
  table-th:
    padding: 10px 16px
    typography: "{typography.card-label}"
    textColor: "{colors.ink-muted}"
  table-td:
    padding: 10px 16px
    textColor: "{colors.ink}"
    borderBottom: 1px solid "{colors.hairline}"
  table-row-hover:
    backgroundColor: "{colors.surface-2}"

  # ── KPI Card ──
  kpi-card:
    backgroundColor: "{colors.surface-1}"
    border: 1px solid "{colors.hairline}"
    rounded: "{rounded.xl}"
    padding: "{spacing.lg}"
    minHeight: 96px

  # ── Input ──
  input:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    border: 1px solid "{colors.hairline}"
    rounded: "{rounded.md}"
    padding: 8px 12px
    typography: "{typography.body}"
  input-focus:
    border: 1px solid "{colors.primary}"
    ring: 2px solid rgba(244,90,42,0.20)

  # ── Badge / Status Pill ──
  badge:
    rounded: "{rounded.full}"
    padding: 2px 10px
    typography: "{typography.body-sm}"
    fontWeight: 700

  # ── Tab / Segment ──
  tab-default:
    backgroundColor: transparent
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.md}"
    padding: 6px 12px
    typography: "{typography.card-label}"
  tab-active:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    shadow: "{shadow.sm}"

  # ── Empty State ──
  empty-state:
    backgroundColor: "{colors.surface-1}"
    border: 1px solid "{colors.hairline}"
    rounded: "{rounded.xl}"
    shadow: "{shadow.card}"
    padding: 64px 16px
    textColor: "{colors.ink-subtle}"
    typography: "{typography.body-sm}"

  # ── Slide-out Panel ──
  panel:
    backgroundColor: "{colors.surface-1}"
    borderLeft: 1px solid "{colors.hairline}"
    shadow: "{shadow.panel}"
    width: 440px

  # ── Page Shell ──
  page-shell:
    backgroundColor: "{colors.canvas}"
  page-content:
    maxWidth: 1360px
    padding: "{spacing.xl}"
---

## Overview

SACIS 3.0 is a warm professional B2B property management system. The design adapts Linear's structural rigor — surface ladder, consistent radius scale, single chromatic accent — to a light-mode, data-dense operational context.

**Key Characteristics:**
- **Warm light canvas** (`{colors.canvas}` #faf9f8) — warmer than pure gray, softer than stark white.
- **SACIS Orange** (`{colors.primary}` #F45A2A) — the single chromatic accent. Used on primary CTAs, focus rings, active indicators.
- **Surface ladder** (canvas → surface-2 → surface-1) carries hierarchy. Cards lift via `{shadow.card}` not color fills.
- **Hairline borders** (`{colors.hairline}` #e8e4e0) — 1px warm gray borders on all containers. No heavy outlines.
- **MiSans typeface** — one font family for Chinese + Latin. Six typography tokens cover all needs.
- **Consistent 8px spacing unit** — all padding and gaps derive from the spacing scale.

## Colors

### Surface
- **Canvas** (`{colors.canvas}`): Page background — warm off-white #faf9f8.
- **Surface 1** (`{colors.surface-1}`): Cards, panels, inputs — pure white #ffffff.
- **Surface 2** (`{colors.surface-2}`): Subtle lift — hover states, table headers, secondary sections #f6f4f1.
- **Surface 3** (`{colors.surface-3}`): Stronger lift — sidebar backgrounds, expanded panels #eeebe6.

### Text
- **Ink** (`{colors.ink}`): Primary text, headlines — warm near-black #1c1917.
- **Ink Muted** (`{colors.ink-muted}`): Secondary text, labels — #5c5651.
- **Ink Subtle** (`{colors.ink-subtle}`): Placeholder, disabled — #948c86.

### Borders
- **Hairline** (`{colors.hairline}`): Default card/input borders — #e8e4e0.
- **Hairline Strong** (`{colors.hairline-strong}`): Focus rings, active borders — #d4cfc9.

### Semantic
- **Primary** (`{colors.primary}`): SACIS Orange — CTAs, focus, active states.
- **Success** (`{colors.semantic-success}`): Paid, available, completed.
- **Warning** (`{colors.semantic-warning}`): Partial, pending, overdue-soon.
- **Danger** (`{colors.semantic-danger}`): Overdue, cancelled, maintenance.

## Typography

### Font Family
MiSans for all text — Chinese, Latin, numbers. Single family, consistent voice.

### Hierarchy

| Token | Size | Weight | Use |
|---|---|---|---|
| `page-title` | 20px | 800 | Page headings |
| `section-label` | 13px | 800 | Section headers, card titles |
| `card-label` | 11px | 800 | Form labels, table headers, KPI labels |
| `body` | 13px | 400 | Body text, table cells, form values |
| `body-sm` | 11px | 400 | Captions, footnotes, helper text |
| `mono` | 12px | 400 | Receipt numbers, IDs, currency codes |

**Principles:**
- Single font family (MiSans). No serif, no secondary sans.
- Weight 800 for labels and headings (not 700, not 900).
- Weight 400 for body and data.
- Uppercase + tracking on labels only, never on body or data.

## Border Radius

| Token | Value | Use |
|---|---|---|
| `sm` | 6px | Inline tags, tiny chips |
| `md` | 8px | Buttons, inputs, tabs |
| `lg` | 12px | Compact cards, filter bars |
| `xl` | 16px | Standard cards, panels, sections |
| `2xl` | 20px | Page-level containers, hero sections |
| `full` | 9999px | Status pills, avatars |

**Never use**: rounded-3xl (not in config), arbitrary `rounded-[22px]`, `rounded-[24px]`.

## Spacing

Base unit 4px. Tokens: 4 · 8 · 12 · 16 · 20 · 24 · 32.

- Card padding: 20px default, 16px compact.
- Table cell padding: 10px 16px.
- Section gap: 24px between major sections.
- Card grid gap: 12px or 16px depending on density.

## Elevation

| Level | Treatent | Use |
|---|---|---|
| 0 (flat) | No shadow | Page background, inline text |
| 1 (card) | `{shadow.card}` | Standard cards, panels |
| 2 (lifted) | `{shadow.lifted}` | Hovered KPI cards, featured items |
| 3 (panel) | `{shadow.panel}` | Slide-out panels, dropdowns |

No custom shadow-[...] values. No Tailwind defaults (shadow-lg, shadow-xl, etc.). Only the 5 defined tokens.

## Components

### Button
4 variants: primary, secondary, ghost, danger (+ danger-secondary). All use `{rounded.md}` 8px, `{spacing.sm}` 8px vertical, `{spacing.lg}` 16px horizontal padding. Labels use `{typography.card-label}`.

### Card
3 variants: default (white + hairline border + card shadow), subtle (surface-2 bg), dashed. All use `{rounded.xl}` 16px, `{spacing.xl}` 20px padding.

### Table
Single `.data-table` CSS class. No inline overrides. Header: surface-2 bg, hairline border-bottom. Cells: 10px 16px padding. Row hover: surface-2 bg.

### KPI Card
96px min-height, `{rounded.xl}`, surface-1 bg, hairline border. Left color bar (4px wide) for semantic coding. Label above, large number below.

### Input
`{rounded.md}` 8px, hairline border, 8px 12px padding. Focus: primary ring at 20% opacity.

### Badge
Pill-shaped (`{rounded.full}`), 2px 10px padding. Semantic color backgrounds at 10-15% opacity with matching text.

### Empty State
Centered, `{rounded.xl}`, card shadow, 64px vertical padding, ink-subtle text.

## Do's and Don'ts

### Do
- Use `{colors.canvas}` as the page background everywhere.
- Use `{colors.primary}` ONLY for: primary CTA, focus ring, active indicator.
- Use the surface ladder (canvas → surface-2 → surface-1) for hierarchy.
- Use `{typography.card-label}` (11px 800) for ALL form labels and table headers.
- Use `{typography.body}` (13px 400) for ALL body text and table cells.
- Use `{shadow.card}` for all container lift — no Tailwind default shadows.
- Use `{colors.hairline}` (#e8e4e0) for all card and input borders.
- Card padding always 20px; compact cards 16px; filter bars 12px.

### Don't
- Don't mix slate-200 with neutral-200. Use `{colors.hairline}` everywhere.
- Don't use custom shadow-[...] values. Use the 5 defined tokens.
- Don't use rounded-3xl or arbitrary rounded-[...] values.
- Don't use font-bold (700) or font-semibold (600). Use font-black (800) or font-normal (400).
- Don't build raw <button> elements. Use the Button component.
- Don't override `.data-table` styles inline. Use the component as-is.
- Don't use p-3, p-4, p-5 arbitrarily. Card = 20px, compact = 16px, input = 8px 12px.
- Don't introduce a second chromatic accent (purple, blue, green for CTAs).
- Don't use bg-slate-50 for page backgrounds. Use `{colors.canvas}`.

## Migration Guide

Priority order:
1. Unify border colors → replace all border-slate-200, border-neutral-200 with border-hairline
2. Fix shadows → replace all custom shadow-[...] and Tailwind defaults with tokens
3. Standardize container padding → p-5/p-4/p-3 → xl(20px)/lg(16px)/md(12px)
4. Replace raw buttons → use Button component
5. Fix tables → remove inline overrides on .data-table
6. Unify typography → 11px 800 labels, 13px 400 body
