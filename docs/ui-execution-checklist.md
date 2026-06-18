# SACIS UI Execution Checklist

This checklist turns `DESIGN.md` into a strict implementation gate. Use it before and after every UI refactor. A page is not done until each relevant item passes visual review.

## Source Principle

- Foundational rules come from `DESIGN.md`: Cal.com, Airtable, Notion, Linear, Stripe/Vercel discipline.
- Concrete component behavior is adapted from 21st.dev component patterns.
- Protected SACIS colors remain unchanged: management room cards and daily rental calendar statuses.

## Component Families

| Area | Must Standardize | Main Reference | Pass Condition |
|---|---|---|---|
| Topbar | building selector, global search, notifications, language, user, logout | Cal.com, Linear | 32px controls, quiet account cluster, no item dominates page content |
| Sidebar | brand block, group labels, nav rows, active state, collapsed mode | Linear, Notion | one active style, 36-40px rows, no heavy section labels |
| Page header | title, description, primary action, page meta | Cal.com | compact height, title does not compete with KPI values |
| Buttons | primary, secondary, tertiary, icon, toolbar, danger | 21st.dev, Cal.com | one primary per toolbar, shared height/radius, secondary actions visually quieter |
| Inputs/selects | search, filters, date, textarea, numeric fields | 21st.dev, Airtable | 36px compact or 40px standard, same radius, clear focus state |
| Filters/chips | status filters, counts, reset, active state | Airtable, 21st.dev | count visible, active obvious but not CTA-heavy, wraps by group |
| Tabs/segmented controls | view modes, module tabs, record segments | 21st.dev, Linear | not styled like primary buttons, same button height within group |
| Cards | KPI, status, metric, record, chart, utility | Notion, Airtable | label/value hierarchy consistent, no truncated core business data |
| Tables | headers, cells, amounts, actions, selected rows, pagination | Airtable, Linear | 12px headers, 13px cells, right-aligned amounts, stable row height |
| Calendar/timeline | room labels, date headers, booking blocks, toolbar, legends | Cal.com, 21st.dev | timeline is visual focus, controls smaller than grid, status colors protected |
| Drawers/dialogs/sheets | header, body, footer, close, confirm/cancel | 21st.dev, Linear | fixed width tier, sticky footer for forms, close is 32px icon |
| Forms | labels, required, errors, helper text, grouped fields | 21st.dev | label 12px, field rhythm consistent, errors local and readable |
| Badges/status | dots, pills, alerts, risk states | Airtable, Linear | large color blocks only for approved room/calendar states |
| Data visualization | donut, line, bar, radar, progress, sparkline | 21st.dev, Stripe/Vercel | chart answers one question and is paired with source table when needed |
| Empty/loading/error | skeletons, empty states, recoverable errors | 21st.dev, Notion | calm state, one action max, skeleton matches final size |
| Pagination/bulk actions | page controls, selected rows, batch commands | Airtable | low emphasis until rows are selected |
| Command/AI surfaces | global AI, command dialog, OCR receipt flow | 21st.dev | command surface is available but not visually louder than work area |
| Icons/tooltips | icon sizes, icon-only labels, semantic actions | Linear | 14-16px icons in controls, icon-only has aria label or tooltip |
| Responsive | desktop, tablet, mobile, drawer-to-sheet | Cal.com, Airtable | controls wrap by group, tables scroll, calendar does not become unreadable |
| Bilingual text | Chinese/French label length, dates, currency | SACIS business rules | French labels fit, currency compact in cards and full in tables |
| Motion/focus/accessibility | hover, active, keyboard focus, contrast | Linear | subtle motion, visible focus, status not color-only |

## Typography Gate

Allowed levels:

- Page title: 22-24px, 650-700.
- Section title: 15-16px, 600-650.
- Subsection/card title: 14-15px, 600.
- Body text: 14px, 400-500.
- Table/body dense text: 13px, 500.
- Label/meta/caption: 12px, 400-600.
- Normal operational numbers: 16-18px, 600.
- Major dashboard KPI only: 20-24px, 600-700.

Hard failures:

- `font-black` in operational UI.
- Meaningful text below 12px.
- Money/date/room numbers using inconsistent numeric scale in the same region.
- Card value text visually louder than the primary work surface.

## Page-Level Gate

For every page, verify:

- The primary business surface is visually dominant.
- Header and toolbar area does not consume more attention than the work surface.
- Core data is not hidden by truncation unless a tooltip/drawer exposes it.
- Buttons in one row share one scale system.
- Cards in one row share one label/value hierarchy.
- The same semantic state uses the same component family across pages.
- Every added chart has a clear business decision purpose.

## Daily Rental Gate

The daily rental page must pass these extra checks:

- Calendar grid is the main visual focus.
- Overview toolbar is compact and secondary to the grid.
- Date, copy, print, and history controls are one coherent toolbar family.
- Status cards show all relevant room numbers for normal daily volumes.
- Finance cards are secondary summaries, not dominant KPI blocks.
- Day/week/month control is compact and does not fight the timeline.
- Date range control is readable but not oversized.
- Room labels remain scannable at dense row height.
- Booking colors remain the approved existing calendar colors.

