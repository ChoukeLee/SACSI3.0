# SACIS Legacy UI Replacement Index

This index lists the current frontend patterns that should be replaced during the redesign. It is not a deletion list. Use it to decide where to migrate visual code into shared primitives.

## Main Legacy Patterns

### PageHeader Blocks

Current usage:

- `src/app/bulk-actions/page.tsx`
- `src/app/data-quality/page.tsx`
- `src/app/data-exchange/page.tsx`
- `src/app/management/targets/page.tsx`
- `src/app/reports/page.tsx`
- `src/app/settings/**/page.tsx`
- many `/fr/**/page.tsx` equivalents

Decision:

- Replace with a compact `SectionHeader` only where the title helps orientation.
- Remove large explanatory descriptions from mature business pages.
- Keep descriptions only for admin/maintenance pages where the purpose is not obvious.

### Inline Card Styling

Common patterns:

- `rounded-2xl border ... bg-white ... shadow-natural`
- one-off metric tiles with local color classes
- repeated `brand-warm`, `brand-ink`, `brand-indigo` combinations

Decision:

- Replace with `DataPanel`, `MetricTile`, `StatusMetricTile`, and `RoomStatusCard`.
- Pages should not define their own card chroma.

### Inline Button Styling

Common patterns:

- `bg-brand-indigo-500 ... text-white`
- `bg-slate-950 ... text-white`
- `rounded-xl border ... bg-white`
- hand-written icon buttons

Decision:

- All actions should use the shared `Button`.
- Introduce `ButtonGroup` / `ActionCluster` for repeated primary + secondary actions.

### Data Tables

Current usage:

- many pages use `.data-table`, but wrappers, headers, density, and actions differ.

Decision:

- Keep a single `DataTable` visual contract.
- Use the same table header typography, row height, numeric alignment, and action column pattern everywhere.
- Table pages should avoid mixing table action buttons and duplicate detail links.

### Room Cards

Current usage:

- `src/components/room-card.tsx`
- `src/features/management/management-dashboard.tsx`
- `src/features/leases/lease-list.tsx`
- `src/features/sales/sale-list.tsx`
- `src/features/mobile/mobile-room-card.tsx`

Decision:

- Promote one room card visual system.
- Status should be encoded primarily by card color plus external legend.
- Card text should be minimal: room number, customer/availability, date or contract clue.
- Keep three action slots, but map their behavior by status.
- Do not make the whole card hover dramatically if the action buttons are the interactive target.

### Status Colors

Current risk:

- Status color decisions are spread across `status-styles.ts`, `StatusBadge`, `RoomCard`, page-local maps, and Tailwind tokens.

Decision:

- Make `src/lib/status-styles.ts` the only business-status color map.
- UI components should consume it instead of creating local palettes.

### Mobile/Desktop Duplication

Current pattern:

- Several pages render a mobile-only component and a separate desktop component.

Decision:

- Preserve mobile-specific workflows, but align status labels, action semantics, and component tokens with desktop.
- Avoid two independent business interpretations.

## First Components To Build Or Replace

1. `src/components/ui/button.tsx`
2. `src/components/ui/card.tsx`
3. `src/components/ui/badge.tsx`
4. `src/components/ui/input.tsx`
5. `src/components/room-card.tsx`
6. `src/components/metric-card.tsx`
7. new `src/components/data-table.tsx`
8. new `src/components/filter-bar.tsx`
9. new `src/components/section-header.tsx`

## First Pages To Migrate

1. `/management`
2. `/daily-rentals`
3. `/units`
4. `/leases`
5. `/sales`
6. `/customers`
7. `/finance`
8. `/reports`

## Redesign Guardrails

- Do not add decorative charts unless they represent real data.
- Do not keep large cards that only describe the page.
- Do not duplicate details and archive buttons when one panel can contain both.
- Do not use status text inside every room card if a status legend already explains color.
- Do not use more than one room-card grammar across management, room status, lease, and sale pages.
