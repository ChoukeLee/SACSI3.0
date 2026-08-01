import { building, checked, loadUnit, prepareSaleUnit, setUnit, supabase, upsertPayment, upsertReceivable, upsertSale, verifyNoFinance } from "./lib/reconcile-sacsi5.mjs";

const blankUnits = [
  ["1501", 175.95], ["1503", 149.72], ["1505", 181.69],
  ["1601", 175.95], ["1602", 156.39], ["1603", 149.72], ["1605", 181.69],
  ["1701", 175.95], ["1702", 156.39], ["1703", 149.72], ["1704", 181.36], ["1705", 181.69],
  ["1801", 175.95], ["1802", 156.39], ["1803", 149.72], ["1805", 181.69],
];
for (const [unitNo, area] of blankUnits) await verifyNoFinance(await loadUnit(unitNo, area));

const p1502 = await prepareSaleUnit({ unitNo: "1502", expectedArea: 156.39, customerName: "DICKO", legacyContractNo: "LEGACY-LEASE-SACSI5-1502", customerNotes: "\u6765\u6e90\uff1a5\u53f7\u516c\u5bd3(1).xlsx\u53caSACSI6\u7eb8\u8d28\u8868\uff1b5# 1502\u5386\u53f2\u8d2d\u623f\u4eba\uff0c\u540e\u5df2\u9000\u56de\u5168\u90e8\u5b9a\u91d1\uff1b6# 504\u8d44\u6599\u5f85\u8865\u3002" });
const notes1502 = "\u6765\u6e90\uff1a5\u53f7\u516c\u5bd3(1).xlsx\uff1b1502\u4e70\u65b9DICKO\uff1bExcel\u8868\u5217\u5408\u540c\u603b\u4ef719300\u4e07FCFA\uff1b2023-01-31\u4ed8\u5b9a\u91d11930\u4e07\uff0c2025-08-14\u5168\u989d\u9000\u56de1930\u4e07\uff0c\u51c0\u989d0\uff1b\u4ea4\u6613\u7ec8\u6b62\uff0c\u623f\u95f4\u6062\u590d\u7a7a\u95f2\uff0c\u9000\u6b3e\u4e0d\u751f\u6210\u65b0\u5e94\u6536\u3002";
const sale1502 = await upsertSale({ ...p1502, contractNo: "WB-SALE-SACSI5-1502-20230131-DICKO", signedDate: "2023-01-31", total: 193_000_000, status: "terminated", notes: notes1502 });
await upsertPayment({ unit: p1502.unit, customerId: p1502.customerId, sourceId: sale1502, date: "2023-01-31", amount: 19_300_000, receiptNo: "WB5-SALE-1502-20230131-DEPOSIT-01", notes: "1502 DICKO\u8d2d\u623f\u5b9a\u91d11930\u4e07FCFA\u3002" });
await upsertPayment({ unit: p1502.unit, customerId: p1502.customerId, sourceId: sale1502, date: "2025-08-14", amount: 19_300_000, receiptNo: "WB5-SALE-1502-20250814-REFUND-01", notes: "1502 DICKO\u9000\u8d2d\u623f\u5b9a\u91d11930\u4e07FCFA\uff1b\u5df2\u5168\u989d\u9000\u56de\u3002", sourceType: "sale_other_expense", direction: "expense", category: "sale_purchase_refund" });
await upsertReceivable({ unit: p1502.unit, customerId: p1502.customerId, sourceId: sale1502, title: "5# 1502\u8d2d\u623f\u5b9a\u91d1", dueDate: "2023-01-31", amount: 19_300_000, paidAmount: 19_300_000, status: "paid", notes: notes1502 });
await setUnit(p1502.unit, "available", notes1502);

const sales = [
  { unitNo: "1504", customerName: "\u9648\u6d77\u6ee8", date: "2026-04-22", legacy: "LEGACY-LEASE-SACSI5-1504", slug: "CHENHAIBIN", excelError: true },
  { unitNo: "1604", customerName: "\u9648\u6d77\u6ee8", date: "2026-04-22", legacy: "LEGACY-LEASE-SACSI5-1604", slug: "CHENHAIBIN", excelError: true },
  { unitNo: "1804", customerName: "\u6c6a\u6d9b", date: "2026-06-03", legacy: "LEGACY-LEASE-SACSI5-1804", slug: "WANGTAO", excelError: false },
];
const saleIds = [];
for (const spec of sales) {
  const customerNotes = spec.customerName === "\u9648\u6d77\u6ee8"
    ? "\u6765\u6e90\uff1a3\u53f7\u516c\u5bd3.xlsx\u53ca5\u53f7\u516c\u5bd3(1).xlsx\uff1b\u4e2d\u56fd\u7c4d\uff1b3#\u53ca5# 1504\u30011604\u8d2d\u623f\u4eba\u3002"
    : "\u6765\u6e90\uff1a5\u53f7\u516c\u5bd3(1).xlsx\uff1b5# 1804\u8d2d\u623f\u4eba\u3002";
  const prepared = await prepareSaleUnit({ unitNo: spec.unitNo, expectedArea: 181.36, customerName: spec.customerName, legacyContractNo: spec.legacy, customerNotes, replaceLegacyCustomer: spec.customerName === "\u9648\u6d77\u6ee8" });
  const errorNote = spec.excelError ? "\uff1bExcel L\u5217\u768419150\u4e07\u4e0eF\u5217\u603b\u4ef7\u53ca\u660e\u786e\u4ed8\u6b3e15535\u4e07\u51b2\u7a81\uff0c\u6309F\u5217\u4e0e\u4ed8\u6b3e\u95ed\u73af\u5904\u7406\uff0c19150\u4e07\u8bb0\u4e3aExcel\u7edf\u8ba1\u9519\u8bef" : "";
  const notes = `\u6765\u6e90\uff1a5\u53f7\u516c\u5bd3(1).xlsx\uff1b${spec.unitNo}\u4e70\u65b9${spec.customerName}\uff1b\u5408\u540c\u603b\u4ef715535\u4e07FCFA\uff0c\u542b\u8f66\u4f4d1000\u4e07\uff0c\u62c6\u5206\u4e3a\u623f\u6b3e14535\u4e07+\u8f66\u4f4d\u6b3e1000\u4e07\uff1b${spec.date}\u4e00\u6b21\u5230\u8d2615535\u4e07\uff0c\u5df2\u7ed3\u6e05${errorNote}\uff1b\u672a\u8bb0\u5408\u540c\u65e5\u671f\uff0c\u4ee5\u4ed8\u6b3e\u65e5\u4f5c\u6280\u672f\u7b7e\u7ea6\u65e5\u3002`;
  const saleId = await upsertSale({ ...prepared, contractNo: `WB-SALE-SACSI5-${spec.unitNo}-${spec.date.replaceAll("-", "")}-${spec.slug}`, signedDate: spec.date, total: 155_350_000, notes });
  saleIds.push(saleId);
  const houseReceipt = `WB5-SALE-${spec.unitNo}-${spec.date.replaceAll("-", "")}-HOUSE-01`;
  const parkingReceipt = `WB5-SALE-${spec.unitNo}-${spec.date.replaceAll("-", "")}-PARKING-01`;
  await upsertPayment({ unit: prepared.unit, customerId: prepared.customerId, sourceId: saleId, date: spec.date, amount: 145_350_000, receiptNo: houseReceipt, notes: `${spec.unitNo}${spec.customerName}\u5230\u8d26\u603b\u989d15535\u4e07FCFA\u4e2d\u62c6\u5206\u623f\u6b3e14535\u4e07\u3002` });
  await upsertPayment({ unit: prepared.unit, customerId: prepared.customerId, sourceId: saleId, date: spec.date, amount: 10_000_000, receiptNo: parkingReceipt, notes: `${spec.unitNo}${spec.customerName}\u5230\u8d26\u603b\u989d15535\u4e07FCFA\u4e2d\u62c6\u5206\u8f66\u4f4d\u6b3e1000\u4e07\u3002`, sourceType: "parking_fee", category: "parking_fee" });
  await upsertReceivable({ unit: prepared.unit, customerId: prepared.customerId, sourceId: saleId, title: `5# ${spec.unitNo}\u623f\u6b3e`, dueDate: spec.date, amount: 145_350_000, paidAmount: 145_350_000, status: "paid", notes: `${notes}\n\u6536\u636e\u53f7\uff1a${houseReceipt}` });
  await upsertReceivable({ unit: prepared.unit, customerId: prepared.customerId, sourceId: saleId, title: `5# ${spec.unitNo}\u8f66\u4f4d\u6b3e`, dueDate: spec.date, amount: 10_000_000, paidAmount: 10_000_000, status: "paid", notes: `${notes}\n\u6536\u636e\u53f7\uff1a${parkingReceipt}`, category: "other" });
  await setUnit(prepared.unit, "sold", notes);
}

const [p1502Rows, r1502Rows, salePayments, saleReceivables] = await Promise.all([
  checked(supabase.from("payments").select("amount, source_type").eq("source_id", sale1502), "verify 1502 payments"),
  checked(supabase.from("receivables").select("amount_xof, paid_amount_xof").eq("source_id", sale1502).neq("status", "cancelled"), "verify 1502 receivables"),
  checked(supabase.from("payments").select("source_id, amount, source_type").in("source_id", saleIds), "verify parking sales payments"),
  checked(supabase.from("receivables").select("source_id, amount_xof, paid_amount_xof, category").in("source_id", saleIds).neq("status", "cancelled"), "verify parking sales receivables"),
]);
if (p1502Rows.length !== 2 || p1502Rows.filter((x) => x.source_type === "sale_contract").reduce((s, x) => s + Number(x.amount), 0) !== 19_300_000 || p1502Rows.filter((x) => x.source_type === "sale_other_expense").reduce((s, x) => s + Number(x.amount), 0) !== 19_300_000 || r1502Rows.length !== 1 || Number(r1502Rows[0].amount_xof) !== 19_300_000) throw new Error("Unexpected verified 1502 finances");
for (const saleId of saleIds) {
  const payments = salePayments.filter((x) => x.source_id === saleId);
  const receivables = saleReceivables.filter((x) => x.source_id === saleId);
  if (payments.length !== 2 || payments.filter((x) => x.source_type === "sale_contract").reduce((s, x) => s + Number(x.amount), 0) !== 145_350_000 || payments.filter((x) => x.source_type === "parking_fee").reduce((s, x) => s + Number(x.amount), 0) !== 10_000_000 || receivables.length !== 2 || receivables.reduce((s, x) => s + Number(x.amount_xof), 0) !== 155_350_000 || receivables.reduce((s, x) => s + Number(x.paid_amount_xof), 0) !== 155_350_000 || receivables.filter((x) => x.category === "other").reduce((s, x) => s + Number(x.amount_xof), 0) !== 10_000_000) throw new Error(`Unexpected verified parking sale ${saleId}`);
}

await checked(supabase.from("audit_logs").insert({ action: "reconcile_floors_full_audit", entity_type: "building", entity_id: building.id, metadata: { building_code: "SACSI5", floors: [15, 16, 17, 18], units: { "1502": { contract_total_xof: 193_000_000, deposit_xof: 19_300_000, refunded_xof: 19_300_000, terminated: true }, "1504": { total_xof: 155_350_000, house_xof: 145_350_000, parking_xof: 10_000_000, settled: true, excel_19150_treated_as_error: true }, "1604": { total_xof: 155_350_000, house_xof: 145_350_000, parking_xof: 10_000_000, settled: true, excel_19150_treated_as_error: true }, "1804": { total_xof: 155_350_000, house_xof: 145_350_000, parking_xof: 10_000_000, settled: true } }, blank_units_verified: blankUnits.map(([unitNo]) => unitNo) } }), "write floors15-18 audit");
console.log(JSON.stringify({ ok: true, floors: [15, 16, 17, 18], terminated_refunded: "1502", settled_with_parking_split: ["1504", "1604", "1804"], blank_verified: blankUnits.length }));
