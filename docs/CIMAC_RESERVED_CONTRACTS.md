# Existing CIMAC shop reservation contracts

`cimac_reserved_contracts_rpc(p_request_id, p_input)` materializes unsigned,
unstarted draft lease records for an existing customer and their existing shop
reservation links. It does not register a signature, move-in, payment, ledger
entry, receivable, or property fee. Actual deposits continue through the existing
reviewed `cimac_finance` collection workflow after independent reconciliation.

The normal authenticated account must be an administrator with current CIMAC
project and unit access. The private implementation checks the actual account,
current customer membership, reservation links, holder, unit and customer version
snapshots, conflicts, and exact three-month deposit terms in one transaction.
It preserves the original customer, units, links, rules, and financial records.

Input is restricted to `customerId`, `customerName`,
`expectedCustomerUpdatedAt`, `reason`, and `units`. Each unit contains `unitId`,
`expectedUnitUpdatedAt`, `monthlyRentXof`, `depositXof`, and `sourceReference`.
Amounts are positive canonical XOF integer strings. There are 1–30 explicit
commercial shop targets; no warehouse, apartment, or excluded shop is accepted.

Save the exact input and request UUID before submission. A completed original
request returns the original result only for the same account and input. After a
timeout or unknown response, reconcile that original request and audit record;
do not replace its UUID or attempt to recreate the customer. Contract creation is
not proof that any deposit has been posted.
