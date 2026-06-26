# SACIS 3.0 Daily Rental Business Rules v2

> **Status**: Implemented. Reflects the actual code in `src/features/daily-rentals/`.
> **Last updated**: 2026-06-01

---

## 1. Booking Status Lifecycle

```
pending_review  →  confirmed  →  checked_in  →  checked_out
     ↓                ↓
  cancelled       cancelled
```

- `pending_review`: New booking, awaiting confirmation.
- `confirmed`: Staff confirmed. Guest is expected.
- `checked_in`: Guest arrived. Room is occupied.
- `checked_out`: Guest departed. Room needs cleaning.
- `cancelled`: Terminal. All payments reversed. Cannot be reactivated.

Transition functions: `allowConfirmBooking`, `allowCheckIn`, `allowCheckOut`, `allowCancelBooking` in `daily-rental-policy.ts`.

---

## 2. Unit Status vs Booking Status

- **`daily_bookings` is the source of truth** for room occupancy.
- **`units.status` is a cache**, updated as a side effect by server actions:
  - `createBooking` → `units.status = "reserved"`
  - `checkIn` → `units.status = "daily_occupied"`
  - `checkOut` → `units.status = "cleaning_pending"`
  - `completeCleaning` → resolved by `resolveUnitStatusAfterDailyChange()`
  - `cancelBooking` → resolved by same
- If `units.status` diverges from booking reality, `daily-rental-audit.ts` flags it.

---

## 3. Creating New Bookings

### Allowed
- Future dates (`check_in >= today`).
- Fixed mode: `check_out > check_in`.
- Open mode: no `check_out` required.
- Unit not blocked (`maintenance`, `locked`, `sold`, `leased`).

### Blocked
- Past dates without backfill flag.
- Open cleaning tasks on the unit (today/future, non-backfill).
- Overlapping active bookings (`pending_review`, `confirmed`, `checked_in`).
- Blacklisted customers.

### Policy Function
`allowCreateBooking(input)` in `daily-rental-policy.ts` checks: `unitStatus`, `checkIn` date, `isBackfill`, `checkOut` validity.

---

## 4. Check-in Rules

### Hard Checks (`allowCheckIn`)
- Booking must be `confirmed`.
- **No open cleaning tasks** on the unit (even cross-booking).
- **No other checked_in booking** on the unit.
- Unit not `maintenance`, `locked`, `sold`, `leased`.
- Payment is optional at check-in; unpaid balances remain in finance as receivables.

### Server Action (`checkIn`)
1. Fetches unit status, open cleaning tasks, other checked_in bookings.
2. Calls `allowCheckIn` with all checks.
3. Inserts payment + ledger entry if prepaid amount is greater than 0.
4. Calls `syncBookingFinance` after payment changes; zero-payment check-in keeps the existing receivable unpaid.

---

## 5. Check-out Rules

1. Booking must be `checked_in`.
2. Final amount calculated or provided.
3. `unit.status = "cleaning_pending"`.
4. `cleaning_task` inserted with `is_completed = false`.
5. `syncBookingFinance` for financial alignment.

---

## 6. Same-Day Turnover

```
08:00  Guest A checks out → cleaning_task created → unit.status = "cleaning_pending"
10:00  Staff completes cleaning → cleaning_task.is_completed = true → unit.status resolved
14:00  Guest B (confirmed booking) checks in → unit.status = "daily_occupied"
```

### Rules
1. **New booking can be created for same day** even while cleaning is pending (date conflict check allows `check_out = next check_in`).
2. **Check-in is blocked** until cleaning is completed.
3. Calendar display priority: `checked_in > cleaning > confirmed/pending_review > checked_out > available`.
4. `getPrimaryDailyAction` returns `complete_cleaning` (not `check_in`) for confirmed bookings with open cleaning.

---

## 7. Historical Backfill (Admin Only)

### Rules
- **Only admin**: `requireRole("admin")`.
- **Past dates only**: `check_out < today`.
- Booking status: `checked_out` (never `pending_review`).
- **Does NOT modify `units.status`**.
- **Does NOT create `cleaning_task`**.
- Creates `receivable`, `payment`, `ledger_entry` if paid.
- Writes `audit_logs` with `action = "daily_booking_backfill"`.
- `notes` field prefixed with `[历史补录]` for traceability.
- Server action: `createBackfillBooking` in `actions.ts`.

---

## 8. Financial Invariants

### Data Flow
```
payments (source of truth for money received)
    → receivables.paid_amount_xof (synced from payments)
    → daily_bookings.prepaid_amount_xof (synced from receivables)
    → daily_bookings.billing_status (computed from paid vs final)
    → ledger_entries (every payment must have one)
```

### Rules
1. `receivables.paid_amount_xof` = SUM(payments.amount) for same `source_id`.
2. `daily_bookings.prepaid_amount_xof` = `receivables.paid_amount_xof`.
3. `receivables.amount_xof` = `daily_bookings.final_amount_xof` (or `total_amount_xof`).
4. `billing_status` derived: `prepaid` / `settled` / `partially_paid` / `need_top_up`.
5. Every payment must have a `ledger_entry`.
6. Deleting a payment must insert reversal ledger entries before delete.
7. Cancelling a booking must reverse payments + cancel receivables.

### Sync Function
`syncBookingFinance(supabase, bookingId)` in `daily-rental-finance.ts`:
1. `syncReceivablesForSource` — sync receivable from payments.
2. `syncBookingPrepaidFromReceivables` — sync booking prepaid from receivable.
3. `syncBillingStatus` — recompute and persist billing_status.

---

## 9. Data Quality Repair

### Auto-fixable (admin only, single-issue)
| Prefix | Action |
|---|---|
| `dr_ci_not_occupied_` | Set `unit.status = "daily_occupied"` |
| `dr_clean_not_status_` | Set `unit.status = "cleaning_pending"` |
| `dr_clean_status_no_task_` | Recalculate `unit.status` from active bookings: `daily_occupied`, `reserved`, or `available` |
| `dr_fin_*` | Run `syncBookingFinance` |
| `dr_bf_no_audit_` | Insert `daily_booking_backfill` audit log |
| `dr_bf_unit_status_` | Recalculate `unit.status` from active bookings |

### Manual-only (report, no auto-fix)
| Prefix | Reason |
|---|---|
| `dr_overlap_` | Human must decide which booking to keep |
| `dr_ci_multi_occupied_` | Human must decide which is valid |
| `dr_occupied_no_ci_` | Human must confirm room is empty |
| `dr_fin_no_ledger_` | Human must verify amount |
| `dr_fin_orphan_ledger_` | Human must verify before reversal |
| `dr_bf_future_` | Human must verify date |

### Constraints
- Single-issue repair only. No batch.
- Every repair writes `audit_logs`.
- `revalidatePath` for all affected pages after repair.
- `requireRole("admin")` enforced in `repairDailyRentalIssue`.

---

## 10. Key Files Reference

| File | Role |
|---|---|
| `daily-rental-policy.ts` | Status machine, action permissions, conflict checks |
| `daily-rental-finance.ts` | Financial computation, sync, ledger helpers |
| `daily-rental-audit.ts` | Issue scanning (pure function) |
| `daily-rental-repair.ts` | Server action for single-issue repair |
| `actions.ts` | All 10 server actions (create, confirm, checkIn, checkOut, etc.) |
| `room-status.ts` | Display status computation for calendar |
| `booking-panel.tsx` | UI panel driven by `getPrimaryDailyAction` |
| `calendar.tsx` | Calendar grid with policy-checked cell click |
