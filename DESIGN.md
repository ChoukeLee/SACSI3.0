---
version: 4.1
name: SACIS-design-system
description: Complete product design rules for SACIS 3.0. Built from getdesign.md-style design rules and 21st.dev component patterns, adapted for a Chinese/French property operations system in Abidjan.
---

# SACIS 3.0 Design Rules

SACIS is a property operations system for management, finance, front desk, and administrative staff. It is used for long office sessions, daily rental operations, finance reconciliation, customer lookup, and asset monitoring.

The product must feel like one coherent system: calm, bright, data-dense, operational, and trustworthy. It should not feel like a marketing site or a set of unrelated component snippets.

## Reference Sources

### getdesign.md References

Use getdesign.md for foundational design rules: product tone, tokens, hierarchy, layout behavior, and anti-patterns.

- **Cal.com**: clean neutral UI, black primary actions, scheduling-oriented product structure.
- **Airtable**: structured data UI, filters, tables, field-like records, friendly but organized information density.
- **Notion**: warm minimal canvas, soft surfaces, comfortable long-session reading.
- **Linear**: precision, restrained hierarchy, clean active states. Use only as a minor reference for sharpness, not for dark/purple branding.
- **Stripe / Vercel**: component polish and product clarity. Use only for discipline, not for marketing-style hero composition.

### 21st.dev References

Use 21st.dev for concrete component patterns and code inspiration:

- Buttons
- Cards
- Tables
- Tabs
- Inputs
- Selects
- Forms
- Calendars
- Sidebars
- Dialogs / Drawers
- Alerts
- Empty states
- Pagination
- AI chat / command surfaces

Do not copy a 21st.dev component verbatim if it conflicts with SACIS density, bilingual text, or business workflows. Adapt the pattern into SACIS primitives.

## What We Imitate

### Cal.com

Imitate:

- Black primary actions.
- White cards on warm/neutral canvas.
- Simple 8-12px radius controls.
- Scheduling toolbar clarity.
- Low-decoration product UI.

Do not imitate:

- Excessive whitespace when SACIS needs dense data.
- Pure scheduling-only assumptions.

### Airtable

Imitate:

- Tables as primary business surfaces.
- Filter bars above records.
- Structured fields and status chips.
- Dense but readable rows.
- Friendly information organization.

Do not imitate:

- Too many playful colors.
- Spreadsheet complexity when a chart or dashboard is clearer.

### Notion

Imitate:

- Warm canvas.
- Calm reading experience.
- Soft section boundaries.
- Minimal decoration.

Do not imitate:

- Document-editor looseness.
- Serif-forward typography.
- Overly sparse content blocks.

### Linear

Imitate:

- Precise active states.
- Tight hierarchy.
- Crisp borders and motion.

Do not imitate:

- Dark-first UI.
- Purple product accent.
- Engineering-tool tone.

## Protected Existing Design

These areas are already approved and should not be restyled unless explicitly requested:

- Management / market room-status card color language in `src/components/room-card.tsx`.
- Daily rental calendar booking/status color language in `src/features/daily-rentals/calendar.tsx`.

These can be improved around the edges:

- Toolbars.
- Headers.
- View switchers.
- Filters.
- Detail panels.
- Data visualization around the existing calendar/cards.

### 5# Building Room Board

The 5# management room board must expose its mixed-use structure instead of presenting every unit as one undifferentiated residential matrix.

- Divide the board into `前楼 · 办公室` and `公寓住宅` sections.
- Treat the existing 1-9F front-building floor plates and any `office` unit as office inventory; do not create duplicate visual-only rooms.
- Keep 6F office partitions `601-603` as their real contract-bound units and label the floor `半层出租` when a lease is active.
- Show the 8F front-building office as `公司自购 · 自用`. Ownership is descriptive metadata; `自用` remains the operational status.
- Preserve the approved room-card colors. Section headings, floor annotations, ownership labels, and spatial grouping must not introduce new room-status colors.
- Keep rear-building apartments and residential floors in the apartment section, using the same floor ordering and existing room actions.

## Foundation Tokens

### Color

Core palette:

- `canvas`: `#f6f5f4` warm off-white page background.
- `surface`: `#ffffff` cards, tables, panels, sheets.
- `surface-muted`: `#f3f2f0` table headers, filter bars, inactive segmented containers.
- `surface-hover`: `#ecebe8` hover background.
- `ink`: `#181919` primary text and primary actions.
- `ink-muted`: `#5c5d61` secondary text.
- `ink-subtle`: `#8f8d89` placeholders and disabled copy.
- `border`: `#e5e3e0` default hairline.
- `border-strong`: `#d2cfca` active/selected border.

Semantic colors:

- Success: green. Paid, completed, on track.
- Warning: amber. Pending, partial, attention soon.
- Danger: red. Overdue, blacklist, destructive.
- Info/focus: blue. Links, focus rings, neutral information.

Rules:

- Black/ink is the only default primary action color.
- Blue is not the primary CTA color; it is focus/link/info.
- Red is not decoration; it means danger.
- Amber is not decoration; it means attention.
- Green is not decoration; it means success or completion.
- Purple is not part of the system palette unless a protected business status already uses it.
- Room-status colors are separate from general semantic colors.

### Typography

Font stack:

```css
"MiSans", "Microsoft YaHei", "PingFang SC", "Segoe UI", system-ui, -apple-system, sans-serif
```

Type scale:

| Token | Size | Weight | Line Height | Use |
|---|---:|---:|---:|---|
| `title.page` | 22-24px | 650-700 | 1.25 | Main page title |
| `title.section` | 16px | 600-650 | 1.3 | Section/card title |
| `title.subsection` | 14-15px | 600 | 1.35 | Small panel/table title |
| `body.default` | 14px | 400-500 | 1.5 | Normal text |
| `body.table` | 13px | 500 | 1.4 | Table cells |
| `label` | 12px | 600 | 1.3 | Table headers, form labels, KPI labels |
| `caption` | 12px | 400-500 | 1.4 | Helper text, dates, meta |
| `button` | 13-14px | 600 | 1 | Buttons and segmented controls |
| `numeric.sm` | 13px | 500-600 | 1.3 | Table amounts, counts |
| `numeric.lg` | 18-24px | 600-700 | 1.1 | KPI values |

Rules:

- No meaningful text below 12px.
- Avoid `font-black`.
- Avoid negative letter spacing.
- Use `tabular-nums` for money, counts, dates, room numbers, percentages.
- Chinese labels should not use heavy uppercase/tracking habits copied from English UI.
- Same hierarchy equals same visual treatment across pages.
- Page title should not compete with KPI values.

### Spacing

Base unit: 4px.

Spacing tokens:

- `space.1`: 4px
- `space.2`: 8px
- `space.3`: 12px
- `space.4`: 16px
- `space.5`: 20px
- `space.6`: 24px
- `space.8`: 32px

Rules:

- Page major sections: 24px.
- Related blocks inside a section: 12-16px.
- Toolbar controls: 8px.
- Card padding: 16px compact, 20px standard.
- Table cell padding: 10-12px vertical, 12-16px horizontal.
- Drawer content spacing: 16px groups, 12px fields.
- Avoid arbitrary padding like `p-3.5` unless it is standardized into a component.

### Radius

Radius tokens:

- `radius.control`: 8px for buttons, inputs, select.
- `radius.card`: 12px for cards, tables, panels.
- `radius.compact`: 8px for dense record cards.
- `radius.sheet`: 12-16px for mobile bottom sheets only.
- `radius.pill`: 999px for badges/chips.

Rules:

- A normal toolbar button and input should share radius.
- Do not mix `rounded-md`, `rounded-lg`, `rounded-xl`, and `rounded-2xl` in one toolbar.
- Large soft radius belongs to mobile sheets or specific repeated cards, not every control.

### Border

Border tokens:

- Default: 1px solid `border`.
- Strong: 1px solid `border-strong`.
- Active: 1px solid ink or component-specific active border.
- Table dividers: 1px `border` at reduced visual emphasis.
- Danger/warning/success borders use semantic tints.

Rules:

- Operational UI should rely more on border and layout than heavy shadows.
- Inputs and cards should not have identical hover states if they behave differently.
- Selected state must be visible through color, border, or filled surface.

### Elevation

Elevation tokens:

- `flat`: no shadow.
- `card`: subtle shadow for cards and table shells.
- `raised`: hover/active card lift.
- `dropdown`: menus, popovers.
- `panel`: drawer and modal.

Rules:

- No `shadow-2xl` inside ordinary app content.
- Drawer and dialog may use stronger panel shadow.
- Hover lift should be subtle and consistent.
- Avoid decorative glassmorphism. Backdrop blur is allowed for overlays only.

### Motion

Motion tokens:

- Fast: 120ms.
- Normal: 180-220ms.
- Slow: 300ms for overlays only.

Rules:

- Buttons may use color and slight active scale.
- Cards may use subtle hover lift if clickable.
- Tables use row background hover only.
- Drawers/sheets should animate consistently.
- No decorative motion for dashboards.

### Iconography

Use Lucide icons by default.

Rules:

- Default icon size: 16px.
- Small icon size: 14px.
- KPI icon: 18-20px.
- Stroke width: 1.75-2.
- Icon + text gap: 8px.
- Icon-only button must have `aria-label` or tooltip.
- Do not use letters as icon substitutes when a clear icon exists.

## Layout & Scale Rules

This section defines the missing proportional system. It exists because visual unity is not only color, radius, and shadow. SACIS needs predictable scale, density, hierarchy, and page templates so every screen feels designed by the same team.

Use these rules before choosing individual component styles.

### Imitation Objects For Scale

Use these references as proportional models:

- **Cal.com** for scheduling toolbars, black primary commands, compact navigation controls, and clear date controls.
- **Airtable** for dense data tables, filters above records, compact chips, and field-like information layout.
- **Notion** for warm surface spacing, quiet containers, and long-session readability.
- **Linear** for precise active states, controlled hierarchy, low-noise borders, and disciplined motion.
- **21st.dev** for concrete component execution: button groups, command bars, cards, tables, sidebars, drawers, tabs, calendars, and empty states.

Adapt these references to SACIS. Do not copy marketing scale, excessive whitespace, decorative gradients, or purely aesthetic component snippets.

### Component Scale System

Component size is a hierarchy tool. Controls in the same row should not all look equally important.

Button and control scale:

| Token | Height | Padding | Text | Icon | Use |
|---|---:|---:|---|---:|---|
| `command.primary` | 40px | 16-18px | 13-14px / 600 | 16px | Main business action |
| `command.secondary` | 36px | 12-14px | 13px / 600 | 15-16px | Print, export, backfill, secondary action |
| `command.tertiary` | 32px | 8-10px | 12-13px / 600 | 14-16px | Low emphasis command |
| `control.icon.sm` | 32px square | 0 | none | 16px | Topbar/account icon |
| `control.icon.md` | 36px square | 0 | none | 16px | Toolbar navigation icon |
| `control.meta` | 36px | 12-14px | 13px / 600 | optional 16px | Date, range, current user, read-only meta |
| `control.segmented` | 36px | 12-16px | 13px / 600 | optional 14px | View mode, tabs, filter modes |
| `input.standard` | 40px | 12px | 14px / 400-500 | optional 16px | Forms |
| `input.compact` | 36px | 12px | 13px | optional 16px | Filter bars and dense tables |

Rules:

- One toolbar should have one `command.primary` by default.
- Secondary actions must not visually compete with the primary command.
- Date/range/user controls are `control.meta`; they should read as stable information, not as primary commands.
- Topbar controls use 32px height; page toolbars use 36-40px.
- Avoid mixing 28px, 32px, 36px, and 40px controls in one group unless the scale token explains why.
- Icon-only controls must use a fixed square size.
- A toolbar group must share one outer surface, one radius rhythm, and one spacing rhythm.

### Page Density System

Density is chosen by workflow, not by taste.

| Page Type | Density | Primary Goal | Rules |
|---|---|---|---|
| Dashboard / cockpit | Medium | Scan metrics and risks | More breathing room around chart/KPI groups |
| Calendar operations | Dense | Fast room/date decisions | Compact controls, clear status blocks, sticky labels |
| Finance / reconciliation | Dense | Compare rows and amounts | Tight tables, right-aligned numbers, compact filters |
| Customer / record management | Medium-dense | Find and edit records | Search-first, card/list hybrid, details in drawer |
| Sales / lease operations | Medium-dense | Track contracts and actions | Record cards plus structured payment tables |
| Settings / tools | Dense | Repeated admin tasks | Low decoration, compact forms, clear danger zones |
| Reports | Medium | Interpret trends | Larger charts, fewer controls, stronger narrative order |

Rules:

- Do not use dashboard-scale whitespace in finance tables.
- Do not use table density inside form drawers.
- Daily rental calendar can be dense, but its toolbar must remain readable.
- Settings pages should feel utilitarian, not like marketing cards.

### Information Hierarchy Ratios

Hierarchy must be visible through size, weight, spacing, and placement.

Ratios:

- KPI value should be 1.5-2x the size of its label.
- Page title should be larger than section title, but smaller than major KPI values.
- Section title should be 14-16px, not hero-sized.
- Table body should be 13px, table header 12px.
- Captions and helper text are 12px minimum.
- A card should not contain more than one visually dominant number unless it is a comparison card.

Rules:

- Same semantic level means same visual treatment across pages.
- Page descriptions should clarify context, not repeat visible controls.
- Avoid uppercase/tracking-heavy labels for Chinese UI.
- Use `tabular-nums` for money, dates, room numbers, counts, percentages, and occupancy rates.
- Long labels must wrap or truncate predictably; they must not stretch buttons.

### Container Proportions

Containers define the rhythm of the product.

Global dimensions:

- Desktop page padding: 24-32px.
- Tablet page padding: 20-24px.
- Mobile page padding: 16px.
- Major section gap: 24px.
- Related group gap: 12-16px.
- Toolbar vertical padding: 8-12px.
- Standard card padding: 16-20px.
- Dense card padding: 12-16px.
- Table row height: 44-52px.
- Table header height: 40-44px.
- Drawer header height: 56-64px.
- Drawer footer action bar height: 64-72px.
- Topbar height: 52-56px.
- Sidebar item height: 36-40px.

Rules:

- A toolbar should be visually shorter than a KPI card.
- A KPI row should not be taller than the chart cards below it unless it is the main dashboard.
- Filter bars should not look like page headers.
- Drawer content should be narrower and calmer than full-page content.
- Calendar row height must prioritize scanning; do not let booking text increase row height.

### Grid System

Use predictable layout templates.

Desktop grid:

- KPI rows: 4 columns by default, 5 columns only for compact metrics.
- Chart rows: 2 columns by default.
- Main table: full width.
- Detail + list layouts: list 55-65%, detail 35-45%.
- Drawer width: 420px compact, 480px standard, 560px complex.
- Wide analytical drawer: 720-960px only for tables or multi-section finance details.

Responsive grid:

- KPI cards collapse from 4 -> 2 -> 1 columns.
- Chart cards collapse from 2 -> 1 columns.
- Toolbars wrap by group, not by individual buttons whenever possible.
- Tables can scroll horizontally; do not crush columns into unreadable widths.
- Calendar desktop uses timeline/grid; mobile may use cards or simplified day list.

Rules:

- Do not invent new grid ratios per page.
- Avoid nested cards inside cards.
- A full-width table should not be placed inside a decorative card if the table shell already has a border.
- Keep filter bars directly above the data they control.

### Action Hierarchy

Every region must define command priority.

Priority levels:

1. **Primary command**: the main thing the user is expected to do now.
2. **Secondary command**: useful but not central.
3. **Navigation control**: previous/next, today, view mode.
4. **Meta control**: date, current range, user, count.
5. **Danger command**: destructive or irreversible action.

Rules:

- One toolbar should normally have one primary command.
- Danger commands must be visually separated from ordinary secondary commands.
- Print, export, and copy are operational tools; only copy becomes primary when it is the main workflow output.
- Date navigation is not a business command.
- Batch actions should be grouped behind a bulk action surface when there are more than two.
- Icon-only actions need tooltips or accessible labels.
- Confirmation actions in dialogs should be right aligned; cancel should be lower emphasis.

### Status Color Weight

SACIS uses many business states. Color weight must be controlled.

Color weight levels:

| Weight | Form | Use |
|---|---|---|
| `status.block` | Large colored block | Room/calendar booking states only |
| `status.badge` | Tinted pill | Contract, payment, customer, workflow states |
| `status.dot` | Small dot | Filters, legends, compact summaries |
| `status.text` | Colored text only | Money direction, minor risk hint |
| `status.alert` | Tinted alert surface | Requires action soon |

Rules:

- Room-status colors are allowed as large blocks only in room cards and daily calendar cells.
- Finance semantic colors should not be confused with room-status colors.
- Red large surfaces are only for serious risk, blacklist, overdue, destructive confirmation, or blocking error.
- A page should not show more than 4 high-saturation status colors in the same visual region.
- Legends should use dots, not large chips.
- If color communicates state, text or icon must also communicate the state.

### Data Visualization Proportions

Charts need their own scale rules.

Chart dimensions:

- Small donut: 112-132px.
- Standard donut: 140-160px.
- Dashboard donut: 180px max.
- Sparkline: 56-72px high.
- Standard line chart: 112-160px high.
- Report line chart: 220-280px high.
- Radar chart: 160-200px.
- Bar chart row height: 28-36px.
- Chart card minimum height: 180px compact, 240px standard.

Rules:

- A chart card must include title, optional description, primary metric, chart body, and legend.
- Donut center values should be short: percent, count, or compact money.
- Legends should be right side or below chart depending on available width.
- A chart should answer one question, not decorate the page.
- If the table is the source of truth, the chart summarizes before the table.
- Do not use chart colors that conflict with protected room-status colors unless the chart is explicitly about rooms.

### Table Visual System

Tables are SACIS's core work surface.

Dimensions:

- Header height: 40-44px.
- Row height: 44-52px.
- Compact row height: 40-44px.
- Cell horizontal padding: 12-16px.
- Amount columns: right aligned.
- Status columns: center or left depending on density.
- Action column: fixed width 40-56px.
- Empty table state: 160px minimum height.
- Pagination height: 44-52px.

Rules:

- Use `BusinessTable` or a successor `DataTable`; avoid raw table styling in feature files.
- Table headers should be readable Chinese/French labels, not uppercase English styling.
- Money, dates, and counts use `tabular-nums`.
- Row hover should be subtle and consistent.
- Selected row should be visible through border/background, not color alone.
- Risk rows can have a tinted background, but keep text readable.
- Long text should truncate with a tooltip or open details in a drawer.

### Drawer And Panel System

Drawers are the standard place for details and forms.

Drawer sizes:

- `drawer.compact`: 420px. Simple edit form.
- `drawer.standard`: 480px. Record detail plus actions.
- `drawer.wide`: 560px. Multi-section form.
- `drawer.table`: 720-960px. Finance details or large related table.
- Mobile drawer: bottom sheet with 88-92vh max height.

Rules:

- Header is sticky and contains title, status, close.
- Body uses 16px section gaps and 12px field gaps.
- Footer is sticky for primary/cancel actions when the form is long.
- Destructive actions are separated from save/confirm actions.
- Close buttons are icon-only and 32px.
- Drawer text should not use page-title scale.
- Detail `dl` blocks should use consistent label/value rhythm.

### Form System

Forms must feel predictable across modules.

Field dimensions:

- Standard input: 40px high.
- Compact filter input: 36px high.
- Textarea: 80-120px depending on expected content.
- Label: 12px / 600.
- Helper/error text: 12px.
- Field gap: 12px.
- Form group gap: 16px.

Rules:

- Required fields use a subtle marker, not loud red labels.
- Errors sit directly under the field they explain when possible.
- Form-level errors sit above the action row.
- Selects, date inputs, and text inputs share height and radius.
- Checkbox rows use 16px checkbox size and 14px text.
- Numeric fields should show units or formatted preview when money is involved.

### Empty Loading Error Weight

State screens must be consistent and low-noise.

Rules:

- Empty state icon: 32-40px.
- Empty state title: 14-15px / 600.
- Empty state description: 13px muted.
- Empty state action: one primary or secondary button.
- Loading skeleton should match the size of the real component.
- Error state uses red sparingly; recoverable errors should not dominate the page.
- Permission states should be calm and explicit.

### Bilingual Text Rules

Chinese and French must both fit.

Rules:

- Buttons must allow French labels to be 30-50% longer than Chinese labels.
- Use `whitespace-nowrap` only when the label is known to fit.
- Long labels in cards and tables should truncate with accessible title or detail drawer.
- Avoid fixed tiny widths for controls containing French text.
- Date formats should be locale-specific but layout-stable.
- Currency should stay compact: XOF values may use short formatting in cards and full formatting in tables.

### Responsive Behavior

SACIS is desktop-first but mobile must remain usable.

Rules:

- Desktop is the primary operational surface.
- Tablet should preserve most desktop controls but allow wrapping.
- Mobile should reduce side-by-side complexity, not shrink everything.
- Topbar search can collapse or hide on mobile.
- Toolbars wrap in groups: meta group, primary command, secondary tools.
- Tables scroll horizontally on mobile.
- Calendar should use a simplified mobile view instead of forcing tiny timeline cells.
- Drawers become bottom sheets on mobile.

### Interaction Motion

Motion should clarify, not entertain.

Rules:

- Button active scale may be `0.98`, but not every control needs it.
- Hover lift is allowed for clickable cards, not for normal table rows.
- Toolbars should use color/background changes instead of vertical movement.
- Drawers/dialogs animate quickly: 160-220ms.
- Tab/filter changes should feel immediate.
- Loading bar is allowed for route transitions.
- Avoid decorative or idle animation in operational pages.

### Accessibility Proportions

Usability rules are part of the design system.

Rules:

- Focus ring must be visible on keyboard navigation.
- Icon-only buttons require `aria-label`.
- Minimum click target: 32px topbar, 36px toolbar, 40px primary command.
- Do not communicate status by color alone.
- Dialogs/drawers must have a clear close control.
- Tables with row click should also expose a visible action.
- Text contrast must remain readable on tinted status backgrounds.

### Page Templates

Every major screen should map to one template.

#### Dashboard Template

Use for management cockpit and high-level summaries.

Structure:

1. Page header.
2. KPI row.
3. Chart/risk row.
4. Operational sections.
5. Detail drawers for drill-down.

Imitate: Cal.com for header/toolbars, Linear for hierarchy, Airtable for data sections.

#### Calendar Operations Template

Use for daily rentals.

Structure:

1. Overview toolbar with date meta and primary action.
2. Status summary cards.
3. Finance summary or operational alerts.
4. Calendar toolbar with filters, view mode, date navigation.
5. Timeline grid.
6. Booking drawer.

Imitate: Cal.com scheduling controls, 21st.dev calendar/toolbars, Airtable filter chips.

#### Data Table Template

Use for finance, receivables, audit logs, imports, documents, and settings tables.

Structure:

1. Page header.
2. KPI or summary row when useful.
3. Optional chart summary.
4. Filter bar.
5. Data table.
6. Pagination and detail drawer.

Imitate: Airtable tables/filters, Linear precision, 21st.dev table patterns.

#### Record Management Template

Use for customers, units, leases, sales.

Structure:

1. Page header with primary create action.
2. Segment/filter/search bar.
3. KPI or segment summary.
4. Card/list/table hybrid.
5. Detail drawer with actions.

Imitate: Airtable records, Notion calm surfaces, 21st.dev cards/drawers.

#### Finance Reconciliation Template

Use for finance and payments.

Structure:

1. Page header.
2. Money KPI row.
3. Trend/structure chart.
4. Dense filter bar.
5. Ledger/receivable table.
6. Export/add actions grouped in toolbar.

Imitate: Airtable density, Linear hierarchy, Cal.com primary command discipline.

#### Settings Tool Template

Use for settings, data quality, bulk actions, security, import/export.

Structure:

1. Compact page header.
2. Task cards or utility sections.
3. Dense forms/tables.
4. Clear danger zones.

Imitate: Linear settings precision, Airtable utility density, Notion calm surfaces.

#### Report Analytics Template

Use for reports.

Structure:

1. Page header.
2. Time range and filter controls.
3. 2-column chart grid.
4. Supporting tables.
5. Export/print tools as secondary commands.

Imitate: Stripe/Vercel analytical clarity, Airtable data grounding, 21st.dev chart cards.

## Density System

SACIS needs three density modes:

### Comfortable

Use for:

- Forms.
- Detail panels.
- Customer profile.
- Settings.

Traits:

- 14px body.
- 40px controls.
- 16-20px card padding.

### Compact

Use for:

- Finance lists.
- Unit lists.
- Customer lists.
- Business dashboards.

Traits:

- 13-14px text.
- 36-40px controls.
- 12-16px padding.

### Dense

Use for:

- Daily rental calendar.
- Room matrix.
- Ledger tables.

Traits:

- 12-13px labels and table text.
- Fixed row heights.
- High information density.
- Strong hover/focus affordance.

Dense does not mean unreadable. It means disciplined.

## Core Component Rules

### Button System

Variants:

- `primary`: black/ink fill, white text. One main action per section.
- `secondary`: white surface, border, ink text.
- `ghost`: transparent, muted text, subtle hover.
- `danger`: red fill or red outline for destructive actions.
- `warning`: amber outline/fill only for attention workflows.
- `icon`: square 36-40px icon button.
- `toolbar`: compact button inside toolbars.
- `segmented`: active/inactive group selection.

Rules:

- Same toolbar must not mix unrelated button heights/radius/shadows.
- Primary button should not be used for navigation tabs.
- Secondary and outline should not both exist if they look identical.
- Destructive buttons require clear label and usually confirmation.

### Input / Select / Textarea

Rules:

- 36-40px height.
- 8px radius.
- White surface.
- Hairline border.
- Clear focus ring.
- Placeholder muted.
- Search uses leading icon.
- Select should look like input, not browser default.
- Textarea follows same border/radius/focus.

### Filter Bar

Filter bars are a core SACIS component.

Contains:

- Search.
- Date range.
- Building selector.
- Status chips.
- Type selector.
- Result count.
- Reset action when filters are active.

Rules:

- Filters sit in a single white panel or muted segmented shell.
- Counts use tabular numbers.
- Active filters are visually obvious.
- No fake or disabled filters shown as normal controls.

### Card System

Card types:

- `KpiCard`: number, label, optional trend, optional mini chart.
- `ChartCard`: title, metric, chart, small supporting caption.
- `RiskCard`: attention item with severity and action.
- `RecordCard`: customer/unit/contract summary.
- `ActionCard`: clear action with icon and label.
- `StatusCard`: protected room-status color cards.

Rules:

- Cards represent one unit of meaning.
- Avoid nested cards.
- Use repeated cards for repeated records.
- Use charts when comparing ratios/trends; do not force everything into cards.

### Table System

Table types:

- `BusinessTable`: default records.
- `FinanceTable`: right-aligned amounts, stronger numeric hierarchy.
- `SelectableTable`: checkbox column, batch toolbar.
- `GroupedTable`: section headers for grouped records.
- `CompactTable`: dense rows for panels.

Rules:

- Table shell has white surface, border, radius, optional shadow.
- Header uses muted surface.
- Header text: 12px, 600.
- Body text: 13px.
- Standard row height: 44-48px.
- Dense row height: 36-40px.
- Amounts right-aligned.
- Action column uses icon button or single text action.
- Rows should support hover.
- Empty state belongs inside the table shell.

### Tabs / Segmented Controls

Rules:

- Use segmented controls for switching views within the same page.
- Active state: filled ink or white elevated pill, depending on background.
- Tab height: 36-40px.
- Label: 13px, 600.
- Count badge optional.
- Do not make tabs look like primary CTAs.

### Badge / Status Pill

Rules:

- Badge text: 12px, 600.
- Pill radius.
- Semantic badges use matching bg/border/text.
- Protected room-status badges follow existing room/status palette.
- Badge should not be the only status signal when risk is high.

### Drawer / Dialog / Sheet

Rules:

- Desktop detail/edit flows prefer right drawer.
- Mobile detail/edit flows prefer bottom sheet.
- Overlay scrim: black 20-30%.
- Drawer width: 420-520px for forms, wider for finance details.
- Header is sticky with title and close button.
- Footer actions are sticky if the form is long.
- Close button is icon-only with aria-label.

### Calendar / Timeline

Protected:

- Existing daily rental booking/status colors.

Rules:

- Calendar toolbar uses same button system.
- View switcher is segmented.
- Date range navigation is compact and centered.
- Empty cells must show click affordance.
- Booking bars must remain readable at dense sizes.
- Calendar should have status legend and active filter count.

### Sidebar / Navigation

Rules:

- Light sidebar by default.
- Active item uses black/ink filled pill.
- Group labels are subtle but readable.
- Icon size 16px.
- Collapsed mode keeps active state clear.
- Mobile uses bottom nav, but deep pages need a secondary access pattern.

### Topbar

Rules:

- Topbar is utility chrome, not a marketing header.
- Topbar and the route surface meet directly. Keep one bottom border only; do not insert a full-width background gutter, margin, padding, or shadow band between them. Full-height drawers and overlays must use the shared measured topbar offset, never a hardcoded `top` value.
- Language, user, notification, logout should use same icon/utility button family.
- Do not mix pill styles in the same topbar.

## Data Visualization Rules

SACIS currently overuses raw data display. Add visualization when it improves judgment.

### Chart Types

#### Donut / Ring

Use for:

- Occupancy rate.
- Collection rate.
- Room-status distribution.
- Receivable paid vs unpaid.

Rules:

- 2-5 segments.
- Center label must state the main number.
- Legend uses labels and counts/percentages.

#### Line Chart

Use for:

- Monthly revenue trend.
- Daily rental occupancy trend.
- Outstanding balance over time.
- Collection rate over months.

Rules:

- Use for time series only.
- Show current period and comparison period when useful.
- Avoid too many lines.

#### Bar Chart

Use for:

- Building comparison.
- Business type revenue.
- Monthly income/expense.
- Customer segment counts.

Rules:

- Sort bars by business priority or value.
- Label values directly when space allows.

#### Radar Chart

Use sparingly for:

- Building health score.
- Multi-factor operational comparison.

Potential axes:

- Occupancy.
- Collection rate.
- Low overdue rate.
- Low maintenance rate.
- Revenue progress.
- Data quality.

Rules:

- Radar chart needs normalized 0-100 values.
- Use no more than 5-6 axes.
- Must have explanation tooltip or legend.

#### Progress / Goal

Use for:

- Monthly revenue target.
- Occupancy target.
- Contract payment progress.

Rules:

- Always show actual and target.
- Avoid fake progress without a target.

#### Sparkline

Use inside KPI cards for:

- Revenue mini trend.
- Occupancy mini trend.
- Receivable mini trend.

Rules:

- Decorative only if the main number remains readable.
- Use consistent time window.

### Chart Card Structure

Each chart card has:

1. Title.
2. Primary metric.
3. Chart.
4. Context line or trend badge.
5. Optional drill-down action.

Charts should not replace tables when exact reconciliation is needed. Use chart for overview, table for detail.

## Page Rules

### Management Dashboard

Goal: owner/manager scans business health.

Structure:

1. Executive summary: revenue, collection, occupancy, risk count.
2. Visualization row: collection donut, revenue trend, room-status distribution.
3. Risk strip: overdue, expiring contracts, maintenance, cleaning.
4. Building selector/status filters.
5. Protected room cards grouped by building/floor.
6. Drill-down panels.

Do not:

- Start with raw tables.
- Hide risks below room matrix.
- Duplicate the same number in five places.

### Finance

Goal: reconcile receivables and payments.

Structure:

1. KPI + trend row.
2. Receivable donut/progress.
3. Cashflow line/bar chart.
4. Segmented tabs: ledger / receivables / receipts.
5. Dense tables with search/filter/export.
6. Receipt drawer and payment confirmation flow.

Do not:

- Show finance as only rows.
- Use charts without drill-down table.

### Units

Goal: understand asset inventory and room status.

Structure:

1. Asset summary.
2. Status distribution donut/bar.
3. Filters: building/floor/status/business.
4. Table or record grid.
5. Unit detail drawer.

Protected:

- Existing room status colors.

### Customers

Goal: find customers and understand business relationship.

Structure:

1. Segment summary.
2. Customer distribution chart.
3. Search/filter toolbar.
4. Grouped customer records.
5. Customer detail drawer/profile.

Important:

- Blacklist must be visually strong and consistent.
- Stable customers should be easy to identify.

### Daily Rentals

Goal: operate today's and upcoming stays.

Structure:

1. Today summary.
2. Share/print/backfill toolbar.
3. Daily rental finance mini cards.
4. Calendar timeline with protected colors.
5. Booking panel.
6. Optional occupancy trend or checkout/cleaning chart above calendar.

Do not:

- Change approved calendar status colors.
- Let toolbar buttons use inconsistent styles.

### Leases / Sales

Goal: manage contracts and payment progress.

Structure:

1. Contract status summary.
2. Payment progress visualization.
3. Filters/tabs.
4. Contract list/table.
5. Detail drawer with payment schedule.

### Reports

Goal: visualization-first business reporting.

Structure:

1. Date range and report type.
2. Chart grid.
3. Export actions.
4. Supporting detail tables.

### Settings / Data Quality / Bulk Actions

Goal: safe administration.

Rules:

- Risky actions use warning/danger surfaces.
- Batch actions require preview and confirmation.
- Data quality uses severity, count, and fix actions.

## State Rules

### Empty State

Must include:

- Clear title.
- Short reason or next step.
- Optional action.

Do not show only blank panels.

### Loading State

Use:

- Skeleton for cards/tables.
- Loading text only when skeleton is not appropriate.

### Error State

Must include:

- What failed.
- Whether retry is possible.
- Support/debug hint if needed.

### Disabled State

Rules:

- Disabled controls need a visible reason if not obvious.
- Do not show future features as disabled primary UI.

## Accessibility Rules

- All icon buttons need accessible labels or tooltips.
- Touch targets: 40px minimum on touch devices.
- Meaningful text: 12px minimum.
- Do not communicate status by color alone.
- Focus states must be visible.
- Dialogs/drawers need clear close behavior.
- Tables need readable headers and row focus/hover.

## Responsive Rules

### Mobile

- Bottom nav remains primary.
- Tables convert to cards unless exact comparison is required.
- Drawers become bottom sheets.
- Toolbars wrap into two rows.
- Calendar keeps dense operational mode but controls simplify.

### Tablet

- Sidebar may collapse.
- Two-column card grids.
- Tables can scroll horizontally.

### Desktop

- Sidebar expanded.
- Dashboard grids.
- Dense tables.
- Right drawers for detail/edit.

## Implementation Rules

Before editing UI, use `docs/ui-execution-checklist.md` as the execution gate. `DESIGN.md` defines the product rules; the checklist defines whether a page or component actually passed those rules in code and screenshot review.

### No Raw UI Drift

Avoid hand-written one-off styles for:

- Buttons.
- Inputs.
- Selects.
- Tables.
- Tabs.
- Cards.
- Drawers.
- Badges.

If a page needs a variant, add it to the shared component family.

### Migration Order

1. Foundation tokens: color, type, spacing, radius, border, elevation.
2. Typography utilities.
3. Button system.
4. Form controls.
5. Filter/toolbar system.
6. Card system.
7. Table system.
8. Drawer/dialog system.
9. Chart components.
10. Page refactors.

### Review Checklist

Before accepting a UI change:

- Does it use the shared component family?
- Does typography match the type scale?
- Are button sizes/radius consistent in the same toolbar?
- Are semantic colors used only for meaning?
- Are protected room/calendar colors untouched?
- Is data visualized when it helps judgment?
- Does the page work in Chinese and French?
- Does it avoid horizontal overflow?
- Does build/typecheck pass?

## Anti-Patterns

- Eight buttons in one screen with eight visual languages.
- Raw tables without filter/search/pagination where data can grow.
- KPI-only dashboards with no trends or ratios.
- Charts with no business question.
- Decorative gradients or orbs.
- Dark sidebar as default.
- Purple/indigo primary brand system.
- Text below 12px for meaningful information.
- Unexplained disabled buttons.
- Cards inside cards for page layout.
- Marketing hero sections in the app.
- Data dumped without visual hierarchy.
