# SACIS 3.0 Production Checklist

## Before Every Commit

### TypeScript
```bash
npm run typecheck
```
All `.ts` / `.tsx` files must pass `tsc --noEmit` with zero errors.

---

### Daily Rental Business Rules
Required if editing any file under `src/features/daily-rentals/`:
```bash
npm run check:daily-rental-rules
```
Checks 28 source-code invariants. See `docs/daily-rental-business-rules.md` for the full reference.

---

### Full Validation (before push)
```bash
npm run validate
```
Runs **serially**:
1. `npm run check:daily-rental-rules` — static rule checks
2. `npm run typecheck` — TypeScript compilation
3. `npm run build` — Next.js production build

> **Do NOT parallelize `typecheck` and `build`.** `build` regenerates `.next/types/` which `typecheck` depends on. Serial execution prevents stale type cache errors.

---

### Git Hygiene
```bash
git diff --check
```
Ensure no trailing whitespace or merge conflict markers.

---

## When Editing These Areas

| Area | Minimum Check | Recommended |
|---|---|---|
| UI / layout / styles | `typecheck` | `validate` |
| Page-level data fetching | `typecheck` | `validate` |
| Server actions (actions.ts) | `check:daily-rental-rules` + `typecheck` | `validate` |
| Business rules (policy, room-status) | `check:daily-rental-rules` + `typecheck` | `validate` |
| Financial (billing, payments, receivables) | `check:daily-rental-rules` + `typecheck` | `validate` |
| DB schema changes | Migration review | `validate` |
| New dependencies | `npm audit` | `validate` |

---

## Common Failure Patterns

| Symptom | Likely Cause | Fix |
|---|---|---|
| TS6053 `.next/types` errors | Stale type cache | Delete `.next` and re-run `build` |
| `todayIso not found` | Linter removed unused import | Add `todayIso` back to `actions.ts` imports |
| Check-in bypasses cleaning | `hasOpenCleaningTask` removed from `allowCheckIn` | Restore the check |
| Backfill modifies unit status | `units.update` added to `createBackfillBooking` | Remove it |
| Orphan ledger entries | Payment deleted without reversal | Use `reverseLedgerEntriesForPayment` before delete |

---

## Environment Variables

| Variable | Required | Notes |
|---|---:|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anonymous key |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional | Server-only service role key. Never expose with `NEXT_PUBLIC_`. |

---

## Database Migration Order

1. `202605180001_initial_schema.sql`
2. `202605180002_seed_sasci11.sql`
3. `202605180003_user_profiles.sql`
4. `202605180004_rls_policies.sql`
5. `202605180005_open_daily_booking.sql`
6. `202605190001_receivables.sql`
7. `202605190002_lease_settlements.sql`
8. `202605200001_audit_logs_enhance.sql`
9. `202605210001_business_targets.sql`
10. `202605210002_system_settings.sql`

---

## Seed Accounts

| Email | Role | Expected Access |
|---|---|---|
| `admin@sacsi.com` | admin | Full access |
| `boss@sacsi.com` | boss | Read all, no write operations |
| `finance@sacsi.com` | finance | Finance, receivables, payments |
| `front@sacsi.com` | front_desk | Front desk daily-rental operations |

---

## Release Smoke Tests

Core pages:

- `/management`
- `/units`
- `/units/[id]`
- `/daily-rentals`
- `/daily-rentals/overview`
- `/leases`
- `/sales`
- `/customers`
- `/customers/[id]`
- `/finance`
- `/reports`
- `/documents`
- `/todos`
- `/data-quality`
- `/settings`
- `/settings/audit-logs`
- `/settings/security`

Manual browser QA before release:

| Page | Focus |
|---|---|
| `/daily-rentals` | Same-day turnover: guest A checks out, cleaning completes, guest B checks in. Historical backfill button is admin-only. |
| `/management` | Suspense loading order: shell/title first, then finance KPI, room status/matrix, and quality widget. Finance detail panels show room number and customer name. |
| `/units` and `/fr/units` | List typography, tabular number display, and trimmed fields still preserve required data. |
| `/customers` and `/fr/customers` | Dynamic refresh behavior after edits. |
| `/data-quality` and `/fr/data-quality` | Daily-rental audit issues render. Admin sees repair buttons and can repair. Boss sees read-only repair notice. |
| `/finance`, `/leases`, `/sales`, `/reports` | Pages render normally after shared style and validation changes. |
| `/fr/*` | No mojibake in visible copy. Backfill form is usable in French. |
| Mobile `/daily-rentals` | Bottom navigation prefetch, empty-cell new booking panel, and cleaning cells render correctly. |

Daily rental flow:

- Create booking: `pending_review`
- Confirm booking: `confirmed`
- Check in: `checked_in`, unit becomes `daily_occupied`
- Check out: `checked_out`, unit becomes `cleaning_pending`
- Complete cleaning: unit status resolves from active bookings
- Same-day turnover: next guest cannot check in until cleaning is complete
- Historical backfill: admin-only, past completed stay only, no current room-status mutation

Finance consistency:

- Payments sync to receivables
- Receivables sync to daily booking prepaid amount
- Billing status derives from paid amount and final amount
- Deleted payments create reversal ledger entries
- `/management`, `/finance`, and `/reports` use the same receivable/ledger basis

---

## Backup Notes

- Export security backups from `/settings/security` before major releases.
- Run a database backup before schema migrations.
- Confirm critical repair and finance actions write `audit_logs`.
