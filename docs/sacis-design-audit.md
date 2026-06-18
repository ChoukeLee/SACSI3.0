# SACIS Design Audit

This file is the execution map for the SACIS UI redesign. Each design area must be tied to a concrete reference before implementation.

## Reference Method

- Use 21st.dev registry source when available.
- Use getdesign.md-style references for product principles: Cal.com, Airtable, Notion, Linear, Stripe/Vercel.
- Adapt references into SACIS tokens and business workflows.
- Protect approved lower daily-rental calendar status colors and approved room-card colors.

## Current Reference Objects

| Design Area | 21st / getdesign Reference | Source | SACIS Rule |
|---|---|---|---|
| KPI / metric cards | Data Card Display | `https://21st.dev/r/uniquesonu/data-card-display` | Header title + 16px icon/status, 24px numeric value, 12px muted description, white card, subtle border/shadow. |
| Buttons | Origin UI Button | `https://21st.dev/r/originui/button` | One button scale, 36px default height, medium weight, black primary, outline/secondary quieter. |
| Tables | Basic Data Table, shadcn table | `https://21st.dev/r/preetsuthar17/basic-data-table`, `https://21st.dev/r/shadcn/table` | Card-shell table, 12px headers, 13px body, stable row height, hover state, right-aligned money. |
| Filters | Data Table Filter | `https://21st.dev/r/uniquesonu/data-table-filter` | Filter groups use compact buttons/chips with label + count; active is obvious but not CTA-heavy. |
| Tabs / segmented controls | Animated Tabs category, Linear precision | `https://21st.dev/community/components/s/tabs` | Tabs are navigation controls, not primary CTAs; compact height, one active state. |
| Dialog / drawer / sheet | Responsive Modal | `https://21st.dev/r/sshahaider/modal` | Desktop dialog/drawer and mobile sheet share one header/body/footer language. |
| Forms | 21st form category + shadcn inputs | `https://21st.dev/community/components/s/form` | 12px labels, 36-40px controls, local helper/error text, grouped rhythm. |
| Topbar / sidebar | Cal.com + Linear | `DESIGN.md` | Quiet topbar, compact account cluster, one active sidebar style. |
| Calendar / timeline | Cal.com + 21st calendar category | `DESIGN.md`, `https://21st.dev/community/components/s/calendar` | Timeline is primary surface; controls remain smaller than grid; approved status colors remain. |
| Data visualization | 21st dashboard/metrics + Stripe discipline | `https://21st.dev/community/components/s/dashboard`, `https://21st.dev/community/components/s/metrics` | Every chart answers one business question and pairs with table/detail access. |
| Empty/loading/error | 21st empty/loading patterns + Notion calm surfaces | `DESIGN.md` | Calm dashed/soft state, one action max, skeleton matches final geometry. |
| Typography scale | getdesign rules | `DESIGN.md` | 14px card titles, 24px major KPI only, 13px table body, 12px labels/captions. |
| Spacing/proportion | Cal.com + Airtable | `DESIGN.md` | 4px base scale, card padding 16px, toolbar 8px gaps, primary work area visually dominant. |
| Bilingual layout | SACIS business rule | `DESIGN.md` | Chinese/French labels must fit; currency compact in cards and full in tables. |

## Execution Order

1. Card/KPI system.
2. Buttons and toolbar controls.
3. Tables and table shells.
4. Filters, chips, tabs, segmented controls.
5. Inputs, forms, validation states.
6. Dialogs, side drawers, detail panels.
7. Topbar/sidebar/page header hierarchy.
8. Data visualization cards and chart grammar.
9. Calendar/timeline hierarchy.
10. Empty/loading/error states.
11. Responsive and bilingual pass.

## Audit Gate

Before a design area is considered done:

- A concrete reference object is named.
- Shared components are updated before page-level overrides.
- Old local style patterns are scanned with `rg`.
- `npm run typecheck` passes.
- `npm run build` passes.
- Main affected routes return HTTP 200.
