# SACIS Design System V2

Property operations system for managers, finance, and front desk. Warm, bright, data-dense, professional.
Grounded in shadcn/ui dashboard blocks, getdesign.md warm/product patterns, and SACIS real business data.

## Color System

### Surface
- `canvas`: `#FAF9F8` — page background, warm off-white
- `surface`: `#FFFFFF` — cards, tables, panels
- `surface-muted`: `#F5F4F2` — filter bars, table headers, secondary sections

### Primary Accent — Warm Orange
- `primary`: `#F45A2A` — primary CTA, active nav, focus ring
- `primary-hover`: `#E04A1C` — hover state
- `primary-soft`: `#FFF3EE` — light orange background for selected/hover states
- `primary-foreground`: `#FFFFFF` — text on primary

### Text
- `ink`: `#1C1917` — headings, body text
- `ink-muted`: `#6B6560` — secondary text, labels
- `ink-subtle`: `#9B9590` — placeholder, disabled

### Border
- `border`: `#E8E4E0` — default card/input borders
- `border-strong`: `#D4CFC9` — focus rings, active borders

### Room Status Cards

Each status has a distinct, warm, muted background. Cards use solid fill — status is read from the background color alone. A legend outside the matrix explains the mapping.

| Status | Background | Text | Description |
|--------|-----------|------|-------------|
| sold | `#EDE8E3` | `#5C554F` | sold = warm gray, neutral permanent |
| leased | `#FEF0E0` | `#7D5E2E` | leased = warm amber, stable long-term |
| daily_occupied | `#FFF1EB` | `#9B3D1C` | daily = warm orange-pink, active |
| reserved | `#EEF4FA` | `#3C6080` | reserved = soft blue, pending arrival |
| cleaning_pending | `#EDF7F5` | `#2D6B60` | cleaning = soft teal, service |
| maintenance | `#FBEDED` | `#8B3535` | maintenance = soft rose, blocked |
| available | `#EDF5ED` | `#356B35` | available = soft green, ready |

### Semantic Colors
- `success`: `#0E8F7E` — paid, completed
- `warning`: `#D97706` — partial, pending
- `danger`: `#C74646` — overdue, cancelled

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
