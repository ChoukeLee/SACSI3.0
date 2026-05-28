---
version: 2.0
name: SACIS-design-system
description: A calm, professional property-operations design system. Indigo-blue primary on a warm neutral canvas. Data-dense dashboards for managers, finance staff, and front desk operators. Built on structural lessons from Stripe (color discipline), Notion (component clarity), and Linear (surface hierarchy).
---

colors:
  # ── Primary accent (indigo-blue) ──
  primary: "#4F5DE6"
  primary-hover: "#3D4BCF"
  primary-press: "#2F3BA8"
  primary-soft: "#EDEFFD"
  primary-soft-hover: "#DEE3FC"
  on-primary: "#FFFFFF"

  # ── Surface ladder ──
  canvas: "#F7F6F4"
  surface: "#FFFFFF"
  surface-soft: "#F3F2F0"
  surface-hover: "#EBEAE7"
  surface-dark: "#1E1F2C"

  # ── Borders ──
  hairline: "#E5E3E0"
  hairline-strong: "#D0CDC8"
  hairline-input: "#C5C3C8"

  # ── Text ──
  ink: "#181919"
  ink-muted: "#5C5D61"
  ink-subtle: "#949599"
  ink-on-dark: "#EDEDF0"

  # ── Semantic: room status ──
  status-available-bg: "#F0FDF4"
  status-available-border: "#86EFAC"
  status-available-text: "#166534"
  status-occupied-bg: "#EDEFFD"
  status-occupied-border: "#A5B0F6"
  status-occupied-text: "#2F3BA8"
  status-reserved-bg: "#FFF8EB"
  status-reserved-border: "#FCD34D"
  status-reserved-text: "#92400E"
  status-cleaning-bg: "#ECFEFF"
  status-cleaning-border: "#67E8F9"
  status-cleaning-text: "#155E75"
  status-maintenance-bg: "#FEF2F2"
  status-maintenance-border: "#FECACA"
  status-maintenance-text: "#991B1B"
  status-sold-bg: "#F5F5F4"
  status-sold-border: "#D6D3D1"
  status-sold-text: "#44403C"
  status-leased-bg: "#F5F3FF"
  status-leased-border: "#C4B5FD"
  status-leased-text: "#5B21B6"

  # ── Semantic: finance & feedback ──
  semantic-success: "#16A34A"
  semantic-success-bg: "#F0FDF4"
  semantic-warning: "#D97706"
  semantic-warning-bg: "#FFFBEB"
  semantic-danger: "#DC2626"
  semantic-danger-bg: "#FEF2F2"
  semantic-info: "#4F5DE6"
  semantic-info-bg: "#EDEFFD"

typography:
  page-title:
    fontSize: 22px
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: -0.3px
  section-title:
    fontSize: 16px
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: 0
  card-label:
    fontSize: 12px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: 0.04em
    textTransform: uppercase
  body:
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  body-sm:
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  table-text:
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: 0
  caption:
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: 0
  mono:
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"

rounded:
  xs: 4px
  sm: 6px
  md: 8px
  lg: 12px
  xl: 16px
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
  sm: "0 1px 2px rgba(24,25,25,0.04)"
  card: "0 1px 2px rgba(24,25,25,0.04), 0 4px 16px -8px rgba(24,25,25,0.08)"
  lifted: "0 8px 24px -12px rgba(24,25,25,0.12)"
  panel: "0 24px 60px -32px rgba(24,25,25,0.16), 0 0 0 1px rgba(24,25,25,0.04)"

components:
  # ── Button ──
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.card-label}"
    rounded: "{rounded.md}"
    padding: 8px 16px
    height: 36px
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.card-label}"
    rounded: "{rounded.md}"
    padding: 8px 16px
    height: 36px
    border: 1px solid "{colors.hairline}"
  button-secondary-hover:
    backgroundColor: "{colors.surface-soft}"
  button-ghost:
    backgroundColor: transparent
    textColor: "{colors.ink-muted}"
    typography: "{typography.card-label}"
    rounded: "{rounded.md}"
    padding: 6px 12px
    height: 36px
  button-ghost-hover:
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.ink}"
  button-danger:
    backgroundColor: "{colors.semantic-danger}"
    textColor: "#FFFFFF"
    typography: "{typography.card-label}"
    rounded: "{rounded.md}"
    padding: 8px 16px
    height: 36px
  button-danger-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.semantic-danger}"
    border: 1px solid "{colors.hairline}"
    rounded: "{rounded.md}"
    padding: 8px 16px
    height: 36px

  # ── Card ──
  card-default:
    backgroundColor: "{colors.surface}"
    border: 1px solid "{colors.hairline}"
    rounded: "{rounded.xl}"
    shadow: "{shadow.card}"
    padding: "{spacing.xl}"
  card-subtle:
    backgroundColor: "{colors.surface-soft}"
    border: 1px solid "{colors.hairline}"
    rounded: "{rounded.xl}"
    padding: "{spacing.xl}"

  # ── Table ──
  table-root:
    backgroundColor: "{colors.surface}"
    border: 1px solid "{colors.hairline}"
    rounded: "{rounded.xl}"
    typography: "{typography.table-text}"
  table-head:
    backgroundColor: "{colors.surface-soft}"
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
    backgroundColor: "{colors.surface-hover}"

  # ── KPI Card ──
  kpi-card:
    backgroundColor: "{colors.surface}"
    border: 1px solid "{colors.hairline}"
    rounded: "{rounded.xl}"
    shadow: "{shadow.card}"
    padding: "{spacing.lg}"
    minHeight: 96px

  # ── Input ──
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    border: 1px solid "{colors.hairline-input}"
    rounded: "{rounded.md}"
    padding: 8px 12px
    typography: "{typography.body}"
  input-focus:
    border: 1px solid "{colors.primary}"
    ring: 2px solid rgba(79,93,230,0.20)

  # ── Badge ──
  badge:
    rounded: "{rounded.full}"
    padding: 2px 10px
    typography: "{typography.caption}"
    fontWeight: 600

  # ── Tab ──
  tab-default:
    backgroundColor: transparent
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.md}"
    padding: 6px 14px
    typography: "{typography.card-label}"
  tab-active:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    shadow: "{shadow.sm}"

  # ── Empty State ──
  empty-state:
    backgroundColor: "{colors.surface}"
    border: 1px solid "{colors.hairline}"
    rounded: "{rounded.xl}"
    shadow: "{shadow.card}"
    padding: 64px 16px
    textColor: "{colors.ink-subtle}"
    typography: "{typography.body-sm}"

  # ── Panel ──
  panel:
    backgroundColor: "{colors.surface}"
    borderLeft: 1px solid "{colors.hairline}"
    shadow: "{shadow.panel}"
    width: 440px

---

## Overview

SACIS 3.0 is a property operations system for managers, finance staff, and front desk operators. The interface should feel calm, professional, and data-dense — a polished operational tool, not a marketing site.

The design system is built on three anchors:
- **Stripe's color discipline** — single indigo-blue accent, navy depth, monochrome discipline everywhere else
- **Notion's component clarity** — 8px rectangular buttons, 12px cards, sober editorial geometry
- **Linear's surface hierarchy** — canvas → surface → surface-soft ladder, hairline depth, zero decoration

**Key Characteristics:**
- **Indigo-blue primary** (`{colors.primary}` #4F5DE6) — the single chromatic accent. Used on primary CTAs, focus rings, active indicators, and "daily occupied" room status.
- **Warm neutral canvas** (`{colors.canvas}` #F7F6F4) — warmer than gray, cooler than cream. Provides temperature without competing with the blue primary.
- **Three-step surface ladder** (canvas → surface-soft → surface) carries hierarchy. Cards lift via hairline border + subtle shadow, not color fills.
- **Hairline borders** (`{colors.hairline}` #E5E3E0) — 1px warm-gray borders on all containers. No heavy outlines.
- **System font stack** — Microsoft YaHei / PingFang SC for Chinese, Segoe UI / system-ui for Latin. Tabular numbers for all amounts and counts.
- **Consistent 8px spacing unit** — all padding and gaps derive from the spacing scale.

## Product Tone

- Calm and professional, not flashy or decorative.
- Clean operational dashboard for daily work — managers must read finance and room status at a glance.
- Data-dense enough for power users, clean enough for occasional users.
- No fake controls. Every button, filter, tab, and chip must either work or be removed.
- No giant description cards at the top of mature modules. Start with data and controls.

## Colors

### Primary Accent

- **Indigo-Blue** (`{colors.primary}` — #4F5DE6): The single brand accent. Primary CTA buttons, focus rings, link emphasis, active navigation indicator, "daily occupied" room status.
- **Indigo Hover** (`{colors.primary-hover}` — #3D4BCF): Hover/pressed state for primary buttons.
- **Indigo Soft** (`{colors.primary-soft}` — #EDEFFD): Light indigo background for selected rows, hovered nav items, "daily occupied" status backgrounds.
- **Indigo Soft Hover** (`{colors.primary-soft-hover}` — #DEE3FC): Deeper soft indigo for hover-on-soft states.

### Surface

- **Canvas** (`{colors.canvas}` — #F7F6F4): Page background. Warm neutral that sits between pure white and warm cream.
- **Surface** (`{colors.surface}` — #FFFFFF): Cards, tables, panels, modals. Pure white.
- **Surface Soft** (`{colors.surface-soft}` — #F3F2F0): Filter bars, table headers, inactive tabs, alternating row backgrounds.
- **Surface Hover** (`{colors.surface-hover}` — #EBEAE7): Row hover, card hover lift.
- **Surface Dark** (`{colors.surface-dark}` — #1E1F2C): Sidebar navigation background. Deep navy-indigo for the desktop sidebar only.

### Borders

- **Hairline** (`{colors.hairline}` — #E5E3E0): Default card, input, and table borders.
- **Hairline Strong** (`{colors.hairline-strong}` — #D0CDC8): Active controls, selected tabs, stronger dividers.
- **Hairline Input** (`{colors.hairline-input}` — #C5C3C8): Slightly cooler border for form inputs (distinguishable from card borders).

### Text

- **Ink** (`{colors.ink}` — #181919): Headings, body text, important numbers. Near-black.
- **Ink Muted** (`{colors.ink-muted}` — #5C5D61): Secondary text, labels, table headers.
- **Ink Subtle** (`{colors.ink-subtle}` — #949599): Placeholder text, disabled states, captions.
- **Ink On Dark** (`{colors.ink-on-dark}` — #EDEDF0): Text on the dark sidebar.

### Room Status Colors

Every room tile, badge, and status indicator uses one consistent color mapping:

| Status | Background | Border | Text | Strip |
|---|---|---|---|---|
| Available | `#F0FDF4` | `#86EFAC` | `#166534` | `#22C55E` |
| Daily Occupied | `#EDEFFD` | `#A5B0F6` | `#2F3BA8` | `#4F5DE6` |
| Reserved | `#FFF8EB` | `#FCD34D` | `#92400E` | `#F59E0B` |
| Cleaning | `#ECFEFF` | `#67E8F9` | `#155E75` | `#06B6D4` |
| Maintenance/Locked | `#FEF2F2` | `#FECACA` | `#991B1B` | `#EF4444` |
| Sold | `#F5F5F4` | `#D6D3D1` | `#44403C` | `#78716C` |
| Leased | `#F5F3FF` | `#C4B5FD` | `#5B21B6` | `#8B5CF6` |

Always use background + border + text together. Never rely on background color alone to communicate status.

### Finance & Feedback Colors

- **Success** (`{colors.semantic-success}` — #16A34A): Paid, completed, on-track.
- **Warning** (`{colors.semantic-warning}` — #D97706): Partial payment, pending, overdue-soon.
- **Danger** (`{colors.semantic-danger}` — #DC2626): Overdue, cancelled, requires attention.
- **Info** (`{colors.semantic-info}` — #4F5DE6): Neutral informational status. Same as primary.

## Typography

### Font Family

System font stack for Chinese + Latin rendering:

```
"Microsoft YaHei", "PingFang SC", "Segoe UI", system-ui, -apple-system, sans-serif
```

Monospace for amounts, IDs, and receipt numbers:

```
ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace
```

### Hierarchy

| Token | Size | Weight | Line Height | Use |
|---|---|---|---|---|
| `page-title` | 22px | 700 | 1.25 | Main page heading |
| `section-title` | 16px | 700 | 1.3 | Card and section headings |
| `card-label` | 12px | 600 | 1.3 | Table headers, form labels, KPI labels, button labels |
| `body` | 14px | 400 | 1.5 | Normal body text, descriptions |
| `body-sm` | 13px | 400 | 1.5 | Supporting text, footnotes |
| `table-text` | 13px | 500 | 1.4 | Dense data rows, table cells |
| `caption` | 12px | 500 | 1.4 | Badge text, status labels, helper text |
| `mono` | 13px | 400 | 1.5 | Receipt numbers, IDs, currency amounts |

### Rules

- **No text below 12px.** Even in dense data tables, 12px is the floor.
- **Tabular numbers for amounts.** Every currency value, room count, or numeric stat uses `font-feature-settings: "tnum"` via the mono token.
- **Weight 700 for headings, 600 for labels, 400-500 for body.** Never use weight 800+.
- **Single font stack globally.** No decorative fonts, no serif headings.
- **Amount columns right-aligned** with mono font in all tables.

## Layout

### Spacing System

Base unit: 4px. Tokens: `xs` 4px · `sm` 8px · `md` 12px · `lg` 16px · `xl` 20px · `2xl` 24px · `3xl` 32px.

- Card padding: `xl` 20px default, `lg` 16px compact.
- Table cell padding: 10px 16px.
- Section gap: `2xl` 24px between major sections.
- Card grid gap: `md` 12px for dense grids, `lg` 16px for standard grids.
- Page content max-width: 1360px.

### Page Structure

- Main content fills available width. No large empty right-side areas.
- Consistent vertical rhythm: 24px between major sections, 16px within sections.
- Mature modules start with controls or data, not descriptive hero cards.
- Sidebar is the only dark surface on the page (`{colors.surface-dark}`).

### Cards

- Radius: `xl` 16px for page cards, `lg` 12px for compact cards.
- Border: 1px solid `{colors.hairline}`.
- Shadow: `{shadow.card}` — subtle, never heavy.
- Padding: `xl` 20px for normal cards, `lg` 16px for dense cards.
- No nested cards unless each is a repeated item.

### Tables

One shared table style across the entire system:

- White surface container, warm hairline border, `xl` 16px radius.
- Header background `{colors.surface-soft}`.
- Row height 44–48px for standard tables, 40px for dense tables.
- Amount columns: right-aligned, mono font, tabular numbers.
- Action column: one primary action. Avoid two competing buttons.
- Row hover: `{colors.surface-hover}` background.

## Elevation & Depth

| Level | Treatment | Use |
|---|---|---|
| 0 (flat) | No shadow | Page background, inline text |
| 1 (card) | `{shadow.card}` | Standard cards, table containers |
| 2 (lifted) | `{shadow.lifted}` | Hovered KPI cards, active panels |
| 3 (panel) | `{shadow.panel}` | Slide-out panels, dropdowns, modals |

No custom `shadow-[...]` values. No Tailwind defaults. Only the 4 defined tokens.

## Components

### Button

4 variants: primary, secondary, ghost, danger. All use `{rounded.md}` 8px, 36px height. Labels use `{typography.card-label}` (12px 600 uppercase).

- **Primary**: Indigo background, white text. The only filled blue button on screen.
- **Secondary**: White background, 1px hairline border, ink text.
- **Ghost**: Transparent, muted text, soft background on hover.
- **Danger**: Red background, white text. Only for destructive actions.
- **Icon buttons** must have tooltips or aria-labels.

Never build raw `<button>` elements outside the shared Button component.

### Card

2 variants: default (white + hairline + card shadow), subtle (surface-soft background). Both `{rounded.xl}` 16px, `{spacing.xl}` 20px padding.

### Table

Use `.data-table` or the shared Table component. Never override styles inline. Header: surface-soft background, hairline bottom border. Cells: 10px 16px padding. Row hover: surface-hover background. Amount columns: right-aligned with mono font.

### KPI Card

96px min-height, `{rounded.xl}`, white surface, hairline border, card shadow. Label above in `{typography.card-label}`, large value below in `{typography.page-title}` with mono font for numbers. Optional 4px-left color strip for semantic coding.

### Input

`{rounded.md}` 8px, hairline border, 8px 12px padding, `{typography.body}` 14px. Focus: 1px primary border + 2px primary ring at 20% opacity.

### Badge

Pill-shaped (`{rounded.full}`), 2px 10px padding, `{typography.caption}` 12px 600. Uses room-status or semantic color backgrounds at full opacity with matching text.

### Empty State

Centered content, `{rounded.xl}`, card shadow, 64px vertical padding, ink-subtle text.

### Panel (Slide-out)

White surface, hairline left border, panel shadow, 440px width.

## Module Rules

### Management Dashboard

Primary audience: owner / management. Must prioritize:
1. Current month receivable, received, unpaid, overdue.
2. Building room matrix with clear status colors (7 states).
3. Room cards grouped by floor — each card shows room number, status, customer name, date range, outstanding amount.

Secondary: risk alerts, data quality, operational details. Cards already showing data should not be followed by duplicate tables.

### Daily Rentals

The daily rental page is a timeline, not a spreadsheet.
- Default to dates around today, not first of month.
- Timeline fills available width, no large right-side gaps.
- 21 rooms readable without excessive vertical scrolling.
- Row height compact (46px) for one-screen overview.
- Empty cells clickable for new bookings; booking bars clickable for detail.
- All filter chips functional. Status colors match the global room status table.
- Booking bar colors: checked_in = primary indigo, confirmed = amber, pending_review = amber-light, cancelled/checked_out = neutral.

### Long Lease & Sale

Use grouped cards by floor or status. Avoid opening with one giant flat table. Tables are secondary detail views. Status colors follow the global room status table.

### Units

Unit list shows apartment status prominently. Parking and storefront assets are secondary. Each unit card: room number, status badge, customer, date range, outstanding amount.

### Finance

Finance pages match the management dashboard:
- Same KPI card style and table style.
- Clear amount alignment with tabular numbers.
- One primary action for creating ledger entries or receivables.
- Status colors for payment states: success (paid), warning (partial), danger (overdue).

### Customers

Clean list with search and filter. Blacklist indicator in danger color. Customer profile shows full history across daily/lease/sale.

### Front Desk (Mobile)

Mobile-optimized workspace:
- Room cards grouped by floor.
- Quick actions: checkout, record payment, complete cleaning, maintenance toggle.
- Today's checkouts and cleaning tasks surfaced first.
- Minimal chrome — the room cards are the interface.

## Do's and Don'ts

### Do
- Use `{colors.canvas}` (#F7F6F4) as the page background everywhere.
- Use `{colors.primary}` (#4F5DE6) ONLY for: primary CTA, focus ring, active nav, daily-occupied status.
- Use the surface ladder (canvas → surface-soft → surface) for hierarchy.
- Apply the shared room-status color table consistently across ALL modules.
- Use `{typography.card-label}` (12px 600) for all table headers, form labels, and KPI labels.
- Use `{typography.table-text}` (13px 500) for all table body cells.
- Use mono font + right-alignment for all amount columns.
- Card padding: 20px standard, 16px compact. Never mix arbitrary values.
- Use `{shadow.card}` for container lift. Never use Tailwind defaults.

### Don't
- Don't use orange, green, or any second chromatic accent for CTAs or active states.
- Don't build raw `<button>` elements. Use the Button component.
- Don't override table styles inline. Use the shared table classes.
- Don't create nested cards unless each item is a repeated element.
- Don't use text below 12px.
- Don't use font weights above 700.
- Don't mix multiple font stacks or introduce decorative typefaces.
- Don't rely on background color alone for room status — always pair bg + border + text.
- Don't make the sidebar light. The dark sidebar anchors the layout.
- Don't add large explanatory hero sections to mature modules — start with data.

## Responsive Behavior

### Breakpoints

| Name | Width | Key Changes |
|---|---|---|
| Mobile | < 768px | Bottom nav, single-column, cards full-width. Front desk workspace becomes primary view. |
| Tablet | 768–1023px | Sidebar collapsed. Feature grids 2-up. |
| Desktop | 1024px+ | Full sidebar, multi-column grids, full data tables. |

### Touch Targets
- All interactive elements ≥ 40×40px on touch screens.
- Form inputs minimum 40px height on mobile.
- Bottom nav items ≥ 44px tap target.

### Font Scaling
- Page title: 22px desktop → 18px mobile.
- Table text: 13px desktop → 12px mobile (12px is the absolute floor).
- Card labels: 12px, consistent across all breakpoints.

## Implementation Priority

1. **Tokens & Foundation** — Update tailwind.config.ts, globals.css, and 4 UI primitives.
2. **Status Colors** — Update status-styles.ts, room-status.ts to match the new 7-state table.
3. **Shell** — Dark sidebar, updated nav, page header, metric card, empty state.
4. **Management Dashboard** — Room matrix, finance overview, KPI cards.
5. **Daily Rentals** — Timeline calendar, booking panel, room status display.
6. **Long Lease & Sale** — Card grids, contract lists, detail panels.
7. **Finance** — Ledger, receivables, reports.
8. **Units & Customers** — Unit list, customer list, profile views.
9. **Remaining Modules** — Front desk, todos, documents, settings, data exchange, bulk actions, security.
10. **Page Files & Meta** — layout.tsx viewport color, loading.tsx, login page.
