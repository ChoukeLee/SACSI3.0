# SACIS Design System V2 — Cal.com + Airtable + Notion

Property operations system. Clean, neutral, hotel-backend aesthetic optimized for daily rental scheduling, structured data, and long-session comfort.

## Design References

| Reference | Role | What We Take |
|-----------|------|-------------|
| **Cal.com** | Primary | Scheduling-first product structure, black primary CTAs, soft-white canvas, 12px card corners, generous whitespace, product UI in cards |
| **Airtable** | Data | Structured tables and filters, sober editorial typography, signature card colors for visual distinction, modest weights (never bold for its own sake) |
| **Notion** | Surface | Warm minimalism, soft surface tones (`#f6f5f4`), pastel-tinted feature cards, comfortable long-session feel, deep rich ink |

SAICS is not a copy of any brand. It is a property-operations product that schedules rooms like Cal.com, displays data like Airtable, and feels comfortable like Notion.

## Color System

### Surface — Cal.com white + Notion warm

- `canvas`: `#f6f5f4` — page background, warm off-white (Notion)
- `surface`: `#ffffff` — cards, tables, panels (Cal.com)
- `surface-muted`: `#f8f9fa` — filter bars, table headers, secondary sections (Cal.com)

### Primary CTA — Cal.com black-ink approach

- `primary`: `#111111` — primary buttons, active nav (Cal.com)
- `primary-hover`: `#242424` — hover state (Cal.com)
- `primary-foreground`: `#ffffff` — text on primary
- `primary-soft`: `#f3f4f6` — light background for selected/hover states

### Accent — Cal.com blue for links and focus

- `accent`: `#3b82f6` — focus ring, link emphasis, active indicator

### Text — Airtable ink

- `ink`: `#181d26` — headings, body text (Airtable)
- `ink-muted`: `#374151` — secondary text, labels (Cal.com)
- `ink-subtle`: `#6b7280` — placeholder, disabled (Cal.com)

### Border — Cal.com hairline

- `border`: `#e5e7eb` — default card/input borders (Cal.com)
- `border-strong`: `#d1d5db` — focus rings, active borders

### Semantic — Cal.com

- `success`: `#10b981` — paid, completed
- `warning`: `#f59e0b` — partial, pending
- `error`: `#ef4444` — overdue, cancelled, maintenance

### Room Status — User's Soft Hotel Palette

Status expressed through solid background color. Never overridden by getdesign brand colors.

| Status | Background | Usage |
|--------|-----------|-------|
| sold | `#505080` | deep indigo-gray, neutral permanent |
| leased | `#7050A0` | purple, stable long-term |
| daily_occupied | `#5090C0` | soft steel blue, active daily use |
| reserved | `#A0C0E0` | light blue, pending arrival |
| cleaning_pending | `#5AB5B8` | teal, service required |
| maintenance | `#F0A080` | warm peach, blocked |
| available | `#F0E0D0` | cream beige, ready |

## Typography

Single font stack: `"MiSans", "Microsoft YaHei", "PingFang SC", "Segoe UI", system-ui, -apple-system, sans-serif`

| Role | Size | Weight | Use |
|------|------|--------|-----|
| page-title | 20px | 700 | Main heading |
| section-title | 15px | 600 | Card/section headings |
| body | 14px | 400 | Normal text |
| body-sm | 13px | 400 | Secondary text |
| label | 12px | 600 | Table headers, form labels |
| caption | 12px | 500 | Badge text, meta |
| mono | 13px | 500 | Room numbers, amounts, IDs |

Rules:
- Minimum text size: 12px
- Amount columns: right-aligned, tabular-nums, mono font
- No text below 12px anywhere
- Never bold for decoration — only for hierarchy

## Border Radius — Cal.com

- `sm`: 6px
- `md`: 8px — buttons, inputs
- `lg`: 12px — compact cards
- `xl`: 16px — page cards

## Shadows

Subtle, never heavy. Cal.com style.

- `sm`: `0 1px 2px rgba(0,0,0,0.04)`
- `card`: `0 1px 2px rgba(0,0,0,0.04), 0 4px 12px -6px rgba(0,0,0,0.06)`
- `panel`: `0 20px 48px -28px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.04)`

## Components

### Button
Cal.com pattern: black primary fills, white secondary, ghost for minimal.

- `default`: black `#111111` bg, white text, 8px radius, 40px height
- `secondary`: white bg, hairline border `#e5e7eb`, ink text
- `ghost`: transparent, ink-muted text, soft gray hover
- `destructive`: red bg, white text

### Card
White surface, 12px radius, hairline border, subtle shadow. Notion soft feel.

### Badge
Pill shape, 12px text. Pastel-tinted backgrounds (Notion tinted card approach).

### RoomCard
User's Soft Hotel Palette. 144×96px fixed size. Color-coded background. Room number pill, customer name, 3 round icon buttons. External legend.

### DataTable
Clean white container, hairline border. Cal.com table density — enough space to breathe, tight enough for data. Airtable structured columns.

### KPI Card
White card, top color strip (4px). Label above, large number below. From room-status palette or semantic colors.

## Layout

- Sidebar: Light (Notion warm white), collapsible. Active item: black pill badge.
- Header: Clean white, hairline bottom border.
- Content: Generous whitespace (Cal.com), not cramped.
- Page width: 1360px max, content fills available width.

## Anti-patterns

- No orange as primary or accent
- No dark sidebar
- No purple/pink decorative elements
- No giant description text at page top
- No candy-colored status badges
- No fake charts or mock data
- No nested cards
- No text below 12px
- No bold text used decoratively — only for hierarchy
