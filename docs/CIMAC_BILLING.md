# CIMAC customer accounts

Customer identity is the existing immutable customer ID, not a matching name. Accounts combine authorized CIMAC shops, apartments and warehouses without merging customers, contracts or historical financial facts. Existing contract and finance actions remain available.

The account RPC returns all selected-customer scoped records (not just the visible bill page). Each entity has a hard 10,000-record completeness guard; excess causes `cimacBillingAccountTooLarge`, never silent truncation. Customer directory paging is 50 rows. An explicit unknown or foreign-project customer fails, not a fallback selection.

The forward-only read optimization builds the authorized project inventory and customer associations once for directory selection. Per-customer unit lookup starts from that customer's exact existing relations, not a full inventory scan for every directory customer. Targeted association/FK indexes and custom parameter plans support the bounded read; statement timeouts and authorization are not weakened. Contradictory historical unit/building facts stay visible for review but are excluded from valid balance summaries; genuinely building-only obligations remain supported.

## Pending rules

Fee terms are `pending_review` annotations only. No code here generates receivables, rewrites property rules, computes a contractual start date, infers a service period, prorates money, confirms an exemption or changes a legacy contract.

Confirmed pricing references: shop 900 XOF/m²/month; warehouse 450; apartment one/two/three bedrooms 30,000/40,000/50,000 XOF/month. Annual property period April 1–March 31, first 2027-04-01–2028-03-31. First partial month is daily, but denominator, boundary inclusivity and rounding remain pending. Property start date, utility rates and management-fee pricing/scope are unknown. Rent-free ending 2028-03-31 is not property exemption. Per-contract conditional concessions need evidence.

Meter readings save exact three-decimal observations and optional evidence reference. Missing previous reading means unknown usage. Neither meter reading nor a pending term produces a payable bill or overdue debt.

## Actual collections

`cimac_collect_customer_rpc` accepts an exact XOF receipt with explicit allocations to the same customer's existing managed lease-rent/property-fee receivables. Sale obligations remain visible with their existing sale collection workflow; this new cross-contract writer does not change sale schedules. Every allocation requires expected balance and updated timestamp. Deposits, offsets, cancelled/excluded/historical-pending debt, mixed currencies and unsupported manual links are rejected. Contracts' paid-through dates are not changed. Native USD/CNY rent remains available through existing native collection; it is not automatically converted or merged into this new XOF receipt.

A receipt is one payments row (`source_type` and `request_kind` `cimac_customer_collection`, source ID customer, no fictitious single unit), with one ledger entry and verified allocation per selected obligation. Existing financial ledger/report projections see the per-unit entries; the operating cash projection handles the one customer receipt exactly once. Grouped receipts remain protected from old single-room payment edits, refunds and reversals. Such an attempted modification fails `cimacBillingProtectedPayment`; use the customer-level correction path, not a guessed single-room adjustment.

## Customer receipt refunds and reversals

Open **Customer account → Receipts → the original customer-account receipt**. Actual-refund registration and mistaken-receipt reversal are separate operations, not alternative labels for the same cash event. Existing historical single-contract, deposit and native-currency records keep their existing authorized operations; this path does not silently migrate them or invent an allocation.

- **Actual refund:** register money already returned to the customer, in XOF, with the actual date, method, reason and explicitly chosen portions of the original rent/property-fee allocations. It does not initiate a bank transfer. Partial refunds cannot exceed either the original unadjusted allocation or the currently verified paid balance. Reducing the paid amount restores the original unpaid obligation; it does not waive charges, cancel a lease or confirm a rent-free period.
- **Mistaken-receipt reversal:** invalidate the entire incorrectly recorded customer receipt with a reason. This is bookkeeping correction, not a cash refund. An original receipt with any actual refund cannot also be reversed wholesale. Correcting the original receipt's reporting period must not create a fictional new cash expense in the correction month.

The original payment, original ledger lines and positive payment allocations are immutable. Corrections append linked payment/ledger facts and a private per-allocation adjustment journal. Effective allocation is original allocation less verified adjustments; the original proof still checks the original facts. Every change has its own request ID, authenticated recording actor and audit link. No allocation constraint is weakened to accept arbitrary negative values.

Refund/reversal submissions lock the original receipt and affected obligations, validate the current position, and commit payment, adjustment, paid-balance updates, audit and recovery result atomically. A repeated request returns its original result. An unknown transport outcome preserves the exact identifier and content; a missing recovery result is not permission to submit a second correction. A later unrelated payment or change to the original account requires fresh review rather than guessed allocation.

The scoped interface is `cimac_collection_position_rpc` (read current original receipt, explicit allocations and correction chain), `cimac_refund_collection_rpc` (actual-refund registration), and `cimac_reverse_collection_rpc` (whole mistaken-receipt correction). Both writers use `cimac_billing_request_rpc` for same-actor recovery. Batch correction lookup keeps report reads bounded instead of looking up each receipt serially. Refund and reversal share one browser pending identity per actor/customer/original receipt, so changing the selected action or reopening the panel cannot bypass an unknown result.

`cimac_lease_collection_projection_rpc` supplements an authorized lease's existing payment history without rewriting the actual header amount or source ID. Its `cimac_contract_allocation` gives only the exact portion linked to that contract. Existing lease-reader roles retain their authorized read workflow; an authorized non-CIMAC lease returns an empty supplement. Damaged links fail closed. Reconciliation excludes multi-line duplicate warnings only for a completely proven customer receipt (sealed request, recording actor, audit, exact target allocations and the full per-unit/category/amount ledger multiset); mismatched new receipts are explicitly flagged, and legacy duplicate checks remain unchanged.

The legacy payment-context inspector can read a proven grouped receipt and its exact allocations; unit/building stay null rather than inventing one room or site. This does not authorize its old confirmation/mutation writer. Public single and capped batch proof RPCs let other read-only reports verify the same sealed receipt without per-payment query waterfalls.

## Security and retries

All named RPCs authenticate current user and CIMAC project authorization. Admin/finance may write; boss reads only. New private tables have RLS and no client table grants. Privileged implementations live in private, with public invoker wrappers and explicit named authenticated EXECUTE grants, no anon/service-role execute grant.

Each write requires a UUID request ID. Keep the exact request ID and payload through an unknown transport outcome. Replay returns the persisted receipt and cannot collect twice. `cimac_billing_request_rpc` retrieves only the calling actor's request after current scope validation; `not_found` alone is not evidence of a failed in-flight request. Mutation, proof, audit and request journal commit atomically. A request ID already used by another payment/request cannot be repurposed. Expected balances/timestamps and deterministic request/contract/receivable locks prevent stale or concurrent over-allocation.

## Read performance and release checks (2026-10-24)

Production schema migrations are `20261024222516_cimac_customer_billing_workbench.sql` and `20261024223452_cimac_customer_billing_set_based_read.sql`. Their sources match the registered production versions; the original applied source is not rewritten to hide the follow-up optimization.

Authenticated production acceptance initially found a statement timeout: the directory repeated customer-to-inventory scans and permission chains. The follow-up uses a materialized authorized association set, reverse customer-unit lookup and covering indexes, without raising the statement timeout or weakening scope checks. The native production-scale fixture (404 customers, 588 units, 263 leases, 199 sales, 2,654 payments and 2,658 ledger entries) passed six reads under a hard three-second budget. The production SDK then validated all 42 currently authorized customer accounts: first/max read 790 ms, p95 572 ms, including the SDK round trip. These are point-in-time measurements, not a page-load or every-network guarantee.

An explicit historical unit/building contradiction remains visible with its original values and a derived review reason; it is not collectible or counted as a valid balance. A legitimate building-only obligation and an unknown building remain distinct and are not silently removed.

Before and after both additive migrations, the full stored-column/row digests of 24 existing business, finance, allocation and request tables were identical. The encrypted local application snapshot is scoped and not a complete, transaction-consistent disaster-recovery backup. Production acceptance is read-only: write, concurrency, recovery and scope tests run in disposable native PostgreSQL databases, not with fabricated production receipts. No new security/performance WARN findings were introduced; existing platform findings are not represented as resolved. New private-table no-policy INFO findings are intentional default-deny access through authenticated scoped functions only.

The customer-correction migration is registered as `20261024232058_cimac_customer_collection_adjustments.sql` (normalized-LF SHA256 `2a3e16d6998aabdc3100466c115481874d6a0e3209dd1e531f12f57e1edfb91d`). The applied source is frozen. Its before/after digests cover 27 existing business and request tables, including the three original private billing tables; all are unchanged. All 239 pre-existing function ACLs and all 51 pre-existing table ACL/RLS settings are preserved. Only the 11 reviewed existing read/protection functions change; two new adjustment tables remain private and default-deny. Advisory WARN categories and counts have not increased; existing warnings are not claimed as fixed.
