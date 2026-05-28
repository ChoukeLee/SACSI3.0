# SACIS Design System V2 — Soft Hotel Palette

Property operations system. Soft, professional, hotel-backend aesthetic.
Grounded in shadcn/ui dashboard blocks, getdesign.md product patterns, and SACIS real business data.

## Color System

### Surface
- `canvas`: `#F7F6F4` — page background, warm neutral white
- `surface`: `#FFFFFF` — cards, tables, panels
- `surface-muted`: `#F3F2F0` — filter bars, table headers, secondary sections

### Primary Accent — Soft Indigo
- `primary`: `#4F5DE6` — primary CTA, active nav, focus ring
- `primary-hover`: `#3D4BCF` — hover state
- `primary-soft`: `#EDEFFD` — light indigo background for selected/hover states
- `primary-foreground`: `#FFFFFF` — text on primary

### Text
- `ink`: `#181919` — headings, body text
- `ink-muted`: `#5C5D61` — secondary text, labels
- `ink-subtle`: `#949599` — placeholder, disabled

### Border
- `border`: `#E5E3E0` — default card/input borders
- `border-strong`: `#D0CDC8` — focus rings, active borders

### Room Status Cards — "Girlfriend Palette"

Status expressed through solid background color. Legend outside the matrix.

| Status | Background | Text | Description |
|--------|-----------|------|-------------|
| sold | `#505080` | white text on badge | deep indigo-gray, neutral permanent |
| leased | `#7050A0` | white text on badge | purple, stable long-term |
| daily_occupied | `#5090C0` | white text on badge | soft steel blue, active |
| reserved | `#A0C0E0` | `#1F4564` text | light blue, pending arrival |
| cleaning_pending | `#5AB5B8` | white text on badge | teal, service required |
| maintenance | `#F0A080` | `#673522` text | warm peach, blocked |
| available | `#F0E0D0` | `#4F4238` text | cream beige, ready |

Note: Cards with dark backgrounds (sold, leased, daily, cleaning) use white text.
Cards with light backgrounds (reserved, maintenance, available) use dark text.

### Semantic Colors
- `success`: `#16A34A` — paid, completed
- `warning`: `#D97706` — partial, pending
- `danger`: `#DC2626` — overdue, cancelled

## Typography

Single font stack: `"MiSans", "Microsoft YaHei", "PingFang SC", "Segoe UI", system-ui, -apple-system, sans-serif`

| Role | Size | Weight | Line | Use |
|------|------|--------|------|-----|
| page-title | 20px | 700 | 1.3 | Main heading |
| section-title | 15px | 700 | 1.3 | Card/section headings |
| body | 14px | 400 | 1.5 | Normal text |
| body-sm | 13px | 400 | 1.5 | Secondary text |
| label | 12px | 600 | 1.3 | Table headers, form labels |
| caption | 12px | 500 | 1.3 | Badge text, meta |
| mono | 13px | 500 | 1.5 | Room numbers, amounts, IDs |

Rules:
- Minimum text size: 12px
- Amount columns: right-aligned, tabular-nums, mono font
- No text below 12px anywhere

## Border Radius
- `sm`: 6px — inline tags
- `md`: 8px — buttons, inputs
- `lg`: 12px — compact cards
- `xl`: 16px — page cards, panels

## Shadows
- `sm`: `0 1px 2px rgba(28,25,23,0.04)`
- `card`: `0 1px 2px rgba(28,25,23,0.04), 0 8px 24px -16px rgba(28,25,23,0.08)`
- `panel`: `0 24px 60px -32px rgba(28,25,23,0.16), 0 0 0 1px rgba(28,25,23,0.04)`

## Components

### Button
- `default`: orange bg, white text, 8px radius, 36px height
- `secondary`: white bg, hairline border, ink text
- `ghost`: transparent, muted text
- `destructive`: red bg, white text, for delete/cancel only

### Card
- White surface, 16px radius, hairline border, card shadow
- Padding: 20px default, 16px compact

### Badge
- Pill shape, 12px bold text, light bg with matching text
- Variants: default(orange), secondary(gray), success(green), warning(amber), destructive(red)

### RoomCard
- Status expressed through card background color — no redundant status text inside card
- Fixed aspect: 144px wide × 96px tall
- Maximum 6 cards per row in a floor group
- Content: room number pill (top-left), customer name or "可安排入住" (center), up to 3 round icon buttons (bottom)
- Hover: subtle shadow lift on the card, buttons highlight individually
- External legend maps colors to statuses

### DataTable
- White container, hairline border, 16px radius
- Header: surface-muted bg, 12px 600 label
- Row: 44px height, hairline bottom border, hover bg change
- Amount columns: right-aligned, tabular-nums, mono font

### KPI Card
- White card, hairline border, card shadow
- Top color strip (4px) for semantic coding
- Label above, large number below, optional trend caption

## Page Layout — /management

1. KPI row: 4 cards (receivable, collected, outstanding, overdue)
2. Room status matrix:
   - One section per floor
   - Floor label + room count
   - 6 cards per row max
   - Color legend outside the matrix (above or to the side)
3. Risk alerts or recent activity (secondary)

## Anti-patterns
- No dark sidebar — use light warm canvas
- No purple/indigo as primary — orange only
- No status text repeated inside colored cards
- No giant description cards at page top
- No fake charts with hardcoded data
- No nested cards
- No text below 12px
