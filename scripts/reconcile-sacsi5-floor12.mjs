import { building, checked, loadUnit, prepareSaleUnit, setUnit, supabase, upsertPayment, upsertReceivable, upsertSale, verifyNoFinance } from "./lib/reconcile-sacsi5.mjs";

for (const [unitNo, area] of [["1201", 175.95], ["1205", 181.69]]) await verifyNoFinance(await loadUnit(unitNo, area));

const p1202 = await prepareSaleUnit({ unitNo: "1202", expectedArea: 156.39, customerName: "JOEZER", legacyContractNo: "LEGACY-LEASE-SACSI5-1202", customerNotes: "\u6765\u6e90\uff1a5\u53f7\u516c\u5bd3(1).xlsx\uff1b5# 1202\u8d2d\u623f\u4eba\uff1bExcel\u5907\u6ce8\u201c\u5f53\u5175\u201d\uff0c2026-06-02\u94a5\u5319\u5df2\u53d6\u3002" });
const notes1202 = "\u6765\u6e90\uff1a5\u53f7\u516c\u5bd3(1).xlsx\uff1b1202\u4e70\u65b9JOEZER\uff1b\u5408\u540c\u603b\u4ef716887\u4e07FCFA\uff0c\u4e09\u7b14\u5230\u8d26\u540813000\u4e07\uff0c\u4ecd\u6b203887\u4e07\uff1b\u672a\u8bb0\u5408\u540c\u65e5\u671f\uff0c\u4ee5\u9996\u7b14\u4ed8\u6b3e\u65e52026-05-04\u4f5c\u6280\u672f\u7b7e\u7ea6\u65e5\uff1b2026-06-02\u94a5\u5319\u5df2\u53d6\uff1b\u65e0\u8f66\u4f4d\u3001\u6ce8\u518c\u91d1\u3001\u79df\u8d41\u6216\u4ee3\u79df\u8bb0\u5f55\u3002";
const sale1202 = await upsertSale({ ...p1202, contractNo: "WB-SALE-SACSI5-1202-20260504-JOEZER", signedDate: "2026-05-04", total: 168_870_000, notes: notes1202 });
for (const [date, amount, suffix] of [["2026-05-04", 60_000_000, "HOUSE-01"], ["2026-06-01", 40_000_000, "HOUSE-02"], ["2026-07-01", 30_000_000, "HOUSE-03"]]) {
  const receiptNo = `WB5-SALE-1202-${date.replaceAll("-", "")}-${suffix}`;
  const notes = `1202 JOEZER\u8d2d\u623f\u6b3e${amount / 10_000}\u4e07FCFA\uff1b\u5df2\u4ed813000\u4e07\uff0c\u4ecd\u6b203887\u4e07\u3002`;
  await upsertPayment({ unit: p1202.unit, customerId: p1202.customerId, sourceId: sale1202, date, amount, receiptNo, notes });
  await upsertReceivable({ unit: p1202.unit, customerId: p1202.customerId, sourceId: sale1202, title: `5# 1202\u8d2d\u623f\u6b3e ${suffix}`, dueDate: date, amount, paidAmount: amount, status: "paid", notes: `${notes}\n\u6536\u636e\u53f7\uff1a${receiptNo}` });
}
await upsertReceivable({ unit: p1202.unit, customerId: p1202.customerId, sourceId: sale1202, title: "5# 1202\u5269\u4f59\u8d2d\u623f\u6b3e", dueDate: "2026-05-04", amount: 38_870_000, paidAmount: 0, status: "overdue", notes: "\u5408\u540c\u603b\u4ef716887\u4e07FCFA\uff0c\u5df2\u4ed813000\u4e07\uff0c\u4ecd\u6b203887\u4e07\uff1b\u5b9e\u9645\u5230\u671f\u65e5\u672a\u8bb0\u8f7d\uff0c\u4ee5\u6280\u672f\u7b7e\u7ea6\u65e5\u5f52\u8d26\u3002" });
await setUnit(p1202.unit, "sold", notes1202);

const unit1203 = await loadUnit("1203", 149.72);
await setUnit(unit1203, "locked", "\u6765\u6e90\uff1a5\u53f7\u516c\u5bd3(1).xlsx\uff1bExcel\u4ec5\u8bb0\u201c\u5efa\u6750\u57ce\u201d\uff0c\u672a\u8bb0\u5408\u540c\u6027\u8d28\u3001\u5bf9\u4ef7\u3001\u4ed8\u6b3e\u6216\u79df\u7ea6\uff1b\u6309\u5185\u90e8\u5360\u7528/\u6027\u8d28\u5f85\u6838\u5b9e\u9501\u5b9a\uff0c\u4e0d\u751f\u6210\u5408\u540c\u6216\u8d22\u52a1\u6d41\u6c34\u3002");
await verifyNoFinance(unit1203, "locked");

const p1204 = await prepareSaleUnit({ unitNo: "1204", expectedArea: 181.36, customerName: "\u738b\u51e4\u52c7", legacyContractNo: "LEGACY-LEASE-SACSI5-1204", customerNotes: "\u6765\u6e90\uff1a5\u53f7\u516c\u5bd3(1).xlsx\uff1b\u4e2d\u56fd\u7c4d\uff1b5# 1204\u8d2d\u623f\u4eba\u3002" });
const notes1204 = "\u6765\u6e90\uff1a5\u53f7\u516c\u5bd3(1).xlsx\uff1b\u4e70\u65b9\u738b\u51e4\u52c7\uff0c\u4e2d\u56fd\u7c4d\uff1b\u5408\u540c\u51c0\u603b\u4ef720200\u4e07FCFA\uff0c17\u7b14\u5386\u53f2\u5230\u8d26\u540821200\u4e07\uff0c2025-09-17\u9000\u6b3e1000\u4e07\uff0c\u51c0\u653620200\u4e07\uff0c\u5df2\u7ed3\u6e05\uff1b\u672a\u8bb0\u5408\u540c\u65e5\u671f\uff0c\u4ee5\u9996\u7b14\u4ed8\u6b3e\u65e52022-09-05\u4f5c\u6280\u672f\u7b7e\u7ea6\u65e5\u3002";
const sale1204 = await upsertSale({ ...p1204, contractNo: "WB-SALE-SACSI5-1204-20220905-WANGFENGYONG", signedDate: "2022-09-05", total: 202_000_000, notes: notes1204 });
const monthly = ["2022-10-05", "2022-11-05", "2022-12-03", "2023-01-06", "2023-02-04", "2023-03-04", "2023-04-05", "2023-05-06", "2023-06-03", "2023-07-01", "2023-08-05", "2023-09-05", "2023-10-07"].map((date) => [date, 5_800_000]);
const gross1204 = [["2022-09-05", 106_000_000], ...monthly, ["2023-11-04", 11_600_000], ["2024-01-06", 11_600_000], ["2024-03-09", 7_400_000]];
for (const [index, [date, amount]] of gross1204.entries()) await upsertPayment({ unit: p1204.unit, customerId: p1204.customerId, sourceId: sale1204, date, amount, receiptNo: `WB5-SALE-1204-${date.replaceAll("-", "")}-HOUSE-${String(index + 1).padStart(2, "0")}`, notes: `1204\u738b\u51e4\u52c7\u5386\u53f2\u8d2d\u623f\u6b3e${amount / 10_000}\u4e07FCFA\u3002` });
await upsertPayment({ unit: p1204.unit, customerId: p1204.customerId, sourceId: sale1204, date: "2025-09-17", amount: 10_000_000, receiptNo: "WB5-SALE-1204-20250917-REFUND-01", notes: "1204\u738b\u51e4\u52c7\u9000\u6b3e1000\u4e07FCFA\uff1b\u5386\u53f2\u5230\u8d2621200\u4e07\uff0c\u51c0\u653620200\u4e07\u3002", sourceType: "sale_other_expense", direction: "expense", category: "sale_purchase_refund" });
await upsertReceivable({ unit: p1204.unit, customerId: p1204.customerId, sourceId: sale1204, title: "5# 1204\u8d2d\u623f\u6b3e", dueDate: "2022-09-05", amount: 202_000_000, paidAmount: 202_000_000, status: "paid", notes: notes1204 });
await setUnit(p1204.unit, "sold", notes1204);

const [payments1202, rec1202, payments1204, rec1204, leases, sales] = await Promise.all([
  checked(supabase.from("payments").select("amount").eq("source_id", sale1202), "verify 1202 payments"),
  checked(supabase.from("receivables").select("amount_xof, paid_amount_xof").eq("source_id", sale1202).neq("status", "cancelled"), "verify 1202 receivables"),
  checked(supabase.from("payments").select("amount, source_type").eq("source_id", sale1204), "verify 1204 payments"),
  checked(supabase.from("receivables").select("amount_xof, paid_amount_xof").eq("source_id", sale1204).neq("status", "cancelled"), "verify 1204 receivables"),
  checked(supabase.from("lease_contracts").select("unit_id").in("unit_id", [p1202.unit.id, p1204.unit.id]), "verify floor12 leases"),
  checked(supabase.from("sale_contracts").select("unit_id, total_amount_xof").in("unit_id", [p1202.unit.id, p1204.unit.id]), "verify floor12 sales"),
]);
if (payments1202.length !== 3 || payments1202.reduce((s, x) => s + Number(x.amount), 0) !== 130_000_000 || rec1202.reduce((s, x) => s + Number(x.amount_xof), 0) !== 168_870_000 || rec1202.reduce((s, x) => s + Number(x.paid_amount_xof), 0) !== 130_000_000) throw new Error("Unexpected verified 1202 finances");
if (payments1204.length !== 18 || payments1204.filter((x) => x.source_type === "sale_contract").reduce((s, x) => s + Number(x.amount), 0) !== 212_000_000 || payments1204.filter((x) => x.source_type === "sale_other_expense").reduce((s, x) => s + Number(x.amount), 0) !== 10_000_000 || rec1204.length !== 1 || Number(rec1204[0].amount_xof) !== 202_000_000 || Number(rec1204[0].paid_amount_xof) !== 202_000_000) throw new Error("Unexpected verified 1204 finances");
if (leases.length || sales.length !== 2) throw new Error("Unexpected floor12 contracts");

await checked(supabase.from("audit_logs").insert({ action: "reconcile_floor_full_audit", entity_type: "building", entity_id: building.id, metadata: { building_code: "SACSI5", floor: 12, units: { "1201": "verified_empty", "1202": { total_xof: 168_870_000, paid_xof: 130_000_000, outstanding_xof: 38_870_000 }, "1203": "locked_internal_use_nature_pending_no_finance", "1204": { total_xof: 202_000_000, gross_received_xof: 212_000_000, refunded_xof: 10_000_000, settled: true }, "1205": "verified_empty" } } }), "write floor12 audit");
console.log(JSON.stringify({ ok: true, floor: 12, unit1202: { paid: 130_000_000, outstanding: 38_870_000 }, unit1204: { net: 202_000_000, settled: true }, unit1203: "locked_no_finance" }));
