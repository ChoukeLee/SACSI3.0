import { building, checked, loadUnit, prepareSaleUnit, setUnit, supabase, upsertPayment, upsertReceivable, upsertSale, verifyNoFinance } from "./lib/reconcile-sacsi5.mjs";

for (const [unitNo, area] of [["1302", 156.39], ["1303", 149.72], ["1305", 181.69], ["1401", 175.95], ["1402", 156.39], ["1403", 149.72], ["1405", 181.69]]) await verifyNoFinance(await loadUnit(unitNo, area));

const unit1301 = await loadUnit("1301", 175.95);
const [leases1301, sales1301] = await Promise.all([
  checked(supabase.from("lease_contracts").select("id").eq("unit_id", unit1301.id), "check 1301 leases"),
  checked(supabase.from("sale_contracts").select("id").eq("unit_id", unit1301.id), "check 1301 sales"),
]);
if (leases1301.length || sales1301.length) throw new Error("1301 must not have a contract");
let customerRows = await checked(supabase.from("customers").select("id").eq("name", "DADJOURI"), "find DADJOURI");
if (customerRows.length > 1) throw new Error("Duplicate DADJOURI");
const customer1301 = customerRows[0]?.id ?? (await checked(supabase.from("customers").insert({ name: "DADJOURI", notes: "\u6765\u6e90\uff1a5\u53f7\u516c\u5bd3(1).xlsx\uff1b2026-07-11\u4e3a5# 1301\u652f\u4ed8\u6ce8\u518c\u91d130\u4e07\uff1b\u65e0\u540e\u7eed\u8d2d\u623f\u3002", is_blacklisted: false }).select("id").single(), "insert DADJOURI")).id;
await checked(supabase.from("customers").update({ notes: "\u6765\u6e90\uff1a5\u53f7\u516c\u5bd3(1).xlsx\uff1b2026-07-11\u4e3a5# 1301\u652f\u4ed8\u6ce8\u518c\u91d130\u4e07\uff1b\u65e0\u540e\u7eed\u8d2d\u623f\u3002" }).eq("id", customer1301), "update DADJOURI");
const regReceipt = "WB5-SALE-1301-20260711-REGISTRATION-01";
const regNotes = "1301 DADJOURI\u4e8e2026-07-11\u652f\u4ed8\u6ce8\u518c\u91d130\u4e07FCFA\uff1bExcel\u5408\u540c\u603b\u4ef7\u4ec5\u8bb0\u201c\uff1f\u201d\uff0c\u65e0\u540e\u7eed\u8d2d\u5165\u4f9d\u636e\uff0c\u4e0d\u521b\u5efa\u9500\u552e\u5408\u540c\uff0c\u4e0d\u63a8\u65ad\u9000\u6b3e\u3002";
await upsertPayment({ unit: unit1301, customerId: customer1301, sourceId: unit1301.id, date: "2026-07-11", amount: 300_000, receiptNo: regReceipt, notes: regNotes, sourceType: "sale_registration_fee", category: "sale_registration_fee" });
const regRecRows = await checked(supabase.from("receivables").select("id").eq("source_type", "manual").eq("source_id", unit1301.id).eq("title", "5# 1301\u6ce8\u518c\u91d1"), "find 1301 registration receivable");
if (regRecRows.length > 1) throw new Error("Duplicate 1301 registration receivable");
const regRecPayload = { building_id: building.id, unit_id: unit1301.id, customer_id: customer1301, source_type: "manual", source_id: unit1301.id, category: "other", title: "5# 1301\u6ce8\u518c\u91d1", due_date: "2026-07-11", amount_xof: 300_000, paid_amount_xof: 300_000, status: "paid", currency: "XOF", notes: `${regNotes}\n\u6536\u636e\u53f7\uff1a${regReceipt}` };
if (regRecRows.length === 1) await checked(supabase.from("receivables").update(regRecPayload).eq("id", regRecRows[0].id), "update 1301 registration receivable");
else await checked(supabase.from("receivables").insert(regRecPayload), "insert 1301 registration receivable");
await setUnit(unit1301, "available", "\u6765\u6e90\uff1a5\u53f7\u516c\u5bd3(1).xlsx\uff1bDADJOURI\u4e8e2026-07-11\u652f\u4ed8\u6ce8\u518c\u91d130\u4e07\uff1b\u65e0\u540e\u7eed\u8d2d\u623f\uff0c\u4fdd\u6301\u7a7a\u95f2\u3002");

const settled = [
  { unitNo: "1304", customerName: "\u90d1\u671d\u9633", legacy: "LEGACY-LEASE-SACSI5-1304", slug: "ZHENGCHAOYANG" },
  { unitNo: "1404", customerName: "\u9648\u5b87", legacy: "LEGACY-LEASE-SACSI5-1404", slug: "CHENYU" },
];
const saleIds = [];
for (const spec of settled) {
  const prepared = await prepareSaleUnit({ unitNo: spec.unitNo, expectedArea: 181.36, customerName: spec.customerName, legacyContractNo: spec.legacy, customerNotes: `\u6765\u6e90\uff1a5\u53f7\u516c\u5bd3(1).xlsx\uff1b5# ${spec.unitNo}\u8d2d\u623f\u4eba\u3002` });
  const notes = `\u6765\u6e90\uff1a5\u53f7\u516c\u5bd3(1).xlsx\uff1b${spec.unitNo}\u4e70\u65b9${spec.customerName}\uff1b\u5408\u540c\u603b\u4ef717636\u4e07FCFA\uff1b2024-01-31\u5230\u8d2618136\u4e07\uff0c2025-09-17\u9000\u6b3e500\u4e07\uff0c\u51c0\u653617636\u4e07\uff0c\u5df2\u7ed3\u6e05\uff1b\u672a\u8bb0\u5408\u540c\u65e5\u671f\uff0c\u4ee5\u4ed8\u6b3e\u65e5\u4f5c\u6280\u672f\u7b7e\u7ea6\u65e5\u3002`;
  const saleId = await upsertSale({ ...prepared, contractNo: `WB-SALE-SACSI5-${spec.unitNo}-20240131-${spec.slug}`, signedDate: "2024-01-31", total: 176_360_000, notes });
  saleIds.push(saleId);
  await upsertPayment({ unit: prepared.unit, customerId: prepared.customerId, sourceId: saleId, date: "2024-01-31", amount: 181_360_000, receiptNo: `WB5-SALE-${spec.unitNo}-20240131-HOUSE-01`, notes: `${spec.unitNo}${spec.customerName}\u8d2d\u623f\u6b3e18136\u4e07FCFA\u3002` });
  await upsertPayment({ unit: prepared.unit, customerId: prepared.customerId, sourceId: saleId, date: "2025-09-17", amount: 5_000_000, receiptNo: `WB5-SALE-${spec.unitNo}-20250917-REFUND-01`, notes: `${spec.unitNo}${spec.customerName}\u9000\u6b3e500\u4e07FCFA\uff1b\u51c0\u653617636\u4e07\uff0c\u5df2\u7ed3\u6e05\u3002`, sourceType: "sale_other_expense", direction: "expense", category: "sale_purchase_refund" });
  await upsertReceivable({ unit: prepared.unit, customerId: prepared.customerId, sourceId: saleId, title: `5# ${spec.unitNo}\u8d2d\u623f\u6b3e`, dueDate: "2024-01-31", amount: 176_360_000, paidAmount: 176_360_000, status: "paid", notes });
  await setUnit(prepared.unit, "sold", notes);
}

const [regPayments, regReceivables, regLedgers, unit1301Check, contract1301, salePayments, saleReceivables] = await Promise.all([
  checked(supabase.from("payments").select("amount, source_type").eq("unit_id", unit1301.id), "verify 1301 payment"),
  checked(supabase.from("receivables").select("amount_xof, paid_amount_xof, status").eq("unit_id", unit1301.id).neq("status", "cancelled"), "verify 1301 receivable"),
  checked(supabase.from("ledger_entries").select("amount_xof, direction, category").eq("unit_id", unit1301.id), "verify 1301 ledger"),
  checked(supabase.from("units").select("status").eq("id", unit1301.id).single(), "verify 1301 status"),
  checked(supabase.from("sale_contracts").select("id").eq("unit_id", unit1301.id), "verify 1301 sales"),
  checked(supabase.from("payments").select("source_id, amount, source_type").in("source_id", saleIds), "verify 1304/1404 payments"),
  checked(supabase.from("receivables").select("source_id, amount_xof, paid_amount_xof, status").in("source_id", saleIds).neq("status", "cancelled"), "verify 1304/1404 receivables"),
]);
if (regPayments.length !== 1 || Number(regPayments[0].amount) !== 300_000 || regPayments[0].source_type !== "sale_registration_fee" || regReceivables.length !== 1 || Number(regReceivables[0].amount_xof) !== 300_000 || Number(regReceivables[0].paid_amount_xof) !== 300_000 || regLedgers.length !== 1 || regLedgers[0].category !== "sale_registration_fee" || unit1301Check.status !== "available" || contract1301.length) throw new Error("Unexpected verified 1301 state");
for (const saleId of saleIds) {
  const payments = salePayments.filter((row) => row.source_id === saleId);
  const receivables = saleReceivables.filter((row) => row.source_id === saleId);
  if (payments.length !== 2 || payments.filter((x) => x.source_type === "sale_contract").reduce((s, x) => s + Number(x.amount), 0) !== 181_360_000 || payments.filter((x) => x.source_type === "sale_other_expense").reduce((s, x) => s + Number(x.amount), 0) !== 5_000_000 || receivables.length !== 1 || Number(receivables[0].amount_xof) !== 176_360_000 || Number(receivables[0].paid_amount_xof) !== 176_360_000 || receivables[0].status !== "paid") throw new Error(`Unexpected settled sale ${saleId}`);
}

await checked(supabase.from("audit_logs").insert({ action: "reconcile_floors_full_audit", entity_type: "building", entity_id: building.id, metadata: { building_code: "SACSI5", floors: [13, 14], units: { "1301": { registration_xof: 300_000, purchase_follow_up: false, status: "available" }, "1304": { total_xof: 176_360_000, gross_received_xof: 181_360_000, refunded_xof: 5_000_000, settled: true }, "1404": { total_xof: 176_360_000, gross_received_xof: 181_360_000, refunded_xof: 5_000_000, settled: true } }, blank_units_verified: ["1302", "1303", "1305", "1401", "1402", "1403", "1405"] } }), "write floors13-14 audit");
console.log(JSON.stringify({ ok: true, floors: [13, 14], registration_only: "1301", settled_sales: ["1304", "1404"] }));
