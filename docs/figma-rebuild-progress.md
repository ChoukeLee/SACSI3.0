# SACSI Figma Rebuild Progress

## Figma File

- File: SACSI 3.0 UI Rebuild
- URL: https://www.figma.com/design/c9jf61ND56VSs9tqUED1ms
- Workspace page: `SACSI Rebuild Workspace`

## 2026-07-29 Stage Review

### Completed

- Created a new Figma design file for the SACSI 3.0 UI rebuild.
- Built one-page workspace structure because creating additional Figma pages failed in the plugin environment.
- Added design foundations:
  - Color variables for canvas, surfaces, text, borders, finance states, and room states.
  - Text styles for page titles, section titles, body text, table text, buttons, captions, and numeric values.
  - Effect styles for cards, panels, and floating surfaces.
- Created 8 major frames:
  - `00 Cover / SACSI 3.0 UI Rebuild`
  - `01 Foundations / Tokens Overview`
  - `02 Components / Core Library`
  - `03 App Shell / Navigation System`
  - `04 Daily Rentals / Page Template`
  - `05 Contracts / Lease + Sale Templates`
  - `06 Finance + Records / Dense Data`
  - `07 Mobile / Responsive Patterns`
- Added first-pass component samples:
  - Buttons
  - KPI cards
  - Segmented controls
  - Finance table
  - Room card
  - Contract card
  - Right drawer
- Added first-pass page templates:
  - Daily rental calendar with KPI entry points, filters, booking bars, and detail drawer.
  - Lease and sale contract dashboard with shared KPI-to-drawer interaction.
  - Finance and audit dense-data table with room number, note, amount, status, and operator columns.
  - Mobile patterns for daily rentals, debt drawer, and contract lists.
- Added second-pass page templates:
  - Room overview and asset inventory, including 11# mixed rental/sale/daily states and 5# self-owned asset rules.
  - Customer archive grouped by building and business relationship type.

### Design Decisions

- Keep the product as an operations tool, not a marketing-style dashboard.
- Use KPI cards as entry points into business-specific side drawers.
- Keep dense data tables readable and complete instead of hiding critical finance fields.
- Keep daily rental states limited to 11# daily rental use cases.
- Put room number, customer, payment state, booking note, and operator in first-class visual positions because these have repeatedly caused business errors.
- Avoid large status banners for ordinary operations; use compact local feedback and drawer state instead.

### Known Limitations

- Figma page creation failed with `INVALID_ARGUMENT`, so the current file uses one page with multiple large frames.
- The Figma plugin currently exposes Inter reliably; Chinese text may render through fallback fonts in screenshots. A Chinese font pass should be done later inside Figma if the final visual typography needs refinement.
- Current Figma output is a design direction and template system. It has not yet been implemented in application code.
- During the second-pass expansion, the Figma connector began returning `INVALID_ARGUMENT` even for minimal read-only scripts. Because failed `use_figma` scripts are atomic, no broken partial dashboard or audit-log frames were created. The remaining dashboard and audit-log templates are documented below as implementation-ready blueprints.

## Next Phase

1. Reconnect Figma and add the two remaining visual frames:
   - Management cockpit
   - Audit log page
2. Review the Figma frames visually with the user.
3. Refine typography and Chinese font choices.
4. Turn the component samples into reusable Figma components and variants.
5. After design approval, migrate into code in this order:
   - Shared UI primitives
   - Drawer and table shell
   - Daily rentals
   - Lease contracts
   - Sale contracts
   - Finance and audit pages

## Remaining Visual Blueprints

### Management Cockpit

Purpose: give the owner or manager one screen for business health and risk triage.

Required structure:

1. Compact page header with date range and report export as secondary action.
2. KPI row:
   - 本月实收
   - 当前欠款
   - 房源占用
   - 待办事项
   - 数据质量
3. 回款结构 card:
   - Paid, unpaid, and overdue split.
   - One primary drill-down action into receivable details.
4. 收入趋势 card:
   - 7-14 day compact bar or line chart.
   - Keep chart secondary to the current business numbers.
5. 优先处理 card:
   - Cleaning, maintenance, overdue, and data-quality items.
   - Each row opens a focused drawer.
6. 楼栋健康度 card:
   - 11# / 5# / 7# comparison.
   - Normalized score with occupancy, collection, maintenance, and data quality.

Acceptance:

- The dashboard must answer "what needs attention now" in the first viewport.
- It must not become a decorative KPI-only page.
- The risk list must link to operational drawers, not isolated pages.

### Audit Log

Purpose: make financial and operational changes traceable.

Required structure:

1. Compact page header with search and export.
2. Filter bar:
   - 操作类型
   - 操作员
   - 楼栋
   - 房间
   - 日期范围
3. Dense table:
   - 时间
   - 操作员
   - 角色
   - 操作
   - 对象
   - 摘要
   - 变更前
   - 变更后
4. Detail drawer:
   - Full before/after payload.
   - Related room, customer, receivable, and finance record links.
5. Operator display rule:
   - Show human-readable user names whenever possible.
   - If historical entries only contain IDs, resolve them to known users or clearly label them as legacy IDs.

Acceptance:

- Financial actions must always show operator, amount, object, and timestamp.
- The table must remain readable at 20 rows per page.
- English system descriptions should be converted into Chinese business descriptions.
