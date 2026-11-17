# CIMAC paid apartment reservations

B17 can record one actual XOF receipt covering two months of deposit and three
months of prepaid rent for one customer across selected apartments. This is a
paid reservation with an agreed rental term. It does not create a signed or
commenced lease and does not verify or change actual occupancy.

## Business evidence

- The operator supplies the customer, agreed term, three-month paid period,
  actual payment date, payment method, original source, and room allocations.
- The current B17 monthly rate determines each room's deposit and rent. The
  receipt total must equal every explicit allocation; no property-fee payment
  is inferred.
- Physical receipt numbers are external evidence only. The normal financial
  numbering mechanism generates payment references.
- Old unpaid holds must be cancelled separately and retained in history before
  a paid reservation can replace them. A paid reservation is not cancelled by
  the unpaid-hold action.

## Controlled write

The authenticated admin or finance actor must have access to CIMAC. The database
rechecks B17 apartment identity, exact unit versions, rate and period arithmetic,
absence of competing reservations and business conflicts, and source uniqueness.
It writes the shared receipt, room reservations, allocated payments, matching
ledger entries, and audit evidence atomically under one stable request UUID.

Keep the same request and UUID after an uncertain result. Read its status before
retrying; never create a second request to compensate for an interrupted response.
Direct changes to posted evidence are denied. The source is retained for audit,
not executed as an instruction.

## Display and accounting

- Paid reservation details show the agreed term separately from the paid rent
  period. Actual occupancy retains its independently verified state.
- `cimac_apartment_rent` posts `lease_rent` / `income`.
- `cimac_apartment_deposit` posts `lease_deposit` / `liability_in`.
- The actual receipt date controls the financial entry date even when the rental
  period starts later. Deposits remain separate from rental income.
- One physical receipt can have several room and category allocations. Sum the
  allocations once; do not add the shared receipt total a second time.

## Release and verification

Run parser, service, UI, reporting and native PostgreSQL authorization, atomicity,
idempotency and conflict tests before the additive migration. Verify the released
application, then enter through the authenticated paid-reservation form. Reconcile
the shared total, per-room payments and ledger, actor and audit, agreed and paid
periods, retained old holds, and unchanged actual occupancy independently.
