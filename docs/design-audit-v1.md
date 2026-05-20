# SACIS 3.0 Design Audit — Step 1: Module-by-Module Analysis

## Skills Used

- `frontend-design-direction` — design purpose, audience, tone, memorable detail
- `ui-ux-pro-max` — accessibility, touch, performance, style, layout, typography, color, animation, forms, navigation, charts
- `impeccable` — shared design laws (color strategy, absolute bans, AI slop test), product register
- `shadcn-ui` — component patterns reference
- `web-design-guidelines` — Vercel product UI standards

## Physical Scene

Staff in an air-conditioned office in Abidjan, Côte d'Ivoire, under fluorescent ceiling lights. The admin sits at a desktop with a 24-inch monitor, switching between Chinese and French depending on whether they're talking to the Chinese management team or local Ivorian staff. The front-desk person uses a tablet at the reception counter, checking guests in and out while guests wait. The finance person works on a laptop, reconciling receivables against paper receipts. The boss checks the dashboard on a phone between meetings.

This is a warm-climate, bright-office environment. Dark mode is supported but light mode is the daily default. The system is used 8-10 hours a day — it must not cause eye strain.

---

## Module Audit

### 首页 (Home)

#### 工作台 `/` — Workbench / Tableau de bord

**Core user:** All roles (admin, boss, finance, front_desk). Front-desk gets redirected to `/front-desk`.
**Primary task:** Overview of today's status — what needs attention right now.
**Current issues:**
- Page is a simple dashboard with KPI cards; lacks clear "today's tasks" orientation.
- No differentiation between "things I need to act on" vs "things I should know."
- Front-desk redirect means the root page is only seen by admin/boss/finance — should be tailored to their scan patterns.
**Information hierarchy needed:**
1. Alerts requiring action (overdue payments, expiring contracts, maintenance rooms)
2. Today-at-a-glance KPIs (occupancy, collection rate, arrivals/departures)
3. Quick navigation to frequent tasks
**Visual priority:** Risk/alert items > KPIs > navigation shortcuts

#### 前台工作台 `/front-desk` — Front Desk

**Core user:** front_desk role only.
**Primary task:** Handle today's check-ins, check-outs, walk-in bookings, cleaning status.
**Current issues:** Not yet fully audited (agent pending).
**Expected needs:** Quick-access buttons for common operations, today's occupancy at a glance, guest-facing info.

#### 经营驾驶舱 `/management` — Management Dashboard / Direction

**Core user:** admin, boss.
**Primary task:** See building-wide asset status, financial health, and risks in one view.
**Current issues (detailed audit complete):**
- **Information overload:** 10 sections stacked vertically — status pills, room matrix, 7 KPI cards, 2 large tables, 2 leaderboards, risk cards, quick links. Feels like a printed report appendix, not a dashboard.
- **Room matrix cells are 36×36px** — too small to read, impossible to tap on mobile. The matrix encodes status by color but 7 statuses with subtle earth tones are hard to distinguish.
- **Risk alerts are buried** below the fold after two full-width tables. Cleaning pending, maintenance, lease expiry warnings should be at the top.
- **No drill-down:** clicking a KPI card does nothing. Only room cells are clickable.
- **Typography:** 10px font throughout tables and badges — below WCAG minimum for body text (12px). Fine for labels but overused.
- **Tables are dumped raw:** the "by building" table has 10 columns; there's no visual distinction between columns the boss cares about (collection rate, overdue) and accounting details.
- **No empty/error/loading states:** tables show "0 XOF" rows for buildings with zero activity. No skeleton loading.
**Redesign direction:**
1. Move risk alerts and status summary to the top — these are the "need to know now" items.
2. Room matrix needs larger cells (48px+) or a different visualization for status distribution (stacked bar per building, or a heatmap).
3. Finance KPIs should be 4 key numbers (receivable, collected, outstanding, overdue) not 7 — reduce to what the boss actually tracks.
4. Tables should be collapsible sections, not always-visible walls of data.
5. Add drill-down: click a KPI → filtered finance view; click a risk card → filtered list.

---

### 房源资产 (Assets / Patrimoine)

#### 房源总览 `/units` — Units / Lots

**Core user:** admin, boss, front_desk.
**Primary task:** Browse room inventory, check room status and business assignments, open room profiles.
**Current issues (detailed audit complete):**
- **Disabled Import/Export buttons** are permanently visible but non-functional — creates false expectations and visual clutter.
- **No search** — only 4 dropdown filters (floor, status, kind, business). Can't type a room number to jump to it.
- **No column sorting** — can't sort by floor, status, or room number.
- **Price column only shows daily rental price** — no lease price or sale price.
- **Detail panel slide-out** has no scrim/backdrop — the table behind remains visible and distracting.
- **Filter dropdowns have no "clear all" or result count badge.**
**Redesign direction:**
1. Remove disabled buttons. Add a single "Actions" dropdown with upcoming import/export.
2. Add a search input that filters by room number.
3. Make column headers sortable.
4. Add a scrim behind the detail panel.
5. Show room count per status in the filter bar as quick-select chips.

#### 房态矩阵 `/daily-rentals/overview` — Room Status Matrix / Matrice lots

**Core user:** admin, boss, front_desk (especially front_desk for daily occupancy).
**Primary task:** See today's occupancy at a glance, know which rooms need cleaning, copy shareable status text.
**Current issues (detailed audit complete):**
- **No drill-down from table rows** — clicking a room does nothing. Should open booking detail or unit profile.
- **Share text block is bulky** — takes significant space at page bottom. Should be a modal or slide-out.
- **Raw numbers instead of formatXof** for billing amounts — inconsistency with rest of app.
- **No status filter on the table** — can't filter to show only "needs cleaning" or "open-ended stays."
- **Customer names truncated to 8 chars** with no tooltip.
- **JSX nesting bug** (double fragment `<></>` on lines 54-66).
**Redesign direction:**
1. Add clickable rows → booking detail or unit profile.
2. Move share text to a modal triggered by the "Copy" button.
3. Add status filter chips above the table.
4. Fix formatXof consistency.
5. Add tooltips on truncated customer names.

---

### 租售业务 (Business / Activites)

#### 日租业务 `/daily-rentals` — Daily Rentals / Location jour

**Core user:** admin, front_desk (primary).
**Primary task:** View monthly calendar, create/manage bookings, check guests in/out, handle payments.
**Current issues (detailed audit complete):**
- **Hardcoded to SASCI11** — won't work when other buildings add daily rentals.
- **Calendar horizontal scroll is aggressive** — 28-31 columns at 64px each = 1800px+ wide. The sticky room number column helps but the overall experience is awkward.
- **Empty cells are blank** until hover — no visual affordance that they're clickable for creating bookings.
- **Mobile uses a completely different component** (`MobileDailyCards`) — unclear feature parity.
- **No week or day view** — only monthly. A 3-day or 7-day view would be better for front-desk daily operations.
- **BookingPanel is a full slide-out** that covers the calendar — you lose spatial context.
- **No quick stats** like "X occupied tonight, Y arriving, Z departing."
**Redesign direction:**
1. Add a "today" or "3-day" view as default for front-desk users; keep month view for planning.
2. Show subtle dot or outline on empty available cells so they're scannable.
3. Add a compact status bar above the calendar: "Arriving: 3 | Departing: 2 | Occupied: 15 | Available: 6."
4. Consider a split-panel layout (calendar left, booking detail right) instead of the slide-out overlay.
5. The BookingPanel form needs clearer visual hierarchy — group fields by purpose (guest info, dates, payment).

#### 长租业务 `/leases` — Leases / Baux

**Core user:** admin, finance, front_desk.
**Primary task:** Manage lease contracts, track rent payments, handle move-outs.
**Expected needs:** Contract status overview, rent collection tracking, upcoming expirations.
**Current issues:** Agent pending — full audit to follow.

#### 出售业务 `/sales` — Sales / Ventes

**Core user:** admin, finance.
**Primary task:** Manage sale contracts, track installment payments, monitor property transfer status.
**Expected needs:** Payment progress bars, installment schedules, transfer status tracking.
**Current issues:** Agent pending — full audit to follow.

#### 客户档案 `/customers` — Customers / Clients

**Core user:** all roles.
**Primary task:** Look up customer profiles, view associated contracts and payment history.
**Expected needs:** Customer 360 view with linked rooms, contracts, payments.
**Current issues:** Agent pending — full audit to follow.

---

### 财务中心 (Finance Center / Finance)

#### 应收与收款 `/finance` — Receivables / Creances

**Core user:** admin, finance (primary).
**Primary task:** Reconcile receivables against payments, track overdue accounts, manage the ledger.
**Current issues (detailed audit complete):**
- **Mobile is a dead end** — shows "Please use desktop" message. Finance staff may need to check on phone.
- **No server-side pagination** — fetches up to 500 entries. Will degrade as data grows.
- **Receivable table has 11 columns** with many values truncated (customer names at 6 chars, titles at 120px).
- **New ledger entry form has no client-side validation** — zero amounts accepted, future dates without warning.
- **Exchange rate is a free-text input** — no default rate, no rate history.
- **CSV export has no confirmation or row count warning.**
- **No free-text search** on either table.
**Redesign direction:**
1. Add a basic mobile view — at minimum, show summary cards and a simplified receivable list.
2. Add pagination or infinite scroll with a "load more" pattern.
3. Widen critical columns (customer name, title) at the expense of less important ones.
4. Add inline validation on the ledger entry form.
5. Store and suggest the last-used exchange rate.
6. Add search input for both tables.

#### 财务报表 `/reports` — Reports / Rapports

**Core user:** admin, boss, finance.
**Primary task:** View structured financial reports, export data.
**Expected needs:** Tabbed report types, date range selectors, chart visualization, export buttons.
**Current issues:** Agent pending — full audit to follow.

---

### 运营中心 (Operations / Operations)

#### 待办提醒 `/todos` — Tasks / Taches

**Core user:** all roles.
**Primary task:** See what needs action today — overdue items, today's tasks, upcoming deadlines.
**Expected needs:** Task grouping by urgency and type, clear overdue indicators.
**Current issues:** Agent pending — full audit to follow.

#### 单据打印 `/documents` — Documents / Documents

**Core user:** admin, front_desk.
**Primary task:** Print contracts, receipts, settlement sheets, cleaning task lists.
**Expected needs:** Document type selection, print button prominent, list not cluttered.
**Current issues:** Agent pending — full audit to follow.

#### 数据质量 `/data-quality` — Data Quality / Qualite

**Core user:** admin.
**Primary task:** Find data anomalies, missing information, inconsistencies across the system.
**Expected needs:** Issues ranked by severity, clear "fix" actions per issue, count of issues per category.
**Current issues:** Agent pending — full audit to follow.

#### 审计日志 `/settings/audit-logs` — Audit Logs / Audit

**Core user:** admin.
**Primary task:** Review who did what and when — for compliance and troubleshooting.
**Expected needs:** Timestamped log entries, filterable by user/action/entity, searchable.
**Current issues:** Agent pending — full audit to follow.

---

### 系统工具 (System Tools / Outils)

#### 导入导出 `/data-exchange` — Data Exchange / Echange

**Core user:** admin.
**Primary task:** Import data from Excel, export data to Excel/CSV/PDF.
**Expected needs:** Clear import → preview → confirm flow, error/warning/success row status, cautious UX for destructive imports.
**Current issues:** Agent pending — full audit to follow.

#### 批量操作 `/bulk-actions` — Bulk Actions / Actions

**Core user:** admin (hidden from boss for safety).
**Primary task:** Perform high-risk batch operations safely.
**Expected needs:** Prominent risk warnings, preview before confirm, dangerous actions visually distinct from safe ones.
**Current issues:** Agent pending — full audit to follow.

#### 经营目标 `/management/targets` — Targets / Objectifs

**Core user:** admin, boss.
**Primary task:** Set and track business targets (revenue, occupancy, etc.).
**Expected needs:** Target vs actual comparison, progress visualization.
**Current issues:** Agent pending — full audit to follow.

#### 系统设置 `/settings` — Settings / Parametres

**Core user:** admin.
**Primary task:** Configure system parameters.
**Expected needs:** Grouped settings categories, clear save behavior.
**Current issues:** Agent pending — full audit to follow.

#### 安全备份 `/settings/security` — Security / Securite

**Core user:** admin.
**Primary task:** Manage database backups, view backup history.
**Expected needs:** Backup status clearly visible, restore actions with strong confirmations.
**Current issues:** Agent pending — full audit to follow.

---

## Global Design Issues (Cross-Cutting)

### 1. Color System
- **Current state:** Mature, well-structured. The "Natural Professional" palette (brand.orange, brand.warm, brand.ink, semantic greens/reds/ambers/skys) is already good.
- **Issues:** `brand.ink.50` and `brand.ink.100` reuse the same hex values as `brand.warm.50` and `brand.warm.100` — this is confusing.
- **Fix:** Fix the ink scale so it's independent from the warm scale.

### 2. Typography
- **Current state:** System font stack, good OpenType features, antialiased. But 10px is used everywhere.
- **Issues:** 10px font size for table headers, badges, labels is below the 12px minimum for accessibility. The `text-[10px]` pattern appears in desktop-sidebar, status-badge, metric-card, and many page tables.
- **Fix:** Establish a minimum 11px for labels/badges, 12px for body text. Use `tabular-nums` for all financial numbers.

### 3. Shadows & Elevation
- **Current state:** 5 shadow tokens (soft, card, panel, dropdown, natural). All are ultra-subtle (0.03-0.06 opacity).
- **Issues:** In light mode, the card shadow (`0 1px 3px rgba(0,0,0,0.04)`) is nearly invisible. Cards blend into the warm background.
- **Fix:** Slightly deepen card shadows or add a more visible border to maintain card/background separation.

### 4. Spacing & Layout
- **Current state:** No systematic spacing scale beyond Tailwind defaults. Page content uses `px-4 py-5` on mobile, `lg:px-8 lg:py-7` on desktop.
- **Issues:** The `max-w-[1440px]` content container is good, but internal section spacing varies unpredictably.
- **Fix:** Define section spacing tokens (section-gap-sm/md/lg) and use consistently.

### 5. Absolute Bans Violations (from impeccable skill)
- **Side-stripe borders on MetricCard:** `border-l-[3px]` with color accent. This should be replaced with a top-border, background tint, or leading icon.
- **No other ban violations detected so far** (no gradient text, no glassmorphism, no hero-metric template, no nested cards, no emoji as icons).

### 6. Missing Patterns
- **No consistent table component** — every page hand-rolls its own `<table>` with different styling.
- **No consistent filter bar pattern** — some pages use dropdowns, some use date inputs, layouts vary.
- **No consistent page-level loading skeleton** — root `loading.tsx` exists but no Suspense boundaries per page.
- **No error boundaries** — query failures silently fall back to empty arrays.
- **No consistent empty state** — the `EmptyState` component exists but isn't used uniformly.

### 7. Mobile Experience
- **Finance:** Dead end (desktop-only message).
- **Daily Rentals:** Completely different component for mobile vs desktop.
- **Management:** No mobile adaptation (tables overflow).
- **Bottom nav:** Only 4 tabs, which limits access to 15+ pages on mobile.

### 8. French (/fr/) Pages
- **Pattern:** Every page is duplicated. Changes to zh pages must be mirrored to fr pages.
- **Risk:** If we restructure a zh page component, we must restructure the fr variant identically.
- **Strategy:** Extract shared page content into locale-agnostic components that accept `locale` as a prop, then both zh and fr pages become thin wrappers.

---

## Design Direction Decision

**Register:** Product (not brand). Design SERVES the product.

**Color strategy:** Restrained. The palette is already good. The accent orange (#C96F2D) should remain at ≤10% of surface area. Focus on fixing the ink scale and deepening shadows slightly for better card separation.

**Typography strategy:** Keep the system font stack. Raise minimum font size to 11px. Add `tabular-nums` to all monetary values. Define a clear type scale: 11/12/13/14/16/20/28.

**Layout strategy:** Vary spacing for rhythm. Section gaps: 16px (related), 24px (separated), 32px (major section break). Cards with consistent padding.

**Motion:** Keep current 100-200ms transitions. No decorative animation. Use for state changes only (hover, active, enter/exit).

**The AI slop test:**
- First-order: Real estate management in Côte d'Ivoire does NOT default to "orange and warm stone." The orange is from the Ivorian flag (#F77F00), but the current implementation (#C96F2D) is already more burnt/earthy than flag-bright. Good — it avoids the "African = orange + brown" cliché.
- Second-order: The "warm stone + muted semantic colors" palette reads as "private bank / Swiss spa" from the tailwind config comments. For an Abidjan real estate office, this is slightly too European-spa. The palette works but the tone should feel more practical/operational, less luxury-wellness.
