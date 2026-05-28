# SACIS Frontend Redesign Reset Plan

This document defines the boundary for rebuilding the SACIS frontend visual layer while preserving the working business system.

## Goal

Rebuild the user-facing interface from a clean visual system without deleting or weakening the existing business logic, database access, permissions, audit trail, finance calculations, or daily-rental workflow.

The redesign should treat the current app as two layers:

- Business layer: keep and harden.
- Presentation layer: replace progressively.

## Do Not Rewrite

These files and folders are business-critical. They can be refactored only when a specific business bug requires it, and every change must be tested.

### Database And Types

- `src/types/database.ts`
- `src/types/domain.ts`
- `supabase/**`

### Supabase And Auth

- `src/lib/supabase/server.ts`
- `src/lib/supabase/client.ts`
- `src/lib/auth.ts`
- `src/lib/audit.ts`
- `src/lib/currency.ts`
- `src/lib/settings.ts`

### Repository Layer

- `src/lib/repositories/**`

Repositories should remain the preferred place for structured data access when adding new query helpers.

### Server Actions

- `src/features/**/actions.ts`
- `src/app/login/actions.ts`

These contain mutations, permissions, audit writes, revalidation, payments, receivables, and room status synchronization.

### Business Services And Policies

- `src/features/daily-rentals/daily-rental-policy.ts`
- `src/features/daily-rentals/billing.ts`
- `src/features/daily-rentals/room-status.ts`
- `src/features/management/kpi-service.ts`
- `src/features/units/unit-profile-service.ts`
- `src/features/customers/customer-profile-service.ts`
- `src/features/todos/todo-service.ts`
- `src/features/data-quality/quality-service.ts`
- `src/features/security/security-service.ts`
- `src/features/search/search-service.ts`
- `src/features/data-exchange/import-service.ts`
- `src/features/data-exchange/export-service.ts`
- `src/features/bulk-actions/bulk-action-service.ts`

## Safe To Replace

These are primarily visual or interaction layers. They can be rewritten as long as their props, server actions, and data contracts are preserved or intentionally migrated.

### Global Shell

- `src/components/app-shell.tsx`
- `src/components/app-shell-wrapper.tsx`
- `src/components/app-sidebar.tsx`
- `src/components/mobile-bottom-nav.tsx`
- `src/app/globals.css`
- `tailwind.config.ts`

### UI Primitives

- `src/components/ui/button.tsx`
- `src/components/ui/card.tsx`
- `src/components/ui/badge.tsx`
- `src/components/ui/input.tsx`
- `src/components/ui/search-input.tsx`
- `src/components/ui/sidebar.tsx`
- `src/components/ui/sheet.tsx`
- `src/components/ui/separator.tsx`
- `src/components/ui/skeleton.tsx`
- `src/components/ui/tooltip.tsx`
- `src/components/page-header.tsx`
- `src/components/metric-card.tsx`
- `src/components/empty-state.tsx`
- `src/components/room-card.tsx`
- `src/components/status-badge.tsx`

### Feature Views

- `src/features/**/**/*view.tsx`
- `src/features/**/**/*list.tsx`
- `src/features/**/**/*center.tsx`
- `src/features/**/**/*panel.tsx`
- `src/features/**/**/*widget.tsx`
- `src/features/daily-rentals/calendar.tsx`
- `src/features/daily-rentals/booking-panel.tsx`
- `src/features/mobile/**`

## Page Entry Strategy

Most `src/app/**/page.tsx` files currently mix data loading with layout. During redesign:

1. Keep auth checks, role redirects, and Supabase queries in the page file.
2. Move visual composition into a matching feature component.
3. Avoid duplicating zh/fr layout logic. Prefer shared view components with `locale`.

Protected page concerns:

- `requireAuth()` and role checks.
- Supabase queries and limits.
- Redirect behavior.
- Data passed into feature components.

Replaceable page concerns:

- Page title blocks.
- Decorative cards.
- Layout grids.
- Responsive wrappers.
- Empty state markup.

## New Design System Target

Before rebuilding pages, create a small but strict UI kit:

- `AppFrame`: content width, page padding, background, shell rhythm.
- `Section`: title/action/header layout.
- `MetricTile`: finance and count cards.
- `DataPanel`: card/table container.
- `DataTable`: unified table density and typography.
- `FilterBar`: selects, search, date filters.
- `SegmentedTabs`: page tabs and mode switches.
- `StatusPill`: compact status labels.
- `RoomStatusCard`: shared room/lease/sale/daily card.
- `ActionCluster`: primary button plus secondary/more actions.

The redesign should not allow pages to create one-off button, badge, table, or card styles unless the pattern has been promoted to the UI kit.

## First Sample Page

Use `/management` as the first redesign sample because it contains the core executive needs:

- financial overview;
- room sales / lease / daily / available state;
- room status card matrix;
- risk and data health summaries.

Acceptance for the sample page:

- It should look intentionally designed before moving to other pages.
- It should use real SACIS data only.
- It should avoid fake decorative charts unless they communicate real values.
- Room cards must be reusable by `/units`, `/leases`, `/sales`, and room-status views.

## Migration Order

1. Create the new design tokens and primitives.
2. Rebuild `/management` as the visual baseline.
3. Rebuild `/daily-rentals` with the new calendar/card language.
4. Rebuild `/units` and unit profile.
5. Rebuild `/leases` and `/sales`.
6. Rebuild `/customers`.
7. Rebuild `/finance` and `/reports`.
8. Rebuild operations pages: todos, documents, data quality, audit logs, import/export.
9. Remove old unused components and legacy class patterns.

## Verification Rules

Every redesign batch must pass:

- `npm run typecheck`
- `npm run build`
- manual browser check for the touched zh route;
- manual browser check for the matching `/fr` route when one exists.

For room-state or daily-rental changes, also verify:

- `/management`
- `/daily-rentals`
- `/units`
- `/leases`
- `/sales`

## Non-Goals

- Do not change the Supabase schema as part of visual redesign.
- Do not rewrite working server actions for visual reasons.
- Do not remove audit logging.
- Do not remove role guards.
- Do not introduce mock data into production pages.
- Do not use generated decorative widgets that do not represent real data.
