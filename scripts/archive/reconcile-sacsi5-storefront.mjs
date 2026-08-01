import { building, checked, loadUnit, supabase } from "./lib/reconcile-sacsi5.mjs";

const unit = await loadUnit("\u95e8\u9762\u623f");
const desiredContractNo = "WB-LEASE-SACSI5-STOREFRONT-20260101-ZHONGDA";
const leaseRows = await checked(supabase.from("lease_contracts").select("id, customer_id, contract_no").eq("unit_id", unit.id), "load storefront lease");
if (leaseRows.length !== 1 || !["LEGACY-LEASE-SACSI5-STOREFRONT", desiredContractNo].includes(leaseRows[0].contract_no)) throw new Error("Unexpected storefront lease");
const leaseId = leaseRows[0].id;
const customerId = leaseRows[0].customer_id;
if (leaseRows[0].contract_no === "LEGACY-LEASE-SACSI5-STOREFRONT") {
  const [payments, receivables, ledgers] = await Promise.all([
    checked(supabase.from("payments").select("id").eq("source_id", leaseId), "check legacy storefront payments"),
    checked(supabase.from("receivables").select("id").eq("source_id", leaseId), "check legacy storefront receivables"),
    checked(supabase.from("ledger_entries").select("id").eq("unit_id", unit.id), "check legacy storefront ledgers"),
  ]);
  if (payments.length || receivables.length || ledgers.length) throw new Error("Legacy storefront has financial references");
}
const duplicateCustomer = await checked(supabase.from("customers").select("id").eq("name", "\u4e2d\u5927\u516c\u53f8").neq("id", customerId), "check Zhongda customer");
if (duplicateCustomer.length) throw new Error("Duplicate Zhongda company customer");
await checked(supabase.from("customers").update({ name: "\u4e2d\u5927\u516c\u53f8", notes: "\u6765\u6e90\uff1a5\u53f7\u516c\u5bd3(1).xlsx\uff1b5#\u95e8\u9762\u623f\u5f53\u524d\u957f\u79df\u79df\u6237\uff1b\u79df\u671f2026-01-01\u81f32026-12-31\uff0c\u5df2\u4ed8\u81f32026-12-31\u3002" }).eq("id", customerId), "update Zhongda customer");

const leaseNotes = "\u6765\u6e90\uff1a5\u53f7\u516c\u5bd3(1).xlsx\uff1b\u627f\u79df\u4eba\u4e2d\u5927\u516c\u53f8\uff1b\u539f\u6536\u6b3e\u8986\u76d62025-11-15\u81f32026-05-14\uff0c\u56e0\u88c5\u4fee\u672a\u5b8c\u5c06\u79df\u671f\u6539\u4e3a2026-01-01\u81f32026-06-30\uff0c\u540e\u7eed\u5df2\u4ed8\u81f32026-12-31\uff1b\u4e24\u671f\u201c\u79df\u91d1+\u7269\u4e1a\u8d39\u201d\u54044260\u4e07FCFA\uff0cExcel\u672a\u7ed9\u51fa\u62c6\u5206\u6bd4\u4f8b\uff0c\u6309\u5408\u5e76\u79df\u91d1\u6536\u5165\u5165\u8d26\uff0c\u6708\u5747\u5408710\u4e07\uff1b\u62bc\u91d11400\u4e07\u5f53\u524d\u6301\u6709\uff1b\u5546\u4e1a\u57fa\u91d14000\u4e07\u6027\u8d28\u53ca\u662f\u5426\u53ef\u9000\u5f85\u6838\u5b9e\uff0c\u4e0d\u5f53\u4f5c\u62bc\u91d1\u8d1f\u503a\u3002";
const leasePayload = { unit_id: unit.id, customer_id: customerId, contract_no: desiredContractNo, start_date: "2026-01-01", expected_end_date: "2026-12-31", actual_end_date: null, payment_cycle: "semiannual", payment_day: 1, monthly_rent_xof: 7_100_000, deposit_amount_xof: 14_000_000, deposit_received: true, rent_free_days: 0, signer_name: "\u4e2d\u5927\u516c\u53f8", status: "active", expected_end_confirmed: true, paid_through_date: "2026-12-31" };
await checked(supabase.from("lease_contracts").update(leasePayload).eq("id", leaseId), "replace storefront lease");

const flagRows = await checked(supabase.from("unit_business_flags").select("unit_id").eq("unit_id", unit.id).eq("business_type", "long_lease"), "find storefront lease flag");
if (flagRows.length > 1) throw new Error("Duplicate storefront lease flags");
const flagPayload = { unit_id: unit.id, business_type: "long_lease", is_enabled: true, default_price_xof: 7_100_000 };
if (flagRows.length === 1) await checked(supabase.from("unit_business_flags").update(flagPayload).eq("unit_id", unit.id).eq("business_type", "long_lease"), "update storefront flag");
else await checked(supabase.from("unit_business_flags").insert(flagPayload), "insert storefront flag");

const entries = [
  { date: "2025-09-17", amount: 40_000_000, type: "lease_other_income", code: "COMMERCIAL-FUND-01", direction: "income", ledger: "other", recCategory: "other", title: "5# \u95e8\u9762\u623f\u5546\u4e1a\u57fa\u91d1", notes: "\u4e2d\u5927\u516c\u53f8\u652f\u4ed8\u5546\u4e1a\u57fa\u91d14000\u4e07FCFA\uff1bExcel\u672a\u660e\u786e\u8be5\u6b3e\u6027\u8d28\u53ca\u662f\u5426\u53ef\u9000\uff0c\u5355\u5217\u4e3a\u5176\u4ed6\u79df\u8d41\u6536\u5165\uff0c\u4e0d\u63a8\u65ad\u4e3a\u62bc\u91d1\u3002" },
  { date: "2025-10-14", amount: 14_000_000, type: "lease_deposit", code: "DEPOSIT-01", direction: "liability_in", ledger: "lease_deposit", recCategory: "lease_deposit", title: "5# \u95e8\u9762\u623f\u62bc\u91d1", notes: "\u4e2d\u5927\u516c\u53f8\u95e8\u9762\u623f\u62bc\u91d11400\u4e07FCFA\uff1b\u5f53\u524d\u5728\u79df\uff0c\u672a\u9000\u3002" },
  { date: "2025-10-14", amount: 42_600_000, type: "lease_rent", code: "RENT-01", direction: "income", ledger: "lease_rent", recCategory: "lease_rent", title: "5# \u95e8\u9762\u623f\u79df\u91d1\uff08\u542b\u7269\u4e1a\u8d39\uff09", notes: "\u4e2d\u5927\u516c\u53f8\u652f\u4ed8\u79df\u91d1+\u7269\u4e1a\u8d394260\u4e07FCFA\uff1b\u539f\u8986\u76d62025-11-15\u81f32026-05-14\uff0c\u56e0\u88c5\u4fee\u672a\u5b8c\u6539\u4e3a2026-01-01\u81f32026-06-30\uff1bExcel\u672a\u62c6\u5206\u79df\u91d1\u4e0e\u7269\u4e1a\u8d39\uff0c\u6309\u5408\u5e76\u79df\u91d1\u6536\u5165\u5165\u8d26\u3002" },
  { date: "2026-06-22", amount: 42_600_000, type: "lease_rent", code: "RENT-02", direction: "income", ledger: "lease_rent", recCategory: "lease_rent", title: "5# \u95e8\u9762\u623f\u79df\u91d1\uff08\u542b\u7269\u4e1a\u8d39\uff09", notes: "\u4e2d\u5927\u516c\u53f8\u652f\u4ed8\u79df\u91d1+\u7269\u4e1a\u8d394260\u4e07FCFA\uff0c\u8986\u76d62026-07-01\u81f32026-12-31\uff1bExcel\u672a\u62c6\u5206\u79df\u91d1\u4e0e\u7269\u4e1a\u8d39\uff0c\u6309\u5408\u5e76\u79df\u91d1\u6536\u5165\u5165\u8d26\u3002" },
];

for (const entry of entries) {
  const receiptNo = `WB5-LEASE-STOREFRONT-${entry.date.replaceAll("-", "")}-${entry.code}`;
  const paymentRows = await checked(supabase.from("payments").select("id").eq("source_id", leaseId).eq("receipt_no", receiptNo), `find ${receiptNo}`);
  if (paymentRows.length > 1) throw new Error(`Duplicate ${receiptNo}`);
  const paymentPayload = { customer_id: customerId, unit_id: unit.id, source_type: entry.type, source_id: leaseId, payment_date: entry.date, amount: entry.amount, currency: "XOF", exchange_rate_to_xof: 1, receipt_no: receiptNo, notes: entry.notes };
  let paymentId;
  if (paymentRows.length === 1) {
    paymentId = paymentRows[0].id;
    await checked(supabase.from("payments").update(paymentPayload).eq("id", paymentId), `update ${receiptNo}`);
  } else paymentId = (await checked(supabase.from("payments").insert(paymentPayload).select("id").single(), `insert ${receiptNo}`)).id;
  const ledgerRows = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${receiptNo}`);
  if (ledgerRows.length > 1) throw new Error(`Duplicate ledger ${receiptNo}`);
  const ledgerPayload = { building_id: building.id, unit_id: unit.id, payment_id: paymentId, entry_date: entry.date, direction: entry.direction, category: entry.ledger, amount_xof: entry.amount, amount_cny: null, description: entry.notes };
  if (ledgerRows.length === 1) await checked(supabase.from("ledger_entries").update(ledgerPayload).eq("id", ledgerRows[0].id), `update ledger ${receiptNo}`);
  else await checked(supabase.from("ledger_entries").insert(ledgerPayload), `insert ledger ${receiptNo}`);
  const recRows = await checked(supabase.from("receivables").select("id").eq("source_id", leaseId).eq("title", entry.title).eq("due_date", entry.date).eq("amount_xof", entry.amount), `find receivable ${receiptNo}`);
  if (recRows.length > 1) throw new Error(`Duplicate receivable ${receiptNo}`);
  const recPayload = { building_id: building.id, unit_id: unit.id, customer_id: customerId, source_type: "lease_contract", source_id: leaseId, category: entry.recCategory, title: entry.title, due_date: entry.date, amount_xof: entry.amount, paid_amount_xof: entry.amount, status: "paid", currency: "XOF", notes: `${entry.notes}\n\u6536\u636e\u53f7\uff1a${receiptNo}` };
  if (recRows.length === 1) await checked(supabase.from("receivables").update(recPayload).eq("id", recRows[0].id), `update receivable ${receiptNo}`);
  else await checked(supabase.from("receivables").insert(recPayload), `insert receivable ${receiptNo}`);
}
await checked(supabase.from("units").update({ status: "leased", notes: leaseNotes }).eq("id", unit.id), "update storefront unit");

const [lease, payments, receivables, ledgers, flags] = await Promise.all([
  checked(supabase.from("lease_contracts").select("contract_no, start_date, expected_end_date, status, monthly_rent_xof, deposit_amount_xof, paid_through_date").eq("id", leaseId).single(), "verify storefront lease"),
  checked(supabase.from("payments").select("source_type, amount").eq("source_id", leaseId), "verify storefront payments"),
  checked(supabase.from("receivables").select("category, amount_xof, paid_amount_xof, status").eq("source_id", leaseId).neq("status", "cancelled"), "verify storefront receivables"),
  checked(supabase.from("ledger_entries").select("direction, category, amount_xof").eq("unit_id", unit.id), "verify storefront ledgers"),
  checked(supabase.from("unit_business_flags").select("is_enabled, default_price_xof").eq("unit_id", unit.id).eq("business_type", "long_lease"), "verify storefront flag"),
]);
if (lease.contract_no !== desiredContractNo || lease.start_date !== "2026-01-01" || lease.expected_end_date !== "2026-12-31" || lease.status !== "active" || Number(lease.monthly_rent_xof) !== 7_100_000 || Number(lease.deposit_amount_xof) !== 14_000_000 || lease.paid_through_date !== "2026-12-31") throw new Error("Unexpected verified storefront lease");
if (payments.length !== 4 || payments.reduce((s, x) => s + Number(x.amount), 0) !== 139_200_000 || payments.filter((x) => x.source_type === "lease_rent").reduce((s, x) => s + Number(x.amount), 0) !== 85_200_000 || payments.filter((x) => x.source_type === "lease_deposit").reduce((s, x) => s + Number(x.amount), 0) !== 14_000_000 || payments.filter((x) => x.source_type === "lease_other_income").reduce((s, x) => s + Number(x.amount), 0) !== 40_000_000) throw new Error("Unexpected verified storefront payments");
if (receivables.length !== 4 || receivables.reduce((s, x) => s + Number(x.amount_xof), 0) !== 139_200_000 || receivables.some((x) => Number(x.amount_xof) !== Number(x.paid_amount_xof) || x.status !== "paid")) throw new Error("Unexpected verified storefront receivables");
if (ledgers.length !== 4 || ledgers.filter((x) => x.direction === "income").reduce((s, x) => s + Number(x.amount_xof), 0) !== 125_200_000 || ledgers.filter((x) => x.direction === "liability_in").reduce((s, x) => s + Number(x.amount_xof), 0) !== 14_000_000 || flags.length !== 1 || !flags[0].is_enabled || Number(flags[0].default_price_xof) !== 7_100_000) throw new Error("Unexpected verified storefront ledgers or flag");

await checked(supabase.from("audit_logs").insert({ action: "reconcile_storefront_lease", entity_type: "unit", entity_id: unit.id, metadata: { building_code: "SACSI5", unit_no: "\u95e8\u9762\u623f", tenant: "\u4e2d\u5927\u516c\u53f8", lease_start: "2026-01-01", lease_end: "2026-12-31", paid_through_date: "2026-12-31", monthly_rent_and_property_xof: 7_100_000, rent_and_property_received_xof: 85_200_000, rent_property_split_available: false, deposit_held_xof: 14_000_000, commercial_fund_xof: 40_000_000, commercial_fund_nature_pending: true, commercial_fund_treated_as_refundable_deposit: false } }), "write storefront audit");
console.log(JSON.stringify({ ok: true, unit: "\u95e8\u9762\u623f", tenant: "\u4e2d\u5927\u516c\u53f8", paid_through: "2026-12-31", rent_and_property_xof: 85_200_000, deposit_xof: 14_000_000, commercial_fund_xof: 40_000_000 }));
